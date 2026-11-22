/**
 * BAI2 record layouts - the CSV side of the product.
 *
 * BAI2 is **not** a fixed-width format: it is comma-delimited, record-code
 * prefixed, with the last field optionally terminated by `/`. Masking it as a
 * copybook layout would be exactly the kind of lie this repository exists to
 * avoid, so it gets its own reader and its own declared layouts here.
 *
 * Source of the field order: the public BAI2 cash-management standard
 * (`docs/bai2.md` lists the field tables and the two rules this reader relies on:
 * amounts are integers with implied decimals, and a type code decides credit vs
 * debit).
 */

export interface Bai2FieldSpec {
  name: string;
  /** 1-based position in the comma-separated record. */
  index: number;
  note?: string;
}

export type Bai2RecordCode = '01' | '02' | '03' | '16' | '49' | '88' | '98' | '99';

export const BAI2_RECORD_CODES: Bai2RecordCode[] = ['01', '02', '03', '16', '49', '88', '98', '99'];

export const BAI2_LAYOUTS: Record<Bai2RecordCode, Bai2FieldSpec[]> = {
  '01': [
    { name: 'REC-CODE', index: 1 },
    { name: 'SENDER-ID', index: 2 },
    { name: 'RECEIVER-ID', index: 3 },
    { name: 'FILE-CREATION-DATE', index: 4, note: 'YYMMDD' },
    { name: 'FILE-CREATION-TIME', index: 5, note: 'HHMM' },
    { name: 'FILE-ID', index: 6 },
    { name: 'PHYSICAL-RECORD-LENGTH', index: 7 },
    { name: 'BLOCK-SIZE', index: 8 },
    { name: 'VERSION', index: 9, note: '2 for BAI2' },
  ],
  '02': [
    { name: 'REC-CODE', index: 1 },
    { name: 'ULTIMATE-RECEIVER-ID', index: 2 },
    { name: 'ORIGINATOR-ID', index: 3 },
    { name: 'GROUP-STATUS', index: 4 },
    { name: 'AS-OF-DATE', index: 5, note: 'YYMMDD' },
    { name: 'AS-OF-TIME', index: 6, note: 'HHMM' },
    { name: 'CURRENCY', index: 7, note: 'ISO-4217' },
    { name: 'AS-OF-DATE-MODIFIER', index: 8 },
  ],
  '03': [
    { name: 'REC-CODE', index: 1 },
    { name: 'ACCOUNT', index: 2 },
    { name: 'CURRENCY', index: 3 },
    { name: 'TYPE-CODE', index: 4, note: 'BAI summary code; 100 = total credits' },
    { name: 'AMOUNT', index: 5 },
    { name: 'ITEM-COUNT', index: 6 },
    { name: 'FUNDS-TYPE', index: 7 },
  ],
  '16': [
    { name: 'REC-CODE', index: 1 },
    { name: 'TYPE-CODE', index: 2, note: '100-399 credit, 400-699 debit' },
    { name: 'AMOUNT', index: 3, note: 'unsigned; direction comes from TYPE-CODE' },
    { name: 'FUNDS-TYPE', index: 4 },
    { name: 'BANK-REF', index: 5 },
    { name: 'CUSTOMER-REFERENCE', index: 6 },
    { name: 'TEXT', index: 7, note: 'free text, may contain commas' },
  ],
  '49': [
    { name: 'REC-CODE', index: 1 },
    { name: 'ACCOUNT-CONTROL-TOTAL', index: 2 },
    { name: 'NUMBER-OF-RECORDS', index: 3, note: 'records in the account block, 03..49' },
    { name: 'ACCOUNT-CONTROL-TOTAL-B', index: 4 },
  ],
  '88': [{ name: 'REC-CODE', index: 1 }, { name: 'CONTINUATION', index: 2 }],
  '98': [
    { name: 'REC-CODE', index: 1 },
    { name: 'GROUP-CONTROL-TOTAL', index: 2 },
    { name: 'NUMBER-OF-ACCOUNTS', index: 3 },
    { name: 'NUMBER-OF-RECORDS', index: 4, note: 'records in the group, 02..98' },
  ],
  '99': [
    { name: 'REC-CODE', index: 1 },
    { name: 'FILE-CONTROL-TOTAL', index: 2 },
    { name: 'NUMBER-OF-GROUPS', index: 3 },
    { name: 'NUMBER-OF-RECORDS', index: 4, note: 'records in the file, 01..99' },
  ],
};

export interface Bai2Field {
  /** Field text with the trailing `/` terminator removed. */
  text: string;
  /** 1-based character offset inside the record - this is a real byte offset in latin1. */
  start: number;
  length: number;
}

/**
 * Split one record on commas while keeping each field's character offsets.
 *
 * The offsets are what the web screen highlights, so they are computed here and
 * never re-derived from the joined values (a text field with a comma inside it
 * would otherwise shift every field after it).
 */
export function splitRecordFields(line: string): Bai2Field[] {
  const fields: Bai2Field[] = [];
  let start = 0;
  for (let i = 0; i <= line.length; i += 1) {
    if (i === line.length || line[i] === ',') {
      const text = line.slice(start, i);
      fields.push({ text, start: start + 1, length: text.length });
      start = i + 1;
    }
  }
  const last = fields[fields.length - 1];
  if (last && last.text.endsWith('/')) {
    last.text = last.text.slice(0, -1);
    last.length -= 1;
  }
  return fields;
}

