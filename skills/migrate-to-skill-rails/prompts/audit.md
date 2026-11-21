Read `${{ flow.dir }}/../../docs/format.md` and `${{ flow.dir }}/../../docs/testing.md`.

Original: ${{ steps.context.outputs.source }}
Destination: ${{ steps.context.outputs.target }}
Additional request: ${{ inputs.request }}
Unattended: ${{ inputs.auto }}

Read the entire original SKILL.md, every file it loads (mode files, templates, references, rule files), every script it runs, and any skills it invokes. Record the inputs and outputs, conditions and gates, and all rules. Split mixed Markdown steps into mechanical scripts, judgment prompts, user questions, skill calls, and stops.

Prepare a table of original steps with their data dependencies and proposed flow types. Map every rule to a specific destination step/script/prompt; do not omit hard rules when optimizing. Call script-only skills directly, collect context in code before prompts, combine adjacent agent work, reference fixed instructions, add deterministic post-edit checks, and use code for fixed reports where possible. An unattended path cannot ask questions.

Return a migration brief plus the full rule mapping. The shared creation subflow will design and write the new skill next to the original. Do not modify or delete the original and do not write the destination yet. Keep the original until the tests and audit demonstrate preserved behavior. Live comparison is a separate optional step with explicit cost consent.
