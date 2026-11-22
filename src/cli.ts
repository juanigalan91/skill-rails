import fs from 'node:fs';
import path from 'node:path';
import { check, done, reset, start, status } from './api.js';
import type { Report } from './types.js';
import { RANGE } from './version.js';

const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

/** How the agent acts on each result: the start report holds it, so that a skill needs no copy of it. */
export const PROTOCOL = [
  'Act on the status of each result.',
  'step: do its instructions, or ask its questions with your question tool and wait for the answers; then run its next command, with your output as JSON when the command asks for it.',
  'When a step has a directory, do the step in that folder.',
  'A skill step: load the named skill with args first. An ask step: ask the questions as they are, never invent an answer, and report one property per question id. A wait step: wait until retryAt (Unix milliseconds), then run next.',
  'If you cannot do a step, run its next command with --fail "<reason>" in place of the output.',
  'invalid: correct the output and run the command again.',
  'done: tell the user the message, and use the outputs.',
  'failed or error: tell the user the message or the errors, and stop.',
  'Tell the user each line of notes.',
  'Do not show the commands or their JSON to the user.',
].join('\n');

/** The command that reports the step of a result, so that a skill needs no copy of the protocol. */
export function withNext(result: Report): Report {
  if (result.status !== 'step') return result;
  // SKILL_RAILS_COMMAND runs another build, for example a local checkout: node <checkout>/bin/skill-rails.js.
  const base = `${process.env.SKILL_RAILS_COMMAND || `npx -y skill-rails@${RANGE}`} done ${result.rails} ${result.id}${result.cwd ? ` --cwd ${quote(result.cwd)}` : ''}`;
  const next = result.type !== 'wait' && result.output ? `${base} --output - <<'JSON'\n<the output, as JSON>\nJSON` : base;
  return { ...result, next };
}

const USAGE = `Usage:
  skill-rails start <rails file> [--input <key>=<value> ...]   check the rails file, reset the state of the run, print the first agent step
  skill-rails done <rails> <step-id> [--output <json> | -]     record the output of a step, print the next step
  skill-rails done <rails> <step-id> --fail <reason>           end the run with an error
  skill-rails status <rails>                                   print the current step and the step results
  skill-rails reset <rails>                                    delete the state of a run
  skill-rails check <rails file>                               check a rails file without running it
  skill-rails test [<file or folder> ...] [--json]             run the *.test.yaml tests in these files and folders, and all folders below (default: the current folder); --quiet shows only the failures
      [--live] [--agent <command>]                             --live also runs the tests with live steps, judge or mode: agent, with the agent command (default: SKILL_RAILS_AGENT, else claude -p)
  skill-rails record <rails> [--out <file>]                    write a test file from the state of a run (default: stdout)
  skill-rails trace <rails>                                    print one JSON line per agent step of the run: its request, answer and outcome
  skill-rails mcp                                              run the MCP server on stdio
  skill-rails bench <bench.yaml> [--runs <n>] [--out <csv>]   run the tests of each variant of a skill several times, and print the medians
      [--live] [--agent <command>] [--transcripts <dir>]       --live runs the mode: agent tests with a real agent, reads its turns, tokens and cost, and can save each agent output
  skill-rails hook                                             the host hook: reads the hook JSON on stdin (Claude Code and Codex)
  skill-rails hooks                                            print the hooks configuration that runs the hook
  All commands accept --cwd <project-directory>.`;

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined) throw new Error(`--${name} needs a value`);
  return value;
}

function inputsOf(args: string[]): Record<string, string> {
  const inputs: Record<string, string> = {};
  args.forEach((arg, i) => {
    if (arg !== '--input') return;
    const pair = args[i + 1] ?? '';
    const eq = pair.indexOf('=');
    if (eq < 1) throw new Error(`--input must be <key>=<value>, not "${pair}"`);
    inputs[pair.slice(0, eq)] = pair.slice(eq + 1);
  });
  return inputs;
}

function outputOf(args: string[]): unknown {
  const raw = option(args, 'output');
  if (raw === undefined) return undefined;
  return JSON.parse(raw === '-' ? fs.readFileSync(0, 'utf8') : raw);
}

