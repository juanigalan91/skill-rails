// The version of this package, for the MCP server and the commands that the CLI suggests.
import fs from 'node:fs';

export const VERSION: string = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
/** The major.minor range that the suggested npx commands use. */
export const RANGE = VERSION.split('.').slice(0, 2).join('.');
