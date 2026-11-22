import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { check, done, start, status } from '../src/api.js';
import type { Report } from '../src/types.js';
import { tempDir } from './helpers.js';

type StepReport = Extract<Report, { status: 'step' }>;

let dir: string;
const run = (files: Record<string, string>, inputs: Record<string, unknown> = {}) => {
  dir = tempDir(files);
  return start({ file: path.join(dir, 'rails.yaml'), cwd: dir, inputs });
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
    expect(run({ 'rails.yaml': FLOW })).toMatchObject({ id: 'ok', instructions: 'Accept a (a-0)?' });
    expect(answer('loop', 'ok', { ok: true })).toMatchObject({ id: 'ok', instructions: 'Accept b (b-1)?' });
    expect(answer('loop', 'ok', { ok: false })).toMatchObject({ status: 'done', message: '2 items, last ok false' });
  });

  it('skips an empty list', () => {
    const flow = "name: empty\nsteps:\n  - id: each\n    foreach: []\n    steps:\n      - id: x\n        prompt: never\n  - stop: '${{ steps.each.outputs.count }}'\n";
    expect(run({ 'rails.yaml': flow })).toMatchObject({ status: 'done', message: '0' });
  });

  it('fails when the value is not a list', () => {
    const flow = "name: bad\nsteps:\n  - id: each\n    foreach: '${{ 3 }}'\n    steps:\n      - stop: x\n";
    expect(run({ 'rails.yaml': flow })).toMatchObject({ status: 'failed', message: 'Step "each": foreach needs a list, and got 3.' });
  });

  it('ends the whole flow on a stop inside the loop', () => {
    const flow = "name: early\nsteps:\n  - id: each\n    foreach: [1, 2, 3]\n    steps:\n      - if: '${{ item == 2 }}'\n        stop: 'stopped at ${{ item }}'\n  - stop: never\n";
    expect(run({ 'rails.yaml': flow })).toMatchObject({ status: 'done', message: 'stopped at 2' });
  });

  it('ends the loop on a break, and keeps the finished iterations', () => {
    const flow = "name: brk\nsteps:\n  - id: each\n    foreach: [1, 2, 3]\n    steps:\n      - id: seen\n        run: echo \"v=$V\" >> \"$FLOW_OUTPUT\"\n        env: { V: '${{ item }}' }\n      - if: '${{ item == 2 }}'\n        break: true\n  - stop: '${{ steps.each.outputs.done }} of ${{ steps.each.outputs.count }}, broken ${{ steps.each.outputs.broken }}, last ${{ steps.each.outputs.results[1].steps.seen.outputs.v }}'\n";
    expect(run({ 'rails.yaml': flow })).toMatchObject({ status: 'done', message: '2 of 3, broken true, last 2' });
  });

  it('refuses a break outside a foreach', () => {
    dir = tempDir({ 'rails.yaml': 'name: bad\nsteps:\n  - break: true\n' });
    expect(check({ file: path.join(dir, 'rails.yaml') })).toMatchObject({ status: 'error', errors: ['/steps/0: break is allowed only inside a foreach or a repeat'] });
  });

  it('checks the steps inside a foreach', () => {
    const flow = "name: bad\nsteps:\n  - id: each\n    foreach: [1]\n    steps:\n      - id: x\n        run: echo ${{ item }}\n";
    dir = tempDir({ 'rails.yaml': flow });
    expect(check({ file: path.join(dir, 'rails.yaml') })).toMatchObject({ status: 'error', errors: ['/steps/0/steps/0/run must NOT be valid (run step)'] });
  });
});

