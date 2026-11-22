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
  const dir = tempDir({ 'rails.yaml': FLOW, 'tests/t.test.yaml': test });
  return path.join(dir, 'tests', 't.test.yaml');
}

const run = (test: string) => {
  const [first] = loadTests(suite(test));
  return runTest(first!);
};

describe('runTest', () => {
  it('passes when the flow takes the expected path', () => {
    const result = run(`
flow: ../rails.yaml
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
    expect(run('flow: ../rails.yaml\nanswers: {}\n').failures[0]).toContain('asked for step "write"');
  });

  it('fails when an answer is never used', () => {
    expect(run('flow: ../rails.yaml\nanswers:\n  write: { ok: true }\n  other: { x: 1 }\n').failures).toEqual(['the flow never asked for step "other"']);
  });

  it('fails when an answer does not match the schema', () => {
    expect(run('flow: ../rails.yaml\nanswers:\n  write: { ok: yes please }\n').failures[0]).toContain('is not valid');
  });

  it('reports each expectation that fails', () => {
    const result = run(`
flow: ../rails.yaml
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
    expect(run('flow: ../rails.yaml\nanswers:\n  write: { $fail: cannot }\nexpect: { status: failed, message: cannot }\n').failures).toEqual([]);
  });

  it('gives one answer per occurrence with a list', () => {
    const dir = tempDir({
      'rails.yaml': "name: l\nsteps:\n  - id: each\n    foreach: [1, 2]\n    steps:\n      - id: q\n        prompt: 'Item ${{ item }}'\n        output: { type: object, required: [v], properties: { v: { type: number } } }\n  - stop: '${{ steps.each.outputs.results[1].steps.q.outputs.v }}'\n",
      'ok.test.yaml': 'flow: rails.yaml\nanswers:\n  q: [{ v: 10 }, { v: 20 }]\nexpect: { message: "20" }\n',
      'short.test.yaml': 'flow: rails.yaml\nanswers:\n  q: [{ v: 10 }]\n',
      'long.test.yaml': 'flow: rails.yaml\nanswers:\n  q: [{ v: 1 }, { v: 2 }, { v: 3 }]\n',
    });
    const one = (name: string) => runTest(loadTests(path.join(dir, name))[0]!).failures;
    expect(one('ok.test.yaml')).toEqual([]);
    expect(one('short.test.yaml')).toEqual(['the flow asked for step "q" a 2th time, and the test has 1 answers for it']);
    expect(one('long.test.yaml')).toEqual(['the flow asked for step "q" 2 times, and the test has 3 answers for it']);
  });

  it('merges the env of a test with the shared env', () => {
    const dir = tempDir({
      'rails.yaml': "name: e\nsteps:\n  - id: v\n    run: echo \"v=$A$B\" >> \"$FLOW_OUTPUT\"\n  - stop: '${{ steps.v.outputs.v }}'\n",
      't.test.yaml': 'flow: rails.yaml\nenv: { A: x, B: y }\ntests:\n  - env: { B: z }\n    expect: { message: xz }\n',
    });
    expect(runTest(loadTests(path.join(dir, 't.test.yaml'))[0]!).failures).toEqual([]);
  });

  it('runs every test of a file, with shared keys', () => {
    const file = suite('flow: ../rails.yaml\ntests:\n  - name: one\n    answers: { write: { ok: true } }\n  - name: two\n    answers: { write: { ok: false } }\n');
    expect(runTests([path.dirname(file)]).map((r) => [r.name, r.passed])).toEqual([
      ['one', true],
      ['two', true],
    ]);
  });

  it('copies a fixture and runs the setup in it', () => {
    const dir = tempDir({
      'rails.yaml': "name: f\nsteps:\n  - id: read\n    run: echo \"v=$(cat value.txt)-$(cat extra.txt)\" >> \"$FLOW_OUTPUT\"\n  - stop: '${{ steps.read.outputs.v }}'\n",
      'fixture/value.txt': 'a',
      't.test.yaml': 'flow: rails.yaml\nfixture: fixture\nsetup: echo b > extra.txt\nexpect: { message: a-b }\n',
    });
    const [test] = loadTests(path.join(dir, 't.test.yaml'));
    expect(runTest(test!).failures).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'fixture', 'extra.txt'))).toBe(false);
  });
});

