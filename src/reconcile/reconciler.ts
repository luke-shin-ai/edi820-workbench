/**
 * L2 — the deterministic reconciliation engine.
 *
 * It holds no model and makes no judgement about acceptability: it compares
 * declared against summed values, matches references, checks the settlement
 * window, and emits coded findings with signed `bigint` deltas. Every finding
 * names a record index and (where relevant) a field, so the L3 agent can only
 * narrate what L2 actually proved.
 */
import type { Copybook } from '../copybook/types.js';
import {
  CURRENCY_EXPONENTS,
  sha256,
  type Amount,
  type IssueCode,
  type ParseIssue,
  type ParseResult,
  type TypedRecord,
} from '../parser/parser.js';

export type FindingCode =
  | 'CONTROL_TOTAL_MISMATCH'
  | 'CONTROL_COUNT_MISMATCH'
  | 'REF_UNMATCHED'
  | 'DATE_OUT_OF_WINDOW'
  | 'FIELD_DECLARED_LENGTH_EXCEEDED';

export interface Finding {
  code: FindingCode;
  /** Index of the record the finding is anchored to (-1 when file-wide). */
  recordIndex: number;
  field?: string;
  declared?: Amount | bigint | string;
  computed?: Amount | bigint | string;
  /** Money differences are `Amount`; count differences are a bare `bigint`. */
  delta?: Amount | bigint;
  reference?: string;
  detail: string;
}

export interface SettlementWindow {
  /** ISO date, inclusive. */
  start: string;
  /** ISO date, inclusive. */
  end: string;
}

export interface ReconcileOptions {
  settlementWindow?: SettlementWindow;
  /** Days of slack on each side of the window. Default 0 (`tech.md`). */
  toleranceDays?: number;
}

export interface ReconcileInput {
  payment: ParseResult;
  /** The bank side (823/BAI2). Without it only the payment file is checked. */
  bank?: ParseResult;
  options?: ReconcileOptions;
}

export interface ReconcileSummary {
  paymentRecords: number;
  paymentDetails: number;
  bankRecords: number;
  bankDetails: number;
  referencesMatched: number;
  referencesUnmatched: number;
  totals: Record<
    string,
    { declared: string; computed: string; delta: string; basis?: string; credits?: string; debits?: string }
  >;
  /** Parse issues that stop a verdict from being PASS even when no finding fired. */
  blockingParseIssues: number;
  parseIssues: { payment: number; bank: number };
}

/**
 * PASS · INCOMPLETE · FAIL.
 *
 * `INCOMPLETE` exists because a parse issue is not a reconciliation finding: a
 * record that is one byte short, or a BAI2 file whose own trailer total does not
 * add up, means the file was **not typed faithfully**. Returning PASS there was a
 * real defect (found 2026-11-21): the tool reported a verdict it had not earned.
 */
export type VerdictStatus = 'PASS' | 'INCOMPLETE' | 'FAIL';

/**
 * Codes that do **not** block a verdict.
 *
 * `SPEC_MISSING` only says a comparison could not be made (no declared total, no
 * mapped field). Every other issue means some bytes were not interpreted as the
 * spec says, so the file cannot earn a PASS.
 */
export const NON_BLOCKING_PARSE_ISSUES: ReadonlySet<IssueCode> = new Set<IssueCode>(['SPEC_MISSING']);

export function isBlockingIssue(issue: ParseIssue): boolean {
  return !NON_BLOCKING_PARSE_ISSUES.has(issue.code);
}

export function blockingIssuesOf(result: ParseResult): ParseIssue[] {
  return result.issues.filter(isBlockingIssue);
}

export interface ReconcileResult {
  status: VerdictStatus;
  findings: Finding[];
  summary: ReconcileSummary;
  /** SHA-256 over normalised findings + input file hashes. */
  fingerprint: string;
  paymentFileHash: string;
  bankFileHash: string | null;
}

function amountOf(record: TypedRecord, copybook: Copybook): Amount | undefined {
  const amountField = copybook.semantics.amount;
  if (!amountField) return undefined;
  const value = record.values[amountField];
  return value && typeof value === 'object' ? value : undefined;
}

function stringOf(record: TypedRecord, fieldName: string | undefined, trim = true): string | undefined {
  if (!fieldName) return undefined;
  const value = record.values[fieldName];
  if (typeof value !== 'string') return undefined;
  return trim ? value.trim() : value;
}

function isoDateOf(record: TypedRecord, copybook: Copybook): string | undefined {
  const field = copybook.semantics.valueDate;
  if (!field) return undefined;
  const iso = record.values[`${field}__iso`];
  return typeof iso === 'string' ? iso : undefined;
}

