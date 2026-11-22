// Record and trace: the agent steps of a real run become a test file or eval cases.
import path from 'node:path';
import { kindOf } from './rails.js';
import { readState } from './state.js';
import type { ForeachStep, Frame, State, Step, StepResult, UsesStep } from './types.js';

export const RECORD_HEADER = [
  '# Recorded from a real run.',
  '# The run steps call real commands: add stubs (path:) for the network commands, such as gh or curl.',
  '# Add $files to the answers of the agent steps that wrote files.',
].join('\n');

interface Occurrence {
  /** `<uses id>/.../<step id>`. */
  key: string;
  id: string;
  result: StepResult;
}

type Results = Record<string, StepResult>;

/** The results of a run that is not done: each open frame is put into its parent, as if it had ended. */
function foldedResults(state: State): Results {
  const frames = state.frames.map((frame) => ({ ...frame, results: { ...frame.results } }));
  for (let i = frames.length - 1; i > 0; i--) {
    const frame = frames[i] as Frame;
    const parent = frames[i - 1] as Frame;
    const outputs =
      frame.kind === 'rails'
        ? { steps: frame.results }
        : { results: [...(frame.iterations ?? []).map(({ steps }) => ({ steps })), { steps: frame.results }] };
    parent.results[frame.id as string] = { outcome: 'success', outputs };
  }
  return (frames[0] as Frame).results;
}

/** The agent step results, in the order of the rails file and of the iterations. */
function walk(steps: Step[] | undefined, results: Results | undefined, scope: string[], out: Occurrence[]): void {
  for (const step of steps ?? []) {
    const id = step.id;
    const result = id ? results?.[id] : undefined;
    if (!id || !result) continue;
    const kind = kindOf(step);
    if (kind === 'skill' || kind === 'prompt' || kind === 'ask') {
      if (result.request) out.push({ key: [...scope, id].join('/'), id, result });
    } else if (kind === 'foreach' || kind === 'repeat') {
      const iterations = (result.outputs?.results ?? []) as Array<{ steps: Results }>;
      for (const iteration of iterations) walk((step as ForeachStep).steps, iteration.steps, scope, out);
    } else if (kind === 'uses') {
      const rails = (step as UsesStep).rails;
      const inner = result.outputs?.steps as Results | undefined;
      walk(rails?.steps, inner, [...scope, id], out);
      walk(rails?.['on-failure'], inner, [...scope, id], out);
    }
  }
}

function occurrences(state: State, scope: string[] = []): Occurrence[] {
  const results = foldedResults(state);
  // A TypeScript rails file: its agent steps in call order, and the steps of its nested runs.
  if (state.rails.code) {
    return (state.replay?.calls ?? []).flatMap(({ id, result, child }) => {
      if (child) return occurrences(child, [...scope, id]);
      return result?.request ? [{ key: [...scope, id].join('/'), id, result }] : [];
    });
  }
  const out: Occurrence[] = [];
  walk(state.rails.steps, results, scope, out);
  walk(state.rails['on-failure'], results, scope, out);
  return out;
}

/** A test file from the state of a run. `rails:` is relative to the folder of `out`, else absolute. */
export function record({ rails, cwd = process.cwd(), out }: { rails: string; cwd?: string; out?: string }): Record<string, unknown> {
  const state = readState(rails, cwd);
  if (!state.file) throw new Error(`the state of "${rails}" has no rails file: start the run again`);
  const grouped = new Map<string, unknown[]>();
  for (const { key, result } of occurrences(state)) grouped.set(key, [...(grouped.get(key) ?? []), result.answer]);
  // One occurrence is a single answer; a list answer stays in a list, so that it is not read as one answer per occurrence.
  const answers = Object.fromEntries([...grouped].map(([key, list]) => [key, list.length === 1 && !Array.isArray(list[0]) ? list[0] : list]));
  const inputs = Object.fromEntries(Object.entries((state.frames[0] as Frame).inputs).filter(([, value]) => value !== null));
  const results = (state.frames[0] as Frame).results;
  const ids = state.rails.code
    ? [...new Set((state.replay?.calls ?? []).map((call) => call.id))].filter((id) => results[id])
    : [...state.rails.steps, ...(state.rails['on-failure'] ?? [])].map((step) => step.id).filter((id): id is string => Boolean(id && results[id]));
  const ended = state.status !== 'running';
  return {
    rails: out ? path.relative(path.dirname(path.resolve(out)), state.file) : state.file,
    inputs,
    answers,
    expect: {
      ...(ended ? { status: state.status } : {}),
      ...(ended && state.message !== null ? { message: state.message } : {}),
      steps: Object.fromEntries(ids.map((id) => [id, results[id]?.outcome])),
    },
  };
}

export interface TraceLine {
  rails: string;
  path: string;
  id: string;
  request: StepResult['request'];
  answer: unknown;
  outcome: StepResult['outcome'];
}

/** One line per agent step result of a run: the exact input and output of each step. */
export function trace({ rails, cwd = process.cwd() }: { rails: string; cwd?: string }): TraceLine[] {
  const state = readState(rails, cwd);
  return occurrences(state).map(({ key, id, result }) => ({ rails: state.rails.name, path: key, id, request: result.request, answer: result.answer, outcome: result.outcome }));
}
