import path from 'node:path';
// The engine: runs the run, stop, foreach, repeat and uses steps, and stops at the next step for the agent.
// The state is a stack of frames: the root flow, then one frame per sub-flow and per foreach or repeat iteration.
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
  NoteStep,
  Option,
  SetStep,
  Question,
  PendingStep,
  PromptStep,
  RepeatStep,
  Report,
  RunStep,
  SkillStep,
  State,
  StepRequest,
  StopStep,
  UsesStep,
} from './types.js';

const TAIL_LINES = 20;
const POLL_INTERVAL_SECONDS = 30;
const POLL_TIMEOUT_MINUTES = 30;
const RUN_TIMEOUT_MINUTES = 10;
const REPEAT_MAX_ITERATIONS = 10;
// A poll gives control back to the agent after this time, so that one done call stays under the tool timeout of the agent.
const waitSliceMs = () => {
  const seconds = Number(process.env.SKILL_RAILS_WAIT_SLICE_SECONDS ?? 20);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 20) * 1000;
};
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export class InputError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('\n'));
  }
}

/** A list input: a list, a JSON list, or a text with one item per line or per comma. */
function listValue(raw: unknown): string[] | null {
  if (Array.isArray(raw)) return raw.map(text);
  if (typeof raw !== 'string') return null;
  if (raw.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(text);
    } catch {
      // Not JSON: split it below.
    }
  }
  return raw.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

export function resolveInputs(spec: Record<string, InputSpec>, given: Record<string, unknown>): Record<string, InputValue> {
  const errors: string[] = [];
  for (const key of Object.keys(given)) if (!Object.hasOwn(spec, key)) errors.push(`unknown input "${key}"`);
  const values: Record<string, InputValue> = {};
  for (const [key, def] of Object.entries(spec)) {
    const raw = given[key];
    if (raw === undefined || raw === null) {
      if (def.required) errors.push(`input "${key}" is required`);
      values[key] = def.default ?? (def.type === 'list' ? [] : null);
    } else if (def.type === 'boolean') {
      if (![true, false, 'true', 'false'].includes(raw as string | boolean)) errors.push(`input "${key}" must be true or false`);
      values[key] = raw === true || raw === 'true';
    } else if (def.type === 'list') {
      values[key] = listValue(raw);
      if (!values[key]) errors.push(`input "${key}" must be a list`);
    } else if (def.type === 'number') {
      if (!Number.isFinite(Number(raw))) errors.push(`input "${key}" must be a number`);
      values[key] = Number(raw);
    } else values[key] = typeof raw === 'string' ? raw : text(raw);
    const value = values[key];
    if (def.enum && value !== null && value !== undefined) {
      const bad = (Array.isArray(value) ? value : [value]).filter((item) => !def.enum?.includes(item as string));
      if (bad.length) errors.push(`input "${key}" must be one of ${def.enum.join(', ')}: got ${bad.join(', ')}`);
    }
  }
  if (errors.length) throw new InputError(errors);
  return values;
}

export function newState(flow: Flow, given: Record<string, unknown> = {}, cwd = process.cwd()): State {
  const root: Frame = { kind: 'root', name: flow.name, dir: flow.dir, steps: flow.steps, index: 0, inputs: resolveInputs(flow.inputs, given), results: {}, outputs: flow.outputs, onFailure: flow['on-failure'] };
  return { flow, cwd, frames: [root], notes: [], status: 'running', pending: null, message: null };
}

const top = (state: State): Frame => state.frames[state.frames.length - 1] as Frame;

/** The frames of the current flow (root or sub-flow), outer first: a flow sees its own steps only. */
function currentFlowFrames(state: State): Frame[] {
  const frames: Frame[] = [];
  for (let i = state.frames.length - 1; i >= 0; i--) {
    const frame = state.frames[i] as Frame;
    frames.unshift(frame);
    if (frame.kind !== 'foreach' && frame.kind !== 'repeat') break;
  }
  return frames;
}

