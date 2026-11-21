import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/mcp.js';
import { tempDir } from './helpers.js';

describe('the MCP server', () => {
  it('runs a flow with flow_start and flow_done', async () => {
    const dir = tempDir({
      'flow.yaml': "name: mcp\nsteps:\n  - id: a\n    prompt: Say hi.\n    output: { type: object, required: [text], properties: { text: { type: string } } }\n  - stop: '${{ steps.a.outputs.text }}'\n",
    });
    process.env.SKILLFLOW_STATE_DIR = path.join(dir, 'state');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer({ cwd: dir }).connect(serverTransport);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientTransport);

    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toEqual(expect.arrayContaining(['flow_start', 'flow_done', 'flow_status', 'flow_reset', 'flow_check']));

    const call = async (name: string, args: Record<string, unknown>) => {
      const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
      return JSON.parse(result.content[0]?.text ?? '{}');
    };
    expect(await call('flow_start', { file: path.join(dir, 'flow.yaml') })).toMatchObject({ status: 'step', id: 'a' });
    expect(await call('flow_done', { flow: 'mcp', step: 'a', output: { text: 'hi' } })).toMatchObject({ status: 'done', message: 'hi' });
    await client.close();
  });
});
