/**
 * T5: the BAI2 reader.
 *
 * BAI2 is the reason T0.3 refused to fake a comma-delimited format as a copybook.
 * These tests pin the two things a disguise would have lost: the reader's own
 * record nesting/control checks, and the "type code decides direction" rule.
 */
import { describe, expect, it } from 'vitest';
import { bytesEqual } from '../../src/core/bytes.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileCopybook } from '../../src/copybook/index.js';
import { parseFile, serializeParseResult } from '../../src/parser/index.js';
import { bai2Spec, decodeBai2Amount, directionOfTypeCode, parseBai2, splitRecordFields } from '../../src/bai2/index.js';
import { formatAmount, reconcile } from '../../src/reconcile/index.js';

const root = join(import.meta.dirname, '..', '..');
const readText = (p: string) => readFileSync(join(root, p), 'utf8');
const readBuf = (p: string) => readFileSync(join(root, p));

const cob820 = compileCopybook(readText('samples/copybooks/820.cpy'));
const WINDOW = { settlementWindow: { start: '2026-11-18', end: '2026-11-20' } };

const good = () => parseBai2(readBuf('samples/data/bai2-good.txt'));
const bad = () => parseBai2(readBuf('samples/data/bai2-bad.txt'));
const payment820 = () => parseFile({ copybook: cob820, source: readBuf('samples/data/820-good.txt') });

describe('T5.1 - the reader is a BAI2 reader, not a copybook in disguise', () => {
  it('declares itself as a delimiter format with no fixed width', () => {
    const result = good();
    expect(result.copybook.format).toBe('bai2');
    expect(result.copybook.framing).toBe('line');
    expect(result.copybook.recordLength).toBe(0);
    expect(result.copybook.fields).toEqual([]);
    expect(result.copybook.notes.join(' ')).toContain('comma-delimited');
  });

  it('exposes real per-record field offsets, including a text field containing commas', () => {
    const line = '16,165,1500000,Z,BANKREF,CUSTREF,PAYMENT, WITH, COMMAS';
    const result = parseBai2(Buffer.from(`01,A,B,261121,0900,ID,,,2\n02,B,A,1,261120,0900,USD\n03,ACC,USD,100,0,0,Z\n${line}\n49,0,3/\n98,0,1,5/\n99,0,1,7/\n`, 'latin1'));
    const record = result.records[3]!;
    const span = record.spans!['CUSTOMER-REFERENCE']!;
    expect(record.raw.slice(span.start - 1, span.start - 1 + span.length)).toBe('CUSTREF');
    expect(record.values['TEXT']).toBe('PAYMENT, WITH, COMMAS');
    const textSpan = record.spans!['TEXT']!;
    expect(record.raw.slice(textSpan.start - 1)).toBe('PAYMENT, WITH, COMMAS');
  });

  it('splitRecordFields strips the trailing / terminator and keeps offsets', () => {
    const fields = splitRecordFields('98,256910000,1,14/');
    expect(fields.map((f) => f.text)).toEqual(['98', '256910000', '1', '14']);
    expect(fields[1]).toMatchObject({ start: 4, length: 9 });
  });
});

