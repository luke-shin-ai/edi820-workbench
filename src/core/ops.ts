/**
 * Shared operations behind every surface (CLI, MCP, web).
 *
 * Each surface must return the same JSON for the same inputs — that is the claim
 * in `design.md` §8, and the only way to keep it true is to have one
 * implementation. Nothing here prints, renders or decides an exit code.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCopybook } from '../copybook/index.js';
import { CopybookError, type Copybook } from '../copybook/types.js';
import { parseBai2 } from '../bai2/index.js';
import { parseFile, type ParseResult } from '../parser/index.js';
import {
  reconcile,
  type Finding,
  type ReconcileResult,
  type SettlementWindow,
} from '../reconcile/index.js';
import { explainFindings, type Explanation, type ExplainerAdapter } from '../explain/index.js';
import { loadGuarantees, type Guarantees } from './guarantees.js';

export const TOOL_NAME = '820';
export const TOOL_VERSION = '0.2.0';

export type ErrorKind = 'USAGE' | 'IO' | 'SPEC';

export class AppError extends Error {
  readonly kind: ErrorKind;
  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
  }
}

export type FileFormat = 'fixed' | 'bai2';

export interface FileInput {
  path: string;
  format?: FileFormat;
  copybookPath?: string;
}

export interface CaseInputs {
  payment: FileInput;
  bank?: FileInput;
  settlementWindow?: SettlementWindow;
  toleranceDays?: number;
}

export interface JsonIssue {
  code: string;
  recordIndex?: number;
  field?: string;
  line?: number;
  detail: string;
  declared?: unknown;
  actual?: unknown;
}

export interface FileSummary {
  role: 'payment' | 'bank';
  path: string;
  format: FileFormat;
  copybookPath: string | null;
  recordLength: number;
  records: number;
  details: number;
  fileHash: string;
  copybookHash: string;
  fingerprint: string;
  issues: JsonIssue[];
}

export interface JsonFinding {
  code: string;
  recordIndex: number;
  field?: string;
  declared?: unknown;
  computed?: unknown;
  delta?: unknown;
  reference?: string;
  detail: string;
}

export interface Verdict {
  status: 'PASS' | 'INCOMPLETE' | 'FAIL';
  fingerprint: string;
  findings: JsonFinding[];
  summary: ReconcileResult['summary'];
  paymentFileHash: string;
  bankFileHash: string | null;
}

export interface Report {
  tool: string;
  version: string;
  generatedAt: string;
  /**
   * Paths are recorded **relative to the repository root** when the file is inside
   * it, and absolute otherwise. That is what lets `verify` re-derive the report
   * from any working directory (defect of 2026-11-21: `verify` from another cwd
   * failed with `ENOENT samples/copybooks/820.cpy`).
   */
  inputs: CaseInputs;
  files: { payment: FileSummary; bank?: FileSummary };
  verdict?: Verdict;
  explanations?: Explanation[];
  guarantees: Guarantees;
}

function repoRelative(path: string): string {
  const root = repoRoot();
  const absolute = resolve(process.cwd(), path);
  const rel = relative(root, absolute);
  if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/');
  return absolute;
}

function normaliseFileInput<T extends FileInput>(input: T): T {
  return {
    ...input,
    path: repoRelative(input.path),
    ...(input.copybookPath ? { copybookPath: repoRelative(input.copybookPath) } : {}),
  };
}

/** The inputs as they are recorded in `report.json`. */
export function recordableInputs(inputs: CaseInputs): CaseInputs {
  return {
    ...inputs,
    payment: normaliseFileInput(inputs.payment),
    ...(inputs.bank ? { bank: normaliseFileInput(inputs.bank) } : {}),
  };
}

function exists(path: string): boolean {
  return statSyncSafe(path) !== null;
}

/**
 * Turn the paths recorded in a report back into paths that can be read now.
 *
 * A recorded relative path is tried against the repository root first (the
 * report's own contract), then against the current directory, then against each
 * parent of the report itself — so a report that was copied into another checkout
 * still verifies by its own inputs rather than by where the shell happens to be.
 */
export function resolveRecordedInputs(inputs: CaseInputs, reportPath: string): CaseInputs {
  const candidates = (path: string): string[] => {
    if (isAbsolute(path)) return exists(path) ? [path] : [path];
    const list = [resolve(repoRoot(), path), resolve(process.cwd(), path)];
    let dir = dirname(resolve(process.cwd(), reportPath));
    for (let depth = 0; depth < 8; depth += 1) {
      list.push(resolve(dir, path));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return list;
  };
  const pick = (path: string): string => candidates(path).find(exists) ?? candidates(path)[0]!;
  const one = (input: FileInput): FileInput => ({
    ...input,
    path: pick(input.path),
    ...(input.copybookPath ? { copybookPath: pick(input.copybookPath) } : {}),
  });
  return { ...inputs, payment: one(inputs.payment), ...(inputs.bank ? { bank: one(inputs.bank) } : {}) };
}

/** Convert a value to JSON-safe data: bigint → decimal string, buffers dropped. */
export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return `sha256-bytes:${value.length}`;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'source' || (key === 'raw' && typeof val === 'string')) continue;
      out[key] = jsonSafe(val);
    }
    return out;
  }
  return value;
}

