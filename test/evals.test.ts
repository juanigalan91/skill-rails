import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { beforeEach, describe, expect, it } from 'vitest';
import { done, record, start, trace } from '../src/api.js';
import { lastJson, loadTests, runTest, runTests, type Agent } from '../src/testing.js';
import type { Report } from '../src/types.js';
import { tempDir } from './helpers.js';

const RAILS = `
name: t
steps:
  - id: write
    prompt: Write a title.
    output: { type: object, required: [title], properties: { title: { type: string, minLength: 3 } } }
  - id: confirm
    ask:
      - id: answer
        question: 'Use "\${{ steps.write.outputs.title }}"?'
        header: Title
        options: [{ label: 'Yes', description: Use it }, { label: 'No', description: Stop }]
  - if: \${{ steps.confirm.outputs.answer == 'No' }}
    stop: Stopped.
  - stop: '\${{ steps.write.outputs.title }}'
`;

function testOf(body: string, rails = RAILS) {
  const dir = tempDir({ 'rails.yaml': rails, 'tests/t.test.yaml': `rails: ../rails.yaml\n${body}` });
  return loadTests(path.join(dir, 'tests', 't.test.yaml'))[0]!;
}

/** A fake agent: one reply per call, and the prompts it got. */
function fake(...replies: string[]): Agent & { prompts: string[] } {
  const prompts: string[] = [];
  return Object.assign((prompt: string) => {
    prompts.push(prompt);
    return replies[Math.min(prompts.length - 1, replies.length - 1)] as string;
  }, { prompts });
}

describe('live steps', () => {
  it('sends a live prompt step to the agent', () => {
    const agent = fake('Here it is:\n```json\n{"title": "Add a"}\n```');
    const result = runTest(testOf('answers:\n  write: live\n  confirm: { answer: "Yes" }\nexpect: { status: done, message: Add a }\n'), { live: true, agent });
    expect(result.failures).toEqual([]);
    expect(agent.prompts[0]).toContain('Write a title.');
    expect(agent.prompts[0]).toContain('Reply with one JSON value that matches this JSON schema, and nothing else:\n{"type":"object"');
  });

  it('retries once with the errors when the reply is not valid', () => {
    const agent = fake('{"title": "x"}', '{"title": "Add a"}');
    const result = runTest(testOf('answers:\n  write: live\n  confirm: { answer: "Yes" }\nexpect: { message: Add a }\n'), { live: true, agent });
    expect(result.failures).toEqual([]);
    expect(agent.prompts[1]).toContain('Your last reply was not valid');
  });

  it('fails when the second reply is not valid either', () => {
    const result = runTest(testOf('answers:\n  write: live\n  confirm: { answer: "Yes" }\n'), { live: true, agent: fake('no JSON here') });
    expect(result.failures).toEqual(['live step "write": the reply is not valid: the reply holds no JSON object or list']);
  });

  it('lets the agent play the user of a live ask step', () => {
    const agent = fake('{"answer": "No"}');
    const result = runTest(testOf('answers:\n  write: { title: Add a }\n  confirm: { $live: The user does not like the title. }\nexpect: { message: Stopped. }\n'), { live: true, agent });
    expect(result.failures).toEqual([]);
    expect(agent.prompts[0]).toContain('You play the user');
    expect(agent.prompts[0]).toContain('Use \\"Add a\\"?');
    expect(agent.prompts[0]).toContain('The user does not like the title.');
  });

  it('skips a test that needs an agent without live', () => {
    const agent = fake('{}');
    const result = runTest(testOf('answers:\n  write: live\n  confirm: { answer: "Yes" }\n'), { agent });
    expect(result).toMatchObject({ passed: true, skipped: true });
    expect(agent.prompts).toEqual([]);
  });

  it('does not fail a run where all tests are skipped', () => {
    const dir = tempDir({ 'rails.yaml': RAILS, 'tests/t.test.yaml': 'rails: ../rails.yaml\nmode: agent\nrequest: Do it.\n' });
    expect(runTests([dir]).every((r) => r.passed && r.skipped)).toBe(true);
  });

  it('finds the last JSON value of a reply', () => {
    expect(lastJson('Use {x} here. {"a": "}"} then [1, 2]')).toEqual([1, 2]);
    expect(lastJson('{"a": {"b": 1}}')).toEqual({ a: { b: 1 } });
  });
});

