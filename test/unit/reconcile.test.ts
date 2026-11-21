import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileCopybook } from '../../src/copybook/index.js';
import { parseFile, type ParseResult } from '../../src/parser/index.js';
import { formatAmount, reconcile, sortFindings } from '../../src/reconcile/index.js';

const root = join(import.meta.dirname, '..', '..');
const readText = (p: string) => readFileSync(join(root, p), 'utf8');
const readBuf = (p: string) => readFileSync(join(root, p));

const cob820 = compileCopybook(readText('samples/copybooks/820.cpy'));
const cob823 = compileCopybook(readText('samples/copybooks/823.cpy'));
const cobPacked = compileCopybook(readText('samples/copybooks/820-packed.cpy'));

const good820 = readBuf('samples/data/820-good.txt');
const bad820 = readBuf('samples/data/820-bad.txt');
const packed820 = readBuf('samples/data/820-packed-good.txt');
const bank823 = readBuf('samples/data/823-bank.txt');
const bankBad823 = readBuf('samples/data/823-bad.txt');

const WINDOW = { settlementWindow: { start: '2026-11-18', end: '2026-11-20' } };

const parse820 = (source = good820): ParseResult => parseFile({ copybook: cob820, source });
const parse823 = (source = bank823): ParseResult => parseFile({ copybook: cob823, source });

describe('R4.5 — a matching pair passes with a fingerprint', () => {
  it('PASS with zero findings and a stable fingerprint', () => {
    const first = reconcile({ payment: parse820(), bank: parse823(), options: WINDOW });
    const second = reconcile({ payment: parse820(), bank: parse823(), options: WINDOW });
    expect(first.findings).toEqual([]);
    expect(first.status).toBe('PASS');
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.summary).toMatchObject({ paymentRecords: 11, paymentDetails: 10, bankDetails: 10, referencesMatched: 10 });
  });

  it('the same payments in a COMP-3 layout reconcile to PASS against the same bank file', () => {
    const result = reconcile({
      payment: parseFile({ copybook: cobPacked, source: packed820 }),
      bank: parse823(),
      options: WINDOW,
    });
    expect(result.findings).toEqual([]);
    expect(result.status).toBe('PASS');
  });
});

describe('R4.1 — control total compare, per currency, with a signed bigint delta', () => {
  it('reports the −100.00 delta planted in 820-bad.txt', () => {
    const result = reconcile({ payment: parse820(bad820), options: WINDOW });
    const finding = result.findings.find((f) => f.code === 'CONTROL_TOTAL_MISMATCH')!;
    expect(finding).toBeDefined();
    expect(finding.recordIndex).toBe(10);
    expect(finding.field).toBe('AMOUNT');
    const delta = finding.delta as { minorUnits: bigint; currency: string; scale: number };
    expect(delta.minorUnits).toBe(-10_000n);
    expect(delta.currency).toBe('USD');
    expect(formatAmount(delta)).toBe('-100.00 USD');
    expect(finding.detail).toContain('1,284,550.00');
    expect(finding.detail).toContain('1,284,450.00');
  });

  it('keeps currencies apart instead of summing them into nonsense', () => {
    const payment = parse820(bad820);
    const eur = payment.records[0]!;
    // Re-encode record 0 as EUR by hand so the file carries two currencies.
    const raw = eur.raw.replace(/USD/, 'EUR');
    const mixed = Buffer.from(
      payment.records.map((r) => (r.index === 0 ? raw : r.raw)).join('\n') + '\n',
      'latin1',
    );
    const result = reconcile({ payment: parseFile({ copybook: cob820, source: mixed }), options: WINDOW });
    const total = result.findings.find((f) => f.code === 'CONTROL_TOTAL_MISMATCH')!;
    expect(total).toBeDefined();
    // declared 1,284,550.00 USD vs the USD bucket only: the EUR record is not summed into it.
    expect((total.delta as { minorUnits: bigint }).minorUnits).toBe(-15_010_000n);
    expect((total.declared as { currency: string }).currency).toBe('USD');
  });

  it('a negative delta is expressed with a sign, not as an absolute difference', () => {
    const result = reconcile({ payment: parse820(bad820), options: WINDOW });
    const total = result.findings.find((f) => f.code === 'CONTROL_TOTAL_MISMATCH')!;
    expect((total.delta as { minorUnits: bigint }).minorUnits < 0n).toBe(true);
  });
});