function readBytes(path: string): Buffer {
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  try {
    return readFileSync(absolute);
  } catch (error) {
    throw new AppError('IO', `cannot read ${path}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`);
  }
}

function loadCopybook(path: string): Copybook {
  const source = readBytes(path);
  try {
    return compileCopybook(source.toString('utf8'));
  } catch (error) {
    if (error instanceof CopybookError) throw new AppError('SPEC', error.message);
    throw error;
  }
}

function parseInput(input: FileInput, role: 'payment' | 'bank'): ParseResult {
  const format = input.format ?? 'fixed';
  if (format === 'bai2') return parseBai2(readBytes(input.path));
  if (!input.copybookPath) {
    throw new AppError('USAGE', `${role}: a fixed-width file needs --copybook (or pass --format bai2)`);
  }
  const copybook = loadCopybook(input.copybookPath);
  if (copybook.format === 'bai2') throw new AppError('SPEC', 'a BAI2 spec cannot parse fixed-width data');
  const source = readBytes(input.path);
  return parseFile({ copybook, source, filename: input.path });
}

function summarise(role: 'payment' | 'bank', input: FileInput, result: ParseResult): FileSummary {
  return {
    role,
    path: input.path,
    format: input.format ?? 'fixed',
    copybookPath: input.copybookPath ?? null,
    recordLength: result.copybook.recordLength,
    records: result.computedControl.recordCount,
    details: result.computedControl.detailCount,
    fileHash: result.fileHash,
    copybookHash: result.copybookHash,
    fingerprint: result.fingerprint,
    issues: jsonSafe(result.issues) as JsonIssue[],
  };
}

export interface CaseResult {
  payment: ParseResult;
  bank?: ParseResult;
  files: Report['files'];
}

/** Parse one case (payment file + optional bank file) without reconciling. */
export function parseCase(inputs: CaseInputs): CaseResult {
  const payment = parseInput(inputs.payment, 'payment');
  const files: Report['files'] = { payment: summarise('payment', inputs.payment, payment) };
  let bank: ParseResult | undefined;
  if (inputs.bank) {
    bank = parseInput(inputs.bank, 'bank');
    files.bank = summarise('bank', inputs.bank, bank);
  }
  return { payment, ...(bank ? { bank } : {}), files };
}

export function verdictOf(result: ReconcileResult): Verdict {
  return {
    status: result.status,
    fingerprint: result.fingerprint,
    findings: jsonSafe(result.findings) as JsonFinding[],
    summary: result.summary,
    paymentFileHash: result.paymentFileHash,
    bankFileHash: result.bankFileHash,
  };
}

/** Parse and reconcile one case. */
export function reconcileCase(inputs: CaseInputs): { parsed: CaseResult; result: ReconcileResult } {
  const parsed = parseCase(inputs);
  const result = reconcile({
    payment: parsed.payment,
    ...(parsed.bank ? { bank: parsed.bank } : {}),
    options: {
      ...(inputs.settlementWindow ? { settlementWindow: inputs.settlementWindow } : {}),
      ...(inputs.toleranceDays !== undefined ? { toleranceDays: inputs.toleranceDays } : {}),
    },
  });
  return { parsed, result };
}

/**
 * A case given as bytes rather than paths.
 *
 * The web screen needs this for dropped files: the browser hands over text, and
 * `samples/` must never be written to. Nothing here touches the file system, so a
 * dropped file is parsed exactly like a file read from disk.
 */
export interface SourceInput {
  label: string;
  text: string;
  format?: FileFormat;
  copybookText?: string;
  copybookLabel?: string;
}

function parseSource(source: SourceInput, role: 'payment' | 'bank'): ParseResult {
  const format = source.format ?? 'fixed';
  const bytes = Buffer.from(source.text, 'latin1');
  if (format === 'bai2') return parseBai2(bytes);
  if (!source.copybookText) throw new AppError('USAGE', `${role}: a fixed-width file needs a copybook`);
  let copybook: Copybook;
  try {
    copybook = compileCopybook(source.copybookText);
  } catch (error) {
    if (error instanceof CopybookError) throw new AppError('SPEC', error.message);
    throw error;
  }
  return parseFile({ copybook, source: bytes, filename: source.label });
}

