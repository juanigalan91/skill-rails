import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runTests } from '../src/testing.js';

const scenarios = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scenarios');

it('passes the tests of the scenario plugin', () => {
  const failed = runTests([scenarios]).filter((result) => !result.passed);
  expect(failed.map((result) => `${result.name}: ${result.failures.join('; ')}`)).toEqual([]);
}, 120_000);
