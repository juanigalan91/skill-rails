import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { check, done, start, status } from '../src/api.js';
import type { Report } from '../src/types.js';
import { tempDir } from './helpers.js';

type StepReport = Extract<Report, { status: 'step' }>;

let dir: string;
const run = (files: Record<string, string>, inputs: Record<string, unknown> = {}) => {
  dir = tempDir(files);
  return start({ file: path.join(dir, 'flow.yaml'), cwd: dir, inputs });
};
const answer = (flow: string, id: string, output?: unknown) => done({ flow, id, output, cwd: dir });

beforeEach(() => {
  process.env.SKILL_RAILS_STATE_DIR = tempDir();
});

describe('foreach', () => {
  const FLOW = `
name: loop
steps:
  - id: list
    run: echo 'items=["a","b"]' >> "$FLOW_OUTPUT"
  - id: each
    foreach: \${{ fromJSON(steps.list.outputs.items) }}
    steps:
      - id: note
        run: echo "seen=\${ITEM}-\${POS}" >> "$FLOW_OUTPUT"
        env: { ITEM: '\${{ item }}', POS: '\${{ loop.index }}' }
      - id: ok
        prompt: 'Accept \${{ item }} (\${{ steps.note.outputs.seen }})?'
        output: { type: object, required: [ok], properties: { ok: { type: boolean } } }
  - stop: '\${{ steps.each.outputs.count }} items, last ok \${{ steps.each.outputs.results[1].steps.ok.outputs.ok }}'
`;

  it('runs the steps once per item, with item and loop.index, and keeps the results', () => {
    expect(run({ 'flow.yaml': FLOW })).toMatchObject({ id: 'ok', instructions: 'Accept a (a-0)?' });
    expect(answer('loop', 'ok', { ok: true })).toMatchObject({ id: 'ok', instructions: 'Accept b (b-1)?' });
    expect(answer('loop', 'ok', { ok: false })).toMatchObject({ status: 'done', message: '2 items, last ok false' });
  });

  it('skips an empty list', () => {
    const flow = "name: empty\nsteps:\n  - id: each\n    foreach: []\n    steps:\n      - id: x\n        prompt: never\n  - stop: '${{ steps.each.outputs.count }}'\n";
    expect(run({ 'flow.yaml': flow })).toMatchObject({ status: 'done', message: '0' });
  });

  it('fails when the value is not a list', () => {
    const flow = "name: bad\nsteps:\n  - id: each\n    foreach: '${{ 3 }}'\n    steps:\n      - stop: x\n";
    expect(run({ 'flow.yaml': flow })).toMatchObject({ status: 'failed', message: 'Step "each": foreach needs a list, and got 3.' });
  });

  it('ends the whole flow on a stop inside the loop', () => {
    const flow = "name: early\nsteps:\n  - id: each\n    foreach: [1, 2, 3]\n    steps:\n      - if: '${{ item == 2 }}'\n        stop: 'stopped at ${{ item }}'\n  - stop: never\n";
    expect(run({ 'flow.yaml': flow })).toMatchObject({ status: 'done', message: 'stopped at 2' });
  });

  it('ends the loop on a break, and keeps the finished iterations', () => {
    const flow = "name: brk\nsteps:\n  - id: each\n    foreach: [1, 2, 3]\n    steps:\n      - id: seen\n        run: echo \"v=$V\" >> \"$FLOW_OUTPUT\"\n        env: { V: '${{ item }}' }\n      - if: '${{ item == 2 }}'\n        break: true\n  - stop: '${{ steps.each.outputs.done }} of ${{ steps.each.outputs.count }}, broken ${{ steps.each.outputs.broken }}, last ${{ steps.each.outputs.results[1].steps.seen.outputs.v }}'\n";
    expect(run({ 'flow.yaml': flow })).toMatchObject({ status: 'done', message: '2 of 3, broken true, last 2' });
  });

  it('refuses a break outside a foreach', () => {
    dir = tempDir({ 'flow.yaml': 'name: bad\nsteps:\n  - break: true\n' });
    expect(check({ file: path.join(dir, 'flow.yaml') })).toMatchObject({ status: 'error', errors: ['/steps/0: break is allowed only inside a foreach'] });
  });

  it('checks the steps inside a foreach', () => {
    const flow = "name: bad\nsteps:\n  - id: each\n    foreach: [1]\n    steps:\n      - id: x\n        run: echo ${{ item }}\n";
    dir = tempDir({ 'flow.yaml': flow });
    expect(check({ file: path.join(dir, 'flow.yaml') })).toMatchObject({ status: 'error', errors: ['/steps/0/steps/0/run must NOT be valid (run step)'] });
  });
});