describe('T5.1 - amounts and direction', () => {
  it('reads a 15-digit BAI2 amount as minor units with the currency scale', () => {
    expect(decodeBai2Amount('1500000', 2).minorUnits).toBe(1_500_000n);
    expect(decodeBai2Amount('1000}', 2).minorUnits).toBe(-1_000n);
    expect(decodeBai2Amount('-1000', 0).minorUnits).toBe(-1_000n);
    expect(() => decodeBai2Amount('12X', 2)).toThrow(/not a BAI2 amount/);
  });

  it('maps type-code ranges to credit and debit', () => {
    expect(directionOfTypeCode('165')).toBe('credit');
    expect(directionOfTypeCode('100')).toBe('credit');
    expect(directionOfTypeCode('399')).toBe('credit');
    expect(directionOfTypeCode('409')).toBe('debit');
    expect(directionOfTypeCode('699')).toBe('debit');
    expect(directionOfTypeCode('999')).toBe('unknown');
    expect(directionOfTypeCode('16')).toBe('unknown');
  });

  it('signs a debit detail negative even though the field itself is unsigned', () => {
    const result = bad();
    const fee = result.records.find((r) => r.values['CUSTOMER-REFERENCE'] === 'BANK-FEE-2611')!;
    const amount = fee.values['AMOUNT'] as { minorUnits: bigint; currency: string; scale: number };
    expect(amount.minorUnits).toBe(-2_500n);
    expect(formatAmount(amount)).toBe('-25.00 USD');
  });

  it('reports a type code outside both ranges instead of guessing a direction', () => {
    const result = parseBai2(
      Buffer.from('01,A,B,261121,0900,ID,,,2\n02,B,A,1,261120,0900,USD\n03,ACC,USD,100,100,1,Z\n16,999,1000,Z,R,R,TEXT\n49,1100,3/\n98,1100,1,5/\n99,1100,1,7/\n', 'latin1'),
    );
    const issue = result.issues.find((i) => i.code === 'BAI2_RECORD_INVALID');
    expect(issue?.detail).toContain('999');
    const detail = result.records[3]!;
    expect((detail.values['AMOUNT'] as { minorUnits: bigint }).minorUnits).toBe(1_000n);
  });
});

describe('T5.1 - the reader checks the bank file against itself', () => {
  it('a clean statement produces no issues and a declared credit total', () => {
    const result = good();
    expect(result.issues).toEqual([]);
    expect(result.computedControl.detailCount).toBe(10);
    expect(result.declaredControl?.total).toMatchObject({ minorUnits: 128_455_000n, currency: 'USD', scale: 2 });
    expect(result.declaredControl?.recordIndex).toBe(2);
  });

  it('round-trips byte for byte under LF and CRLF', () => {
    const lf = good();
    expect(bytesEqual(serializeParseResult(lf), lf.source)).toBe(true);
    const crlfSource = Buffer.from(readText('samples/data/bai2-good.txt').replace(/\n/g, '\r\n'), 'latin1');
    const crlf = parseBai2(crlfSource);
    expect(crlf.eol).toBe('\r\n');
    expect(bytesEqual(serializeParseResult(crlf), crlfSource)).toBe(true);
    expect(crlf.records.map((r) => r.raw)).toEqual(lf.records.map((r) => r.raw));
    expect(crlf.issues).toEqual(lf.issues);
  });

  it('flags an account control total that no longer matches its records', () => {
    const source = readText('samples/data/bai2-good.txt').replace('49,256910000,', '49,256900000,');
    const result = parseBai2(Buffer.from(source, 'latin1'));
    const issue = result.issues.find((i) => i.field === 'ACCOUNT-CONTROL-TOTAL');
    expect(issue?.code).toBe('BAI2_CONTROL_MISMATCH');
    expect(issue?.declared).toBe('256900000');
  });

  it('flags a wrong record count in the account, group and file trailers', () => {
    const source = readText('samples/data/bai2-good.txt')
      .replace('49,256910000,12/', '49,256910000,11/')
      .replace('98,256910000,1,14/', '98,256910000,1,13/')
      .replace('99,256910000,1,16/', '99,256910000,1,15/');
    const result = parseBai2(Buffer.from(source, 'latin1'));
    const counts = result.issues.filter((i) => i.field === 'NUMBER-OF-RECORDS');
    expect(counts).toHaveLength(3);
    expect(counts.every((i) => i.code === 'BAI2_CONTROL_MISMATCH')).toBe(true);
  });

  it('flags a detail record outside an account block and a file that ends inside a group', () => {
    const withoutGroupTrailer = readText('samples/data/bai2-good.txt').trimEnd().split('\n').slice(0, -1).join('\n');
    const result = parseBai2(Buffer.from(`${withoutGroupTrailer}\n`, 'latin1'));
    expect(result.issues.some((i) => i.code === 'BAI2_STRUCTURE' && /no trailer record|open group/.test(i.detail))).toBe(true);

    const stray = parseBai2(Buffer.from('01,A,B,261121,0900,ID,,,2\n16,165,100,Z,R,R,TEXT\n99,0,0,2/\n', 'latin1'));
    expect(stray.issues.some((i) => i.code === 'BAI2_STRUCTURE' && i.detail.includes('outside an account block'))).toBe(true);
  });

  it('does not invent a single declared total when the file declares credits in two currencies', () => {
    const source = [
      '01,A,B,261121,0900,ID,,,2',
      '02,B,A,1,261120,0900,USD',
      '03,ACC1,USD,100,100,1,Z',
      '03,ACC2,KRW,100,200,1,Z',
      '49,0,2/',
      '98,0,1,4/',
      '99,0,1,6/',
    ].join('\n');
    const result = parseBai2(Buffer.from(`${source}\n`, 'latin1'));
    expect(result.declaredControl).toBeUndefined();
    expect(result.issues.some((i) => i.code === 'SPEC_MISSING' && i.detail.includes('USD, KRW'))).toBe(true);
  });

  it('reports an unknown currency instead of silently assuming two decimals', () => {
    const source = [
      '01,A,B,261121,0900,ID,,,2',
      '02,B,A,1,261120,0900,XYZ',
      '03,ACC,XYZ,100,100,1,Z',
      '16,165,100,Z,R,R,TEXT',
      '49,200,2/',
      '98,200,1,4/',
      '99,200,1,6/',
    ].join('\n');
    const result = parseBai2(Buffer.from(`${source}\n`, 'latin1'));
    expect(result.issues.some((i) => i.code === 'CURRENCY_SCALE_MISMATCH' && i.detail.includes('XYZ'))).toBe(true);
  });
});