describe('judge', () => {
  const body = 'answers:\n  write: { title: Add a }\n  confirm: { answer: "Yes" }\nexpect:\n  judge: { write: The title names the change. }\n';

  it('passes when the agent grades the output as a pass', () => {
    const agent = fake('{"pass": true, "reason": "ok"}');
    expect(runTest(testOf(body), { live: true, agent }).failures).toEqual([]);
    expect(agent.prompts[0]).toContain('The title names the change.');
    expect(agent.prompts[0]).toContain('"title": "Add a"');
  });

  it('fails with the reason of the agent', () => {
    expect(runTest(testOf(body), { live: true, agent: fake('{"pass": false, "reason": "too vague"}') }).failures).toEqual(['judge write: too vague']);
  });

  it('runs the test judge-runs times, and every run must pass', () => {
    const agent = fake('{"pass": true, "reason": "ok"}', '{"pass": false, "reason": "too vague"}', '{"pass": true, "reason": "ok"}');
    const result = runTest(testOf(`judge-runs: 3\n${body}`), { live: true, agent });
    expect(agent.prompts).toHaveLength(3);
    expect(result.failures).toEqual(['judge write: too vague', 'passed 2 of 3 runs']);
  });
});

describe('agent mode', () => {
  const SIMPLE = 'name: simple\nsteps:\n  - id: write\n    prompt: Write a title.\n    output: { type: object, properties: { title: { type: string } } }\n  - stop: Done.\n';

  /** A fake agent that runs the skill through the API, as a real agent runs the CLI. */
  const runner: Agent = (prompt, cwd) => {
    const file = /run (\S+)/.exec(prompt)?.[1] as string;
    let report: Report = start({ file, cwd });
    while (report.status === 'step') report = done({ rails: report.rails, id: report.id, output: { title: 'x' }, cwd });
    return `I ran the skill. Finished: ${(report as { message: string }).message}`;
  };

  it('checks the saved state and the transcript', () => {
    const test = testOf(
      `mode: agent\nrequest: run {{dir}}/../rails.yaml\nexpect:\n  started: true\n  status: done\n  message: Done.\n  steps: { write: success }\n  transcript: { contains: [Finished, /ran the \\w+/], absent: ['"status":'] }\n`,
      SIMPLE,
    );
    expect(runTest(test, { live: true, agent: runner }).failures).toEqual([]);
  });

  it('reports a run that the agent did not start', () => {
    const test = testOf('mode: agent\nrequest: hello\nexpect:\n  started: true\n  transcript: { contains: [Finished] }\n', SIMPLE);
    expect(runTest(test, { live: true, agent: () => 'Hello!' }).failures).toEqual(['started: expected true, got false', 'transcript: does not contain "Finished"']);
    const negative = testOf('mode: agent\nrequest: hello\nexpect: { started: false }\n', SIMPLE);
    expect(runTest(negative, { live: true, agent: () => 'Hello!' }).failures).toEqual([]);
  });
});

