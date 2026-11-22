import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runTests } from '../src/testing.js';

const examples = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'examples');

it('passes the tests of the examples', () => {
  const results = runTests([examples]);
  expect(results.filter((r) => !r.passed)).toEqual([]);
  expect(results.length).toBeGreaterThan(0);
}, 30_000);