describe('R4.2 — control count compare is separate from the total', () => {
  it('reports the bank trailer declaring 10 while only 9 detail records arrived', () => {
    const result = reconcile({ payment: parse820(), bank: parse823(bankBad823), options: WINDOW });
    const count = result.findings.find((f) => f.code === 'CONTROL_COUNT_MISMATCH')!;
    expect(count).toBeDefined();
    expect(count.declared).toBe(10n);
    expect(count.computed).toBe(9n);
    const total = result.findings.find((f) => f.code === 'CONTROL_TOTAL_MISMATCH')!;
    expect((total!.delta as { minorUnits: bigint }).minorUnits).toBe(-4_500_000n);
  });

  it('a matching total with a wrong count is still a failure', () => {
    // Same bytes, but the trailer's count field is wrong by one: sum is right, count is not.
    const lines = bank823.toString('latin1').split('\n').filter(Boolean);
    const trailer = lines.at(-1)!;
    // REC-COUNT is bytes 62-67 of the 80-byte bank record.
    lines[lines.length - 1] = `${trailer.slice(0, 61)}000011${trailer.slice(67)}`;
    const result = reconcile({ payment: parse820(), bank: parse823(Buffer.from(`${lines.join('\n')}\n`, 'latin1')), options: WINDOW });
    expect(result.findings.map((f) => f.code)).toContain('CONTROL_COUNT_MISMATCH');
    expect(result.findings.map((f) => f.code)).not.toContain('CONTROL_TOTAL_MISMATCH');
  });
});

describe('R4.3 — reference matching; unmatched is reported in both directions', () => {
  it('reports the 820-only and bank-only references from the planted reference break', () => {
    const result = reconcile({ payment: parse820(bad820), bank: parse823(), options: WINDOW });
    const refs = result.findings.filter((f) => f.code === 'REF_UNMATCHED');
    expect(refs).toHaveLength(2);
    const detail = refs.map((r) => r.detail).join('\n');
    expect(detail).toContain('820-only');
    expect(detail).toContain('bank-only');
    expect(refs.map((r) => r.reference).sort()).toEqual(['NWP-2611-0010', 'NWP-2611-0011']);
  });

  it('falls back to amount+currency+date before calling a reference unmatched', () => {    // Change only the 820 reference text; the amount/currency/date still line up.
    const source = Buffer.from(good820.toString('latin1').replace('NWP-2611-0001', 'NWP-2611-9001'), 'latin1');
    const result = reconcile({ payment: parse820(source), bank: parse823(), options: WINDOW });
    expect(result.findings.filter((f) => f.code === 'REF_UNMATCHED')).toEqual([]);
    expect(result.status).toBe('PASS');
  });

  it('reports a blank reference instead of letting two blanks agree', () => {
    // Reviewer finding (2026-11-21): a blank reference used to be skipped silently.
    const source = good820.toString('latin1').replace('NWP-2611-0001', '               ');
    const result = reconcile({ payment: parse820(Buffer.from(source, 'latin1')), bank: parse823(), options: WINDOW });
    const blank = result.findings.find((f) => f.code === 'REF_UNMATCHED' && f.reference === '');
    expect(blank).toBeDefined();
    expect(blank!.recordIndex).toBe(0);
    expect(blank!.detail).toContain('blank reference');
    // The bank side of that record is still reported: nothing is dropped.
    expect(result.findings.some((f) => f.reference === 'NWP-2611-0001')).toBe(true);
  });

  it('counts matched references directly, not by reading the finding text', () => {
    const good = reconcile({ payment: parse820(), bank: parse823(), options: WINDOW });
    expect(good.summary.referencesMatched).toBe(10);
    expect(good.summary.referencesUnmatched).toBe(0);

    const bad = reconcile({ payment: parse820(bad820), bank: parse823(), options: WINDOW });
    expect(bad.summary.referencesMatched).toBe(9);
    expect(bad.summary.referencesUnmatched).toBe(2);
  });

  it('does not match a reference whose amount differs', () => {    const source = Buffer.from(good820.toString('latin1').replace('NWP-2611-0001', 'NWP-2611-9001'), 'latin1')
      .toString('latin1')
      .replace('000001500000{', '000001500001{');
    const result = reconcile({ payment: parse820(Buffer.from(source, 'latin1')), bank: parse823(), options: WINDOW });
    const refs = result.findings.filter((f) => f.code === 'REF_UNMATCHED');
    expect(refs.map((r) => r.reference).sort()).toEqual(['NWP-2611-0001', 'NWP-2611-9001']);
  });
});