function summariseSource(role: 'payment' | 'bank', source: SourceInput, result: ParseResult): FileSummary {
  return {
    role,
    path: source.label,
    format: source.format ?? 'fixed',
    copybookPath: source.copybookLabel ?? null,
    recordLength: result.copybook.recordLength,
    records: result.computedControl.recordCount,
    details: result.computedControl.detailCount,
    fileHash: result.fileHash,
    copybookHash: result.copybookHash,
    fingerprint: result.fingerprint,
    issues: jsonSafe(result.issues) as JsonIssue[],
  };
}

export interface SourceCaseResult {
  payment: ParseResult;
  bank?: ParseResult;
  files: Report['files'];
  result: ReconcileResult;
}

export function reconcileSources(
  payment: SourceInput,
  bank: SourceInput | undefined,
  options: { settlementWindow?: SettlementWindow; toleranceDays?: number } = {},
): SourceCaseResult {
  const paymentResult = parseSource(payment, 'payment');
  const bankResult = bank ? parseSource(bank, 'bank') : undefined;
  const result = reconcile({
    payment: paymentResult,
    ...(bankResult ? { bank: bankResult } : {}),
    options: {
      ...(options.settlementWindow ? { settlementWindow: options.settlementWindow } : {}),
      ...(options.toleranceDays !== undefined ? { toleranceDays: options.toleranceDays } : {}),
    },
  });
  const files: Report['files'] = { payment: summariseSource('payment', payment, paymentResult) };
  if (bank && bankResult) files.bank = summariseSource('bank', bank, bankResult);
  return { payment: paymentResult, ...(bankResult ? { bank: bankResult } : {}), files, result };
}

export function buildReport(inputs: CaseInputs, options: { includeVerdict?: boolean } = {}): Report {
  const includeVerdict = options.includeVerdict ?? true;
  const { parsed, result } = reconcileCase(inputs);
  // `inputs` and `files` record the same normalised paths, so a re-derivation from
  // those recorded paths compares equal instead of tripping over `a/b` vs `/repo/a/b`.
  const recorded = recordableInputs(inputs);
  const files: Report['files'] = {
    payment: { ...parsed.files.payment, path: recorded.payment.path, copybookPath: recorded.payment.copybookPath ?? null },
    ...(parsed.files.bank && recorded.bank
      ? { bank: { ...parsed.files.bank, path: recorded.bank.path, copybookPath: recorded.bank.copybookPath ?? null } }
      : {}),
  };
  const report: Report = {
    tool: TOOL_NAME,
    version: TOOL_VERSION,
    generatedAt: new Date().toISOString(),
    inputs: recorded,
    files,
    ...(includeVerdict ? { verdict: verdictOf(result) } : {}),
    guarantees: loadGuarantees(),
  };
  return report;
}

export function defaultOutDir(): string {
  return join('out', new Date().toISOString().replace(/[:.]/g, '-'));
}

/** Write `report.json` into a directory, creating it. Returns the file path. */
export function writeReport(report: Report, outDir: string): string {
  const dir = isAbsolute(outDir) ? outDir : resolve(process.cwd(), outDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'report.json');
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}

export function loadReport(pathOrDir: string): { report: Report; path: string } {
  const absolute = isAbsolute(pathOrDir) ? pathOrDir : resolve(process.cwd(), pathOrDir);
  const path = statSyncSafe(absolute)?.isDirectory() ? join(absolute, 'report.json') : absolute;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new AppError('IO', `no report.json at ${pathOrDir}`);
  }
  try {
    return { report: JSON.parse(text) as Report, path };
  } catch (error) {
    throw new AppError('IO', `${path} is not valid JSON: ${(error as Error).message}`);
  }
}

