// The engine: runs the run, stop, foreach and uses steps, and stops at the next step for the agent.
// The state is a stack of frames: the root flow, then one frame per sub-flow and per foreach iteration.
import { condition, render, text } from './expressions.js';
import { kindOf } from './flow.js';
import { runCommand } from './run.js';
import { validateOutput } from './schema.js';
import type {
  AskStep,
  Context,
  Exec,
  ForeachStep,
  Frame,
  Flow,
  InputSpec,
  InputValue,
  JsonObject,
  Option,
  PendingStep,
  PromptStep,
  Report,
  RunStep,
  SkillStep,
  State,
  StopStep,
  UsesStep,
} from './types.js';

const TAIL_LINES = 20;
const POLL_INTERVAL_SECONDS = 30;
const POLL_TIMEOUT_MINUTES = 30;
const RUN_TIMEOUT_MINUTES = 10;
// A poll gives control back to the agent after this time, so that one done call stays under the tool timeout of the agent.
const waitSliceMs = () => Number(process.env.SKILL_RAILS_WAIT_SLICE_SECONDS ?? 540) * 1000;
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export class InputError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('\n'));
  }
}

export function resolveInputs(spec: Record<string, InputSpec>, given: Record<string, unknown>): Record<string, InputValue> {
  const errors: string[] = [];
  for (const key of Object.keys(given)) if (!Object.hasOwn(spec, key)) errors.push(`unknown input "${key}"`);
  const values: Record<string, InputValue> = {};
  for (const [key, def] of Object.entries(spec)) {
    const raw = given[key];
    if (raw === undefined || raw === null) {
      if (def.required) errors.push(`input "${key}" is required`);
      values[key] = def.default ?? null;
    } else if (def.type === 'boolean') {
      if (![true, false, 'true', 'false'].includes(raw as string | boolean)) errors.push(`input "${key}" must be true or false`);
      values[key] = raw === true || raw === 'true';
    } else if (def.type === 'number') {
      if (!Number.isFinite(Number(raw))) errors.push(`input "${key}" must be a number`);
      values[key] = Number(raw);
    } else values[key] = typeof raw === 'string' ? raw : text(raw);
  }
  if (errors.length) throw new InputError(errors);
  return values;
}

export function newState(flow: Flow, given: Record<string, unknown> = {}, cwd = process.cwd()): State {
  const root: Frame = { kind: 'root', name: flow.name, dir: flow.dir, steps: flow.steps, index: 0, inputs: resolveInputs(flow.inputs, given), results: {} };
  return { flow, cwd, frames: [root], notes: [], status: 'running', pending: null, message: null };
}

const top = (state: State): Frame => state.frames[state.frames.length - 1] as Frame;

/** The frames of the current flow (root or sub-flow), outer first: a flow sees its own steps only. */
function currentFlowFrames(state: State): Frame[] {
  const frames: Frame[] = [];
  for (let i = state.frames.length - 1; i >= 0; i--) {
    const frame = state.frames[i] as Frame;
    frames.unshift(frame);
    if (frame.kind !== 'foreach') break;
  }
  return frames;
}

function contextOf(state: State): Context {
  const frames = currentFlowFrames(state);
  const flowFrame = frames[0] as Frame;
  const loop = [...frames].reverse().find((frame) => frame.kind === 'foreach');
  return {
    inputs: flowFrame.inputs,
    steps: Object.assign({}, ...frames.map((frame) => frame.results)),
    env: { ...process.env },
    flow: { name: flowFrame.name, dir: flowFrame.dir },
    item: loop?.items?.[loop.position ?? 0] ?? null,
    loop: loop ? { index: loop.position ?? 0, count: loop.items?.length ?? 0 } : null,
  };
}

export function finish(state: State, status: 'done' | 'failed', message: string | null): void {
  Object.assign(state, { status, message: message || null, pending: null });
}

/** Ends the current flow. A sub-flow becomes the result of its uses step; a failure goes up unless continue-on-error. */
function endFlow(state: State, status: 'done' | 'failed', message: string | null): void {
  for (;;) {
    const frame = top(state);
    if (frame.kind === 'root') return finish(state, status, message);
    state.frames.pop();
    if (frame.kind !== 'flow') continue;
    const parent = top(state);
    const uses = parent.steps[parent.index] as UsesStep;
    parent.results[frame.id as string] = { outcome: status === 'done' ? 'success' : 'failure', outputs: { status, message, steps: frame.results } };
    if (status === 'failed' && !uses['continue-on-error']) {
      message = `Step "${frame.id}" failed: ${message ?? 'the flow failed'}`;
      continue;
    }
    parent.index += 1;
    return;
  }
}

