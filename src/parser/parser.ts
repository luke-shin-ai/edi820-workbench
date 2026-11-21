/**
 * L1 — the deterministic fixed-width parser.
 *
 * Rules (`.kiro/steering/tech.md`):
 *  - slice by copybook boundaries, never trim inside parsing;
 *  - a record whose width differs from the copybook is reported and parsing
 *    continues **at the declared boundary** (no silent re-sync);
 *  - amounts are `bigint` minor units + ISO-4217 currency, never floats;
 *  - the raw record is kept so `serialize` can reproduce the input byte for byte.
 */
import { createHash } from 'node:crypto';
import type { Copybook, CopybookField, Framing } from '../copybook/types.js';
import {
  FieldDecodeError,
  decodeDate,
  decodePackedDecimal,
  decodeSeparateSign,
  decodeUnsignedInt,
  decodeZonedDecimal,
} from './decode.js';

export type IssueCode =
  | 'RECORD_LENGTH_MISMATCH'
  | 'FIELD_INVALID_NUMERIC'
  | 'COPYBOOK_UNPARSABLE'
  | 'COPYBOOK_OVERLAP'
  | 'UNSUPPORTED_STRUCTURE'
  | 'SPEC_MISSING'
  | 'CURRENCY_SCALE_MISMATCH'
  | 'BAI2_STRUCTURE'
  | 'BAI2_RECORD_INVALID'
  | 'BAI2_CONTROL_MISMATCH';

export interface ParseIssue {
  code: IssueCode;
  recordIndex?: number;
  field?: string;
  line?: number;
  detail: string;
  declared?: number | string;
  actual?: number | string;
}

export interface Amount {
  /** Signed minor units (e.g. cents). Never a float. */
  minorUnits: bigint;
  /** ISO-4217 code as it appeared in the currency field (trimmed code only). */
  currency: string;
  /** Number of implied decimal digits the copybook declared. */
  scale: number;
}

export type ParsedValue = string | bigint | Amount | null;

export interface TypedRecord {
  index: number;
  /** Exact record bytes as latin1 characters — the round-trip source. */
  raw: string;
  length: number;
  values: Record<string, ParsedValue>;
  /** Exact slice per field, for byte-offset evidence in the UI and reconciler. */
  slices: Record<string, string>;
  /**
   * 1-based character offsets of each field inside this record. Present for
   * delimiter formats (BAI2), where a field's position depends on the record,
   * not on a fixed layout.
   */
  spans?: Record<string, { start: number; length: number }>;
  issues: ParseIssue[];
  isTrailer: boolean;
}

export interface ControlDeclaration {
  recordIndex: number;
  count?: bigint;
  total?: Amount;
}

export interface CurrencyTotal {
  minorUnits: bigint;
  scale: number;
  records: number;
}

export interface ControlSummary {
  /** Every record in the file, trailer included. */
  recordCount: number;
  /** Records that are not control trailers. */
  detailCount: number;
  totalsByCurrency: Record<string, CurrencyTotal>;
}

export interface ParseResult {
  copybook: Copybook;
  framing: Framing;
  records: TypedRecord[];
  issues: ParseIssue[];
  declaredControl?: ControlDeclaration;
  computedControl: ControlSummary;
  eol: string | null;
  trailingNewline: boolean;
  /** SHA-256 of the input bytes. */
  fileHash: string;
  copybookHash: string;
  /** SHA-256 over the normalised parse result: same input ⇒ same fingerprint. */
  fingerprint: string;
  source: Buffer;
}

