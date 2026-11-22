import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { check, start } from '../src/api.js';
import { resolveSkillRails } from '../src/skills.js';
import { tempDir } from './helpers.js';

const CORE = 'name: ctx\nsteps:\n  - id: context\n    run: echo "PR=42" >> "$RAILS_OUTPUT"\n';
const PARENT = "name: parent\nsteps:\n  - id: pr\n    uses: skill:acme-core:pr-context\n  - stop: 'PR ${{ steps.pr.outputs.steps.context.outputs.PR }}'\n";
const saved = { ...process.env };

beforeEach(() => {
  process.env.SKILL_RAILS_STATE_DIR = tempDir();
  process.env.CLAUDE_CONFIG_DIR = tempDir();
  delete process.env.SKILL_RAILS_SKILLS_PATH;
});
afterEach(() => {
  process.env = { ...saved };
});

describe('uses: skill:<plugin>:<skill>', () => {
  it('finds the skill in the marketplace checkout above the rails file', () => {
    const dir = tempDir({
      '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'acme-core', source: './plugins/core' }] }),
      'plugins/core/skills/pr-context/rails.yaml': CORE,
      'plugins/factory/skills/ci/rails.yaml': PARENT,
    });
    expect(start({ file: path.join(dir, 'plugins/factory/skills/ci/rails.yaml'), cwd: dir })).toMatchObject({ status: 'done', message: 'PR 42' });
  });

  it('finds the skill in the Claude Code plugin installs, the marketplace of the rails file first', () => {
    const cache = tempDir({
      'other/acme-core/2.0.0/skills/pr-context/rails.yaml': CORE.replace('42', '7'),
      'shared/acme-core/1.2.0/skills/pr-context/rails.yaml': CORE,
      'shared/acme-factory/1.0.0/skills/ci/rails.yaml': PARENT,
    });
    const installs = {
      version: 2,
      plugins: {
        'acme-core@other': [{ scope: 'user', installPath: path.join(cache, 'other/acme-core/2.0.0') }],
        'acme-core@shared': [{ scope: 'user', installPath: path.join(cache, 'shared/acme-core/1.2.0') }],
      },
    };
    fs.mkdirSync(path.join(process.env.CLAUDE_CONFIG_DIR as string, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR as string, 'plugins/installed_plugins.json'), JSON.stringify(installs));
    expect(start({ file: path.join(cache, 'shared/acme-factory/1.0.0/skills/ci/rails.yaml'), cwd: cache })).toMatchObject({ status: 'done', message: 'PR 42' });
  });

  it('uses SKILL_RAILS_SKILLS_PATH first', () => {
    const extra = tempDir({ 'acme-core/skills/pr-context/rails.yaml': CORE.replace('42', '9') });
    process.env.SKILL_RAILS_SKILLS_PATH = extra;
    const dir = tempDir({ 'rails.yaml': PARENT });
    expect(start({ file: path.join(dir, 'rails.yaml'), cwd: dir })).toMatchObject({ status: 'done', message: 'PR 9' });
  });

  it('finds a standalone skill by its name', () => {
    const cwd = tempDir({ '.claude/skills/pr-context/rails.yaml': CORE });
    expect(resolveSkillRails('pr-context', cwd, { cwd, env: {} })).toBe(path.join(cwd, '.claude/skills/pr-context/rails.yaml'));
  });

  it('resolves standalone skill calls in the explicitly selected project', () => {
    const cwd = tempDir({ '.agents/skills/pr-context/rails.yaml': CORE });
    const source = tempDir({ 'rails.yaml': PARENT.replace('skill:acme-core:pr-context', 'skill:pr-context') });
    const file = path.join(source, 'rails.yaml');
    expect(check({ file, cwd })).toMatchObject({ status: 'ok' });
    expect(start({ file, cwd })).toMatchObject({ status: 'done', message: 'PR 42' });
  });

  it('refuses a uses step when the skill is not found, or the name is not valid', () => {
    const dir = tempDir({ 'rails.yaml': PARENT });
    expect(check({ file: path.join(dir, 'rails.yaml') })).toMatchObject({
      status: 'error',
      errors: [expect.stringContaining('cannot find the rails file of "skill:acme-core:pr-context"')],
    });
    expect(() => resolveSkillRails('a:b:c', dir)).toThrow('must be skill:<plugin>:<skill> or skill:<skill>');
  });
});