describe('R4.4 — settlement window with configured tolerance', () => {
  it('reports the record dated 2026-11-14 as outside 2026-11-18..2026-11-20', () => {
    const result = reconcile({ payment: parse820(bad820), options: WINDOW });
    const date = result.findings.find((f) => f.code === 'DATE_OUT_OF_WINDOW')!;
    expect(date).toBeDefined();
    expect(date.recordIndex).toBe(2);
    expect(date.computed).toBe('2026-11-14');
    expect(date.declared).toBe('2026-11-18..2026-11-20');
  });

  it('a configured tolerance of 4 days accepts the same record', () => {
    const result = reconcile({
      payment: parse820(bad820),
      options: { settlementWindow: WINDOW.settlementWindow, toleranceDays: 4 },
    });
    expect(result.findings.filter((f) => f.code === 'DATE_OUT_OF_WINDOW')).toEqual([]);
  });

  it('without a window the date check stays silent rather than inventing one', () => {
    const result = reconcile({ payment: parse820(bad820) });
    expect(result.findings.filter((f) => f.code === 'DATE_OUT_OF_WINDOW')).toEqual([]);
  });
});

describe('finding order and fingerprint normalisation', () => {
  it('sorts findings deterministically and the fingerprint follows the findings', () => {
    const a = reconcile({ payment: parse820(bad820), bank: parse823(), options: WINDOW });
    const b = reconcile({ payment: parse820(bad820), bank: parse823(), options: WINDOW });
    expect(sortFindings(a.findings)).toEqual(a.findings);
    expect(a.fingerprint).toBe(b.fingerprint);
    // A different window changes the findings and therefore the fingerprint.
    const c = reconcile({
      payment: parse820(bad820),
      bank: parse823(),
      options: { settlementWindow: { start: '2026-11-01', end: '2026-11-30' } },
    });
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });

  it('summarises the planted defects of 820-bad exactly', () => {
    const result = reconcile({ payment: parse820(bad820), bank: parse823(), options: WINDOW });
    expect(result.status).toBe('FAIL');
    const codes = result.findings.map((f) => f.code).sort();
    expect(codes).toEqual([
      'CONTROL_TOTAL_MISMATCH',
      'DATE_OUT_OF_WINDOW',
      'REF_UNMATCHED',
      'REF_UNMATCHED',
    ]);
    expect(result.summary.totals['USD']).toEqual({
      declared: '128455000',
      computed: '128445000',
      delta: '-10000',
      basis: 'signed detail total',
      credits: '128445000',
    });
  });
});

describe('formatAmount — exact bigint rendering', () => {
  it.each([
    [{ minorUnits: 128_455_000n, currency: 'USD', scale: 2 }, '1,284,550.00 USD'],
    [{ minorUnits: -10_000n, currency: 'USD', scale: 2 }, '-100.00 USD'],
    [{ minorUnits: 0n, currency: 'USD', scale: 2 }, '0.00 USD'],
    [{ minorUnits: 1234n, currency: 'KRW', scale: 0 }, '1,234 KRW'],
  ])('renders %o as %s', (amount, expected) => {
    expect(formatAmount(amount)).toBe(expected);
  });
});
