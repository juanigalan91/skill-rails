// Deterministic flow tests: the flow runs for real, and fixed answers stand in for the agent.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { done, start } from './api.js';
import { readState } from './state.js';
import { rootResults } from './engine.js';
import type { Report, StepResult } from './types.js';

const MAX_STEPS = 500;

/** Expected value: a string that starts and ends with `/` is a regular expression. */
type Matcher = string | number | boolean | null;

export interface TestCase {
  name: string;
  /** The test file, for relative paths. */
  file: string;
  flow: string;
  /** A folder copied into the temp working directory. */
  fixture?: string;
  /** Run `git init` and commit the fixture (default true). */
  git?: boolean;
  /** Bash commands run in the working directory before the flow. */
  setup?: string;
  inputs?: Record<string, unknown>;
  env?: Record<string, string>;
  /** Folders put first in PATH, for stub commands. Relative to the test file. */
  path?: string[];
  /** `{{cwd}}` (the temp working directory) and `{{dir}}` (the folder of the test file) work in env, inputs and answers. */
  /**
   * The agent output of each step, by step id. `$files` writes files first; `$fail` fails the step.
   * A list gives one answer per occurrence of the step, in order (a step in a foreach comes back once per item).
   */
  answers?: Record<string, Record<string, unknown> | Array<Record<string, unknown>>>;
  expect?: {
    status?: 'done' | 'failed' | 'error';
    message?: Matcher;
    steps?: Record<string, StepResult['outcome']>;
    outputs?: Record<string, Matcher>;
    files?: Record<string, Matcher>;
    notes?: Matcher[];
  };
}

export interface TestResult {
  name: string;
  file: string;
  passed: boolean;
  failures: string[];
  /** The ids of the agent steps, in order. */
  trace: string[];
  ms: number;
}

const isRegex = (value: unknown): value is string => typeof value === 'string' && value.length > 1 && value.startsWith('/') && value.endsWith('/');

function matches(expected: Matcher, actual: unknown): boolean {
  if (isRegex(expected)) return new RegExp(expected.slice(1, -1)).test(typeof actual === 'string' ? actual : JSON.stringify(actual));
  return JSON.stringify(expected) === JSON.stringify(actual);
}

/** `{{cwd}}` and `{{dir}}` in an answer become the working directory and the folder of the test file. */
function substitute<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') return value.replace(/\{\{(\w+)\}\}/g, (all, key: string) => vars[key] ?? all) as T;
  if (Array.isArray(value)) return value.map((item) => substitute(item, vars)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, vars)])) as T;
  return value;
}

/** Reads a test file: one test, or `tests:` with shared keys at the top. */
export function loadTests(file: string): TestCase[] {
  const raw = yaml.load(fs.readFileSync(file, 'utf8')) as Record<string, unknown> & { tests?: Array<Record<string, unknown>> };
  const { tests, ...shared } = raw;
  const list = tests ?? [{}];
  return list.map((test, index) => {
    // env and path add to the shared ones; the other keys replace them.
    const merged = {
      ...shared,
      ...test,
      env: { ...(shared.env as object), ...(test.env as object) },
      path: [...((test.path as string[]) ?? []), ...((shared.path as string[]) ?? [])],
    } as Partial<TestCase>;
    if (!merged.flow) throw new Error(`${file}: a test needs a flow`);
    return { ...merged, flow: merged.flow, file, name: merged.name ?? (tests ? `test ${index + 1}` : path.basename(file)) } as TestCase;
  });
}

/** The test files in the given files and folders. */
export function findTests(targets: string[]): string[] {
  const found: string[] = [];
  const walk = (target: string) => {
    const stat = fs.statSync(target);
    if (stat.isFile()) found.push(target);
    else
      for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const child = path.join(target, entry.name);
        if (entry.isDirectory()) walk(child);
        else if (entry.name.endsWith('.test.yaml') || entry.name.endsWith('.test.yml')) found.push(child);
      }
  };
  for (const target of targets) walk(target);
  return found.sort();
}

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function prepare(test: TestCase, dir: string, cwd: string): void {
  if (test.fixture) fs.cpSync(path.resolve(dir, test.fixture), cwd, { recursive: true });
  const git = (...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'skill-rails', GIT_AUTHOR_EMAIL: 'test@skill-rails', GIT_COMMITTER_NAME: 'skill-rails', GIT_COMMITTER_EMAIL: 'test@skill-rails' } });
  if (test.git !== false) {
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', 'fixture');
  }
  if (test.setup) {
    const result = spawnSync('bash', ['-eo', 'pipefail', '-c', test.setup], { cwd, encoding: 'utf8', env: process.env });
    if (result.status !== 0) throw new Error(`setup failed: ${result.stderr || result.stdout}`);
  }
}

