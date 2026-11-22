#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { output } from './output.mjs';

const target = path.resolve(process.env.TARGET);
if (process.env.SOURCE) {
  // Migration edits the existing skill; leave its wrapper readable until authoring.
  const source = fs.realpathSync(process.env.SOURCE);
  if (fs.realpathSync(target) !== source) throw new Error('Migration target must be the source skill directory.');
  if (!fs.statSync(path.join(source, 'SKILL.md')).isFile()) throw new Error('Source SKILL.md is not a file.');
  for (const dir of ['scripts', 'prompts', 'tests']) fs.mkdirSync(path.join(target, dir), { recursive: true });
  output('target', target);
  process.exit(0);
}
// Creation still requires a fresh destination.
if (fs.existsSync(target)) throw new Error(`Destination already exists: ${target}. Choose a fresh directory.`);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.mkdirSync(target);
for (const dir of ['scripts', 'prompts', 'tests']) fs.mkdirSync(path.join(target, dir));
const template = fs.readFileSync(fileURLToPath(new URL('../template/SKILL.md', import.meta.url)), 'utf8');
const shellQuote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const skill = template
  .replace('name: <skill-name>', () => `name: ${process.env.NAME}`)
  .replace('description: "<What the skill does, and when to use it.>"', () => `description: ${JSON.stringify(process.env.DESCRIPTION)}`)
  .replace('# <Skill title>', () => `# ${process.env.NAME}`)
  .replace('"<absolute-path-to-this-skill>/rails.yaml"', () => shellQuote(path.join(target, 'rails.yaml')));
fs.writeFileSync(path.join(target, 'SKILL.md'), skill, { flag: 'wx' });
output('target', target);
