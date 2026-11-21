The flow and deterministic tests passed for `${{ steps.scaffold.outputs.target }}`.

Before a real use, exercise the generated flow once in a safe disposable copy or fixture, using a local remote and stubs for any external side effects. Never push, publish, send messages, or create real PRs during this smoke run. Use the run-skill-rails bootstrap protocol to drive agent steps; use a separate working directory so nested flows cannot overwrite this authoring flow's state. If the environment cannot safely exercise the flow, fail this step and explain the blocker instead of claiming a successful smoke run.

Inspect the actual generated files and report the file list, step table, counts of code and agent steps, validation result, and what the safe smoke run covered. For a migration, include the RULES.md audit and any behavioral differences. Return report, files, codeSteps, and agentSteps. Do not claim live model benchmarks from deterministic tests.
