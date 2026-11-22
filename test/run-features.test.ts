import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { check, done, start } from '../src/api.js';
import { withNext } from '../src/cli.js';
import { quoteArgs, stdoutOutputs } from '../src/run.js';
import type { Report } from '../src/types.js';
import { tempDir } from './helpers.js';

const run = (files: Record<string, string>, inputs: Record<string, unknown> = {}, file = 'rails.yaml') => {
  const dir = tempDir(files);
  return start({ file: path.join(dir, file), cwd: dir, inputs });
};

beforeEach(() => {
  process.env.SKILL_RAILS_STATE_DIR = tempDir();
});

describe('run args', () => {
  it('quotes each argument, adds the items of a list, and drops the empty ones', () => {
    expect(quoteArgs(['a b', ["it's", 'c'], '', null, false, 3])).toBe(`'a b' 'it'\\''s' 'c' '3'`);
  });

  it('passes the arguments to the command, with no shell injection', () => {
    const flow = `name: args
inputs:
  name: { type: string }
  files: { type: list }
  force: { type: boolean }
steps:
  - id: show
    run: printf '%s|' >> out.txt
    args: ['\${{ inputs.name }}', "\${{ inputs.force && '--force' }}", '\${{ inputs.files }}']
  - stop: done
`;
    const result = run({ 'rails.yaml': flow }, { name: '$(touch hacked)', files: 'a.txt\nb c.txt', force: false });
    expect(result).toMatchObject({ status: 'done' });
    const dir = (result as { cwd: string }).cwd;
    expect(fs.readFileSync(path.join(dir, 'out.txt'), 'utf8')).toBe('$(touch hacked)|a.txt|b c.txt|');
    expect(fs.existsSync(path.join(dir, 'hacked'))).toBe(false);
  });
});

describe('run stdout', () => {
  it('reads text, KEY=value lines, a JSON object, a JSON value and JSON lines', () => {
    expect(stdoutOutputs('hello\n::warning::w\n', 'text')).toEqual({ value: 'hello' });
    expect(stdoutOutputs('A=1\nB=x=y\nnoise\n', 'env')).toEqual({ A: '1', B: 'x=y' });
    expect(stdoutOutputs('{"found": true, "n": 2}', 'json')).toEqual({ found: true, n: 2 });
    expect(stdoutOutputs('[1, 2]', 'json')).toEqual({ value: [1, 2] });
    expect(stdoutOutputs('{"k": 1}\n{"k": 2}\n', 'json')).toEqual({ value: [{ k: 1 }, { k: 2 }] });
    expect(stdoutOutputs('', 'json')).toEqual({ value: null });
    expect(stdoutOutputs('{"k": 1}\n', 'jsonl')).toEqual({ value: [{ k: 1 }] });
    expect(stdoutOutputs('', 'jsonl')).toEqual({ value: [] });
  });

  it('gives the outputs to the next steps, and fails a step whose stdout is not JSON', () => {
    const flow = `name: out
steps:
  - id: cfg
    run: |
      echo '{"review": {"ignore": ["*.lock"]}}'
    stdout: json
  - id: bad
    run: echo nope
    stdout: json
    continue-on-error: true
  - stop: "\${{ steps.cfg.outputs.review.ignore[0] }} \${{ steps.bad.outcome }} \${{ contains(steps.bad.error, 'not JSON') }}"
`;
    expect(run({ 'rails.yaml': flow })).toMatchObject({ status: 'done', message: '*.lock failure true' });
  });
});

describe('warnings and errors of a run step', () => {
  it('shows the WARNING: lines of stderr as notes', () => {
    const flow = "name: warn\nsteps:\n  - run: \"echo 'WARNING: stale base' >&2; echo other >&2\"\n  - stop: ok\n";
    expect(run({ 'rails.yaml': flow })).toMatchObject({ status: 'done', notes: ['stale base'] });
  });

  it('keeps the exit code and the end of stderr of a failed step', () => {
    const flow = "name: err\nsteps:\n  - id: f\n    run: \"echo 'ERROR: no token' >&2; exit 3\"\n    continue-on-error: true\n  - stop: '${{ steps.f.exitCode }} ${{ steps.f.error }}'\n";
    expect(run({ 'rails.yaml': flow })).toMatchObject({ status: 'done', message: '3 ERROR: no token' });
  });
});

