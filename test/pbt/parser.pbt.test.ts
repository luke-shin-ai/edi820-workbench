import { describe, expect, it } from 'vitest';
import { bytesEqual } from '../../src/core/bytes.js';
import fc from 'fast-check';
import { compileCopybook, type Copybook, type CopybookField } from '../../src/copybook/index.js';
import {
  encodeRecord,
  parseFile,
  serializeParseResult,
  type ParsedValue,
} from '../../src/parser/index.js';

/**
 * T2.4 / T2.5: properties of the parser itself.
 *
 * The generator builds a real copybook (mixed PIC families, signs and COMP-3),
 * encodes real records from typed values, then asserts that parsing loses
 * nothing: bytes round-trip, typed values re-encode to the same bytes, and a
 * truncated record is reported without disturbing its neighbours.
 */

const picArb = fc.oneof(
  fc.integer({ min: 1, max: 8 }).map((n) => `X(${n})`),
  fc.integer({ min: 1, max: 6 }).map((n) => `9(${n})`),
  fc.tuple(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 2 })).map(([n, m]) => `9(${n})V${'9'.repeat(m)}`),
  fc.integer({ min: 1, max: 6 }).map((n) => `S9(${n}) SIGN TRAILING OVERPUNCH`),
  fc.tuple(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 2 })).map(([n, m]) => `S9(${n})V${'9'.repeat(m)} SIGN TRAILING OVERPUNCH`),
  fc.integer({ min: 1, max: 6 }).map((n) => `S9(${n}) SIGN LEADING SEPARATE`),
  fc.integer({ min: 1, max: 6 }).map((n) => `S9(${n}) SIGN TRAILING SEPARATE`),
  fc.integer({ min: 1, max: 6 }).map((n) => `S9(${n}) COMP-3`),
  fc.tuple(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 2 })).map(([n, m]) => `S9(${n})V${'9'.repeat(m)} COMP-3`),
);

const copybookArb = fc.array(picArb, { minLength: 1, maxLength: 6 }).map((pics) =>
  [
    '       01  GENERATED.',
    ...pics.map((pic, i) => `           05  F${i}   PIC ${pic}.`),
  ].join('\n'),
);

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /-.';

function pseudo(seed: bigint, mod: number): number {
  const mixed = seed * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n;
  const positive = mixed < 0n ? -mixed : mixed;
  return Number(positive % BigInt(mod));
}

function valueFor(field: CopybookField, seed: bigint): ParsedValue {
  if (field.type === 'string' || field.type === 'filler') {
    let out = '';
    for (let i = 0; i < field.length; i += 1) {
      out += ALPHABET[pseudo(seed + BigInt(i * 7 + 1), ALPHABET.length)];
    }
    return out;
  }
  const digits = (field.digits ?? 0) + (field.decimals ?? 0);
  const capacity = 10n ** BigInt(digits);
  const magnitude = pseudo(seed, Number(capacity > 1_000_000n ? 1_000_000 : Number(capacity)));
  const negative = field.signed && pseudo(seed + 5n, 2) === 0;
  return negative ? -BigInt(magnitude) : BigInt(magnitude);
}

function recordsFor(copybook: Copybook, seeds: bigint[]): string[] {
  const rows: string[] = [];
  for (let r = 0; r < seeds.length; r += 1) {
    const values: Record<string, ParsedValue> = {};
    copybook.fields.forEach((field, i) => {
      values[field.name] = valueFor(field, seeds[r]! + BigInt(i * 31 + 1));
    });
    rows.push(encodeRecord(copybook, values));
  }
  return rows;
}

const seedsArb = fc.array(fc.bigInt({ min: -(2n ** 62n), max: 2n ** 62n }), { minLength: 1, maxLength: 5 });
const seedsPairArb = fc.array(fc.bigInt({ min: -(2n ** 62n), max: 2n ** 62n }), { minLength: 2, maxLength: 5 });

function fileFor(copybook: Copybook, seeds: bigint[], eol: string, trailing: boolean): Buffer {
  const records = recordsFor(copybook, seeds);
  const body = records.join(eol) + (trailing ? eol : '');
  return Buffer.from(body, 'latin1');
}

