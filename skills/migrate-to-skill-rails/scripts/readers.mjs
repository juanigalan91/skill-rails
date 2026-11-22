#!/usr/bin/env node
// The files outside the skill that name one of its files: code or CI that reads the skill text breaks when the text changes.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve(process.env.SOURCE);
const git = (args, cwd = source) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
let root;
try {
  root = git(['rev-parse', '--show-toplevel']).trim();
} catch {
  console.log(JSON.stringify({ readers: [] }));
  process.exit(0);
}
const name = path.basename(source);
const files = fs.readdirSync(source, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
const patterns = files.map((entry) => `${name}/${path.relative(source, path.join(entry.parentPath, entry.name))}`);
let hits = '';
try {
  hits = git(['grep', '-l', '-F', ...patterns.flatMap((pattern) => ['-e', pattern])], root);
} catch {}
const inside = path.relative(fs.realpathSync(root), source) + path.sep;
const readers = hits.split('\n').filter((file) => file && !path.normalize(file).startsWith(inside));
console.log(JSON.stringify({ readers }));
