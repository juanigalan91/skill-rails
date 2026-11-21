# Testing flows

`skillflow test` runs a flow for real, with fixed answers in place of the agent.
It needs no model, no network and no API key, so a test takes milliseconds and gives the same result every time.

```bash
skillflow test                      # every *.test.yaml under the current folder
skillflow test skills/open-pr       # one skill
skillflow test --json               # the results as JSON, for CI
```

## A test file

Put the tests of a flow in `tests/<name>.test.yaml`, next to `flow.yaml`.
A file has one test, or a `tests:` list whose items share the keys at the top.
In a test, `env` and `path` add to the shared ones, and the other keys replace them.

```yaml
flow: ../flow.yaml          # the flow to test, relative to this file
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
- A list gives one answer per occurrence of the step, in order: a step in a `foreach` comes back once per item.
  `decide: [{ answer: Fix }, { answer: Skip }]`.
  A single answer is used for every occurrence.
- `$files` writes files in the working directory before the answer, for an agent step that changes files: `{ ok: true, $files: { notes.md: hello } }`.
- `$fail` fails the step, as `done --fail` does: `{ $fail: The user stopped. }`.
- `{{cwd}}` is the temp working directory, and `{{dir}}` is the folder of the test file.
  They work in `answers`, `env` and `inputs`.

The runner validates each answer against the output schema of its step, as it does for a real agent.

## Expectations

| Key | Checks |
|-----|--------|
| `status` | `done`, `failed` or `error`. |
| `message` | The final message. |
| `steps` | The outcome of each step: `success`, `failure` or `skipped`. A step that the flow never reached is `not reached`. |
| `outputs` | `<step id>.<key>`: an output of a run step, or a property of an agent output. |
| `files` | A file of the working directory: `exists`, `absent`, an exact content, or a regular expression. |
| `notes` | The `::warning::` notes of the run steps. |

A value that starts and ends with `/` is a regular expression.
Quote it in YAML when it holds `: ` or ` #`.

## Why a test fails

- The flow asks for a step that has no answer: the path of the flow changed.
- An answer is never used: the flow skipped a step that the test expects.
- An answer does not match the output schema of its step.
- An expectation does not match.

## Stub commands

A stub is a script in a folder of `path`, with the name of the command that it replaces.
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
Check that with model evals, separately.
