// Runs a `run` step with bash, and reads its outputs.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { text } from './expressions.js';
import type { RunOptions, RunResult } from './types.js';

const TIMEOUT_MS = 10 * 60_000;
const WARNING = /^::warning::(.*)$/;

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

/** `::warning::<text>` lines on stdout, as in GitHub Actions. The agent shows them to the user. */
export const parseWarnings = (stdout: string): string[] =>
  stdout
    .split('\n')
    .map((line) => line.match(WARNING)?.[1])
    .filter((warning): warning is string => Boolean(warning));

// A list becomes one line per item, so that a script can read it with `while read`.
const envValue = (value: unknown): string => (Array.isArray(value) ? value.map(text).join('\n') : text(value));

export function runCommand(command: string, { env = {}, dir, cwd, timeoutMs = TIMEOUT_MS }: RunOptions): RunResult {
  const outputFile = path.join(os.tmpdir(), `skill-rails-output-${crypto.randomUUID()}`);
  fs.writeFileSync(outputFile, '');
  const values = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, envValue(value)]));
  const result = spawnSync('bash', ['-eo', 'pipefail', '-c', command], {
    cwd,
    env: {
      ...process.env,
      ...values,
      FLOW_DIR: dir,
      FLOW_OUTPUT: outputFile,
      // scripts/ next to the flow file comes first, so that a step can be `run: build.sh`.
      PATH: `${path.join(dir, 'scripts')}${path.delimiter}${process.env.PATH ?? ''}`,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const outputs = parseOutputs(fs.readFileSync(outputFile, 'utf8'));
  fs.rmSync(outputFile, { force: true });
  const exitCode = result.status ?? 1;
  return {
    outcome: exitCode === 0 ? 'success' : 'failure',
    exitCode,
    outputs,
    warnings: parseWarnings(result.stdout ?? ''),
    stderr: `${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`,
  };
}
