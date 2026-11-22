Read the rails file format at `${{ rails.dir }}/../../docs/format.md` and the testing guide at `${{ rails.dir }}/../../docs/testing.md`. Resolve paths from the skill package, not the project.

Request: ${{ inputs.request }}
Destination, if specified: ${{ inputs.target }}
Existing skill directory, for an in-place migration: ${{ inputs.source }}
Unattended: ${{ inputs.auto }}

Establish the purpose, inputs, interactive or unattended behavior, tools, other skills, and destination from the request. Ask only for missing information. In unattended mode, do not ask or guess missing essential information: fail with a reason.

Design steps in order. Mechanical work belongs in scripts, judgment in prompts with minimal output schemas, user decisions in ask steps, reusable rails files in uses, and gates in conditional stops. Unattended skills must not ask questions. Call another skill's script directly when its work is entirely mechanical. Merge adjacent judgment steps, collect context before agent steps, move long fixed rules to referenced Markdown, and plan checks after agent edits with repair prompts only on failure.

For a migration, read the existing SKILL.md and every referenced file, script, and invoked skill before any edits. Preserve the supplied rule mapping, conditions, and gates. The provided destination is the existing skill directory: update it directly without creating source snapshots, backups, or a sibling folder. Keep the audit in the structured outputs, not a generated RULES.md file.

Show the design as a table (id, type, purpose) before writing files, unless unattended. This is a design explanation, not an extra approval gate. Report name, description, target, and the planned steps matching the output schema. Honor an explicitly supplied target.