describe('record and trace', () => {
  const MAIN = `
name: main
inputs:
  topic: { type: string, default: docs }
steps:
  - id: list
    run: echo 'items=["a","b"]' >> "$RAILS_OUTPUT"
  - id: each
    foreach: \${{ fromJSON(steps.list.outputs.items) }}
    steps:
      - id: decide
        prompt: Decide about \${{ item }}.
        output: { type: object, properties: { fix: { type: boolean } } }
  - id: sub
    uses: sub.yaml
  - id: pick
    ask:
      - id: answer
        question: Ship it?
        header: Ship
        options: [{ label: 'Yes', description: Ship, value: true }, { label: 'No', description: Stop, value: false }]
  - stop: Shipped.
`;
  const SUB = 'name: sub\nsteps:\n  - id: decide\n    prompt: Decide again.\n    output: { type: object }\n';
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    dir = tempDir({ 'rails/rails.yaml': MAIN, 'rails/sub.yaml': SUB });
    cwd = tempDir();
    process.env.SKILL_RAILS_STATE_DIR = tempDir();
    let report: Report = start({ file: path.join(dir, 'rails', 'rails.yaml'), cwd, inputs: { topic: 'api' } });
    const outputs = [{ fix: true }, { fix: false }, { note: 'ok' }, { answer: 'Yes' }];
    for (const output of outputs) report = done({ rails: 'main', id: (report as { id: string }).id, output, cwd });
    expect(report).toMatchObject({ status: 'done', message: 'Shipped.' });
  });

  it('records a run as a test that passes', () => {
    const out = path.join(dir, 'rails', 'tests', 'main.test.yaml');
    const test = record({ rails: 'main', cwd, out });
    expect(test).toEqual({
      rails: '../rails.yaml',
      inputs: { topic: 'api' },
      answers: { decide: [{ fix: true }, { fix: false }], 'sub/decide': { note: 'ok' }, pick: { answer: 'Yes' } },
      expect: { status: 'done', message: 'Shipped.', steps: { list: 'success', each: 'success', sub: 'success', pick: 'success' } },
    });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, yaml.dump(test));
    expect(runTest(loadTests(out)[0]!).failures).toEqual([]);
  });

  it('prints one trace line per agent step', () => {
    const lines = trace({ rails: 'main', cwd });
    expect(lines.map((line) => line.path)).toEqual(['decide', 'decide', 'sub/decide', 'pick']);
    expect(lines[0]).toMatchObject({ rails: 'main', id: 'decide', request: { type: 'prompt', instructions: 'Decide about a.' }, answer: { fix: true }, outcome: 'success' });
    expect(lines[3]).toMatchObject({ request: { type: 'ask' }, answer: { answer: 'Yes' } });
  });
});

describe('recording interrupted loops', () => {
  it.each(['foreach', 'repeat'])('preserves failed %s iterations and replays the recording', (kind) => {
    const loop = kind === 'foreach' ? 'foreach: [a, b]' : 'repeat: { until: false, max-iterations: 3 }';
    const dir = tempDir({ 'rails.yaml': `name: interrupted\nsteps:\n  - id: loop\n    ${loop}\n    steps:\n      - id: answer\n        prompt: Answer.\n` });
    process.env.SKILL_RAILS_STATE_DIR = tempDir();
    start({ file: path.join(dir, 'rails.yaml'), cwd: dir });
    done({ rails: 'interrupted', id: 'answer', output: { ok: true }, cwd: dir });
    expect(done({ rails: 'interrupted', id: 'answer', fail: 'Cannot complete.', cwd: dir })).toMatchObject({ status: 'failed' });
    expect(trace({ rails: 'interrupted', cwd: dir }).map((line) => line.answer)).toEqual([{ ok: true }, { $fail: 'Cannot complete.' }]);
    const out = path.join(dir, 'replay.test.yaml');
    fs.writeFileSync(out, yaml.dump(record({ rails: 'interrupted', cwd: dir, out })));
    expect(runTest(loadTests(out)[0]!).failures).toEqual([]);
  });

  it('preserves a loop iteration ended by a stop', () => {
    const dir = tempDir({ 'rails.yaml': 'name: stopped\nsteps:\n  - id: loop\n    foreach: [a, b]\n    steps:\n      - id: answer\n        prompt: Answer.\n      - stop: Enough.\n' });
    process.env.SKILL_RAILS_STATE_DIR = tempDir();
    start({ file: path.join(dir, 'rails.yaml'), cwd: dir });
    expect(done({ rails: 'stopped', id: 'answer', output: { ok: true }, cwd: dir })).toMatchObject({ status: 'done', message: 'Enough.' });
    expect(trace({ rails: 'stopped', cwd: dir })).toHaveLength(1);
  });

  it('replays array-valued agent outputs from a recording', () => {
    const dir = tempDir({ 'rails.yaml': 'name: arrays\nsteps:\n  - id: answer\n    prompt: List titles.\n    output: { type: array, items: { type: string } }\n' });
    process.env.SKILL_RAILS_STATE_DIR = tempDir();
    start({ file: path.join(dir, 'rails.yaml'), cwd: dir });
    expect(done({ rails: 'arrays', id: 'answer', output: ['one', 'two'], cwd: dir })).toMatchObject({ status: 'done' });
    const out = path.join(dir, 'replay.test.yaml');
    fs.writeFileSync(out, yaml.dump(record({ rails: 'arrays', cwd: dir, out })));
    expect(runTest(loadTests(out)[0]!).failures).toEqual([]);
  });
});
