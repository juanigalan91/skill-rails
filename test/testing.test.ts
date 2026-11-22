import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTests, runTest, runTests } from '../src/testing.js';
import { tempDir } from './helpers.js';

const RAILS = `
name: t
steps:
  - id: info
    run: echo "count=2" >> "$RAILS_OUTPUT"; echo "::warning::look"
  - id: write
    prompt: Write notes.md.
    output: { type: object, required: [ok], properties: { ok: { type: boolean } } }
  - id: check
    run: test -f notes.md
    continue-on-error: true
  - stop: '\${{ steps.check.outcome }}'
`;

function suite(test: string): string {
  const dir = tempDir({ 'rails.yaml': RAILS, 'tests/t.test.yaml': test });
  return path.join(dir, 'tests', 't.test.yaml');
}

const run = (test: string) => {
  const [first] = loadTests(suite(test));
  return runTest(first!);
};

describe('runTest', () => {
  it('replaces a run step with its fixed answer, and a nested one only with its scoped key', () => {
    const dir = tempDir({
      'child.yaml': "name: child\noutputs: { n: '${{ steps.count.outputs.n }}' }\nsteps:\n  - id: count\n    run: exit 3\n",
      'rails.yaml': "name: t\nsteps:\n  - id: count\n    run: exit 3\n  - id: kid\n    uses: child.yaml\n  - stop: '${{ steps.count.outputs.n }} ${{ steps.kid.outputs.n }}'\n",
      'tests/t.test.yaml': 'rails: ../rails.yaml\nanswers:\n  count: { n: 1 }\n  kid/count: { n: 2 }\nexpect: { status: done, message: 1 2 }\n',
    });
    const [test] = loadTests(path.join(dir, 'tests', 't.test.yaml'));
    expect(runTest(test!)).toMatchObject({ passed: true });
  });

  it('keeps a bare agent answer from replacing a nested shell command with the same id', () => {
    const dir = tempDir({
      'child.yaml': "name: child\noutputs: { n: '${{ steps.count.outputs.n }}' }\nsteps:\n  - id: count\n    run: echo n=actual\n    stdout: env\n",
      'rails.yaml': "name: t\nsteps:\n  - id: count\n    prompt: Give a number.\n  - id: kid\n    uses: child.yaml\n  - stop: '${{ steps.count.outputs.n }} ${{ steps.kid.outputs.n }}'\n",
      'tests/t.test.yaml': 'rails: ../rails.yaml\nanswers: { count: { n: agent } }\nexpect: { status: done, message: agent actual }\n',
    });
    expect(runTests([dir])).toEqual([expect.objectContaining({ passed: true })]);
  });

  it('stubs deeply nested TypeScript shell calls and preserves overrides after agent handoffs', () => {
    const dir = tempDir({
      'rails.ts': "export default { name: 'parent', run({ uses, sh }) { const child = uses('mid', 'mid.ts'); const end = sh.with({id:'finish'}).env('exit 9'); return child.n + ' ' + end.result; } };",
      'mid.ts': "export default { name: 'mid', run({ uses, prompt }) { const child = uses('kid', 'child.yaml'); prompt('review', 'Review.'); return { outputs: child }; } };",
      'child.yaml': "name: child\noutputs: { n: '${{ steps.count.outputs.n }}' }\nsteps:\n  - id: count\n    run: exit 8\n",
      'tests/t.test.yaml': 'rails: ../rails.ts\nanswers:\n  mid/kid/count: { n: nested }\n  mid/review: {}\n  finish: { result: final, $files: { marker.txt: mocked } }\nexpect:\n  status: done\n  message: nested final\n  files: { marker.txt: mocked }\n',
    });
    expect(runTests([dir])).toEqual([expect.objectContaining({ passed: true })]);
  });

  it('uses a separate fixed shell answer for each iteration, including failure and file effects', () => {
    const dir = tempDir({
      'rails.yaml': "name: t\nsteps:\n  - id: each\n    foreach: [1, 2]\n    steps:\n      - id: call\n        run: exit 9\n        continue-on-error: true\n  - stop: '${{ steps.each.outputs.results[0].steps.call.outputs.n }} ${{ steps.each.outputs.results[1].steps.call.outcome }}'\n",
      'tests/t.test.yaml': 'rails: ../rails.yaml\nanswers:\n  call:\n    - { n: 1, $files: { marker.txt: mocked } }\n    - { $fail: blocked }\nexpect:\n  status: done\n  message: 1 failure\n  files: { marker.txt: mocked }\n',
    });
    expect(runTests([dir])).toEqual([expect.objectContaining({ passed: true })]);
  });

  it('passes when the run takes the expected path', () => {
    const result = run(`
rails: ../rails.yaml
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

  it('fails when the run asks for a step that has no answer', () => {
    expect(run('rails: ../rails.yaml\nanswers: {}\n').failures[0]).toContain('asked for step "write"');
  });

  it('fails when an answer is never used', () => {
    expect(run('rails: ../rails.yaml\nanswers:\n  write: { ok: true }\n  other: { x: 1 }\n').failures).toEqual(['the run never asked for step "other"']);
  });

  it('fails when an answer does not match the schema', () => {
    expect(run('rails: ../rails.yaml\nanswers:\n  write: { ok: yes please }\n').failures[0]).toContain('is not valid');
  });

  it('reports each expectation that fails', () => {
    const result = run(`
rails: ../rails.yaml
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
    expect(run('rails: ../rails.yaml\nanswers:\n  write: { $fail: cannot }\nexpect: { status: failed, message: cannot }\n').failures).toEqual([]);
  });

  it('gives one answer per occurrence with a list', () => {
    const dir = tempDir({
      'rails.yaml': "name: l\nsteps:\n  - id: each\n    foreach: [1, 2]\n    steps:\n      - id: q\n        prompt: 'Item ${{ item }}'\n        output: { type: object, required: [v], properties: { v: { type: number } } }\n  - stop: '${{ steps.each.outputs.results[1].steps.q.outputs.v }}'\n",
      'ok.test.yaml': 'rails: rails.yaml\nanswers:\n  q: [{ v: 10 }, { v: 20 }]\nexpect: { message: "20" }\n',
      'short.test.yaml': 'rails: rails.yaml\nanswers:\n  q: [{ v: 10 }]\n',
      'long.test.yaml': 'rails: rails.yaml\nanswers:\n  q: [{ v: 1 }, { v: 2 }, { v: 3 }]\n',
    });
    const one = (name: string) => runTest(loadTests(path.join(dir, name))[0]!).failures;
    expect(one('ok.test.yaml')).toEqual([]);
    expect(one('short.test.yaml')).toEqual(['the run asked for step "q" a 2th time, and the test has 1 answers for it']);
    expect(one('long.test.yaml')).toEqual(['the run asked for step "q" 2 times, and the test has 3 answers for it']);
  });

  it('merges the env of a test with the shared env', () => {
    const dir = tempDir({
      'rails.yaml': "name: e\nsteps:\n  - id: v\n    run: echo \"v=$A$B\" >> \"$RAILS_OUTPUT\"\n  - stop: '${{ steps.v.outputs.v }}'\n",
      't.test.yaml': 'rails: rails.yaml\nenv: { A: x, B: y }\ntests:\n  - env: { B: z }\n    expect: { message: xz }\n',
    });
    expect(runTest(loadTests(path.join(dir, 't.test.yaml'))[0]!).failures).toEqual([]);
  });

  it('runs every test of a file, with shared keys', () => {
    const file = suite('rails: ../rails.yaml\ntests:\n  - name: one\n    answers: { write: { ok: true } }\n  - name: two\n    answers: { write: { ok: false } }\n');
    expect(runTests([path.dirname(file)]).map((r) => [r.name, r.passed])).toEqual([
      ['one', true],
      ['two', true],
    ]);
  });

  it('copies a fixture and runs the setup in it', () => {
    const dir = tempDir({
      'rails.yaml': "name: f\nsteps:\n  - id: read\n    run: echo \"v=$(cat value.txt)-$(cat extra.txt)\" >> \"$RAILS_OUTPUT\"\n  - stop: '${{ steps.read.outputs.v }}'\n",
      'fixture/value.txt': 'a',
      't.test.yaml': 'rails: rails.yaml\nfixture: fixture\nsetup: echo b > extra.txt\nexpect: { message: a-b }\n',
    });
    const [test] = loadTests(path.join(dir, 't.test.yaml'));
    expect(runTest(test!).failures).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'fixture', 'extra.txt'))).toBe(false);
  });
});

