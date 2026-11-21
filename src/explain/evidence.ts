/**
 * Numeric grounding guard — the deterministic half of L3.
 *
 * An explanation is only accepted when every number in it can be traced back to
 * a value L2 put in the finding. The check is a set membership test, not a
 * heuristic: no model, no tolerance, no "looks about right".
 *
 * Accepted vocabulary per finding:
 *   - `declared`, `computed`, `delta` rendered as grouped and ungrouped amounts,
 *     minor units, and whole units (`1,284,550.00`, `1284550.00`, `128455000`, `1284550`);
 *   - `recordIndex` (the same 0-based index L2 prints in `detail`);
 *   - `reference`, scanned for its numeric fragments (`NWP-2611-0011` → 2611, 0011, 11);
 *   - `detail`, which L2 itself generates from those values.
 *
 * Everything else is `unsupported`. A finding with none of declared/computed/
 * delta/reference is `INSUFFICIENT_EVIDENCE` before any adapter is called
 * (R5.3), so an empty finding cannot be talked into an explanation.
 */
import { formatAmount } from '../reconcile/index.js';
import type { Finding } from '../reconcile/index.js';

/** A numeric literal: optional sign, digits with optional thousands commas, optional decimal part. */
export const NUMERIC_LITERAL_RE = /[+\-\u2212]?\d[\d,]*(?:\.\d+)?/g;

/** ISO dates are read as their components, so `2026-11-15` is not a negative eleven. */
const ISO_DATE_RE = /\d{4}-\d{2}-\d{2}/g;

/**
 * Every numeric literal in a piece of text, normalised, in order of appearance.
 * Both the evidence set and the validation scan come through here, which is what
 * makes a date, an amount and a record index comparable on the same terms.
 */
export function extractNumericLiterals(text: string): string[] {
  const literals: string[] = [];
  const withoutDates = text.replace(ISO_DATE_RE, (match) => {
    for (const part of match.split('-')) literals.push(normaliseNumericLiteral(part));
    return ' '.repeat(match.length);
  });
  for (const token of withoutDates.match(NUMERIC_LITERAL_RE) ?? []) {
    literals.push(normaliseNumericLiteral(token));
  }
  return literals;
}

/** Unicode minus and thin/dash variants normalise to ASCII `-` so they can be compared. */
export function normaliseNumericLiteral(raw: string): string {
  const unified = raw.replace(/[\u2212\u2013\u2014]/g, '-').replace(/,/g, '').replace(/^\+/, '');
  if (unified.startsWith('-') && unified.length > 1) {
    return `-${stripLeadingZeros(unified.slice(1))}`;
  }
  return stripLeadingZeros(unified);
}

function stripLeadingZeros(digits: string): string {
  const dot = digits.indexOf('.');
  const whole = dot < 0 ? digits : digits.slice(0, dot);
  const rest = dot < 0 ? '' : digits.slice(dot);
  const strippedWhole = whole.replace(/^0+(?=\d)/, '');
  return `${strippedWhole === '' ? '0' : strippedWhole}${rest}`;
}

/** Add a literal and its sign/zero/whole-unit variants to the accepted set. */
function addLiteral(set: Set<string>, raw: string): void {
  const normalised = normaliseNumericLiteral(raw);
  set.add(normalised);
  const magnitude = normalised.startsWith('-') ? normalised.slice(1) : normalised;
  set.add(magnitude);
  if (normalised.startsWith('-')) set.add(`-${magnitude}`);
  const dot = magnitude.indexOf('.');
  if (dot > 0) set.add(magnitude.slice(0, dot));
}

/** Scan free text for numeric literals and add every one of them. */
function addScanned(set: Set<string>, text: string): void {
  for (const literal of extractNumericLiterals(text)) addLiteral(set, literal);
}

/**
 * Every acceptable rendering of one amount.
 *
 * The point is that the *same value* may be written several ways; the guard
 * accepts the renderings a reader could derive from the field it was given,
 * including the magnitude of a signed delta ("short by 100.00").
 */
export function amountForms(amount: { minorUnits: bigint; currency: string; scale: number }): string[] {
  const signed = { minorUnits: amount.minorUnits, currency: amount.currency, scale: amount.scale };
  const magnitude = {
    minorUnits: amount.minorUnits < 0n ? -amount.minorUnits : amount.minorUnits,
    currency: amount.currency,
    scale: amount.scale,
  };
  const forms: string[] = [];
  for (const value of [signed, magnitude]) {
    const withCurrency = formatAmount(value);
    const withoutCurrency = formatAmount({ ...value, currency: '' });
    forms.push(
      withCurrency,
      withoutCurrency,
      withoutCurrency.replace(/,/g, ''),
      value.minorUnits.toString(),
    );
  }
  return forms;
}

function addValue(set: Set<string>, value: Finding['declared']): void {
  if (value === undefined) return;
  if (typeof value === 'bigint') {
    addLiteral(set, value.toString());
    addLiteral(set, (value < 0n ? -value : value).toString());
    return;
  }
  if (typeof value === 'string') {
    addScanned(set, value);
    return;
  }
  for (const form of amountForms(value)) addScanned(set, form);
}

/** Values that make a finding explainable at all (R5.3). */
export function findingHasEvidence(finding: Finding): boolean {
  return (
    finding.declared !== undefined ||
    finding.computed !== undefined ||
    finding.delta !== undefined ||
    (finding.reference !== undefined && finding.reference !== '')
  );
}

/** The accepted numeric vocabulary of one finding, sorted for stable output. */
export function evidenceVocabulary(finding: Finding): string[] {
  const set = new Set<string>();
  addValue(set, finding.declared);
  addValue(set, finding.computed);
  addValue(set, finding.delta);
  addLiteral(set, String(finding.recordIndex));
  if (finding.reference !== undefined) addScanned(set, finding.reference);
  addScanned(set, finding.detail);
  return [...set].sort();
}

export interface GuardResult {
  ok: boolean;
  /** Accepted literals, in order of appearance. */
  cited: string[];
  /** Literals the text cites that the finding does not contain, in order of appearance. */
  unsupported: string[];
  /** Every number the finding allows (bounded to 400 entries for logs). */
  vocabulary: string[];
}

/**
 * Validate prose against one finding.
 *
 * `ok: false` means the text introduced a number L2 never produced; the caller
 * must replace the whole explanation with `INSUFFICIENT_EVIDENCE` (it is never
 * "edited" — a partly invented explanation is still invented).
 */
export function validateExplanation(text: string, finding: Finding): GuardResult {
  const allowed = new Set(evidenceVocabulary(finding));
  const cited: string[] = [];
  const unsupported: string[] = [];
  const seen = new Set<string>();
  for (const normalised of extractNumericLiterals(text)) {
    if (seen.has(normalised)) continue;
    seen.add(normalised);
    if (allowed.has(normalised)) cited.push(normalised);
    else unsupported.push(normalised);
  }
  return {
    ok: unsupported.length === 0,
    cited,
    unsupported,
    vocabulary: [...allowed].sort().slice(0, 400),
  };
}

/** The citation string L3 attaches itself; a model cannot choose or change it. */
export function citationOf(finding: Finding): string {
  const field = finding.field ? ` field=${finding.field}` : '';
  const reference = finding.reference ? ` ref=${finding.reference}` : '';
  return `${finding.code} record=${finding.recordIndex}${field}${reference}`;
}
