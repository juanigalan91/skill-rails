---
name: migrate-to-skill-rails
description: "Migrate an existing Markdown skill (SKILL.md) to a skill-rails flow: move the deterministic steps to scripts that the runner executes, keep only the judgment in agent steps, and compare the two versions. Use when asked to migrate, convert or port a skill to skill-rails."
argument-hint: "<path of the skill folder or SKILL.md>"
---

# Migrate a skill to skill-rails

Turns a Markdown skill into a flow skill, next to the original: `<name>-flow/` with `SKILL.md`, `flow.yaml`, `scripts/` and `prompts/`.
Keep the original skill until deterministic tests and the rule audit show that the flow preserves its behavior; use the optional live comparison in Step 6 for additional evidence.
Read [the flow format](../../docs/format.md) first: it is the reference of the flow format.

Resolve relative links from this SKILL.md file, not from the project working directory. Keep the package’s `skills/` and `docs/` layout together.

## Step 1: Read the skill

Read the `SKILL.md`, every file that it loads (mode files, templates, rule files), and every script that it runs.
Also read the skills that it invokes, because their steps may move into the flow.

## Step 2: List the steps

Make a table with one row for each step of the skill, in order, with:

- what it does;
- what it reads, and what later steps use from it;
- its conditions and its gates (the "stop when" and "skip when" rules);
- its type in the flow:

| The step | Type |
|----------|------|
| A shell command, an API call, a file copy, a check, a format rule that code can apply | `run` (script) |
| Judgment: write, analyze, select, fix | `prompt` |
| A question to the user | `ask` (an unattended skill has none) |
| A call to another skill | `skill`, or a `run` step that calls its script when that skill only runs a script |
| A gate | `stop` with `if:` |

A Markdown step often mixes types.
Split it: for example, "copy the template, then fill it" is a `run` step and a `prompt` step.

## Step 3: Make the agent work small

Each agent step costs 2 to 3 model turns, and the runner does `run` steps with no model.
These changes gave the largest gains in practice:

1. Call the scripts of other skills directly in `run` steps, in place of loading those skills.
2. Collect the inputs of the research in one `run` step (one file or a few outputs), so that the agent does not run many commands.
3. Merge agent steps that follow each other into one `prompt` step.
4. Move the long fixed rules into a separate Markdown file that the prompt names, and keep only the rules that the step needs.
   Do not make the agent read the whole original skill.
5. Do the checks in a `run` step after the agent step, with a fix prompt that runs only when the check fails.
6. Write the final report or message in a `run` step from the step outputs, when it has a fixed format.

Keep the behavior: every gate, every condition and every rule of the original skill must be in the flow, in a script, or in a prompt file.
Make a list of each rule of the original skill and where it went.

## Step 4: Write the files

Follow Step 3 of the `create-skill-rails` skill for the file rules.
Never put `${{ }}` in a `run` command: pass the values with `env`.

## Step 5: Check

```bash
npx -y skill-rails@0.2 check <name>-flow/flow.yaml
```

Then run the flow once in a safe place, for example a copy of the repository with a local remote, before a real run.
Do not run a step that publishes something (push, PR, message) during a test.

## Step 6: Compare

Compare the two versions on the same input, when the user agrees to the cost.
Use the current agent's documented headless mode if available; otherwise compare in separate interactive sessions. Do not assume another agent CLI is installed. Report only metrics the host exposes.
First add deterministic `*.test.yaml` cases and run `skill-rails test`; these need no model. Live comparisons are optional and require the user's agreement to the cost.

Run each version at least 3 times, in a copy of the repository, and compare the result (the files or the PR), the duration, the turns, the tokens and the cost.
Give the user the table, the rule list from Step 3, and the differences in the result.
