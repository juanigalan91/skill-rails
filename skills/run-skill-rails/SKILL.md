---
name: run-skill-rails
description: "Run a skill-rails file (rails.yaml) step by step: the runner gives one step at a time, you do it and report its output. Use when a skill tells you to run a rails file, or when asked to run a skill with skill-rails."
argument-hint: "<rails.yaml> [key=value ...]"
---

# Run a skill-rails file

This skill is the Markdown bootstrap that runs rails files, including the ones of the create and migrate skills. It has no rails file itself, so the runner does not start itself again.

The runner decides the order of the steps, runs the shell steps itself, and checks each output that you report.
You do only the step that it gives you, one at a time.

Resolve the caller’s rails file path relative to its SKILL.md when it supplies a relative link. Use the intended project directory for execution and state; with the CLI, add `--cwd <project-directory>` to each command if needed. With MCP, the server must be configured for that project.

Use the MCP tools `rails_start` and `rails_done` when they are available.
Otherwise use the CLI: `npx -y skill-rails@0.6 <command>`.

## Step 1: Start

```bash
npx -y skill-rails@0.6 start <rails.yaml> [--input <key>=<value> ...]
```

Give only the inputs that the caller or the invocation text gives.
Never guess an input.

## Step 2: Do the steps

The runner prints one JSON object.
Act on its `status`:

- `step` → do the step (see "Step types"), then run its `next` command, with your output as JSON in place of `<the output, as JSON>`:

  ```bash
  npx -y skill-rails@0.6 done <rails> <id> --cwd '<project>' --output - <<'JSON'
  {"title": "Add the rails runner"}
  JSON
  ```

  With no `output` in the step, `next` has no `--output -` and no heredoc.
  If you cannot do the step, run `done <rails> <id> --fail "<reason>"`.
- `invalid` → read `errors`, correct the output, and run `done` again.
- `done` → tell the user `message`, give the caller `outputs` when the result has them, and stop.
- `failed` or `error` → tell the user `message` or `errors`, and stop.

When the object has `notes`, tell them to the user.

### Step types

- `prompt` → do `instructions`.
- `skill` → load and follow the named `skill` with `args` using the host’s supported mechanism, then do `instructions`. If unavailable, report the step with `--fail`; do not silently substitute another skill.
  If the skill tells you to stop, report the step with `--fail`.
- `ask` → ask the user `questions` as they are, including option descriptions and each `preview`. Use a native question tool when it can represent the question; otherwise ask in chat. Wait for the user’s reply before reporting an answer. Never infer approval or invent a selection.
  Report one property per question `id`: the selected label, or the list of labels for `multiSelect`.
  A question with `free: true` takes free text: ask it in a normal message, wait for the reply, and report the reply as text.
- `wait` → a step polls a command and needs more time.
  Wait until `retryAt` (Unix milliseconds), using the host’s wait mechanism, then run `done <rails> <id>` with no output. If the host cannot wait automatically, hand control back and resume when the user returns.

`output` is the JSON Schema of the output: report a JSON object that matches it.

## Rules

- Do only the step that the runner gives you.
  Never skip a step, change the order, or do a later step first.
- Do not run the shell steps of the rails file yourself: the runner runs them.
- Do not show the runner commands or their JSON to the user.
