import fs from 'node:fs';
import { Ajv, type ErrorObject } from 'ajv';
import type { JsonObject } from './types.js';

export const schema = JSON.parse(fs.readFileSync(new URL('../schema/rails.schema.json', import.meta.url), 'utf8')) as JsonObject & {
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

// strictSchema refuses unknown keywords: a YAML flow map with a comma in a description splits it into stray keys.
const strict = new Ajv({ allErrors: true, strict: false, strictSchema: true });

/** The problems of an output schema, found before the run. */
export function checkOutputSchema(outputSchema: JsonObject): string[] {
  try {
    strict.compile(outputSchema);
    return [];
  } catch (error) {
    return [(error as Error).message.replace(/^strict mode: /, '')];
  }
}

/** Validates a step output against the JSON Schema of the step. Returns the errors. */
export function validateOutput(outputSchema: JsonObject, value: unknown): string[] {
  const check = ajv.compile(outputSchema);
  return check(value) ? [] : formatErrors('output', check.errors);
}
