import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CopybookField } from '../../src/copybook/index.js';
import {
  decodePackedDecimal,
  decodeSeparateSign,
  decodeZonedDecimal,
  encodePackedDecimal,
  encodeSeparateSign,
  encodeZonedDecimal,
} from '../../src/parser/index.js';

/**
 * Amounts — the property that matters for money: decode(encode(x)) === x for
 * every representable value, in every sign convention the copybook supports.
 */

function fieldFor(kind: 'zoned' | 'leading' | 'trailing' | 'packed', digits: number, decimals: number): CopybookField {
  const base: CopybookField = {
    name: 'AMT',
    level: 5,
    start: 1,
    length: 0,
    type: 'zoned-decimal',
    pic: `S9(${digits})V${'9'.repeat(decimals)}`,
    digits,
    decimals,
    signed: true,
    usage: 'display',
    explicitPosition: false,
    line: 1,
  };
  switch (kind) {
    case 'zoned':
      return { ...base, sign: 'trailing-overpunch', type: 'zoned-decimal', length: digits + decimals };
    case 'leading':
      return { ...base, sign: 'leading-separate', type: 'signed-int', length: digits + decimals + 1 };
    case 'trailing':
      return { ...base, sign: 'trailing-separate', type: 'signed-int', length: digits + decimals + 1 };
    case 'packed':
      return { ...base, usage: 'comp-3', type: 'packed-decimal', length: Math.ceil((digits + decimals + 1) / 2) };
  }
}

describe('amount round-trip properties (T2.4/T2.5)', () => {
  it('compares convenience: every convention round-trips every representable value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('zoned' as const, 'leading' as const, 'trailing' as const, 'packed' as const),
        fc.integer({ min: 1, max: 11 }),
        fc.integer({ min: 0, max: 4 }),
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        (kind, digits, decimals, raw) => {
          const width = digits + decimals;
          const capacity = 10n ** BigInt(width);
          const value = raw % capacity; // keep it representable
          const field = fieldFor(kind, digits, decimals);
          let encoded: string;
          let decoded: bigint;
          switch (kind) {
            case 'zoned':
              encoded = encodeZonedDecimal(value, field);
              decoded = decodeZonedDecimal(encoded, field);
              break;
            case 'leading':
            case 'trailing':
              encoded = encodeSeparateSign(value, field);
              decoded = decodeSeparateSign(encoded, field);
              break;
            case 'packed':
              encoded = encodePackedDecimal(value, field);
              decoded = decodePackedDecimal(encoded, field);
              break;
          }
          expect(encoded).toHaveLength(field.length);
          expect(decoded).toBe(value);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('the currency scale never changes a value: V99 keeps cents, V0 keeps units', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 99_999_999_999n }), (value) => {
        const cents = fieldFor('zoned', 11, 2);
        expect(decodeZonedDecimal(encodeZonedDecimal(value, cents), cents)).toBe(value);
        const units = fieldFor('zoned', 13, 0);
        expect(decodeZonedDecimal(encodeZonedDecimal(value, units), units)).toBe(value);
      }),
      { numRuns: 200 },
    );
  });

  it('a value wider than the field is refused, never silently truncated', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.bigInt({ min: 10n ** 6n, max: 10n ** 18n }),
        (digits, value) => {
          const field = fieldFor('packed', digits, 0);
          const capacity = 10n ** BigInt(digits);
          if (value < capacity) return; // representable: not the case under test
          expect(() => encodePackedDecimal(value, field)).toThrow(/needs/);
        },
      ),
      { numRuns: 100 },
    );
  });
});
