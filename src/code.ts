// Runs a TypeScript rails file by replay: each call runs its run function again from the start.
// A step with a saved result returns it; the first agent step with no result becomes the pending step, and the run stops there.
import fs from 'node:fs';
import path from 'node:path';
import { outputSchema } from './compact.js';
import { StepError, type AskQuestion, type RailsContext, type RailsDefinition, type RailsResult, type Sh, type ShOptions } from './define.js';

export { StepError };
import { advance, agentStep, askStep, contextOf, failPending, failureMessage, newState, submit, tail } from './engine.js';
import { isPromptFile, loadCode, loadRails, resolveLinks } from './rails.js';
import { resolveSkillRails } from './skills.js';
import { quoteArgs, runCommand } from './run.js';
import { checkOutputSchema } from './schema.js';
import type { Exec, Frame, PendingStep, State, StepResult } from './types.js';

type Call = { id: string; result?: StepResult; child?: State };

/** The error of a saved failure, the same at each replay. */
function errorOf(id: string, result: StepResult): StepError {
  const error = result.error ?? `step "${id}" failed`;
  if (result.exitCode === undefined) return new StepError(id, error, undefined, undefined, result.outputs);
  return new StepError(id, failureMessage(id, result.exitCode, error), result.exitCode, error, result.outputs);
}

// Thrown to leave run at the pending step. A catch in run cannot hide it: the runner reads its own flag.
const SUSPEND = Symbol('suspend');

/** Runs the run function of the rails file, from the start, until the end or the first agent step with no result. */
export function advanceCode(state: State, { exec = runCommand }: { exec?: Exec } = {}): void {
  if (state.status !== 'running' || state.pending) return;
  const definition = loadCode(state.rails.code!) as RailsDefinition;
  const frame = state.frames[0] as Frame;
  const replay = (state.replay ??= { calls: [], notes: 0 });
  let count = 0;
  let notes = 0;
  let pending: PendingStep | null = null;
  let fatal: string | null = null;

  // The steps are replayed by their position: an id can repeat in a loop, and steps.<id> is its last result.
  const step = <T>(id: string, make: (call: Call) => T): T => {
    if (pending || fatal) throw SUSPEND;
    const call = replay.calls[count];
    if (call && call.id !== id) {
      fatal = `the run took another path: step ${count + 1} was "${call.id}" and is now "${id}". Keep run deterministic: use no clock, random value or file read outside sh.`;
      throw SUSPEND;
    }
    count += 1;
    if (call?.result) {
      frame.results[id] = call.result;
      if (call.result.outcome === 'failure') throw errorOf(id, call.result);
      return call.result.outputs as T;
    }
    const current = call ?? { id };
    if (!call) replay.calls.push(current);
    return make(current);
  };
  const save = (call: Call, result: StepResult) => {
    call.result = result;
    frame.results[call.id] = result;
  };

  const suspend = (next: PendingStep | null): never => {
    pending = next;
    throw SUSPEND;
  };

  const shell = (options: ShOptions, mode: 'text' | 'json' | 'jsonl' | 'env') => (first: TemplateStringsArray | string, ...values: unknown[]): unknown => {
    const command = typeof first === 'string' ? first : first.reduce((text, part, i) => text + (i ? quoteArgs([values[i - 1]]) : '') + part, '');
    const id = options.id ?? `sh-${count + 1}`;
    const outputs = step(id, (call) => {
      const result = exec(command, {
        env: options.env ?? {},
        stdout: mode,
        dir: state.rails.dir,
        cwd: options.cwd ? path.resolve(state.cwd, options.cwd) : state.cwd,
        step: id,
        ...(options.timeoutMinutes ? { timeoutMs: options.timeoutMinutes * 60_000 } : {}),
      });
      state.notes.push(...result.warnings);
      // A failed command keeps what it printed, as a failed run step does.
      if (result.outcome === 'failure') {
        save(call, { outcome: 'failure', exitCode: result.exitCode, error: tail(result.stderr), outputs: result.outputs });
        throw errorOf(id, call.result!);
      }
      const outputs = mode === 'text' ? { value: String(result.outputs.value ?? '').trim() } : result.outputs;
      save(call, { outcome: 'success', exitCode: 0, outputs });
      return outputs;
    }) as Record<string, unknown>;
    if (mode === 'text' || mode === 'jsonl') return outputs.value;
    return mode === 'json' && 'value' in outputs && Object.keys(outputs).length === 1 ? outputs.value : outputs;
  };
  const makeSh = (options: ShOptions): Sh =>
    Object.assign(shell(options, 'text'), {
      json: shell(options, 'json'),
      jsonl: shell(options, 'jsonl'),
      env: shell(options, 'env'),
      with: (more: ShOptions) => makeSh({ ...options, ...more }),
    }) as Sh;

  const schema = (id: string, output: unknown) => {
    const full = outputSchema(output);
    const problems = full ? checkOutputSchema(full) : [];
    if (problems.length) {
      fatal = `step "${id}": output: ${problems.join('; ')}`;
      throw SUSPEND;
    }
    return full;
  };
  const instructions = (text: string) => {
    if (!isPromptFile(text)) return resolveLinks(text, state.rails.dir);
    const file = path.resolve(state.rails.dir, text);
    return resolveLinks(fs.readFileSync(file, 'utf8'), path.dirname(file));
  };
  const directory = (dir?: string) => (dir ? { directory: path.resolve(state.cwd, dir) } : {});

  const context: RailsContext<Record<string, never>> = {
    inputs: frame.inputs as never,
    dir: state.rails.dir,
    sh: makeSh({}),
    prompt: (id, text, options = {}) =>
      step(id, () => suspend({
        ...agentStep({ id, prompt: instructions(text), with: options.with, output: schema(id, options.output) }, 'prompt', contextOf(state)),
        ...directory(options.directory),
      })),
    skill: (id, name, options = {}) =>
      step(id, () => suspend({
        ...agentStep({ id, skill: name, with: options.with ?? options.args, prompt: options.prompt && instructions(options.prompt), output: schema(id, options.output) }, 'skill', contextOf(state)),
        ...directory(options.directory),
      })),
    ask: ((id: string, input: AskQuestion | Record<string, AskQuestion | undefined | false>) => {
      const single = typeof (input as AskQuestion).question === 'string';
      const questions = single
        ? [{ id: 'answer', header: id, ...(input as AskQuestion) }]
        : Object.entries(input).flatMap(([key, question]) => (question ? [{ id: key, header: key, ...question }] : []));
      const answers = step(id, (call) => {
        const next = askStep({ id, ask: questions as never }, contextOf(state));
        if (next) return suspend(next);
        save(call, { outcome: 'skipped', outputs: {} });
        return {};
      }) as Record<string, unknown>;
      return single ? answers.answer : answers;
    }) as RailsContext<never>['ask'],
    uses: (id, ref, inputs = {}) =>
      step(id, (call) => {
        const child = (call.child ??= newState(
          loadRails(ref.startsWith('skill:') ? resolveSkillRails(ref.slice('skill:'.length), state.rails.dir, { cwd: state.cwd }) : path.resolve(state.rails.dir, ref), { cwd: state.cwd }),
          inputs,
          state.cwd,
        ));
        advanceRun(child, (command, options) => exec(command, { ...options, step: options.step && `${id}/${options.step}` }));
        state.notes.push(...child.notes.splice(0));
        if (child.pending) return suspend({ ...child.pending, id: `${id}/${child.pending.id}` });
        // A failed nested run keeps its outputs, as a failed YAML uses step does.
        if (child.status === 'failed') {
          save(call, { outcome: 'failure', error: child.message ?? `${ref} failed`, outputs: child.outputs ?? {} });
          throw errorOf(id, call.result!);
        }
        save(call, { outcome: 'success', outputs: child.outputs ?? {} });
        return (child.outputs ?? {}) as never;
      }),
    note: (message) => {
      // After the run stopped at a step, a catch in run can still call note: it does nothing.
      if (pending || fatal) return;
      notes += 1;
      if (notes > replay.notes) {
        replay.notes = notes;
        state.notes.push(message);
      }
    },
  };

  let result: RailsResult = undefined;
  let error: unknown;
  try {
    result = definition.run(context as never);
  } catch (thrown) {
    error = thrown;
  }
  if (fatal) return end(state, 'failed', fatal);
  if (pending) {
    state.pending = pending;
    return;
  }
  if (error !== undefined) return end(state, 'failed', error === SUSPEND ? 'the run stopped with no step to do' : (error as Error).message ?? String(error));
  if (result && typeof result === 'object') {
    state.outputs = result.outputs;
    if (result.fail !== undefined) return end(state, 'failed', result.fail);
    return end(state, 'done', result.message ?? null);
  }
  end(state, 'done', typeof result === 'string' ? result : null);
}