/** The record code is always the first two characters of the line. */
export function recordCodeOf(line: string): string {
  return line.slice(0, 2);
}

/**
 * Map a split record onto its declared layout. Fields beyond the layout are
 * collected into `EXTRA` (BAI2 allows bank-specific trailing fields); the `16`
 * record's free text grabs everything from its declared index onward so commas
 * inside a description cannot be mistaken for fields.
 */
export function toFieldMap(
  code: string,
  fields: Bai2Field[],
  line: string,
): { values: Record<string, string>; spans: Record<string, { start: number; length: number }> } {
  const layout = BAI2_LAYOUTS[code as Bai2RecordCode];
  const values: Record<string, string> = {};
  const spans: Record<string, { start: number; length: number }> = {};
  if (!layout) {
    values['RAW'] = line;
    spans['RAW'] = { start: 1, length: line.length };
    return { values, spans };
  }
  for (const spec of layout) {
    if (code === '16' && spec.name === 'TEXT') {
      const first = fields[spec.index - 1];
      if (!first) continue;
      const text = line.slice(first.start - 1);
      values[spec.name] = text.endsWith('/') ? text.slice(0, -1) : text;
      spans[spec.name] = { start: first.start, length: values[spec.name]!.length };
      continue;
    }
    const field = fields[spec.index - 1];
    values[spec.name] = field ? field.text : '';
    if (field) spans[spec.name] = { start: field.start, length: field.length };
  }
  if (code !== '16' && fields.length > layout.length) {
    const extraStart = fields[layout.length]!;
    values['EXTRA'] = fields.slice(layout.length).map((f) => f.text).join(',');
    spans['EXTRA'] = { start: extraStart.start, length: line.length - extraStart.start + 1 };
  }
  return { values, spans };
}

export interface Bai2SummaryTriple {
  /** A three-digit BAI summary or status code, e.g. `100` (total credits). */
  typeCode: string;
  /** The amount as it appears, before the currency scale is applied. */
  amount: string;
}

export interface Bai2SummaryScan {
  triples: Bai2SummaryTriple[];
  /** A trailing type code whose amount is carried by the next `88` record. */
  pendingTypeCode?: string;
}

/**
 * Read every [type code, amount] pair of an `03` record (or of an `88` that continues one).
 *
 * A BAI2 `03` record is a list of groups: type code, amount, item count, funds type. The item
 * count and funds type are optional, and a funds type may itself carry a date, so the groups are
 * not a fixed stride. A pair is therefore recognised by what it is: a three-digit code followed
 * directly by a numeric amount. A code at the end of the record whose amount continues on the
 * next `88` is returned as `pendingTypeCode` instead of being guessed.
 *
 * `from` is 0-based: 3 for an `03` record (after record code, account and currency), 1 for an `88`.
 */
export function summaryTriples(fields: Bai2Field[], from: number): Bai2SummaryScan {
  const triples: Bai2SummaryTriple[] = [];
  let pendingTypeCode: string | undefined;
  for (let i = from; i < fields.length; i += 1) {
    const text = fields[i]!.text.trim();
    if (!/^\d{3}$/.test(text)) continue;
    const next = fields[i + 1] ? fields[i + 1]!.text.trim() : '';
    if (/^[+-]?\d+$/.test(next)) {
      triples.push({ typeCode: text, amount: next });
      i += 1;
      continue;
    }
    if (next === '') pendingTypeCode = text;
  }
  return pendingTypeCode ? { triples, pendingTypeCode } : { triples };
}

/** BAI type codes 100-399 are credits, 400-699 debits; anything else has no direction. */
export function directionOfTypeCode(typeCode: string): 'credit' | 'debit' | 'unknown' {
  if (!/^\d{3}$/.test(typeCode)) return 'unknown';
  const code = Number(typeCode);
  if (code >= 100 && code <= 399) return 'credit';
  if (code >= 400 && code <= 699) return 'debit';
  return 'unknown';
}

/** Decode a BAI2 amount (`1500000`, optional trailing `}` or leading `-`). */
export function decodeBai2Amount(raw: string, scale: number): { minorUnits: bigint; negative: boolean } {
  let text = raw.trim();
  let negative = false;
  if (text.endsWith('}')) {
    negative = true;
    text = text.slice(0, -1);
  } else if (text.endsWith('{')) {
    text = text.slice(0, -1);
  }
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }
  if (!/^\d+$/.test(text)) throw new Error(`not a BAI2 amount: ${JSON.stringify(raw)}`);
  const magnitude = BigInt(text);
  return { minorUnits: negative && magnitude !== 0n ? -magnitude : magnitude, negative };
}

/** `YYMMDD` -> `CCYY-MM-DD` for the 2000s (BAI2 carries no century; documented, not guessed silently). */
export function isoFromBai2Date(raw: string, century = 2000): string | null {
  if (!/^\d{6}$/.test(raw)) return null;
  const year = century + Number(raw.slice(0, 2));
  const month = Number(raw.slice(2, 4));
  const day = Number(raw.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
