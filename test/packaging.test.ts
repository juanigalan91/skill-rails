import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

it('ships discoverable Codex and portable plugins with their shared resources', () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-rails-pack-'));
  try {
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', cache], {
      cwd: root, encoding: 'utf8', timeout: 15000,
    })) as Array<{ files: Array<{ path: string }> }>;
    const files = new Set(pack?.files.map((file) => file.path));
    const pkg = read('package.json');
    const portable = read('plugin.json');
    const codex = read('.codex-plugin/plugin.json');
    for (const manifest of [portable, codex, read('.claude-plugin/plugin.json')]) {
      expect(manifest.name).toBe(pkg.name);
      expect(manifest.version).toBe(pkg.version);
    }
    const marketplace = read('.agents/plugins/marketplace.json');
    const entry = marketplace.plugins.find((plugin: { name: string }) => plugin.name === pkg.name);
    expect(path.resolve(root, entry.source.path)).toBe(path.resolve(root));
    for (const file of ['plugin.json', 'mcp.json', '.codex-plugin/plugin.json', '.agents/plugins/marketplace.json', '.claude-plugin/plugin.json', '.mcp.json', 'bin/skill-rails.js', 'dist/mcp.js', 'docs/format.md', 'skills/create-skill-rails/template/SKILL.md']) {
      expect(files.has(file), `npm package must contain ${file}`).toBe(true);
    }
    for (const skill of ['run-skill-rails', 'create-skill-rails', 'migrate-to-skill-rails']) {
      expect(files.has(path.posix.join(codex.skills, skill, 'SKILL.md'))).toBe(true);
    }
    const legacyServers = read(codex.mcpServers).mcpServers;
    const portableServers = read('mcp.json').mcpServers;
    expect(Object.keys(portableServers)).toEqual(Object.keys(legacyServers));
    for (const [name, server] of Object.entries(portableServers)) {
      const { type, ...launch } = server as { type: string; command: string; args: string[] };
      expect(type).toBe('stdio');
      expect(launch).toEqual(legacyServers[name]);
    }
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
}, 20000);