/** ISO-4217 minor-unit exponents we can verify a copybook's scale against. */
export const CURRENCY_EXPONENTS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  CAD: 2,
  AUD: 2,
  CNY: 2,
  SGD: 2,
  JPY: 0,
  KRW: 0,
};

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function splitRecords(
  source: Buffer,
  recordLength: number,
  framing: Framing,
): { records: string[]; eol: string | null; trailingNewline: boolean } {
  const text = source.toString('latin1');
  if (framing === 'fixed') {
    const records: string[] = [];
    for (let offset = 0; offset < text.length; offset += recordLength) {
      records.push(text.slice(offset, offset + recordLength));
    }
    return { records, eol: null, trailingNewline: false };
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (text.length === 0) return { records: [], eol: null, trailingNewline: false };
  const trailingNewline = text.endsWith(eol);
  const parts = text.split(eol);
  if (trailingNewline) parts.pop();
  return { records: parts, eol, trailingNewline };
}

function decodeField(field: CopybookField, slice: string, dateFormat: 'CCYYMMDD' | 'YYMMDD'): ParsedValue {
  switch (field.type) {
    case 'filler':
      return null;
    case 'string':
      return slice;
    case 'zoned-decimal':
      return decodeZonedDecimal(slice, field);
    case 'signed-int':
      return decodeSeparateSign(slice, field);
    case 'packed-decimal':
      return decodePackedDecimal(slice, field);
    case 'implied-decimal':
    case 'unsigned-int':
      return decodeUnsignedInt(slice, field);
    default:
      throw new FieldDecodeError(`${field.name}: unsupported field type ${String(field.type)}`);
  }
}

export interface ParseInput {
  copybook: Copybook;
  source: Buffer | string;
  /** Kept for issue messages; parsing itself never reads the file system. */
  filename?: string;
}

export function parseFile(input: ParseInput): ParseResult {
  const { copybook } = input;
  if (!copybook.recordLength || copybook.recordLength < 1) {
    throw new Error('copybook declares a record length of zero — refusing to parse');
  }
  const source = Buffer.isBuffer(input.source) ? input.source : Buffer.from(input.source, 'latin1');
  const { records: rawRecords, eol, trailingNewline } = splitRecords(source, copybook.recordLength, copybook.framing);
  const issues: ParseIssue[] = [];
  const records: TypedRecord[] = [];

  const dateFormat = copybook.semantics.dateFormat ?? 'CCYYMMDD';

  rawRecords.forEach((raw, index) => {
    const recordIssues: ParseIssue[] = [];
    if (raw.length !== copybook.recordLength) {
      const issue: ParseIssue = {
        code: 'RECORD_LENGTH_MISMATCH',
        recordIndex: index,
        declared: copybook.recordLength,
        actual: raw.length,
        detail: `record ${index} is ${raw.length} bytes but the copybook declares ${copybook.recordLength}`,
      };
      recordIssues.push(issue);
    }

    const values: Record<string, ParsedValue> = {};
    const slices: Record<string, string> = {};

    for (const field of copybook.fields) {
      const slice = raw.slice(field.start - 1, field.start - 1 + field.length);
      slices[field.name] = slice;
      if (slice.length < field.length) {
        // Past the end of a short record: the length mismatch already explains it.
        values[field.name] = null;
        continue;
      }
      try {
        values[field.name] = decodeField(field, slice, dateFormat);
      } catch (error) {
        values[field.name] = null;
        if (error instanceof FieldDecodeError) {
          recordIssues.push({
            code: 'FIELD_INVALID_NUMERIC',
            recordIndex: index,
            field: field.name,
            actual: slice,
            detail: error.message,
          });
        } else {
          throw error;
        }
      }
    }

    // Attach the currency to the amount: minor units are meaningless without it.
    const { amount: amountField, currency: currencyField, valueDate } = copybook.semantics;
    if (amountField) {
      const raw = values[amountField];
      const currency = currencyField ? String(values[currencyField] ?? '').trim() : '';
      if (typeof raw === 'bigint') {
        const field = copybook.fields.find((f) => f.name === amountField)!;
        values[amountField] = { minorUnits: raw, currency, scale: field.decimals ?? 0 } satisfies Amount;
        const expected = CURRENCY_EXPONENTS[currency];
        const scale = field.decimals ?? 0;
        if (expected === undefined) {
          recordIssues.push({
            code: 'CURRENCY_SCALE_MISMATCH',
            recordIndex: index,
            field: currencyField,
            actual: currency,
            detail: `${currency === '' ? '(empty)' : currency} is not in the ISO-4217 table, so the copybook's ${scale}-digit scale cannot be verified`,
          });
        } else if (expected !== scale) {
          recordIssues.push({
            code: 'CURRENCY_SCALE_MISMATCH',
            recordIndex: index,
            field: amountField,
            declared: scale,
            actual: expected,
            detail: `${currency} has ${expected} decimal places but the copybook scales ${amountField} by ${scale}`,
          });
        }
      }
    }
    if (valueDate) {
      try {
        const iso = decodeDate(slices[valueDate] ?? '', copybook.fields.find((f) => f.name === valueDate)!, dateFormat);
        values[`${valueDate}__iso`] = iso;
      } catch {
        // A non-date is reported by the type decode above; the ISO view stays absent.
      }
    }

    const isTrailer = copybook.control
      ? (slices[copybook.control.typeField] ?? '').trim() === copybook.control.trailerValue
      : false;

    issues.push(...recordIssues);
    records.push({ index, raw, length: raw.length, values, slices, issues: recordIssues, isTrailer });
  });

  // Declared control values come from the trailer record, via the copybook spec.
  let declaredControl: ControlDeclaration | undefined;
  const control = copybook.control;
  if (control) {
    const trailer = records.find((r) => r.isTrailer);
    if (trailer) {
      const declaration: ControlDeclaration = { recordIndex: trailer.index };
      if (control.countField) {
        const raw = trailer.slices[control.countField] ?? '';
        if (/^[0-9]+$/.test(raw)) declaration.count = BigInt(raw);
      }
      if (control.totalField) {
        const total = trailer.values[control.totalField];
        if (total && typeof total === 'object') declaration.total = total;
      }
      declaredControl = declaration;
    } else {
      issues.push({
        code: 'SPEC_MISSING',
        detail: `the copybook declares a control trailer (${control.typeField}='${control.trailerValue}') but the file has no such record`,
      });
    }
  }

  const totalsByCurrency: Record<string, CurrencyTotal> = {};
  let detailCount = 0;
  for (const record of records) {
    if (record.isTrailer) continue;
    detailCount += 1;
    if (!amountFieldName(copybook)) continue;
    const value = record.values[amountFieldName(copybook)!];
    if (!value || typeof value !== 'object') continue;
    const bucket = (totalsByCurrency[value.currency] ??= { minorUnits: 0n, scale: value.scale, records: 0 });
    bucket.minorUnits += value.minorUnits;
    bucket.records += 1;
  }

  const copybookHash = sha256(copybook.source);
  const fileHash = sha256(source);
  const fingerprint = sha256(
    [
      `copybook:${copybookHash}`,
      `file:${fileHash}`,
      `framing:${copybook.framing}`,
      `recordLength:${copybook.recordLength}`,
      `records:${records.map((r) => sha256(r.raw)).join(',')}`,
      `issues:${issues.map((i) => `${i.code}@${i.recordIndex ?? '-'}:${i.field ?? '-'}`).join(',')}`,
      declaredControl
        ? `declared:${declaredControl.count?.toString() ?? '-'}/${declaredControl.total?.minorUnits.toString() ?? '-'}${declaredControl.total?.currency ?? ''}`
        : 'declared:-',
    ].join('|'),
  );

  return {
    copybook,
    framing: copybook.framing,
    records,
    issues,
    ...(declaredControl ? { declaredControl } : {}),
    computedControl: { recordCount: records.length, detailCount, totalsByCurrency },
    eol,
    trailingNewline,
    fileHash,
    copybookHash,
    fingerprint,
    source,
  };
}

export function amountFieldName(copybook: Copybook): string | undefined {
  return copybook.semantics.amount;
}
