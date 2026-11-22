/**
 * Regression — the red-team pass of 2026-11-22, code side.
 *
 * Three defects were reproduced in `gcp-hermes-grand-prize-review-v2.md` §4 and are pinned here:
 *
 *   8. a control total declared in a currency the file holds no detail for was compared against
 *      whichever bucket came first (`Object.keys(buckets)[0]`), so the file could earn a PASS by
 *      comparing USD against EUR. It is now `MISSING_CURRENCY`, and nothing is compared.
 *   7. the explanation guard normalised the reference fragment `0011` to `11`, so "Record 11 was
 *      never sent" passed on a finding whose record index was 9. A reference is an identifier:
 *      `0011` is not eleven.
 *   1. a waiver could be recorded without an expiry date (`(no expiry)`), while the submission
 *      text and `docs/guarantees.md` promised it could not. The module, the CLI and the browser
 *      register now refuse it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileCopybook } from '../../src/copybook/index.js';
import { parseFile } from '../../src/parser/index.js';
import { reconcile, type Finding } from '../../src/reconcile/index.js';
import { validateExplanation } from '../../src/explain/index.js';
import { appendWaiver, emptyLedger, LedgerError } from '../../src/exception/index.js';

const root = join(import.meta.dirname, '..', '..');
const readText = (path: string) => readFileSync(join(root, path), 'utf8');
const readBytes = (path: string) => readFileSync(join(root, path), 'latin1');

const copybook = compileCopybook(readText('samples/copybooks/820.cpy'));
const WINDOW = { settlementWindow: { start: '2026-11-18', end: '2026-11-20' } };

/** CURRENCY is a 3-byte field at offset 36 in the 820 fixture record. */
const CURRENCY_AT = 36;

function withCurrencies(perRecord: (index: number, record: string) => string): string {
  const text = readBytes('samples/data/820-good.txt');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const records = text.split(eol).filter((line) => line.length > 0);
  return records.map((record, index) => `${record.slice(0, CURRENCY_AT)}${perRecord(index, record)}${record.slice(CURRENCY_AT + 3)}`).join(eol) + eol;
}

function parse(source: string) {
  return parseFile({ copybook, source: Buffer.from(source, 'latin1'), filename: 'currency-case.txt' });
}

describe('a declared total is never compared against another currency bucket', () => {
  it('reports MISSING_CURRENCY instead of the PASS the old bucket fallback produced', () => {
    // The fixture is unchanged except for one field: the details are denominated in EUR while the
    // trailer still declares its total in USD, and the minor units still add up to that total.
    // The removed code compared the USD declaration against the EUR bucket and returned PASS.
    const source = withCurrencies((index, record) => (record.startsWith('P') ? 'EUR' : 'USD'));
    const result = reconcile({ payment: parse(source), options: WINDOW });

    const codes = result.findings.map((finding) => finding.code);
    expect(codes).toContain('MISSING_CURRENCY');
    expect(codes).not.toContain('CONTROL_TOTAL_MISMATCH');
    expect(result.status).toBe('FAIL');

    const finding = result.findings.find((candidate) => candidate.code === 'MISSING_CURRENCY')!;
    expect(finding.recordIndex).toBe(10); // the trailer, which carries the declaration
    expect(finding.field).toBe('AMOUNT');
    expect(finding.detail).toContain('no detail record is denominated in USD');
    expect(finding.detail).toContain('not compared against another currency');
    // The summary row says the declared total was left alone rather than borrowing EUR.
    const row = result.summary.totals.USD!;
    expect(row.declared).toBe('128455000');
    expect(row.computed).toBe('-');
    expect(row.basis).toContain('not compared');
  });

  it('refuses to pick a bucket when the declaration has no currency and the details hold two', () => {
    const source = withCurrencies((index, record) => {
      if (!record.startsWith('P')) return '   ';
      return index % 2 === 0 ? 'EUR' : 'GBP';
    });
    const result = reconcile({ payment: parse(source), options: WINDOW });
    const finding = result.findings.find((candidate) => candidate.code === 'MISSING_CURRENCY')!;
    expect(finding).toBeDefined();
    expect(finding.detail).toContain('more than one currency');
    expect(finding.detail).toContain('EUR, GBP');
  });

  it('still compares a single-currency file whose total declares no currency', () => {
    // Not over-refusing: with exactly one bucket there is only one reading, so the comparison stands.
    // The run still does not earn a PASS, for a different and older reason: a declaration with an
    // empty currency leaves the copybook's 2-digit scale unverifiable (`CURRENCY_SCALE_MISMATCH`).
    const source = withCurrencies((index, record) => (record.startsWith('P') ? 'USD' : '   '));
    const parsed = parse(source);
    const result = reconcile({ payment: parsed, options: WINDOW });
    expect(result.findings).toEqual([]);
    expect(parsed.issues.map((issue) => issue.code)).toEqual(['CURRENCY_SCALE_MISMATCH']);
    expect(result.status).toBe('INCOMPLETE');
    expect(result.summary.totals.USD!.basis).toBe('signed detail total');
  });
});