/** The folder of the innermost flow with a working-directory, else the project. */
function frameCwd(state: State): string {
  return [...state.frames].reverse().find((frame) => frame.cwd)?.cwd ?? state.cwd;
}

/** The innermost loop, with `parent` for the loop around it. */
function loopContext(loops: Frame[]): Context['loop'] {
  const [loop, ...outer] = loops;
  if (!loop) return null;
  return {
    index: loop.position ?? 0,
    number: (loop.position ?? 0) + 1,
    count: loop.kind === 'repeat' ? (loop.maxIterations ?? 0) : (loop.items?.length ?? 0),
    previous: loop.iterations?.at(-1)?.steps ?? null,
    parent: loopContext(outer),
  };
}

function contextOf(state: State): Context {
  const frames = currentFlowFrames(state);
  const flowFrame = frames[0] as Frame;
  const inner = [...frames].reverse();
  const foreach = inner.find((frame) => frame.kind === 'foreach');
  return {
    inputs: flowFrame.inputs,
    steps: Object.assign({}, ...frames.map((frame) => frame.results)),
    env: { ...process.env },
    flow: { name: flowFrame.name, dir: flowFrame.dir },
    item: foreach?.items?.[foreach.position ?? 0] ?? null,
    failure: flowFrame.failure ?? null,
    loop: loopContext(inner.filter((frame) => frame.kind === 'foreach' || frame.kind === 'repeat')),
  };
}

export function finish(state: State, status: 'done' | 'failed', message: string | null): void {
  Object.assign(state, { status, message: message || null, pending: null });
}

/** The declared outputs of the flow of the top frame: an object, or { value } for another result. */
function flowOutputs(state: State, spec: Frame['outputs']): Record<string, unknown> | undefined {
  if (spec === undefined) return undefined;
  const value = render(spec, contextOf(state));
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
}

/** Ends the current flow. A sub-flow becomes the result of its uses step; a failure goes up unless continue-on-error. */
function endFlow(state: State, status: 'done' | 'failed', message: string | null, stopped = false): void {
  for (;;) {
    const frame = top(state);
    if (frame.kind === 'root' || frame.kind === 'flow') {
      if (frame.failure) {
        // The failure steps ended: the flow fails with its first reason.
        status = 'failed';
        message = frame.failure.message;
      } else if (status === 'failed' && frame.onFailure?.length) {
        frame.failure = { message };
        frame.steps = frame.onFailure;
        frame.index = 0;
        return;
      }
    }
    if (frame.kind === 'root') {
      state.outputs = flowOutputs(state, frame.outputs);
      return finish(state, status, message);
    }
    const declared = frame.kind === 'flow' ? flowOutputs(state, frame.outputs) : undefined;
    if (frame.kind === 'foreach' || frame.kind === 'repeat') {
      // Keep the current iteration when a failure or stop unwinds the loop, so
      // record/trace retain its agent requests and answers as well as earlier ones.
      const parent = state.frames[state.frames.length - 2] as Frame;
      const iterations = [...(frame.iterations ?? []), {
        item: frame.kind === 'foreach' ? frame.items?.[frame.position ?? 0] : null,
        steps: frame.results,
      }];
      parent.results[frame.id as string] = {
        outcome: status === 'done' ? 'success' : 'failure',
        outputs: frame.kind === 'foreach'
          ? { count: frame.items?.length ?? 0, done: iterations.length, broken: false, results: iterations }
          : { count: iterations.length, broken: false, exhausted: false, results: iterations.map(({ steps }) => ({ steps })), last: frame.results },
      };
    }
    state.frames.pop();
    if (frame.kind !== 'flow') continue;
    const parent = top(state);
    const uses = parent.steps[parent.index] as UsesStep;
    // The declared outputs come first: status, message and steps keep their meaning.
    parent.results[frame.id as string] = { outcome: status === 'done' ? 'success' : 'failure', outputs: { ...declared, status, message, steps: frame.results } };
    if (status === 'failed' && !uses['continue-on-error']) {
      message = `Step "${frame.id}" failed: ${message ?? 'the flow failed'}`;
      continue;
    }
    // A stop of the other flow also ends this flow, with the same message.
    if (stopped && uses['forward-stop']) continue;
    parent.index += 1;
    return;
  }
}

