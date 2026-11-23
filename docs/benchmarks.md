# Benchmarks

These benchmarks compare one set of skills in three forms: plain Markdown, a YAML rails file, and a TypeScript rails file.
They use `skill-rails bench` (see [Testing](testing.md#bench)).

## Method

- **Skills.** Four skills of one plugin, from a mechanical one to a judgment-heavy one:
  - push the current branch (one script);
  - read the context of the PR of the current branch (one script);
  - find and run the test and lint commands of a repository (one agent step finds them, a script runs them);
  - open a PR unattended: read the Git context, the PR template and the conventions, write the title and the body, check the body, push, and create the PR (many mechanical steps, two agent steps).
- **Variants.** The Markdown versions are the versions of the same skills before their migration. The YAML and TypeScript versions are the migrated skills. Each variant is a separate plugin folder.
- **Agent.** Claude Code in headless mode: `claude -p --output-format json --model sonnet --strict-mcp-config --setting-sources project`, with only the plugins of the variant (`--plugin-dir`), no user MCP server, no user settings, and an explicit list of allowed tools.
- **Environment.** Each run starts in a new temporary Git repository with a local bare remote. Stub `gh` and `curl` commands record the calls; nothing reaches GitHub. The PR task has a PR template with an HTML comment that must stay in the body.
- **Correctness.** Deterministic checks on the fixture after the run: the branch is on the remote, the answer gives the PR number and its base, both check commands ran, and the stub `gh` received a `pr create --draft` call.
- **Runs.** 5 runs per task and variant, 60 runs in total, in a shuffled order, and 20 more runs for the rails versions of the last two tasks after the changes below.
- **Measures.** The wall time of the run, the turns, the input and output tokens, and the cost, from the JSON output of the agent.

## Results

All 60 initial runs and 20 follow-up runs passed their fixture checks. Each table cell reports five runs, using the follow-up results for the revised rails skills.

| Task | Variant | Turns | Time | Cost | Input tokens | Output tokens |
|---|---|---|---|---|---|---|
| Push a branch | Markdown | 4 | 5.8 s | $0.054 | 74,481 | 267 |
| | YAML | 4 | 7.2 s | $0.056 | 74,890 | 317 |
| | TypeScript | 4 | 8.2 s | $0.056 | 74,885 | 314 |
| Read the PR context | Markdown | 4 | 7.6 s | $0.055 | 74,914 | 276 |
| | YAML | 4 | 7.6 s | $0.057 | 75,319 | 328 |
| | TypeScript | 4 | 7.1 s | $0.057 | 75,315 | 327 |
| Run the checks | Markdown | 5 | 12.1 s | $0.069 | 102,443 | 964 |
| | YAML | 6 | 15.8 s | $0.078 | 131,536 | 1,108 |
| | TypeScript | 6 | 14.4 s | $0.077 | 131,182 | 1,037 |
| Open a PR, unattended | Markdown | 23 | 36.0 s | $0.178 | 526,413 | 2,975 |
| | YAML | 8 | 16.8 s | $0.094 | 194,286 | 1,241 |
| | TypeScript | 8 | 17.9 s | $0.094 | 194,319 | 1,242 |

The values are medians of 5 runs.
The spread was small: for example, 22 to 25 turns for the Markdown PR task.

The first run of the rails versions of the last two tasks took more turns: 8 for the checks ($0.090) and 10 for the PR ($0.104).
The transcripts showed where the turns went, and two changes to the skills removed them:

- The check task had a second agent step that only ran the commands that the first step found. A script now runs them.
- In the PR task, the agent used a turn to read the PR template and to look for convention files, and another one to print the body file before its Read. The prompt now holds the template text and says when the repository has no convention files, and it asks for the Read tool.

The runner alone, with fixed answers and no model, took a median of 85 ms per test for YAML and 95 ms for TypeScript, over 52 tests: the TypeScript replay adds about 5 ms per call.

## What the results show

- **Many mechanical steps: a large gain.** The PR task took 65% fewer turns, 53% less time, and cost 47% less as a rails file. The Markdown version spends turns on each Git command, on reading each result, and on the order of the steps; the runner does that work in one call.
- **One script: no gain.** The skill was already one command. The rails versions cost about 4% more: the agent reads the start report, then runs the command that the report gives.
- **Mostly judgment: a small cost.** The check task is one agent step (find the commands) between runner steps. The rails version took 1 more turn and cost 13% more than the Markdown version, which the agent did in one pass. With a second agent step that only ran the commands, it cost 30% more: give mechanical work to a script, and merge agent steps that need no gate between them. `skill-rails check` now warns about these designs.
- **YAML and TypeScript: the same.** The agent gets the same reports from both. Their difference is the noise of the measure, at most 1 turn and 4% of the cost here.
- **Read the transcripts.** Each extra turn in a transcript is a step that a script or a better prompt can remove.

## Limits

- One model, one set of skills, and 5 runs per cell: a small sample.
- Unattended runs only: no run asked the user a question.
- The Markdown versions are the earlier versions of the same skills, so their text is not identical to the prompts of the rails versions.
- The checks test the result of each run, and not the quality of the text that the agent wrote.

## Run your own

```yaml
# bench.yaml
tests: tests                  # mode: agent tests with a request and file checks
runs: 5
variants:
  markdown: { markdown: true, agent: ./agent.sh markdown }
  yaml: { agent: ./agent.sh yaml }
  ts: { rails: rails.ts, agent: ./agent.sh ts }
```

```bash
npx skill-rails bench bench.yaml --live --out results.csv --transcripts transcripts
```

`agent.sh <variant>` runs the agent with only the plugin folder of that variant.
Keep the transcripts: a failed run is often a setup problem, such as a plugin dependency that did not load, and the transcript shows it.
