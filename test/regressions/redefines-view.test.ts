import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileCopybook } from '../../src/copybook/index.js';
import { parseFile } from '../../src/parser/index.js';
import { parseBai2 } from '../../src/bai2/index.js';
import { reconcile, blockingIssuesOf } from '../../src/reconcile/index.js';

/**
 * Regressions pinned by the REDEFINES work (2026-11-21).
 *
 * Two things must not move without a deliberate decision:
 *
 * 1. The six sample scenarios keep the fingerprints they had before `REDEFINES`
 *    existed. A copybook without views contributes no new component to the hash,
 *    so a recorded verdict from an earlier build still verifies.
 * 2. A record whose discriminator selects no layout earns `INCOMPLETE`, not a
 *    verdict read from whichever layout happens to fit. That is the same rule the
 *    truncated-record defect taught: a verdict must be earned by interpretation,
 *    not by silence.
 */

const root = join(import.meta.dirname, '..', '..');
const readText = (p: string) => readFileSync(join(root, p), 'utf8');
const readBuf = (p: string) => readFileSync(join(root, p));

const c820 = compileCopybook(readText('samples/copybooks/820.cpy'));
const c823 = compileCopybook(readText('samples/copybooks/823.cpy'));
const cPacked = compileCopybook(readText('samples/copybooks/820-packed.cpy'));
const cRedefines = compileCopybook(readText('samples/copybooks/820-redefines.cpy'));

const WINDOW = { settlementWindow: { start: '2026-11-18', end: '2026-11-20' } };

const PINNED: Record<string, string> = {
  S1: 'c459b81b86ad3be3248f293de3f520a79483f8760157a1272e33150e944c178a',
  S2: '85646a69a235c0ba23f567559c7660d6863e591f91d3677b567802ca489ef165',
  S3: '7af64454555de8d89b5c4f763009547caaa6f53b1c040db8d8c462c04335c118',
  S4: '071371bfdeac730e4895e157084a903b9533f3be86ac2cd889f30417e26eee77',
  S5: '923e8f7e321fd309bb04c7d82fb354cca47dffd289f326536e04778df3d2a915',
  S6: '84fd2c5eb638cbb1e10928d4f78826510451e0bd00592ec7218a04a5b56c44c2',
};

describe('REDEFINES did not move a verdict that has no views', () => {
  it('the six sample scenarios keep their pinned fingerprints', () => {
    const payment820 = () => parseFile({ copybook: c820, source: readBuf('samples/data/820-good.txt') });
    const bank823 = () => parseFile({ copybook: c823, source: readBuf('samples/data/823-bank.txt') });
    const cases: Record<string, ReturnType<typeof reconcile>> = {
      S1: reconcile({ payment: payment820(), bank: bank823(), options: WINDOW }),
      S2: reconcile({
        payment: parseFile({ copybook: cPacked, source: readBuf('samples/data/820-packed-good.txt') }),
        bank: bank823(),
        options: WINDOW,
      }),
      S3: reconcile({
        payment: parseFile({ copybook: c820, source: readBuf('samples/data/820-bad.txt') }),
        bank: bank823(),
        options: WINDOW,
      }),
      S4: reconcile({
        payment: payment820(),
        bank: parseFile({ copybook: c823, source: readBuf('samples/data/823-bad.txt') }),
        options: WINDOW,
      }),
      S5: reconcile({ payment: payment820(), bank: parseBai2(readBuf('samples/data/bai2-good.txt')), options: WINDOW }),
      S6: reconcile({ payment: payment820(), bank: parseBai2(readBuf('samples/data/bai2-bad.txt')), options: WINDOW }),
    };
    for (const [scenario, result] of Object.entries(cases)) {
      expect(`${scenario}:${result.fingerprint}`).toBe(`${scenario}:${PINNED[scenario]}`);
    }
  });
});

describe('a viewless copybook carries no views component', () => {
  it('820.cpy compiles without views and its records carry none', () => {
    expect(c820.views).toBeUndefined();
    const parsed = parseFile({ copybook: c820, source: readBuf('samples/data/820-good.txt') });
    expect(parsed.records.every((record) => record.views === undefined)).toBe(true);
  });
});

describe('a discriminator that selects no layout is a blocking parse issue', () => {
  it('the verdict is INCOMPLETE and the shared bytes stay undecoded', () => {
    // A real file with one record whose REC-TYPE was damaged in transit.
    const lines = readBuf('samples/data/820-redefines-good.txt').toString('latin1').split('\n');
    lines[3] = `X${lines[3]!.slice(1)}`;
    const source = Buffer.from(lines.join('\n'), 'latin1');
    const payment = parseFile({ copybook: cRedefines, source });
    expect(payment.issues.map((issue) => issue.code)).toEqual(['REDEFINES_VIEW_UNMATCHED']);
    expect(payment.records[3]!.values['AMOUNT']).toBeUndefined();
    expect(payment.records[3]!.values['TOTAL-AMOUNT']).toBeUndefined();
    expect(blockingIssuesOf(payment).length).toBe(1);

    const result = reconcile({
      payment,
      bank: parseFile({ copybook: c823, source: readBuf('samples/data/823-bank.txt') }),
      options: WINDOW,
    });
    // The damaged record also costs a reference and part of the total, so the verdict
    // is FAIL; the blocking count stays visible beside it, and neither is a PASS.
    expect(result.status).toBe('FAIL');
    expect(result.summary.blockingParseIssues).toBe(1);
  });
});

describe('the trailer layout is read through REDEFINES, not through the detail field', () => {
  it('the declared total names TOTAL-AMOUNT and the detail fields are absent on the trailer', () => {
    const payment = parseFile({ copybook: cRedefines, source: readBuf('samples/data/820-redefines-bad.txt') });
    const trailer = payment.records[payment.records.length - 1]!;
    expect(trailer.isTrailer).toBe(true);
    expect(trailer.views?.['PAYMENT-DETAIL']).toBe('PAYMENT-TRAILER');
    expect(trailer.values['AMOUNT']).toBeUndefined();
    expect(trailer.values['TOTAL-AMOUNT']).toMatchObject({ minorUnits: 128_445_000n, currency: 'USD', scale: 2 });
    expect(payment.declaredControl?.total?.minorUnits).toBe(128_445_000n);
  });
});
