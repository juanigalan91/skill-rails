import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FlowError, loadFlow, validateFlow } from '../src/flow.js';
import { tempDir } from './helpers.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const errorsOf = (flow: unknown) => validateFlow(flow);

describe('validateFlow', () => {
  it('accepts the examples', () => {
    for (const name of ['hello', 'open-pr']) expect(() => loadFlow(path.join(root, 'examples', name, 'flow.yaml'))).not.toThrow();
  });

  it('refuses ${{ }} in a run command, with one error for that step type', () => {
    const errors = errorsOf({ name: 'x', steps: [{ run: 'echo ${{ inputs.a }}' }] });
    expect(errors).toEqual(['/steps/0/run must NOT be valid (run step)']);
  });

  it('names the step type in an error', () => {
    expect(errorsOf({ name: 'x', steps: [{ id: 'a', prompt: 'p', colour: 'red' }] })).toEqual([
      '/steps/0 must NOT have additional properties ("colour") (prompt step)',
    ]);
  });

  it('refuses a step with no type or with two types', () => {
    expect(errorsOf({ name: 'x', steps: [{ id: 'a' }] })[0]).toContain('must have exactly one of');
    expect(errorsOf({ name: 'x', steps: [{ id: 'a', run: 'x', stop: 'y' }] })[0]).toContain('must have exactly one of');
  });

  it('refuses an agent step with no id, and an option with no description', () => {
    expect(errorsOf({ name: 'x', steps: [{ prompt: 'p' }] })[0]).toContain("must have required property 'id'");
    const ask = { id: 'q', ask: [{ id: 'a', header: 'H', question: 'Q?', options: ['No'] }] };
    expect(errorsOf({ name: 'x', steps: [ask] }).join()).toContain('options/0');
  });

  it('refuses a step id that is used twice', () => {
    expect(errorsOf({ name: 'x', steps: [{ id: 'a', run: 'x' }, { id: 'a', run: 'y' }] })).toEqual(['step id "a" is used twice']);
  });
});

describe('loadFlow', () => {
  it('reads a prompt file next to the flow', () => {
    const dir = tempDir({ 'flow.yaml': 'name: x\nsteps:\n  - id: a\n    prompt-file: prompts/a.md\n', 'prompts/a.md': 'Do ${{ inputs.x }}.\n' });
    expect((loadFlow(path.join(dir, 'flow.yaml')).steps[0] as { prompt?: string }).prompt).toBe('Do ${{ inputs.x }}.\n');
  });

  it('reports a missing prompt file and a bad expression', () => {
    const dir = tempDir({ 'flow.yaml': 'name: x\nsteps:\n  - id: a\n    prompt-file: prompts/none.md\n  - if: nope.x\n    stop: s\n' });
    try {
      loadFlow(path.join(dir, 'flow.yaml'));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FlowError);
      expect((error as FlowError).errors.join('\n')).toMatch(/cannot read prompts\/none.md[\s\S]*nope/);
    }
  });
});
