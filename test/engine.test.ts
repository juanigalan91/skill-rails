import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { check, done, reset, start, status } from '../src/api.js';
import { tempDir } from './helpers.js';
import type { Report } from '../src/types.js';

type StepReport = Extract<Report, { status: 'step' }>;
type InvalidReport = Extract<Report, { status: 'invalid' }>;

const RAILS = `
name: demo
inputs:
  mode: { type: string, default: interactive }
steps:
  - id: list
    run: |
      echo 'items<<EOF' >> "$RAILS_OUTPUT"
      printf 'Lint\\nTests\\n' >> "$RAILS_OUTPUT"
      echo EOF >> "$RAILS_OUTPUT"
      echo "::warning::two checks found"
  - id: pick
    if: inputs.mode == 'interactive'
    ask:
      - id: checks
        header: Checks
        question: Which checks?
        multiSelect: true
        options:
          - \${{ fromJSON('[{"label":"Lint","description":"lint"},{"label":"Tests","description":"tests"}]') }}
      - id: never
        if: false
        header: Never
        question: Hidden?
        options:
          - { label: Yes, description: y }
  - id: write
    prompt: Summarize \${{ join(steps.pick.outputs.checks, ', ') }}.
    output:
      type: object
      required: [summary]
      properties:
        summary: { type: string }
  - id: fail-gate
    if: \${{ steps.write.outputs.summary == 'bad' }}
    stop: Bad summary.
    outcome: failure
  - stop: 'Summary: \${{ steps.write.outputs.summary }}'
`;

let dir: string;
let file: string;
beforeEach(() => {
  dir = tempDir({ 'rails.yaml': RAILS });
  file = path.join(dir, 'rails.yaml');
  process.env.SKILL_RAILS_STATE_DIR = path.join(dir, 'state');
});

describe('a run', () => {
  it('runs the shell steps, gives the agent steps one at a time, and ends with the stop message', () => {
    const first = start({ file, cwd: dir }) as StepReport;
    expect(first).toMatchObject({ status: 'step', id: 'pick', type: 'ask', notes: ['two checks found'] });
    expect(first.questions?.map((q) => q.id)).toEqual(['checks']);
    expect(first.questions?.[0]?.options.map((o) => o.label)).toEqual(['Lint', 'Tests']);

    const second = done({ rails: 'demo', id: 'pick', output: { checks: ['Tests'] }, cwd: dir });
    expect(second).toMatchObject({ status: 'step', id: 'write', type: 'prompt', instructions: 'Summarize Tests.' });

    expect(done({ rails: 'demo', id: 'write', output: { summary: 'ok' }, cwd: dir })).toEqual({
      status: 'done',
      rails: 'demo',
      message: 'Summary: ok',
      cwd: dir,
    });
  });

  it('refuses an output that does not match, and keeps the step', () => {
    start({ file, cwd: dir });
    const invalid = done({ rails: 'demo', id: 'pick', output: { checks: ['Deploy'] }, cwd: dir }) as InvalidReport;
    expect(invalid.status).toBe('invalid');
    expect(invalid.errors[0]).toContain('allowed values');
    expect(status({ rails: 'demo', cwd: dir })).toMatchObject({ status: 'step', id: 'pick' });
  });

  it('refuses the output of a step that is not the current one', () => {
    start({ file, cwd: dir });
    expect((done({ rails: 'demo', id: 'write', output: { summary: 'x' }, cwd: dir }) as InvalidReport).errors[0]).toContain('the current step is "pick"');
  });

  it('skips a step whose condition is false', () => {
    expect(start({ file, cwd: dir, inputs: { mode: 'auto' } })).toMatchObject({ id: 'write', instructions: 'Summarize .' });
  });

  it('ends with failure on a failure stop and on --fail', () => {
    start({ file, cwd: dir, inputs: { mode: 'auto' } });
    expect(done({ rails: 'demo', id: 'write', output: { summary: 'bad' }, cwd: dir })).toMatchObject({ status: 'failed', message: 'Bad summary.' });
    start({ file, cwd: dir });
    expect(done({ rails: 'demo', id: 'pick', fail: 'The user left.', cwd: dir })).toMatchObject({ status: 'failed', message: 'The user left.' });
  });

  it('ends with failure when a run step fails, with its stderr', () => {
    const failing = tempDir({ 'rails.yaml': 'name: broken\nsteps:\n  - id: x\n    run: echo nope >&2; exit 4\n' });
    expect(start({ file: path.join(failing, 'rails.yaml'), cwd: failing })).toMatchObject({
      status: 'failed',
      message: 'Step "x" failed with exit code 4.\nnope',
    });
  });

  it('goes on after a failed run step with continue-on-error', () => {
    const rails = tempDir({
      'rails.yaml': "name: soft\nsteps:\n  - id: x\n    run: exit 1\n    continue-on-error: true\n  - stop: '${{ steps.x.outcome }}'\n",
    });
    expect(start({ file: path.join(rails, 'rails.yaml'), cwd: rails })).toMatchObject({ status: 'done', message: 'failure' });
  });

  it('refuses unknown and wrong inputs', () => {
    expect(start({ file, cwd: dir, inputs: { other: 'x' } })).toMatchObject({ status: 'error', errors: [expect.stringMatching(/^unknown input "other": the inputs are /)] });
  });

  it('resets a run', () => {
    start({ file, cwd: dir });
    reset({ rails: 'demo', cwd: dir });
    expect(status({ rails: 'demo', cwd: dir }).status).toBe('error');
  });

  it('renders the preview of an option', () => {
    const rails = tempDir({
      'rails.yaml':
        "name: preview\nsteps:\n  - id: draft\n    run: echo 'text=Hello' >> \"$RAILS_OUTPUT\"\n  - id: ok\n    ask:\n      - id: answer\n        header: Draft\n        question: Write it?\n        options:\n          - { label: Write it, description: Write the file., preview: '${{ steps.draft.outputs.text }}' }\n          - { label: Stop, description: Write nothing. }\n",
    });
    const result = start({ file: path.join(rails, 'rails.yaml'), cwd: rails }) as StepReport;
    expect(result.questions?.[0]?.options[0]).toEqual({ label: 'Write it', description: 'Write the file.', preview: 'Hello' });
  });

  it('checks a rails file without running it', () => {
    expect(check({ file })).toEqual({ status: 'ok', rails: 'demo', steps: 5 });
  });
});
