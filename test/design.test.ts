import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { check } from '../src/api.js';
import { compare, fromCsv, toCsv, type BenchRow } from '../src/bench.js';
import { runTests } from '../src/testing.js';
import { tempDir } from './helpers.js';

beforeEach(() => {
  process.env.SKILL_RAILS_STATE_DIR = tempDir();
});

const warnings = (rails: string) => {
  const report = check({ file: path.join(tempDir({ 'rails.yaml': rails }), 'rails.yaml') });
  return 'warnings' in report ? (report.warnings ?? []) : [];
};

describe('check advice', () => {
  it('advises a script for a rails file with one run step and no agent step', () => {
    expect(warnings('name: one\nsteps:\n  - run: echo hi\n')).toEqual([expect.stringContaining('no agent step and at most one run step')]);
    expect(warnings('name: two\nsteps:\n  - run: echo a\n  - run: echo b\n')).toEqual([]);
  });

  it('advises to merge two prompt steps with no condition between them', () => {
    const rails = 'name: m\nsteps:\n  - id: a\n    prompt: Read the files.\n  - id: b\n    prompt: Write the summary.\n  - id: c\n    if: ${{ inputs.x }}\n    prompt: Check it.\ninputs: { x: {} }\n';
    expect(warnings(rails)).toEqual([expect.stringContaining('steps "a" and "b"')]);
  });

  it('advises a run step for a prompt that is mostly a shell command', () => {
    const rails = 'name: s\nsteps:\n  - id: lint\n    prompt: "Run this:\\n\\n```bash\\nyarn lint\\n```\\n"\n  - run: echo done\n';
    expect(warnings(rails)).toEqual([expect.stringContaining('step "lint": the instructions are mostly a shell command')]);
  });
});

describe('bench baseline', () => {
  const row = (run: number, extra: Partial<BenchRow>): BenchRow => ({ variant: 'yaml', test: 'pr', run, passed: true, failures: [], ms: 100, agentSteps: 1, ...extra });

  it('reads the CSV that it writes', () => {
    const rows = [row(1, { turns: 8, costUsd: 0.09, failures: ['a, "b"', 'c'] })];
    expect(fromCsv(toCsv(rows))).toEqual(rows);
  });

  it('reports a lower pass rate and medians over the limit', () => {
    const before = [row(1, { turns: 8, costUsd: 0.1 }), row(2, { turns: 8, costUsd: 0.1 })];
    expect(compare([row(1, { turns: 9, costUsd: 0.11 }), row(2, { turns: 9, costUsd: 0.11 })], before)).toEqual([]);
    expect(compare([row(1, { turns: 12, costUsd: 0.1, passed: false }), row(2, { turns: 12, costUsd: 0.1 })], before)).toEqual([
      'pr (yaml): passed 50% of the runs, 100% before',
      'pr (yaml): median turns 12 is 50% more than 8 (limit 20%)',
    ]);
    expect(compare([row(1, { ms: 150 })], [row(1, {})], 60)).toEqual([]);
    expect(compare([row(1, { ms: 150 })], [row(1, {})])).toEqual(['pr (yaml): median ms 150 is 50% more than 100 (limit 20%)']);
  });
});

describe('a Markdown skill test', () => {
  it('runs a mode: agent test with no rails file, and checks the files', () => {
    const dir = tempDir({ 'tests/md.test.yaml': "mode: agent\nrequest: Greet.\nexpect: { files: { hi.txt: '/hi/' } }\n" });
    const [result] = runTests([dir], { live: true, agent: 'cat > /dev/null; echo hi > hi.txt' });
    expect(result).toMatchObject({ passed: true, failures: [] });
    const fixed = tempDir({ 'tests/md.test.yaml': 'answers: {}\n' });
    expect(runTests([fixed])[0]!.failures[0]).toContain('needs a rails key');
  });
});