export async function main(argv: string[], print = (value: Report) => process.stdout.write(`${JSON.stringify(value)}\n`)): Promise<number> {
  const [command, ...rawArgs] = argv;
  const args = [...rawArgs];
  let explicitCwd: string | undefined;
  const cwdIndex = args.indexOf('--cwd');
  if (cwdIndex !== -1) {
    explicitCwd = args[cwdIndex + 1];
    if (!explicitCwd || explicitCwd.startsWith('--')) {
      print({ status: 'error', errors: ['--cwd needs a project directory'] });
      return 2;
    }
    args.splice(cwdIndex, 2);
  }
  const [first, second] = args;
  // npx and npm exec run the command from the nearest folder with a package.json; INIT_CWD is where the user ran it.
  // Other npm and yarn commands also set INIT_CWD, for their own folder: use it only under npx or npm exec.
  const launchCwd = process.env.npm_command === 'exec' && process.env.INIT_CWD ? process.env.INIT_CWD : process.cwd();
  const cwd = path.resolve(launchCwd, explicitCwd ?? '.');
  const file = (target: string) => path.resolve(cwd, target);
  let result: Report;
  try {
    switch (command) {
      case 'start':
        if (!first || first.startsWith('--')) throw new Error(USAGE);
        result = start({ file: file(first), inputs: inputsOf(args), cwd });
        break;
      case 'done': {
        if (!first || !second) throw new Error(USAGE);
        let output: unknown;
        try {
          output = outputOf(args);
        } catch (error) {
          result = { status: 'invalid', id: second, errors: [`--output is not valid JSON: ${(error as Error).message}`] };
          break;
        }
        result = done({ rails: first, id: second, output, fail: option(args, 'fail'), cwd });
        break;
      }
      case 'status':
        if (!first) throw new Error(USAGE);
        result = status({ rails: first, cwd });
        break;
      case 'reset':
        if (!first) throw new Error(USAGE);
        result = reset({ rails: first, cwd });
        break;
      case 'check':
        if (!first) throw new Error(USAGE);
        result = check({ file: file(first), cwd });
        break;
      case 'test': {
        const { runTests } = await import('./testing.js');
        const agent = option(args, 'agent');
        const agentIndex = args.indexOf('--agent');
        if (agentIndex !== -1) args.splice(agentIndex, 2);
        const targets = args.filter((arg) => !arg.startsWith('--'));
        const results = runTests((targets.length ? targets : ['.']).map(file), { live: args.includes('--live'), agent });
        if (args.includes('--json')) process.stdout.write(`${JSON.stringify(results)}\n`);
        else {
          for (const r of results) {
            if ((r.passed || r.skipped) && args.includes('--quiet')) continue;
            const mark = r.skipped ? '-' : r.passed ? '✓' : '✗';
            const detail = r.skipped ? 'needs --live' : `${r.trace.length} agent steps, ${r.ms} ms`;
            process.stdout.write(`${mark} ${r.name}  (${r.file}, ${detail})\n`);
            for (const failure of r.failures) process.stdout.write(`    ${failure}\n`);
          }
          const skipped = results.filter((r) => r.skipped).length;
          const failed = results.filter((r) => !r.passed).length;
          process.stdout.write(`\n${results.length - failed - skipped} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}\n`);
        }
        return results.length && results.every((r) => r.passed) ? 0 : 1;
      }
      case 'record': {
        if (!first || first.startsWith('--')) throw new Error(USAGE);
        const { record, RECORD_HEADER } = await import('./record.js');
        const yaml = (await import('js-yaml')).default;
        const out = option(args, 'out');
        const text = `${RECORD_HEADER}\n${yaml.dump(record({ rails: first, cwd, out: out && file(out) }), { lineWidth: -1, noRefs: true })}`;
        if (out) {
          fs.mkdirSync(path.dirname(file(out)), { recursive: true });
          fs.writeFileSync(file(out), text);
        }
        else process.stdout.write(text);
        return 0;
      }
      case 'trace': {
        if (!first || first.startsWith('--')) throw new Error(USAGE);
        const { trace } = await import('./record.js');
        for (const line of trace({ rails: first, cwd })) process.stdout.write(`${JSON.stringify(line)}\n`);
        return 0;
      }
      case 'bench': {
        if (!first || first.startsWith('--')) throw new Error(USAGE);
        const { bench, summary, toCsv } = await import('./bench.js');
        const runs = option(args, 'runs');
        const transcripts = option(args, 'transcripts');
        const rows = bench(file(first), { live: args.includes('--live'), runs: runs ? Number(runs) : undefined, agent: option(args, 'agent'), transcripts: transcripts && file(transcripts) });
        const out = option(args, 'out');
        if (out) fs.writeFileSync(file(out), toCsv(rows));
        const lines = summary(rows);
        const keys = [...new Set(lines.flatMap((line) => Object.keys(line)))];
        process.stdout.write(`${keys.join(' | ')}\n${keys.map(() => '---').join(' | ')}\n${lines.map((line) => keys.map((key) => line[key] ?? '').join(' | ')).join('\n')}\n`);
        return rows.every((row) => row.passed) ? 0 : 1;
      }
      case 'hook': {
        const { hook } = await import('./hook.js');
        let input = {};
        try {
          input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
        } catch {
          return 0;
        }
        const output = hook(input);
        if (output) process.stdout.write(`${output}\n`);
        return 0;
      }
      case 'hooks': {
        const { HOOKS_CONFIG } = await import('./hook.js');
        process.stdout.write(`${JSON.stringify(HOOKS_CONFIG(`npx -y skill-rails@${RANGE}`), null, 2)}\n`);
        return 0;
      }
      case 'mcp': {
        const { serve } = await import('./mcp.js');
        await serve(cwd);
        return 0;
      }
      default:
        throw new Error(USAGE);
    }
  } catch (error) {
    result = { status: 'error', errors: [(error as Error).message] };
  }
  print(command === 'start' && result.status !== 'error' ? { ...withNext(result), protocol: PROTOCOL } : withNext(result));
  return result.status === 'error' ? 2 : 0;
}
