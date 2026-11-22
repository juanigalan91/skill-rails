// The MCP server: the same commands as the CLI, as tools. The working directory of the server is the project.
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { check, done, reset, start, status } from './api.js';
import type { Report } from './types.js';
import { VERSION } from './version.js';

const reply = (result: Report) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  isError: result.status === 'error',
});

const LOOP =
  'Act on the status of the result: step → do the step, then call rails_done; invalid → correct the output and call rails_done again; done or failed → tell the user the message.';

export function createServer({ cwd = process.cwd() }: { cwd?: string } = {}): McpServer {
  const server = new McpServer({ name: 'skill-rails', version: VERSION });

  server.registerTool(
    'rails_start',
    {
      description: `Start a skill-rails run: check the rails file, reset the state of the run, and get the first step to do. ${LOOP}`,
      inputSchema: {
        file: z.string().describe('Path of the rails.yaml file.'),
        inputs: z.record(z.string(), z.union([z.string(), z.boolean(), z.number(), z.array(z.string())])).optional().describe('The inputs of the rails file.'),
      },
    },
    async ({ file, inputs }) => reply(start({ file: path.resolve(cwd, file), inputs, cwd })),
  );

  server.registerTool(
    'rails_done',
    {
      description: `Report the output of the current step of a run, and get the next step. Give fail instead of output when you cannot do the step. ${LOOP}`,
      inputSchema: {
        rails: z.string().describe('The rails name: the name in the rails file.'),
        step: z.string().describe('The id of the current step.'),
        output: z.record(z.string(), z.unknown()).optional().describe('The output, matching the output schema of the step.'),
        fail: z.string().optional().describe('The reason why the step cannot be done. It ends the run.'),
      },
    },
    async ({ rails, step, output, fail }) => reply(done({ rails, id: step, output, fail, cwd })),
  );

  server.registerTool(
    'rails_status',
    { description: 'Get the current step of a run again, with the results of the steps so far.', inputSchema: { rails: z.string() } },
    async ({ rails }) => reply(status({ rails, cwd })),
  );

  server.registerTool(
    'rails_reset',
    { description: 'Delete the state of a run.', inputSchema: { rails: z.string() } },
    async ({ rails }) => reply(reset({ rails, cwd })),
  );

  server.registerTool(
    'rails_check',
    { description: 'Check a rails file without running it.', inputSchema: { file: z.string() } },
    async ({ file }) => reply(check({ file: path.resolve(cwd, file), cwd })),
  );

  return server;
}

export async function serve(cwd = process.cwd()): Promise<void> {
  await createServer({ cwd }).connect(new StdioServerTransport());
}
