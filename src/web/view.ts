/**
 * View model for the web screen.
 *
 * The screen shows three things and nothing else: what came in (left), what the
 * deterministic layers decided (middle), and the bytes that decision rests on
 * (right). Every string here is already a display string - the browser never does
 * arithmetic, and never divides a minor unit by 100.
 */
import { formatAmount, type Finding, type VerdictStatus } from '../reconcile/index.js';
import type { ParseResult } from '../parser/index.js';
import type { Explanation } from '../explain/index.js';
import type { Guarantees } from '../core/guarantees.js';
import type { FileSummary } from '../core/ops.js';
import type { ReconcileResult } from '../reconcile/index.js';

const AMOUNT_KEYS = new Set(['declared', 'computed', 'delta']);

function renderValue(value: Finding['declared']): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  return formatAmount(value);
}

export interface ViewField {
  name: string;
  start: number;
  length: number;
  text: string;
  pic: string;
}

export interface ViewRecord {
  index: number;
  side: 'payment' | 'bank';
  isTrailer: boolean;
  raw: string;
  length: number;
  /** The record sliced by its own spec - this is what "the file becomes readable" looks like. */
  fields: ViewField[];
  issues: Array<{ code: string; field?: string; detail: string }>;
}

export interface ViewEvidence {
  side: 'payment' | 'bank';
  recordIndex: number;
  raw: string;
  field?: string;
  pic?: string;
  /** 1-based character offset and length of the field inside `raw`. */
  span?: { start: number; length: number };
  fieldText?: string;
  /** Byte offsets are character offsets in latin1, which is one byte per character. */
  note: string;
}

export interface ViewFinding {
  index: number;
  code: string;
  recordIndex: number;
  field?: string;
  reference?: string;
  declared?: string;
  computed?: string;
  delta?: string;
  detail: string;
  evidence: ViewEvidence;
  explanation?: Explanation;
}

export interface ViewTotalsRow {
  currency: string;
  declared: string;
  computed: string;
  delta: string;
  /** How the compared figure was formed (net of debits, gross credits, signed sum). */
  basis?: string;
  credits?: string;
  debits?: string;
}

export interface ViewModel {
  generatedAt: string;
  files: { payment: FileSummary; bank?: FileSummary };
  status: VerdictStatus;
  fingerprint: string;
  summary: ReconcileResult['summary'];
  totals: ViewTotalsRow[];
  findings: ViewFinding[];
  records: ViewRecord[];
  issues: Array<{ side: 'payment' | 'bank'; code: string; recordIndex?: number; field?: string; detail: string }>;
  guarantees: Guarantees;
}

function recordView(
  record: ParseResult['records'][number],
  side: 'payment' | 'bank',
  result: ParseResult,
): ViewRecord {
  const fields: ViewField[] =
    result.copybook.format === 'bai2'
      ? Object.entries(record.spans ?? {}).map(([name, span]) => ({
          name,
          start: span.start,
          length: span.length,
          text: record.raw.slice(span.start - 1, span.start - 1 + span.length),
          pic: 'BAI2 field',
        }))
      : result.copybook.fields
          // A group item owns no bytes, and an inactive `REDEFINES` layout reads none,
          // so the layout panel shows only what this record was actually sliced by.
          .filter(
            (field) =>
              !field.group &&
              record.slices[field.name] !== undefined &&
              (field.region === undefined || record.views?.[field.region] === field.layout),
          )
          .map((field) => ({
            name: field.name,
            start: field.start,
            length: field.length,
            text: record.slices[field.name] ?? '',
            pic: field.pic,
          }));
  return {
    index: record.index,
    side,
    isTrailer: record.isTrailer,
    raw: record.raw,
    length: record.length,
    fields,
    issues: record.issues.map((i) => ({ code: i.code, ...(i.field ? { field: i.field } : {}), detail: i.detail })),
  };
}

function sideFor(finding: Finding, payment: ParseResult, bank: ParseResult | undefined): 'payment' | 'bank' {
  const field = finding.field;
  if (field) {
    const inPayment = payment.copybook.fields.some((f) => f.name === field) || payment.copybook.semantics.reference === field;
    if (inPayment) return 'payment';
    if (bank && (bank.copybook.fields.some((f) => f.name === field) || bank.copybook.semantics.reference === field)) {
      return 'bank';
    }
  }
  if (/^bank\b|direction: bank-only/i.test(finding.detail)) return 'bank';
  return 'payment';
}

