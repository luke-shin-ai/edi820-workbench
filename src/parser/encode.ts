/**
 * Field encoding — the inverse of `decode.ts`, used by the fixture generator and
 * by the property tests that prove decode∘encode is the identity.
 *
 * Keeping the encoder in the product (not only in tests) matters: a parser whose
 * round-trip is verified only against hand-written fixtures proves very little.
 */
import type { CopybookField } from '../copybook/types.js';
import { FieldDecodeError } from './decode.js';

function digitString(value: bigint, width: number, name: string): { digits: string; negative: boolean } {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const digits = magnitude.toString(10);
  if (digits.length > width) {
    throw new FieldDecodeError(`${name}: value ${value} needs ${digits.length} digits but the copybook declares ${width}`);
  }
  return { digits: digits.padStart(width, '0'), negative };
}

const POSITIVE_OVERPUNCH = ['{', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const NEGATIVE_OVERPUNCH = ['}', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'];

export function encodeZonedDecimal(value: bigint, field: CopybookField): string {
  const width = (field.digits ?? 0) + (field.decimals ?? 0);
  const { digits, negative } = digitString(value, width, field.name);
  const table = negative ? NEGATIVE_OVERPUNCH : POSITIVE_OVERPUNCH;
  const lastDigit = Number(digits[digits.length - 1]!);
  return `${digits.slice(0, -1)}${table[lastDigit]!}`;
}

export function encodeSeparateSign(value: bigint, field: CopybookField): string {
  const width = (field.digits ?? 0) + (field.decimals ?? 0);
  const { digits, negative } = digitString(value, width, field.name);
  const sign = negative ? '-' : '+';
  return (field.sign ?? 'trailing-separate') === 'leading-separate' ? `${sign}${digits}` : `${digits}${sign}`;
}

export function encodePackedDecimal(value: bigint, field: CopybookField): string {
  const width = (field.digits ?? 0) + (field.decimals ?? 0);
  const { digits, negative } = digitString(value, width, field.name);
  const signNibble = negative ? 0x0d : 0x0c;
  const nibbles: number[] = [];
  if ((width + 1) % 2 === 1) nibbles.push(0);
  for (const ch of digits) nibbles.push(Number(ch));
  nibbles.push(signNibble);
  let out = '';
  for (let i = 0; i < nibbles.length; i += 2) {
    out += String.fromCharCode(((nibbles[i]! << 4) | nibbles[i + 1]!) & 0xff);
  }
  return out;
}

export function encodeUnsignedInt(value: bigint, field: CopybookField): string {
  const width = (field.digits ?? 0) + (field.decimals ?? 0);
  const { digits } = digitString(value, width, field.name);
  return digits;
}

export function encodeString(value: string, field: CopybookField): string {
  if (value.length > field.length) {
    throw new FieldDecodeError(`${field.name}: ${JSON.stringify(value)} is wider than the field's ${field.length} bytes`);
  }
  return value.padEnd(field.length, ' ');
}

export function encodeFiller(field: CopybookField, ch = ' '): string {
  return ch.repeat(field.length);
}

/** Encode any field from its typed value (string, bigint or `{minorUnits}`). */
export function encodeField(field: CopybookField, value: string | bigint | { minorUnits: bigint } | null): string {
  if (field.type === 'filler') return encodeFiller(field);
  if (value === null) throw new FieldDecodeError(`${field.name}: cannot encode a null value`);
  if (typeof value === 'string') return encodeString(value, field);
  const amount = typeof value === 'bigint' ? value : value.minorUnits;
  switch (field.type) {
    case 'packed-decimal':
      return encodePackedDecimal(amount, field);
    case 'zoned-decimal':
      return encodeZonedDecimal(amount, field);
    case 'signed-int':
      return encodeSeparateSign(amount, field);
    case 'implied-decimal':
    case 'unsigned-int':
      return encodeUnsignedInt(amount, field);
    default:
      throw new FieldDecodeError(`${field.name}: unsupported field type ${field.type}`);
  }
}
