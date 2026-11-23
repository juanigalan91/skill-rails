// Deterministic skill tests: the rails file runs for real, and fixed answers stand in for the agent.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { done, start } from './api.js';
import { readState } from './state.js';
import { rootResults } from './engine.js';
import { loadRails } from './rails.js';
import { runCommand } from './run.js';
import type { Exec, PendingStep, Report, State, StepResult } from './types.js';

const MAX_STEPS = 500;
const agentTimeoutMinutes = () => Number(process.env.SKILL_RAILS_AGENT_TIMEOUT_MINUTES ?? 10);
export const DEFAULT_AGENT = 'claude -p';

/** Sends a prompt to a real agent, and returns what it printed. */
export type Agent = (prompt: string, cwd: string, env: NodeJS.ProcessEnv) => string;

export interface TestOptions {
  /** Run the tests that need a real agent: live steps, judge and agent mode. Without it, they are skipped. */
  live?: boolean;
  /** The agent: a function, or a command that reads the prompt on stdin (default: SKILL_RAILS_AGENT, else `claude -p`). */
  agent?: Agent | string;
}

/** A fixed answer, `live`, or `{ $live: <guidance> }` for a real agent. */
type Answer = Record<string, unknown> | 'live';

/** Expected value: a string that starts and ends with `/` is a regular expression. */
type Matcher = string | number | boolean | null;

export interface TestCase {
  name: string;
  /** The test file, for relative paths. */
  file: string;
  /** The rails file; empty in a mode: agent test of a Markdown skill. */
  rails: string;
  /** A folder copied into the temp working directory. */
  fixture?: string;
  /** Run `git init` and commit the fixture (default true). */
  git?: boolean;
  /** Bash commands run in the working directory before the run. `{{cwd}}` and `{{dir}}` work here too. */
  setup?: string;
  inputs?: Record<string, unknown>;
  env?: Record<string, string>;
  /** Folders put first in PATH, for stub commands. Relative to the test file. */
  path?: string[];
  /** `{{cwd}}` (the temp working directory) and `{{dir}}` (the folder of the test file) work in env, inputs and answers. */
  /**
   * The agent output of each step, by step id. `$files` writes files first; `$fail` fails the step.
   * A list gives one answer per occurrence of the step, in order (a step in a foreach or a repeat comes back once per iteration).
   */
  answers?: Record<string, Answer | Answer[]>;
  /** agent: the agent command does the request, and the expectations read the saved state of the run. */
  mode?: 'agent';
  request?: string;
  /** Run the test this number of times; every run must pass. */
  'judge-runs'?: number;
  expect?: {
    status?: 'done' | 'failed' | 'error';
    message?: Matcher;
    steps?: Record<string, StepResult['outcome']>;
    /** `<step id>.<key>`: an output of a step; a deeper path reads inside it, for example `fix.results[0].steps`. */
    outputs?: Record<string, Matcher>;
    /** `<key>`: an output that the rails file gives back (its `outputs:`), at the end. */
    'rails-outputs'?: Record<string, Matcher>;
    files?: Record<string, Matcher>;
    notes?: Matcher[];
    /** `<step id>` or `<uses id>/<step id>`: a rubric that a real agent grades the step output against. */
    judge?: Record<string, string>;
    /** Whether the run has a state: false means that the agent did not start the run. */
    started?: boolean;
    /** The stdout of the agent, in agent mode: a string is a part of it. */
    transcript?: { contains?: Matcher[]; absent?: Matcher[] };
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
  /** The test needs a real agent, and the run has no --live. */
  skipped?: boolean;
  /** Agent mode: the stdout of the agent command. */
  transcript?: string;
}

const isRegex = (value: unknown): value is string => typeof value === 'string' && value.length > 1 && value.startsWith('/') && value.endsWith('/');

/** A value at a path such as `a.b[0].c`; an exact key wins over a path. */
function at(value: unknown, key: string): unknown {
  if (value && typeof value === 'object' && Object.hasOwn(value, key)) return (value as Record<string, unknown>)[key];
  return key
    .split(/\.|\[(\d+)\]/)
    .filter(Boolean)
    .reduce<unknown>((current, part) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined), value);
}

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
    // A mode: agent test of a Markdown skill has no rails file: only the files, transcript and judge expectations apply.
    if (!merged.rails && merged.mode !== 'agent') throw new Error(`${file}: a test needs a rails key (only a mode: agent test can have none)`);
    return { ...merged, rails: merged.rails ?? '', file, name: merged.name ?? (tests ? `test ${index + 1}` : path.basename(file)) } as TestCase;
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
        if (['node_modules', '.git', 'dist', 'coverage', '.nx'].includes(entry.name)) continue;
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
    const setup = substitute(test.setup, { cwd, dir: path.dirname(path.resolve(test.file)) });
    const result = spawnSync('bash', ['-eo', 'pipefail', '-c', setup], { cwd, encoding: 'utf8', env: process.env });
    if (result.status !== 0) throw new Error(`setup failed: ${result.stderr || result.stdout}`);
  }
}

