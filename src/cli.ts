import fs from 'node:fs';
import path from 'node:path';
import { check, done, reset, start, status } from './api.js';
import type { Report } from './types.js';

const USAGE = `Usage:
  skill-rails start <rails.yaml> [--input <key>=<value> ...]   check the flow, reset its state, print the first agent step
  skill-rails done <flow> <step-id> [--output <json> | -]     record the output of a step, print the next step
  skill-rails done <flow> <step-id> --fail <reason>           end the flow with an error
  skill-rails status <flow>                                   print the current step and the step results
  skill-rails reset <flow>                                    delete the state of a flow
  skill-rails check <rails.yaml>                               check a flow file without running it
  skill-rails test [<file or folder> ...] [--json]            run the *.test.yaml flow tests (default: the current folder)
  skill-rails mcp                                             run the MCP server on stdio
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
        result = done({ flow: first, id: second, output, fail: option(args, 'fail'), cwd });
        break;
      }
      case 'status':
        if (!first) throw new Error(USAGE);
        result = status({ flow: first, cwd });
        break;
      case 'reset':
        if (!first) throw new Error(USAGE);
        result = reset({ flow: first, cwd });
        break;
      case 'check':
        if (!first) throw new Error(USAGE);
        result = check({ file: file(first) });
        break;
      case 'test': {
        const { runTests } = await import('./testing.js');
        const targets = args.filter((arg) => !arg.startsWith('--'));
        const results = runTests((targets.length ? targets : ['.']).map(file));
        if (args.includes('--json')) process.stdout.write(`${JSON.stringify(results)}\n`);
        else {
          for (const r of results) {
            process.stdout.write(`${r.passed ? '✓' : '✗'} ${r.name}  (${r.file}, ${r.trace.length} agent steps, ${r.ms} ms)\n`);
            for (const failure of r.failures) process.stdout.write(`    ${failure}\n`);
          }
          const failed = results.filter((r) => !r.passed).length;
          process.stdout.write(`\n${results.length - failed} passed, ${failed} failed\n`);
        }
        return results.length && results.every((r) => r.passed) ? 0 : 1;
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
  print(result);
  return result.status === 'error' ? 2 : 0;
}