describe('the scripts of the plugin', () => {
  it('puts the scripts/ folder of the plugin in PATH, after the scripts/ folder of the flow', () => {
    const result = run(
      {
        '.claude-plugin/plugin.json': '{"name": "p"}',
        'scripts/shared.sh': '#!/usr/bin/env bash\necho plugin',
        'scripts/both.sh': '#!/usr/bin/env bash\necho plugin',
        'skills/a/scripts/both.sh': '#!/usr/bin/env bash\necho flow',
        'skills/a/rails.yaml': "name: plug\nsteps:\n  - id: s\n    run: shared.sh\n    stdout: text\n  - id: b\n    run: both.sh\n    stdout: text\n  - stop: '${{ steps.s.outputs.value }} ${{ steps.b.outputs.value }}'\n",
      },
      {},
      'skills/a/rails.yaml',
    );
    expect(result).toMatchObject({ status: 'done', message: 'plugin flow' });
  });
});

describe('list inputs', () => {
  const flow = "name: lst\ninputs:\n  keys: { type: list }\nsteps:\n  - stop: \"${{ join(inputs.keys, '+') }}\"\n";
  it('reads a list, a JSON list, or lines and commas', () => {
    expect(run({ 'rails.yaml': flow }, { keys: ['A-1', 'B-2'] })).toMatchObject({ message: 'A-1+B-2' });
    expect(run({ 'rails.yaml': flow }, { keys: '["A-1","B-2"]' })).toMatchObject({ message: 'A-1+B-2' });
    expect(run({ 'rails.yaml': flow }, { keys: 'A-1, B-2\nC-3' })).toMatchObject({ message: 'A-1+B-2+C-3' });
    expect(run({ 'rails.yaml': flow })).toMatchObject({ status: 'done', message: null });
  });
});

describe('note steps', () => {
  it('shows a note and goes on; an empty note shows nothing', () => {
    const flow = "name: nt\nsteps:\n  - note: 'first'\n  - note: ''\n  - if: false\n    note: never\n  - stop: end\n";
    expect(run({ 'rails.yaml': flow })).toMatchObject({ status: 'done', message: 'end', notes: ['first'] });
  });
});

describe('flow outputs', () => {
  const CHILD = "name: child\noutputs: ${{ steps.ctx.outputs }}\nsteps:\n  - id: ctx\n    run: printf 'PR=42\\nBASE=main\\n'\n    stdout: env\n";
  it('gives the declared outputs in the done report', () => {
    expect(run({ 'rails.yaml': CHILD })).toMatchObject({ status: 'done', outputs: { PR: '42', BASE: 'main' } });
    const named = "name: named\noutputs:\n  pr: ${{ steps.ctx.outputs.PR }}\nsteps:\n  - id: ctx\n    run: echo PR=7\n    stdout: env\n";
    expect(run({ 'rails.yaml': named })).toMatchObject({ outputs: { pr: '7' } });
  });

  it('gives the declared outputs of a uses step directly', () => {
    const parent = "name: parent\nsteps:\n  - id: pr\n    uses: child/rails.yaml\n  - stop: '${{ steps.pr.outputs.PR }} ${{ steps.pr.outputs.status }}'\n";
    expect(run({ 'rails.yaml': parent, 'child/rails.yaml': CHILD })).toMatchObject({ status: 'done', message: '42 done' });
  });

  it('checks the expressions of the outputs', () => {
    const dir = tempDir({ 'rails.yaml': "name: bad\noutputs: ${{ nope.x }}\nsteps:\n  - stop: s\n" });
    expect(check({ file: path.join(dir, 'rails.yaml') })).toMatchObject({ status: 'error' });
  });
});

