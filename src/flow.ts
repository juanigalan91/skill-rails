// Loads a flow file: YAML, schema check, prompt files, sub-flows, step ids and expressions.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { ValidateFunction } from 'ajv';
import { ajv, formatErrors, schema } from './schema.js';
import { parse, sourcesOf } from './expressions.js';
import type { Flow, ForeachStep, Step, StepKind, UsesStep } from './types.js';

const KEYED_KINDS = ['run', 'skill', 'ask', 'stop', 'foreach', 'uses', 'break'] as const;
const ALL_KINDS: StepKind[] = ['run', 'skill', 'prompt', 'ask', 'stop', 'foreach', 'uses', 'break'];

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
  return Object.hasOwn(step, 'prompt') || Object.hasOwn(step, 'prompt-file') ? 'prompt' : null;
}

// The top level is checked with the steps as plain objects, then each step against the schema of its own type,
// so that an error names one type and not every branch of the oneOf.
const topLevel = ajv.compile({ ...schema, $id: undefined, properties: { ...schema.properties, steps: { type: 'array', minItems: 1 } } });
const stepSchemas = Object.fromEntries(
  ALL_KINDS.map((kind) => [kind, ajv.getSchema(`${schema.$id}#/definitions/${kind}Step`) as ValidateFunction]),
) as Record<StepKind, ValidateFunction>;

function validateSteps(steps: unknown[], at: string, errors: string[], ids: string[], inLoop = false): void {
  steps.forEach((step, index) => {
    const where = `${at}/${index}`;
    const kind = kindOf(step);
    if (!kind) {
      errors.push(`${where} must have exactly one of run, skill, prompt (or prompt-file), ask, stop, foreach, uses, break`);
      return;
    }
    if (kind === 'break' && !inLoop) errors.push(`${where}: break is allowed only inside a foreach`);
    const id = (step as { id?: unknown }).id;
    if (typeof id === 'string') ids.push(id);
    // A foreach is checked with a placeholder body: its own steps are checked one by one below.
    const shallow = kind === 'foreach' ? { ...(step as object), steps: [{ stop: '' }] } : step;
    const check = stepSchemas[kind];
    if (!check(shallow)) errors.push(...formatErrors(where, check.errors).map((line) => `${line} (${kind} step)`));
    const body = (step as { steps?: unknown }).steps;
    if (kind === 'foreach' && Array.isArray(body)) validateSteps(body, `${where}/steps`, errors, ids, true);
  });
}

/** Checks a parsed flow. Returns the errors. */
export function validateFlow(flow: unknown): string[] {
  if (!topLevel(flow)) return formatErrors('', topLevel.errors);
  const errors: string[] = [];
  const ids: string[] = [];
  validateSteps((flow as { steps: unknown[] }).steps, '/steps', errors, ids);
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

/** Reads the prompt files and loads the sub-flows of a list of steps, recursively. */
function prepareSteps(steps: Step[], dir: string, errors: string[], loading: string[]): void {
  for (const step of steps) {
    const withPrompt = step as Step & { prompt?: string; 'prompt-file'?: string };
    const promptFile = withPrompt['prompt-file'];
    if (promptFile) {
      try {
        withPrompt.prompt = fs.readFileSync(path.resolve(dir, promptFile), 'utf8');
      } catch (error) {
        errors.push(`step "${step.id}": cannot read ${promptFile}: ${(error as Error).message}`);
      }
    }
    const kind = kindOf(step);
    if (kind === 'foreach') prepareSteps((step as ForeachStep).steps, dir, errors, loading);
    if (kind === 'uses') {
      const uses = step as UsesStep;
      try {
        uses.flow = loadFile(path.resolve(dir, uses.uses), loading);
      } catch (error) {
        const inner = (error as FlowError).errors ?? [(error as Error).message];
        errors.push(...inner.map((line) => `step "${uses.id}" (${uses.uses}): ${line}`));
      }
    }
  }
}

function loadFile(file: string, loading: string[]): Flow {
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
  prepareSteps(flow.steps, dir, errors, [...loading, resolved]);
  checkExpressions(flow.steps, '/steps', undefined, errors);
  if (errors.length) throw new FlowError(errors);
  return { ...flow, inputs: flow.inputs ?? {}, dir };
}

/** Reads, checks and prepares a flow file and its sub-flows. Throws a FlowError with all the problems. */
export function loadFlow(file: string): Flow {
  return loadFile(file, []);
}
