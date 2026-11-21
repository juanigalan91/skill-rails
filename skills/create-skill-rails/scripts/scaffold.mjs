import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { output } from './output.mjs';

const target = path.resolve(process.env.TARGET);
// A fresh destination keeps creation and migration from overwriting existing work.
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
  .replace('"<absolute-path-to-this-skill>/flow.yaml"', () => shellQuote(path.join(target, 'flow.yaml')));
fs.writeFileSync(path.join(target, 'SKILL.md'), skill, { flag: 'wx' });
output('target', target);