/** The current frame has no more steps, or a break ends its loop. */
function endFrame(state: State, broken = false): void {
  const frame = top(state);
  if (frame.kind === 'root' || frame.kind === 'flow') return endFlow(state, 'done', null);
  const items = frame.items ?? [];
  const position = frame.position ?? 0;
  frame.iterations = [...(frame.iterations ?? []), { item: items[position], steps: frame.results }];
  if (!broken && position + 1 < items.length) {
    Object.assign(frame, { position: position + 1, results: {}, index: 0 });
    return;
  }
  state.frames.pop();
  const parent = top(state);
  parent.results[frame.id as string] = { outcome: 'success', outputs: { count: items.length, done: frame.iterations.length, broken, results: frame.iterations } };
  parent.index += 1;
}

function askStep(step: AskStep, context: Context): PendingStep | null {
  const questions = step.ask
    .filter((question) => condition(question.if, context))
    .map(({ if: _, ...question }) => ({
      ...question,
      question: text(render(question.question, context)),
      multiSelect: Boolean(question.multiSelect),
      free: Boolean(question.free),
      options: ((render(question.options ?? [], context) as unknown[]).flat() as Option[]),
    }));
  if (!questions.length) return null;
  const properties: JsonObject = Object.fromEntries(
    questions.map((question) => {
      if (question.free) return [question.id, { type: 'string', minLength: 1 }];
      const labels = { enum: question.options.map((option) => option.label) };
      return [question.id, question.multiSelect ? { type: 'array', items: labels } : labels];
    }),
  );
  return { id: step.id, type: 'ask', questions, output: { type: 'object', properties, required: Object.keys(properties) } };
}

function agentStep(step: SkillStep | PromptStep, kind: 'skill' | 'prompt', context: Context): PendingStep {
  const skillStep = kind === 'skill' ? (step as SkillStep) : undefined;
  return {
    id: step.id,
    type: kind,
    skill: skillStep?.skill,
    args: skillStep?.with === undefined ? undefined : text(render(skillStep.with, context)),
    instructions: step.prompt === undefined ? undefined : text(render(step.prompt, context)),
    output: step.output,
  };
}

function failureMessage(id: string, exitCode: number, stderr: string): string {
  const tail = stderr.trim().split('\n').slice(-TAIL_LINES).join('\n');
  return `Step "${id}" failed with exit code ${exitCode}.${tail ? `\n${tail}` : ''}`;
}

/** Runs a run step once, or polls it until its condition. Returns true when the step is over. */
function runStep(state: State, step: RunStep, id: string, exec: Exec): void {
  const frame = top(state);
  const once = () => {
    const result = exec(step.run, {
      env: render(step.env ?? {}, contextOf(state)) as Record<string, unknown>,
      dir: frame.dir,
      cwd: state.cwd,
      timeoutMs: (step.until === undefined ? (step['timeout-minutes'] ?? RUN_TIMEOUT_MINUTES) : RUN_TIMEOUT_MINUTES) * 60_000,
    });
    frame.results[id] = { outcome: result.outcome, exitCode: result.exitCode, outputs: result.outputs };
    state.notes.push(...result.warnings);
    return result;
  };
  const fail = (message: string): void => {
    frame.pollStarted = undefined;
    if (step['continue-on-error']) frame.index += 1;
    else endFlow(state, 'failed', message);
  };

  if (step.until === undefined) {
    const result = once();
    if (result.outcome === 'failure') return fail(failureMessage(id, result.exitCode, result.stderr));
    frame.index += 1;
    return;
  }
  frame.pollStarted ??= Date.now();
  const deadline = frame.pollStarted + (step['timeout-minutes'] ?? POLL_TIMEOUT_MINUTES) * 60_000;
  const sliceEnd = Date.now() + waitSliceMs();
  const interval = (step['interval-seconds'] ?? POLL_INTERVAL_SECONDS) * 1000;
  for (;;) {
    const result = once();
    if (result.outcome === 'failure') return fail(failureMessage(id, result.exitCode, result.stderr));
    if (condition(step.until, contextOf(state))) {
      frame.pollStarted = undefined;
      frame.index += 1;
      return;
    }
    if (Date.now() + interval > deadline) {
      (frame.results[id] as { outcome: string }).outcome = 'failure';
      return fail(`Step "${id}" timed out after ${step['timeout-minutes'] ?? POLL_TIMEOUT_MINUTES} minutes.`);
    }
    if (Date.now() + interval > sliceEnd) {
      state.pending = {
        id,
        type: 'wait',
        instructions: `Step "${id}" is still waiting (polls every ${interval / 1000} s). Report it as done, with no output, to keep waiting.`,
      };
      return;
    }
    sleep(interval);
  }
}

