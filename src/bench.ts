// Benchmarks: the same tests, run several times for each variant of a skill (YAML, TypeScript, plain Markdown).
// Without live, it runs the fixed-answer tests and measures the runner. With live, it runs the mode: agent tests with a real agent.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { findTests, loadTests, needsAgent, runTest, type TestCase } from './testing.js';

export interface BenchVariant {
  /** The rails file of the variant: a file name (`rails.ts`) is the file next to the rails file of each test; a path is relative to the bench file. The default is the rails file of each test. */
  rails?: string;
  /** The agent command of the variant, for live runs; the default is the agent of the bench. */
  agent?: string;
  /** A skill with no rails file (plain Markdown): only the files, transcript and judge expectations apply. */
  markdown?: boolean;
}

export interface BenchFile {
  /** Test files or folders, relative to the bench file. */
  tests: string | string[];
  runs?: number;
  variants: Record<string, BenchVariant>;
}

export interface BenchRow {
  variant: string;
  test: string;
  run: number;
  passed: boolean;
  failures: string[];
  ms: number;
  agentSteps: number;
  /** Live runs, from a JSON agent output such as `claude -p --output-format json`. */
  turns?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

const MARKDOWN_EXPECTATIONS = ['files', 'transcript', 'judge'] as const;

/** The agent metrics of a JSON transcript: Claude Code `--output-format json` fields. */
export function agentMetrics(transcript: string | undefined): Partial<BenchRow> {
  if (!transcript) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(transcript.trim());
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const data = parsed as Record<string, unknown>;
  const usage = (data.usage ?? {}) as Record<string, number | undefined>;
  const input = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((sum, key) => sum + (usage[key] ?? 0), 0);
  return {
    ...(typeof data.num_turns === 'number' ? { turns: data.num_turns } : {}),
    ...(typeof data.total_cost_usd === 'number' ? { costUsd: data.total_cost_usd } : {}),
    ...(input ? { inputTokens: input } : {}),
    ...(typeof usage.output_tokens === 'number' ? { outputTokens: usage.output_tokens } : {}),
  };
}

function variantTest(test: TestCase, variant: BenchVariant, base: string): TestCase {
  const own = path.resolve(path.dirname(path.resolve(test.file)), test.rails);
  const rails = !variant.rails ? test.rails : variant.rails.includes('/') ? path.resolve(base, variant.rails) : path.join(path.dirname(own), variant.rails);
  if (!variant.markdown) return { ...test, rails };
  const expect = Object.fromEntries(Object.entries(test.expect ?? {}).filter(([key]) => (MARKDOWN_EXPECTATIONS as readonly string[]).includes(key)));
  return { ...test, rails, expect };
}

/** Runs each test of the bench file `runs` times for each variant, in a shuffled order. */
export function bench(file: string, { live = false, runs, agent, transcripts }: { live?: boolean; runs?: number; agent?: string; transcripts?: string } = {}): BenchRow[] {
  const config = yaml.load(fs.readFileSync(file, 'utf8')) as BenchFile;
  if (!config || typeof config !== 'object' || !config.variants || typeof config.variants !== 'object' || Array.isArray(config.variants) || !Object.keys(config.variants).length) {
    throw new Error('the bench must define at least one named variant');
  }
  if (![config.tests].flat().every((target) => typeof target === 'string' && target.trim()) || ![config.tests].flat().length) {
    throw new Error('the bench tests must be a path or a non-empty list of paths');
  }
  if (Object.values(config.variants).some((variant) => !variant || typeof variant !== 'object' || Array.isArray(variant))) {
    throw new Error('each bench variant must be an object');
  }
  const count = runs ?? config.runs ?? (live ? 10 : 20);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('the bench runs must be a positive integer');
  const base = path.dirname(path.resolve(file));
  const targets = [config.tests].flat().map((target) => path.resolve(base, target));
  const tests = findTests(targets).flatMap(loadTests).filter((test) => (live ? test.mode === 'agent' : !needsAgent(test)));
  if (!tests.length) throw new Error(live ? 'the bench has no mode: agent test' : 'the bench has no fixed-answer test');
  const jobs = Object.entries(config.variants).flatMap(([name, variant]) =>
    tests.filter((test) => live || !variant.markdown).flatMap((test) => Array.from({ length: count }, (_, run) => ({ name, variant, test, run: run + 1 }))),
  );
  if (!jobs.length) throw new Error('the bench has no runnable variant; Markdown variants need --live');
  // A shuffled order spreads the effects of time and cache over the variants.
  for (let i = jobs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [jobs[i], jobs[j]] = [jobs[j]!, jobs[i]!];
  }
  return jobs.map(({ name, variant, test, run }) => {
    const result = runTest(variantTest(test, variant, base), { live, agent: variant.agent ?? agent });
    if (transcripts && result.transcript !== undefined) {
      fs.mkdirSync(transcripts, { recursive: true });
      const slug = `${name}-${test.name}-${run}`.replace(/[^A-Za-z0-9._-]+/g, '-');
      fs.writeFileSync(path.join(transcripts, `${slug}.txt`), result.transcript);
    }
    return {
      variant: name, test: test.name, run, passed: result.passed, failures: result.failures, ms: result.ms, agentSteps: result.trace.length,
      ...agentMetrics(result.transcript),
    };
  });
}

const median = (values: number[]): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** One line per variant and test: the pass rate and the medians. */
export function summary(rows: BenchRow[]): Array<Record<string, string | number>> {
  const groups = new Map<string, BenchRow[]>();
  for (const row of rows) groups.set(`${row.test}\u0000${row.variant}`, [...(groups.get(`${row.test}\u0000${row.variant}`) ?? []), row]);
  return [...groups.values()].map((group) => {
    const pick = (key: keyof BenchRow) => median(group.map((row) => row[key]).filter((value): value is number => typeof value === 'number'));
    const line: Record<string, string | number> = { test: group[0]!.test, variant: group[0]!.variant, runs: group.length, passed: `${group.filter((row) => row.passed).length}/${group.length}`, 'median ms': pick('ms')! };
    for (const [label, key] of [['median turns', 'turns'], ['median cost $', 'costUsd'], ['median input tokens', 'inputTokens'], ['median output tokens', 'outputTokens']] as const) {
      const value = pick(key);
      if (value !== undefined) line[label] = key === 'costUsd' ? Number(value.toFixed(4)) : value;
    }
    return line;
  });
}

export function toCsv(rows: BenchRow[]): string {
  const keys = ['variant', 'test', 'run', 'passed', 'ms', 'agentSteps', 'turns', 'costUsd', 'inputTokens', 'outputTokens', 'failures'] as const;
  const cell = (value: unknown) => {
    const text = Array.isArray(value) ? value.join(' | ') : value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [keys.join(','), ...rows.map((row) => keys.map((key) => cell(row[key])).join(','))].join('\n') + '\n';
}

/** The rows of a CSV file that toCsv wrote. */
export function fromCsv(text: string): BenchRow[] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') cell += text[++i];
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      record.push(cell);
      cell = '';
    } else if (char === '\n') {
      records.push([...record, cell]);
      record = [];
      cell = '';
    } else cell += char;
  }
  if (cell || record.length) records.push([...record, cell]);
  const [header = [], ...lines] = records;
  const number = (value: string | undefined) => (value === undefined || value === '' ? undefined : Number(value));
  return lines.map((line) => {
    const get = (key: string) => line[header.indexOf(key)];
    const row: BenchRow = {
      variant: get('variant') ?? '', test: get('test') ?? '', run: number(get('run')) ?? 0, passed: get('passed') === 'true',
      failures: get('failures') ? get('failures')!.split(' | ') : [], ms: number(get('ms')) ?? 0, agentSteps: number(get('agentSteps')) ?? 0,
    };
    for (const key of ['turns', 'costUsd', 'inputTokens', 'outputTokens'] as const) {
      const value = number(get(key));
      if (value !== undefined) row[key] = value;
    }
    return row;
  });
}