describe('repeat', () => {
  const FLOW = `
name: again
steps:
  - id: each
    foreach: [a, b]
    steps:
      - id: choose
        repeat:
          until: \${{ steps.decide.outputs.answer != 'More' }}
        steps:
          - id: more
            if: \${{ loop.index > 0 }}
            prompt: 'More about \${{ item }} (\${{ loop.index }})'
            output: { type: object, required: [draft], properties: { draft: { type: string } } }
          - id: decide
            ask:
              - id: answer
                header: Draft
                question: 'Keep \${{ steps.more.outputs.draft || item }}?'
                options:
                  - { label: Keep, description: Keep it. }
                  - { label: More, description: Show more. }
      - id: keep
        run: echo "v=$V" >> "$FLOW_OUTPUT"
        env: { V: '\${{ steps.choose.outputs.last.more.outputs.draft || item }}/\${{ steps.choose.outputs.count }}' }
  - stop: '\${{ steps.each.outputs.results[0].steps.keep.outputs.v }} \${{ steps.each.outputs.results[1].steps.keep.outputs.v }}'
`;

  it('runs the steps again until the condition is true, inside a foreach', () => {
    expect(run({ 'rails.yaml': FLOW })).toMatchObject({ id: 'decide', questions: [{ question: 'Keep a?' }] });
    expect(answer('again', 'decide', { answer: 'More' })).toMatchObject({ id: 'more', instructions: 'More about a (1)' });
    expect(answer('again', 'more', { draft: 'a2' })).toMatchObject({ id: 'decide', questions: [{ question: 'Keep a2?' }] });
    expect(answer('again', 'decide', { answer: 'More' })).toMatchObject({ id: 'more', instructions: 'More about a (2)' });
    expect(answer('again', 'more', { draft: 'a3' })).toMatchObject({ id: 'decide', questions: [{ question: 'Keep a3?' }] });
    expect(answer('again', 'decide', { answer: 'Keep' })).toMatchObject({ id: 'decide', questions: [{ question: 'Keep b?' }] });
    expect(answer('again', 'decide', { answer: 'Keep' })).toMatchObject({ status: 'done', message: 'a3/3 b/1' });
  });

  it('ends after max-iterations, and marks the loop as exhausted', () => {
    const flow = "name: max\nsteps:\n  - id: r\n    repeat: { until: false, max-iterations: 3 }\n    steps:\n      - id: n\n        run: echo \"i=$I\" >> \"$FLOW_OUTPUT\"\n        env: { I: '${{ loop.index }}' }\n  - stop: '${{ steps.r.outputs.count }} ${{ steps.r.outputs.exhausted }} ${{ steps.r.outputs.last.n.outputs.i }} ${{ steps.r.outputs.results[0].steps.n.outputs.i }}'\n";
    expect(run({ 'rails.yaml': flow })).toMatchObject({ status: 'done', message: '3 true 2 0' });
  });

  it('ends the loop on a break', () => {
    const flow = "name: brk\nsteps:\n  - id: r\n    repeat: { until: false }\n    steps:\n      - if: '${{ loop.index == 1 }}'\n        break: true\n  - stop: '${{ steps.r.outputs.count }} ${{ steps.r.outputs.broken }} ${{ steps.r.outputs.exhausted }}'\n";
    expect(run({ 'rails.yaml': flow })).toMatchObject({ status: 'done', message: '2 true false' });
  });

  it('checks the repeat settings and its steps', () => {
    const flow = "name: bad\nsteps:\n  - id: r\n    repeat: { max-iterations: 0 }\n    steps:\n      - id: x\n        run: echo ${{ loop.index }}\n";
    dir = tempDir({ 'rails.yaml': flow });
    const result = check({ file: path.join(dir, 'rails.yaml') }) as { status: string; errors: string[] };
    expect(result.status).toBe('error');
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('/steps/0/repeat'),
      '/steps/0/steps/0/run must NOT be valid (run step)',
    ]));
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
    uses: child/rails.yaml
    with: { who: '\${{ inputs.name }}' }${extra}
  - stop: 'child said "\${{ steps.greet.outputs.message }}" (\${{ steps.greet.outputs.status }}), saw \${{ steps.greet.outputs.steps.hello.outputs.text }}'
inputs:
  name: { type: string }
`;

  it('runs the other flow as one step, with its own inputs and steps', () => {
    expect(run({ 'rails.yaml': parent(), 'child/rails.yaml': CHILD }, { name: 'ana' })).toMatchObject({ id: 'confirm', instructions: 'Confirm hi ana.' });
    expect(answer('parent', 'confirm')).toMatchObject({ status: 'done', message: 'child said "hi ana" (done), saw hi ana' });
  });

  it('fails the parent when the other flow fails', () => {
    run({ 'rails.yaml': parent(), 'child/rails.yaml': CHILD }, { name: 'bad' });
    expect(answer('parent', 'confirm')).toMatchObject({ status: 'failed', message: 'Step "greet" failed: bad name' });
  });

  it('goes on after a failed flow with continue-on-error', () => {
    run({ 'rails.yaml': parent('\n    continue-on-error: true'), 'child/rails.yaml': CHILD }, { name: 'bad' });
    expect(answer('parent', 'confirm')).toMatchObject({ status: 'done', message: 'child said "bad name" (failed), saw hi bad' });
  });

  it('fails on a missing input of the other flow', () => {
    expect(run({ 'rails.yaml': parent(), 'child/rails.yaml': CHILD })).toMatchObject({ status: 'failed', message: /input "who" is required/ });
  });

  it('refuses flows that use each other', () => {
    dir = tempDir({ 'a/rails.yaml': 'name: a\nsteps:\n  - id: b\n    uses: ../b/rails.yaml\n', 'b/rails.yaml': 'name: b\nsteps:\n  - id: a\n    uses: ../a/rails.yaml\n' });
    const result = check({ file: path.join(dir, 'a', 'rails.yaml') });
    expect(result).toMatchObject({ status: 'error' });
    expect(JSON.stringify(result)).toContain('the flows use each other: a/rails.yaml → b/rails.yaml → a/rails.yaml');
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
    expect(run({ 'rails.yaml': poll('1') })).toMatchObject({ status: 'done', message: 'ready after ready' });
  });

  it('fails when the next poll would exceed the time limit', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const dir = tempDir({ 'rails.yaml': poll('0.001') });
    const exec = vi.fn(() => {
      // A 20 ms check leaves less than the 50 ms interval in the 60 ms budget.
      clock.mockReturnValue(1020);
      return { outcome: 'success' as const, exitCode: 0, outputs: { state: 'pending' }, warnings: [], stderr: '' };
    });
    try {
      expect(start({ file: path.join(dir, 'rails.yaml'), cwd: dir, exec })).toMatchObject({ status: 'failed', message: 'Step "wait" timed out after 0.001 minutes.' });
      expect(exec.mock.calls).toHaveLength(1);
      expect(status({ flow: 'poll', cwd: dir })).toMatchObject({ results: { wait: { outcome: 'failure' } } });
    } finally {
      clock.mockRestore();
    }
  });

  it('persists the next poll time, refuses early polling, and resumes when due', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const exec = vi.fn(() => ({ outcome: 'success' as const, exitCode: 0, outputs: { state: 'pending' }, warnings: [], stderr: '' }));
    const dir = tempDir({ 'rails.yaml': poll('1').replace('interval-seconds: 0.05', 'interval-seconds: 30') });
    try {
      expect(start({ file: path.join(dir, 'rails.yaml'), cwd: dir, exec })).toMatchObject({ status: 'step', type: 'wait', retryAt: 31000, cwd: dir });
      expect(exec.mock.calls).toHaveLength(1);
      expect(done({ flow: 'poll', id: 'wait', cwd: dir, exec })).toMatchObject({ status: 'step', retryAt: 31000 });
      expect(exec.mock.calls).toHaveLength(1);
      clock.mockReturnValue(31000);
      exec.mockReturnValue({ outcome: 'success', exitCode: 0, outputs: { state: 'ready' }, warnings: [], stderr: '' });
      expect(done({ flow: 'poll', id: 'wait', cwd: dir, exec })).toMatchObject({ status: 'done', message: 'ready after ready' });
      expect(exec.mock.calls).toHaveLength(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('fails an expired persisted poll without running another command', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const exec = vi.fn(() => ({ outcome: 'success' as const, exitCode: 0, outputs: { state: 'pending' }, warnings: [], stderr: '' }));
    const dir = tempDir({ 'rails.yaml': poll('1').replace('interval-seconds: 0.05', 'interval-seconds: 30') });
    try {
      expect(start({ file: path.join(dir, 'rails.yaml'), cwd: dir, exec })).toMatchObject({ status: 'step', type: 'wait' });
      clock.mockReturnValue(61001);
      expect(done({ flow: 'poll', id: 'wait', cwd: dir, exec })).toMatchObject({ status: 'failed', message: 'Step "wait" timed out after 1 minutes.' });
      expect(exec.mock.calls).toHaveLength(1);
      expect(status({ flow: 'poll', cwd: dir })).toMatchObject({ results: { wait: { outcome: 'failure' } } });
    } finally {
      clock.mockRestore();
    }
  });

  it('bounds poll commands by the call slice', () => {
    const dir = tempDir({ 'rails.yaml': poll('1') });
    const exec = vi.fn((_command: string, options: import('../src/types.js').RunOptions) => {
      expect(options.timeoutMs).toBeGreaterThan(0);
      expect(options.timeoutMs).toBeLessThanOrEqual(20000);
      return { outcome: 'success' as const, exitCode: 0, outputs: { state: 'ready' }, warnings: [], stderr: '' };
    });
    expect(start({ file: path.join(dir, 'rails.yaml'), cwd: dir, exec })).toMatchObject({ status: 'done' });
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
    const first = run({ 'rails.yaml': FLOW }) as StepReport;
    expect(first.questions?.[0]).toMatchObject({ free: true, options: [] });
    expect(answer('free', 'intent', { what: '' })).toMatchObject({ status: 'invalid' });
    expect(answer('free', 'intent', { what: 'No raw SQL in the API layer' })).toMatchObject({ status: 'done', message: 'No raw SQL in the API layer' });
  });

  it('keeps the status of the root flow', () => {
    run({ 'rails.yaml': FLOW });
    expect(status({ flow: 'free', cwd: dir })).toMatchObject({ status: 'step', id: 'intent' });
  });
});
