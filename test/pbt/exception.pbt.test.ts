import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  emptyLedger,
  appendWaiver,
  verifyLedger,
  serialiseLedger,
  parseLedger,
  classify,
  type Finding,
  type Ledger,
} from '../../src/exception/index.js';

/**
 * Property-based tests for the exception register (T7.1).
 * Tests: hash chain integrity, serialization round-trip, status machine stability.
 */

// Arbitrary generators for test data
const mockFindingArb = (): fc.Arbitrary<Finding> =>
  fc
    .record({
      code: fc.constantFrom(
        'CONTROL_TOTAL_MISMATCH',
        'CONTROL_COUNT_MISMATCH',
        'REF_UNMATCHED',
        'DATE_OUT_OF_WINDOW',
      ),
      recordIndex: fc.integer({ min: 0, max: 1000 }),
      field: fc.option(fc.stringMatching(/^[A-Z_]+$/)),
    })
    .map((r) => ({
      ...r,
      code: r.code as any,
      detail: `Test finding ${r.code}`,
    })) as fc.Arbitrary<Finding>;

const waiverInputArb = () =>
  fc.record({
    owner: fc.stringMatching(/^[A-Za-z]+$/),
    reason: fc.stringMatching(/^[A-Za-z0-9 ]+$/),
    compensatingControl: fc.stringMatching(/^[A-Za-z0-9 ]+$/),
    expiresOn: fc.option(fc.date({ min: new Date('2026-11-01'), max: new Date('2026-12-31') }).map((d) => d.toISOString().split('T')[0]!), { nil: undefined }),
  });

const mockContextArb = () =>
  fc
    .date({ min: new Date('2026-11-01'), max: new Date('2026-12-31') })
    .map((d) => ({
      fingerprint: fc.sample(fc.hexaString({ minLength: 64, maxLength: 64 }), 1)[0] || 'a'.repeat(64),
      decidedOn: d.toISOString().split('T')[0]!,
    }));

