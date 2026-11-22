// Loads a rails file: YAML, schema check, prompt files, nested rails files, step ids and expressions.
import { outputSchema } from './compact.js';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { ValidateFunction } from 'ajv';
import { ajv, checkOutputSchema, formatErrors, schema } from './schema.js';
import { parse, sourcesOf } from './expressions.js';
import { resolveSkillRails } from './skills.js';
import type { Rails, ForeachStep, RepeatStep, Step, StepKind, UsesStep, JsonObject } from './types.js';

const KEYED_KINDS = ['run', 'skill', 'ask', 'stop', 'fail', 'note', 'set', 'foreach', 'repeat', 'uses', 'break'] as const;
const ALL_KINDS: StepKind[] = ['run', 'skill', 'prompt', 'ask', 'stop', 'fail', 'note', 'set', 'foreach', 'repeat', 'uses', 'break'];

export class RailsError extends Error {
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

/** Checks a parsed rails file. Returns the errors. */
export function validateRails(rails: unknown): string[] {
  if (!topLevel(rails)) return formatErrors('', topLevel.errors);
  const errors: string[] = [];
  const ids: string[] = [];
  validateSteps((rails as { steps: unknown[] }).steps, '/steps', errors, ids);
  const onFailure = (rails as { 'on-failure'?: unknown[] })['on-failure'];
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
      // A run command holds no expression, and a loaded nested rails file was checked when it was loaded.
      if (childKey !== 'run' && childKey !== 'rails') checkExpressions(child, `${at}/${childKey}`, childKey, errors);
    }
  }
}

/** A prompt that is one word ending with .md is the path of a Markdown file; any other text is the instructions. */
export const isPromptFile = (prompt: unknown): prompt is string => typeof prompt === 'string' && /^\S+\.md$/.test(prompt.trim());

const LINK = /\]\(([^)\s]+)\)/g;

/** Relative Markdown link targets, made absolute from the folder of the prompt; a missing file is an error. */
export function resolveLinks(text: string, base: string, problems: string[] = []): string {
  // Code blocks keep their text: a link there is an example.
  return text.split(/(^```[\s\S]*?^```)/m).map((part) => (part.startsWith('```') ? part : resolvePart(part, base, problems))).join('');
}

function resolvePart(text: string, base: string, problems: string[]): string {
  return text.replace(LINK, (whole, target: string) => {
    if (/^([a-z][a-z0-9+.-]*:|\/|#|~|\$\{\{)/i.test(target)) return whole;
    const hash = target.indexOf('#');
    const file = hash < 0 ? target : target.slice(0, hash);
    const anchor = hash < 0 ? '' : target.slice(hash);
    const absolute = path.resolve(base, decodeURI(file));
    if (!fs.existsSync(absolute)) problems.push(`broken link ${target}`);
    return `](${absolute}${anchor})`;
  });
}

function linked(text: string, base: string, id: string | undefined, errors: string[]): string {
  const problems: string[] = [];
  const result = resolveLinks(text, base, problems);
  errors.push(...problems.map((problem) => `step "${id}": ${problem}`));
  return result;
}

/** Reads the prompt files and loads the nested rails files of a list of steps, recursively. */
function prepareSteps(steps: Step[], dir: string, errors: string[], loading: string[], cwd: string): void {
  for (const step of steps) {
    const withPrompt = step as Step & { prompt?: string };
    if (isPromptFile(withPrompt.prompt)) {
      const file = path.resolve(dir, withPrompt.prompt);
      try {
        withPrompt.prompt = fs.readFileSync(file, 'utf8');
      } catch (error) {
        errors.push(`step "${step.id}": cannot read ${withPrompt.prompt}: ${(error as Error).message}`);
      }
      if (withPrompt.prompt !== undefined && !isPromptFile(withPrompt.prompt)) withPrompt.prompt = linked(withPrompt.prompt, path.dirname(file), step.id, errors);
    } else if (typeof withPrompt.prompt === 'string') {
      withPrompt.prompt = linked(withPrompt.prompt, dir, step.id, errors);
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
        const file = uses.uses.startsWith('skill:') ? resolveSkillRails(uses.uses.slice('skill:'.length), dir, { cwd }) : path.resolve(dir, uses.uses);
        uses.rails = loadFile(file, loading, cwd);
      } catch (error) {
        const inner = (error as RailsError).errors ?? [(error as Error).message];
        errors.push(...inner.map((line) => `step "${uses.id}" (${uses.uses}): ${line}`));
      }
    }
  }
}

function loadFile(file: string, loading: string[], cwd: string): Rails {
  const resolved = path.resolve(file);
  if (loading.includes(resolved)) {
    throw new RailsError([`the rails files use each other: ${[...loading, resolved].map((f) => path.basename(path.dirname(f)) + '/' + path.basename(f)).join(' → ')}`]);
  }
  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new RailsError([`cannot read ${file}: ${(error as Error).message}`]);
  }
  const errors = validateRails(raw);
  if (errors.length) throw new RailsError(errors);
  const rails = raw as Omit<Rails, 'dir'>;
  const dir = path.dirname(resolved);
  prepareSteps(rails.steps, dir, errors, [...loading, resolved], cwd);
  if (rails['on-failure']) prepareSteps(rails['on-failure'], dir, errors, [...loading, resolved], cwd);
  checkExpressions(rails.steps, '/steps', undefined, errors);
  checkExpressions(rails['on-failure'], '/on-failure', undefined, errors);
  checkExpressions(rails.outputs, '/outputs', undefined, errors);
  if (errors.length) throw new RailsError(errors);
  return { ...rails, inputs: rails.inputs ?? {}, dir };
}

/** Reads, checks and prepares a rails file and its nested rails files. Throws a RailsError with all the problems. */
export function loadRails(file: string, { cwd = process.cwd() }: { cwd?: string } = {}): Rails {
  return loadFile(file, [], cwd);
}
