#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { output } from '../../create-skill-rails/scripts/output.mjs';

const input = path.resolve(process.env.SOURCE);
const stat = fs.statSync(input);
const source = fs.realpathSync(stat.isDirectory() ? input : path.dirname(input));
if (!stat.isDirectory() && path.basename(input) !== 'SKILL.md') throw new Error('Source must be a skill folder or SKILL.md.');
if (!fs.statSync(path.join(source, 'SKILL.md')).isFile()) throw new Error('Source SKILL.md is not a file.');
const target = source;
output('source', source);
output('target', target);
