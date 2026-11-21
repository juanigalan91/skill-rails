import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runTests } from '../src/testing.js';
import { tempDir } from './helpers.js';

const root = fileURLToPath(new URL('../', import.meta.url));

it('passes the bundled skills’ deterministic flow scenarios without a model or network', () => {
  const results = runTests([path.join(root, 'skills')]);
  expect(results.filter((result) => !result.passed)).toEqual([]);
  expect(results.length).toBeGreaterThanOrEqual(17);
}, 30000);

it('generates a wrapper command that treats its destination as a literal path', () => {
  const cwd = tempDir();
  const target = path.join(cwd, "literal;$&$(touch injected) 'quoted'");
  try {
    const scaffold = spawnSync(process.execPath, [path.join(root, 'skills/create-skill-rails/scripts/scaffold.mjs')], {
      cwd, encoding: 'utf8',
      env: { ...process.env, TARGET: target, NAME: 'generated', DESCRIPTION: 'A test skill.', FLOW_OUTPUT: path.join(cwd, 'outputs') },
    });
    expect(scaffold.status, scaffold.stderr).toBe(0);
    fs.writeFileSync(path.join(target, 'flow.yaml'), 'name: generated\nsteps:\n  - stop: safely started\n');
    const wrapper = fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8');
    const command = wrapper.match(/```bash\n([^\n]+)/)?.[1]?.replace(' [--input <key>=<value> ...]', '');
    expect(command).toBeDefined();
    const run = spawnSync('bash', ['-eo', 'pipefail', '-c', command as string], {
      cwd, encoding: 'utf8',
      env: { ...process.env, PATH: `${path.join(root, 'skills/create-skill-rails/tests/stubs')}${path.delimiter}${process.env.PATH}`, SKILL_RAILS_STATE_DIR: path.join(cwd, 'state'), npm_command: '', INIT_CWD: '' },
    });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ status: 'done', message: 'safely started' });
    expect(fs.existsSync(path.join(cwd, 'injected'))).toBe(false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
