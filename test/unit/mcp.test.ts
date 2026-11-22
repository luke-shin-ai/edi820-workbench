/**
 * T5.4: the MCP server's protocol surface.
 *
 * Two kinds of test: in-process message handling (fast, exhaustive), and one real
 * stdio session against the server process, because "it speaks MCP" is a claim
 * about a transport, not about a function.
 */
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MCP_TOOLS, handleMessage, type JsonRpcResponse } from '../../src/mcp/server.js';
import { runCli } from '../../src/cli/index.js';

const serverEntry = join(import.meta.dirname, '..', '..', 'src', 'mcp', 'main.ts');
const tsxBin = join(import.meta.dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

const COB820 = 'samples/copybooks/820.cpy';
const COB823 = 'samples/copybooks/823.cpy';
const GOOD = 'samples/data/820-good.txt';
const BAD = 'samples/data/820-bad.txt';

const rpc = (method: string, params?: Record<string, unknown>, id: number | string = 1) =>
  handleMessage({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

describe('T5.4 - exactly five tools (T5.1-T5.2, T7.1), each with a JSON schema', () => {
  it('lists parse_file, reconcile, explain_findings, verify, and exceptions', async () => {
    const response = (await rpc('tools/list')) as JsonRpcResponse;
    const result = response.result as { tools: Array<{ name: string; description: string; inputSchema: { type: string; properties: Record<string, unknown> } }> };
    expect(result.tools.map((t) => t.name).sort()).toEqual(['exceptions', 'explain_findings', 'parse_file', 'reconcile', 'verify']);
    for (const tool of result.tools) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema.type).toBe('object');
      expect(Object.keys(tool.inputSchema.properties).length).toBeGreaterThan(0);
    }
    expect(MCP_TOOLS).toHaveLength(5);
  });

  it('initialises with a supported protocol version and tool capability', async () => {
    const response = (await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })) as JsonRpcResponse;
    const result = response.result as { protocolVersion: string; capabilities: { tools: unknown }; serverInfo: { name: string } };
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe('edi820-workbench');
    // an unknown version is answered with ours rather than refused
    const other = (await rpc('initialize', { protocolVersion: '1999-01-01' })) as JsonRpcResponse;
    expect((other.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
  });

  it('answers notifications with nothing and unknown methods with -32601', async () => {
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    const unknown = (await rpc('tools/delete_everything')) as JsonRpcResponse;
    expect(unknown.error?.code).toBe(-32601);
    expect(await handleMessage({ jsonrpc: '2.0', id: 3, method: 42 } as never)).toMatchObject({ error: { code: -32600 } });
  });
});

describe('T5.4 - tool calls return the same JSON as the CLI', () => {
  it('parse_file reports record counts and issues without a verdict', async () => {
    const response = (await rpc('tools/call', { name: 'parse_file', arguments: { filePath: BAD, copybookPath: COB820 } })) as JsonRpcResponse;
    const content = (response.result as { content: Array<{ text: string }>; isError: boolean });
    expect(content.isError).toBe(false);
    const payload = JSON.parse(content.content[0]!.text) as { files: { payment: { records: number; issues: Array<{ code: string }> } }; verdict?: unknown };
    expect(payload.files.payment.records).toBe(11);
    expect(payload.files.payment.issues[0]?.code).toBe('RECORD_LENGTH_MISMATCH');
    expect(payload.verdict).toBeUndefined();
  });

  it('reconcile returns the verdict and the fingerprint', async () => {
    const response = (await rpc('tools/call', {
      name: 'reconcile',
      arguments: {
        filePath: BAD,
        copybookPath: COB820,
        bankFilePath: 'samples/data/823-bank.txt',
        bankCopybookPath: COB823,
        settlementWindow: { start: '2026-11-18', end: '2026-11-20' },
      },
    })) as JsonRpcResponse;
    const payload = JSON.parse((response.result as { content: Array<{ text: string }> }).content[0]!.text) as {
      verdict: { status: string; fingerprint: string; findings: Array<{ code: string }> };
    };
    expect(payload.verdict.status).toBe('FAIL');
    expect(payload.verdict.findings).toHaveLength(4);
    expect(payload.verdict.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a call error is reported as isError, not as a transport error', async () => {
    const response = (await rpc('tools/call', { name: 'reconcile', arguments: { filePath: 'samples/data/nope.txt', copybookPath: COB820 } })) as JsonRpcResponse;
    const result = response.result as { isError: boolean; content: Array<{ text: string }> };
    expect(response.error).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('IO');
  });

  it('explain_findings and verify work off a report written by the CLI', async () => {
    const out = mkdtempSync(join(tmpdir(), '820-mcp-'));
    const code = await runCli(
      ['reconcile', '--copybook', COB820, '--file', BAD, '--bank', 'samples/data/823-bank.txt', '--bank-copybook', COB823, '--window', '2026-11-18..2026-11-20', '--out', out],
      { out: () => {}, err: () => {} },
    );
    expect(code).toBe(2);

    const explainResponse = (await rpc('tools/call', { name: 'explain_findings', arguments: { reportPath: out } })) as JsonRpcResponse;
    const explained = JSON.parse((explainResponse.result as { content: Array<{ text: string }> }).content[0]!.text) as {
      liveCalls: number;
      explanations: Array<{ status: string; citedValues: string[] }>;
    };
    expect(explained.liveCalls).toBe(0);
    expect(explained.explanations).toHaveLength(4);
    expect(explained.explanations.every((e) => e.status === 'EXPLAINED')).toBe(true);

    const verifyResponse = (await rpc('tools/call', { name: 'verify', arguments: { reportPath: out } })) as JsonRpcResponse;
    const verified = JSON.parse((verifyResponse.result as { content: Array<{ text: string }> }).content[0]!.text) as {
      ok: boolean;
      firstDifference: string | null;
      mutation: { reportBytesBefore: number; reportBytesAfter: number };
    };
    expect(verified.ok).toBe(true);
    expect(verified.firstDifference).toBeNull();
    expect(verified.mutation.reportBytesAfter).toBe(verified.mutation.reportBytesBefore);
    rmSync(out, { recursive: true, force: true });
  });
});

describe('T5.4 - a real stdio session', () => {
  it('answers four ordered requests and shuts down cleanly on EOF', async () => {
    const child = spawn(process.execPath, [tsxBin, serverEntry], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines: string[] = [];
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => lines.push(...chunk.split('\n').filter(Boolean)));

    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vitest', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'parse_file', arguments: { filePath: GOOD, copybookPath: COB820 } } },
    ];
    child.stdin.write(`${messages.map((m) => JSON.stringify(m)).join('\n')}\n`);
    child.stdin.end();

    const exitCode = await new Promise<number | null>((resolvePromise) => child.on('close', (code) => resolvePromise(code)));
    expect(exitCode).toBe(0);
    const responses = lines.map((line) => JSON.parse(line) as JsonRpcResponse);
    expect(responses.map((r) => r.id)).toEqual([1, 2, 3]);
    expect((responses[0]!.result as { serverInfo: { name: string } }).serverInfo.name).toBe('edi820-workbench');
    expect((responses[1]!.result as { tools: unknown[] }).tools).toHaveLength(5);
    expect(JSON.parse((responses[2]!.result as { content: Array<{ text: string }> }).content[0]!.text).files.payment.records).toBe(11);
  });

  it('reports a malformed line as -32700 and keeps serving', async () => {
    const child = spawn(process.execPath, [tsxBin, serverEntry], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines: string[] = [];
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => lines.push(...chunk.split('\n').filter(Boolean)));
    child.stdin.write('this is not json\n');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' })}\n`);
    child.stdin.end();
    await new Promise<void>((resolvePromise) => child.on('close', () => resolvePromise()));
    const responses = lines.map((line) => JSON.parse(line) as JsonRpcResponse);
    expect(responses[0]?.error?.code).toBe(-32700);
    expect(responses[1]).toMatchObject({ id: 7, result: {} });
  });
});