/**
 * The regressions against a baseline, for each test and variant in both: a lower pass rate,
 * or a median that grows more than maxIncrease percent: the turns and the cost of live runs, else the time.
 */
export function compare(rows: BenchRow[], baseline: BenchRow[], maxIncrease = 20): string[] {
  const groups = (list: BenchRow[]) => {
    const map = new Map<string, BenchRow[]>();
    for (const row of list) map.set(`${row.test} (${row.variant})`, [...(map.get(`${row.test} (${row.variant})`) ?? []), row]);
    return map;
  };
  const before = groups(baseline);
  const regressions: string[] = [];
  for (const [name, now] of groups(rows)) {
    const old = before.get(name);
    if (!old) continue;
    const rate = (list: BenchRow[]) => list.filter((row) => row.passed).length / list.length;
    if (rate(now) < rate(old)) regressions.push(`${name}: passed ${Math.round(rate(now) * 100)}% of the runs, ${Math.round(rate(old) * 100)}% before`);
    const live = now.some((row) => row.turns !== undefined) && old.some((row) => row.turns !== undefined);
    for (const key of live ? (['turns', 'costUsd'] as const) : (['ms'] as const)) {
      const pick = (list: BenchRow[]) => median(list.map((row) => row[key]).filter((value): value is number => typeof value === 'number'));
      const [a, b] = [pick(old), pick(now)];
      if (a === undefined || b === undefined || a <= 0) continue;
      const growth = ((b - a) / a) * 100;
      if (growth > maxIncrease) regressions.push(`${name}: median ${key} ${b} is ${Math.round(growth)}% more than ${a} (limit ${maxIncrease}%)`);
    }
  }
  return regressions;
}
