---
name: create-skill-rails
description: "Create a new agent skill with skill-rails: rails.yaml, scripts and prompt files, with the deterministic parts in code and only the judgment in agent steps. Use when asked to create, write or design a new skill with skill-rails."
argument-hint: "<what the skill does>"
---

# create-skill-rails

Run [rails.yaml](rails.yaml) with the [run-skill-rails bootstrap](../run-skill-rails/SKILL.md). Resolve the rails file path relative to this SKILL.md. Use the MCP tools when available, or:

```bash
npx -y skill-rails@0.6 start "<absolute-path-to-this-skill>/rails.yaml" --input request="<user request>" [--input target="<directory>"]
```

Pass only inputs supplied by the user. Set `auto=true` only for an explicitly unattended run. The rails file owns the step order, scripts, validation, and failure gates. Do each pending agent step and report its schema-valid output using the bootstrap protocol; report failure if blocked.

Keep the package's skills/ and docs/ layout together so prompts, shared rails files, scripts, and references remain available.
