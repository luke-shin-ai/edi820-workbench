/**
 * Field decoding - the sign and decimal rules of the copybook, by table only.
 *
 * `SIGN TRAILING OVERPUNCH` is a lookup, never a guess:
 *   `{` -> +0, `}` -> -0, `A`..`I` -> +1..+9, `J`..`R` -> -1..-9.
 * Packed decimal (COMP-3) reads a sign nibble (`C`/`F` positive, `D` negative).
 * Nothing here touches floating point.
 */
import type { CopybookField, SignConvention } from '../copybook/types.js';

/** Classic overpunch table (.kiro/steering/finance-file-conventions.md). */
export const OVERPUNCH_POSITIVE: Record<string, number> = { '{': 0 };
export const OVERPUNCH_NEGATIVE: Record<string, number> = { '}': 0 };

// A..I = +1..+9 and J..R = -1..-9: the letter encodes the digit itself.
for (let d = 1; d <= 9; d += 1) {
  OVERPUNCH_POSITIVE[String.fromCharCode('A'.charCodeAt(0) + d - 1)] = d;
  OVERPUNCH_NEGATIVE[String.fromCharCode('J'.charCodeAt(0) + d - 1)] = d;
}

export class FieldDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldDecodeError';
  }
}

const DIGITS_ONLY = /^[0-9]+$/;

function digitsToBigInt(digits: string, context: string): bigint {
  if (!DIGITS_ONLY.test(digits)) {
    throw new FieldDecodeError(`${context}: expected digits, found ${JSON.stringify(digits)}`);
  }
  return BigInt(digits);
}

/** Decode a trailing-overpunch zoned decimal. Returns signed minor units. */
export function decodeZonedDecimal(raw: string, field: CopybookField): bigint {
  if (raw.length === 0) throw new FieldDecodeError(`${field.name}: empty value`);
  const last = raw[raw.length - 1]!;
  const head = raw.slice(0, -1);
  let digit: number;
  let negative = false;

  if (DIGITS_ONLY.test(last)) {
    digit = Number(last);
  } else if (last in OVERPUNCH_POSITIVE) {
    digit = OVERPUNCH_POSITIVE[last]!;
  } else if (last in OVERPUNCH_NEGATIVE) {
    digit = OVERPUNCH_NEGATIVE[last]!;
    negative = true;
  } else {
    throw new FieldDecodeError(`${field.name}: ${JSON.stringify(last)} is not in the overpunch table`);
  }

  const magnitude = digitsToBigInt(`${head}${digit}`, field.name);
  return negative && magnitude !== 0n ? -magnitude : magnitude;
}

/** Decode a separate-sign zoned decimal (`SIGN LEADING/TRAILING SEPARATE`). */
export function decodeSeparateSign(raw: string, field: CopybookField): bigint {
  const convention: SignConvention = field.sign ?? 'trailing-separate';
  let signChar = '';
  let digits = '';
  if (convention === 'leading-separate') {
    signChar = raw.slice(0, 1);
    digits = raw.slice(1);
  } else {
    signChar = raw.slice(-1);
    digits = raw.slice(0, -1);
  }
  if (signChar !== '+' && signChar !== '-' && signChar !== ' ') {
    if (DIGITS_ONLY.test(raw)) throw new FieldDecodeError(`${field.name}: missing separate sign`);
    throw new FieldDecodeError(`${field.name}: invalid separate sign ${JSON.stringify(signChar)}`);
  }
  const magnitude = digitsToBigInt(digits, field.name);
  return signChar === '-' && magnitude !== 0n ? -magnitude : magnitude;
}

/** Decode packed decimal (COMP-3). `raw` holds one latin1 character per byte. */
export function decodePackedDecimal(raw: string, field: CopybookField): bigint {
  if (raw.length === 0) throw new FieldDecodeError(`${field.name}: empty packed value`);
  const nibbles: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const byte = raw.charCodeAt(i);
    nibbles.push(byte >> 4, byte & 0x0f);
  }
  const signNibble = nibbles.pop()!;
  let negative = false;
  if (signNibble === 0x0c || signNibble === 0x0f) negative = false;
  else if (signNibble === 0x0d) negative = true;
  else throw new FieldDecodeError(`${field.name}: invalid packed sign nibble 0x${signNibble.toString(16)}`);

  const digitCount = (field.digits ?? 0) + (field.decimals ?? 0);
  if (nibbles.length < digitCount) {
    throw new FieldDecodeError(`${field.name}: packed value holds ${nibbles.length} nibbles but the copybook declares ${digitCount} digits`);
  }
  const padding = nibbles.slice(0, nibbles.length - digitCount);
  for (const nib of padding) {
    if (nib !== 0) throw new FieldDecodeError(`${field.name}: packed padding nibble 0x${nib.toString(16)} is not zero`);
  }
  let digits = '';
  for (const nib of nibbles.slice(nibbles.length - digitCount)) {
    if (nib > 9) throw new FieldDecodeError(`${field.name}: packed digit nibble 0x${nib.toString(16)} is not a digit`);
    digits += String(nib);
  }
  const magnitude = BigInt(digits.length === 0 ? '0' : digits);
  return negative && magnitude !== 0n ? -magnitude : magnitude;
}

/** Decode a display unsigned integer (`PIC 9(n)`). */
export function decodeUnsignedInt(raw: string, field: CopybookField): bigint {
  return digitsToBigInt(raw, field.name);
}

/** Convert a `CCYYMMDD` / `YYMMDD` display date to an ISO date, or fail. */
export function decodeDate(raw: string, field: CopybookField, format: 'CCYYMMDD' | 'YYMMDD' = 'CCYYMMDD'): string {
  const expected = format === 'CCYYMMDD' ? 8 : 6;
  if (!DIGITS_ONLY.test(raw) || raw.length !== expected) {
    throw new FieldDecodeError(`${field.name}: expected a ${expected}-digit ${format} date, found ${JSON.stringify(raw)}`);
  }
  const year = format === 'CCYYMMDD' ? Number(raw.slice(0, 4)) : 2000 + Number(raw.slice(0, 2));
  const month = Number(raw.slice(format === 'CCYYMMDD' ? 4 : 2, format === 'CCYYMMDD' ? 6 : 4));
  const day = Number(raw.slice(format === 'CCYYMMDD' ? 6 : 4));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new FieldDecodeError(`${field.name}: ${raw} is not a calendar date`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