function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function withinWindow(date: string, window: SettlementWindow, toleranceDays: number): boolean {
  return dayDiff(date, window.start) >= -toleranceDays && dayDiff(window.end, date) >= -toleranceDays;
}

function controlFindings(result: ParseResult, label: string): Finding[] {
  const findings: Finding[] = [];
  const { copybook, declaredControl, computedControl } = result;

  if (declaredControl?.count !== undefined) {
    const declared = declaredControl.count;
    const computed = BigInt(computedControl.detailCount);
    if (declared !== computed) {
      findings.push({
        code: 'CONTROL_COUNT_MISMATCH',
        recordIndex: declaredControl.recordIndex,
        field: copybook.control?.countField,
        declared,
        computed,
        // Signed as "what the file actually contains minus what it declares" (see design.md §10.5).
        delta: computed - declared,
        detail: `${label} control count declares ${declared} records but ${computed} detail records were read`,
      });
    }
  }

  if (declaredControl?.total) {
    const declared = declaredControl.total;
    const buckets = computedControl.totalsByCurrency;
    const bucketKey = declared.currency && buckets[declared.currency] ? declared.currency : Object.keys(buckets)[0];
    const bucket = bucketKey ? buckets[bucketKey] : undefined;
    const computedMinor = bucket?.minorUnits ?? 0n;
    const delta = computedMinor - declared.minorUnits;
    if (delta !== 0n) {
      // Name the composition. A BAI2 `03` code `100` declares *total credits*, while the
      // detail records it is compared against net credits against debits: without this
      // line a bank fee and a missing credit arrive as one anonymous number.
      const credits = bucketKey ? computedControl.creditTotalsByCurrency?.[bucketKey] : undefined;
      const debits = bucketKey ? computedControl.debitTotalsByCurrency?.[bucketKey] : undefined;
      const composition =
        credits || debits
          ? ` (credits ${formatAmount({ minorUnits: credits?.minorUnits ?? 0n, currency: declared.currency || (bucketKey ?? ''), scale: declared.scale })}` +
            ` minus debits ${formatAmount({ minorUnits: debits?.minorUnits ?? 0n, currency: declared.currency || (bucketKey ?? ''), scale: declared.scale })})`
          : '';
      findings.push({
        code: 'CONTROL_TOTAL_MISMATCH',
        recordIndex: declaredControl.recordIndex,
        field: copybook.control?.totalField,
        declared,
        computed: { minorUnits: computedMinor, currency: declared.currency || (bucketKey ?? ''), scale: declared.scale },
        delta: { minorUnits: delta, currency: declared.currency || (bucketKey ?? ''), scale: declared.scale },
        detail: `${label} control total declares ${formatAmount(declared)} but the detail records net to ${formatAmount({ ...declared, minorUnits: computedMinor })}${composition} (delta ${formatAmount({ ...declared, minorUnits: delta })})`,
      });
    }
  }
  return findings;
}

export function formatAmount(amount: Amount): string {
  const negative = amount.minorUnits < 0n;
  const magnitude = negative ? -amount.minorUnits : amount.minorUnits;
  const power = 10n ** BigInt(amount.scale);
  const whole = magnitude / power;
  const fraction = amount.scale > 0 ? `.${(magnitude % power).toString().padStart(amount.scale, '0')}` : '';
  return `${negative ? '-' : ''}${groupDigits(whole.toString())}${fraction}${amount.currency ? ` ${amount.currency}` : ''}`;
}

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

interface RefRecord {
  record: TypedRecord;
  /** Trimmed reference text; an empty string means the field was blank. */
  reference: string;
  amount?: Amount;
  date?: string;
}

function referenceRecords(result: ParseResult): RefRecord[] {
  const { copybook } = result;
  if (!copybook.semantics.reference) return [];
  const out: RefRecord[] = [];
  for (const record of result.records) {
    if (record.isTrailer) continue;
    const value = record.values[copybook.semantics.reference];
    if (typeof value !== 'string') continue;
    const amount = amountOf(record, copybook);
    const date = isoDateOf(record, copybook);
    out.push({
      record,
      reference: value.trim(),
      ...(amount ? { amount } : {}),
      ...(date ? { date } : {}),
    });
  }
  return out;
}

