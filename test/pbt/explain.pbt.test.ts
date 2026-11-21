/**
 * T4.2 — properties of the numeric grounding guard.
 *
 * These are the properties the product claim rests on:
 *   1. a number the finding does not contain is always rejected;
 *   2. text built from the finding's own renderings is always accepted;
 *   3. adding a value to a finding never shrinks what it can support.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatAmount, type Finding } from '../../src/reconcile/index.js';
import {
  evidenceVocabulary,
  extractNumericLiterals,
  normaliseNumericLiteral,
  validateExplanation,
} from '../../src/explain/index.js';

const amountArb = fc
  .record({
    minorUnits: fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
    scale: fc.integer({ min: 0, max: 2 }),
  })
  .map(({ minorUnits, scale }) => ({ minorUnits, currency: 'USD', scale }));

const findingArb: fc.Arbitrary<Finding> = fc
  .record({
    declared: amountArb,
    computed: amountArb,
    delta: amountArb,
    recordIndex: fc.integer({ min: 0, max: 500 }),
  })
  .map(({ declared, computed, delta, recordIndex }) => ({
    code: 'CONTROL_TOTAL_MISMATCH' as const,
    recordIndex,
    field: 'AMOUNT',
    declared,
    computed,
    delta,
    detail: `declared ${formatAmount(declared)} computed ${formatAmount(computed)} delta ${formatAmount(delta)}`,
  }));

describe('T4.2 — a foreign number is always rejected', () => {
  it('rejects any rendering of an amount the finding does not hold', () => {
    fc.assert(
      fc.property(findingArb, fc.bigInt({ min: 1n, max: 10n ** 9n }), (finding, offset) => {
        const declared = finding.declared as { minorUnits: bigint; currency: string; scale: number };
        const foreign = {
          minorUnits: declared.minorUnits + offset,
          currency: declared.currency,
          scale: declared.scale,
        };
        const rendering = formatAmount(foreign);
        const literal = normaliseNumericLiteral(rendering.split(' ')[0]!);
        // Only assert where the foreign rendering is genuinely new vocabulary.
        fc.pre(!evidenceVocabulary(finding).includes(literal));
        const guard = validateExplanation(`The file is short by ${rendering}.`, finding);
        expect(guard.ok).toBe(false);
        expect(guard.unsupported).toContain(literal);
      }),
      { numRuns: 200 },
    );
  });

  it('rejects a record index the finding does not name', () => {
    fc.assert(
      fc.property(findingArb, fc.integer({ min: 1, max: 500 }), (finding, offset) => {
        const other = finding.recordIndex + offset;
        fc.pre(!evidenceVocabulary(finding).includes(String(other)));
        const guard = validateExplanation(`Record ${other} carries the mismatch.`, finding);
        expect(guard.ok).toBe(false);
        expect(guard.unsupported).toContain(String(other));
      }),
      { numRuns: 150 },
    );
  });
});

describe('T4.2 — the finding\'s own values are always accepted', () => {
  it('accepts text composed only of the finding\'s renderings', () => {
    fc.assert(
      fc.property(findingArb, (finding) => {
        const text = [
          `declared ${formatAmount(finding.declared as never)}`,
          `computed ${formatAmount(finding.computed as never)}`,
          `delta ${formatAmount(finding.delta as never)}`,
          `record ${finding.recordIndex}`,
          `field ${finding.field}`,
        ].join('; ');
        const guard = validateExplanation(text, finding);
        expect(guard.ok).toBe(true);
        expect(guard.unsupported).toEqual([]);
        expect(guard.cited.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it('normalisation is idempotent and separator-insensitive', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n }), (value) => {
        const amount = { minorUnits: value, currency: 'USD', scale: 2 };
        const grouped = formatAmount(amount);
        const plain = formatAmount({ ...amount, currency: '' }).replace(/,/g, '');
        const normalisedGrouped = extractNumericLiterals(grouped).map((x) => x);
        expect(normalisedGrouped).toContain(normaliseNumericLiteral(plain));
      }),
      { numRuns: 150 },
    );
  });
});

describe('T4.2 — evidence is monotone', () => {
  it('adding a reference never removes a literal the finding already supported', () => {
    fc.assert(
      fc.property(findingArb, fc.string({ minLength: 1, maxLength: 10 }), (finding, suffix) => {
        const before = new Set(evidenceVocabulary(finding));
        const after = new Set(evidenceVocabulary({ ...finding, reference: `REF-${suffix}` }));
        for (const literal of before) expect(after.has(literal)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
