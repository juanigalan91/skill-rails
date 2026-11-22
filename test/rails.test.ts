import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RailsError, loadRails, validateRails } from '../src/rails.js';
import { tempDir } from './helpers.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const errorsOf = (rails: unknown) => validateRails(rails);

describe('validateRails', () => {
  it('accepts the examples', () => {
    for (const name of ['hello', 'open-pr']) expect(() => loadRails(path.join(root, 'examples', name, 'rails.yaml'))).not.toThrow();
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

  it('refuses an agent step with no id, and accepts plain label options', () => {
    expect(errorsOf({ name: 'x', steps: [{ prompt: 'p' }] })[0]).toContain("must have required property 'id'");
    const ask = { id: 'q', ask: [{ id: 'a', header: 'H', question: 'Q?', options: ['Yes', { label: 'No' }] }] };
    expect(errorsOf({ name: 'x', steps: [ask] })).toEqual([]);
  });

  it('refuses a step id that is used twice', () => {
    expect(errorsOf({ name: 'x', steps: [{ id: 'a', run: 'x' }, { id: 'a', run: 'y' }] })).toEqual(['step id "a" is used twice']);
  });
});

describe('loadRails', () => {
  it('reads a prompt file next to the rails file', () => {
    const dir = tempDir({ 'rails.yaml': 'name: x\nsteps:\n  - id: a\n    prompt: prompts/a.md\n', 'prompts/a.md': 'Do ${{ inputs.x }}.\n' });
    expect((loadRails(path.join(dir, 'rails.yaml')).steps[0] as { prompt?: string }).prompt).toBe('Do ${{ inputs.x }}.\n');
  });

  it('keeps a prompt with spaces or several lines as the instructions', () => {
    const dir = tempDir({ 'rails.yaml': "name: x\nsteps:\n  - id: a\n    prompt: Read notes.md\n  - id: b\n    prompt: |\n      a.md\n      b.md\n", 'notes.md': 'never read' });
    const steps = loadRails(path.join(dir, 'rails.yaml')).steps as Array<{ prompt?: string }>;
    expect(steps.map((step) => step.prompt)).toEqual(['Read notes.md', 'a.md\nb.md\n']);
  });

  it('reports a missing prompt file and a bad expression', () => {
    const dir = tempDir({ 'rails.yaml': 'name: x\nsteps:\n  - id: a\n    prompt: prompts/none.md\n  - if: nope.x\n    stop: s\n' });
    try {
      loadRails(path.join(dir, 'rails.yaml'));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RailsError);
      expect((error as RailsError).errors.join('\n')).toMatch(/cannot read prompts\/none.md[\s\S]*nope/);
    }
  });
});