/** The answer of a step: `<uses id>/<step id>` for a step of another rails file (the longest path first), else the step id. */
function answerKey(answers: Record<string, unknown>, id: string, rails: string, cwd: string): string {
  let scope: string[] = [];
  try {
    scope = readState(rails, cwd).frames.filter((frame) => frame.kind === 'rails').map((frame) => frame.id as string);
  } catch {
    return id;
  }
  for (let i = 0; i < scope.length; i++) {
    const key = [...scope.slice(i), id].join('/');
    if (key in answers) return key;
  }
  // A TypeScript rails file gives the pending step of a nested run as <uses id>/<step id>.
  const parts = id.split('/');
  for (let i = 0; i < parts.length; i++) {
    const key = parts.slice(i).join('/');
    if (key in answers) return key;
  }
  return id;
}

/** The guidance of a live answer (`live` or `{ $live }`), or undefined for a fixed answer. */
function liveGuidance(answer: unknown): string | undefined {
  if (answer === 'live') return '';
  if (answer && typeof answer === 'object' && Object.hasOwn(answer, '$live')) return String((answer as { $live: unknown }).$live ?? '');
  return undefined;
}

/** Whether a test needs a real agent: a live answer, a judge, or agent mode. */
export function needsAgent(test: TestCase): boolean {
  const answers = Object.values(test.answers ?? {}).flat();
  return test.mode === 'agent' || Object.keys(test.expect?.judge ?? {}).length > 0 || answers.some((answer) => liveGuidance(answer) !== undefined);
}

/** An agent that runs a command, with the prompt on stdin. */
export function commandAgent(command: string): Agent {
  return (prompt, cwd, env) => {
    const result = spawnSync('bash', ['-c', command], { input: prompt, cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: agentTimeoutMinutes() * 60_000 });
    if (result.signal === 'SIGTERM') throw new Error(`the agent command did not end in ${agentTimeoutMinutes()} minutes (SKILL_RAILS_AGENT_TIMEOUT_MINUTES)`);
    if (result.error) throw new Error(`the agent command failed: ${result.error.message}`);
    if (result.status !== 0) {
      const last = (result.stderr || result.stdout).trim().split('\n').slice(-5).join('\n');
      throw new Error(`the agent command failed with exit code ${result.status}: ${last}`);
    }
    return result.stdout;
  };
}

const agentOf = (agent: TestOptions['agent']): Agent =>
  typeof agent === 'function' ? agent : commandAgent(agent ?? process.env.SKILL_RAILS_AGENT ?? DEFAULT_AGENT);

