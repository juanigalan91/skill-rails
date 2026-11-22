# Why skill-rails?

[Back to README](../README.md)

## Why use a rails file instead of a Markdown-only skill?

Markdown is a good format for instructions, examples, and judgment. A Markdown skill can already call scripts and keep references in separate files. skill-rails adds an executable contract for how those pieces run together.

| Concern | Markdown-only skill | skill-rails |
|---|---|---|
| Step order | The agent interprets and follows the sequence | The runner selects the next step and rejects submissions for a different step |
| Conditions and gates | The agent evaluates the written rule or calls a script | Expressions decide which steps execute, including failure stops |
| Mechanical work | The agent calls commands or a bundled script | Consecutive shell steps execute without a model turn between them |
| Values between steps | The agent tracks values or reads script outputs | Named outputs are available to later expressions; agent outputs can have JSON Schemas |
| User questions | The agent asks and interprets replies | `ask` defines the questions and validates submitted labels or free-text values |
| Loops and reuse | Instructions or scripts describe the repetition | `foreach`, `repeat`, polling, and nested rails files make the repetition explicit |
| Testing | Scripts can be tested; prompt behavior needs separate evaluation | Fixed agent answers let tests exercise branches, scripts, files, and outputs without a model |
| Inspection and continuation | Depend on the host session and any custom scripts | `status` exposes saved progress and the pending step between calls |

For a repeated release or PR workflow, this means a missing prerequisite can stop the run in code, a malformed output can be rejected before the next command, and a branch can be regression-tested without paying for a model run. Prompts and reference material still belong in Markdown.

The rails file format is the GitHub Actions syntax that you already know: `steps`, `if: ${{ }}`, `run`, `env`, `$RAILS_OUTPUT`.
The agent drives the run from its existing session: you add no new service and no API key. Shell steps execute in the runner process; with MCP, that process has its own configured environment and permissions.

## Where the approach holds up—and where it does not

### Why not just write a better Markdown skill?

For a short task, that is often the better choice. A checklist is easy to read and change, and it leaves room to adapt when the work is exploratory. A rails file becomes useful when the same sequence runs repeatedly and a missed gate, malformed value, or unnecessary tool call has a meaningful cost. Maintaining YAML, schemas, scripts, and tests needs to earn its place.

### Why not just write a script?

If all the work is mechanical, write a script. A Markdown skill that calls one well-tested script can already remove most of the model overhead. skill-rails helps when execution must alternate between code and judgment: collect context, ask the user, request a draft, validate its shape, then continue in code. Its value is coordinating those handoffs, rather than replacing shell scripts.

### Does this make the agent deterministic?

It makes the declared step order explicit and runner-enforced. It does not guarantee identical model answers, correct reasoning, or identical results from commands that depend on networks, time, or changing repositories. A schema can check that a title is a string under 72 characters; it cannot establish that the title accurately describes the change. Add domain checks where possible and evaluate agent quality separately.

### Can the agent still skip a rule or claim it did the work?

The runner rejects out-of-order submissions and invalid outputs, but it trusts accepted agent reports. It cannot prove that a prompt was followed, or prevent the agent from acting outside the run. When enabled and trusted, the [question hook](agents.md#question-hook) guards supported completion calls and checks reported answers against recorded native question-tool responses. It controls the steps; it is not a security boundary. Shell steps run with the runner process's permissions.

### What happens after an interruption?

Saved state lets the agent retrieve the pending step and continue between completed calls. It is not a transaction log or an exactly-once execution guarantee: a command can change an external system before the updated state is saved. Make side effects safe to retry or check whether they already happened. State is local, stored in a temporary directory by default, and keyed by project directory and rails name; concurrent runs of the same rails file need separate state directories.

### Will it always be faster or cheaper?

No. Batching mechanical steps can reduce model turns, but each agent handoff still adds work, and research-heavy skills may gain little. Agent installation, tool timeouts, Bash availability, and skill discovery also vary; see [agent compatibility](agents.md).

Start with Markdown and scripts. Add a rails file when repeated handoffs, gates, and testable branches justify the extra structure. See the [walkthrough](walkthrough.md) for a concrete example.

## Faster and cheaper

Each model turn adds latency and context processing. Batching mechanical work can reduce that overhead.
skill-rails removes the turns that need no judgment.

- **Fewer turns.** Consecutive `run` steps execute in one runner call, with no model turn between them.
  A Markdown skill can batch commands too; the runner makes that batching explicit and testable.
- **Smaller context.** `SKILL.md` holds only the start command.
  The runner gives the agent one step’s instructions at a time; prompts for skipped branches are not included in its reports.
- **Less orchestration work.** The runner selects the next step, evaluates conditions, and passes values between steps.
  The runner does this in code, and gives each step the values it needs.
- **Short answers.** An agent step reports compact JSON that matches its schema.
  Scripts do the parsing and the formatting that a model otherwise writes token by token.
- **Early failure.** A gate stops the run before the costly steps, and a malformed output is refused at once.
  The agent corrects one step, and does not redo the work of the steps after it.
- **Repeatable tests.** Fixed agent answers let tests exercise the steps without spending model tokens.
  Live paths and costs still depend on agent answers, command results, and external state.

The gain is small when most of the work is research or writing that only the model can do: each agent step is still a model turn.

## Security

- A YAML `run` command cannot hold `${{ }}`. Pass values through quoted `args` or through `env` and quote shell variable expansions. Avoid evaluating untrusted values as shell code.
- The runner runs the scripts of the rails file with the permissions of the user who starts it.
  Read a rails file and its scripts before you run them, as you read any script.

## Related projects

- [claude-workflow](https://github.com/AxGord/claude-workflow): YAML state machines that a Claude Code agent moves through with an MCP server.
  skill-rails adds schema-validated outputs, user questions, and the GitHub Actions syntax.
- [Archon](https://github.com/coleam00/Archon) and [GitHub Agentic Workflows](https://github.com/github/gh-aw): the runner starts the agent.
  In skill-rails, the agent drives the runner from inside its own session.
- [Goose recipes](https://github.com/aaif-goose/goose): YAML recipes with structured output.
