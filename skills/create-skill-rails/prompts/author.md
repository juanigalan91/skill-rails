Write the skill in `${{ steps.scaffold.outputs.target }}` using this plan:
${{ toJSON(steps.plan.outputs.steps) }}

Request: ${{ inputs.request }}
Existing skill to update, if migrating: ${{ inputs.source }}

For creation, the runner created scripts/, prompts/, tests/, and SKILL.md from the packaged template. For migration, it ensured those directories exist while leaving the current SKILL.md for you to replace directly. Finish the wrapper's inputs and instructions without moving the folder. Keep the bootstrap protocol, relative rails file resolution, project directory, schema recovery, failure handling, questions that wait for the user, and polling retryAt behavior.

- rails.yaml holds the order, conditions, and inputs. Use run: <script>.sh and prompt: prompts/<id>.md.
- Shell scripts start with #!/usr/bin/env bash and set -eo pipefail; Node scripts start with #!/usr/bin/env node. Make every script executable and run it by name (run: build.sh), with no $RAILS_DIR path: scripts/ is in PATH. Outputs use RAILS_OUTPUT (key=value or multiline delimiters); user notes use ::warning::.
- Never interpolate expressions into run commands. Pass values through env instead: the format checker rejects expressions in run.
- Prompts may interpolate previous outputs with the documented expression syntax. Keep schemas to the values used by later steps or the final report.
- Give mechanical work to scripts, and merge agent steps that need no gate between them: each agent step costs a model turn.
- Every ask option needs a label and description. Unattended paths cannot ask questions.
- Add deterministic *.test.yaml cases for the main path and relevant gates/failures. Use disposable fixtures and stub external commands. Tests must never push, publish, send messages, or create real remote resources. The runner will execute these tests automatically, so stub side effects before reporting this step done.
- For a migration, replace SKILL.md and update the existing directory directly using the prior rule audit. Preserve every required rule and reference. Remove obsolete files only when they are part of this migration; preserve unrelated files and existing useful scripts/tests. Do not create backups, original copies, sibling -rails folders, or RULES.md. Report the rule mapping in the final response instead.

Report completion only after the files are ready for the runner's check. If you cannot complete the work, fail the step with the reason.
