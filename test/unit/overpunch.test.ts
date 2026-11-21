import { describe, expect, it } from 'vitest';
import type { CopybookField } from '../../src/copybook/types.js';
import {
  FieldDecodeError,
  decodePackedDecimal,
  decodeSeparateSign,
  decodeZonedDecimal,
  encodePackedDecimal,
  encodeSeparateSign,
  encodeZonedDecimal,
} from '../../src/parser/index.js';

function field(overrides: Partial<CopybookField>): CopybookField {
  return {
    name: 'AMT',
    level: 5,
    start: 1,
    length: 5,
    type: 'zoned-decimal',
    pic: 'S9(3)V99',
    digits: 3,
    decimals: 2,
    signed: true,
    usage: 'display',
    explicitPosition: false,
    line: 1,
    ...overrides,
  };
}

describe('T2.2 — overpunch decode table ({{{ +0, }}} -0, A–I +1..+9, J–R −1..−9)', () => {
  const cases: Array<[string, string, bigint]> = [
    ['{', '+0', 0n],
    ['}', '-0', 0n],
    ['A', '+1', 1n],
    ['B', '+2', 2n],
    ['C', '+3', 3n],
    ['D', '+4', 4n],
    ['E', '+5', 5n],
    ['F', '+6', 6n],
    ['G', '+7', 7n],
    ['H', '+8', 8n],
    ['I', '+9', 9n],
    ['J', '-1', -1n],
    ['K', '-2', -2n],
    ['L', '-3', -3n],
    ['M', '-4', -4n],
    ['N', '-5', -5n],
    ['O', '-6', -6n],
    ['P', '-7', -7n],
    ['Q', '-8', -8n],
    ['R', '-9', -9n],
    ['0', '0', 0n],
    ['7', '7', 7n],
  ];

  it.each(cases)('decodes %s as %s', (char, _label, expected) => {
    expect(decodeZonedDecimal(char, field({ digits: 1, decimals: 0 }))).toBe(expected);
  });

  it('decodes a 13-digit amount with the sign in the last digit', () => {
    const amountField = field({ digits: 11, decimals: 2, length: 13 });
    expect(decodeZonedDecimal('000012845500{', amountField)).toBe(128_455_000n);
    expect(decodeZonedDecimal('000012845500}', amountField)).toBe(-128_455_000n);
    expect(decodeZonedDecimal('000000000045}', amountField)).toBe(-450n);
  });

  it('refuses a character outside the table instead of guessing', () => {
    expect(() => decodeZonedDecimal('00001X', field({ digits: 5, decimals: 0 }))).toThrow(FieldDecodeError);
    expect(() => decodeZonedDecimal('0000--', field({ digits: 5, decimals: 0 }))).toThrow(FieldDecodeError);
    expect(() => decodeZonedDecimal('0000*', field({ digits: 5, decimals: 0 }))).toThrow(/overpunch/);
    expect(() => decodeZonedDecimal('00.0{', field({ digits: 5, decimals: 0 }))).toThrow(/expected digits/);
  });

  it('rejects a blank field: padding is a data error, not a zero', () => {
    expect(() => decodeZonedDecimal('     ', field({ digits: 5, decimals: 0 }))).toThrow(FieldDecodeError);
  });
});

describe('separate sign (SIGN LEADING/TRAILING SEPARATE)', () => {
  it('decodes a leading separate sign', () => {
    const f = field({ sign: 'leading-separate', digits: 11, decimals: 2, length: 14, type: 'signed-int' });
    expect(decodeSeparateSign('+0000015000000', f)).toBe(150_000_00n);
    expect(decodeSeparateSign('-0000015000000', f)).toBe(-150_000_00n);
    expect(decodeSeparateSign(' 0000015000000', f)).toBe(150_000_00n);
  });

  it('decodes a trailing separate sign', () => {
    const f = field({ sign: 'trailing-separate', digits: 3, decimals: 0, length: 4, type: 'signed-int' });
    expect(decodeSeparateSign('123-', f)).toBe(-123n);
    expect(decodeSeparateSign('123+', f)).toBe(123n);
  });

  it('refuses a signed display value with no sign character', () => {
    const f = field({ sign: 'leading-separate', digits: 3, decimals: 0, length: 4, type: 'signed-int' });
    expect(() => decodeSeparateSign('0123', f)).toThrow(/missing separate sign/);
  });
});

describe('packed decimal (COMP-3)', () => {
  const f = field({ usage: 'comp-3', type: 'packed-decimal', digits: 11, decimals: 2, length: 7 });
  const bytes = (...values: number[]) => String.fromCharCode(...values);

  it('reads the sign nibble: C/F positive, D negative', () => {
    // 13 digits 0000001500000, sign positive
    expect(decodePackedDecimal(bytes(0x00, 0x00, 0x01, 0x50, 0x00, 0x00, 0x0c), f)).toBe(15_000_000n);
    expect(decodePackedDecimal(bytes(0x00, 0x00, 0x01, 0x50, 0x00, 0x00, 0x0f), f)).toBe(15_000_000n);
    expect(decodePackedDecimal(bytes(0x00, 0x00, 0x01, 0x50, 0x00, 0x00, 0x0d), f)).toBe(-15_000_000n);
  });

  it('refuses an invalid sign nibble', () => {
    expect(() => decodePackedDecimal(bytes(0x00, 0x00, 0x01, 0x50, 0x00, 0x00, 0x0a), f)).toThrow(/sign nibble/);
  });

  it('refuses a non-zero padding nibble rather than shifting the value', () => {
    // `PIC S9(2)` needs 3 nibbles → 2 bytes with one leading padding nibble; a 1 there is corruption.
    const short = field({ digits: 2, decimals: 0, usage: 'comp-3', type: 'packed-decimal', length: 2 });
    expect(() => decodePackedDecimal(String.fromCharCode(0x12, 0x3c), short)).toThrow(/padding/);
    expect(decodePackedDecimal(String.fromCharCode(0x00, 0x3c), short)).toBe(3n);
  });

  it('refuses a short packed field', () => {
    expect(() => decodePackedDecimal(bytes(0x01, 0x50, 0x0c), f)).toThrow(/nibbles/);
  });
});

describe('encode∘decode is the identity on the field level', () => {
  const samples: bigint[] = [0n, 1n, -1n, 45_000n, -45_000n, 128_455_000n, -128_455_000n, 999_999_999_99n];

  it.each(samples)('zoned decimal round-trips %s', (value) => {
    const f = field({ digits: 11, decimals: 2, length: 13 });
    expect(decodeZonedDecimal(encodeZonedDecimal(value, f), f)).toBe(value);
  });

  it.each(samples)('leading separate round-trips %s', (value) => {
    const f = field({ sign: 'leading-separate', type: 'signed-int', digits: 11, decimals: 2, length: 14 });
    expect(decodeSeparateSign(encodeSeparateSign(value, f), f)).toBe(value);
  });

  it.each(samples)('packed decimal round-trips %s', (value) => {
    const f = field({ usage: 'comp-3', type: 'packed-decimal', digits: 11, decimals: 2, length: 7 });
    expect(decodePackedDecimal(encodePackedDecimal(value, f), f)).toBe(value);
  });

  it('refuses to encode a value that does not fit the declared width', () => {
    const f = field({ digits: 3, decimals: 0, length: 3 });
    expect(() => encodeZonedDecimal(1234n, f)).toThrow(/needs 4 digits/);
  });
});
