// The MCP server: the same commands as the CLI, as tools. The working directory of the server is the project.
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { check, done, reset, start, status } from './api.js';
import type { Report } from './types.js';

const reply = (result: Report) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  isError: result.status === 'error',
});

const LOOP =
  'Act on the status of the result: step → do the step, then call flow_done; invalid → correct the output and call flow_done again; done or failed → tell the user the message.';

export function createServer({ cwd = process.cwd() }: { cwd?: string } = {}): McpServer {
  const server = new McpServer({ name: 'skill-rails', version: '0.2.1' });

  server.registerTool(
    'flow_start',
    {
      description: `Start a skill-rails flow: check the flow file, reset its state, and get the first step to do. ${LOOP}`,
      inputSchema: {
        file: z.string().describe('Path of the flow YAML file.'),
        inputs: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).optional().describe('The flow inputs.'),
      },
    },
    async ({ file, inputs }) => reply(start({ file: path.resolve(cwd, file), inputs, cwd })),
  );

  server.registerTool(
    'flow_done',
    {
      description: `Report the output of the current step of a flow, and get the next step. Give fail instead of output when you cannot do the step. ${LOOP}`,
      inputSchema: {
        flow: z.string().describe('The flow name.'),
        step: z.string().describe('The id of the current step.'),
        output: z.record(z.string(), z.unknown()).optional().describe('The output, matching the output schema of the step.'),
        fail: z.string().optional().describe('The reason why the step cannot be done. It ends the flow.'),
      },
    },
    async ({ flow, step, output, fail }) => reply(done({ flow, id: step, output, fail, cwd })),
  );

  server.registerTool(
    'flow_status',
    { description: 'Get the current step of a flow again, with the results of the steps so far.', inputSchema: { flow: z.string() } },
    async ({ flow }) => reply(status({ flow, cwd })),
  );

  server.registerTool(
    'flow_reset',
    { description: 'Delete the state of a flow.', inputSchema: { flow: z.string() } },
    async ({ flow }) => reply(reset({ flow, cwd })),
  );

  server.registerTool(
    'flow_check',
    { description: 'Check a flow file without running it.', inputSchema: { file: z.string() } },
    async ({ file }) => reply(check({ file: path.resolve(cwd, file) })),
  );

  return server;
}

export async function serve(cwd = process.cwd()): Promise<void> {
  await createServer({ cwd }).connect(new StdioServerTransport());
}
