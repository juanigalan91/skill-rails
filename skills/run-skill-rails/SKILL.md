---
name: run-skill-rails
description: "Run a skill-rails flow file (flow.yaml) step by step: the runner gives one step at a time, you do it and report its output. Use when a skill tells you to run a flow, or when asked to run a skill-rails flow."
argument-hint: "<flow.yaml> [key=value ...]"
---

# Run a skill-rails flow

The runner decides the order of the steps, runs the shell steps itself, and checks each output that you report.
You do only the step that it gives you, one at a time.

Use the MCP tools `flow_start` and `flow_done` when they are available.
Otherwise use the CLI: `npx -y skill-rails@0.2 <command>`.

## Step 1: Start

```bash
npx -y skill-rails@0.2 start <flow.yaml> [--input <key>=<value> ...]
```

Give only the inputs that the caller or the invocation text gives.
Never guess an input.

## Step 2: Do the steps

The runner prints one JSON object.
Act on its `status`:

- `step` → do the step (see "Step types"), then report its output:

  ```bash
  npx -y skill-rails@0.2 done <flow> <id> --output - <<'JSON'
  {"title": "Add the flow runner"}
  JSON
  ```

  With no `output` in the step, leave out `--output -` and the heredoc.
  If you cannot do the step, run `done <flow> <id> --fail "<reason>"`.
- `invalid` → read `errors`, correct the output, and run `done` again.
- `done` → tell the user `message`, and stop.
- `failed` or `error` → tell the user `message` or `errors`, and stop.

When the object has `notes`, tell them to the user.

### Step types

- `prompt` → do `instructions`.
- `skill` → invoke `skill` with `args`, then do `instructions`.
  If the skill tells you to stop, report the step with `--fail`.
- `ask` → ask the user `questions` as they are, with your question tool, with each option `preview`.
  Report one property per question `id`: the selected label, or the list of labels for `multiSelect`.
  A question with `free: true` takes free text: ask it in a normal message, wait for the reply, and report the reply as text.
- `wait` → a step polls a command and needs more time.
  Run `done <flow> <id>` again with no output, with a tool timeout of 10 minutes.

`output` is the JSON Schema of the output: report a JSON object that matches it.

## Rules

- Do only the step that the runner gives you.
  Never skip a step, change the order, or do a later step first.
- Do not run the shell steps of the flow yourself: the runner runs them.
- Do not show the runner commands or their JSON to the user.
