---
name: <skill-name>
description: "<What the skill does, and when to use it.>"
---

# <Skill title>

This skill runs `rails.yaml` with skill-rails.
Run the rails file with the `run-skill-rails` skill, or follow these steps.

Resolve [rails.yaml](rails.yaml) relative to this SKILL.md and substitute its absolute directory below. Run commands in the intended project directory; add `--cwd <project-directory>` when needed.

1. Start the run:

   ```bash
   npx -y skill-rails@0.5 start "<absolute-path-to-this-skill>/rails.yaml" [--input <key>=<value> ...]
   ```

2. Follow the `protocol` of the first result until the run ends.
3. Do only the step that the runner gives you, and never run the shell steps of the rails file yourself.