describe('the explanation guard treats a reference fragment as an identifier', () => {
  const finding: Finding = {
    code: 'REF_UNMATCHED',
    recordIndex: 9,
    field: 'REFERENCE',
    reference: 'NWP-2611-0011',
    detail: '820 reference NWP-2611-0011 has no counterpart in the bank file (direction: 820-only)',
  };

  it('rejects "Record 11 was never sent" on a finding anchored to record 9', () => {
    const guard = validateExplanation('Record 11 was never sent', finding);
    expect(guard.ok).toBe(false);
    expect(guard.unsupported).toContain('11');
  });

  it('accepts the reference itself and the real record index in the same sentence', () => {
    const guard = validateExplanation('Reference NWP-2611-0011 on record 9 has no counterpart on the bank side.', finding);
    expect(guard.ok).toBe(true);
    expect(guard.unsupported).toEqual([]);
  });

  it('keeps the residual limit visible: the guard checks numbers, not the sentence around them', () => {
    // "Record 0011" cites a token the reference really contains, so it is allowed. The guard cannot
    // read the word "Record", and pretending otherwise would be a claim the code does not make.
    const guard = validateExplanation('Record 0011 was never sent', finding);
    expect(guard.ok).toBe(true);
    expect(guard.cited).toContain('11'); // the identifier `0011` was accepted, reported as its value
  });
});

describe('a waiver cannot be recorded without an expiry date', () => {
  const finding: Finding = { code: 'CONTROL_TOTAL_MISMATCH', recordIndex: 5, field: 'AMOUNT', detail: 'mock' };
  const context = { fingerprint: 'a'.repeat(64), decidedOn: '2026-11-22' };

  it('refuses the object the CLI used to build when --expires was omitted', () => {
    const input = { owner: 'S. Shin (TPM)', reason: 'Approved against the corrected statement', compensatingControl: 'Daily suspense-account check' } as unknown as Parameters<typeof appendWaiver>[1];
    expect(() => appendWaiver(emptyLedger(), input, finding, context)).toThrow(LedgerError);
    expect(() => appendWaiver(emptyLedger(), input, finding, context)).toThrow(/expiresOn is required/);
  });

  it('refuses an expiry that is not a real date', () => {
    const input = { owner: 'S. Shin (TPM)', reason: 'Approved', compensatingControl: 'Control', expiresOn: '2026-13-40' };
    expect(() => appendWaiver(emptyLedger(), input, finding, context)).toThrow(/real date/);
  });

  it('accepts a complete waiver and stores the expiry in the hashed entry', () => {
    const ledger = appendWaiver(
      emptyLedger(),
      { owner: 'S. Shin (TPM)', reason: 'Approved', compensatingControl: 'Daily suspense-account check', expiresOn: '2026-12-05' },
      finding,
      context,
    );
    expect(ledger.entries[0]!.expiresOn).toBe('2026-12-05');
  });
});
