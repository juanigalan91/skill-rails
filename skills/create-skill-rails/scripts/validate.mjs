#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { output } from './output.mjs';

const target = path.resolve(process.env.TARGET);
const errors = [];
const invoke = (args) => {
  // Use the published runner so Git-installed plugins need no local node_modules.
  const result = spawnSync('npx', ['-y', 'skill-rails@0.7', ...args], { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(result.stdout); } catch { /* Report command failures below. */ }
  if (result.error || result.status !== 0 || report === undefined) {
    errors.push(`${args[0]} failed: ${result.error?.message ?? ''} ${result.stdout ?? ''} ${result.stderr ?? ''}`.trim());
    return null;
  }
  return report;
};
const check = invoke(['check', path.join(target, 'rails.yaml')]);
if (check && check.status !== 'ok') errors.push(JSON.stringify(check));
const warnings = check?.warnings ?? [];
if (!fs.existsSync(path.join(target, 'SKILL.md'))) errors.push('SKILL.md is missing.');
if (check?.status === 'ok') {
  const tests = path.join(target, 'tests');
  if (!fs.existsSync(tests)) errors.push('Add deterministic tests under tests/.');
  else {
    const results = invoke(['test', tests, '--json']);
    if (results && (!Array.isArray(results) || results.length === 0 || results.some((r) => !r.passed))) errors.push(`Rails tests failed: ${JSON.stringify(results)}`);
  }
}
output('valid', errors.length === 0 ? 'true' : 'false');
output('errors', errors.join('\n'));
output('warnings', warnings.join('\n'));
