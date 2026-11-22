import { describe, expect, it } from 'vitest';
import { condition, render, sourcesOf } from '../src/expressions.js';
import type { Context } from '../src/types.js';

const context: Context = {
  inputs: { auto: false, who: 'team' },
  steps: { list: { outcome: 'success', outputs: { items: ['a', 'b'], empty: [] } }, skipped: { outcome: 'skipped' } },
  env: {},
  rails: { name: 'test', dir: '/tmp' },
  item: null,
  failure: null,
  loop: null,
};

describe('render', () => {
  it('keeps the type of a value that is one expression', () => {
    expect(render('${{ steps.list.outputs.items }}', context)).toEqual(['a', 'b']);
    expect(render('${{ !inputs.auto }}', context)).toBe(true);
  });

  it('makes a string of a text with expressions', () => {
    expect(render('Hello ${{ inputs.who }}, ${{ join(steps.list.outputs.items, \'+\') }}', context)).toBe('Hello team, a+b');
  });

  it('gives null for the outputs of a step that did not run', () => {
    expect(render('${{ steps.skipped.outputs.x }}', context)).toBeNull();
  });

  it('renders the strings inside lists and maps', () => {
    expect(render({ a: ['${{ inputs.who }}'] }, context)).toEqual({ a: ['team'] });
  });

  it('compares strings with no case, as GitHub Actions does', () => {
    expect(render("${{ inputs.who == 'TEAM' }}", context)).toBe(true);
  });
});

describe('condition', () => {
  it('is true when there is no condition', () => {
    expect(condition(undefined, context)).toBe(true);
  });

  it('accepts a bare expression', () => {
    expect(condition('steps.list.outputs.items[0]', context)).toBe(true);
    expect(condition('steps.list.outputs.empty[0]', context)).toBe(false);
  });

  it('accepts a boolean', () => {
    expect(condition(false, context)).toBe(false);
  });
});

describe('sourcesOf', () => {
  it('finds the expressions of a text', () => {
    expect(sourcesOf('a ${{ x }} b ${{ y }}')).toEqual([' x ', ' y ']);
  });

  it('reads a bare if as one expression', () => {
    expect(sourcesOf('inputs.auto', 'if')).toEqual(['inputs.auto']);
  });
});
