import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileCopybook, type Copybook } from '../../src/copybook/index.js';
import { encodeRecord, parseFile, type ParsedValue } from '../../src/parser/index.js';
import { reconcile } from '../../src/reconcile/index.js';

/**
 * L2: properties of the reconciliation arithmetic.
 *
 * The point of these tests is that the verdict is arithmetic, not opinion:
 * for any set of amounts and any declared control total, the reported delta is
 * exactly `declared - Σamounts`, and PASS happens only when it is zero.
 */

const root = join(import.meta.dirname, '..', '..');
const cob820: Copybook = compileCopybook(readFileSync(join(root, 'samples/copybooks/820.cpy'), 'utf8'));

const SCALE = 2;

function buildFile(amounts: bigint[], declaredTotal: bigint, declaredCount: number): Buffer {
  const lines: string[] = [];
  amounts.forEach((minorUnits, index) => {
    const values: Record<string, ParsedValue> = {
      'REC-TYPE': 'P',
      'ORIG-ID': 'NWPAY00001',
      'RECEIVER-ID': `PAYEE-${String(index).padStart(4, '0')}`,
      'TXN-TYPE': minorUnits < 0n ? 'D ' : 'C ',
      AMOUNT: { minorUnits, currency: 'USD', scale: SCALE },
      CURRENCY: 'USD',
      'VALUE-DATE': 20261119n,
      REFERENCE: `REF-${String(index).padStart(6, '0')}`,
      'REC-COUNT': 0n,
    };
    lines.push(encodeRecord(cob820, values));
  });
  lines.push(
    encodeRecord(cob820, {
      'REC-TYPE': 'T',
      'ORIG-ID': 'NWPAY00001',
      'RECEIVER-ID': 'BANK-STLMT',
      'TXN-TYPE': 'C ',
      AMOUNT: { minorUnits: declaredTotal, currency: 'USD', scale: SCALE },
      CURRENCY: 'USD',
      'VALUE-DATE': 20261120n,
      REFERENCE: 'CTL-820-TRAILER',
      'REC-COUNT': BigInt(declaredCount),
    }),
  );
  return Buffer.from(`${lines.join('\n')}\n`, 'latin1');
}

const amountsArb = fc.array(fc.bigInt({ min: -999_999_999n, max: 999_999_999n }), { minLength: 1, maxLength: 5 });

describe('T3.1 - the control-total delta is exact for any amounts', () => {
  it('delta = declared - Σamounts, computed in bigint, and PASS only when zero', () => {
    fc.assert(
      fc.property(amountsArb, fc.bigInt({ min: -999_999_999n, max: 999_999_999n }), (amounts, offset) => {
        const sum = amounts.reduce((acc, a) => acc + a, 0n);
        const declared = sum + offset;
        const source = buildFile(amounts, declared, amounts.length);
        const result = reconcile({ payment: parseFile({ copybook: cob820, source }) });

        const total = result.findings.find((f) => f.code === 'CONTROL_TOTAL_MISMATCH');
        if (offset === 0n) {
          expect(total).toBeUndefined();
          expect(result.status).toBe('PASS');
        } else {
          expect(total).toBeDefined();
          expect((total!.delta as { minorUnits: bigint }).minorUnits).toBe(-offset);
          expect((total!.declared as { minorUnits: bigint }).minorUnits).toBe(declared);
          expect((total!.computed as { minorUnits: bigint }).minorUnits).toBe(sum);
          expect(result.status).toBe('FAIL');
        }
      }),
      { numRuns: 250 },
    );
  });

  it('count and sum failures are independent', () => {
    fc.assert(
      fc.property(amountsArb, fc.integer({ min: -3, max: 3 }), (amounts, countOffset) => {
        const sum = amounts.reduce((acc, a) => acc + a, 0n);
        const declaredCount = amounts.length + countOffset;
        if (declaredCount < 0) return;
        const source = buildFile(amounts, sum, declaredCount);
        const result = reconcile({ payment: parseFile({ copybook: cob820, source }) });
        const count = result.findings.find((f) => f.code === 'CONTROL_COUNT_MISMATCH');
        const total = result.findings.find((f) => f.code === 'CONTROL_TOTAL_MISMATCH');
        // The sum always matches here, so a count finding must be the only one.
        expect(total).toBeUndefined();
        if (countOffset === 0) {
          expect(count).toBeUndefined();
          expect(result.status).toBe('PASS');
        } else {
          expect(count).toBeDefined();
          expect(count!.declared).toBe(BigInt(declaredCount));
          expect(count!.computed).toBe(BigInt(amounts.length));
          expect((count!.delta as bigint)).toBe(-BigInt(countOffset));
          expect(result.status).toBe('FAIL');
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe('T3.4 - the verdict fingerprint is a function of the inputs only', () => {
  it('same bytes ⇒ same fingerprint; one cent different ⇒ different fingerprint', () => {
    fc.assert(
      fc.property(amountsArb, (amounts) => {
        const sum = amounts.reduce((acc, a) => acc + a, 0n);
        const source = buildFile(amounts, sum, amounts.length);
        const a = reconcile({ payment: parseFile({ copybook: cob820, source }) });
        const b = reconcile({ payment: parseFile({ copybook: cob820, source }) });
        expect(a.fingerprint).toBe(b.fingerprint);

        const other = buildFile(amounts, sum + 1n, amounts.length);
        const c = reconcile({ payment: parseFile({ copybook: cob820, source: other }) });
        expect(c.fingerprint).not.toBe(a.fingerprint);
      }),
      { numRuns: 150 },
    );
  });
});
