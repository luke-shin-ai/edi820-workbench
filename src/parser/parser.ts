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
import { fromLatin1, isBytes, toLatin1, type Bytes } from '../core/bytes.js';
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
  | 'REDEFINES_VIEW_UNMATCHED'
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
  /**
   * Active `REDEFINES` layout per region (region name → layout name), when the
   * copybook declares views. Absent for a copybook without `REDEFINES`.
   */
  views?: Record<string, string>;
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
  /** Signed sum per currency: credits positive, debits negative. */
  totalsByCurrency: Record<string, CurrencyTotal>;
  /**
   * Gross credit total per currency (magnitudes only). A BAI2 `03` code `100`
   * declares *total credits*, so a comparison must not silently mix it with
   * debits; the reconciler prints this split next to the net delta.
   */
  creditTotalsByCurrency?: Record<string, CurrencyTotal>;
  /** Gross debit total per currency, as positive magnitudes. */
  debitTotalsByCurrency?: Record<string, CurrencyTotal>;
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
  source: Bytes;
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

export function sha256(data: string | Bytes): string {
  return createHash('sha256').update(data).digest('hex');
}

export function splitRecords(
  source: Bytes,
  recordLength: number,
  framing: Framing,
): { records: string[]; eol: string | null; trailingNewline: boolean } {
  const text = toLatin1(source);
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
  source: Bytes | string;
  /** Kept for issue messages; parsing itself never reads the file system. */
  filename?: string;
}

export function parseFile(input: ParseInput): ParseResult {
  const { copybook } = input;
  if (!copybook.recordLength || copybook.recordLength < 1) {
    throw new Error('copybook declares a record length of zero — refusing to parse');
  }
  const source: Bytes = isBytes(input.source) ? input.source : fromLatin1(input.source);
  const { records: rawRecords, eol, trailingNewline } = splitRecords(source, copybook.recordLength, copybook.framing);
  const issues: ParseIssue[] = [];
  const records: TypedRecord[] = [];

  const dateFormat = copybook.semantics.dateFormat ?? 'CCYYMMDD';

  /**
   * Which layout of each `REDEFINES` region this record uses.
   *
   * The rule is the copybook's, not the parser's: each layout declares the
   * discriminator field and value that select it (`* @view`). A record whose
   * discriminator matches no layout is reported, and its shared bytes stay
   * undecoded, so the run cannot earn a PASS on a guess.
   */
  const activeLayouts = (raw: string, index: number, issuesOut: ParseIssue[]): Record<string, string> => {
    const active: Record<string, string> = {};
    if (!copybook.views || copybook.views.length === 0) return active;
    const regions = new Map<string, typeof copybook.views>();
    for (const view of copybook.views) {
      const list = regions.get(view.region);
      if (list) list.push(view);
      else regions.set(view.region, [view]);
    }
    for (const [regionName, layouts] of regions) {
      const hits: string[] = [];
      for (const layout of layouts) {
        const discriminator = layout.typeField
          ? copybook.fields.find((field) => field.name === layout.typeField)
          : undefined;
        if (!discriminator) continue;
        const value = raw.slice(discriminator.start - 1, discriminator.start - 1 + discriminator.length).trim();
        if ((layout.values ?? []).some((candidate) => candidate === value)) hits.push(layout.layout);
      }
      if (hits.length === 1) {
        active[regionName] = hits[0]!;
        continue;
      }
      const discriminatorName = layouts[0]?.typeField ?? '(none)';
      const discriminator = copybook.fields.find((field) => field.name === discriminatorName);
      const seen = discriminator ? raw.slice(discriminator.start - 1, discriminator.start - 1 + discriminator.length).trim() : '';
      const declared = layouts.map((layout) => `${layout.layout}=${(layout.values ?? []).join('/')}`).join(', ');
      issuesOut.push({
        code: 'REDEFINES_VIEW_UNMATCHED',
        recordIndex: index,
        field: discriminatorName,
        actual: seen,
        detail:
          hits.length === 0
            ? `record ${index}: ${discriminatorName} reads ${JSON.stringify(seen)}, which selects no layout of the shared bytes ${regionName} (declared: ${declared})`
            : `record ${index}: ${discriminatorName} reads ${JSON.stringify(seen)}, which selects more than one layout (${hits.join(', ')})`,
      });
    }
    return active;
  };

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
    const views = activeLayouts(raw, index, recordIssues);

    for (const field of copybook.fields) {
      // A group has no bytes of its own; only the active layout's fields are read.
      if (field.group) continue;
      if (field.region !== undefined) {
        const active = views[field.region];
        if (active !== field.layout) continue;
      }
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
    // On a control trailer the declared total and its currency may live in the
    // trailer's own `REDEFINES` layout, so `@control` names them when it does.
    // `@control typeField` must sit outside any region (the compiler enforces it), so
    // its slice is always present.
    const isTrailerRecord = copybook.control
      ? (slices[copybook.control.typeField] ?? '').trim() === copybook.control.trailerValue
      : false;
    const amountField = isTrailerRecord && copybook.control?.totalField
      ? copybook.control.totalField
      : copybook.semantics.amount;
    const currencyField = isTrailerRecord && copybook.control?.currencyField
      ? copybook.control.currencyField
      : copybook.semantics.currency;
    const valueDate = copybook.semantics.valueDate;
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

    const isTrailer = isTrailerRecord;

    issues.push(...recordIssues);
    records.push({
      index,
      raw,
      length: raw.length,
      values,
      slices,
      issues: recordIssues,
      isTrailer,
      ...(Object.keys(views).length > 0 ? { views } : {}),
    });
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
  const creditTotalsByCurrency: Record<string, CurrencyTotal> = {};
  const debitTotalsByCurrency: Record<string, CurrencyTotal> = {};
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
    const gross = value.minorUnits < 0n ? -value.minorUnits : value.minorUnits;
    const target = value.minorUnits < 0n ? debitTotalsByCurrency : creditTotalsByCurrency;
    const grossBucket = (target[value.currency] ??= { minorUnits: 0n, scale: value.scale, records: 0 });
    grossBucket.minorUnits += gross;
    grossBucket.records += 1;
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
      // Only a copybook with `REDEFINES` contributes this component, so a fingerprint
      // of a copybook without views is unchanged by the feature (regression: the six
      // sample scenarios keep the fingerprints they had before).
      ...(copybook.views && copybook.views.length > 0
        ? [`views:${records.map((r) => (r.views ? Object.entries(r.views).map(([k, v]) => `${k}=${v}`).join('+') : '-')).join(',')}`]
        : []),
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
    computedControl: { recordCount: records.length, detailCount, totalsByCurrency, creditTotalsByCurrency, debitTotalsByCurrency },
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