/** The index of the bracket that closes the JSON value at `start`, or -1. */
function valueEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The last JSON object or list in a text, also inside a ```json fence. */
export function lastJson(text: string): unknown {
  let found: { value: unknown } | undefined;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{' && text[i] !== '[') continue;
    const end = valueEnd(text, i);
    if (end === -1) continue;
    try {
      found = { value: JSON.parse(text.slice(i, end + 1)) };
      i = end;
    } catch {
      // Not JSON, for example `{x}` in a sentence: try the next bracket.
    }
  }
  if (!found) throw new Error('the reply holds no JSON object or list');
  return found.value;
}

const SCHEMA_LINE = 'Reply with one JSON value that matches this JSON schema, and nothing else:';

/** The prompt of a live step: what the agent of a real run would read. */
export function stepPrompt(step: PendingStep, guidance = ''): string {
  const parts: string[] = [];
  if (step.type === 'ask') parts.push('You play the user of a skill. Answer these questions as the user would:', JSON.stringify(step.questions, null, 2));
  if (step.type === 'skill') parts.push(`Load the skill "${step.skill}"${step.args ? ` with these args: ${step.args}` : ''}, and do it.`);
  if (step.instructions) parts.push(step.instructions);
  if (step.directory) parts.push(`Do the step in this folder: ${step.directory}`);
  if (guidance) parts.push(guidance);
  parts.push(`${SCHEMA_LINE}\n${JSON.stringify(step.output ?? {})}`);
  return parts.join('\n\n');
}

/** The prompt that grades a step output against a rubric. */
export function judgePrompt(id: string, rubric: string, output: unknown): string {
  return [
    `Grade the output of the step "${id}" of a skill against this rubric.`,
    `Rubric:\n${rubric}`,
    `Output (JSON):\n${JSON.stringify(output, null, 2)}`,
    `${SCHEMA_LINE}\n{"type":"object","required":["pass","reason"],"properties":{"pass":{"type":"boolean"},"reason":{"type":"string"}}}`,
  ].join('\n\n');
}

/** One run of a test. */
interface Run {
  test: TestCase;
  dir: string;
  cwd: string;
  agent: Agent;
  railsName: string;
  failures: string[];
  trace: string[];
  notes: string[];
  /** Agent mode: the stdout of the agent. */
  transcript?: string;
  /** Runs the commands, with the fixed answers of the run steps. */
  exec?: Exec;
}

function stateOf(run: Run): State | undefined {
  if (!run.railsName) return undefined;
  try {
    return readState(run.railsName, run.cwd);
  } catch {
    return undefined;
  }
}

/** Sends a step to the agent and reports its output; retries once when the output is not valid. */
function liveStep(step: PendingStep, guidance: string, run: Run): Report {
  const base = stepPrompt(step, guidance);
  let errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = run.agent(errors.length ? `${base}\n\nYour last reply was not valid: ${errors.join('; ')}` : base, run.cwd, process.env);
    let output: unknown;
    try {
      output = lastJson(reply);
    } catch (error) {
      errors = [(error as Error).message];
      continue;
    }
    const next = done({ rails: run.railsName, id: step.id, output, cwd: run.cwd, exec: run.exec });
    if (next.status !== 'invalid') return next;
    errors = next.errors;
  }
  throw new Error(`live step "${step.id}": the reply is not valid: ${errors.join('; ')}`);
}

function writeFiles(cwd: string, files: Record<string, string> = {}): void {
  for (const [rel, content] of Object.entries(files)) {
    const target = path.resolve(cwd, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

/** Drives the run with the answers of the test. Returns the last report. */
function driveRails(run: Run): Report {
  const { test, cwd, failures, trace } = run;
  const vars = { cwd, dir: run.dir };
  const answers = substitute(test.answers ?? {}, vars);
  const used = new Map<string, number>();
  const collect = (r: Report): Report => {
    if ('notes' in r && r.notes) run.notes.push(...r.notes);
    return r;
  };
  // A fixed answer of a run step replaces its command: the answer gives the outputs, or $fail the error.
  const exec: Exec = (command, options) => {
    // A nested step needs its <uses id>/<step id> key, so that a bare key stays the answer of an agent step.
    const parts = options.step?.split('/') ?? [];
    const keys = parts.length === 1 ? parts : parts.slice(0, -1).map((_, i) => parts.slice(i).join('/'));
    const key = keys.find((candidate) => candidate in answers);
    if (!key) return runCommand(command, options);
    const count = used.get(key) ?? 0;
    const given = answers[key];
    const answer = (Array.isArray(given) ? given[count] : given) as ({ $files?: Record<string, string>; $fail?: string } & Record<string, unknown>) | undefined;
    if (!answer) throw new Error(`the run ran step "${options.step}" a ${count + 1}th time, and the test has ${count} answers for it: add an answer to its list`);
    used.set(key, count + 1);
    const { $files, $fail, ...outputs } = answer;
    writeFiles(cwd, $files);
    return $fail === undefined
      ? { outcome: 'success', exitCode: 0, outputs, warnings: [], stderr: '' }
      : { outcome: 'failure', exitCode: 1, outputs, warnings: [], stderr: $fail };
  };
  run.exec = exec;
  let report: Report = collect(start({ file: path.resolve(run.dir, test.rails), inputs: substitute(test.inputs ?? {}, vars), cwd, exec }));
  run.railsName = 'status' in report && 'rails' in report ? (report as { rails: string }).rails : '';

  for (let i = 0; report.status === 'step' && i < MAX_STEPS; i++) {
    const id = report.id;
    trace.push(id);
    const key = answerKey(answers, id, run.railsName, cwd);
    const given = answers[key];
    const count = used.get(key) ?? 0;
    const answer = Array.isArray(given) ? given[count] : given;
    if (!answer) {
      failures.push(
        given
          ? `the run asked for step "${id}" a ${count + 1}th time, and the test has ${count} answers for it`
          : `the run asked for step "${id}" (${report.type}), and the test has no answer for it`,
      );
      break;
    }
    used.set(key, count + 1);
    const guidance = liveGuidance(answer);
    if (guidance !== undefined) {
      try {
        report = collect(liveStep(report, guidance, run));
      } catch (error) {
        failures.push((error as Error).message);
        break;
      }
      continue;
    }
    const { $files, $fail, ...output } = answer as { $files?: Record<string, string>; $fail?: string } & Record<string, unknown>;
    writeFiles(cwd, $files);
    const next = done({ rails: run.railsName, id, output: $fail === undefined ? (Array.isArray(answer) ? answer : output) : undefined, fail: $fail, cwd, exec });
    if (next.status === 'invalid') {
      failures.push(`the answer of step "${id}" is not valid: ${next.errors.join('; ')}`);
      break;
    }
    report = collect(next);
  }
  if (report.status === 'error') {
    // An expected error is checked with the other expectations: its errors become the message.
    if (test.expect?.status === 'error') report = { status: 'error', errors: report.errors, message: report.errors.join('\n') } as Report;
    else failures.push(`the rails file has errors: ${report.errors.join('; ')}`);
  }
  for (const [id, given] of Object.entries(answers)) {
    if (failures.length) break;
    const count = used.get(id) ?? 0;
    if (!count) failures.push(`the run never asked for step "${id}"`);
    else if (Array.isArray(given) && count < given.length) failures.push(`the run asked for step "${id}" ${count} times, and the test has ${given.length} answers for it`);
  }
  run.railsName ||= (report as { rails?: string }).rails ?? '';
  return report;
}

/** Agent mode: the agent does the request; the report comes from the saved state of the run (null when it has none). */
function driveAgent(run: Run): Report | null {
  if (!run.test.request) throw new Error('a test with mode: agent needs a request');
  run.railsName = run.test.rails ? loadRails(path.resolve(run.dir, run.test.rails), { cwd: run.cwd }).name : '';
  run.transcript = run.agent(substitute(run.test.request, { cwd: run.cwd, dir: run.dir }), run.cwd, process.env);
  const state = stateOf(run);
  if (!state) return null;
  return { status: state.status, rails: state.rails.name, message: state.message, ...(state.outputs ? { outputs: state.outputs } : {}) };
}

/** The result of `<step id>` or `<uses id>/<step id>`. */
function stepAt(steps: Record<string, StepResult>, id: string): StepResult | undefined {
  const parts = id.split('/');
  let results: Record<string, StepResult> | undefined = steps;
  for (const part of parts.slice(0, -1)) results = results?.[part]?.outputs?.steps as Record<string, StepResult> | undefined;
  return results?.[parts.at(-1) as string];
}

const contains = (expected: Matcher, text: string): boolean => (isRegex(expected) ? matches(expected, text) : text.includes(String(expected)));

function judge(run: Run, steps: Record<string, StepResult>, id: string, rubric: string): string | null {
  const result = stepAt(steps, id);
  if (!result) return `judge ${id}: the step has no result`;
  let verdict: { pass?: unknown; reason?: unknown };
  try {
    verdict = lastJson(run.agent(judgePrompt(id, rubric, result.outputs ?? null), run.cwd, process.env)) as typeof verdict;
  } catch (error) {
    return `judge ${id}: ${(error as Error).message}`;
  }
  if (typeof verdict?.pass !== 'boolean') return `judge ${id}: the reply has no boolean "pass": ${JSON.stringify(verdict)}`;
  return verdict.pass ? null : `judge ${id}: ${String(verdict.reason ?? 'no reason')}`;
}

function checkExpectations(run: Run, report: Report | null): void {
  const { failures, cwd } = run;
  const expect = run.test.expect ?? {};
  const status = report?.status ?? 'not started';
  if (expect.status && status !== expect.status) failures.push(`status: expected ${expect.status}, got ${status}`);
  const message = report && 'message' in report ? report.message : null;
  if (expect.message !== undefined && !matches(expect.message, message)) failures.push(`message: expected ${JSON.stringify(expect.message)}, got ${JSON.stringify(message)}`);
  const state = stateOf(run);
  if (expect.started !== undefined && Boolean(state) !== expect.started) failures.push(`started: expected ${expect.started}, got ${Boolean(state)}`);
  const steps = state ? rootResults(state) : {};
  for (const [id, outcome] of Object.entries(expect.steps ?? {})) {
    const actual = stepAt(steps, id)?.outcome ?? 'not reached';
    // A TypeScript rails file does not call the steps that it does not need: skipped and not reached are the same.
    const same = actual === outcome || (state?.rails.code && actual === 'not reached' && outcome === 'skipped');
    if (!same) failures.push(`step "${id}": expected ${outcome}, got ${actual}`);
  }
  for (const [key, expected] of Object.entries(expect.outputs ?? {})) {
    const [id, ...rest] = key.split('.');
    const actual = at(steps[id ?? '']?.outputs, rest.join('.'));
    if (!matches(expected, actual ?? null)) failures.push(`output ${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual ?? null)}`);
  }
  const returned = report && 'outputs' in report ? report.outputs : undefined;
  for (const [key, expected] of Object.entries(expect['rails-outputs'] ?? {})) {
    const actual = at(returned, key);
    if (!matches(expected, actual ?? null)) failures.push(`rails output ${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual ?? null)}`);
  }
  for (const expected of expect.notes ?? []) {
    if (!run.notes.some((note) => matches(expected, note))) failures.push(`notes: no note matches ${JSON.stringify(expected)} (got ${JSON.stringify(run.notes)})`);
  }
  for (const [rel, expected] of Object.entries(expect.files ?? {})) {
    const target = path.resolve(cwd, rel);
    const exists = fs.existsSync(target);
    if (expected === 'exists' || expected === 'absent') {
      if (exists !== (expected === 'exists')) failures.push(`file ${rel}: expected ${expected}`);
    } else if (!exists) failures.push(`file ${rel}: expected it to exist`);
    else if (!matches(expected, fs.readFileSync(target, 'utf8'))) failures.push(`file ${rel}: the content does not match ${JSON.stringify(expected)}`);
  }
  const transcript = run.transcript ?? '';
  for (const expected of expect.transcript?.contains ?? []) {
    if (!contains(expected, transcript)) failures.push(`transcript: does not contain ${JSON.stringify(expected)}`);
  }
  for (const expected of expect.transcript?.absent ?? []) {
    if (contains(expected, transcript)) failures.push(`transcript: contains ${JSON.stringify(expected)}`);
  }
  for (const [id, rubric] of Object.entries(expect.judge ?? {})) {
    const failure = judge(run, steps, id, rubric);
    if (failure) failures.push(failure);
  }
}

function runOnce(test: TestCase, agent: Agent): TestResult {
  const began = Date.now();
  const dir = path.dirname(path.resolve(test.file));
  const run: Run = { test, dir, cwd: '', agent, railsName: '', failures: [], trace: [], notes: [] };
  const result = (): TestResult => ({
    name: test.name, file: test.file, passed: run.failures.length === 0, failures: run.failures, trace: run.trace, ms: Date.now() - began,
    ...(run.transcript === undefined ? {} : { transcript: run.transcript }),
  });

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-rails-state-'));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-rails-run-')));
  run.cwd = cwd;
  const pathPrefix = (test.path ?? []).map((p) => path.resolve(dir, p)).join(path.delimiter);
  const env = {
    ...substitute(test.env ?? {}, { cwd, dir }),
    SKILL_RAILS_STATE_DIR: stateDir,
    ...(pathPrefix ? { PATH: `${pathPrefix}${path.delimiter}${process.env.PATH ?? ''}`, SKILL_RAILS_STUB_PATH: pathPrefix } : {}),
  };

  return withEnv(env, () => {
    try {
      prepare(test, dir, cwd);
      const report = test.mode === 'agent' ? driveAgent(run) : driveRails(run);
      if (run.failures.length === 0) checkExpectations(run, report);
    } catch (error) {
      run.failures.push((error as Error).message);
    }
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    return result();
  });
}

/** Runs a test; a test that needs a real agent is skipped without `live`. With `judge-runs`, every run must pass. */
export function runTest(test: TestCase, options: TestOptions = {}): TestResult {
  if (needsAgent(test) && !options.live) return { name: test.name, file: test.file, passed: true, skipped: true, failures: [], trace: [], ms: 0 };
  const agent = agentOf(options.agent);
  const runs = Math.max(1, test['judge-runs'] ?? 1);
  let passed = 0;
  let failed: TestResult | undefined;
  let last: TestResult | undefined;
  for (let i = 0; i < runs; i++) {
    last = runOnce(test, agent);
    if (last.passed) passed++;
    else failed ??= last;
  }
  if (!failed) return last as TestResult;
  return runs > 1 ? { ...failed, failures: [...failed.failures, `passed ${passed} of ${runs} runs`] } : failed;
}

/** Runs the tests of the given files and folders. */
export function runTests(targets: string[], options: TestOptions = {}): TestResult[] {
  return findTests(targets).flatMap((file) => {
    try {
      return loadTests(file).map((test) => runTest(test, options));
    } catch (error) {
      return [{ name: path.basename(file), file, passed: false, failures: [(error as Error).message], trace: [], ms: 0 }];
    }
  });
}