describe('the expectations of 0.3', () => {
  const runRails = (rails: string, test: string, files: Record<string, string> = {}) => {
    const dir = tempDir({ 'rails.yaml': rails, 'tests/t.test.yaml': test, ...files });
    const [first] = loadTests(path.join(dir, 'tests', 't.test.yaml'));
    return runTest(first!);
  };
  const OUT = "name: o\noutputs:\n  list: ${{ steps.a.outputs.value }}\n  n: 2\nsteps:\n  - id: a\n    run: echo '[{\"k\":\"x\"}]'\n    stdout: json\n";

  it('checks the rails outputs and the longer paths of step outputs', () => {
    expect(runRails(OUT, "rails: ../rails.yaml\ngit: false\nexpect:\n  rails-outputs: { n: 2, 'list[0].k': x }\n  outputs: { 'a.value[0].k': x }\n")).toMatchObject({ passed: true });
    expect(runRails(OUT, "rails: ../rails.yaml\ngit: false\nexpect:\n  rails-outputs: { n: 3 }\n")).toMatchObject({ passed: false, failures: ['rails output n: expected 3, got 2'] });
  });

  it('gives {{dir}} and {{cwd}} to the setup', () => {
    const rails = 'name: s\nsteps:\n  - run: test -f copied.txt\n';
    const test = "rails: ../rails.yaml\ngit: false\nsetup: cp '{{dir}}/source.txt' '{{cwd}}/copied.txt'\nexpect:\n  status: done\n";
    expect(runRails(rails, test, { 'tests/source.txt': 'x' })).toMatchObject({ passed: true });
  });

  it('can expect an error of the rails file', () => {
    const rails = 'name: e\ninputs:\n  x: { required: true }\nsteps:\n  - stop: s\n';
    expect(runRails(rails, "rails: ../rails.yaml\ngit: false\nexpect:\n  status: error\n  message: '/input \"x\" is required/'\n")).toMatchObject({ passed: true });
    expect(runRails(rails, 'rails: ../rails.yaml\ngit: false\nexpect:\n  status: done\n')).toMatchObject({ passed: false });
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
      'tests/t.test.yaml': `rails: ../rails.yaml
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
