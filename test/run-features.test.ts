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
    const rails = `name: args
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
    const result = run({ 'rails.yaml': rails }, { name: '$(touch hacked)', files: 'a.txt\nb c.txt', force: false });
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
    const rails = `name: out
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
    expect(run({ 'rails.yaml': rails })).toMatchObject({ status: 'done', message: '*.lock failure true' });
  });
});

describe('warnings and errors of a run step', () => {
  it('shows the WARNING: lines of stderr as notes', () => {
    const rails = "name: warn\nsteps:\n  - run: \"echo 'WARNING: stale base' >&2; echo other >&2\"\n  - stop: ok\n";
    expect(run({ 'rails.yaml': rails })).toMatchObject({ status: 'done', notes: ['stale base'] });
  });

  it('keeps the exit code and the end of stderr of a failed step', () => {
    const rails = "name: err\nsteps:\n  - id: f\n    run: \"echo 'ERROR: no token' >&2; exit 3\"\n    continue-on-error: true\n  - stop: '${{ steps.f.exitCode }} ${{ steps.f.error }}'\n";
    expect(run({ 'rails.yaml': rails })).toMatchObject({ status: 'done', message: '3 ERROR: no token' });
  });
});

describe('the scripts of the plugin', () => {
  it('puts the scripts/ folder of the plugin in PATH, after the scripts/ folder of the rails file', () => {
    const result = run(
      {
        '.claude-plugin/plugin.json': '{"name": "p"}',
        'scripts/shared.sh': '#!/usr/bin/env bash\necho plugin',
        'scripts/both.sh': '#!/usr/bin/env bash\necho plugin',
        'skills/a/scripts/both.sh': '#!/usr/bin/env bash\necho rails',
        'skills/a/rails.yaml': "name: plug\nsteps:\n  - id: s\n    run: shared.sh\n    stdout: text\n  - id: b\n    run: both.sh\n    stdout: text\n  - stop: '${{ steps.s.outputs.value }} ${{ steps.b.outputs.value }}'\n",
      },
      {},
      'skills/a/rails.yaml',
    );
    expect(result).toMatchObject({ status: 'done', message: 'plugin rails' });
  });
});

describe('list inputs', () => {
  const rails = "name: lst\ninputs:\n  keys: { type: list }\nsteps:\n  - stop: \"${{ join(inputs.keys, '+') }}\"\n";
  it('reads a list, a JSON list, or lines and commas', () => {
    expect(run({ 'rails.yaml': rails }, { keys: ['A-1', 'B-2'] })).toMatchObject({ message: 'A-1+B-2' });
    expect(run({ 'rails.yaml': rails }, { keys: '["A-1","B-2"]' })).toMatchObject({ message: 'A-1+B-2' });
    expect(run({ 'rails.yaml': rails }, { keys: 'A-1, B-2\nC-3' })).toMatchObject({ message: 'A-1+B-2+C-3' });
    expect(run({ 'rails.yaml': rails })).toMatchObject({ status: 'done', message: null });
  });
});

describe('note steps', () => {
  it('shows a note and goes on; an empty note shows nothing', () => {
    const rails = "name: nt\nsteps:\n  - note: 'first'\n  - note: ''\n  - if: false\n    note: never\n  - stop: end\n";
    expect(run({ 'rails.yaml': rails })).toMatchObject({ status: 'done', message: 'end', notes: ['first'] });
  });
});

