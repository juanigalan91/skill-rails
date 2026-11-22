import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const eslint = new ESLint({ cwd: root });
const lint = async (source: string, file = 'skills/lint-fixture/rails.yaml') => {
  const [result] = await eslint.lintText(source, { filePath: path.join(root, file) });
  return result!.messages;
};

const valid = 'name: sample\nsteps:\n  - id: build\n    run: echo hi\n    args: [hello]\n    stdout: text\n  - stop: done\n';

describe('schema-aware YAML linting', () => {
  it.each(['rails.yaml', 'skills/lint-fixture/rails.yaml', 'examples/lint-fixture/rails.yaml', 'test/scenarios/skills/lint-fixture/gate.yaml'])(
    'validates a workflow at %s against the shared schema', async (file) => {
      expect(await lint(valid, file)).toEqual([]);
      const messages = await lint(valid + 'unknown-key: true\n', file);
      expect(messages.some((message) => message.ruleId === 'json-schema-validator/no-invalid' && message.message.includes('unknown-key'))).toBe(true);
    },
  );

  it('rejects misspelled nested keys and removed prompt-file', async () => {
    const messages = await lint('name: sample\nsteps:\n  - id: build\n    run: echo hi\n    working_directory: src\n');
    expect(messages.some((message) => message.message.includes('working_directory'))).toBe(true);
    const removed = await lint('name: sample\nsteps:\n  - id: write\n    prompt: Write something.\n    prompt-file: prompts/write.md\n');
    expect(removed.some((message) => message.message.includes('prompt-file'))).toBe(true);
  });

  it('rejects wrong types and duplicate YAML keys', async () => {
    const wrongType = await lint('name: sample\nsteps:\n  - run: echo hi\n    args: not-a-list\n');
    expect(wrongType.some((message) => message.ruleId === 'json-schema-validator/no-invalid')).toBe(true);
    const duplicate = await lint('name: first\nname: second\nsteps:\n  - stop: done\n');
    expect(duplicate.length).toBeGreaterThan(0);
  });

  it.each(['skills/lint-fixture/tests/sample.test.yaml', '.github/workflows/lint-fixture.yml'])(
    'does not apply the workflow schema to %s', async (file) => {
      const source = file.endsWith('.test.yaml')
        ? 'flow: ../rails.yaml\nanswers: {}\nexpect: { status: done }\n'
        : 'name: CI\non: { pull_request: {} }\njobs: {}\n';
      expect(await lint(source, file)).toEqual([]);
    },
  );
});
