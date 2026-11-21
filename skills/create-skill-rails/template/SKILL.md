---
name: <skill-name>
description: "<What the skill does, and when to use it.>"
---

# <Skill title>

This skill runs `flow.yaml` with skill-rails.
Run the flow with the `run-skill-rails` skill, or follow these steps.

Resolve [flow.yaml](flow.yaml) relative to this SKILL.md and substitute its absolute directory below. Run commands in the intended project directory; add `--cwd <project-directory>` when needed.

1. Start the flow:

   ```bash
   npx -y skill-rails@0.2 start "<absolute-path-to-this-skill>/flow.yaml" [--input <key>=<value> ...]
   ```

2. Act on the `status` of each result:
   - `step` → do the step, then run `npx -y skill-rails@0.2 done <flow> <id> --output - <<'JSON' ... JSON` with an output that matches `output`.
     For a `skill` step, load and follow the named skill using the host’s supported mechanism with `args` first; report failure if unavailable.
     For an `ask` step, ask the `questions` as they are, display descriptions and previews, wait for the user’s reply, and report one property per question id. Use chat when a question tool cannot represent the question. Never invent an answer.
     For a `wait` step, wait until `retryAt` (Unix milliseconds), then report it done with no output.
   - `invalid` → correct the output and run `done` again.
   - `done`, `failed` or `error` → tell the user `message` or `errors`, and stop.
3. Do only the step that the runner gives you, and never run the shell steps of the flow yourself.
