/**
 * T5.4 - MCP server over stdio.
 *
 * Five tools, and each one returns exactly the JSON the CLI writes, because both
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
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import {
  AppError,
  buildReport,
  explainReport,
  loadReport,
  repoRoot,
  reviveFindings,
  verifyReport,
  writeReport,
  type CaseInputs,
} from '../core/ops.js';
import { adapterByName } from '../explain/index.js';
import { classify, emptyLedger, isIsoDate, parseLedger, verifyLedger } from '../exception/index.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';

/** The most live model calls one `explain_findings` request may ask for. */
export const MAX_LIVE_CALLS = 3;

function within(target: string, base: string): boolean {
  return target === base || target.startsWith(base + sep);
}

/**
 * Where an MCP request may read from and write to.
 *
 * Over stdio, the client is a model. A path that arrives in a tool argument is therefore untrusted:
 * an agent, a prompt injection or a confused caller can name any file on the machine. The server
 * accepts reads under `samples/`, `out/` and the working directory, and writes only under `out/`.
 * Everything else is refused before any file is opened, which is what turns "the web screen is
 * restricted" into a property of the product rather than of one surface.
 */
export interface PathPolicy {
  root: string;
  /** Absolute roots a request may read by path. */
  readRoots: string[];
  /** The only root a request may write into. */
  writeRoot: string;
}

export function pathPolicy(): PathPolicy {
  const root = repoRoot();
  const cwd = resolve(process.cwd());
  const roots = [join(root, 'samples'), join(root, 'out')];
  // The working directory is allowed so an agent can point at a report it just produced. A server
  // started at the filesystem root would otherwise allow everything, so that one case is skipped.
  if (cwd !== resolve(sep) && !/^[A-Za-z]:\\?$/.test(cwd)) roots.push(cwd);
  return { root, readRoots: roots, writeRoot: join(root, 'out') };
}

