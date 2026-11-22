import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { done, start } from '../src/api.js';
import { statePath } from '../src/state.js';
import { hook } from '../src/hook.js';
import type { Report } from '../src/types.js';
import { tempDir } from './helpers.js';

const rails = `name: confirm
steps:
  - id: pick
    ask:
      - id: push
        header: Push
        question: Push the branch?
        options: [Yes, No]
      - id: checks
        header: Checks
        question: Which checks?
        multiSelect: true
        options: [lint, test]
  - stop: \${{ steps.pick.outputs.push }} \${{ join(steps.pick.outputs.checks, '+') }}
`;

let cwd: string;
beforeEach(() => {
  process.env.SKILL_RAILS_STATE_DIR = tempDir();
  cwd = tempDir({ 'rails.yaml': rails });
  expect(start({ file: path.join(cwd, 'rails.yaml'), cwd, inputs: {} })).toMatchObject({ status: 'step', id: 'pick' });
});

const bash = (command: string) => hook({ cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
const doneCommand = () => `npx -y skill-rails@0.4 done confirm pick --cwd '${cwd}' --output - <<'JSON'\n{}\nJSON`;

describe('host hook', () => {
  it('denies the done call of an ask step before the question tool runs', () => {
    const output = JSON.parse(bash(doneCommand()));
    expect(output.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('- Push the branch?');
    const mcp = hook({ cwd, hook_event_name: 'PreToolUse', tool_name: 'mcp__plugin_skill-rails_skill-rails__rails_done', tool_input: { rails: 'confirm', step: 'pick', output: {} } });
    expect(JSON.parse(mcp).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('lets other commands, other steps and a --fail go on', () => {
    expect(bash('git status')).toBe('');
    expect(bash('npx -y skill-rails@0.4 done confirm other')).toBe('');
    expect(bash('npx -y skill-rails@0.4 done confirm pick --fail "no user"')).toBe('');
  });

  it('records the Claude Code answers, then lets the call go on and checks the reported answers', () => {
    hook({
      cwd,
      hook_event_name: 'PostToolUse',
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [] },
      tool_response: { answers: { 'Push the branch?': 'No', 'Which checks?': 'lint, test' } },
    });
    expect(bash(doneCommand())).toBe('');
    const changed = done({ rails: 'confirm', id: 'pick', cwd, output: { push: 'Yes', checks: ['lint', 'test'] } }) as Report & { errors: string[] };
    expect(changed).toMatchObject({ status: 'invalid' });
    expect(changed.errors).toEqual(['push: the user answered "No" in the question tool; report that answer']);
    expect(done({ rails: 'confirm', id: 'pick', cwd, output: { push: 'No', checks: ['lint', 'test'] } })).toMatchObject({ status: 'done', message: 'No lint+test' });
  });

  it('reads answers by question id from a JSON text response (Codex)', () => {
    hook({
      cwd,
      hook_event_name: 'PostToolUse',
      tool_name: 'request_user_input',
      tool_response: JSON.stringify({ answers: { push: { answers: ['Yes'] }, checks: { answers: ['test'] } } }),
    });
    expect(bash(doneCommand())).toBe('');
    expect(done({ rails: 'confirm', id: 'pick', cwd, output: { push: 'Yes', checks: ['test'] } })).toMatchObject({ status: 'done', message: 'Yes test' });
  });

  it('records nothing when the questions differ from the step', () => {
    hook({ cwd, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_response: { answers: { 'Push now?': 'Yes' } } });
    expect(JSON.parse(bash(doneCommand())).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('does not authorize another project with identical questions and rails name', () => {
    const other = tempDir({ 'rails.yaml': rails });
    start({ file: path.join(other, 'rails.yaml'), cwd: other, inputs: {} });
    hook({ cwd, hook_event_name: 'PostToolUse', tool_name: 'request_user_input', tool_response: { answers: { push: { answers: ['Yes'] }, checks: { answers: ['test'] } } } });
    expect(bash(doneCommand())).toBe('');
    const denied = hook({ cwd: other, hook_event_name: 'PreToolUse', tool_name: 'mcp__rails__rails_done', tool_input: { rails: 'confirm', step: 'pick' } });
    expect(JSON.parse(denied).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(JSON.parse(bash(`npx -y skill-rails@0.4 done confirm pick --cwd '${other}'`)).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('does not use proposed answers from the tool input as user answers', () => {
    hook({ cwd, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: { answers: { 'Push the branch?': 'Yes', 'Which checks?': 'test' } } });
    expect(JSON.parse(bash(doneCommand())).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('ignores old state files without disabling the guard', () => {
    fs.writeFileSync(path.join(process.env.SKILL_RAILS_STATE_DIR!, 'old.json'), JSON.stringify({ flow: { name: 'confirm' }, pending: { type: 'ask' } }));
    expect(JSON.parse(bash(doneCommand())).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('does not record a response that matches multiple pending rails in the same project', () => {
    const file = path.join(cwd, 'other.yaml');
    fs.writeFileSync(file, rails.replace('name: confirm', 'name: other'));
    start({ file, cwd, inputs: {} });
    hook({ cwd, hook_event_name: 'PostToolUse', tool_name: 'request_user_input', tool_response: { answers: { push: { answers: ['Yes'] }, checks: { answers: ['test'] } } } });
    for (const name of ['confirm', 'other']) {
      expect(JSON.parse(fs.readFileSync(statePath(name, cwd), 'utf8')).pending.asked).toBeUndefined();
    }
  });

  it('keeps array answer boundaries when comparing reported selections', () => {
    const file = statePath('confirm', cwd);
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    state.pending.asked = { push: 'Yes', checks: ['lint, test'] };
    fs.writeFileSync(file, JSON.stringify(state));
    expect(done({ rails: 'confirm', id: 'pick', cwd, output: { push: 'Yes', checks: ['lint', 'test'] } })).toMatchObject({ status: 'invalid' });
  });

  it('never throws on a bad input', () => {
    expect(hook({ cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: 'not json' })).toBe('');
    expect(hook({})).toBe('');
  });
});
