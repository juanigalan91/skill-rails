Read `${{ flow.dir }}/../../docs/format.md` and `${{ flow.dir }}/../../docs/testing.md`.

Skill to update in place: ${{ steps.context.outputs.source }}
Destination: ${{ steps.context.outputs.target }}
Additional request: ${{ inputs.request }}
Unattended: ${{ inputs.auto }}
Assessment: ${{ steps.assess.outputs.verdict }} (${{ join(steps.assess.outputs.reasons, '; ') }})
Files that stay Markdown, unchanged: ${{ join(steps.assess.outputs.keep, ', ') }}

Read the entire original SKILL.md, every file it loads (mode files, templates, references, rule files), every script it runs, and any skills it invokes. Record the inputs and outputs, conditions and gates, and all rules. Split mixed Markdown steps into mechanical scripts, judgment prompts, user questions, skill calls, and stops.

Prepare a table of original steps with their data dependencies and proposed flow types. Map every rule to a specific destination step/script/prompt; do not omit hard rules when optimizing. Call script-only skills directly, collect context in code before prompts, combine adjacent agent work, reference fixed instructions, add deterministic post-edit checks, and use code for fixed reports where possible. An unattended path cannot ask questions.

Return a migration brief plus the full rule mapping before any edits. The shared creation subflow will rewrite the skill in its existing directory. Do not write files in this audit step. Read every required source file now so its rules remain available when the wrapper is replaced. Keep the audit in the structured output; do not generate original copies, sibling -flow folders, backups, or a separate RULES.md file. The migrated skill's behavior must be checked by its deterministic tests and safe smoke run.
