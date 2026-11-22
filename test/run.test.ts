import { describe, expect, it } from 'vitest';
import { parseOutputs, parseWarnings, runCommand } from '../src/run.js';
import { tempDir } from './helpers.js';

describe('parseOutputs', () => {
  it('reads key=value lines and multi-line values', () => {
    expect(parseOutputs('a=1\nb=x=y\nlist<<EOF\none\ntwo\nEOF\n')).toEqual({ a: '1', b: 'x=y', list: 'one\ntwo' });
  });
});

describe('parseWarnings', () => {
  it('reads ::warning:: lines', () => {
    expect(parseWarnings('x\n::warning::The base may be stale.\ny')).toEqual(['The base may be stale.']);
  });
});

describe('runCommand', () => {
  it('passes env values, puts scripts/ in PATH, and reads the outputs', () => {
    const dir = tempDir({ 'scripts/hello.sh': '#!/usr/bin/env bash\necho "msg=hi $WHO" >> "$RAILS_OUTPUT"\necho "::warning::careful"\n' });
    const result = runCommand('hello.sh', { env: { WHO: 'you' }, dir, cwd: dir });
    expect(result).toMatchObject({ outcome: 'success', exitCode: 0, outputs: { msg: 'hi you' }, warnings: ['careful'] });
  });

  it('gives a list as one line per item', () => {
    const dir = tempDir();
    const result = runCommand('echo "count=$(printf "%s\\n" "$ITEMS" | wc -l | tr -d " ")" >> "$RAILS_OUTPUT"', { env: { ITEMS: ['a', 'b', 'c'] }, dir, cwd: dir });
    expect(result.outputs.count).toBe('3');
  });

  it('reports a failure with its exit code and stderr', () => {
    const dir = tempDir();
    const result = runCommand('echo broken >&2; exit 3', { dir, cwd: dir });
    expect(result).toMatchObject({ outcome: 'failure', exitCode: 3 });
    expect(result.stderr).toContain('broken');
  });
});
