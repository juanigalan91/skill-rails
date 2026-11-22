// The host hook: a run can go past an ask step only after the agent asked its questions with the question tool of the host.
// The same command serves Claude Code and Codex: both send one JSON object on stdin, with the same fields.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from './state.js';
import type { State } from './types.js';

export interface HookInput {
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
}

/** The question tools of the hosts: Claude Code, then Codex. */
export const QUESTION_TOOLS = /^(AskUserQuestion|request_user_input)$/;
const DONE_COMMAND = /skill-rails(?:@\S+|\.js)?\s+done\s+(\S+)\s+(\S+)/;
const DONE_TOOL = /rails_done$/;

const unquote = (word: string) => word.replace(/^['"]|['"]$/g, '');

/** The hook output: a JSON text for stdout, or nothing to let the call go on. */
export function hook(input: HookInput): string {
  try {
    if (input.hook_event_name === 'PostToolUse' && QUESTION_TOOLS.test(input.tool_name ?? '')) recordAnswers(input);
    if (input.hook_event_name === 'PreToolUse') return checkDone(input);
  } catch {
    // A hook error must never block the agent: the run then works as with no hook.
  }
  return '';
}

const canonical = (cwd: string) => fs.existsSync(cwd) ? fs.realpathSync(cwd) : path.resolve(cwd);

function runs(cwd: string): Array<{ file: string; state: State }> {
  const dir = stateDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      const file = path.join(dir, name);
      try {
        return [{ file, state: JSON.parse(fs.readFileSync(file, 'utf8')) as State }];
      } catch {
        return [];
      }
    })
    .filter(({ state }) => state.pending?.type === 'ask' && state.rails?.name && typeof state.cwd === 'string' && canonical(state.cwd) === canonical(cwd));
}

const parse = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/** The answers map of the tool call: by question text (Claude Code) or by question id. */
function answersOf(input: HookInput): Record<string, unknown> | null {
  for (const source of [parse(input.tool_response)]) {
    const answers = (source as { answers?: unknown } | null)?.answers;
    if (answers && typeof answers === 'object' && !Array.isArray(answers)) return answers as Record<string, unknown>;
  }
  return null;
}

/** After a question tool call: the user's answers go to the pending ask step that has the same questions. */
function recordAnswers(input: HookInput): void {
  const answers = answersOf(input);
  if (!answers) return;
  const matches = [];
  for (const { file, state } of runs(input.cwd ?? process.cwd())) {
    const questions = state.pending?.questions ?? [];
    const asked: Record<string, unknown> = {};
    for (const question of questions) {
      let answer = answers[question.question] ?? answers[question.id];
      if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
        const selected = (answer as { answers?: unknown }).answers;
        if (!Array.isArray(selected) || !selected.every((value) => typeof value === 'string')) break;
        if (!question.multiSelect && selected.length !== 1) break;
        answer = question.multiSelect ? selected : selected[0];
      }
      if (answer === undefined) break;
      asked[question.id] = answer;
    }
    if (!questions.length || Object.keys(asked).length !== questions.length) continue;
    matches.push({ file, state, asked });
  }
  // A response must identify one pending step in the host project, not authorize several runs.
  if (matches.length !== 1) return;
  const { file, state, asked } = matches[0]!;
  state.pending!.asked = asked;
  fs.writeFileSync(file, JSON.stringify(state));
}

/** The rails name and the step id of a done call, from a shell command or the MCP tool. */
function doneCall(input: HookInput): { rails: string; id: string; fail: boolean; cwd: string } | null {
  const toolInput = (parse(input.tool_input) ?? {}) as Record<string, unknown>;
  const cwd = input.cwd ?? process.cwd();
  if (DONE_TOOL.test(input.tool_name ?? '')) {
    return { rails: String(toolInput.rails ?? ''), id: String(toolInput.step ?? ''), fail: Boolean(toolInput.fail), cwd };
  }
  const command = Array.isArray(toolInput.command) ? toolInput.command.join(' ') : String(toolInput.command ?? toolInput.cmd ?? '');
  const match = DONE_COMMAND.exec(command);
  const directory = /\s--cwd(?:=|\s+)(?:'([^']*)'|"([^"]*)"|(\S+))/.exec(command);
  return match ? {
    rails: unquote(match[1]!), id: unquote(match[2]!), fail: /\s--fail\b/.test(command),
    cwd: directory ? path.resolve(cwd, directory[1] ?? directory[2] ?? directory[3]!) : cwd,
  } : null;
}

/** Before a done call: deny it while its ask step has no answers from the question tool. */
function checkDone(input: HookInput): string {
  const call = doneCall(input);
  if (!call || call.fail) return '';
  const waiting = runs(call.cwd).filter(({ state }) => state.rails.name === call.rails && state.pending?.id === call.id);
  if (!waiting.length || waiting.some(({ state }) => state.pending?.asked)) return '';
  const questions = (waiting[0]!.state.pending?.questions ?? []).map((question) => `- ${question.question}`).join('\n');
  const reason = `Step "${call.id}" is an ask step. Ask the user these questions with your question tool, exactly as they are, then report the answers:\n${questions}`;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
}

/** The hooks configuration for Claude Code and Codex: hooks/hooks.json of the plugin, or a user or project hooks file. */
export const HOOKS_CONFIG = (command: string) => ({
  hooks: {
    PreToolUse: [{ matcher: 'Bash|mcp__.*rails_done', hooks: [{ type: 'command', command: guarded(command), timeout: 30 }] }],
    PostToolUse: [{ matcher: 'AskUserQuestion|request_user_input', hooks: [{ type: 'command', command: `${command} hook`, timeout: 30 }] }],
  },
});

// PreToolUse fires for every shell command: start Node only for a done call.
const guarded = (command: string) => `i=$(cat); case "$i" in *rails_done*|*skill-rails*done*) printf '%s' "$i" | ${command} hook;; esac`;