describe('rails outputs', () => {
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
    const step = { status: 'step', rails: 'f', id: 'a', type: 'prompt', output: { type: 'object' }, cwd: "/tmp/it's" } as Report;
    expect(withNext(step)).toMatchObject({ next: expect.stringMatching(/^npx -y skill-rails@\d+\.\d+ done f a --cwd '\/tmp\/it'\\''s' --output - <<'JSON'\n/) });
    const wait = { status: 'step', rails: 'f', id: 'w', type: 'wait', retryAt: 1 } as Report;
    expect(withNext(wait)).toMatchObject({ next: expect.stringMatching(/done f w$/) });
    expect(withNext({ status: 'done', rails: 'f', message: null })).not.toHaveProperty('next');
  });
});

describe('dedup features', () => {
  it('adds flags from a map', () => {
    expect(quoteArgs([{ '--force': true, '--dry': false, '--base': 'main', '--label': ['a', 'b'], '--none': [], '--x': '' }, 'k'])).toBe(
      `'--force' '--base' 'main' '--label' 'a' '--label' 'b' 'k'`,
    );
  });

  it('goes on only for the listed exit codes', () => {
    const rails = (code: number) => `name: codes
steps:
  - id: a
    run: exit ${code}
    continue-on-error: [3]
  - stop: 'went on \${{ steps.a.exitCode }}'
`;
    expect(run({ 'rails.yaml': rails(3) })).toMatchObject({ status: 'done', message: 'went on 3' });
    expect(run({ 'rails.yaml': rails(1) })).toMatchObject({ status: 'failed' });
  });

  it('gives the value of the selected option, and hides the values from the agent', () => {
    const rails = `name: values
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
    const first = run({ 'rails.yaml': rails }) as Report & { questions: Array<{ options: object[] }>; cwd: string };
    expect(first).toMatchObject({ status: 'step', id: 'q' });
    expect(JSON.stringify(first)).not.toContain('"value"');
    expect(done({ rails: 'values', id: 'q', output: { answer: 'Yes — go' }, cwd: first.cwd })).toMatchObject({ status: 'done', message: 'answer true true' });
  });
});

describe('agent feature requests', () => {
  const at = (r: Report) => r as Report & { cwd: string; id: string; questions?: Array<{ id: string; header: string; options: Array<{ label: string }>; other: boolean }> };

  it('forwards the stop of another rails with forward-stop', () => {
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

  it('a --fail of an agent step in another rails obeys continue-on-error', () => {
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
    expect(done({ rails: 'outer2', id: 'read', fail: 'no access', cwd: first.cwd })).toMatchObject({ status: 'done', message: 'went on failure' });
  });

  it('a prompt step with continue-on-error goes on after --fail', () => {
    const rails = `name: optional
steps:
  - id: review
    prompt: Review.
    continue-on-error: true
  - stop: '\${{ steps.review.outcome }}: \${{ steps.review.error }}'
`;
    const first = at(run({ 'rails.yaml': rails }));
    expect(done({ rails: 'optional', id: 'review', fail: 'no skill', cwd: first.cwd })).toMatchObject({ status: 'done', message: 'failure: no skill' });
  });

  it('gives the results of the previous iteration in loop.previous', () => {
    const rails = `name: prev
steps:
  - id: loop
    repeat: { until: '\${{ steps.ask.outputs.answer == ''ok'' }}', max-iterations: 3 }
    steps:
      - id: ask
        prompt: 'Last: \${{ loop.previous.ask.outputs.answer }}'
        output: { type: object, properties: { answer: { type: string } } }
  - stop: end
`;
    const first = at(run({ 'rails.yaml': rails }));
    expect(first).toMatchObject({ instructions: 'Last: ' });
    const second = done({ rails: 'prev', id: 'ask', output: { answer: 'shorter' }, cwd: first.cwd });
    expect(second).toMatchObject({ instructions: 'Last: shorter' });
  });

  it('asks a dynamic list of questions, with extra options and other answers', () => {
    const rails = `name: dyn
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
    const first = at(run({ 'rails.yaml': rails }));
    const questions = [
      { question: 'Which DB?', header: 'Database choice here', options: ['Postgres', 'MySQL'], other: true },
      { id: 'scope', question: 'Scope?', header: 'Scope', options: [{ label: 'All', description: 'Everything.' }] },
      { question: 'Dropped?' },
    ];
    const ask = at(done({ rails: 'dyn', id: 'draft', output: { questions }, cwd: first.cwd }));
    expect(ask.questions?.map((q) => q.id)).toEqual(['q1', 'scope']);
    expect(ask.questions?.[0]?.header).toBe('Database cho');
    expect(ask.questions?.[0]?.options.map((o) => o.label)).toEqual(['Postgres', 'MySQL', 'Skip']);
    expect(done({ rails: 'dyn', id: 'answers', output: { q1: 'SQLite', scope: 'Nope' }, cwd: first.cwd })).toMatchObject({ status: 'invalid' });
    expect(done({ rails: 'dyn', id: 'answers', output: { q1: 'SQLite', scope: 'Skip' }, cwd: first.cwd })).toMatchObject({ status: 'done', message: 'SQLite / Skip' });
  });
});

describe('part B feature requests', () => {
  it('runs on-failure steps with failure.message, and the run still fails', () => {
    const rails = `name: onfail
steps:
  - id: work
    run: echo boom >&2; exit 2
  - stop: not reached
on-failure:
  - id: save
    run: printf '%s' "$MESSAGE" > error.txt
    env: { MESSAGE: '\${{ failure.message }}' }
`;
    const result = run({ 'rails.yaml': rails }) as Report & { cwd: string; message: string };
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.message).toMatch(/exit code 2/);
    expect(fs.readFileSync(path.join(result.cwd, 'error.txt'), 'utf8')).toMatch(/boom/);
  });

  it('runs a command and another rails in a working-directory, and gives loop.number', () => {
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
    const rails = `name: setter
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
    expect(run({ 'rails.yaml': rails })).toMatchObject({ status: 'done', message: 'home true 2' });
  });
});

describe('shorter rails files', () => {
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
    const rails = `name: short
steps:
  - id: plan
    prompt: Plan.
    output: { title: string, kind: fix | skip }
  - stop: '\${{ steps.plan.outputs.kind }}'
`;
    const first = run({ 'rails.yaml': rails }) as Report & { cwd: string };
    expect(done({ rails: 'short', id: 'plan', output: { title: 'x', kind: 'other' }, cwd: first.cwd })).toMatchObject({ status: 'invalid' });
    expect(done({ rails: 'short', id: 'plan', output: { title: 'x', kind: 'fix' }, cwd: first.cwd })).toMatchObject({ status: 'done', message: 'fix' });
    expect(run({ 'rails.yaml': 'name: bad\nsteps:\n  - id: p\n    prompt: P.\n    output: { a: strin }\n' })).toMatchObject({ status: 'error' });
  });

  it('refuses an input out of its enum, and fails with a fail step', () => {
    const rails = `name: en
inputs:
  command: { enum: [fetch, reply] }
  kinds: { type: list, enum: [test, lint] }
steps:
  - if: \${{ inputs.command == 'reply' }}
    fail: 'no reply'
  - stop: ok
`;
    expect(run({ 'rails.yaml': rails }, { command: 'nope' })).toMatchObject({ status: 'error' });
    expect(run({ 'rails.yaml': rails }, { kinds: 'test,build' })).toMatchObject({ status: 'error' });
    expect(run({ 'rails.yaml': rails }, { command: 'reply' })).toMatchObject({ status: 'failed', message: 'no reply' });
    expect(run({ 'rails.yaml': rails }, { command: 'fetch', kinds: 'lint' })).toMatchObject({ status: 'done' });
  });

  it('takes plain label options, and has length, split, list and where', () => {
    const rails = `name: fx
steps:
  - id: q
    ask:
      - { id: a, header: Go, question: Go?, options: [Push, Stop] }
  - stop: "\${{ steps.q.outputs.a }} \${{ length(split('a, b,,c', ',')) }} \${{ join(list('x', 'y'), '+') }} \${{ length(where(fromJSON('[{\\"ok\\":true},{\\"ok\\":false},{\\"ok\\":true}]'), 'ok')) }} \${{ length(where(fromJSON('[{\\"k\\":\\"a\\"},{\\"k\\":\\"b\\"}]'), 'k', 'b')) }}"
`;
    const first = run({ 'rails.yaml': rails }) as Report & { cwd: string; questions: Array<{ options: Array<{ label: string; description: string }> }> };
    expect(first.questions[0]?.options).toEqual([{ label: 'Push', description: '' }, { label: 'Stop', description: '' }]);
    expect(done({ rails: 'fx', id: 'q', output: { a: 'Push' }, cwd: first.cwd })).toMatchObject({ status: 'done', message: 'Push 3 x+y 2 1' });
  });
});

describe('output schema check', () => {
  it('refuses a description that YAML split at a comma', () => {
    const rails = `name: comma
steps:
  - id: plan
    prompt: Plan.
    output:
      type: object
      properties:
        title: { type: string, description: The title, in a few words }
`;
    const result = run({ 'rails.yaml': rails }) as Report & { errors: string[] };
    expect(result).toMatchObject({ status: 'error' });
    expect(result.errors.join()).toMatch(/unknown keyword.*in a few words.*quote/);
  });
});

describe('with values on agent steps', () => {
  const rails = `name: values
inputs:
  ticket: { type: string }
steps:
  - id: data
    run: >-
      echo '{"prs": [{"url": "u1"}], "gaps": []}'
    stdout: json
  - id: summary
    prompt: prompts/summary.md
    with:
      ticket: \${{ inputs.ticket || 'a free-text task' }}
      pullRequests: \${{ steps.data.outputs.prs }}
      gaps: \${{ steps.data.outputs.gaps }}
  - id: open
    skill: acme:open-pr
    with:
      draft: \${{ true }}
      title: Fix it
  - id: plain
    skill: acme:other
    with: --auto \${{ inputs.ticket }}
`;
  const files = { 'rails.yaml': rails, 'prompts/summary.md': 'Write the summary.\n' };

  it('gives a prompt step its values as YAML after the instructions', () => {
    const result = run(files, { ticket: 'ABC-1' }) as Report & { instructions: string };
    expect(result).toMatchObject({ status: 'step', id: 'summary' });
    expect(result.instructions).toBe(
      'Write the summary.\n\nValues:\n\n```yaml\nticket: ABC-1\npullRequests:\n  - url: u1\ngaps: []\n```',
    );
  });

  it('gives a skill step a map as YAML arguments, and a text as it is', () => {
    const first = run(files) as Report & { cwd: string; instructions: string };
    expect(first.instructions).toContain('ticket: a free-text task');
    const open = done({ rails: 'values', id: 'summary', cwd: first.cwd, output: {} }) as Report & { args: string };
    expect(open).toMatchObject({ id: 'open', args: 'draft: true\ntitle: Fix it' });
    expect(done({ rails: 'values', id: 'open', cwd: first.cwd, output: {} })).toMatchObject({ id: 'plain', args: '--auto ' });
  });

  it('accepts with on a prompt step in the schema', () => {
    const dir = tempDir(files);
    expect(check({ file: path.join(dir, 'rails.yaml') })).toMatchObject({ status: 'ok' });
  });
});

describe('run args with one value', () => {
  it('takes one value, a list from an expression, or a map, in place of a list', () => {
    const rails = `name: one
inputs:
  dir: { type: string }
  files: { type: list }
steps:
  - id: a
    run: printf '%s|' >> out.txt
    args: \${{ inputs.dir }}
  - id: b
    run: printf '%s|' >> out.txt
    args: \${{ inputs.files }}
  - id: c
    run: printf '%s|' >> out.txt
    args: { --name: x }
  - stop: done
`;
    const result = run({ 'rails.yaml': rails }, { dir: 'my dir', files: 'a\nb' }) as Report & { cwd: string };
    expect(result).toMatchObject({ status: 'done' });
    expect(fs.readFileSync(path.join(result.cwd, 'out.txt'), 'utf8')).toBe('my dir|a|b|--name|x|');
  });
});

describe('prompt links', () => {
  const rails = `name: links
steps:
  - id: read
    prompt: prompts/read.md
  - id: inline
    prompt: Follow [the rules](references/rules.md#scope).
`;
  const prompt = 'Read [the guide](../references/guide.md), [a site](https://x.y/a.md) and [here](#top).\n\n```md\n[example](nowhere.md)\n```\n';

  it('makes relative links absolute from the folder of the prompt, and keeps the other links and the code blocks', () => {
    const dir = tempDir({ 'rails.yaml': rails, 'prompts/read.md': prompt, 'references/guide.md': 'g', 'references/rules.md': 'r' });
    const result = start({ file: path.join(dir, 'rails.yaml'), cwd: dir, inputs: {} }) as Report & { instructions: string };
    expect(result.instructions).toBe(prompt.replace('../references/guide.md', path.join(dir, 'references/guide.md')));
    const next = done({ rails: 'links', id: 'read', cwd: dir, output: {} }) as Report & { instructions: string };
    expect(next.instructions).toBe(`Follow [the rules](${path.join(dir, 'references/rules.md')}#scope).`);
  });

  it('reports a broken link in the check', () => {
    const dir = tempDir({ 'rails.yaml': rails, 'prompts/read.md': prompt, 'references/rules.md': 'r' });
    expect(check({ file: path.join(dir, 'rails.yaml') })).toMatchObject({ status: 'error', errors: ['step "read": broken link ../references/guide.md'] });
  });
});

describe('set with an expression', () => {
  it('sets every key of the object that the expression gives', () => {
    const rails = `name: setall
inputs:
  context: { type: string, default: '' }
steps:
  - id: parsed
    set:
      fallback: { ticketKey: ABC-2, projects: [a] }
  - id: values
    set: \${{ (inputs.context && fromJSON(inputs.context)) || steps.parsed.outputs.fallback }}
  - stop: \${{ steps.values.outputs.ticketKey }} \${{ join(steps.values.outputs.projects, ',') }}
`;
    expect(run({ 'rails.yaml': rails }, { context: '{"ticketKey": "ABC-1", "projects": ["x", "y"]}' })).toMatchObject({ status: 'done', message: 'ABC-1 x,y' });
    expect(run({ 'rails.yaml': rails })).toMatchObject({ status: 'done', message: 'ABC-2 a' });
  });
});
