# Agent compatibility

skill-rails uses the same CLI, stdio MCP server, and SKILL.md instructions across agents. Node 20+ and Bash must be available where the runner executes. Windows requires a Bash environment such as WSL; native Windows is not verified. Remote agents need the package, flow files, and project checkout in their own execution environment.

## Status

| Client | Skill discovery location (project) | Integration | Live verification |
|---|---|---|---|
| Claude Code | Plugin marketplace | Existing plugin | Not rerun for these changes |
| Codex CLI / IDE | Native plugin or `.agents/skills/` | Plugin, CLI or stdio MCP | Marketplace discovery verified; agent-driven flows pending |
| Cursor | `.cursor/skills/` | CLI or stdio MCP | Pending |
| Copilot in VS Code | `.github/skills/` | CLI or stdio MCP | Pending |
| Gemini CLI | `.gemini/skills/` | CLI or stdio MCP | Pending |
| OpenCode v2 | `.opencode/skills/` | CLI or stdio MCP | Pending |

This table describes setup targets, not certified client behavior. Copilot cloud agent, browser-only clients, and hosted remote MCP deployments are outside this initial support scope.

## Use the current checkout

Native Codex plugin packaging is included from `skill-rails@0.2.2`. To try local runner changes, build this checkout:

```bash
yarn install --immutable
yarn build
node /absolute/path/to/skill-rails/bin/skill-rails.js check /absolute/path/to/rails.yaml
```

In the configuration examples below, replace both absolute paths. `command: node` must resolve on the client's PATH; use an absolute Node executable if necessary. Merge these entries into existing configuration rather than replacing it.

The project directory controls shell execution and state lookup. The flow path is resolved relative to that directory; supporting scripts and prompts remain relative to the flow file. Use a separate MCP server entry for each project. `start`, `done`, and `status` reports include `cwd` so the agent can check the selected workspace.

### Codex

Install the plugin from this checkout:

```bash
codex plugin marketplace add /absolute/path/to/skill-rails
codex plugin add skill-rails@skill-rails
```

Install directly from the GitHub repository:

```bash
codex plugin marketplace add juanigalan91/skill-rails
codex plugin add skill-rails@skill-rails
```

Use a Codex version whose `codex plugin --help` exposes these commands. Restart the client or start a new session after installation. The plugin bundles `run-skill-rails`, `create-skill-rails`, and `migrate-to-skill-rails`, plus the stdio MCP server; no manual skill wrappers or separate MCP registration are needed. In desktop clients, the marketplace can also be browsed through the Plugins UI.

Launch Codex in the intended project and check `cwd` in the first flow report. The bundled MCP server uses `npx -y skill-rails@0.2 mcp`, so Node, npm, Bash, and access to the npm registry (or a cached package) are required. The plugin installs instructions and configuration; it does not vendor npm dependencies or install Node.

The package has portable `plugin.json` and `mcp.json` files, a `.codex-plugin/plugin.json` compatibility manifest, and a `.agents/plugins/marketplace.json` catalog pointing to the package root. Both formats share the same skills and npm runner as the Claude plugin. This adds local/Git marketplace support, not public-directory publication.

Marketplace discovery was verified with Codex CLI `0.169.0-alpha.11.1`. Complete the smoke test below before treating agent-driven workflows as verified.

For clients without native plugin installation, use the manual skills setup below and register the checkout's server:

```bash
codex mcp add skill-rails -- node /absolute/path/to/skill-rails/bin/skill-rails.js mcp --cwd /absolute/path/to/project
```