export function resolveAllowedPath(
  raw: string,
  mode: 'read' | 'write',
  policy: PathPolicy = pathPolicy(),
): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new AppError('USAGE', 'a path argument was empty');
  // A relative path is read the way `report.json` records one: from the repository root.
  const candidates = isAbsolute(trimmed)
    ? [resolve(trimmed)]
    : [resolve(policy.root, trimmed), resolve(process.cwd(), trimmed)];
  const absolute = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
  const roots = mode === 'write' ? [policy.writeRoot] : policy.readRoots;
  const allowed = (target: string): boolean => roots.some((base) => within(target, base));
  if (!allowed(absolute)) {
    throw new AppError(
      'USAGE',
      mode === 'write'
        ? `writes are limited to out/ inside the project: ${raw}`
        : `reads are limited to samples/, out/ and the working directory: ${raw}`,
    );
  }
  // A symlink inside an allowed root can point anywhere; compare real paths when the target exists.
  if (existsSync(absolute)) {
    const real = realpathSync(absolute);
    const realRoots = roots.map((base) => (existsSync(base) ? realpathSync(base) : base));
    if (!realRoots.some((base) => within(real, base))) {
      throw new AppError('USAGE', `this path resolves outside the allowed directories: ${raw}`);
    }
  }
  return absolute;
}

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
        outDir: { type: 'string', description: 'Directory under out/ to write report.json into (optional).' },
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
        outDir: { type: 'string', description: 'Directory under out/ to write report.json into (optional).' },
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
        adapter: { type: 'string', enum: ['grounded', 'kiro-cli', 'openai'] },
        maxLiveCalls: {
          type: 'integer',
          minimum: 0,
          maximum: MAX_LIVE_CALLS,
          description: `Maximum live model calls (default 0, at most ${MAX_LIVE_CALLS}). The default grounded adapter makes none.`,
        },
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
        today: { type: 'string', description: 'Classification date in YYYY-MM-DD format (optional; defaults to today). A value that is not a real date is refused.' },
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
  const inputs: CaseInputs = {
    payment: {
      path: resolveAllowedPath(filePath, 'read'),
      format,
      ...(copybookPath ? { copybookPath: resolveAllowedPath(copybookPath, 'read') } : {}),
    },
  };
  const bankFilePath = str(params, 'bankFilePath');
  if (bankFilePath) {
    const bankFormat = (str(params, 'bankFormat') ?? 'fixed') as 'fixed' | 'bai2';
    const bankCopybookPath = str(params, 'bankCopybookPath');
    if (bankFormat === 'fixed' && !bankCopybookPath) {
      throw new AppError('USAGE', 'bankCopybookPath is required for a fixed-width bank file');
    }
    inputs.bank = {
      path: resolveAllowedPath(bankFilePath, 'read'),
      format: bankFormat,
      ...(bankCopybookPath ? { copybookPath: resolveAllowedPath(bankCopybookPath, 'read') } : {}),
    };
  }
  const window = params.settlementWindow as { start?: unknown; end?: unknown } | undefined;
  if (window) {
    if (typeof window.start !== 'string' || typeof window.end !== 'string') {
      throw new AppError('USAGE', 'settlementWindow needs start and end as ISO dates');
    }
    if (!isIsoDate(window.start) || !isIsoDate(window.end)) {
      throw new AppError('USAGE', 'settlementWindow start and end must be real dates in YYYY-MM-DD form');
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
    case 'parse_file': {
      const report = buildReport(caseInputsFromArgs(params), { includeVerdict: false });
      return writtenReport(report, params);
    }
    case 'reconcile': {
      const report = buildReport(caseInputsFromArgs(params));
      return writtenReport(report, params);
    }
    case 'explain_findings': {
      const reportPath = str(params, 'reportPath');
      if (!reportPath) throw new AppError('USAGE', 'reportPath is required');
      // Argument checks come before any file is opened, so a bad request is answered as a bad
      // request even when the report is missing.
      const requested = params.maxLiveCalls;
      if (requested !== undefined && (typeof requested !== 'number' || !Number.isInteger(requested) || requested < 0 || requested > MAX_LIVE_CALLS)) {
        throw new AppError('USAGE', `maxLiveCalls must be an integer from 0 to ${MAX_LIVE_CALLS}`);
      }
      const adapter = adapterByName(str(params, 'adapter') ?? 'grounded');
      const { report } = loadReport(resolveAllowedPath(reportPath, 'read'));
      const run = await explainReport(report, { adapter, maxLiveCalls: requested ?? 0 });
      return { liveCalls: run.liveCalls, budgetLimited: run.budgetLimited, explanations: run.explanations };
    }
    case 'verify': {
      const reportPath = str(params, 'reportPath');
      if (!reportPath) throw new AppError('USAGE', 'reportPath is required');
      return verifyReport(resolveAllowedPath(reportPath, 'read'));
    }
    case 'exceptions': {
      const reportPath = str(params, 'reportPath');
      if (!reportPath) throw new AppError('USAGE', 'reportPath is required');
      const allowedReportPath = resolveAllowedPath(reportPath, 'read');
      const { report } = loadReport(allowedReportPath);
      if (!report.verdict) throw new AppError('SPEC', 'report has no verdict');

      const ledgerPath = str(params, 'ledgerPath')
        ? resolveAllowedPath(str(params, 'ledgerPath')!, 'read')
        : join(dirname(allowedReportPath.endsWith('.json') ? allowedReportPath : join(allowedReportPath, 'report.json')), 'ledger.json');
      let ledger = emptyLedger();
      if (existsSync(ledgerPath)) {
        const text = readFileSync(ledgerPath, 'utf8');
        ledger = parseLedger(text);
      }

      const today = str(params, 'today');
      if (today !== undefined && !isIsoDate(today)) {
        throw new AppError('USAGE', `today (${today}) must be a real date in YYYY-MM-DD form`);
      }
      const onDate = today ?? new Date().toISOString().split('T')[0]!;
      const classification = classify(reviveFindings(report.verdict.findings), ledger, onDate);
      const check = verifyLedger(ledger);
      return {
        ...classification,
        ledger: { path: ledgerPath, entries: check.entries, headHash: check.headHash, ok: check.ok, ...(check.detail ? { detail: check.detail } : {}) },
      };
    }
    default:
      throw new AppError('USAGE', `unknown tool "${name}"`);
  }
}

/** Write the report only when the caller asked for a directory, and only under out/. */
function writtenReport(report: ReturnType<typeof buildReport>, params: Record<string, unknown>): unknown {
  const outDir = str(params, 'outDir');
  if (!outDir) return report;
  const path = writeReport(report, resolveAllowedPath(outDir, 'write'));
  return { ...report, reportPath: path };
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
