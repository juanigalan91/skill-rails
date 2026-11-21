import fs from 'node:fs';
import { Ajv, type ErrorObject } from 'ajv';
import type { JsonObject } from './types.js';

export const schema = JSON.parse(fs.readFileSync(new URL('../schema/flow.schema.json', import.meta.url), 'utf8')) as JsonObject & {
  $id: string;
  properties: JsonObject;
};

export const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addSchema(schema);

export const formatErrors = (prefix: string, errors: ErrorObject[] | null | undefined): string[] =>
  (errors ?? []).map((error) => {
    const extra = error.keyword === 'additionalProperties' ? ` ("${String(error.params.additionalProperty)}")` : '';
    return `${prefix}${error.instancePath} ${error.message ?? 'is not valid'}${extra}`.trim();
  });

/** Validates a step output against the JSON Schema of the step. Returns the errors. */
export function validateOutput(outputSchema: JsonObject, value: unknown): string[] {
  const check = ajv.compile(outputSchema);
  return check(value) ? [] : formatErrors('output', check.errors);
}