function evidenceFor(
  finding: Finding,
  side: 'payment' | 'bank',
  result: ParseResult,
): ViewEvidence {
  const record = result.records[finding.recordIndex];
  if (!record) {
    return { side, recordIndex: finding.recordIndex, raw: '', note: 'record not present in this file' };
  }
  const field = finding.field;
  if (!field) {
    return {
      side,
      recordIndex: finding.recordIndex,
      raw: record.raw,
      note: `record ${finding.recordIndex}, ${record.length} characters - the finding is file-wide`,
    };
  }
  const spec = result.copybook.fields.find((f) => f.name === field);
  const span = record.spans?.[field] ?? (spec ? { start: spec.start, length: spec.length } : undefined);
  const fieldText = record.slices[field];
  return {
    side,
    recordIndex: finding.recordIndex,
    raw: record.raw,
    field,
    ...(spec ? { pic: spec.pic } : {}),
    ...(span ? { span } : {}),
    ...(fieldText !== undefined ? { fieldText } : {}),
    note: span
      ? `${field}${spec ? ` ${spec.pic}` : ''} at bytes ${span.start}-${span.start + span.length - 1} of record ${finding.recordIndex} (1-based)`
      : `record ${finding.recordIndex}: the field ??${field}?? is not in this file's spec`,
  };
}

export function buildViewModel(input: {
  payment: ParseResult;
  bank?: ParseResult;
  result: ReconcileResult;
  files: { payment: FileSummary; bank?: FileSummary };
  explanations?: Explanation[];
  guarantees: Guarantees;
}): ViewModel {
  const { payment, bank, result, files, guarantees } = input;
  const findings: ViewFinding[] = result.findings.map((finding, index) => {
    const side = sideFor(finding, payment, bank);
    const source = side === 'bank' && bank ? bank : payment;
    return {
      index,
      code: finding.code,
      recordIndex: finding.recordIndex,
      ...(finding.field ? { field: finding.field } : {}),
      ...(finding.reference ? { reference: finding.reference } : {}),
      ...(() => {
        const declared = renderValue(finding.declared);
        const computed = renderValue(finding.computed);
        const delta = renderValue(finding.delta);
        return {
          ...(declared !== undefined ? { declared } : {}),
          ...(computed !== undefined ? { computed } : {}),
          ...(delta !== undefined ? { delta } : {}),
        };
      })(),
      detail: finding.detail,
      evidence: evidenceFor(finding, side, source),
      ...(input.explanations?.[index] ? { explanation: input.explanations[index] } : {}),
    };
  });

  const records: ViewRecord[] = [
    ...payment.records.map((record) => recordView(record, 'payment', payment)),
    ...(bank ? bank.records.map((record) => recordView(record, 'bank', bank)) : []),
  ];

  const issues = [
    ...payment.issues.map((issue) => ({ side: 'payment' as const, code: issue.code, ...(issue.recordIndex !== undefined ? { recordIndex: issue.recordIndex } : {}), ...(issue.field ? { field: issue.field } : {}), detail: issue.detail })),
    ...(bank?.issues ?? []).map((issue) => ({ side: 'bank' as const, code: issue.code, ...(issue.recordIndex !== undefined ? { recordIndex: issue.recordIndex } : {}), ...(issue.field ? { field: issue.field } : {}), detail: issue.detail })),
  ];

  const totals: ViewTotalsRow[] = Object.entries(result.summary.totals).map(([currency, value]) => ({
    currency,
    declared: value.declared,
    computed: value.computed,
    delta: value.delta,
    ...(value.basis ? { basis: value.basis } : {}),
    ...(value.credits ? { credits: value.credits } : {}),
    ...(value.debits ? { debits: value.debits } : {}),
  }));

  return {
    generatedAt: new Date().toISOString(),
    files,
    status: result.status,
    fingerprint: result.fingerprint,
    summary: result.summary,
    totals,
    findings,
    records,
    issues,
    guarantees,
  };
}
