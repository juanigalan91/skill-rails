# Testing flows

`skill-rails test` runs a flow for real, with fixed answers in place of the agent.
It finds the `*.test.yaml` files in all folders below its targets (not in `node_modules`, `.git`, `dist`, `coverage` or `.nx`), so a repository with many skills needs no script: put `skill-rails test . --quiet` in its test command.
It needs no model, no network and no API key, so a test takes milliseconds and gives the same result every time.

```bash
skill-rails test                      # every *.test.yaml under the current folder
skill-rails test skills/open-pr       # one skill
skill-rails test --json               # the results as JSON, for CI
skill-rails test . --quiet            # a whole repository: only the failures and the count
skill-rails test --live               # also the tests that need a real agent: live steps, judge and agent mode
skill-rails test --live --agent "codex exec"   # the same tests with another agent command
```

## A test file

Put the tests of a flow in `tests/<name>.test.yaml`, next to `rails.yaml`.
A file has one test, or a `tests:` list whose items share the keys at the top.
In a test, `env` and `path` add to the shared ones, and the other keys replace them.

```yaml
flow: ../rails.yaml          # the flow to test, relative to this file
fixture: fixtures/repo      # copied into a new temp working directory
git: true                   # git init and commit the fixture (default: true)
setup: |                    # bash, run in the working directory before the flow
  git checkout -q -b feat/x
path: [stubs]               # folders put first in PATH, for stub commands
env:                        # environment variables of the run steps
  GH_SCENARIO: failing
  TMPDIR: '{{cwd}}/'

tests:
  - name: failing checks go to the agent
    inputs: { pr: '42' }
    answers:                # the agent output of each step, by step id
      diagnose: { applied: 1, skipped: 0, files: [src/a.ts] }
    expect:
      status: done
      message: '/Applied fixes: 1/'
      steps: { gather: success, fix: skipped }
      outputs: { gather.failing: '2' }
      files: { diagnose-ci-42.log: '/Run: 123/' }
```

## Answers

`answers` maps each agent step id (`prompt`, `skill` and `ask` steps) to the output that the agent would report.

- An `ask` answer has one property per question id: `{ answer: Write it }`.
- A list gives one answer per occurrence of the step, in order: a step in a `foreach` comes back once per item, and a step in a `repeat` once per iteration.
  `decide: [{ answer: Fix }, { answer: Skip }]`.
  A single answer is used for every occurrence.
- In `expect.steps`, `<uses id>/<step id>` checks a step of another flow.
- A step of another flow (a `uses` step) can have the key `<uses id>/<step id>`, for example `diagnose/decide`, when two flows have steps with the same id.
  The bare step id also works.
- `$files` writes files in the working directory before the answer, for an agent step that changes files: `{ ok: true, $files: { notes.md: hello } }`.
- `$fail` fails the step, as `done --fail` does: `{ $fail: The user stopped. }`.
- `{{cwd}}` is the temp working directory, and `{{dir}}` is the folder of the test file.
  They work in `answers`, `env`, `inputs` and `setup`.

The runner validates each answer against the output schema of its step, as it does for a real agent.

## Expectations

