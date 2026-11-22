// Loads a flow file: YAML, schema check, prompt files, sub-flows, step ids and expressions.
import { outputSchema } from './compact.js';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { ValidateFunction } from 'ajv';
import { ajv, checkOutputSchema, formatErrors, schema } from './schema.js';
import { parse, sourcesOf } from './expressions.js';
import { resolveSkillFlow } from './skills.js';
import type { Flow, ForeachStep, RepeatStep, Step, StepKind, UsesStep, JsonObject } from './types.js';

const KEYED_KINDS = ['run', 'skill', 'ask', 'stop', 'fail', 'note', 'set', 'foreach', 'repeat', 'uses', 'break'] as const;
const ALL_KINDS: StepKind[] = ['run', 'skill', 'prompt', 'ask', 'stop', 'fail', 'note', 'set', 'foreach', 'repeat', 'uses', 'break'];

export class FlowError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('\n'));
  }
}

/** The type of a step, from its keys. A step with a prompt and no other type is a prompt step. */
export function kindOf(step: unknown): StepKind | null {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
  const kinds = KEYED_KINDS.filter((kind) => Object.hasOwn(step, kind));
  if (kinds.length > 1) return null;
  if (kinds[0]) return kinds[0];
  return Object.hasOwn(step, 'prompt') ? 'prompt' : null;
}

// The top level is checked with the steps as plain objects, then each step against the schema of its own type,
// so that an error names one type and not every branch of the oneOf.
const topLevel = ajv.compile({
  ...schema, $id: undefined, properties: { ...schema.properties, steps: { type: 'array', minItems: 1 }, 'on-failure': { type: 'array', minItems: 1 } },
});
const stepSchemas = Object.fromEntries(
  ALL_KINDS.map((kind) => [kind, ajv.getSchema(`${schema.$id}#/definitions/${kind}Step`) as ValidateFunction]),
) as Record<StepKind, ValidateFunction>;

function validateSteps(steps: unknown[], at: string, errors: string[], ids: string[], inLoop = false): void {
  steps.forEach((step, index) => {
    const where = `${at}/${index}`;
    const kind = kindOf(step);
    if (!kind) {
      errors.push(`${where} must have exactly one of run, skill, prompt, ask, stop, fail, note, set, foreach, repeat, uses, break`);
      return;
    }
    if (kind === 'break' && !inLoop) errors.push(`${where}: break is allowed only inside a foreach or a repeat`);
    const id = (step as { id?: unknown }).id;
    if (typeof id === 'string') ids.push(id);
    // A loop is checked with a placeholder body: its own steps are checked one by one below.
    const loop = kind === 'foreach' || kind === 'repeat';
    const shallow = loop ? { ...(step as object), steps: [{ stop: '' }] } : step;
    const check = stepSchemas[kind];
    if (!check(shallow)) errors.push(...formatErrors(where, check.errors).map((line) => `${line} (${kind} step)`));
    const body = (step as { steps?: unknown }).steps;
    if (loop && Array.isArray(body)) validateSteps(body, `${where}/steps`, errors, ids, true);
  });
}

/** Checks a parsed flow. Returns the errors. */
export function validateFlow(flow: unknown): string[] {
  if (!topLevel(flow)) return formatErrors('', topLevel.errors);
  const errors: string[] = [];
  const ids: string[] = [];
  validateSteps((flow as { steps: unknown[] }).steps, '/steps', errors, ids);
  const onFailure = (flow as { 'on-failure'?: unknown[] })['on-failure'];
  if (onFailure) validateSteps(onFailure, '/on-failure', errors, ids);
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) errors.push(`step id "${id}" is used twice`);
  return errors;
}

function checkExpressions(value: unknown, at: string, key: string | undefined, errors: string[]): void {
  for (const source of sourcesOf(value, key)) {
    try {
      parse(source);
    } catch (error) {
      errors.push(`${at}: ${(error as Error).message} in "${source.trim()}"`);
    }
  }
  if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) {
      // A run command holds no expression, and a loaded sub-flow was checked when it was loaded.
      if (childKey !== 'run' && childKey !== 'flow') checkExpressions(child, `${at}/${childKey}`, childKey, errors);
    }
  }
}

/** A prompt that is one word ending with .md is the path of a Markdown file; any other text is the instructions. */
export const isPromptFile = (prompt: unknown): prompt is string => typeof prompt === 'string' && /^\S+\.md$/.test(prompt.trim());

/** Reads the prompt files and loads the sub-flows of a list of steps, recursively. */
function prepareSteps(steps: Step[], dir: string, errors: string[], loading: string[], cwd: string): void {
  for (const step of steps) {
    const withPrompt = step as Step & { prompt?: string };
    if (isPromptFile(withPrompt.prompt)) {
      try {
        withPrompt.prompt = fs.readFileSync(path.resolve(dir, withPrompt.prompt), 'utf8');
      } catch (error) {
        errors.push(`step "${step.id}": cannot read ${withPrompt.prompt}: ${(error as Error).message}`);
      }
    }
    const withOutput = step as Step & { output?: unknown };
    if (withOutput.output !== undefined) {
      try {
        withOutput.output = outputSchema(withOutput.output);
        for (const problem of checkOutputSchema(withOutput.output as JsonObject)) errors.push(`step "${step.id}": output: ${problem} (quote a text that holds a comma or a colon)`);
      } catch (error) {
        errors.push(`step "${step.id}": output: ${(error as Error).message}`);
      }
    }
    const kind = kindOf(step);
    if (kind === 'foreach' || kind === 'repeat') prepareSteps((step as ForeachStep | RepeatStep).steps, dir, errors, loading, cwd);
    if (kind === 'uses') {
      const uses = step as UsesStep;
      try {
        const file = uses.uses.startsWith('skill:') ? resolveSkillFlow(uses.uses.slice('skill:'.length), dir, { cwd }) : path.resolve(dir, uses.uses);
        uses.flow = loadFile(file, loading, cwd);
      } catch (error) {
        const inner = (error as FlowError).errors ?? [(error as Error).message];
        errors.push(...inner.map((line) => `step "${uses.id}" (${uses.uses}): ${line}`));
      }
    }
  }
}

function loadFile(file: string, loading: string[], cwd: string): Flow {
  const resolved = path.resolve(file);
  if (loading.includes(resolved)) {
    throw new FlowError([`the flows use each other: ${[...loading, resolved].map((f) => path.basename(path.dirname(f)) + '/' + path.basename(f)).join(' → ')}`]);
  }
  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new FlowError([`cannot read ${file}: ${(error as Error).message}`]);
  }
  const errors = validateFlow(raw);
  if (errors.length) throw new FlowError(errors);
  const flow = raw as Omit<Flow, 'dir'>;
  const dir = path.dirname(resolved);
  prepareSteps(flow.steps, dir, errors, [...loading, resolved], cwd);
  if (flow['on-failure']) prepareSteps(flow['on-failure'], dir, errors, [...loading, resolved], cwd);
  checkExpressions(flow.steps, '/steps', undefined, errors);
  checkExpressions(flow['on-failure'], '/on-failure', undefined, errors);
  checkExpressions(flow.outputs, '/outputs', undefined, errors);
  if (errors.length) throw new FlowError(errors);
  return { ...flow, inputs: flow.inputs ?? {}, dir };
}

/** Reads, checks and prepares a flow file and its sub-flows. Throws a FlowError with all the problems. */
export function loadFlow(file: string, { cwd = process.cwd() }: { cwd?: string } = {}): Flow {
  return loadFile(file, [], cwd);
}