describe('T2.4 - parse -> serialize is byte-identical', () => {
  it('holds for generated copybooks, records and line terminators', () => {
    fc.assert(
      fc.property(
        copybookArb,
        seedsArb,
        fc.constantFrom('\n', '\r\n'),
        fc.boolean(),
        (text, seeds, eol, trailing) => {
          const copybook = compileCopybook(text);
          const source = fileFor(copybook, seeds, eol, trailing);
          const result = parseFile({ copybook, source });

          expect(result.issues).toEqual([]);
          expect(result.records).toHaveLength(seeds.length);
          expect(bytesEqual(serializeParseResult(result), source)).toBe(true);
        },
      ),
      { numRuns: 250 },
    );
  });

  it('typed values re-encode to the same bytes (decoding loses nothing)', () => {
    fc.assert(
      fc.property(copybookArb, seedsArb, (text, seeds) => {
        const copybook = compileCopybook(text);
        const source = fileFor(copybook, seeds, '\n', true);
        const result = parseFile({ copybook, source });
        for (const record of result.records) {
          expect(encodeRecord(copybook, record.values)).toBe(record.raw);
        }
      }),
      { numRuns: 250 },
    );
  });

  it('every parsed amount stays a bigint (no float ever appears)', () => {
    fc.assert(
      fc.property(copybookArb, seedsArb, (text, seeds) => {
        const copybook = compileCopybook(text);
        const result = parseFile({ copybook, source: fileFor(copybook, seeds, '\n', true) });
        for (const record of result.records) {
          for (const field of copybook.fields) {
            const value = record.values[field.name];
            if (field.type === 'string' || field.type === 'filler') continue;
            if (typeof value === 'number') throw new Error('a number leaked out of the parser');
            expect(typeof value === 'bigint' || value === null).toBe(true);
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe('T2.5 - boundary and truncation behaviour', () => {
  it('a record cut by 1..k bytes is reported once and does not move its neighbours', () => {
    fc.assert(
      fc.property(
        copybookArb,
        seedsPairArb,
        fc.integer({ min: 1, max: 5 }),
        (text, seeds, cut) => {
          const copybook = compileCopybook(text);
          const records = recordsFor(copybook, seeds);
          const index = 0;
          const shortened = records[index]!.slice(0, Math.max(0, records[index]!.length - cut));
          const source = Buffer.from([...records.slice(0, index), shortened, ...records.slice(index + 1)].join('\n') + '\n', 'latin1');
          const result = parseFile({ copybook, source });

          const mismatches = result.issues.filter((i) => i.code === 'RECORD_LENGTH_MISMATCH');
          expect(mismatches).toHaveLength(1);
          expect(mismatches[0]).toMatchObject({
            recordIndex: index,
            declared: copybook.recordLength,
            actual: Math.max(0, copybook.recordLength - cut),
          });
          expect(result.records).toHaveLength(records.length);
          expect(result.records[1]!.raw).toBe(records[1]);
          expect(bytesEqual(serializeParseResult(result), source)).toBe(true);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('zero and extreme values survive the round trip', () => {
    fc.assert(
      fc.property(copybookArb, (text) => {
        const copybook = compileCopybook(text);
        const extreme = (field: CopybookField, mode: 'zero' | 'max' | 'min'): ParsedValue => {
          if (field.type === 'string' || field.type === 'filler') return ' '.repeat(field.length);
          const digits = (field.digits ?? 0) + (field.decimals ?? 0);
          const capacity = 10n ** BigInt(digits) - 1n;
          if (mode === 'zero') return 0n;
          if (mode === 'max') return capacity;
          return field.signed ? -capacity : capacity;
        };
        for (const mode of ['zero', 'max', 'min'] as const) {
          const values: Record<string, ParsedValue> = {};
          for (const field of copybook.fields) values[field.name] = extreme(field, mode);
          const record = encodeRecord(copybook, values);
          const result = parseFile({ copybook, source: Buffer.from(`${record}\n`, 'latin1') });
          expect(result.issues).toEqual([]);
          expect(result.records[0]!.raw).toBe(record);
          expect(encodeRecord(copybook, result.records[0]!.values)).toBe(record);
        }
      }),
      { numRuns: 100 },
    );
  });
});