/** The current frame has no more steps, or a break ends its loop. */
function endFrame(state: State, broken = false): void {
  const frame = top(state);
  if (frame.kind === 'root' || frame.kind === 'flow') return endFlow(state, 'done', null);
  if (frame.kind === 'repeat') return endRepeat(state, frame, broken);
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

function endRepeat(state: State, frame: Frame, broken: boolean): void {
  const position = frame.position ?? 0;
  const max = frame.maxIterations ?? REPEAT_MAX_ITERATIONS;
  // until sees the results of the iteration that just ended.
  const met = !broken && condition(frame.until, contextOf(state));
  frame.iterations = [...(frame.iterations ?? []), { item: null, steps: frame.results }];
  if (!broken && !met && position + 1 < max) {
    Object.assign(frame, { position: position + 1, results: {}, index: 0 });
    return;
  }
  state.frames.pop();
  const parent = top(state);
  const results = frame.iterations.map(({ steps }) => ({ steps }));
  parent.results[frame.id as string] = {
    outcome: 'success',
    outputs: { count: results.length, broken, exhausted: !broken && !met, results, last: frame.results },
  };
  parent.index += 1;
}

const HEADER_MAX = 12;

/** A plain label is an option with no description. */
const option = (value: unknown): Option =>
  typeof value === 'string' ? { label: value, description: '' } : { ...(value as Option), description: (value as Option).description ?? '' };
const DYNAMIC_MAX = 4;

/** The questions of a dynamic ask: the list that its expression gives. */
function dynamicQuestions(step: AskStep, context: Context): Question[] {
  const list = render(step.ask, context);
  const items = (Array.isArray(list) ? list : []).filter((item) => item && typeof item === 'object') as Array<Partial<Question>>;
  return items.slice(0, step.max ?? DYNAMIC_MAX).map((item, i) => {
    const options = (item.options ?? []).map((option) => (typeof option === 'string' ? { label: option, description: '' } : option));
    return {
      ...item,
      id: item.id ?? `q${i + 1}`,
      header: text(item.header ?? 'Question').slice(0, HEADER_MAX),
      question: text(item.question),
      options: options.length ? [...options, ...(step['extra-options'] ?? [])] : options,
    } as Question;
  });
}

function askStep(step: AskStep, context: Context): PendingStep | null {
  const source = typeof step.ask === 'string' ? dynamicQuestions(step, context) : step.ask;
  const questions = source
    .filter((question) => condition(question.if, context))
    .map(({ if: _, ...question }) => ({
      ...question,
      question: text(render(question.question, context)),
      multiSelect: Boolean(question.multiSelect),
      free: Boolean(question.free),
      other: Boolean(question.other),
      options: (render(question.options ?? [], context) as unknown[]).flat().map(option),
    }));
  if (!questions.length) return null;
  // An option with a value: the step output holds the value in place of the label.
  const values: Record<string, Record<string, unknown>> = {};
  for (const question of questions) {
    for (const option of question.options) {
      if (option.value === undefined) continue;
      (values[question.id] ??= {})[option.label] = option.value;
    }
    question.options = question.options.map(({ value: _, ...option }) => option);
  }
  const properties: JsonObject = Object.fromEntries(
    questions.map((question) => {
      if (question.free || !question.options.length) return [question.id, { type: 'string', minLength: 1 }];
      const labels = question.other ? { type: 'string', minLength: 1 } : { enum: question.options.map((option) => option.label) };
      return [question.id, question.multiSelect ? { type: 'array', items: labels } : labels];
    }),
  );
  return {
    id: step.id, type: 'ask', questions, output: { type: 'object', properties, required: Object.keys(properties) },
    ...(Object.keys(values).length ? { values } : {}),
  };
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

const tail = (stderr: string): string => stderr.trim().split('\n').slice(-TAIL_LINES).join('\n');

function failureMessage(id: string, exitCode: number, stderr: string): string {
  const last = tail(stderr);
  return `Step "${id}" failed with exit code ${exitCode}.${last ? `\n${last}` : ''}`;
}

/** Runs a run step once, or polls it until its condition. Returns true when the step is over. */
function runStep(state: State, step: RunStep, id: string, exec: Exec): void {
  const frame = top(state);
  let commandTimeoutMs = (step['timeout-minutes'] ?? RUN_TIMEOUT_MINUTES) * 60_000;
  const once = () => {
    const context = contextOf(state);
    const result = exec(step.run, {
      env: render(step.env ?? {}, context) as Record<string, unknown>,
      args: render(step.args ?? [], context) as unknown[],
      stdout: step.stdout,
      dir: frame.dir,
      cwd: step['working-directory'] ? path.resolve(frameCwd(state), text(render(step['working-directory'], context))) : frameCwd(state),
      timeoutMs: commandTimeoutMs,
    });
    frame.results[id] = { outcome: result.outcome, exitCode: result.exitCode, outputs: result.outputs };
    state.notes.push(...result.warnings);
    return result;
  };
  const fail = (message: string, error?: string): void => {
    frame.pollStarted = undefined;
    frame.pollNextAt = undefined;
    const result = frame.results[id];
    if (result) Object.assign(result, { outcome: 'failure', error: error ?? message });
    const go = step['continue-on-error'];
    if (go === true || (Array.isArray(go) && result?.exitCode !== undefined && go.includes(result.exitCode))) frame.index += 1;
    else endFlow(state, 'failed', message);
  };

  if (step.until === undefined) {
    const result = once();
    if (result.outcome === 'failure') return fail(failureMessage(id, result.exitCode, result.stderr), tail(result.stderr));
    frame.index += 1;
    return;
  }
  frame.pollStarted ??= Date.now();
  const deadline = frame.pollStarted + (step['timeout-minutes'] ?? POLL_TIMEOUT_MINUTES) * 60_000;
  const sliceEnd = Date.now() + waitSliceMs();
  const interval = (step['interval-seconds'] ?? POLL_INTERVAL_SECONDS) * 1000;
  const wait = (retryAt: number) => {
    state.pending = {
      id, type: 'wait', retryAt,
      instructions: `Step "${id}" is still waiting. Wait until ${new Date(retryAt).toISOString()}, then report it as done with no output to keep waiting.`,
    };
  };
  for (;;) {
    const now = Date.now();
    if (now >= deadline) return fail(`Step "${id}" timed out after ${step['timeout-minutes'] ?? POLL_TIMEOUT_MINUTES} minutes.`);
    if (frame.pollNextAt && now < frame.pollNextAt) {
      if (frame.pollNextAt >= sliceEnd) return wait(frame.pollNextAt);
      sleep(frame.pollNextAt - now);
    }
    // A single poll command also fits the remaining slice and overall deadline.
    commandTimeoutMs = Math.max(1, Math.min(RUN_TIMEOUT_MINUTES * 60_000, deadline - Date.now(), sliceEnd - Date.now()));
    const result = once();
    if (result.outcome === 'failure') return fail(failureMessage(id, result.exitCode, result.stderr), tail(result.stderr));
    if (condition(step.until, contextOf(state))) {
      frame.pollStarted = undefined;
      frame.pollNextAt = undefined;
      frame.index += 1;
      return;
    }
    if (Date.now() + interval > deadline) {
      return fail(`Step "${id}" timed out after ${step['timeout-minutes'] ?? POLL_TIMEOUT_MINUTES} minutes.`);
    }
    frame.pollNextAt = Date.now() + interval;
    if (frame.pollNextAt >= sliceEnd) return wait(frame.pollNextAt);
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
      case 'stop':
      case 'fail': {
        const stop = step as StopStep;
        const failed = kind === 'fail' || stop.outcome === 'failure';
        endFlow(state, failed ? 'failed' : 'done', text(render(stop.fail ?? stop.stop ?? '', context)), true);
        break;
      }
      case 'run':
        runStep(state, step as RunStep, id, exec);
        break;
      case 'note': {
        const note = text(render((step as NoteStep).note, context)).trim();
        if (note) state.notes.push(note);
        frame.results[id] = { outcome: 'success' };
        frame.index += 1;
        break;
      }
      case 'set':
        frame.results[id] = { outcome: 'success', outputs: render((step as SetStep).set, context) as Record<string, unknown> };
        frame.index += 1;
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
      case 'repeat': {
        const repeat = step as RepeatStep;
        state.frames.push({
          kind: 'repeat', id, name: frame.name, dir: frame.dir, steps: repeat.steps, index: 0, inputs: frame.inputs, results: {},
          position: 0, iterations: [], until: repeat.repeat.until, maxIterations: repeat.repeat['max-iterations'] ?? REPEAT_MAX_ITERATIONS,
        });
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
        const workdir = uses['working-directory'] ? path.resolve(frameCwd(state), text(render(uses['working-directory'], context))) : undefined;
        state.frames.push({
          kind: 'flow', id, name: child.name, dir: child.dir, steps: child.steps, index: 0, inputs, results: {}, outputs: child.outputs,
          onFailure: child['on-failure'], ...(workdir ? { cwd: workdir } : {}),
        });
        break;
      }
      default: {
        const pending = kind === 'ask' ? askStep(step as AskStep, context) : agentStep(step as SkillStep | PromptStep, kind as 'skill' | 'prompt', context);
        const own = (step as { 'working-directory'?: string })['working-directory'];
        const directory = own ? path.resolve(frameCwd(state), text(render(own, context))) : frameCwd(state);
        if (pending) state.pending = directory === state.cwd || kind === 'ask' ? pending : { ...pending, directory };
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
  frame.results[id] = { outcome: 'success', outputs: answerValues(state.pending, output as Record<string, unknown>), request: requestOf(state.pending), answer: output };
  state.pending = null;
  frame.index += 1;
  return [];
}

/** What the agent was asked, without the empty keys. */
function requestOf({ type, instructions, skill, args, questions, directory }: PendingStep): StepRequest {
  return JSON.parse(JSON.stringify({ type, instructions, skill, args, questions, directory })) as StepRequest;
}

function answerValues(pending: PendingStep, output: Record<string, unknown>): Record<string, unknown> {
  if (!pending.values) return output;
  const map = (id: string, answer: unknown) => {
    const values = pending.values?.[id];
    if (!values) return answer;
    const one = (label: unknown) => (typeof label === 'string' && label in values ? values[label] : label);
    return Array.isArray(answer) ? answer.map(one) : one(answer);
  };
  return Object.fromEntries(Object.entries(output).map(([id, answer]) => [id, map(id, answer)]));
}

/** The agent cannot do the current step: the step fails, and the failure goes up as a run step failure does. */
export function failPending(state: State, id: string, reason: string): string[] {
  if (state.pending?.id !== id) return [`the current step is "${state.pending?.id ?? 'none'}", not "${id}"`];
  const request = requestOf(state.pending);
  state.pending = null;
  const frame = top(state);
  frame.results[id] = { outcome: 'failure', error: reason, request, answer: { $fail: reason } };
  const step = frame.steps[frame.index] as { 'continue-on-error'?: unknown };
  if (step['continue-on-error'] === true) frame.index += 1;
  else endFlow(state, 'failed', reason);
  return [];
}

/** The step results of the root flow. */
export const rootResults = (state: State) => (state.frames[0] as Frame).results;

/** What the agent reads after each command. The notes are shown once. */
export function report(state: State): Report {
  const notes = state.notes.splice(0);
  const extra = notes.length ? { notes } : {};
  if (state.pending) {
    const { values: _, ...pending } = state.pending;
    return { status: 'step', flow: state.flow.name, ...pending, ...extra };
  }
  const outputs = state.outputs ? { outputs: state.outputs } : {};
  return { status: state.status, flow: state.flow.name, message: state.message, ...outputs, ...extra };
}