describe('uses', () => {
  const CHILD = `
name: child
inputs:
  who: { type: string, required: true }
steps:
  - id: hello
    run: echo "text=hi $WHO" >> "$FLOW_OUTPUT"
    env: { WHO: '\${{ inputs.who }}' }
  - id: confirm
    prompt: Confirm \${{ steps.hello.outputs.text }}.
  - if: \${{ inputs.who == 'bad' }}
    stop: bad name
    outcome: failure
  - stop: '\${{ steps.hello.outputs.text }}'
`;
  const parent = (extra = '') => `
name: parent
steps:
  - id: greet
    uses: child/flow.yaml
    with: { who: '\${{ inputs.name }}' }${extra}
  - stop: 'child said "\${{ steps.greet.outputs.message }}" (\${{ steps.greet.outputs.status }}), saw \${{ steps.greet.outputs.steps.hello.outputs.text }}'
inputs:
  name: { type: string }
`;

  it('runs the other flow as one step, with its own inputs and steps', () => {
    expect(run({ 'flow.yaml': parent(), 'child/flow.yaml': CHILD }, { name: 'ana' })).toMatchObject({ id: 'confirm', instructions: 'Confirm hi ana.' });
    expect(answer('parent', 'confirm')).toMatchObject({ status: 'done', message: 'child said "hi ana" (done), saw hi ana' });
  });

  it('fails the parent when the other flow fails', () => {
    run({ 'flow.yaml': parent(), 'child/flow.yaml': CHILD }, { name: 'bad' });
    expect(answer('parent', 'confirm')).toMatchObject({ status: 'failed', message: 'Step "greet" failed: bad name' });
  });

  it('goes on after a failed flow with continue-on-error', () => {
    run({ 'flow.yaml': parent('\n    continue-on-error: true'), 'child/flow.yaml': CHILD }, { name: 'bad' });
    expect(answer('parent', 'confirm')).toMatchObject({ status: 'done', message: 'child said "bad name" (failed), saw hi bad' });
  });

  it('fails on a missing input of the other flow', () => {
    expect(run({ 'flow.yaml': parent(), 'child/flow.yaml': CHILD })).toMatchObject({ status: 'failed', message: /input "who" is required/ });
  });

  it('refuses flows that use each other', () => {
    dir = tempDir({ 'a/flow.yaml': 'name: a\nsteps:\n  - id: b\n    uses: ../b/flow.yaml\n', 'b/flow.yaml': 'name: b\nsteps:\n  - id: a\n    uses: ../a/flow.yaml\n' });
    const result = check({ file: path.join(dir, 'a', 'flow.yaml') });
    expect(result).toMatchObject({ status: 'error' });
    expect(JSON.stringify(result)).toContain('the flows use each other: a/flow.yaml → b/flow.yaml → a/flow.yaml');
  });
});

describe('polling', () => {
  // The command counts its runs in a file, and reports ready on the third one.
  const poll = (timeout: string) => `
name: poll
steps:
  - id: wait
    run: n=$(( $(cat count 2>/dev/null || echo 0) + 1 )); echo $n > count; echo "state=$([ $n -ge 3 ] && echo ready || echo pending)" >> "$FLOW_OUTPUT"
    until: \${{ steps.wait.outputs.state == 'ready' }}
    interval-seconds: 0.05
    timeout-minutes: ${timeout}
  - stop: 'ready after \${{ steps.wait.outputs.state }}'
`;

  it('runs the command again until the condition is true', () => {
    expect(run({ 'flow.yaml': poll('1') })).toMatchObject({ status: 'done', message: 'ready after ready' });
  });

  it('fails on the time limit', () => {
    expect(run({ 'flow.yaml': poll('0.001') })).toMatchObject({ status: 'failed', message: 'Step "wait" timed out after 0.001 minutes.' });
  });

  it('gives control back to the agent after a time slice, then goes on', () => {
    process.env.SKILL_RAILS_WAIT_SLICE_SECONDS = '0.01';
    try {
      const first = run({ 'flow.yaml': poll('1') }) as StepReport;
      expect(first).toMatchObject({ status: 'step', type: 'wait', id: 'wait' });
      let report: Report = first;
      for (let i = 0; i < 5 && report.status === 'step'; i++) report = answer('poll', 'wait');
      expect(report).toMatchObject({ status: 'done', message: 'ready after ready' });
    } finally {
      delete process.env.SKILL_RAILS_WAIT_SLICE_SECONDS;
    }
  });
});

describe('free-text questions', () => {
  const FLOW = `
name: free
steps:
  - id: intent
    ask:
      - id: what
        header: Check
        question: What must the agent check?
        free: true
  - stop: '\${{ steps.intent.outputs.what }}'
`;

  it('accepts any non-empty text', () => {
    const first = run({ 'flow.yaml': FLOW }) as StepReport;
    expect(first.questions?.[0]).toMatchObject({ free: true, options: [] });
    expect(answer('free', 'intent', { what: '' })).toMatchObject({ status: 'invalid' });
    expect(answer('free', 'intent', { what: 'No raw SQL in the API layer' })).toMatchObject({ status: 'done', message: 'No raw SQL in the API layer' });
  });

  it('keeps the status of the root flow', () => {
    run({ 'flow.yaml': FLOW });
    expect(status({ flow: 'free', cwd: dir })).toMatchObject({ status: 'step', id: 'intent' });
  });
});