function referenceFindings(
  payment: ParseResult,
  bank: ParseResult,
  toleranceDays: number,
): { findings: Finding[]; matched: number } {
  const findings: Finding[] = [];
  const paymentRefs = referenceRecords(payment);
  const bankRefs = referenceRecords(bank);
  const usedBank = new Set<number>();
  let matched = 0;

  for (const p of paymentRefs) {
    if (p.reference === '') {
      // A blank reference is a data defect, not a match candidate: report it instead of
      // letting two blank fields "agree" with each other (reviewer finding, 2026-11-21).
      findings.push({
        code: 'REF_UNMATCHED',
        recordIndex: p.record.index,
        field: payment.copybook.semantics.reference,
        reference: '',
        detail: `820 record ${p.record.index} has a blank reference field and cannot be matched (direction: 820-only)`,
      });
      continue;
    }
    const exact = bankRefs.find((b) => b.reference === p.reference && b.reference !== '' && !usedBank.has(b.record.index));
    if (exact) {
      usedBank.add(exact.record.index);
      matched += 1;
      continue;
    }
    // Fallback allowed by the conventions: same amount+currency and a value date
    // inside the tolerance window. A fallback match is a match; nothing is dropped.
    if (p.amount) {
      const fallback = bankRefs.find(
        (b) =>
          b.reference !== '' &&
          !usedBank.has(b.record.index) &&
          b.amount !== undefined &&
          b.amount.currency === p.amount!.currency &&
          b.amount.minorUnits === p.amount!.minorUnits &&
          (p.date === undefined || b.date === undefined || Math.abs(dayDiff(p.date, b.date)) <= toleranceDays),
      );
      if (fallback) {
        usedBank.add(fallback.record.index);
        matched += 1;
        continue;
      }
    }
    findings.push({
      code: 'REF_UNMATCHED',
      recordIndex: p.record.index,
      field: payment.copybook.semantics.reference,
      reference: p.reference,
      ...(p.amount ? { declared: p.amount } : {}),
      detail: `820 reference ${p.reference} has no counterpart in the bank file (direction: 820-only)`,
    });
  }

  for (const b of bankRefs) {
    if (usedBank.has(b.record.index)) continue;
    findings.push({
      code: 'REF_UNMATCHED',
      recordIndex: b.record.index,
      field: bank.copybook.semantics.reference,
      reference: b.reference,
      ...(b.amount ? { declared: b.amount } : {}),
      detail:
        b.reference === ''
          ? `bank record ${b.record.index} has a blank reference field and cannot be matched (direction: bank-only)`
          : `bank reference ${b.reference} has no counterpart in the 820 file (direction: bank-only)`,
    });
  }

  return { findings, matched };
}

function dateFindings(result: ParseResult, label: string, window: SettlementWindow, toleranceDays: number): Finding[] {
  if (!result.copybook.semantics.valueDate) return [];
  return result.records
    .filter((r) => !r.isTrailer)
    .map((record) => ({ record, iso: isoDateOf(record, result.copybook) }))
    .filter((x): x is { record: TypedRecord; iso: string } => x.iso !== undefined)
    .filter((x) => !withinWindow(x.iso, window, toleranceDays))
    .map((x) => ({
      code: 'DATE_OUT_OF_WINDOW' as const,
      recordIndex: x.record.index,
      field: result.copybook.semantics.valueDate,
      declared: `${window.start}..${window.end}`,
      computed: x.iso,
      detail: `${label} record ${x.record.index} has value date ${x.iso}, outside the settlement window ${window.start}..${window.end} (tolerance ${toleranceDays}d)`,
    }));
}

