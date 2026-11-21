import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compileCopybook } from '../../src/copybook/index.js';
import { parseFile, serializeParseResult } from '../../src/parser/index.js';
import { reconcile, formatAmount } from '../../src/reconcile/index.js';
import { parseBai2 } from '../../src/bai2/index.js';

/**
 * The fixtures are part of the demo, so their defects are asserted here: if a
 * regenerated fixture drifts from `samples/data/DEFECTS.md`, this file fails.
 */

const root = join(import.meta.dirname, '..', '..');
const readText = (p: string) => readFileSync(join(root, p), 'utf8');
const readBuf = (p: string) => readFileSync(join(root, p));

const cob820 = compileCopybook(readText('samples/copybooks/820.cpy'));
const cob823 = compileCopybook(readText('samples/copybooks/823.cpy'));
const cobPacked = compileCopybook(readText('samples/copybooks/820-packed.cpy'));
const cobPackedSource = readText('samples/copybooks/820-packed.cpy');

const WINDOW = { settlementWindow: { start: '2026-11-18', end: '2026-11-20' } };

describe('T0.3 — the fixture set matches its documented defects', () => {
  it('has the expected files and sizes', () => {
    const files = readdirSync(join(root, 'samples/data')).sort();
    expect(files).toEqual([
      '820-bad.txt',
      '820-good.txt',
      '820-packed-good.txt',
      '823-bad.txt',
      '823-bank.txt',
      'DEFECTS.md',
      'bai2-bad.txt',
      'bai2-good.txt',
    ]);
    const sizes = Object.fromEntries(files.map((f) => [f, statSync(join(root, 'samples/data', f)).size]));
    expect(sizes['820-good.txt']).toBe(11 * 100 + 11); // 11 records × 100 bytes + 11 newlines
    expect(sizes['820-bad.txt']).toBe(11 * 100 + 11 - 1); // one record one byte short
    expect(sizes['820-packed-good.txt']).toBe(11 * 88); // no line breaks
    expect(sizes['823-bank.txt']).toBe(11 * 80 + 11);
    expect(sizes['823-bad.txt']).toBe(10 * 80 + 10);
  });

  it('820-good + 823-bank reconcile to PASS', () => {
    const result = reconcile({
      payment: parseFile({ copybook: cob820, source: readBuf('samples/data/820-good.txt') }),
      bank: parseFile({ copybook: cob823, source: readBuf('samples/data/823-bank.txt') }),
      options: WINDOW,
    });
    expect(result.status).toBe('PASS');
    expect(result.findings).toEqual([]);
  });

  it('820-bad produces exactly the four documented defects and nothing else', () => {
    const payment = parseFile({ copybook: cob820, source: readBuf('samples/data/820-bad.txt') });
    const result = reconcile({ payment, bank: parseFile({ copybook: cob823, source: readBuf('samples/data/823-bank.txt') }), options: WINDOW });

    expect(payment.issues.map((i) => `${i.code}@${i.recordIndex}`)).toEqual(['RECORD_LENGTH_MISMATCH@6']);
    expect(result.findings.map((f) => `${f.code}@${f.recordIndex}:${f.reference ?? ''}`)).toEqual([
      'CONTROL_TOTAL_MISMATCH@10:',
      'DATE_OUT_OF_WINDOW@2:',
      'REF_UNMATCHED@9:NWP-2611-0010',
      'REF_UNMATCHED@9:NWP-2611-0011',
    ]);
  });

  it('820-packed-good carries the same payments in a different byte contract', () => {
    const result = reconcile({
      payment: parseFile({ copybook: cobPacked, source: readBuf('samples/data/820-packed-good.txt') }),
      bank: parseFile({ copybook: cob823, source: readBuf('samples/data/823-bank.txt') }),
      options: WINDOW,
    });
    expect(result.status).toBe('PASS');
    // Same meaning, different layout: 88 bytes packed vs 100 bytes display.
    expect(cobPacked.recordLength).toBe(88);
    expect(cob820.recordLength).toBe(100);
    expect(cobPackedSource).toContain('COMP-3');
  });

  it('823-bad declares ten records and loses one', () => {
    const result = reconcile({
      payment: parseFile({ copybook: cob820, source: readBuf('samples/data/820-good.txt') }),
      bank: parseFile({ copybook: cob823, source: readBuf('samples/data/823-bad.txt') }),
      options: WINDOW,
    });
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('CONTROL_COUNT_MISMATCH');
    expect(codes).toContain('CONTROL_TOTAL_MISMATCH');
    expect(codes).toContain('REF_UNMATCHED');
    expect(result.status).toBe('FAIL');
  });

  it('every fixture round-trips byte for byte', () => {
    const pairs: Array<[string, typeof cob820]> = [
      ['samples/data/820-good.txt', cob820],
      ['samples/data/820-bad.txt', cob820],
      ['samples/data/820-packed-good.txt', cobPacked],
      ['samples/data/823-bank.txt', cob823],
      ['samples/data/823-bad.txt', cob823],
    ];
    for (const [path, copybook] of pairs) {
      const source = readBuf(path);
      const result = parseFile({ copybook, source });
      expect(serializeParseResult(result).equals(source)).toBe(true);
    }
    for (const path of ['samples/data/bai2-good.txt', 'samples/data/bai2-bad.txt']) {
      const source = readBuf(path);
      expect(serializeParseResult(parseBai2(source)).equals(source)).toBe(true);
    }
  });

  it('bai2-good is clean and reconciles to PASS against the 820 file', () => {
    const bank = parseBai2(readBuf('samples/data/bai2-good.txt'));
    expect(bank.issues).toEqual([]);
    expect(bank.computedControl.detailCount).toBe(10);
    const result = reconcile({
      payment: parseFile({ copybook: cob820, source: readBuf('samples/data/820-good.txt') }),
      bank,
      options: WINDOW,
    });
    expect(result.status).toBe('PASS');
  });

  it('bai2-bad carries exactly the three documented defects', () => {
    const bank = parseBai2(readBuf('samples/data/bai2-bad.txt'));
    expect(bank.issues.map((i) => `${i.code}:${i.field ?? ''}`)).toEqual(['BAI2_CONTROL_MISMATCH:ACCOUNT-CONTROL-TOTAL']);
    const result = reconcile({
      payment: parseFile({ copybook: cob820, source: readBuf('samples/data/820-good.txt') }),
      bank,
      options: WINDOW,
    });
    expect(result.findings.map((f) => `${f.code}:${f.reference ?? ''}`)).toEqual([
      'CONTROL_TOTAL_MISMATCH:',
      'REF_UNMATCHED:BANK-FEE-2611',
      'REF_UNMATCHED:NWP-2611-0010',
    ]);
    expect(formatAmount((result.findings[0]!.delta as never))).toBe('-79,025.00 USD');
  });
});