/** Runs steps until the flow ends or a step waits for the agent. */
export function advance(state: State, { exec = runCommand }: { exec?: Exec } = {}): void {
  while (state.status === 'running' && !state.pending) {
    const frame = top(state);
    const step = frame.steps[frame.index];
    if (!step) {
      endFrame(state);
      continue;
    }
    const id = step.id ?? `step-${frame.index}`;
    const kind = kindOf(step);
    const context = contextOf(state);
    if (!condition(step.if, context)) {
      frame.results[id] = { outcome: 'skipped' };
      frame.index += 1;
      continue;
    }
    switch (kind) {
      case 'stop': {
        const stop = step as StopStep;
        endFlow(state, stop.outcome === 'failure' ? 'failed' : 'done', text(render(stop.stop, context)));
        break;
      }
      case 'run':
        runStep(state, step as RunStep, id, exec);
        break;
      case 'break':
        frame.results[id] = { outcome: 'success' };
        endFrame(state, true);
        break;
      case 'foreach': {
        const foreach = step as ForeachStep;
        const items = typeof foreach.foreach === 'string' ? render(foreach.foreach, context) : foreach.foreach;
        if (!Array.isArray(items)) {
          endFlow(state, 'failed', `Step "${id}": foreach needs a list, and got ${JSON.stringify(items)}.`);
          break;
        }
        if (!items.length) {
          frame.results[id] = { outcome: 'success', outputs: { count: 0, done: 0, broken: false, results: [] } };
          frame.index += 1;
          break;
        }
        state.frames.push({ kind: 'foreach', id, name: frame.name, dir: frame.dir, steps: foreach.steps, index: 0, inputs: frame.inputs, results: {}, items, position: 0, iterations: [] });
        break;
      }
      case 'uses': {
        const uses = step as UsesStep;
        const child = uses.flow as Flow;
        let inputs: Record<string, InputValue>;
        try {
          inputs = resolveInputs(child.inputs, render(uses.with ?? {}, context) as Record<string, unknown>);
        } catch (error) {
          endFlow(state, 'failed', `Step "${id}" (${uses.uses}): ${(error as Error).message}`);
          break;
        }
        state.frames.push({ kind: 'flow', id, name: child.name, dir: child.dir, steps: child.steps, index: 0, inputs, results: {} });
        break;
      }
      default: {
        const pending = kind === 'ask' ? askStep(step as AskStep, context) : agentStep(step as SkillStep | PromptStep, kind as 'skill' | 'prompt', context);
        if (pending) state.pending = pending;
        else {
          frame.results[id] = { outcome: 'skipped' };
          frame.index += 1;
        }
      }
    }
  }
}

/** Records the output of the waiting step. Returns the errors; none when the flow can go on. */
export function submit(state: State, id: string, output: unknown = {}): string[] {
  if (!state.pending) return [`no step waits for an output: the flow is ${state.status}`];
  if (state.pending.id !== id) return [`the current step is "${state.pending.id}", not "${id}"`];
  if (state.pending.type === 'wait') {
    // The poll goes on from where it stopped: the step keeps its place.
    state.pending = null;
    return [];
  }
  const errors = validateOutput(state.pending.output ?? { type: 'object' }, output);
  if (errors.length) return errors;
  const frame = top(state);
  frame.results[id] = { outcome: 'success', outputs: output as Record<string, unknown> };
  state.pending = null;
  frame.index += 1;
  return [];
}

/** The step results of the root flow. */
export const rootResults = (state: State) => (state.frames[0] as Frame).results;

/** What the agent reads after each command. The notes are shown once. */
export function report(state: State): Report {
  const notes = state.notes.splice(0);
  const extra = notes.length ? { notes } : {};
  if (state.pending) return { status: 'step', flow: state.flow.name, ...state.pending, ...extra };
  return { status: state.status, flow: state.flow.name, message: state.message, ...extra };
}
