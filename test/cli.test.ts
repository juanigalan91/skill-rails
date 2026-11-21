import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempDir } from './helpers.js';

const bin = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'bin', 'skill-rails.js');

function cli(args: string[], { cwd, input }: { cwd: string; input?: string }) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...process.env, INIT_CWD: undefined, npm_command: undefined, SKILL_RAILS_STATE_DIR: path.join(cwd, 'state') },
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

  it('uses an explicit project directory for paths, shell commands and state', () => {
    const launch = tempDir();
    const project = tempDir({ 'flow.yaml': "name: explicit\nsteps:\n  - id: a\n    prompt: hi\n  - id: here\n    run: pwd > location\n  - stop: done\n" });
    expect(cli(['start', 'flow.yaml', '--cwd', project], { cwd: launch }).json).toMatchObject({ status: 'step', cwd: project });
    expect(cli(['done', 'explicit', 'a', '--cwd', project], { cwd: launch }).json).toMatchObject({ status: 'done', cwd: project });
    expect(fs.readFileSync(path.join(project, 'location'), 'utf8').trim()).toBe(fs.realpathSync(project));
    expect(cli(['status', 'explicit', '--cwd', project], { cwd: launch }).json.status).toBe('done');
    expect(cli(['check', 'flow.yaml', '--cwd', project], { cwd: launch }).json.status).toBe('ok');
  });

  it('rejects a missing project directory', () => {
    expect(cli(['check', 'flow.yaml', '--cwd'], { cwd: tempDir() }).code).toBe(2);
  });

  it('reports an output that is not JSON as invalid', () => {
    const dir = tempDir({ 'flow.yaml': 'name: cli\nsteps:\n  - id: a\n    prompt: p\n' });
    cli(['start', 'flow.yaml'], { cwd: dir });
    expect(cli(['done', 'cli', 'a', '--output', '{nope'], { cwd: dir }).json.status).toBe('invalid');
  });

  it('runs in INIT_CWD, the folder where npx was started', () => {
    const dir = tempDir({ 'sub/flow.yaml': "name: here\nsteps:\n  - id: w\n    run: echo \"dir=$(basename \"$PWD\")\" >> \"$FLOW_OUTPUT\"\n  - stop: '${{ steps.w.outputs.dir }}'\n" });
    const result = spawnSync(process.execPath, [bin, 'start', 'flow.yaml'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, npm_command: 'exec', INIT_CWD: path.join(dir, 'sub'), SKILL_RAILS_STATE_DIR: path.join(dir, 'state') },
    });
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'done', message: 'sub' });
  });

  it('ignores INIT_CWD outside npx, for example under yarn run', () => {
    const dir = tempDir({ 'flow.yaml': "name: here\nsteps:\n  - stop: here\n" });
    const result = spawnSync(process.execPath, [bin, 'start', 'flow.yaml'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, npm_command: 'run-script', INIT_CWD: '/nowhere', SKILL_RAILS_STATE_DIR: path.join(dir, 'state') },
    });
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'done', message: 'here' });
  });

  it('exits with 2 and the usage on a wrong command', () => {
    const dir = tempDir();
    const { code, json } = cli(['nope'], { cwd: dir });
    expect(code).toBe(2);
    expect(json.errors[0]).toContain('Usage');
  });
});