describe('the expectations of 0.3', () => {
  const runFlow = (flow: string, test: string, files: Record<string, string> = {}) => {
    const dir = tempDir({ 'rails.yaml': flow, 'tests/t.test.yaml': test, ...files });
    const [first] = loadTests(path.join(dir, 'tests', 't.test.yaml'));
    return runTest(first!);
  };
  const OUT = "name: o\noutputs:\n  list: ${{ steps.a.outputs.value }}\n  n: 2\nsteps:\n  - id: a\n    run: echo '[{\"k\":\"x\"}]'\n    stdout: json\n";

  it('checks the flow outputs and the longer paths of step outputs', () => {
    expect(runFlow(OUT, "flow: ../rails.yaml\ngit: false\nexpect:\n  flow-outputs: { n: 2, 'list[0].k': x }\n  outputs: { 'a.value[0].k': x }\n")).toMatchObject({ passed: true });
    expect(runFlow(OUT, "flow: ../rails.yaml\ngit: false\nexpect:\n  flow-outputs: { n: 3 }\n")).toMatchObject({ passed: false, failures: ['flow output n: expected 3, got 2'] });
  });

  it('gives {{dir}} and {{cwd}} to the setup', () => {
    const flow = 'name: s\nsteps:\n  - run: test -f copied.txt\n';
    const test = "flow: ../rails.yaml\ngit: false\nsetup: cp '{{dir}}/source.txt' '{{cwd}}/copied.txt'\nexpect:\n  status: done\n";
    expect(runFlow(flow, test, { 'tests/source.txt': 'x' })).toMatchObject({ passed: true });
  });

  it('can expect an error of the flow', () => {
    const flow = 'name: e\ninputs:\n  x: { required: true }\nsteps:\n  - stop: s\n';
    expect(runFlow(flow, "flow: ../rails.yaml\ngit: false\nexpect:\n  status: error\n  message: '/input \"x\" is required/'\n")).toMatchObject({ passed: true });
    expect(runFlow(flow, 'flow: ../rails.yaml\ngit: false\nexpect:\n  status: done\n')).toMatchObject({ passed: false });
  });
});

describe('runTest stubs and scoped answers', () => {
  it('puts the test path before the scripts folder, and keys answers by uses step', () => {
    const dir = tempDir({
      'rails.yaml': `name: outer
steps:
  - id: tool
    run: tool.sh
    stdout: text
  - id: a
    uses: inner.yaml
  - id: b
    uses: inner.yaml
  - stop: '\${{ steps.tool.outputs.value }} \${{ steps.a.outputs.steps.ask.outputs.v }}\${{ steps.b.outputs.steps.ask.outputs.v }}'
`,
      'inner.yaml': `name: inner
steps:
  - id: ask
    prompt: Ask.
    output: { type: object }
`,
      'scripts/tool.sh': '#!/bin/sh\necho real\n',
      'tests/stubs/tool.sh': '#!/bin/sh\necho stub\n',
      'tests/t.test.yaml': `flow: ../rails.yaml
git: false
path: [stubs]
answers:
  a/ask: { v: 1 }
  b/ask: { v: 2 }
expect:
  status: done
  message: stub 12
  steps: { a/ask: success, b/ask: success }
`,
    });
    fs.chmodSync(path.join(dir, 'scripts/tool.sh'), 0o755);
    fs.chmodSync(path.join(dir, 'tests/stubs/tool.sh'), 0o755);
    const [result] = runTests([path.join(dir, 'tests')]);
    expect(result?.failures).toEqual([]);
  });
});