describe('T5.1 - BAI2 plugs into the same L2 reconciler', () => {
  it('a clean statement reconciles to PASS against the 820 file', () => {
    const result = reconcile({ payment: payment820(), bank: good(), options: WINDOW });
    expect(result.status).toBe('PASS');
    expect(result.findings).toEqual([]);
    expect(result.summary).toMatchObject({ referencesMatched: 10, referencesUnmatched: 0 });
  });

  it('the bad statement fails on the declared credit total and on both reference directions', () => {
    const result = reconcile({ payment: payment820(), bank: bad(), options: WINDOW });
    expect(result.status).toBe('FAIL');
    const total = result.findings.find((f) => f.code === 'CONTROL_TOTAL_MISMATCH')!;
    expect((total.delta as { minorUnits: bigint }).minorUnits).toBe(-7_902_500n);
    expect(formatAmount(total.delta as never)).toBe('-79,025.00 USD');
    const refs = result.findings.filter((f) => f.code === 'REF_UNMATCHED');
    expect(refs.map((f) => f.reference).sort()).toEqual(['BANK-FEE-2611', 'NWP-2611-0010']);
    expect(refs.find((f) => f.reference === 'BANK-FEE-2611')!.detail).toContain('bank-only');
    expect(refs.find((f) => f.reference === 'NWP-2611-0010')!.detail).toContain('820-only');
  });

  it('the fingerprint is stable across two reads and changes with one byte', () => {
    const first = good();
    const second = good();
    expect(first.fingerprint).toBe(second.fingerprint);
    const changed = parseBai2(Buffer.from(readText('samples/data/bai2-good.txt').replace('0000-820001', '0000-820002'), 'latin1'));
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  it('the spec object keeps the BAI2 field semantics the reconciler needs', () => {
    const spec = bai2Spec();
    expect(spec.semantics).toMatchObject({
      amount: 'AMOUNT',
      currency: 'CURRENCY',
      reference: 'CUSTOMER-REFERENCE',
      valueDate: 'AS-OF-DATE',
    });
    const record = good().records.find((r) => !r.isTrailer)!;
    expect(record.values['AS-OF-DATE__iso']).toBe('2026-11-20');
  });
});
