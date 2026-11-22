// ${{ }} expressions, evaluated by @actions/expressions, so they behave as in GitHub Actions.
import { Evaluator, Lexer, Parser, data } from '@actions/expressions';
import type { FunctionDefinition } from '@actions/expressions/funcs/info';
import type { Condition, Context } from './types.js';

export const CONTEXTS = ['inputs', 'steps', 'env', 'flow', 'item', 'loop', 'failure'];
export const EXPRESSION = /\$\{\{([\s\S]*?)\}\}/g;
const WHOLE = /^\s*\$\{\{([\s\S]*?)\}\}\s*$/;

export const text = (value: unknown): string =>
  value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

const plain = (value: data.ExpressionData): unknown => JSON.parse(JSON.stringify(value, data.replacer) ?? 'null');
const expression = (value: unknown): data.ExpressionData => JSON.parse(JSON.stringify(value ?? null), data.reviver) as data.ExpressionData;
const at = (value: unknown, path: string): unknown =>
  path.split('.').filter(Boolean).reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined), value);
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Functions beyond the GitHub Actions ones. */
const EXTRA: Record<string, { minArgs: number; maxArgs: number; call: (...args: unknown[]) => unknown }> = {
  // The number of items of a list, of keys of an object, or of characters of a text.
  length: { minArgs: 1, maxArgs: 1, call: (value) => (typeof value === 'string' ? value.length : Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0) },
  split: { minArgs: 1, maxArgs: 2, call: (value, separator = '\n') => String(value ?? '').split(String(separator)).map((item) => item.trim()).filter(Boolean) },
  // A list literal: list('a', 'b').
  list: { minArgs: 0, maxArgs: 100, call: (...items) => items },
  // The items whose value at a path equals the given value, or is truthy with no value.
  where: { minArgs: 2, maxArgs: 3, call: (...args) => listOf(args[0]).filter((item) => (args.length > 2 ? at(item, String(args[1])) === args[2] : Boolean(at(item, String(args[1]))))) },
};
const FUNCTIONS = new Map<string, FunctionDefinition>(
  Object.entries(EXTRA).map(([name, f]) => [name, { name, minArgs: f.minArgs, maxArgs: f.maxArgs, call: (...args: data.ExpressionData[]) => expression(f.call(...args.map(plain))) }]),
);
const INFO = [...FUNCTIONS.values()].map(({ name, minArgs, maxArgs }) => ({ name, minArgs, maxArgs }));

export const parse = (source: string) => new Parser(new Lexer(source).lex().tokens, CONTEXTS, INFO).parse();

export function evaluate(source: string, context: Context): unknown {
  const dictionary = JSON.parse(JSON.stringify(context), data.reviver) as data.Dictionary;
  const result = new Evaluator(parse(source), dictionary, FUNCTIONS).evaluate();
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
