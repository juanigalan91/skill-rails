// One state file per rails name and working directory.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { State } from './types.js';

export const stateDir = (): string => process.env.SKILL_RAILS_STATE_DIR ?? path.join(os.tmpdir(), 'skill-rails');

export function statePath(name: string, cwd: string): string {
  const hash = crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, 12);
  return path.join(stateDir(), `${hash}-${name}.json`);
}

export function readState(name: string, cwd: string): State {
  const file = statePath(name, cwd);
  if (!fs.existsSync(file)) throw new Error(`no run of "${name}" was started in ${cwd}: run start first, with the same --cwd`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as State;
}

export function writeState(state: State): void {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(statePath(state.rails.name, state.cwd), JSON.stringify(state));
}

export function removeState(name: string, cwd: string): void {
  fs.rmSync(statePath(name, cwd), { force: true });
}
