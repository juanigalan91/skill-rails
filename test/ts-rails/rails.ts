import { defineRails } from '../../src/define.js';

export default defineRails({
  name: 'typed',
  inputs: { target: { type: 'string', default: 'main' }, dry: { type: 'boolean', default: false } },
  run({ inputs, sh, prompt, ask, note }) {
    const branch = sh`printf '%s' ${inputs.target}`;
    const decision = prompt('decide', 'prompts/decide.md', { with: { branch }, output: { kind: 'fix | skip', note: 'string' } });
    if (decision.kind === 'skip') return `skipped ${branch}`;
    const files = [1, 2].map((n) => prompt(`fix-${n}`, `Fix part ${n} of ${branch}.`, { output: { file: 'string' } }).file);
    note(`fixed ${files.join(', ')}`);
    const push = ask('push', { question: 'Push the branch?', options: ['Yes', 'No'] });
    if (inputs.dry || push === 'No') return { message: 'not pushed', outputs: { files } };
    return { message: `pushed ${branch}`, outputs: { files } };
  },
});
