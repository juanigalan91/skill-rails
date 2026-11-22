# Benchmarks

These benchmarks compare one set of skills in three forms: plain Markdown, a YAML rails file, and a TypeScript rails file.
They use `skill-rails bench` (see [Testing](testing.md#bench)).

## Method

- **Skills.** Four skills of one plugin, from a mechanical one to a judgment-heavy one:
  - push the current branch (one script);
  - read the context of the PR of the current branch (one script);
  - find and run the test and lint commands of a repository (several agent steps);
  - open a PR unattended: read the Git context and the conventions, write the title and the body from the PR template, check the body, push, and create the PR (many mechanical steps, two agent steps).
- **Variants.** The Markdown versions are the versions of the same skills before their migration. The YAML and TypeScript versions are the migrated skills. Each variant is a separate plugin folder.
- **Agent.** Claude Code in headless mode: `claude -p --output-format json --model sonnet --strict-mcp-config --setting-sources project`, with only the plugins of the variant (`--plugin-dir`), no user MCP server, no user settings, and an explicit list of allowed tools.
- **Environment.** Each run starts in a new temporary Git repository with a local bare remote. Stub `gh` and `curl` commands record the calls; nothing reaches GitHub. The PR task has a PR template with an HTML comment that must stay in the body.
- **Correctness.** Deterministic checks on the fixture after the run: the branch is on the remote, the answer gives the PR number and its base, both check commands ran, and the stub `gh` received a `pr create --draft` call.
- **Runs.** 5 runs per task and variant, 60 runs in total, in a shuffled order.
- **Measures.** The wall time of the run, the turns, the input and output tokens, and the cost, from the JSON output of the agent.

## Results

Every run of every variant passed its checks: 20 of 20 for each variant.

| Task | Variant | Turns | Time | Cost | Input tokens | Output tokens |
|---|---|---|---|---|---|---|
| Push a branch | Markdown | 4 | 5.8 s | $0.054 | 74,481 | 267 |
| | YAML | 4 | 7.2 s | $0.056 | 74,890 | 317 |
| | TypeScript | 4 | 8.2 s | $0.056 | 74,885 | 314 |
| Read the PR context | Markdown | 4 | 7.6 s | $0.055 | 74,914 | 276 |
| | YAML | 4 | 7.6 s | $0.057 | 75,319 | 328 |
| | TypeScript | 4 | 7.1 s | $0.057 | 75,315 | 327 |
| Run the checks | Markdown | 5 | 12.1 s | $0.069 | 102,443 | 964 |
| | YAML | 8 | 17.3 s | $0.090 | 189,132 | 1,350 |
| | TypeScript | 8 | 18.9 s | $0.091 | 188,559 | 1,464 |
| Open a PR, unattended | Markdown | 23 | 36.0 s | $0.178 | 526,413 | 2,975 |
| | YAML | 10 | 19.7 s | $0.104 | 252,402 | 1,437 |
| | TypeScript | 10 | 18.6 s | $0.100 | 222,726 | 1,402 |

The values are medians of 5 runs.
The spread was small: for example, 22 to 25 turns for the Markdown PR task, and 9 to 11 for the rails versions.

The runner alone, with fixed answers and no model, took a median of 85 ms per test for YAML and 95 ms for TypeScript, over 52 tests: the TypeScript replay adds about 5 ms per call.

## What the results show

- **Many mechanical steps: a large gain.** The PR task took 57% fewer turns, 45% less time, and cost 42% less as a rails file. The Markdown version spends turns on each Git command, on reading each result, and on the order of the steps; the runner does that work in one call.
- **One script: no gain.** The skill was already one command. The rails versions cost about 4% more: the agent reads the start report, then runs the command that the report gives.
- **Many agent steps: a cost.** The check task has two agent steps (find the commands, then run them) between runner steps that list the conventions and record the changed files. Each agent step is a turn, so the rails version took 3 more turns and cost 30% more than the Markdown version, which the agent did in one pass. Merge agent steps that need no gate between them.
- **YAML and TypeScript: the same.** The agent gets the same reports from both. Their difference is the noise of the measure, at most 1 turn and 4% of the cost here.

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
