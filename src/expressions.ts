// ${{ }} expressions, evaluated by @actions/expressions, so they behave as in GitHub Actions.
import { Evaluator, Lexer, Parser, data } from '@actions/expressions';
import type { Condition, Context } from './types.js';

export const CONTEXTS = ['inputs', 'steps', 'env', 'flow', 'item', 'loop'];
export const EXPRESSION = /\$\{\{([\s\S]*?)\}\}/g;
const WHOLE = /^\s*\$\{\{([\s\S]*?)\}\}\s*$/;

export const text = (value: unknown): string =>
  value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

export const parse = (source: string) => new Parser(new Lexer(source).lex().tokens, CONTEXTS, []).parse();

export function evaluate(source: string, context: Context): unknown {
  const dictionary = JSON.parse(JSON.stringify(context), data.reviver) as data.Dictionary;
  const result = new Evaluator(parse(source), dictionary).evaluate();
  return JSON.parse(JSON.stringify(result, data.replacer));
}

/** Replaces the ${{ }} expressions. A value that is one expression keeps the type of its result. */
export function render(value: unknown, context: Context): unknown {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE);
    if (whole?.[1] !== undefined && !whole[1].includes('${{')) return evaluate(whole[1], context);
    return value.replace(EXPRESSION, (_, source: string) => text(evaluate(source, context)));
  }
  if (Array.isArray(value)) return value.map((item) => render(item, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, render(item, context)]));
  }
  return value;
}

/** An `if:` value: a ${{ }} string, a bare expression, or a boolean. */
export function condition(value: Condition | undefined, context: Context): boolean {
  if (value === undefined) return true;
  if (typeof value === 'string' && !value.includes('${{')) return Boolean(evaluate(value, context));
  return Boolean(render(value, context));
}

/** The expression sources in a value. A bare `if:` value is one expression. */
export function sourcesOf(value: unknown, key?: string): string[] {
  if (typeof value !== 'string') return [];
  if (key === 'if' && !value.includes('${{')) return [value];
  return [...value.matchAll(EXPRESSION)].map((match) => match[1] ?? '');
}
