// Runs a `run` step with bash, and reads its outputs.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { text } from './expressions.js';
import { stateDir } from './state.js';
import type { RunOptions, RunResult } from './types.js';

const TIMEOUT_MS = 10 * 60_000;
const WARNING = /^::warning::(.*)$/;
const STDERR_WARNING = /^WARNING:\s*(.*)$/;
const PLUGIN_MANIFESTS = [path.join('.claude-plugin', 'plugin.json'), path.join('.codex-plugin', 'plugin.json')];

/** Lines `key=value`, or `key<<DELIMITER` ... `DELIMITER`, as in GITHUB_OUTPUT. */
export function parseOutputs(content: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const heredoc = line.match(/^([\w-]+)<<(.+)$/);
    if (heredoc?.[1] && heredoc[2]) {
      const body: string[] = [];
      for (i++; i < lines.length && lines[i] !== heredoc[2]; i++) body.push(lines[i] ?? '');
      outputs[heredoc[1]] = body.join('\n');
      continue;
    }
    const eq = line.indexOf('=');
    if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return outputs;
}

/** `::warning::<text>` lines on stdout, as in GitHub Actions, and `WARNING: <text>` lines on stderr. The agent shows them to the user. */
export const parseWarnings = (stdout: string, stderr = ''): string[] =>
  [...stdout.split('\n').map((line) => line.match(WARNING)?.[1]), ...stderr.split('\n').map((line) => line.match(STDERR_WARNING)?.[1])].filter(
    (warning): warning is string => Boolean(warning),
  );

const empty = (arg: unknown) => arg === null || arg === undefined || arg === false || arg === '' || (Array.isArray(arg) && !arg.length);

/** A map of flags: true adds the flag, a list adds the flag before each item, another value adds the flag and the value. */
const flags = (map: Record<string, unknown>): unknown[] =>
  Object.entries(map).flatMap(([flag, value]) => {
    if (empty(value)) return [];
    if (value === true) return [flag];
    return Array.isArray(value) ? value.flatMap((item) => (empty(item) ? [] : [flag, item])) : [flag, value];
  });

/** Each argument quoted for bash. A list adds each of its items; a map adds flags; null, false and an empty string add nothing. */
export function quoteArgs(args: unknown[]): string {
  return args
    .flatMap((arg) => (arg && typeof arg === 'object' && !Array.isArray(arg) ? flags(arg as Record<string, unknown>) : [arg]))
    .flat()
    .filter((arg) => !empty(arg))
    .map((arg) => `'${text(arg).replace(/'/g, "'\\''")}'`)
    .join(' ');
}

/** The outputs that a step reads from its stdout. */
export function stdoutOutputs(stdout: string, mode: RunOptions['stdout']): Record<string, unknown> {
  if (!mode) return {};
  const body = stdout
    .split('\n')
    .filter((line) => !WARNING.test(line))
    .join('\n')
    .trim();
  if (mode === 'text') return { value: body };
  if (mode === 'env') return parseOutputs(body);
  const lines = () => body.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as unknown);
  if (mode === 'jsonl') return { value: lines() };
  let value: unknown;
  try {
    value = body ? JSON.parse(body) : null;
  } catch {
    // Several JSON values, one per line.
    value = lines();
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
}

/** The scripts/ folder of the plugin that holds the rails file: the nearest folder above it with a plugin manifest. */
function pluginScripts(dir: string): string | null {
  for (let current = path.dirname(dir); ; current = path.dirname(current)) {
    if (PLUGIN_MANIFESTS.some((manifest) => fs.existsSync(path.join(current, manifest)))) {
      const scripts = path.join(current, 'scripts');
      return fs.existsSync(scripts) ? scripts : null;
    }
    if (path.dirname(current) === current) return null;
  }
}

// A list becomes one line per item, so that a script can read it with `while read`.
const envValue = (value: unknown): string => (Array.isArray(value) ? value.map(text).join('\n') : text(value));

export function runCommand(command: string, { env = {}, args = [], stdout, dir, cwd, timeoutMs = TIMEOUT_MS }: RunOptions): RunResult {
  // In the runner folder: a rails file that sets TMPDIR to the project must not see this file.
  const outputDir = path.join(stateDir(), 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `skill-rails-output-${crypto.randomUUID()}`);
  fs.writeFileSync(outputFile, '');
  const values = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, envValue(value)]));
  const quoted = quoteArgs(args);
  // SKILL_RAILS_STUB_PATH (set by the test runner) comes before the scripts, so that a test can stub a script.
  const paths = [process.env.SKILL_RAILS_STUB_PATH || null, path.join(dir, 'scripts'), pluginScripts(dir), process.env.PATH ?? ''].filter((p): p is string => p !== null);
  const result = spawnSync('bash', ['-eo', 'pipefail', '-c', quoted ? `${command} ${quoted}` : command], {
    cwd,
    env: {
      ...process.env,
      ...values,
      RAILS_DIR: dir,
      RAILS_OUTPUT: outputFile,
      // scripts/ next to the rails file comes first, then scripts/ of its plugin, so that a step can be `run: build.sh`.
      PATH: paths.join(path.delimiter),
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const written = parseOutputs(fs.readFileSync(outputFile, 'utf8'));
  fs.rmSync(outputFile, { force: true });
  let exitCode = result.status ?? 1;
  let outputs: Record<string, unknown> = written;
  let parseError = '';
  try {
    outputs = { ...stdoutOutputs(result.stdout ?? '', stdout), ...written };
  } catch (error) {
    if (exitCode === 0) exitCode = 1;
    parseError = `\nstdout is not JSON: ${(error as Error).message}`;
  }
  return {
    outcome: exitCode === 0 ? 'success' : 'failure',
    exitCode,
    outputs,
    warnings: parseWarnings(result.stdout ?? '', result.stderr ?? ''),
    stderr: `${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}${parseError}`,
  };
}
