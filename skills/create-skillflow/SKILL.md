---
name: create-skillflow
description: "Create a new agent skill as a skillflow flow: flow.yaml, scripts and prompt files, with the deterministic parts in code and only the judgment in agent steps. Use when asked to create, write or design a new skill with skillflow."
argument-hint: "<what the skill does>"
---

# Create a skill with skillflow

Writes a new skill folder: `SKILL.md`, `flow.yaml`, `scripts/` and `prompts/`.
Read `${CLAUDE_SKILL_DIR}/../../docs/format.md` first: it is the reference of the flow format.

## Step 1: Understand the skill

Get these answers from the request.
Ask the user only for the ones that it does not give:

- what the skill does, its inputs, and its result;
- whether it runs with a user (it can ask questions) or unattended (it never asks);
- the tools and other skills that it uses;
- where to write it (for example `.claude/skills/<name>/` or a plugin `skills/` folder).

## Step 2: Design the steps

List the steps of the work in order, then give each one a type:

| The step | Type |
|----------|------|
| Gives the same result each time: git, gh, file operations, checks, formatting, API calls | `run`, with a script in `scripts/` |
| Needs judgment: write, analyze, choose, fix | `prompt`, with an `output` schema for the values that later steps use |
| Needs a decision from the user | `ask`, only in an interactive skill |
| Calls another skill | `skill`; when that skill only runs a script, call the script in a `run` step |
| Ends the run on a condition (a gate) | `stop` with `if:` and `outcome: failure` |

Then make the agent work small, because each agent step costs 2 to 3 model turns:

- Merge agent steps that follow each other into one `prompt` step.
- Move the fixed rules that a prompt needs (a format, a checklist) into one Markdown file that the prompt names, so that the agent reads only what it needs.
- Prepare the inputs of an agent step in a `run` step before it: collect the context into outputs or into one file.
- Do the checks after an agent step in a `run` step (lint, length, format), with a short fix prompt that runs only when the check fails.

Show the design to the user as a table of steps (id, type, what it does) before you write files, unless the run is unattended.

## Step 3: Write the files

- `flow.yaml`: the order, the conditions and the inputs only.
  Use `run: <script>.sh` and `prompt-file: prompts/<id>.md`.
- `scripts/<name>.sh`: start with `#!/usr/bin/env bash` and `set -eo pipefail`.
  Write outputs to `$FLOW_OUTPUT` as `key=value`, or `key<<EOF` ... `EOF` for several lines.
  Print `::warning::<text>` for a message to the user.
  Make each script executable.
- `prompts/<id>.md`: the instructions, with `${{ }}` for the values of earlier steps.
- `SKILL.md`: copy `${CLAUDE_SKILL_DIR}/template/SKILL.md` and fill the name, the description and the inputs.

Rules:

- Never put `${{ }}` in a `run` command: pass the values with `env`. The check refuses it, because a value can hold shell code.
- Give every `ask` option a `label` and a `description`.
- Keep each `output` schema to the values that later steps or the final message use.

## Step 4: Check

```bash
npx -y skillflow@0.2 check <skill folder>/flow.yaml
```

Fix each error.
Then run the flow once in a safe place, for example a copy of the repository, before a real run.
Do not run a step that publishes something (push, PR, message) during a test.

## Step 5: Report

Give the user the file list, the table of steps, and how many steps run in code and how many the agent does.