function normaliseFinding(finding: Finding): string {
  const render = (value: Finding['declared']): string => {
    if (value === undefined) return '-';
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return value;
    return `${value.minorUnits.toString()}${value.currency}@${value.scale}`;
  };
  return [
    finding.code,
    finding.recordIndex,
    finding.field ?? '-',
    finding.reference ?? '-',
    render(finding.declared),
    render(finding.computed),
    render(finding.delta),
  ].join('|');
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => normaliseFinding(a).localeCompare(normaliseFinding(b)));
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const toleranceDays = input.options?.toleranceDays ?? 0;
  const findings: Finding[] = [];

  findings.push(...controlFindings(input.payment, '820'));
  let bankFileHash: string | null = null;
  let referencesMatched = 0;
  if (input.bank) {
    findings.push(...controlFindings(input.bank, 'bank'));
    bankFileHash = input.bank.fileHash;
    const refResult = referenceFindings(input.payment, input.bank, toleranceDays);
    findings.push(...refResult.findings);
    referencesMatched = refResult.matched;
  }
  if (input.options?.settlementWindow) {
    findings.push(...dateFindings(input.payment, '820', input.options.settlementWindow, toleranceDays));
    if (input.bank) {
      findings.push(...dateFindings(input.bank, 'bank', input.options.settlementWindow, toleranceDays));
    }
  }

  const sorted = sortFindings(findings);
  const paymentTotals = input.payment.computedControl.totalsByCurrency;
  const totals: ReconcileSummary['totals'] = {};
  const declaredTotal = input.payment.declaredControl?.total;
  if (declaredTotal) {
    const currency = declaredTotal.currency || Object.keys(paymentTotals)[0] || '';
    const computed = paymentTotals[currency]?.minorUnits ?? 0n;
    const credits = input.payment.computedControl.creditTotalsByCurrency?.[currency];
    const debits = input.payment.computedControl.debitTotalsByCurrency?.[currency];
    totals[currency] = {
      declared: declaredTotal.minorUnits.toString(),
      computed: computed.toString(),
      delta: (computed - declaredTotal.minorUnits).toString(),
      basis: 'signed detail total',
      ...(credits ? { credits: credits.minorUnits.toString() } : {}),
      ...(debits ? { debits: debits.minorUnits.toString() } : {}),
    };
  }
  // The bank side is shown in its own row when it declares a comparable total, so a
  // reviewer can see that a *credits* declaration was compared against a net figure
  // carrying debits. This is the S6 case: a missing 79,000.00 credit plus a 25.00 fee.
  const bankDeclared = input.bank?.declaredControl?.total;
  if (input.bank && bankDeclared) {
    const currency = bankDeclared.currency || Object.keys(input.bank.computedControl.totalsByCurrency)[0] || '';
    const bankTotals = input.bank.computedControl.totalsByCurrency[currency];
    const bankCredits = input.bank.computedControl.creditTotalsByCurrency?.[currency];
    const bankDebits = input.bank.computedControl.debitTotalsByCurrency?.[currency];
    totals[`${currency} (bank ${input.bank.copybook.format === 'bai2' ? '03/100 credits' : 'trailer'})`] = {
      declared: bankDeclared.minorUnits.toString(),
      computed: (bankTotals?.minorUnits ?? 0n).toString(),
      delta: ((bankTotals?.minorUnits ?? 0n) - bankDeclared.minorUnits).toString(),
      basis: 'credits minus debits (net)',
      ...(bankCredits ? { credits: bankCredits.minorUnits.toString() } : {}),
      ...(bankDebits ? { debits: bankDebits.minorUnits.toString() } : {}),
    };
  }

  const paymentBlocking = blockingIssuesOf(input.payment);
  const bankBlocking = input.bank ? blockingIssuesOf(input.bank) : [];
  const blocking = [...paymentBlocking, ...bankBlocking];

  const referencesMatchedTotal = referencesMatched;
  const summary: ReconcileSummary = {
    paymentRecords: input.payment.computedControl.recordCount,
    paymentDetails: input.payment.computedControl.detailCount,
    bankRecords: input.bank?.computedControl.recordCount ?? 0,
    bankDetails: input.bank?.computedControl.detailCount ?? 0,
    referencesMatched: referencesMatchedTotal,
    referencesUnmatched: sorted.filter((f) => f.code === 'REF_UNMATCHED').length,
    totals,
    blockingParseIssues: blocking.length,
    parseIssues: { payment: input.payment.issues.length, bank: input.bank?.issues.length ?? 0 },
  };

  // A parse issue that leaves bytes uninterpreted cannot earn a PASS (defect found
  // 2026-11-21: a 99-byte record produced `verdict: PASS findings: 0`).
  const status: VerdictStatus =
    sorted.length > 0 ? 'FAIL' : blocking.length > 0 ? 'INCOMPLETE' : 'PASS';
  const fingerprint = sha256(
    [
      `payment:${input.payment.fileHash}`,
      `bank:${bankFileHash ?? '-'}`,
      `copybook:${input.payment.copybookHash}`,
      `bankCopybook:${input.bank?.copybookHash ?? '-'}`,
      `window:${input.options?.settlementWindow ? `${input.options.settlementWindow.start}..${input.options.settlementWindow.end}` : '-'}`,
      `tolerance:${toleranceDays}`,
      `status:${status}`,
      `blocking:${blocking.map((issue) => `${issue.code}@${issue.recordIndex ?? '-'}:${issue.field ?? '-'}`).join(',')}`,
      `findings:${sorted.map(normaliseFinding).join(';')}`,
    ].join('|'),
  );

  return {
    status,
    findings: sorted,
    summary,
    fingerprint,
    paymentFileHash: input.payment.fileHash,
    bankFileHash,
  };
}

/** Convenience for callers that need to know whether a currency is two-decimal. */
export function currencyScale(currency: string): number | undefined {
  return CURRENCY_EXPONENTS[currency];
}