Sources: [plugin packaging](https://developers.openai.com/plugins/build/plugins), [local skills](https://learn.chatgpt.com/docs/build-skills), [MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "skill-rails": {
      "command": "node",
      "args": ["/absolute/path/to/skill-rails/bin/skill-rails.js", "mcp", "--cwd", "/absolute/path/to/project"]
    }
  }
}
```

Sources: [skills](https://prod.cursor.com/help/customization/skills), [MCP](https://prod.cursor.com/help/customization/mcp).

### GitHub Copilot in VS Code

Add to `.vscode/mcp.json` (VS Code uses `servers`, not `mcpServers`):

```json
{
  "servers": {
    "skill-rails": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/skill-rails/bin/skill-rails.js", "mcp", "--cwd", "/absolute/path/to/project"]
    }
  }
}
```

Sources: [skills](https://code.visualstudio.com/docs/agent-customization/agent-skills), [MCP](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

### Gemini CLI

Merge into `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "skill-rails": {
      "command": "node",
      "args": ["/absolute/path/to/skill-rails/bin/skill-rails.js", "mcp", "--cwd", "/absolute/path/to/project"]
    }
  }
}
```

Sources: [skills](https://geminicli.com/docs/cli/skills/), [MCP](https://geminicli.com/docs/tools/mcp-server/).

### OpenCode v2

Merge into `opencode.json`. This is the v2 configuration shape; consult the matching documentation for older versions.

```json
{
  "mcp": {
    "servers": {
      "skill-rails": {
        "type": "local",
        "command": ["node", "/absolute/path/to/skill-rails/bin/skill-rails.js", "mcp", "--cwd", "/absolute/path/to/project"]
      }
    }
  }
}
```

Sources: [skills](https://opencode.ai/docs/skills/), [MCP](https://opencode.ai/docs/mcp-servers).

## Install the skills manually

Skip this section when using the native plugin. For a manual installation, keep this checkout available. For each entry in `skills/`, create a folder in the client's skill discovery directory from the table above, with a `SKILL.md` wrapper containing the matching name and description and an absolute link to the original instructions. For example, `.agents/skills/run-skill-rails/SKILL.md`:

```markdown
---
name: run-skill-rails
description: Run a skill-rails YAML flow, one validated step at a time.
---

Read and follow [the runner instructions](/absolute/path/to/skill-rails/skills/run-skill-rails/SKILL.md).
Use the configured skill-rails MCP tools. For CLI fallback in this checkout, replace
`npx -y skill-rails@0.2` with `node /absolute/path/to/skill-rails/bin/skill-rails.js`.
```

Repeat for `create-skill-rails` and `migrate-to-skill-rails`, linking to their corresponding files and describing their purpose. This keeps templates and documentation beside their original skills; copying only a skill directory would break its links to `../../docs/`. After publication, wrappers can point to a stable installed package instead. Restart or reload skills in the client and verify discovery.

For CLI-only use, load the same instructions and use:

```bash
node /absolute/path/to/skill-rails/bin/skill-rails.js start /absolute/path/to/rails.yaml --cwd /absolute/path/to/project
node /absolute/path/to/skill-rails/bin/skill-rails.js done <flow-name> <step-id> --cwd /absolute/path/to/project --output - <<'JSON'
{}
JSON
```

Pass the same project directory to subsequent `done`, `status`, and `reset` calls. Never supply a guessed answer to an interactive step.

## Host behavior

- Questions: use a native question tool when it supports the question. Otherwise display the question, labels, descriptions and previews in chat and wait for the user's response. Multi-select produces a list of labels; free text produces a string. Unattended flows must avoid questions or take explicit inputs that skip them.
- Skills: use the host's skill loader or read the installed named skill. If unavailable, fail the step with a reason. No Claude slash-command syntax is required.
- Polling: the default call slice is 20 seconds. A `wait` report includes `retryAt` in Unix milliseconds. Resume with `done` at or after that time. Early calls do not execute the check early. `SKILL_RAILS_WAIT_SLICE_SECONDS` adjusts the slice; a poll command exceeding the remaining slice fails, so checks should be short.
- Ordinary `run` steps still have their own timeout (default 10 minutes); multiple steps can execute in one call. The polling slice is not a global tool-call deadline. For long work, launch a background job and poll its status, or configure the host timeout to fit the flow.
- Execution: shell commands run with the runner process's permissions. An MCP client's per-command approval and sandbox rules do not necessarily apply inside the MCP server. Review scripts and configure the server environment accordingly.

## Repeatable client smoke test

Use a disposable project and this checkout's `examples/hello/rails.yaml`:

1. Confirm all three skills are discoverable and the create skill can read its format reference and template.
2. Ask the runner skill to start `hello`, using the intended project. Check `cwd` in the report.
3. Confirm the greeting question appears and the agent waits. Choose `Good`; complete the poem and verify the final message. Repeat with `Bad` and verify the poem step is skipped.
4. Through MCP or CLI, submit an invalid poem output, verify `invalid`, then submit a valid output and finish. Check `status` after restarting the client.
5. Exercise a flow with a `skill` step using a small installed skill, then an unavailable skill; confirm the latter fails clearly.
6. Exercise a polling flow with a 30-second interval. Check that it returns `wait`, preserves `retryAt` across `status`, and resumes when due without an early check.
7. Run the CLI fallback from a different directory with `--cwd` and confirm files and state belong to the selected project.

Record client version, OS, transport, date, and results before marking a client verified. Automated CLI, in-memory MCP, schema validation, and polling tests validate the protocol; they do not establish that a particular model follows the skills correctly.
