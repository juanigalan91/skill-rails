import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTests, runTest, runTests } from '../src/testing.js';
import { tempDir } from './helpers.js';

const FLOW = `
name: t
steps:
  - id: info
    run: echo "count=2" >> "$FLOW_OUTPUT"; echo "::warning::look"
  - id: write
    prompt: Write notes.md.
    output: { type: object, required: [ok], properties: { ok: { type: boolean } } }
  - id: check
    run: test -f notes.md
    continue-on-error: true
  - stop: '\${{ steps.check.outcome }}'
`;

function suite(test: string): string {
  const dir = tempDir({ 'flow.yaml': FLOW, 'tests/t.test.yaml': test });
  return path.join(dir, 'tests', 't.test.yaml');
}

const run = (test: string) => {
  const [first] = loadTests(suite(test));
  return runTest(first!);
};

describe('runTest', () => {
  it('passes when the flow takes the expected path', () => {
    const result = run(`
flow: ../flow.yaml
answers:
  write: { ok: true, $files: { notes.md: hello } }
expect:
  status: done
  message: success
  steps: { info: success, check: success }
  outputs: { info.count: '2', write.ok: true }
  files: { notes.md: /hel+o/ }
  notes: [look]
`);
    expect(result.failures).toEqual([]);
    expect(result).toMatchObject({ passed: true, trace: ['write'] });
  });

  it('fails when the flow asks for a step that has no answer', () => {
    expect(run('flow: ../flow.yaml\nanswers: {}\n').failures[0]).toContain('asked for step "write"');
  });

  it('fails when an answer is never used', () => {
    expect(run('flow: ../flow.yaml\nanswers:\n  write: { ok: true }\n  other: { x: 1 }\n').failures).toEqual(['the flow never asked for step "other"']);
  });

  it('fails when an answer does not match the schema', () => {
    expect(run('flow: ../flow.yaml\nanswers:\n  write: { ok: yes please }\n').failures[0]).toContain('is not valid');
  });

  it('reports each expectation that fails', () => {
    const result = run(`
flow: ../flow.yaml
answers:
  write: { ok: true }
expect:
  message: success
  steps: { check: success }
  files: { notes.md: exists }
`);
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(['message: expected "success", got "failure"', 'step "check": expected success, got failure', 'file notes.md: expected exists']);
  });

  it('fails a step with $fail', () => {
    expect(run('flow: ../flow.yaml\nanswers:\n  write: { $fail: cannot }\nexpect: { status: failed, message: cannot }\n').failures).toEqual([]);
  });

  it('gives one answer per occurrence with a list', () => {
    const dir = tempDir({
      'flow.yaml': "name: l\nsteps:\n  - id: each\n    foreach: [1, 2]\n    steps:\n      - id: q\n        prompt: 'Item ${{ item }}'\n        output: { type: object, required: [v], properties: { v: { type: number } } }\n  - stop: '${{ steps.each.outputs.results[1].steps.q.outputs.v }}'\n",
      'ok.test.yaml': 'flow: flow.yaml\nanswers:\n  q: [{ v: 10 }, { v: 20 }]\nexpect: { message: "20" }\n',
      'short.test.yaml': 'flow: flow.yaml\nanswers:\n  q: [{ v: 10 }]\n',
      'long.test.yaml': 'flow: flow.yaml\nanswers:\n  q: [{ v: 1 }, { v: 2 }, { v: 3 }]\n',
    });
    const one = (name: string) => runTest(loadTests(path.join(dir, name))[0]!).failures;
    expect(one('ok.test.yaml')).toEqual([]);
    expect(one('short.test.yaml')).toEqual(['the flow asked for step "q" a 2th time, and the test has 1 answers for it']);
    expect(one('long.test.yaml')).toEqual(['the flow asked for step "q" 2 times, and the test has 3 answers for it']);
  });

  it('merges the env of a test with the shared env', () => {
    const dir = tempDir({
      'flow.yaml': "name: e\nsteps:\n  - id: v\n    run: echo \"v=$A$B\" >> \"$FLOW_OUTPUT\"\n  - stop: '${{ steps.v.outputs.v }}'\n",
      't.test.yaml': 'flow: flow.yaml\nenv: { A: x, B: y }\ntests:\n  - env: { B: z }\n    expect: { message: xz }\n',
    });
    expect(runTest(loadTests(path.join(dir, 't.test.yaml'))[0]!).failures).toEqual([]);
  });

  it('runs every test of a file, with shared keys', () => {
    const file = suite('flow: ../flow.yaml\ntests:\n  - name: one\n    answers: { write: { ok: true } }\n  - name: two\n    answers: { write: { ok: false } }\n');
    expect(runTests([path.dirname(file)]).map((r) => [r.name, r.passed])).toEqual([
      ['one', true],
      ['two', true],
    ]);
  });

  it('copies a fixture and runs the setup in it', () => {
    const dir = tempDir({
      'flow.yaml': "name: f\nsteps:\n  - id: read\n    run: echo \"v=$(cat value.txt)-$(cat extra.txt)\" >> \"$FLOW_OUTPUT\"\n  - stop: '${{ steps.read.outputs.v }}'\n",
      'fixture/value.txt': 'a',
      't.test.yaml': 'flow: flow.yaml\nfixture: fixture\nsetup: echo b > extra.txt\nexpect: { message: a-b }\n',
    });
    const [test] = loadTests(path.join(dir, 't.test.yaml'));
    expect(runTest(test!).failures).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'fixture', 'extra.txt'))).toBe(false);
  });
});