function statSyncSafe(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Revive findings from report JSON.
 *
 * `report.json` stores money as decimal strings (JSON has no bigint). The
 * explanation guard must compare real values, so amounts are converted back to
 * `bigint` before L3 sees them — otherwise a "number" would be a string and the
 * guard would compare text.
 */
export function reviveFindings(jsonFindings: JsonFinding[]): Finding[] {
  const reviveValue = (value: unknown, key: string): unknown => {
    if (value === undefined || value === null) return value;
    if (typeof value === 'object' && 'minorUnits' in (value as Record<string, unknown>)) {
      const amount = value as { minorUnits: string | bigint; currency: string; scale: number };
      return { minorUnits: BigInt(amount.minorUnits), currency: amount.currency, scale: amount.scale };
    }
    if (typeof value === 'string' && /^-?\d{1,18}$/.test(value)) return BigInt(value);
    if (key === 'recordIndex') return value;
    return value;
  };
  return jsonFindings.map((finding) => ({
    code: finding.code as Finding['code'],
    recordIndex: Number(finding.recordIndex),
    ...(finding.field ? { field: finding.field } : {}),
    ...(finding.declared !== undefined ? { declared: reviveValue(finding.declared, 'declared') as Finding['declared'] } : {}),
    ...(finding.computed !== undefined ? { computed: reviveValue(finding.computed, 'computed') as Finding['computed'] } : {}),
    ...(finding.delta !== undefined ? { delta: reviveValue(finding.delta, 'delta') as Finding['delta'] } : {}),
    ...(finding.reference !== undefined ? { reference: finding.reference } : {}),
    detail: finding.detail,
  }));
}

/** Explain every finding of a report with the configured adapter. */
export async function explainReport(
  report: Report,
  options: { adapter?: ExplainerAdapter; maxLiveCalls?: number } = {},
): Promise<{ explanations: Explanation[]; liveCalls: number; budgetLimited: number }> {
  if (!report.verdict) throw new AppError('USAGE', 'this report has no verdict (run `reconcile` first)');
  const findings = reviveFindings(report.verdict.findings);
  return explainFindings(findings, options);
}

export interface VerifyOutcome {
  ok: boolean;
  reportPath: string;
  recordedFingerprint: string | null;
  recomputedFingerprint: string | null;
  /** First differing path between the recorded and re-derived report, `a.b[0].c` style. */
  firstDifference: string | null;
  recordedStatus: string | null;
  recomputedStatus: string | null;
  /** Byte sizes and mtimes before/after, proving the command did not mutate the output. */
  mutation: { reportBytesBefore: number; reportBytesAfter: number; reportMtimeBefore: number; reportMtimeAfter: number };
  guarantees: Guarantees;
}

/** Deep diff that reports the first differing field path. */
export function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (a === b) return null;
  const aIsObj = a !== null && typeof a === 'object';
  const bIsObj = b !== null && typeof b === 'object';
  if (!aIsObj || !bIsObj) return path || '(root)';
  if (Array.isArray(a) !== Array.isArray(b)) return path || '(root)';
  if (Array.isArray(a) && Array.isArray(b)) {
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i += 1) {
      const diff = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  const aKeys = Object.keys(a as Record<string, unknown>).sort();
  const bKeys = Object.keys(b as Record<string, unknown>).sort();
  if (aKeys.join('|') !== bKeys.join('|')) {
    const missing = aKeys.find((k) => !bKeys.includes(k)) ?? bKeys.find((k) => !aKeys.includes(k));
    return path ? `${path}.${missing}` : String(missing);
  }
  for (const key of aKeys) {
    const diff = firstDifference(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      path ? `${path}.${key}` : key,
    );
    if (diff) return diff;
  }
  return null;
}

/**
 * Re-derive a report from its own recorded inputs and compare.
 *
 * Read-only by construction: it opens `report.json` and the recorded input files,
 * re-runs the deterministic layers, and writes nothing (R6.1).
 */
export function verifyReport(pathOrDir: string): VerifyOutcome {
  const { report, path } = loadReport(pathOrDir);
  const before = statSync(path);
  const bytesBefore = readFileSync(path);
  // Recorded paths may be repository-relative; resolve them before re-deriving so
  // `verify` gives the same answer from any working directory.
  const recomputed = buildReport(resolveRecordedInputs(report.inputs, path));
  const bytesAfter = readFileSync(path);
  const after = statSync(path);

  const recordedView = comparable(report);
  const recomputedView = comparable(recomputed);
  const diff = firstDifference(recordedView, recomputedView);

  return {
    ok: diff === null,
    reportPath: path,
    recordedFingerprint: report.verdict?.fingerprint ?? null,
    recomputedFingerprint: recomputed.verdict?.fingerprint ?? null,
    firstDifference: diff,
    recordedStatus: report.verdict?.status ?? null,
    recomputedStatus: recomputed.verdict?.status ?? null,
    mutation: {
      reportBytesBefore: bytesBefore.length,
      reportBytesAfter: bytesAfter.length,
      reportMtimeBefore: before.mtimeMs,
      reportMtimeAfter: after.mtimeMs,
    },
    guarantees: loadGuarantees(),
  };
}

/** The part of a report that `verify` must reproduce; timestamps are excluded by design. */
export function comparable(report: Report): unknown {
  return {
    inputs: report.inputs,
    files: report.files,
    verdict: report.verdict ?? null,
  };
}

export function ensureDir(path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  mkdirSync(absolute, { recursive: true });
  return absolute;
}

export function repoRoot(): string {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}
