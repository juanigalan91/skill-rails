// The types of a rails.ts: tsc -p tsconfig.test.json checks this file.
import { defineRails } from '../../src/define.js';

defineRails({
  name: 'types',
  inputs: { count: { type: 'number' }, items: { type: 'list' } },
  run({ inputs, prompt, ask }) {
    const count: number = inputs.count;
    const items: string[] = inputs.items;
    const out = prompt('a', 'Do it.', { output: { kind: 'fix | skip', files: ['string'], 'note?': 'string', size: 'integer?' } });
    const kind: 'fix' | 'skip' = out.kind;
    const files: string[] = out.files;
    const note: string | undefined = out.note;
    const size: number | undefined = out.size;
    // @ts-expect-error: kind is fix or skip
    const wrong: 'other' = out.kind;
    // @ts-expect-error: the output has no such key
    void out.missing;
    const many: Array<'x' | 'y'> = ask('b', { question: 'Which?', multiSelect: true, options: ['x', 'y'] });
    const go: boolean = ask('c', { question: 'Go?', options: [{ label: 'Yes', description: '', value: true }, { label: 'No', description: '', value: false }] });
    const both = ask('d', { push: { question: 'Push?', options: ['Yes', 'No'] }, note: inputs.count > 1 && { question: 'Note?', free: true } });
    const push: 'Yes' | 'No' = both.push;
    const typed: string | undefined = both.note;
    const full = prompt('e', 'Do it.', { output: { title: { type: 'string', maxLength: 70 }, list: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' } } } } } });
    const title: string = full.title;
    const first: string = full.list[0]!.value;
    void [count, items, kind, files, note, size, wrong, many, go, push, typed, title, first];
  },
});
