import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export function output(key, value) {
  const delimiter = randomUUID();
  appendFileSync(process.env.RAILS_OUTPUT, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
}