describe('the next command', () => {
  it('gives the command that reports a step', () => {
    const step = { status: 'step', flow: 'f', id: 'a', type: 'prompt', output: { type: 'object' }, cwd: "/tmp/it's" } as Report;
    expect(withNext(step)).toMatchObject({ next: expect.stringMatching(/^npx -y skill-rails@\d+\.\d+ done f a --cwd '\/tmp\/it'\\''s' --output - <<'JSON'\n/) });
    const wait = { status: 'step', flow: 'f', id: 'w', type: 'wait', retryAt: 1 } as Report;
    expect(withNext(wait)).toMatchObject({ next: expect.stringMatching(/done f w$/) });
    expect(withNext({ status: 'done', flow: 'f', message: null })).not.toHaveProperty('next');
  });
});

describe('dedup features', () => {
  it('adds flags from a map', () => {
    expect(quoteArgs([{ '--force': true, '--dry': false, '--base': 'main', '--label': ['a', 'b'], '--none': [], '--x': '' }, 'k'])).toBe(
      `'--force' '--base' 'main' '--label' 'a' '--label' 'b' 'k'`,
    );
  });

  it('goes on only for the listed exit codes', () => {
    const flow = (code: number) => `name: codes
steps:
  - id: a
    run: exit ${code}
    continue-on-error: [3]
  - stop: 'went on \${{ steps.a.exitCode }}'
`;
    expect(run({ 'rails.yaml': flow(3) })).toMatchObject({ status: 'done', message: 'went on 3' });
    expect(run({ 'rails.yaml': flow(1) })).toMatchObject({ status: 'failed' });
  });

  it('gives the value of the selected option, and hides the values from the agent', () => {
    const flow = `name: values
steps:
  - id: q
    ask:
      - id: answer
        header: Go
        question: Go?
        options:
          - { label: Yes — go, description: Go., value: true }
          - { label: Stop, description: Stop., value: false }
          - { label: Other, description: Other. }
  - stop: 'answer \${{ steps.q.outputs.answer }} \${{ steps.q.outputs.answer == true }}'
`;
    const first = run({ 'rails.yaml': flow }) as Report & { questions: Array<{ options: object[] }>; cwd: string };
    expect(first).toMatchObject({ status: 'step', id: 'q' });
    expect(JSON.stringify(first)).not.toContain('"value"');
    expect(done({ flow: 'values', id: 'q', output: { answer: 'Yes — go' }, cwd: first.cwd })).toMatchObject({ status: 'done', message: 'answer true true' });
  });
});

describe('agent feature requests', () => {
  const at = (r: Report) => r as Report & { cwd: string; id: string; questions?: Array<{ id: string; header: string; options: Array<{ label: string }>; other: boolean }> };

  it('forwards the stop of another flow with forward-stop', () => {
    const files = {
      'rails.yaml': `name: outer
steps:
  - id: inner
    uses: inner.yaml
    forward-stop: true
  - stop: not reached
`,
      'inner.yaml': `name: inner
steps:
  - stop: from inner
`,
    };
    expect(run(files)).toMatchObject({ status: 'done', message: 'from inner' });
  });

  it('a --fail of an agent step in another flow obeys continue-on-error', () => {
    const files = {
      'rails.yaml': `name: outer2
steps:
  - id: inner
    uses: inner.yaml
    continue-on-error: true
  - stop: 'went on \${{ steps.inner.outcome }}'
`,
      'inner.yaml': `name: inner
steps:
  - id: read
    prompt: Read it.
`,
    };
    const first = at(run(files));
    expect(done({ flow: 'outer2', id: 'read', fail: 'no access', cwd: first.cwd })).toMatchObject({ status: 'done', message: 'went on failure' });
  });

  it('a prompt step with continue-on-error goes on after --fail', () => {
    const flow = `name: optional
steps:
  - id: review
    prompt: Review.
    continue-on-error: true
  - stop: '\${{ steps.review.outcome }}: \${{ steps.review.error }}'
`;
    const first = at(run({ 'rails.yaml': flow }));
    expect(done({ flow: 'optional', id: 'review', fail: 'no skill', cwd: first.cwd })).toMatchObject({ status: 'done', message: 'failure: no skill' });
  });

  it('gives the results of the previous iteration in loop.previous', () => {
    const flow = `name: prev
steps:
  - id: loop
    repeat: { until: '\${{ steps.ask.outputs.answer == ''ok'' }}', max-iterations: 3 }
    steps:
      - id: ask
        prompt: 'Last: \${{ loop.previous.ask.outputs.answer }}'
        output: { type: object, properties: { answer: { type: string } } }
  - stop: end
`;
    const first = at(run({ 'rails.yaml': flow }));
    expect(first).toMatchObject({ instructions: 'Last: ' });
    const second = done({ flow: 'prev', id: 'ask', output: { answer: 'shorter' }, cwd: first.cwd });
    expect(second).toMatchObject({ instructions: 'Last: shorter' });
  });

  it('asks a dynamic list of questions, with extra options and other answers', () => {
    const flow = `name: dyn
steps:
  - id: draft
    prompt: Draft questions.
    output: { type: object }
  - id: answers
    ask: \${{ steps.draft.outputs.questions }}
    max: 2
    extra-options:
      - { label: Skip, description: Leave it out. }
  - stop: '\${{ steps.answers.outputs.q1 }} / \${{ steps.answers.outputs.scope }}'
`;
    const first = at(run({ 'rails.yaml': flow }));
    const questions = [
      { question: 'Which DB?', header: 'Database choice here', options: ['Postgres', 'MySQL'], other: true },
      { id: 'scope', question: 'Scope?', header: 'Scope', options: [{ label: 'All', description: 'Everything.' }] },
      { question: 'Dropped?' },
    ];
    const ask = at(done({ flow: 'dyn', id: 'draft', output: { questions }, cwd: first.cwd }));
    expect(ask.questions?.map((q) => q.id)).toEqual(['q1', 'scope']);
    expect(ask.questions?.[0]?.header).toBe('Database cho');
    expect(ask.questions?.[0]?.options.map((o) => o.label)).toEqual(['Postgres', 'MySQL', 'Skip']);
    expect(done({ flow: 'dyn', id: 'answers', output: { q1: 'SQLite', scope: 'Nope' }, cwd: first.cwd })).toMatchObject({ status: 'invalid' });
    expect(done({ flow: 'dyn', id: 'answers', output: { q1: 'SQLite', scope: 'Skip' }, cwd: first.cwd })).toMatchObject({ status: 'done', message: 'SQLite / Skip' });
  });
});

describe('part B feature requests', () => {
  it('runs on-failure steps with failure.message, and the flow still fails', () => {
    const flow = `name: onfail
steps:
  - id: work
    run: echo boom >&2; exit 2
  - stop: not reached
on-failure:
  - id: save
    run: printf '%s' "$MESSAGE" > error.txt
    env: { MESSAGE: '\${{ failure.message }}' }
`;
    const result = run({ 'rails.yaml': flow }) as Report & { cwd: string; message: string };
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.message).toMatch(/exit code 2/);
    expect(fs.readFileSync(path.join(result.cwd, 'error.txt'), 'utf8')).toMatch(/boom/);
  });

  it('runs a command and another flow in a working-directory, and gives loop.number', () => {
    const files = {
      'rails.yaml': `name: wd
steps:
  - run: mkdir -p sub/inner
  - id: here
    run: pwd
    working-directory: sub
    stdout: text
  - id: other
    uses: inner.yaml
    working-directory: sub
  - id: loop
    foreach: [a, b]
    steps:
      - id: inner
        repeat: { until: 'true', max-iterations: 1 }
        steps:
          - note: '\${{ loop.parent.number }}/\${{ loop.parent.count }}'
  - stop: '\${{ steps.here.outputs.value }}|\${{ steps.other.outputs.where }}'
`,
      'inner.yaml': `name: inner
outputs:
  where: \${{ steps.pwd.outputs.value }}
steps:
  - id: pwd
    run: pwd
    working-directory: inner
    stdout: text
`,
    };
    const result = run(files) as Report & { cwd: string; message: string; notes: string[] };
    const real = fs.realpathSync(result.cwd);
    expect(result.message).toBe(`${real}/sub|${real}/sub/inner`);
    expect(result.notes).toEqual(['1/2', '2/2']);
  });

  it('gives the directory of an agent step in another folder', () => {
    const files = {
      'rails.yaml': `name: wd2
steps:
  - id: other
    uses: inner.yaml
    working-directory: sub
`,
      'inner.yaml': `name: inner
steps:
  - id: edit
    prompt: Edit.
`,
    };
    const result = run(files) as Report & { cwd: string; directory: string };
    expect(result.directory).toBe(path.join(result.cwd, 'sub'));
    const own = run({ 'rails.yaml': 'name: wd3\nsteps:\n  - id: tidy\n    prompt: Tidy.\n    working-directory: other\n' }) as Report & { cwd: string; directory: string };
    expect(own.directory).toBe(path.join(own.cwd, 'other'));
  });
});

describe('set step', () => {
  it('computes typed values', () => {
    const flow = `name: setter
inputs:
  site: { type: string }
steps:
  - id: v
    set:
      site: \${{ inputs.site || 'home' }}
      rest: \${{ !inputs.site }}
      list: \${{ fromJSON('[1, 2]') }}
  - stop: '\${{ steps.v.outputs.site }} \${{ steps.v.outputs.rest == true }} \${{ steps.v.outputs.list[1] }}'
`;
    expect(run({ 'rails.yaml': flow })).toMatchObject({ status: 'done', message: 'home true 2' });
  });
});

describe('shorter flows', () => {
  it('expands the short output form', async () => {
    const { outputSchema } = await import('../src/compact.js');
    expect(outputSchema({ title: 'string', done: 'boolean', kind: 'fix | skip', files: ['string'], 'note?': 'string', items: [{ id: 'integer', file: 'string?' }] })).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1 },
        done: { type: 'boolean' },
        kind: { enum: ['fix', 'skip'] },
        files: { type: 'array', items: { type: 'string', minLength: 1 } },
        note: { type: 'string' },
        items: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, file: { type: 'string' } }, required: ['id'] } },
      },
      required: ['title', 'done', 'kind', 'files', 'items'],
    });
    expect(outputSchema({ type: 'object' })).toEqual({ type: 'object' });
    expect(() => outputSchema({ a: 'strin' })).toThrow(/unknown type "strin"/);
  });

  it('checks the short output of an agent step, and refuses a bad type at check time', () => {
    const flow = `name: short
steps:
  - id: plan
    prompt: Plan.
    output: { title: string, kind: fix | skip }
  - stop: '\${{ steps.plan.outputs.kind }}'
`;
    const first = run({ 'rails.yaml': flow }) as Report & { cwd: string };
    expect(done({ flow: 'short', id: 'plan', output: { title: 'x', kind: 'other' }, cwd: first.cwd })).toMatchObject({ status: 'invalid' });
    expect(done({ flow: 'short', id: 'plan', output: { title: 'x', kind: 'fix' }, cwd: first.cwd })).toMatchObject({ status: 'done', message: 'fix' });
    expect(run({ 'rails.yaml': 'name: bad\nsteps:\n  - id: p\n    prompt: P.\n    output: { a: strin }\n' })).toMatchObject({ status: 'error' });
  });

  it('refuses an input out of its enum, and fails with a fail step', () => {
    const flow = `name: en
inputs:
  command: { enum: [fetch, reply] }
  kinds: { type: list, enum: [test, lint] }
steps:
  - if: \${{ inputs.command == 'reply' }}
    fail: 'no reply'
  - stop: ok
`;
    expect(run({ 'rails.yaml': flow }, { command: 'nope' })).toMatchObject({ status: 'error' });
    expect(run({ 'rails.yaml': flow }, { kinds: 'test,build' })).toMatchObject({ status: 'error' });
    expect(run({ 'rails.yaml': flow }, { command: 'reply' })).toMatchObject({ status: 'failed', message: 'no reply' });
    expect(run({ 'rails.yaml': flow }, { command: 'fetch', kinds: 'lint' })).toMatchObject({ status: 'done' });
  });

  it('takes plain label options, and has length, split, list and where', () => {
    const flow = `name: fx
steps:
  - id: q
    ask:
      - { id: a, header: Go, question: Go?, options: [Push, Stop] }
  - stop: "\${{ steps.q.outputs.a }} \${{ length(split('a, b,,c', ',')) }} \${{ join(list('x', 'y'), '+') }} \${{ length(where(fromJSON('[{\\"ok\\":true},{\\"ok\\":false},{\\"ok\\":true}]'), 'ok')) }} \${{ length(where(fromJSON('[{\\"k\\":\\"a\\"},{\\"k\\":\\"b\\"}]'), 'k', 'b')) }}"
`;
    const first = run({ 'rails.yaml': flow }) as Report & { cwd: string; questions: Array<{ options: Array<{ label: string; description: string }> }> };
    expect(first.questions[0]?.options).toEqual([{ label: 'Push', description: '' }, { label: 'Stop', description: '' }]);
    expect(done({ flow: 'fx', id: 'q', output: { a: 'Push' }, cwd: first.cwd })).toMatchObject({ status: 'done', message: 'Push 3 x+y 2 1' });
  });
});

describe('output schema check', () => {
  it('refuses a description that YAML split at a comma', () => {
    const flow = `name: comma
steps:
  - id: plan
    prompt: Plan.
    output:
      type: object
      properties:
        title: { type: string, description: The title, in a few words }
`;
    const result = run({ 'rails.yaml': flow }) as Report & { errors: string[] };
    expect(result).toMatchObject({ status: 'error' });
    expect(result.errors.join()).toMatch(/unknown keyword.*in a few words.*quote/);
  });
});
