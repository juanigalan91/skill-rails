import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { check, done, record, start, trace } from '../src/api.js';
import { resolveSkillRails } from '../src/skills.js';
import { runTests } from '../src/testing.js';
import type { Report } from '../src/types.js';
import { tempDir } from './helpers.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ts-rails');
type Step = Report & { id: string; instructions: string; notes?: string[] };

beforeEach(() => {
  process.env.SKILL_RAILS_STATE_DIR = tempDir();
});

const code = (body: string, extra: Record<string, string> = {}) =>
  tempDir({ 'rails.ts': `import { defineRails } from 'skill-rails';\nexport default defineRails(${body});\n`, ...extra });

describe('rails.ts', () => {
  it('skips an empty conditional question group and replays it before later steps', () => {
    const dir = code(`{ name: 'conditional', run({ ask, prompt }) {
      const answers = ask('optional', { push: false, note: undefined });
      prompt('write', 'Write a title.');
      return 'answers: ' + Object.keys(answers).length;
    } }`);
    expect(start({ file: path.join(dir, 'rails.ts'), cwd: dir })).toMatchObject({ status: 'step', id: 'write' });
    expect(done({ rails: 'conditional', id: 'write', cwd: dir, output: {} })).toMatchObject({ status: 'done', message: 'answers: 0' });
  });

  it('replays the run function: each call returns the saved results, and stops at the next agent step', () => {
    const cwd = tempDir();
    const first = start({ file: path.join(fixture, 'rails.ts'), cwd, inputs: { target: 'dev' } }) as Step;
    expect(first).toMatchObject({ status: 'step', rails: 'typed', id: 'decide', output: { required: ['kind', 'note'] } });
    expect(first.instructions).toBe('Decide what to do with the branch.\n\nValues:\n\n```yaml\nbranch: dev\n```');
    expect(done({ rails: 'typed', id: 'decide', cwd, output: { kind: 'fix', note: 'n' } })).toMatchObject({ id: 'fix-1', instructions: 'Fix part 1 of dev.' });
    expect(done({ rails: 'typed', id: 'fix-1', cwd, output: { file: 'a.ts' } })).toMatchObject({ id: 'fix-2' });
    const ask = done({ rails: 'typed', id: 'fix-2', cwd, output: { file: 'b.ts' } }) as Step;
    expect(ask).toMatchObject({ type: 'ask', id: 'push', notes: ['fixed a.ts, b.ts'], questions: [{ id: 'answer', header: 'push', question: 'Push the branch?' }] });
    expect(done({ rails: 'typed', id: 'push', cwd, output: { answer: 'Yes' } })).toMatchObject({ status: 'done', message: 'pushed dev', outputs: { files: ['a.ts', 'b.ts'] } });
    expect(record({ rails: 'typed', cwd })).toMatchObject({
      answers: { decide: { kind: 'fix', note: 'n' }, 'fix-1': { file: 'a.ts' }, 'fix-2': { file: 'b.ts' }, push: { answer: 'Yes' } },
      expect: { status: 'done', message: 'pushed dev', steps: { 'sh-1': 'success', decide: 'success', push: 'success' } },
    });
    expect(trace({ rails: 'typed', cwd }).map((line) => line.id)).toEqual(['decide', 'fix-1', 'fix-2', 'push']);
  });

  it('quotes the values of a sh template, and runs each command once', () => {
    const dir = code(`{ name: 'sh', run({ sh, prompt }) {
      const count = sh\`echo x >> runs.txt; printf '%s' \${'$(touch hacked)'}\`;
      prompt('wait', 'Wait.');
      return sh('wc -l < runs.txt') + ' ' + count;
    } }`);
    expect(start({ file: path.join(dir, 'rails.ts'), cwd: dir })).toMatchObject({ id: 'wait' });
    expect(done({ rails: 'sh', id: 'wait', cwd: dir, output: {} })).toMatchObject({ status: 'done', message: '1 $(touch hacked)' });
    expect(fs.existsSync(path.join(dir, 'hacked'))).toBe(false);
  });

  it('throws a failed command or a --fail in run, where code can catch it', () => {
    const dir = code(`{ name: 'fails', run({ sh, prompt }) {
      try { sh('echo boom >&2; exit 3'); } catch (error) { if (error.exitCode !== 3) throw error; }
      try { prompt('review', 'Review.'); } catch (error) { return 'no review: ' + error.message; }
      return 'reviewed';
    } }`);
    expect(start({ file: path.join(dir, 'rails.ts'), cwd: dir })).toMatchObject({ id: 'review' });
    expect(done({ rails: 'fails', id: 'review', cwd: dir, fail: 'no access' })).toMatchObject({ status: 'done', message: 'no review: no access' });
  });

  it('fails the run on an uncaught error, a fail result or a duplicate id', () => {
    expect(start({ file: path.join(code(`{ name: 'a', run() { throw new Error('bad input'); } }`), 'rails.ts') })).toMatchObject({ status: 'failed', message: 'bad input' });
    expect(start({ file: path.join(code(`{ name: 'b', run() { return { fail: 'no ticket' }; } }`), 'rails.ts') })).toMatchObject({ status: 'failed', message: 'no ticket' });
    const twice = code(`{ name: 'c', run({ prompt }) { try { prompt('x', 'A.'); } catch {} prompt('x', 'B.'); } }`);
    expect(start({ file: path.join(twice, 'rails.ts'), cwd: twice })).toMatchObject({ status: 'step', id: 'x' });
  });

  it('stops at the pending step even when run catches everything', () => {
    const dir = code(`{ name: 'greedy', run({ prompt, sh }) {
      try { prompt('one', 'One.'); } catch {}
      try { sh('touch after.txt'); } catch {}
      return 'ended';
    } }`);
    expect(start({ file: path.join(dir, 'rails.ts'), cwd: dir })).toMatchObject({ status: 'step', id: 'one' });
    expect(fs.existsSync(path.join(dir, 'after.txt'))).toBe(false);
  });

  it('fails when a replay takes another path', () => {
    const dir = code(`{ name: 'random', run({ prompt, dir }) {
      const fs = require('node:fs');
      const first = !fs.existsSync(dir + '/flag');
      fs.writeFileSync(dir + '/flag', '');
      prompt(first ? 'a' : 'b', 'Go.');
    } }`);
    expect(start({ file: path.join(dir, 'rails.ts'), cwd: dir })).toMatchObject({ id: 'a' });
    expect(done({ rails: 'random', id: 'a', cwd: dir, output: {} })).toMatchObject({ status: 'failed' });
  });

  it('checks the name and the inputs, and refuses a file with no run function', () => {
    expect(check({ file: path.join(fixture, 'rails.ts') })).toEqual({ status: 'ok', rails: 'typed' });
    expect(check({ file: path.join(code(`{ name: 'Bad Name', run() {} }`), 'rails.ts') })).toMatchObject({ status: 'error' });
    expect(check({ file: path.join(tempDir({ 'rails.ts': "export default { name: 'x', steps: [] };\n" }), 'rails.ts') })).toMatchObject({
      status: 'error',
      errors: [expect.stringContaining('must export default defineRails')],
    });
  });

  it('runs fixed-answer tests and finds the rails.ts of a skill', () => {
    const dir = tempDir({
      'rails.ts': fs.readFileSync(path.join(fixture, 'rails.ts'), 'utf8').replace('../../src/define.js', 'skill-rails'),
      'prompts/decide.md': 'Decide.',
      'tests/typed.test.yaml': `rails: ../rails.ts
tests:
  - name: skip
    answers: { decide: { kind: skip, note: n } }
    expect: { status: done, message: skipped main }
  - name: push
    inputs: { target: dev }
    answers: { decide: { kind: fix, note: n }, fix-1: { file: a }, fix-2: { file: b }, push: { answer: 'No' } }
    expect: { status: done, message: not pushed, rails-outputs: { files: [a, b] } }
`,
    });
    expect(runTests([dir]).map((r) => [r.name, r.passed, r.failures])).toEqual([['skip', true, []], ['push', true, []]]);
    const root = tempDir({ 'acme/skills/typed/rails.ts': 'x' });
    expect(resolveSkillRails('acme:typed', root, { env: { SKILL_RAILS_SKILLS_PATH: root } })).toBe(path.join(root, 'acme/skills/typed/rails.ts'));
  });

  it('runs a YAML or TypeScript rails file with uses, and gives its agent steps as <uses id>/<step id>', () => {
    const dir = code(
      `{ name: 'parent', run({ uses, prompt }) {
        const ctx = uses('ctx', 'child/rails.yaml', { who: 'dev' });
        const typed = uses('typed', 'typed/rails.ts');
        try { uses('broken', 'child/fail.yaml'); } catch (error) { prompt('report', 'Report: ' + error.message); }
        return ctx.greeting + ' ' + ctx.answer + ' ' + typed.size;
      } }`,
      {
        'child/rails.yaml': `name: child
inputs: { who: {} }
outputs: { greeting: '\${{ steps.hi.outputs.value }}', answer: '\${{ steps.ask.outputs.text }}' }
steps:
  - id: hi
    run: printf 'hi %s' "$WHO"
    env: { WHO: '\${{ inputs.who }}' }
    stdout: text
  - id: ask
    prompt: Say something.
    output: { text: string }
`,
        'child/fail.yaml': "name: fail\nsteps:\n  - fail: 'no access'\n",
        'typed/rails.ts': "import { defineRails } from 'skill-rails';\nexport default defineRails({ name: 'typed', run({ prompt }) { return { outputs: prompt('size', 'Size?', { output: { size: 'integer' } }) }; } });\n",
      },
    );
    expect(start({ file: path.join(dir, 'rails.ts'), cwd: dir })).toMatchObject({ status: 'step', id: 'ctx/ask', instructions: 'Say something.' });
    expect(done({ rails: 'parent', id: 'ctx/ask', cwd: dir, output: { text: 'yes' } })).toMatchObject({ id: 'typed/size' });
    expect(done({ rails: 'parent', id: 'typed/size', cwd: dir, output: { size: 3 } })).toMatchObject({ id: 'report', instructions: 'Report: no access' });
    expect(done({ rails: 'parent', id: 'report', cwd: dir, output: {} })).toMatchObject({ status: 'done', message: 'hi dev yes 3' });
    expect(record({ rails: 'parent', cwd: dir }).answers).toEqual({ 'ctx/ask': { text: 'yes' }, 'typed/size': { size: 3 }, report: {} });
  });

  it('gives no note from a catch while the run is stopped at a step', () => {
    const dir = code(`{ name: 'notes', run({ skill, note }) {
      try { skill('review', 'acme:review'); } catch (error) { note('no review: ' + error.message); }
      return 'end';
    } }`);
    expect(start({ file: path.join(dir, 'rails.ts'), cwd: dir })).not.toHaveProperty('notes');
    expect(done({ rails: 'notes', id: 'review', cwd: dir, fail: 'not installed' })).toMatchObject({ status: 'done', notes: ['no review: not installed'] });
  });

  it('refuses a YAML uses step that names a rails.ts', () => {
    const dir = tempDir({ 'rails.yaml': 'name: outer\nsteps:\n  - id: inner\n    uses: inner/rails.ts\n', 'inner/rails.ts': "export default { name: 'inner', run() { return 'x'; } };\n" });
    expect(check({ file: path.join(dir, 'rails.yaml') })).toMatchObject({ status: 'error', errors: [expect.stringContaining('cannot run a TypeScript rails file')] });
  });

  it('keeps the outputs, the stderr and the message of a failed step at each replay', () => {
    const dir = code(
      `{ name: 'partial', run({ sh, uses, prompt }) {
        let first = '';
        try { sh.env('echo KEY=A; echo bad >&2; exit 3'); } catch (error) { first = error.message + '|' + error.stderr + '|' + error.outputs.KEY; }
        prompt('wait', 'Wait.');
        let child = '';
        try { uses('child', 'child.yaml'); } catch (error) { child = error.message + '|' + error.outputs.left; }
        const lines = sh.jsonl('echo \\'{"a":1}\\'');
        return [first, child, lines.length, lines[0].a].join(' ; ');
      } }`,
      { 'child.yaml': "name: child\noutputs: { left: kept }\nsteps:\n  - fail: no key\n" },
    );
    expect(start({ file: path.join(dir, 'rails.ts'), cwd: dir })).toMatchObject({ id: 'wait' });
    expect(done({ rails: 'partial', id: 'wait', cwd: dir, output: {} })).toMatchObject({
      status: 'done',
      message: 'Step "sh-1" failed with exit code 3.\nbad|bad|A ; no key|kept ; 1 ; 1',
    });
  });
});
