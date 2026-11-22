---
name: migrate-to-skill-rails
description: "Migrate an existing Markdown skill (SKILL.md) to skill-rails: move the deterministic steps to scripts that the runner executes, keep only the judgment in agent steps, and update the skill in place. Use when asked to migrate, convert or port a skill to skill-rails."
argument-hint: "<path of the skill folder or SKILL.md>"
---

# migrate-to-skill-rails

Run [rails.yaml](rails.yaml) with the [run-skill-rails bootstrap](../run-skill-rails/SKILL.md). Resolve the rails file path relative to this SKILL.md. Use the MCP tools when available, or:

```bash
npx -y skill-rails@0.6 start "<absolute-path-to-this-skill>/rails.yaml" --input source="<skill folder or SKILL.md>" [--input request="<extra requirements>"]
```

Pass only inputs supplied by the user. Set `auto=true` only for an explicitly unattended run. The run first assesses whether a rails file helps the skill: it keeps the skill as Markdown when code or CI reads its text, when the runner cannot run where the skill runs, or when the skill is reference text or too short; the user can still migrate it. Migration replaces the skill in its current directory without creating backups or sibling copies. The rails file owns the step order, scripts, validation, and failure gates. Do each pending agent step and report its schema-valid output using the bootstrap protocol; report failure if blocked.

Keep the package's skills/ and docs/ layout together so prompts, shared rails files, scripts, and references remain available.
