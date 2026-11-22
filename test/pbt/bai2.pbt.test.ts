/**
 * T5: properties of the BAI2 reader.
 *
 * The reader must hold two invariants for any well-formed file it generates
 * itself: the sign comes from the type code and never from the text, and the
 * bytes it read can be written back unchanged. The third property is the one a
 * naive reader fails: a file whose control totals agree produces no issue.
 */
import { describe, expect, it } from 'vitest';
import { bytesEqual } from '../../src/core/bytes.js';
import fc from 'fast-check';
import { parseBai2 } from '../../src/bai2/index.js';
import { serializeParseResult } from '../../src/parser/index.js';

const creditCode = fc.integer({ min: 100, max: 399 }).map((n) => String(n));
const debitCode = fc.integer({ min: 400, max: 699 }).map((n) => String(n));
const amount = fc.bigInt({ min: 0n, max: 10n ** 12n });

interface Line {
  typeCode: string;
  minorUnits: bigint;
  reference: string;
}

function buildFile(details: Line[], declaredTotal: bigint, declaredCount: number): { text: string } {
  const lines = [
    '01,TESTBANK,TESTCO,261121,0900,FILE-1,,,2',
    '02,TESTCO,TESTBANK,1,261120,0900,USD',
    `03,0000-000001,USD,100,${declaredTotal},${details.length},Z`,
    ...details.map((d, i) => `16,${d.typeCode},${d.minorUnits},Z,BANK-${i},${d.reference},TEXT ${i}`),
    `49,${declaredTotal + declaredTotal},${details.length + 2}/`,
    `98,${declaredTotal + declaredTotal},1,${details.length + 4}/`,
    `99,${declaredTotal + declaredTotal},1,${details.length + 6}/`,
  ];
  return { text: `${lines.join('\n')}\n` };
}

describe('T5 - a BAI2 file round-trips byte for byte', () => {
  it('for any detail set generated with the reader\'s own rules', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.oneof(creditCode, debitCode), amount, fc.stringMatching(/^[A-Z0-9-]{1,12}$/)),
          { minLength: 1, maxLength: 6 },
        ),
        (rows) => {
          const details: Line[] = rows.map(([typeCode, minorUnits, reference], i) => ({
            typeCode,
            minorUnits,
            reference: `REF${i}-${reference}`,
          }));
          const total = details
            .map((d) => (Number(d.typeCode) >= 400 ? -d.minorUnits : d.minorUnits))
            .reduce((a, b) => a + b, 0n);
          const { text } = buildFile(details, total, details.length);
          const result = parseBai2(Buffer.from(text, 'latin1'));
          expect(bytesEqual(serializeParseResult(result), Buffer.from(text, 'latin1'))).toBe(true);
        },
      ),
      { numRuns: 120 },
    );
  });
});

describe('T5 - direction comes from the type code, for any code in range', () => {
  it('credits stay positive and debits are negated, independent of the written amount', () => {
    fc.assert(
      fc.property(
        fc.oneof(creditCode, debitCode),
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.integer({ min: 0, max: 3 }),
        (typeCode, minorUnits, index) => {
          const details: Line[] = Array.from({ length: index + 1 }, (_, i) => ({
            typeCode,
            minorUnits: minorUnits + BigInt(i),
            reference: `REF${i}`,
          }));
          const total = details
            .map((d) => (Number(d.typeCode) >= 400 ? -d.minorUnits : d.minorUnits))
            .reduce((a, b) => a + b, 0n);
          const { text } = buildFile(details, total, details.length);
          const result = parseBai2(Buffer.from(text, 'latin1'));
          const expectedSign = Number(typeCode) >= 400 ? -1n : 1n;
          for (const record of result.records.filter((r) => !r.isTrailer)) {
            const parsed = record.values['AMOUNT'] as { minorUnits: bigint };
            const written = (record.values['AMOUNT'] as { minorUnits: bigint }).minorUnits * expectedSign;
            expect(written >= 0n).toBe(true);
            expect(parsed.minorUnits * expectedSign).toBeGreaterThanOrEqual(0n);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('T5 - a self-consistent file has no issues', () => {
  it('when the 03 total, account total and group total agree with the details', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(creditCode, amount), { minLength: 1, maxLength: 5 }),
        (rows) => {
          const details: Line[] = rows.map(([typeCode, minorUnits], i) => ({
            typeCode,
            minorUnits,
            reference: `REF-${i}`,
          }));
          const detailSum = details.map((d) => d.minorUnits).reduce((a, b) => a + b, 0n);
          const { text } = buildFile(details, detailSum, details.length);
          const result = parseBai2(Buffer.from(text, 'latin1'));
          expect(result.issues).toEqual([]);
          expect(result.declaredControl?.total?.minorUnits).toBe(detailSum);
          expect(result.computedControl.totalsByCurrency['USD']?.minorUnits).toBe(detailSum);
        },
      ),
      { numRuns: 100 },
    );
  });
});
