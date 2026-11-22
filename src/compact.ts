import type { JsonObject } from './types.js';

const TYPES = new Set(['string', 'boolean', 'number', 'integer', 'object', 'array', 'any']);
const KEYWORDS = new Set([
  'type', 'properties', 'required', 'items', 'additionalProperties', 'enum', 'const', 'description', 'default', 'title', 'format', 'pattern',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'minimum', 'maximum', 'minProperties', 'maxProperties', 'propertyNames', 'examples', '$comment',
  'not', 'if', 'then', 'else', 'patternProperties', 'dependentRequired', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'contains',
]);

/** A full JSON schema: a $ref or a combinator, or only schema keywords with a type, properties, enum or const. A field named `type` alone needs the full form. */
const isSchema = (value: object): boolean => {
  const keys = Object.keys(value);
  if (keys.some((key) => ['$schema', '$ref', 'oneOf', 'anyOf', 'allOf'].includes(key))) return true;
  return keys.every((key) => KEYWORDS.has(key)) && keys.some((key) => ['type', 'properties', 'enum', 'const'].includes(key));
};

/** One value of the short form: a type name, `a | b` choices, a list with one item type, a map, or a full schema. */
function expand(value: unknown, where: string): { schema: JsonObject; optional: boolean } {
  if (typeof value === 'string') {
    const optional = value.trim().endsWith('?');
    const name = value.trim().replace(/\?$/, '').trim();
    if (name.includes('|')) return { schema: { enum: name.split('|').map((choice) => choice.trim()) }, optional };
    if (!TYPES.has(name)) throw new Error(`${where}: unknown type "${name}" (use string, boolean, number, integer, object, array, any, or a | b)`);
    if (name === 'any') return { schema: {}, optional };
    // A required string must not be empty.
    if (name === 'string' && !optional) return { schema: { type: 'string', minLength: 1 }, optional };
    return { schema: { type: name }, optional };
  }
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error(`${where}: a list gives one item type, for example [string]`);
    return { schema: { type: 'array', items: expand(value[0], `${where}[]`).schema }, optional: false };
  }
  if (value && typeof value === 'object') {
    if (isSchema(value)) return { schema: value as JsonObject, optional: false };
    return { schema: objectSchema(value as Record<string, unknown>, where), optional: false };
  }
  throw new Error(`${where}: write a type name, a list or a map`);
}

function objectSchema(fields: Record<string, unknown>, where: string): JsonObject {
  const properties: JsonObject = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    // A key that ends with ? is optional too: `file?: string`.
    const name = key.endsWith('?') ? key.slice(0, -1) : key;
    const typed = key.endsWith('?') && typeof value === 'string' && !value.trim().endsWith('?') ? `${value}?` : value;
    const { schema, optional } = expand(typed, where ? `${where}.${name}` : name);
    properties[name] = schema;
    if (!optional && !key.endsWith('?')) required.push(name);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

/** The JSON schema of a step output: a full schema stays as it is; the short form becomes a schema. */
export function outputSchema(output: unknown): JsonObject | undefined {
  if (output === undefined || output === null) return undefined;
  if (typeof output !== 'object' || Array.isArray(output) || isSchema(output)) return output as JsonObject;
  return objectSchema(output as Record<string, unknown>, '');
}