function end(state: State, status: 'done' | 'failed', message: string | null): void {
  state.status = status;
  state.message = message;
  state.pending = null;
}

/** Runs a YAML or TypeScript run until its end or its next agent step. */
export function advanceRun(state: State, exec?: Exec): void {
  if (state.rails.code) advanceCode(state, { exec });
  else advance(state, { exec });
}

const lastCall = (state: State): Call | undefined => state.replay?.calls.at(-1);

/** The nested run of a pending `<uses id>/<step id>`: the run of the last call. */
function childOf(state: State, id: string): { child: State; inner: string } | null {
  const call = lastCall(state);
  return call?.child?.pending && id.startsWith(`${call.id}/`) ? { child: call.child, inner: id.slice(call.id.length + 1) } : null;
}

/** Records the output of the pending step, also in a nested run. */
export function submitCode(state: State, id: string, output: unknown): string[] {
  if (state.pending?.id !== id) return [`the current step is "${state.pending?.id ?? 'none'}", not "${id}"`];
  const route = childOf(state, id);
  if (!route) {
    const errors = submit(state, id, output);
    if (!errors.length) lastCall(state)!.result = (state.frames[0] as Frame).results[id];
    return errors;
  }
  if (state.pending.asked) route.child.pending!.asked = state.pending.asked;
  const errors = route.child.rails.code ? submitCode(route.child, route.inner, output) : submit(route.child, route.inner, output);
  if (!errors.length) state.pending = null;
  return errors;
}

/** The agent cannot do the step: the step fails, and a replay throws its error in run, where code can catch it. */
export function failCode(state: State, id: string, reason: string): string[] {
  if (state.pending?.id !== id) return [`the current step is "${state.pending?.id ?? 'none'}", not "${id}"`];
  const route = childOf(state, id);
  if (route) {
    const errors = route.child.rails.code ? failCode(route.child, route.inner, reason) : failPending(route.child, route.inner, reason);
    if (!errors.length) state.pending = null;
    return errors;
  }
  const { type, instructions, skill, args, questions, directory } = state.pending;
  const request = JSON.parse(JSON.stringify({ type, instructions, skill, args, questions, directory }));
  const result: StepResult = { outcome: 'failure', error: reason, request, answer: { $fail: reason } };
  (state.frames[0] as Frame).results[id] = result;
  lastCall(state)!.result = result;
  state.pending = null;
  return [];
}
