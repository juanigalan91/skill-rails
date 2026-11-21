# Bundled skills: migration audit

The create and migrate skills now run as flows in their existing folders, preserving their plugin names. Their pre-migration instructions remain available in Git history; no duplicate originals are shipped.

## Design

| Workflow | Step | Responsibility |
|---|---|---|
| Create | plan (prompt) | Resolve requirements, classify and optimize steps, show the design when interactive |
| Create | scaffold (run) | Refuse an existing destination, create directories, copy and fill the wrapper template |
| Create | author (prompt) | Write the flow, scripts, prompts, deterministic tests, and migration audit when applicable |
| Create | check (run) | Validate the YAML and run the generated deterministic tests |
| Create | fix (conditional prompt), recheck (run) | Repair failures once, then gate continuation on a passing check |
| Create | smoke (prompt), stop | Exercise the generated skill safely and report files, step table, and code/agent counts |
| Migrate | context (run), audit (prompt) | Resolve source/destination, inspect all dependencies, map every original rule |
| Migrate | create (uses) | Reuse the creation flow with the original source, sibling destination, and rule mapping |
| Migrate | consent (ask), compare (prompt) | Offer live comparisons only when requested and interactive; require cost consent |
| Migrate | stop | Report creation evidence, retained source, and comparison result or explicit omission |

Creation takes three agent steps normally (plan, author, smoke), plus one repair prompt on validation failure. Migration adds an audit step and, only when requested, a consent question and comparison prompt. These are step counts, not measured model-turn or latency improvements.

## Rule preservation

| Original requirement | Destination |
|---|---|
| Read the flow reference before designing | create/prompts/plan.md and migrate/prompts/audit.md |
| Resolve references from the skill package | Short wrappers and absolute flow.dir references in prompts |
| Establish purpose, inputs, interaction mode, tools, other skills, and destination | create/prompts/plan.md |
| Ask only for missing information; unattended skills never ask | plan.md, explicit auto input, comparison condition |
| Classify mechanical work, judgment, user decisions, skill calls, and gates | plan.md and audit.md |
| Show the step table before writing unless unattended | plan.md, before scaffold and author |
| Minimize agent handoffs, collect context, reference fixed rules, check edits | plan.md and audit.md |
| Copy the generated-skill template and fill its metadata | scripts/scaffold.mjs; author.md completes inputs |
| Keep sequence/conditions/inputs in YAML; shell code and prompts in their own files | author.md |
| Scripts use a Bash shebang, pipefail, executable mode, FLOW_OUTPUT, warning notes | author.md |
| Pass expression values via env, never interpolate run commands | author.md and the runner's format validator |
| Ask options have labels/descriptions; schemas contain needed outputs | author.md |
| Validate, fix errors, and exercise a safe copy before real use | check, conditional fix/recheck, failure stop, smoke |
| Never publish, push, send messages, or create remote resources during tests | author.md, fix.md, smoke.md, compare.md; deterministic scenarios stub npx locally |
| Report files, step table, and code/agent counts | smoke.md and its output schema |
| Migrate next to the original and keep it intact | context.mjs selects a sibling -flow folder; prompts prohibit original edits |
| Read every loaded file, script, and called skill | audit.md and plan.md |
| Map every rule and gate to the new implementation | audit output schema and generated RULES.md; validation requires that file |
| Use the creation skill's file rules | uses subflow, avoiding duplicate authoring instructions |
| Optional live comparison only with cost agreement | compare input defaults false; consent question gates the compare prompt |
| Same input, at least three runs per version, disposable copies, available host metrics | compare.md |
| Do not assume Claude CLI exists or fabricate unavailable metrics | compare.md |
| Retain original until tests/audit demonstrate preserved behavior | audit.md and plan.md; neither runner script removes the original |

One bounded repair pass replaces an unbounded "fix each error" loop. Unresolved errors stop the flow with diagnostics; edits remain for inspection and manual repair. Fresh destinations are required so scaffolding cannot overwrite existing work. The authoring prompt can still be reported failed if required information or a safe smoke environment is unavailable.

## Why the runner skill remains Markdown

`run-skill-rails` is the bootstrap protocol: it teaches an agent how to start a flow, perform a pending step, submit output, and handle errors, user questions, and polling. Making that protocol another flow would still require an outer copy of the same protocol and could recurse into itself. It stays as a small Markdown adapter, as do the generated SKILL.md wrappers and judgment prompts.

## Evidence and limits

Run `yarn test` or `node bin/skill-rails.js test skills` after building. The scenarios exercise scripts and runner state with fixed agent answers, including successful creation, repair, permanent failure, missing tests, existing destinations, literal metacharacters in paths, retained originals, subflow failures, and comparison consent. The npx stub routes only runner invocations to this checkout; tests make no registry calls.

These tests verify control flow and artifacts. They cannot establish that an actual model preserves every semantic rule or performs the reported smoke/comparison work. No paid live benchmark was run, and no speed or cost improvement is claimed for this migration.
