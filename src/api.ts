// The commands that the CLI and the MCP server share. Each one returns the JSON report for the agent.
import path from 'node:path';
import { advance, failPending, finish, newState, report, rootResults, submit } from './engine.js';
import { loadFlow } from './flow.js';
import { readState, removeState, writeState } from './state.js';
import type { Exec, Report, State, StepResult } from './types.js';

export { loadFlow, validateFlow, FlowError } from './flow.js';
export { advance, newState, submit, report } from './engine.js';
export type * from './types.js';
export { runTests, runTest, loadTests, findTests, commandAgent } from './testing.js';
export type { TestCase, TestResult, TestOptions, Agent } from './testing.js';
export { record, trace } from './record.js';
export type { TraceLine } from './record.js';

interface CommonOptions {
  cwd?: string;
  exec?: Exec;
}

const errorReport = (error: unknown): Report => ({
  status: 'error',
  errors: (error as { errors?: string[] }).errors ?? [(error as Error).message],
});

function save(state: State): Report {
  const result = { ...report(state), cwd: state.cwd };
  writeState(state);
  return result;
}

/** Checks the flow, resets its state, runs until the first agent step. */
export function start({ file, inputs = {}, cwd = process.cwd(), exec }: { file: string; inputs?: Record<string, unknown> } & CommonOptions): Report {
  try {
    const state = { ...newState(loadFlow(file, { cwd }), inputs, cwd), file: path.resolve(file) };
    advance(state, { exec });
    return save(state);
  } catch (error) {
    return errorReport(error);
  }
}

/** Records the output of a step (or fails the flow), then runs until the next agent step. */
export function done({
  flow,
  id,
  output,
  fail,
  cwd = process.cwd(),
  exec,
}: { flow: string; id: string; output?: unknown; fail?: string } & CommonOptions): Report {
  try {
    const state = readState(flow, cwd);
    if (fail !== undefined) {
      const errors = failPending(state, id, fail);
      if (errors.length) return { status: 'invalid', id, errors };
      advance(state, { exec });
      return save(state);
    }
    const errors = submit(state, id, output);
    if (errors.length) return { status: 'invalid', id, errors, output: state.pending?.output };
    advance(state, { exec });
    return save(state);
  } catch (error) {
    return errorReport(error);
  }
}

/** The current step again, or the end of the flow, with the step results. */
export function status({ flow, cwd = process.cwd() }: { flow: string; cwd?: string }): Report | (Report & { results: Record<string, StepResult> }) {
  try {
    const state = readState(flow, cwd);
    return { ...report(state), cwd: state.cwd, results: rootResults(state) };
  } catch (error) {
    return errorReport(error);
  }
}

/** Deletes the state of a flow. */
export function reset({ flow, cwd = process.cwd() }: { flow: string; cwd?: string }): Report {
  removeState(flow, cwd);
  return { status: 'reset', flow };
}

/** Checks a flow file without running it. */
export function check({ file, cwd = process.cwd() }: { file: string; cwd?: string }): Report {
  try {
    const flow = loadFlow(file, { cwd });
    return { status: 'ok', flow: flow.name, steps: flow.steps.length };
  } catch (error) {
    return errorReport(error);
  }
}