export function runTest(test: TestCase): TestResult {
  const began = Date.now();
  const dir = path.dirname(path.resolve(test.file));
  const failures: string[] = [];
  const trace: string[] = [];
  const result = (passed = failures.length === 0): TestResult => ({ name: test.name, file: test.file, passed, failures, trace, ms: Date.now() - began });

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-rails-state-'));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-rails-run-')));
  const vars = { cwd, dir };
  const pathPrefix = (test.path ?? []).map((p) => path.resolve(dir, p)).join(path.delimiter);
  const env = {
    ...substitute(test.env ?? {}, vars),
    SKILL_RAILS_STATE_DIR: stateDir,
    ...(pathPrefix ? { PATH: `${pathPrefix}${path.delimiter}${process.env.PATH ?? ''}` } : {}),
  };

  return withEnv(env, () => {
    try {
      prepare(test, dir, cwd);
    } catch (error) {
      failures.push((error as Error).message);
      return result();
    }
    const answers = substitute(test.answers ?? {}, vars);
    const used = new Map<string, number>();
    const flowFile = path.resolve(dir, test.flow);
    const notes: string[] = [];
    const collect = (r: Report): Report => {
      if ('notes' in r && r.notes) notes.push(...r.notes);
      return r;
    };
    let report: Report = collect(start({ file: flowFile, inputs: substitute(test.inputs ?? {}, vars), cwd }));
    let flowName = 'status' in report && 'flow' in report ? (report as { flow: string }).flow : '';

    for (let i = 0; report.status === 'step' && i < MAX_STEPS; i++) {
      const id = report.id;
      trace.push(id);
      const given = answers[id];
      const count = used.get(id) ?? 0;
      const answer = Array.isArray(given) ? given[count] : given;
      if (!answer) {
        failures.push(
          given
            ? `the flow asked for step "${id}" a ${count + 1}th time, and the test has ${count} answers for it`
            : `the flow asked for step "${id}" (${report.type}), and the test has no answer for it`,
        );
        break;
      }
      used.set(id, count + 1);
      const { $files, $fail, ...output } = answer as { $files?: Record<string, string>; $fail?: string } & Record<string, unknown>;
      for (const [rel, content] of Object.entries($files ?? {})) {
        const target = path.resolve(cwd, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
      }
      const next = done({ flow: flowName, id, output: $fail === undefined ? output : undefined, fail: $fail, cwd });
      if (next.status === 'invalid') {
        failures.push(`the answer of step "${id}" is not valid: ${next.errors.join('; ')}`);
        break;
      }
      report = collect(next);
    }
    if (report.status === 'error') failures.push(`the flow has errors: ${report.errors.join('; ')}`);
    for (const [id, given] of Object.entries(answers)) {
      if (failures.length) break;
      const count = used.get(id) ?? 0;
      if (!count) failures.push(`the flow never asked for step "${id}"`);
      else if (Array.isArray(given) && count < given.length) failures.push(`the flow asked for step "${id}" ${count} times, and the test has ${given.length} answers for it`);
    }

    const expect = test.expect ?? {};
    const status = report.status;
    if (failures.length === 0) {
      if (expect.status && status !== expect.status) failures.push(`status: expected ${expect.status}, got ${status}`);
      const message = 'message' in report ? report.message : null;
      if (expect.message !== undefined && !matches(expect.message, message)) failures.push(`message: expected ${JSON.stringify(expect.message)}, got ${JSON.stringify(message)}`);
      let steps: Record<string, StepResult> = {};
      try {
        flowName ||= (report as { flow?: string }).flow ?? '';
        steps = rootResults(readState(flowName, cwd));
      } catch {
        // the flow has no state: a flow file error
      }
      for (const [id, outcome] of Object.entries(expect.steps ?? {})) {
        const actual = steps[id]?.outcome ?? 'not reached';
        if (actual !== outcome) failures.push(`step "${id}": expected ${outcome}, got ${actual}`);
      }
      for (const [key, expected] of Object.entries(expect.outputs ?? {})) {
        const [id, ...rest] = key.split('.');
        const actual = steps[id ?? '']?.outputs?.[rest.join('.')];
        if (!matches(expected, actual ?? null)) failures.push(`output ${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual ?? null)}`);
      }
      for (const expected of expect.notes ?? []) {
        if (!notes.some((note) => matches(expected, note))) failures.push(`notes: no note matches ${JSON.stringify(expected)} (got ${JSON.stringify(notes)})`);
      }
      for (const [rel, expected] of Object.entries(expect.files ?? {})) {
        const target = path.resolve(cwd, rel);
        const exists = fs.existsSync(target);
        if (expected === 'exists' || expected === 'absent') {
          if (exists !== (expected === 'exists')) failures.push(`file ${rel}: expected ${expected}`);
        } else if (!exists) failures.push(`file ${rel}: expected it to exist`);
        else if (!matches(expected, fs.readFileSync(target, 'utf8'))) failures.push(`file ${rel}: the content does not match ${JSON.stringify(expected)}`);
      }
    }
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    return result();
  });
}

/** Runs the tests of the given files and folders. */
export function runTests(targets: string[]): TestResult[] {
  return findTests(targets).flatMap((file) => {
    try {
      return loadTests(file).map(runTest);
    } catch (error) {
      return [{ name: path.basename(file), file, passed: false, failures: [(error as Error).message], trace: [], ms: 0 }];
    }
  });
}
