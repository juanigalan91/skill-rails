// Design advice for a YAML rails file, from what the benchmarks show: each agent step costs a model turn.
import { kindOf } from './rails.js';
import type { ForeachStep, PromptStep, Rails, RepeatStep, Step, UsesStep } from './types.js';

const AGENT_KINDS = new Set(['prompt', 'skill', 'ask']);
const SHELL_FENCE = /^```(?:bash|sh|shell|zsh)\s*$/m;
const FEW_WORDS = 40;

/** The kinds of the steps, in nested lists and in the rails files that the uses steps run. */
function kinds(steps: Step[]): string[] {
  return steps.flatMap((step) => {
    const kind = kindOf(step) ?? '';
    if (kind === 'foreach' || kind === 'repeat') return [kind, ...kinds((step as ForeachStep | RepeatStep).steps)];
    if (kind === 'uses') return [kind, ...kinds((step as UsesStep).rails?.steps ?? [])];
    return [kind];
  });
}

/** The words of a text outside its code blocks. */
const prose = (text: string): number => text.replace(/^```[\s\S]*?^```/gm, '').split(/\s+/).filter(Boolean).length;

function listAdvice(steps: Step[], warnings: string[]): void {
  steps.forEach((step, index) => {
    const kind = kindOf(step);
    if (kind === 'foreach' || kind === 'repeat') listAdvice((step as ForeachStep | RepeatStep).steps, warnings);
    if (kind !== 'prompt') return;
    const prompt = (step as PromptStep).prompt ?? '';
    if (SHELL_FENCE.test(prompt) && prose(prompt) < FEW_WORDS) {
      warnings.push(`step "${step.id}": the instructions are mostly a shell command. A run step runs it with no model turn.`);
    }
    const next = steps[index + 1];
    if (next && kindOf(next) === 'prompt' && next.if === undefined) {
      warnings.push(`steps "${step.id}" and "${next.id}": two prompt steps with no condition between them cost two model turns. Merge them, unless the second step needs the checked output of the first.`);
    }
  });
}

/** Warnings on the design of a YAML rails file. A TypeScript rails file gets none: its steps are code. */
export function advice(rails: Rails): string[] {
  if (rails.code) return [];
  const all = kinds(rails.steps);
  const warnings: string[] = [];
  if (!all.some((kind) => AGENT_KINDS.has(kind)) && all.filter((kind) => kind === 'run').length <= 1) {
    warnings.push('The rails file has no agent step and at most one run step. A SKILL.md that runs the script costs less, unless other rails files use this one, or you want its tests.');
  }
  listAdvice(rails.steps, warnings);
  return warnings;
}
