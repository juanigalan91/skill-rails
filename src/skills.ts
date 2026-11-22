// Finds the flow of another skill by its name, for `uses: skill:<plugin>:<skill>` or `uses: skill:<skill>`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FLOW_FILE = 'rails.yaml';

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** A checkout of a plugin repository: a marketplace or a plugin folder above the calling flow. */
function fromCheckout(plugin: string, skill: string, from: string): string[] {
  const found: string[] = [];
  for (let dir = from; ; dir = path.dirname(dir)) {
    const manifest = readJson(path.join(dir, '.claude-plugin', 'plugin.json')) as { name?: string } | null;
    if (manifest?.name === plugin) found.push(path.join(dir, 'skills', skill));
    const market = readJson(path.join(dir, '.claude-plugin', 'marketplace.json')) as { plugins?: Array<{ name?: string; source?: unknown }> } | null;
    for (const entry of market?.plugins ?? []) {
      if (entry.name === plugin && typeof entry.source === 'string') found.push(path.join(dir, entry.source, 'skills', skill));
    }
    if (path.dirname(dir) === dir) return found;
  }
}

/** The plugins that Claude Code installed: the ones of the marketplace of the calling flow first. */
function fromClaudeInstalls(plugin: string, skill: string, from: string, env: NodeJS.ProcessEnv): string[] {
  const config = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const installed = readJson(path.join(config, 'plugins', 'installed_plugins.json')) as { plugins?: Record<string, Array<{ installPath?: string }>> } | null;
  const paths = Object.entries(installed?.plugins ?? {})
    .filter(([key]) => key.split('@')[0] === plugin)
    .flatMap(([, entries]) => entries.map((entry) => entry.installPath).filter((p): p is string => Boolean(p)));
  // A cached plugin is at <cache>/<marketplace>/<plugin>/<version>.
  const sameMarket = (p: string) => from.startsWith(path.dirname(path.dirname(p)) + path.sep);
  return [...paths.filter(sameMarket), ...paths.filter((p) => !sameMarket(p))].map((p) => path.join(p, 'skills', skill));
}

/** The folders of standalone skills. */
function fromSkillFolders(skill: string, cwd: string, env: NodeJS.ProcessEnv): string[] {
  const config = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return [path.join(cwd, '.claude', 'skills'), path.join(cwd, '.agents', 'skills'), path.join(config, 'skills')].map((dir) => path.join(dir, skill));
}

/**
 * The rails.yaml of a skill, from `<plugin>:<skill>` or `<skill>`.
 * The order: SKILL_RAILS_SKILLS_PATH, a plugin checkout above the calling flow, the Claude Code plugin installs, then the skill folders.
 */
export function resolveSkillFlow(ref: string, from: string, { env = process.env, cwd = process.cwd() } = {}): string {
  const parts = ref.split(':');
  if (parts.length > 2 || parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error(`"skill:${ref}" must be skill:<plugin>:<skill> or skill:<skill>`);
  }
  const [plugin, skill] = parts.length === 2 ? (parts as [string, string]) : [null, parts[0] as string];
  const extra = (env.SKILL_RAILS_SKILLS_PATH ?? '').split(path.delimiter).filter(Boolean);
  const candidates = [
    ...extra.flatMap((dir) => [...(plugin ? [path.join(dir, plugin, 'skills', skill)] : []), path.join(dir, skill)]),
    ...(plugin ? [...fromCheckout(plugin, skill, from), ...fromClaudeInstalls(plugin, skill, from, env)] : fromSkillFolders(skill, cwd, env)),
  ];
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, FLOW_FILE)));
  if (found) return path.join(found, FLOW_FILE);
  const where = plugin
    ? `SKILL_RAILS_SKILLS_PATH, a checkout of the plugin "${plugin}" above this flow, or an installed plugin "${plugin}"`
    : 'SKILL_RAILS_SKILLS_PATH, .claude/skills, .agents/skills or ~/.claude/skills';
  throw new Error(`cannot find the skill flow "skill:${ref}" (a ${FLOW_FILE} in ${where})`);
}
