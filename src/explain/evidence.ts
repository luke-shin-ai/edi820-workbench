/**
 * Numeric grounding guard — the deterministic half of L3.
 *
 * An explanation is only accepted when every number in it can be traced back to
 * a value L2 put in the finding. The check is a set membership test, not a
 * heuristic: no model, no tolerance, no "looks about right".
 *
 * Accepted vocabulary per finding, in two kinds:
 *
 *  1. **Values** — `declared`, `computed`, `delta` rendered as grouped and
 *     ungrouped amounts, minor units, and whole units (`1,284,550.00`,
 *     `1284550.00`, `128455000`, `1284550`), the `recordIndex`, and the numbers
 *     L2 wrote into `detail`. A value is compared by magnitude, so `1,284,550.00`
 *     and `1284550.00` are the same number.
 *  2. **Identifier tokens** — the digit runs of `reference` (`NWP-2611-0011` →
 *     `2611`, `0011`), kept **exactly as written**, leading zeros included.
 *     A digit run that starts with `0` inside `detail` is treated the same way,
 *     because a leading zero marks an identifier, not a quantity.
 *
 * That split is the fix for the red-team finding of 2026-11-22: the guard used to
 * normalise `0011` to `11`, so `"Record 11 was never sent"` passed on a finding
 * whose `recordIndex` was 9, purely because its reference ended in `0011`. A
 * reference is an identifier: `0011` is not eleven, and it is not record 11.
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

/** A run of digits with nothing else attached: the shape of an identifier fragment. */
const DIGIT_RUN_RE = /\d+/g;

/**
 * Every numeric literal in a piece of text, as written (sign and commas included),
 * in order of appearance. Both the evidence set and the validation scan come
 * through here, which is what makes a date, an amount and a record index
 * comparable on the same terms.
 */
export function scanNumericLiterals(text: string): string[] {
  const literals: string[] = [];
  const withoutDates = text.replace(ISO_DATE_RE, (match) => {
    for (const part of match.split('-')) literals.push(part);
    return ' '.repeat(match.length);
  });
  for (const token of withoutDates.match(NUMERIC_LITERAL_RE) ?? []) {
    literals.push(token);
  }
  return literals;
}

/** Every numeric literal in a piece of text, normalised as a value, in order of appearance. */
export function extractNumericLiterals(text: string): string[] {
  return scanNumericLiterals(text).map(normaliseNumericLiteral);
}

/** Unicode minus and thin/dash variants normalise to ASCII `-` so they can be compared. */
export function normaliseNumericLiteral(raw: string): string {
  const unified = raw.replace(/[\u2212\u2013\u2014]/g, '-').replace(/,/g, '').replace(/^\+/, '');
  if (unified.startsWith('-') && unified.length > 1) {
    return `-${stripLeadingZeros(unified.slice(1))}`;
  }
  return stripLeadingZeros(unified);
}

/**
 * The identifier form of a literal: its digits only, leading zeros kept.
 * `-0011` and `0011` are the same identifier fragment; `0011` and `11` are not.
 */
export function identifierToken(raw: string): string {
  const digits = raw.replace(/[+\-\u2212\u2013\u2014]/g, '').replace(/,/g, '');
  return digits;
}

/** A digit run that starts with `0` is an identifier fragment (`0011`), not the number eleven. */
function looksLikeIdentifier(raw: string): boolean {
  const digits = identifierToken(raw);
  return digits.length > 1 && digits.startsWith('0');
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

/** Scan free text for numeric literals and add every one of them, as values. */
function addScanned(set: Set<string>, text: string): void {
  for (const literal of scanNumericLiterals(text)) {
    // An identifier fragment keeps its leading zeros: adding `11` for `0011` is exactly the
    // substitution this guard must not make.
    if (looksLikeIdentifier(literal)) set.add(identifierToken(literal));
    else addLiteral(set, literal);
  }
}

/** Add the digit runs of an identifier field, exactly as written. */
function addIdentifierTokens(set: Set<string>, text: string): void {
  for (const token of text.match(DIGIT_RUN_RE) ?? []) set.add(token);
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
  if (finding.reference !== undefined) addIdentifierTokens(set, finding.reference);
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
  for (const raw of scanNumericLiterals(text)) {
    const canonical = normaliseNumericLiteral(raw);
    const identifier = identifierToken(raw);
    const key = `${canonical}|${identifier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // A value matches by magnitude; an identifier fragment matches exactly, zeros kept.
    if (allowed.has(canonical) || allowed.has(identifier)) cited.push(canonical);
    else unsupported.push(canonical);
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
