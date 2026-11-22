// The commands that the CLI and the MCP server share. Each one returns the JSON report for the agent.
import path from 'node:path';
import { advanceRun, failCode, submitCode } from './code.js';
import { advance, failPending, finish, newState, report, rootResults, submit } from './engine.js';
import { loadRails } from './rails.js';
import { readState, removeState, writeState } from './state.js';
import type { Exec, Report, State, StepResult } from './types.js';

export { loadRails, validateRails, RailsError } from './rails.js';
export { defineRails } from './define.js';
export type { RailsDefinition, RailsContext, Output, Sh } from './define.js';
export { StepError } from './code.js';
export { advance, newState, submit, report } from './engine.js';
export type * from './types.js';
export { runTests, runTest, loadTests, findTests, commandAgent } from './testing.js';
export type { TestCase, TestResult, TestOptions, Agent } from './testing.js';
export { record, trace } from './record.js';
export { bench, summary, agentMetrics } from './bench.js';
export type { BenchFile, BenchRow, BenchVariant } from './bench.js';
export type { TraceLine } from './record.js';

interface CommonOptions {
  cwd?: string;
  exec?: Exec;
}

const errorReport = (error: unknown): Report => ({
  status: 'error',
  errors: (error as { errors?: string[] }).errors ?? [(error as Error).message],
});

const run = advanceRun;

function save(state: State): Report {
  const result = { ...report(state), cwd: state.cwd };
  writeState(state);
  return result;
}

/** Checks the rails file, resets the state of the run, runs until the first agent step. */
export function start({ file, inputs = {}, cwd = process.cwd(), exec }: { file: string; inputs?: Record<string, unknown> } & CommonOptions): Report {
  try {
    const state = { ...newState(loadRails(file, { cwd }), inputs, cwd), file: path.resolve(file) };
    run(state, exec);
    return save(state);
  } catch (error) {
    return errorReport(error);
  }
}

/** Records the output of a step (or fails the run), then runs until the next agent step. */
export function done({
  rails,
  id,
  output,
  fail,
  cwd = process.cwd(),
  exec,
}: { rails: string; id: string; output?: unknown; fail?: string } & CommonOptions): Report {
  try {
    const state = readState(rails, cwd);
    if (fail !== undefined) {
      const errors = state.rails.code ? failCode(state, id, fail) : failPending(state, id, fail);
      if (errors.length) return { status: 'invalid', id, errors };
      run(state, exec);
      return save(state);
    }
    const errors = state.rails.code ? submitCode(state, id, output) : submit(state, id, output);
    if (errors.length) return { status: 'invalid', id, errors, output: state.pending?.output };
    run(state, exec);
    return save(state);
  } catch (error) {
    return errorReport(error);
  }
}

/** The current step again, or the end of the run, with the step results. */
export function status({ rails, cwd = process.cwd() }: { rails: string; cwd?: string }): Report | (Report & { results: Record<string, StepResult> }) {
  try {
    const state = readState(rails, cwd);
    return { ...report(state), cwd: state.cwd, results: rootResults(state) };
  } catch (error) {
    return errorReport(error);
  }
}

/** Deletes the state of a run. */
export function reset({ rails, cwd = process.cwd() }: { rails: string; cwd?: string }): Report {
  removeState(rails, cwd);
  return { status: 'reset', rails };
}

/** Checks a rails file without running it. */
export function check({ file, cwd = process.cwd() }: { file: string; cwd?: string }): Report {
  try {
    const rails = loadRails(file, { cwd });
    return { status: 'ok', rails: rails.name, ...(rails.code ? {} : { steps: rails.steps.length }) };
  } catch (error) {
    return errorReport(error);
  }
}
