import { describe, expect, it } from 'vitest';
import type { CopybookField } from '../../src/copybook/types.js';
import {
  decodePackedDecimal,
  decodeSeparateSign,
  decodeZonedDecimal,
  encodePackedDecimal,
  encodeSeparateSign,
  encodeZonedDecimal,
} from '../../src/parser/index.js';

/**
 * REGRESSION: overpunch letter offset
 *
 * Found by: `test/pbt/amounts.pbt.test.ts` (property "every convention round-trips
 * every representable value") on the first run, and by the table test in
 * `test/unit/overpunch.test.ts`.
 *
 * The bug: the table was built as `string.fromCharCode('A' + digit)` with digit
 * starting at 0, which maps `A -> +0, B -> +1 ... I -> +8, J -> +9`. The convention
 * (`.kiro/steering/finance-file-conventions.md`) is `A..I = +1..+9`, `J..R = -1..-9`.
 * Consequence: every overpunched amount was off by one and negative amounts read
 * as positive above 9.
 *
 * Kept forever so the table cannot silently drift back.
 */

const field: CopybookField = {
  name: 'AMT',
  level: 5,
  start: 1,
  length: 1,
  type: 'zoned-decimal',
  pic: 'S9(1)',
  digits: 1,
  decimals: 0,
  signed: true,
  sign: 'trailing-overpunch',
  usage: 'display',
  explicitPosition: false,
  line: 1,
};

describe('regression: overpunch table starts at +1, not +0', () => {
  it('A is +1 and I is +9 (not A = 0 and J = +9)', () => {
    expect(decodeZonedDecimal('A', field)).toBe(1n);
    expect(decodeZonedDecimal('I', field)).toBe(9n);
  });

  it('J is -1 and R is -9', () => {
    expect(decodeZonedDecimal('J', field)).toBe(-1n);
    expect(decodeZonedDecimal('R', field)).toBe(-9n);
  });

  it('encode agrees with decode for every digit', () => {
    for (let d = 1; d <= 9; d += 1) {
      expect(decodeZonedDecimal(encodeZonedDecimal(BigInt(d), field), field)).toBe(BigInt(d));
      expect(decodeZonedDecimal(encodeZonedDecimal(BigInt(-d), field), field)).toBe(BigInt(-d));
    }
  });
});

/**
 * REGRESSION: implied decimals were dropped when encoding
 *
 * Found by: `test/pbt/parser.pbt.test.ts` (property "typed values re-encode to the
 * same bytes") on a copybook containing `PIC 9(3)V99`: `encodeUnsignedInt` sized the
 * value with the integer digits only (3), so a 5-digit minor-unit value was rejected
 * as "wider than the field", and a value small enough to pass wrote the wrong width.
 *
 * Fix: the width of a numeric field is `digits + decimals` for every display type.
 */
describe('regression: implied decimals are part of the encoded width', () => {
  const implied: CopybookField = {
    ...field,
    length: 5,
    type: 'implied-decimal',
    pic: '9(3)V99',
    digits: 3,
    decimals: 2,
    signed: false,
    sign: undefined,
  };

  it('a 5-digit minor-unit value is accepted and keeps its scale', () => {
    expect(encodeZonedDecimal(123_45n, { ...implied, type: 'zoned-decimal', signed: true, sign: 'trailing-overpunch' })).toHaveLength(5);
  });
});

/**
 * REGRESSION: packed decimal padding nibble at the odd width boundary
 *
 * Found by: the hand-written case in `test/unit/overpunch.test.ts` (13 digits + sign
 * fills the nibbles exactly, so there is no padding nibble). A `PIC S9(2)` field is
 * where padding actually exists, and it is asserted here so the decode path is
 * exercised on the shape that has one.
 */
describe('regression: packed decimal with a real padding nibble', () => {
  const packed: CopybookField = {
    ...field,
    length: 2,
    type: 'packed-decimal',
    usage: 'comp-3',
    pic: 'S9(2)',
    digits: 2,
    decimals: 0,
    sign: undefined,
  };

  it('decodes S9(2) from two bytes and rejects a non-zero pad', () => {
    expect(decodePackedDecimal(String.fromCharCode(0x00, 0x3d), packed)).toBe(-3n);
    expect(() => decodePackedDecimal(String.fromCharCode(0x12, 0x3c), packed)).toThrow(/padding/);
    expect(decodePackedDecimal(encodePackedDecimal(-99n, packed), packed)).toBe(-99n);
  });

  it('separate sign survives the same widths', () => {
    const separate: CopybookField = { ...packed, type: 'signed-int', usage: 'display', sign: 'trailing-separate', length: 3 };
    expect(decodeSeparateSign(encodeSeparateSign(-99n, separate), separate)).toBe(-99n);
  });
});
