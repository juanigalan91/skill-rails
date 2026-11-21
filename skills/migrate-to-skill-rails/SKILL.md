---
name: migrate-to-skill-rails
description: "Migrate an existing Markdown skill (SKILL.md) to a skill-rails flow: move the deterministic steps to scripts that the runner executes, keep only the judgment in agent steps, and compare the two versions. Use when asked to migrate, convert or port a skill to skill-rails."
argument-hint: "<path of the skill folder or SKILL.md>"
---

# migrate-to-skill-rails

Run [flow.yaml](flow.yaml) with the [run-skill-rails bootstrap](../run-skill-rails/SKILL.md). Resolve the flow path relative to this SKILL.md. Use the MCP tools when available, or:

```bash
npx -y skill-rails@0.2 start "<absolute-path-to-this-skill>/flow.yaml" --input source="<skill folder or SKILL.md>" [--input request="<extra requirements>"]
```

Pass only inputs supplied by the user. Set `auto=true` only for an explicitly unattended run. Set `compare=true` only when the user requests a live comparison; the flow asks for cost consent before running it. The flow owns the step order, scripts, validation, and failure gates. Do each pending agent step and report its schema-valid output using the bootstrap protocol; report failure if blocked.

Keep the package's skills/ and docs/ layout together so prompts, shared flows, scripts, and references remain available.
