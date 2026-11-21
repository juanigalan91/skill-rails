import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/mcp.js';
import { tempDir } from './helpers.js';

describe('the MCP server', () => {
  it('runs a flow with flow_start and flow_done', async () => {
    const dir = tempDir({
      'rails.yaml': "name: mcp\nsteps:\n  - id: a\n    prompt: Say hi.\n    output: { type: object, required: [text], properties: { text: { type: string } } }\n  - stop: '${{ steps.a.outputs.text }}'\n",
    });
    process.env.SKILL_RAILS_STATE_DIR = path.join(dir, 'state');
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
    expect(await call('flow_check', { file: 'rails.yaml' })).toMatchObject({ status: 'ok' });
    expect(await call('flow_start', { file: 'rails.yaml' })).toMatchObject({ status: 'step', id: 'a', cwd: dir });
    expect(await call('flow_done', { flow: 'mcp', step: 'a', output: { text: 'hi' } })).toMatchObject({ status: 'done', message: 'hi' });
    await client.close();
  });

  it('serves a real stdio client in an explicit project, with schema recovery', async () => {
    const dir = tempDir({ 'rails.yaml': "name: portable\nsteps:\n  - id: answer\n    prompt: Say hi\n    output: { type: object, required: [text], properties: { text: { type: string } } }\n  - stop: '${{ steps.answer.outputs.text }}'\n" });
    const bin = fileURLToPath(new URL('../bin/skill-rails.js', import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bin, 'mcp', '--cwd', dir],
      env: { ...process.env, SKILL_RAILS_STATE_DIR: path.join(dir, 'state') } as Record<string, string>,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'portable-test', version: '0' });
    try {
      await client.connect(transport);
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args }) as { content: Array<{ text: string }> };
        return JSON.parse(result.content[0]?.text ?? '{}');
      };
      expect(await call('flow_start', { file: 'rails.yaml' })).toMatchObject({ status: 'step', cwd: dir, id: 'answer' });
      expect(await call('flow_done', { flow: 'portable', step: 'answer', output: { text: 1 } })).toMatchObject({ status: 'invalid' });
      expect(await call('flow_status', { flow: 'portable' })).toMatchObject({ status: 'step', id: 'answer', cwd: dir });
      expect(await call('flow_done', { flow: 'portable', step: 'answer', output: { text: 'hi' } })).toMatchObject({ status: 'done', message: 'hi', cwd: dir });
    } finally {
      await client.close();
    }
  });
});