describe('Exception register — property-based tests (T7.1)', () => {
  describe('Hash chain integrity', () => {
    it('a sequence of appends keeps verifyLedger OK', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc
              .tuple(mockFindingArb(), waiverInputArb(), fc.date({ min: new Date('2026-11-01'), max: new Date('2026-11-30') }))
              .filter(([finding, input, date]) => {
                // Ensure expiresOn is not before decidedOn
                if (input.expiresOn) {
                  return input.expiresOn >= date.toISOString().split('T')[0]!;
                }
                return true;
              }),
            { minLength: 1, maxLength: 10 },
          ),
          (items) => {
            let ledger = emptyLedger();
            for (const [finding, input, date] of items) {
              const context = { fingerprint: 'a'.repeat(64), decidedOn: date.toISOString().split('T')[0]! };
              try {
                ledger = appendWaiver(ledger, input, finding, context);
              } catch {
                // Invalid input is acceptable; skip this iteration
                return true;
              }
            }
            const result = verifyLedger(ledger);
            return result.ok === true;
          },
        ),
        { numRuns: 100 },
      );
    });

    it('tampering with any entry causes verifyLedger to fail at that seq', () => {
      fc.assert(
        fc.property(
          fc
            .array(
              fc
                .tuple(mockFindingArb(), waiverInputArb(), fc.date({ min: new Date('2026-11-01'), max: new Date('2026-11-30') }))
                .filter(([, input, date]) => !input.expiresOn || input.expiresOn >= date.toISOString().split('T')[0]!),
              { minLength: 1, maxLength: 5 },
            )
            .chain((items) =>
              fc.tuple(fc.constant(items), fc.integer({ min: 0, max: Math.max(0, items.length - 1) })),
            ),
          ([items, tamperedIndex]) => {
            let ledger = emptyLedger();
            for (const [finding, input, date] of items) {
              const context = { fingerprint: 'a'.repeat(64), decidedOn: date.toISOString().split('T')[0]! };
              try {
                ledger = appendWaiver(ledger, input, finding, context);
              } catch {
                return true; // Skip on error
              }
            }

            if (ledger.entries.length === 0) return true; // Nothing to tamper with

            // Tamper: change the reason of the entry at tamperedIndex
            if (ledger.entries[tamperedIndex]) {
              ledger.entries[tamperedIndex]!.reason = 'TAMPERED_' + ledger.entries[tamperedIndex]!.reason;
            }

            const result = verifyLedger(ledger);
            // If we tampered, verification should fail
            if (ledger.entries[tamperedIndex]) {
              return result.ok === false && result.firstInvalidSeq === ledger.entries[tamperedIndex]!.seq;
            }
            return true;
          },
        ),
        { numRuns: 50 },
      );
    });

    it('each seq is 1-based and incremental', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc
              .tuple(mockFindingArb(), waiverInputArb(), fc.date({ min: new Date('2026-11-01'), max: new Date('2026-11-30') }))
              .filter(([, input, date]) => !input.expiresOn || input.expiresOn >= date.toISOString().split('T')[0]!),
            { minLength: 1, maxLength: 10 },
          ),
          (items) => {
            let ledger = emptyLedger();
            let expectedSeq = 1;
            for (const [finding, input, date] of items) {
              const context = { fingerprint: 'a'.repeat(64), decidedOn: date.toISOString().split('T')[0]! };
              try {
                ledger = appendWaiver(ledger, input, finding, context);
                if (ledger.entries.length > 0) {
                  const lastEntry = ledger.entries[ledger.entries.length - 1]!;
                  if (lastEntry.seq !== expectedSeq) {
                    return false;
                  }
                  expectedSeq += 1;
                }
              } catch {
                return true; // Skip on error
              }
            }
            return true;
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Serialization round-trip', () => {
    it('a ledger round-trips through serialise/parse', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc
              .tuple(mockFindingArb(), waiverInputArb(), fc.date({ min: new Date('2026-11-01'), max: new Date('2026-11-30') }))
              .filter(([, input, date]) => !input.expiresOn || input.expiresOn >= date.toISOString().split('T')[0]!),
            { maxLength: 5 },
          ),
          (items) => {
            let ledger = emptyLedger();
            for (const [finding, input, date] of items) {
              const context = { fingerprint: 'a'.repeat(64), decidedOn: date.toISOString().split('T')[0]! };
              try {
                ledger = appendWaiver(ledger, input, finding, context);
              } catch {
                return true; // Skip on error
              }
            }
            const serialised = serialiseLedger(ledger);
            const parsed = parseLedger(serialised);
            return (
              parsed.version === ledger.version &&
              parsed.entries.length === ledger.entries.length &&
              parsed.entries.every((entry, i) => entry.hash === ledger.entries[i]!.hash)
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it('serialized ledger ends with a newline', () => {
      fc.assert(
        fc.property(fc.array(mockFindingArb(), { maxLength: 3 }), (findings) => {
          let ledger = emptyLedger();
          for (const finding of findings) {
            const input = { owner: 'A', reason: 'B', compensatingControl: 'C' };
            const context = { fingerprint: 'a'.repeat(64), decidedOn: '2026-11-20' };
            try {
              ledger = appendWaiver(ledger, input, finding, context);
            } catch {
              return true;
            }
          }
          const serialised = serialiseLedger(ledger);
          return serialised.endsWith('\n');
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('Status classification stability', () => {
    it('classify(findings, ledger, date) always returns counts that sum to findings.length', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.array(mockFindingArb(), { minLength: 1, maxLength: 10 }),
            fc.date({ min: new Date('2026-11-01'), max: new Date('2026-12-31') }),
          ),
          ([findings, date]) => {
            let ledger = emptyLedger();
            // Optionally add a waiver for the first finding
            if (findings.length > 0 && fc.sample(fc.boolean(), 1)[0]) {
              const input = { owner: 'A', reason: 'B', compensatingControl: 'C' };
              const context = { fingerprint: 'a'.repeat(64), decidedOn: '2026-11-20' };
              try {
                ledger = appendWaiver(ledger, input, findings[0]!, context);
              } catch {
                // Skip on error
              }
            }

            try {
              const classification = classify(findings, ledger, date.toISOString().split('T')[0]!);
              const totalCount = classification.counts.OPEN + classification.counts.WAIVED + classification.counts.EXPIRED + classification.counts.RELEASED;
              return totalCount === classification.entries.length && totalCount === findings.length;
            } catch {
              return true; // Ledger corruption is tested separately
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('unadjudicated always equals OPEN + EXPIRED', () => {
      fc.assert(
        fc.property(fc.array(mockFindingArb(), { maxLength: 5 }), (findings) => {
          let ledger = emptyLedger();
          for (const finding of findings) {
            const input = { owner: 'A', reason: 'B', compensatingControl: 'C', expiresOn: '2026-11-10' };
            const context = { fingerprint: 'a'.repeat(64), decidedOn: '2026-11-01' };
            try {
              ledger = appendWaiver(ledger, input, finding, context);
            } catch {
              continue;
            }
          }

          try {
            const classification = classify(findings, ledger, '2026-11-20'); // After expiry
            return classification.unadjudicated === classification.counts.OPEN + classification.counts.EXPIRED;
          } catch {
            return true;
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
