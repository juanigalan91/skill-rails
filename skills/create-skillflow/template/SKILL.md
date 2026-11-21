---
name: <skill-name>
description: "<What the skill does, and when to use it.>"
allowed-tools: Bash, Read, Edit, Write
---

# <Skill title>

This skill runs `flow.yaml` with skillflow.
Run the flow with the `run-skillflow` skill, or follow these steps.

1. Start the flow:

   ```bash
   npx -y skillflow@0.2 start "${CLAUDE_SKILL_DIR}/flow.yaml" [--input <key>=<value> ...]
   ```

2. Act on the `status` of each result:
   - `step` → do the step, then run `npx -y skillflow@0.2 done <flow> <id> --output - <<'JSON' ... JSON` with an output that matches `output`.
     For a `skill` step, invoke the skill with `args` first.
     For an `ask` step, ask the `questions` as they are, and report one property per question id.
   - `invalid` → correct the output and run `done` again.
   - `done`, `failed` or `error` → tell the user `message` or `errors`, and stop.
3. Do only the step that the runner gives you, and never run the shell steps of the flow yourself.
