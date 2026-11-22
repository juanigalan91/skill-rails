import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { agentMetrics, bench, summary } from '../src/bench.js';
import { tempDir } from './helpers.js';

beforeEach(() => {
  process.env.SKILL_RAILS_STATE_DIR = tempDir();
});

const yamlRails = 'name: greet\nsteps:\n  - id: say\n    prompt: Say hi.\n    output: { text: string }\n  - stop: "${{ steps.say.outputs.text }}"\n';
const tsRails = "export default { name: 'greet', run({ prompt }) { return prompt('say', 'Say hi.', { output: { text: 'string' } }).text; } };\n";
const tests = `rails: ../rails.yaml
tests:
  - name: fixed
    answers: { say: { text: hi } }
    expect: { status: done, message: hi }
  - name: agent
    mode: agent
    request: Greet.
    expect: { files: { greeting.txt: '/hi/' } }
`;

describe('bench', () => {
  const dir = () =>
    tempDir({
      'rails.yaml': yamlRails,
      'rails.ts': tsRails,
      'tests/greet.test.yaml': tests,
      'bench.yaml': 'tests: tests\nruns: 3\nvariants:\n  yaml: {}\n  ts: { rails: rails.ts }\n  markdown: { markdown: true, agent: "cat > /dev/null; echo hi > greeting.txt; echo \'{\\"num_turns\\": 4, \\"total_cost_usd\\": 0.1, \\"usage\\": {\\"input_tokens\\": 10, \\"output_tokens\\": 5}}\'" }\n',
    });

  it('runs the fixed-answer tests of each rails variant, and skips the Markdown variant', () => {
    const rows = bench(path.join(dir(), 'bench.yaml'));
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.passed && row.test === 'fixed' && row.agentSteps === 1)).toBe(true);
    expect(summary(rows).map((line) => [line.variant, line.passed]).sort()).toEqual([['ts', '3/3'], ['yaml', '3/3']]);
  });

  it('runs the agent tests with --live, and reads the agent metrics', () => {
    const rows = bench(path.join(dir(), 'bench.yaml'), { live: true, runs: 1, agent: 'cat > /dev/null; echo hi > greeting.txt' }).filter((row) => row.variant === 'markdown');
    expect(rows).toEqual([expect.objectContaining({ test: 'agent', passed: true, turns: 4, costUsd: 0.1, inputTokens: 10, outputTokens: 5 })]);
  });

  it('reads no metrics from a text transcript', () => {
    expect(agentMetrics('Done.')).toEqual({});
    expect(agentMetrics('null')).toEqual({});
    expect(agentMetrics('[]')).toEqual({});
  });

  it.each([0, -1, 1.5, NaN])('rejects invalid run count %s instead of reporting an empty successful bench', (runs) => {
    expect(() => bench(path.join(dir(), 'bench.yaml'), { runs })).toThrow('positive integer');
  });

  it('rejects an empty bench or a fixed-answer bench containing only Markdown variants', () => {
    const root = dir();
    expect(() => bench(path.join(tempDir({ 'bench.yaml': 'variants: {}\ntests: tests\n' }), 'bench.yaml'))).toThrow('named variant');
    expect(() => bench(path.join(tempDir({ 'bench.yaml': 'variants: { yaml: {} }\ntests: []\n' }), 'bench.yaml'))).toThrow('non-empty list');
    const file = path.join(root, 'markdown.yaml');
    fs.writeFileSync(file, 'tests: tests\nvariants: { markdown: { markdown: true } }\n');
    expect(() => bench(file)).toThrow('Markdown variants need --live');
  });
});
