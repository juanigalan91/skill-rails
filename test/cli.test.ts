import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempDir } from './helpers.js';

const bin = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'bin', 'skillflow.js');

function cli(args: string[], { cwd, input }: { cwd: string; input?: string }) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...process.env, SKILLFLOW_STATE_DIR: path.join(cwd, 'state') },
  });
  return { code: result.status, json: JSON.parse(result.stdout) };
}

describe('the CLI', () => {
  it('runs a flow with --input and an output on stdin', () => {
    const dir = tempDir({
      'flow.yaml': "name: cli\ninputs:\n  n: { type: number }\nsteps:\n  - id: a\n    prompt: Give ${{ inputs.n }}.\n    output: { type: object, required: [v], properties: { v: { type: number } } }\n  - stop: '${{ steps.a.outputs.v }}'\n",
    });
    expect(cli(['start', 'flow.yaml', '--input', 'n=2'], { cwd: dir }).json).toMatchObject({ status: 'step', instructions: 'Give 2.' });
    expect(cli(['done', 'cli', 'a', '--output', '-'], { cwd: dir, input: '{"v": 2}' }).json).toMatchObject({ status: 'done', message: '2' });
  });

  it('reports an output that is not JSON as invalid', () => {
    const dir = tempDir({ 'flow.yaml': 'name: cli\nsteps:\n  - id: a\n    prompt: p\n' });
    cli(['start', 'flow.yaml'], { cwd: dir });
    expect(cli(['done', 'cli', 'a', '--output', '{nope'], { cwd: dir }).json.status).toBe('invalid');
  });

  it('exits with 2 and the usage on a wrong command', () => {
    const dir = tempDir();
    const { code, json } = cli(['nope'], { cwd: dir });
    expect(code).toBe(2);
    expect(json.errors[0]).toContain('Usage');
  });
});
