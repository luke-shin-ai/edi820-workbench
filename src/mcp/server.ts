/**
 * T5.4 — MCP server over stdio.
 *
 * Four tools, and each one returns exactly the JSON the CLI writes, because both
 * call `src/core/ops.ts`. Nothing here re-implements a rule: the point of
 * exposing the deterministic core over MCP is that another agent gets the *same*
 * verdict, not a similar one.
 *
 * Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout (the MCP stdio
 * transport). Every message is answered in order; notifications get no reply.
 *
 * `@modelcontextprotocol/sdk` is listed in `.kiro/steering/tech.md` as the
 * intended package. It is not installed in this environment (the build runs with
 * no network at install time), so the protocol is implemented directly against
 * the published message shapes and exercised end-to-end in `test/unit/mcp.test.ts`.
 * `design.md` §10.6 records that deviation.
 */
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AppError, buildReport, explainReport, loadReport, reviveFindings, verifyReport, type CaseInputs } from '../core/ops.js';
import { adapterByName } from '../explain/index.js';
import { classify, emptyLedger, parseLedger } from '../exception/index.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const COPYBOOK = { type: 'string', description: 'Path to the COBOL copybook (omit for BAI2).' };

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'parse_file',
    title: 'Parse a payment file',
    description:
      'Types every record of a fixed-width EDI 820/823 file with its copybook, or of a BAI2 file with the BAI2 reader. Returns typed-record counts, coded parse issues, file hashes and a fingerprint. Never decides a verdict.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the data file.' },
        copybookPath: COPYBOOK,
        format: { type: 'string', enum: ['fixed', 'bai2'], description: 'Default fixed.' },
        bankFilePath: { type: 'string', description: 'Optional second file (bank side) to parse in the same report.' },
        bankCopybookPath: { type: 'string' },
        bankFormat: { type: 'string', enum: ['fixed', 'bai2'] },
        outDir: { type: 'string', description: 'Directory to write report.json into (optional).' },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
  },
  {
    name: 'reconcile',
    title: 'Reconcile a payment file against its bank side',
    description:
      'Compares control totals, record counts, references and value dates, and returns PASS/FAIL with coded findings carrying declared/computed/delta amounts and a SHA-256 fingerprint. Deterministic: same inputs, same verdict.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        copybookPath: COPYBOOK,
        format: { type: 'string', enum: ['fixed', 'bai2'] },
        bankFilePath: { type: 'string' },
        bankCopybookPath: { type: 'string' },
        bankFormat: { type: 'string', enum: ['fixed', 'bai2'] },
        settlementWindow: {
          type: 'object',
          properties: { start: { type: 'string' }, end: { type: 'string' } },
          required: ['start', 'end'],
          description: 'Inclusive ISO dates, e.g. 2026-11-18..2026-11-20.',
        },
        toleranceDays: { type: 'integer', minimum: 0, description: 'Days of slack on each side of the window (default 0).' },
        outDir: { type: 'string' },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
  },
  {
    name: 'explain_findings',
    title: 'Explain the findings of a report',
    description:
      'Explains each finding in plain language, citing only numbers present in that finding. A draft that cites anything else is replaced with INSUFFICIENT_EVIDENCE. Default adapter is deterministic and off-network; live adapters must be named and budgeted.',
    inputSchema: {
      type: 'object',
      properties: {
        reportPath: { type: 'string', description: 'Directory holding report.json, or the file itself.' },
        adapter: { type: 'string', enum: ['mock', 'kiro-cli', 'openai'] },
        maxLiveCalls: { type: 'integer', minimum: 0, description: 'Maximum live model calls (default 0).' },
      },
      required: ['reportPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'verify',
    title: 'Re-derive a report and compare fingerprints',
    description:
      'Read-only: re-runs the deterministic layers from the inputs recorded in report.json and compares the result. Returns both fingerprints, the first differing field path, and proof that no file was modified.',
    inputSchema: {
      type: 'object',
      properties: { reportPath: { type: 'string', description: 'Directory holding report.json, or the file itself.' } },
      required: ['reportPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'exceptions',
    title: 'Classify findings against an exception ledger',
    description:
      'Read-only: reads or creates an exception ledger and classifies each finding as OPEN, WAIVED, EXPIRED, or RELEASED. Same classification object as the CLI.',
    inputSchema: {
      type: 'object',
      properties: {
        reportPath: { type: 'string', description: 'Directory holding report.json, or the file itself.' },
        ledgerPath: { type: 'string', description: 'Path to ledger.json (optional; defaults to <report dir>/ledger.json).' },
        today: { type: 'string', description: 'Classification date in YYYY-MM-DD format (optional; defaults to today).' },
      },
      required: ['reportPath'],
      additionalProperties: false,
    },
  },
];

function str(params: Record<string, unknown>, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function caseInputsFromArgs(params: Record<string, unknown>): CaseInputs {
  const filePath = str(params, 'filePath');
  if (!filePath) throw new AppError('USAGE', 'filePath is required');
  const format = (str(params, 'format') ?? 'fixed') as 'fixed' | 'bai2';
  const copybookPath = str(params, 'copybookPath');
  if (format === 'fixed' && !copybookPath) throw new AppError('USAGE', 'copybookPath is required for a fixed-width file');
  const inputs: CaseInputs = { payment: { path: filePath, format, ...(copybookPath ? { copybookPath } : {}) } };
  const bankFilePath = str(params, 'bankFilePath');
  if (bankFilePath) {
    const bankFormat = (str(params, 'bankFormat') ?? 'fixed') as 'fixed' | 'bai2';
    const bankCopybookPath = str(params, 'bankCopybookPath');
    if (bankFormat === 'fixed' && !bankCopybookPath) {
      throw new AppError('USAGE', 'bankCopybookPath is required for a fixed-width bank file');
    }
    inputs.bank = { path: bankFilePath, format: bankFormat, ...(bankCopybookPath ? { copybookPath: bankCopybookPath } : {}) };
  }
  const window = params.settlementWindow as { start?: unknown; end?: unknown } | undefined;
  if (window) {
    if (typeof window.start !== 'string' || typeof window.end !== 'string') {
      throw new AppError('USAGE', 'settlementWindow needs start and end as ISO dates');
    }
    inputs.settlementWindow = { start: window.start, end: window.end };
  }
  const tolerance = params.toleranceDays;
  if (tolerance !== undefined) {
    if (typeof tolerance !== 'number' || !Number.isInteger(tolerance) || tolerance < 0) {
      throw new AppError('USAGE', 'toleranceDays must be a non-negative integer');
    }
    inputs.toleranceDays = tolerance;
  }
  return inputs;
}

async function callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'parse_file':
      return buildReport(caseInputsFromArgs(params), { includeVerdict: false });
    case 'reconcile':
      return buildReport(caseInputsFromArgs(params));
    case 'explain_findings': {
      const reportPath = str(params, 'reportPath');
      if (!reportPath) throw new AppError('USAGE', 'reportPath is required');
      const { report } = loadReport(reportPath);
      const adapter = adapterByName(str(params, 'adapter') ?? 'mock');
      const maxLiveCalls = typeof params.maxLiveCalls === 'number' ? params.maxLiveCalls : 0;
      const run = await explainReport(report, { adapter, maxLiveCalls });
      return { liveCalls: run.liveCalls, budgetLimited: run.budgetLimited, explanations: run.explanations };
    }
    case 'verify': {
      const reportPath = str(params, 'reportPath');
      if (!reportPath) throw new AppError('USAGE', 'reportPath is required');
      return verifyReport(reportPath);
    }
    case 'exceptions': {
      const reportPath = str(params, 'reportPath');
      if (!reportPath) throw new AppError('USAGE', 'reportPath is required');
      const { report } = loadReport(reportPath);
      if (!report.verdict) throw new AppError('SPEC', 'report has no verdict');

      const ledgerPath = str(params, 'ledgerPath') ?? join(dirname(reportPath.endsWith('.json') ? reportPath : join(reportPath, 'report.json')), 'ledger.json');
      let ledger = emptyLedger();
      if (existsSync(ledgerPath)) {
        const text = readFileSync(ledgerPath, 'utf8');
        ledger = parseLedger(text);
      }

      const onDate = str(params, 'today') ?? new Date().toISOString().split('T')[0]!;
      const classification = classify(reviveFindings(report.verdict.findings), ledger, onDate);
      return classification;
    }
    default:
      throw new AppError('USAGE', `unknown tool "${name}"`);
  }
}

/** Answer one JSON-RPC message. Returns null for notifications. */
export async function handleMessage(message: unknown): Promise<JsonRpcResponse | null> {
  const request = message as JsonRpcRequest;
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const isNotification = request.id === undefined;
  const id = request.id ?? null;

  const reply = (result: unknown): JsonRpcResponse | null => (isNotification ? null : { jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string, data?: unknown): JsonRpcResponse | null =>
    isNotification ? null : { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };

  switch (request.method) {
    case 'initialize': {
      const requested = (request.params?.protocolVersion as string | undefined) ?? MCP_PROTOCOL_VERSION;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSION;
      return reply({
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'edi820-workbench', version: '0.2.0' },
        instructions:
          'Deterministic fixed-width EDI 820/823 and BAI2 workbench. The verdict comes from code, not from a model; explain_findings only narrates values that already exist in a finding.',
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: MCP_TOOLS });
    case 'tools/call': {
      const name = request.params?.name;
      if (typeof name !== 'string') return fail(-32602, 'tools/call requires a tool name');
      const args = (request.params?.arguments as Record<string, unknown> | undefined) ?? {};
      try {
        const result = await callTool(name, args);
        const text = JSON.stringify(result, null, 2);
        return reply({ content: [{ type: 'text', text }], isError: false });
      } catch (error) {
        const message2 = error instanceof AppError ? `${error.kind}: ${error.message}` : (error as Error).message;
        return reply({
          content: [{ type: 'text', text: JSON.stringify({ error: message2 }, null, 2) }],
          isError: true,
        });
      }
    }
    case 'resources/list':
      return reply({ resources: [] });
    case 'prompts/list':
      return reply({ prompts: [] });
    default:
      return fail(-32601, `Method not found: ${request.method}`);
  }
}

/**
 * Run the stdio loop until the input stream ends.
 *
 * Lines are processed in order; a malformed line gets a -32700 parse error and
 * does not stop the server.
 */
export async function serveStdio(input: Readable, output: Writable): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  const pending: Array<Promise<void>> = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      continue;
    }
    pending.push(
      (async () => {
        const response = await handleMessage(message);
        if (response) output.write(`${JSON.stringify(response)}\n`);
      })(),
    );
    // Keep the responses in request order.
    await pending[pending.length - 1];
  }
  await Promise.all(pending);
}

export function toolNames(): string[] {
  return MCP_TOOLS.map((tool) => tool.name);
}
