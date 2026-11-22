import fs from 'node:fs';
import yml from 'eslint-plugin-yml';
import jsonSchemaValidator from 'eslint-plugin-json-schema-validator';

const schema = JSON.parse(fs.readFileSync(new URL('./schema/flow.schema.json', import.meta.url), 'utf8'));

export default [
  { ignores: ['node_modules/**', 'dist/**', '.yarn/**', 'coverage/**'] },
  ...yml.configs.recommended,
  {
    files: ['**/rails.{yaml,yml}', 'skills/**/*.{yaml,yml}', 'examples/**/*.{yaml,yml}', 'test/scenarios/skills/**/*.{yaml,yml}'],
    ignores: ['**/*.test.{yaml,yml}', '**/tests/**'],
    plugins: { 'json-schema-validator': jsonSchemaValidator },
    rules: {
      'json-schema-validator/no-invalid': ['error', {
        schemas: [{ fileMatch: ['**/*.yaml', '**/*.yml'], schema }],
        useSchemastoreCatalog: false,
        mostSpecificErrorsOnly: true,
      }],
    },
  },
];