| Key | Checks |
|-----|--------|
| `status` | `done`, `failed` or `error`. |
| `message` | The final message. |
| `steps` | The outcome of each step: `success`, `failure` or `skipped`. A step that the flow never reached is `not reached`. |
| `outputs` | `<step id>.<key>`: an output of a run step, or a property of an agent output. A longer path reads inside it, for example `fix.results[0].steps.apply.outputs.file`. |
| `flow-outputs` | `<key>`: a value that the flow gives back with `outputs:`. A longer path works here too. |
| `files` | A file of the working directory: `exists`, `absent`, an exact content, or a regular expression. |
| `notes` | The notes: `::warning::` lines on stdout, `WARNING:` lines on stderr, and `note` steps. |
| `judge` | `<step id>: <rubric>`: a real agent grades the step output against the rubric (see [Judge](#judge)). |
| `started` | `true` or `false`: whether the flow has a state. In agent mode, `false` means that the agent did not run the flow. |
| `transcript` | Agent mode: `contains` and `absent` lists for the stdout of the agent. A string is a part of the text, and `/.../` is a regular expression. |

A value that starts and ends with `/` is a regular expression.
Quote it in YAML when it holds `: ` or ` #`.

## Why a test fails

- The flow asks for a step that has no answer: the path of the flow changed.
- An answer is never used: the flow skipped a step that the test expects.
- An answer does not match the output schema of its step.
- An expectation does not match.

## Stub commands

A stub is a script in a folder of `path`, with the name of the command that it replaces.
The `path` folders come before the `scripts/` folders of the flow and of its plugin, so that a stub can also replace a script.
It answers the calls of the flow, and refuses the others so that a new call is visible:

```bash
#!/usr/bin/env bash
# stubs/gh
case "$*" in
  "repo view"*) echo main ;;
  "pr view"*) exit 1 ;;                       # no open PR
  "pr create"*) echo "https://github.com/acme/app/pull/7" ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
```

Use an environment variable to choose a scenario, for example `GH_SCENARIO: failing`.

## What a test does not check

A test checks what the flow does with the agent's answers: the order, the conditions, the scripts, the outputs and the files.
It does not check the quality of the agent's work (a diagnosis, a draft, a title).
Check that with live steps and a judge, or with model evals.

## Tests with a real agent

Live steps, `judge` and `mode: agent` call a real agent, so they cost tokens and can give a different result on each run.
A test with one of them runs only with `skill-rails test --live`.
Without `--live`, the test is skipped: the CLI shows `-` and counts it as skipped, and a skipped test does not fail the run.

The agent is a command that reads the prompt on stdin and prints the reply on stdout:
`--agent "<command>"`, else the `SKILL_RAILS_AGENT` environment variable, else `claude -p`.
An agent command that runs more than 10 minutes fails the test; `SKILL_RAILS_AGENT_TIMEOUT_MINUTES` changes the limit.
The command runs in the temp working directory of the test, with the `env` and the `path` stubs of the test.

## Live steps

A live answer sends one step to the real agent, and the other steps keep their fixed answers.
This evaluates one step in its real context: the rendered instructions, the files of the fixture, and the outputs of the steps before it.

```yaml
answers:
  gather: { files: [src/a.ts] }
  diagnose: live                               # the agent does the step
  confirm: { $live: The user accepts a fix. }  # the agent plays the user of an ask step
```

- `live` sends the step as it is.
  `{ $live: <guidance> }` adds the guidance to the prompt.
- The prompt holds the step instructions (or the skill and its args, or the questions of an `ask` step), the folder of the step, the guidance, and the output schema.
- For an `ask` step, the agent plays the user, and the guidance says what the user wants.
- The runner reads the last JSON object or list of the reply, also inside a fenced block.
  When the output does not match the schema, it asks again once with the errors, and then fails the test.

## Judge

`expect.judge` grades step outputs with a rubric.
After the run, the agent gets the rubric and the output of the step, and replies `{"pass": true|false, "reason": "..."}`.
A false `pass` fails the test with `judge <id>: <reason>`.

```yaml
judge-runs: 3          # run the whole test 3 times; every run must pass
answers:
  draft: live
expect:
  status: done
  judge:
    draft: The title says what the change does, in less than 70 characters.
    review/decide: The decision names the failing check.   # a step of another flow
```

With `judge-runs`, the failure says how many runs passed, for example `passed 2 of 3 runs`.

## Agent mode

A test with `mode: agent` does not drive the flow.
It gives `request` to the agent command, and then checks the expectations against the saved state of the flow: `status`, `message`, `steps`, `outputs`, `flow-outputs` and `files`.
The setup, the fixture, `env`, `path`, `{{cwd}}` and `{{dir}}` work as in other tests.

```yaml
flow: ../rails.yaml
mode: agent
request: Run the skill in {{dir}}/../SKILL.md with auto=true.
tests:
  - name: the agent follows the protocol
    expect:
      started: true
      status: done
      transcript:
        absent: ['"status":', 'skill-rails done']   # the agent hid the protocol JSON and commands
  - name: a greeting does not start the flow
    request: Hello!
    expect: { started: false }
```

- Use it for a protocol smoke run on each host, and for trigger checks: `started: false` means that the agent did not run the flow.
- The agent command must have the skill available.
  For Claude Code, install the plugin, or name the path of the `SKILL.md` in the request.
- A non-interactive run cannot answer `ask` steps.
  Use flows with `auto` inputs, or with no `ask` step.
- The same test runs on another host with another command, for example `--agent "codex exec"`.

## Record

`skill-rails record <flow> [--out <file>]` writes a test file from the state of a real run, finished or running.
A real run becomes a regression test.

```bash
skill-rails record open-pr --out skills/open-pr/tests/recorded.test.yaml
```

- `flow:` is relative to the folder of `--out`, or absolute when the file goes to stdout.
- `inputs:` are the inputs of the run.
- `answers:` hold what the agent reported for each agent step, with `<uses id>/<step id>` keys for the steps of other flows, and a list for a step that ran more than once.
  A `--fail` becomes `$fail`.
- `expect:` holds the status, the message and the outcome of each step of the flow.

The run steps of the recorded test call real commands.
Add stubs for the network commands, and `$files` for the files that the agent wrote.

## Trace

`skill-rails trace <flow>` prints one JSON line per agent step of a run:

```json
{"flow":"open-pr","path":"review/decide","id":"decide","request":{"type":"prompt","instructions":"..."},"answer":{"fix":true},"outcome":"success"}
```

Each line is an eval case: the exact input and output of one step of a real run.
`request` is what the agent was asked, and `answer` is what it reported.
