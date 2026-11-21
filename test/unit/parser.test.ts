import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileCopybook } from '../../src/copybook/index.js';
import { parseFile, serializeParseResult, splitRecords, type Amount } from '../../src/parser/index.js';

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

describe('R2.1 — slicing follows the copybook exactly, without trimming', () => {
  it('types every field of the first 820 record', () => {
    const result = parseFile({ copybook: cob820, source: good820 });
    expect(result.records).toHaveLength(11);
    const first = result.records[0]!;
    expect(first.length).toBe(100);
    expect(first.values['REC-TYPE']).toBe('P');
    expect(first.values['ORIG-ID']).toBe('NWPAY00001');
    expect(first.slices['CURRENCY']).toBe('USD');
    expect(first.slices['FILLER']).toBe(' '.repeat(32));
    expect(first.values['REFERENCE']).toBe('NWP-2611-0001  ');
    expect(first.values['VALUE-DATE__iso']).toBe('2026-11-18');
  });

  it('an amount is bigint minor units plus currency plus scale', () => {
    const result = parseFile({ copybook: cob820, source: good820 });
    expect(result.records[0]!.values['AMOUNT']).toEqual({ minorUnits: 15_000_000n, currency: 'USD', scale: 2 } satisfies Amount);
  });

  it('sees the control trailer through the copybook, not by guessing a name', () => {
    const result = parseFile({ copybook: cob820, source: good820 });
    const last = result.records.at(-1)!;
    expect(last.isTrailer).toBe(true);
    expect(result.declaredControl?.recordIndex).toBe(10);
    expect(result.declaredControl?.count).toBe(10n);
    expect(result.declaredControl?.total).toEqual({ minorUnits: 128_455_000n, currency: 'USD', scale: 2 });
    expect(result.computedControl.detailCount).toBe(10);
    expect(result.computedControl.totalsByCurrency['USD']!.minorUnits).toBe(128_455_000n);
  });

  it('keeps trailing padding in string slices (presentation trims later, parsing never does)', () => {
    const result = parseFile({ copybook: cob820, source: good820 });
    const ref = result.records[0]!.slices['REFERENCE']!;
    expect(ref).toHaveLength(15);
    expect(ref.endsWith('  ')).toBe(true);
  });
});

describe('R2.2 — a record of the wrong width is reported, and parsing continues at the boundary', () => {
  it('finds the 99-byte record and still reads the records after it', () => {
    const result = parseFile({ copybook: cob820, source: bad820 });
    const mismatch = result.issues.filter((i) => i.code === 'RECORD_LENGTH_MISMATCH');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]).toMatchObject({ recordIndex: 6, declared: 100, actual: 99 });
    // No re-sync: record 7 is still record 7 with its own reference.
    expect(result.records[7]!.values['REFERENCE']).toBe('NWP-2611-0008  ');
    expect(result.records.at(-1)!.isTrailer).toBe(true);
    // The short record's amount field is still inside the available bytes.
    expect(result.records[6]!.values['AMOUNT']).toEqual({ minorUnits: 6_600_000n, currency: 'USD', scale: 2 });
  });

  it('records a zero-length line as a length mismatch instead of skipping it', () => {
    const source = Buffer.from(`${'P'.padEnd(100, ' ')}\n\n${'T'.padEnd(100, ' ')}\n`, 'latin1');
    const result = parseFile({ copybook: cob820, source });
    expect(result.issues.some((i) => i.code === 'RECORD_LENGTH_MISMATCH' && i.actual === 0)).toBe(true);
    expect(result.records).toHaveLength(3);
  });
});

describe('R2.3 — an invalid numeric character is a coded issue, not an exception', () => {
  it('reports FIELD_INVALID_NUMERIC with the record index and field name', () => {
    const broken = Buffer.from(good820.toString('latin1').replace('000001500000{', '00000150000X{'), 'latin1');
    const result = parseFile({ copybook: cob820, source: broken });
    const issue = result.issues.find((i) => i.code === 'FIELD_INVALID_NUMERIC');
    expect(issue).toMatchObject({ recordIndex: 0, field: 'AMOUNT' });
    expect(result.records[0]!.values['AMOUNT']).toBeNull();
    expect(result.records[1]!.values['AMOUNT']).toEqual({ minorUnits: 9_905_000n, currency: 'USD', scale: 2 });
  });

  it('reports a blank numeric field rather than reading it as zero', () => {
    const broken = Buffer.from(good820.toString('latin1').replace('000001500000{', '             '), 'latin1');
    const result = parseFile({ copybook: cob820, source: broken });
    expect(result.issues.some((i) => i.code === 'FIELD_INVALID_NUMERIC' && i.field === 'AMOUNT')).toBe(true);
  });
});

describe('R2.4 — sign handling follows the copybook, and direction comes from TXN-TYPE', () => {
  it('decodes a negative 820 amount with the overpunch table', () => {
    const source = Buffer.from(good820.toString('latin1').replace('000001500000{', '000001500000}'), 'latin1');
    const result = parseFile({ copybook: cob820, source });
    expect(result.records[0]!.values['AMOUNT']).toEqual({ minorUnits: -15_000_000n, currency: 'USD', scale: 2 });
    expect(result.records[0]!.values['TXN-TYPE']).toBe('C ');
  });

  it('decodes the 823 bank file, which uses a leading separate sign', () => {
    const result = parseFile({ copybook: cob823, source: bank823 });
    expect(result.issues).toEqual([]);
    expect(result.records[0]!.values['AMOUNT']).toEqual({ minorUnits: 15_000_000n, currency: 'USD', scale: 2 });
    expect(result.records[0]!.values['BANK-REF']).toBe('NWP-2611-0001  ');
  });

  it('decodes a negative leading separate sign in the 823 file', () => {
    const source = Buffer.from(bank823.toString('latin1').replace('+0000015000000', '-0000015000000'), 'latin1');
    const result = parseFile({ copybook: cob823, source });
    expect(result.records[0]!.values['AMOUNT']).toEqual({ minorUnits: -15_000_000n, currency: 'USD', scale: 2 });
  });
});

describe('R2.5 — implied decimals scale to minor units, with the ISO-4217 code attached', () => {
  const scaleCopybook = compileCopybook(
    [
      '      * @semantics amount=AMT currency=CUR',
      '       05  AMT   PIC 9(7)V99.',
      '       05  CUR   PIC X(3).',
    ].join('\n'),
  );

  it('scales by the copybook, not by the currency', () => {
    expect(scaleCopybook.recordLength).toBe(12);
    const result = parseFile({ copybook: scaleCopybook, source: Buffer.from('000123499USD', 'latin1') });
    expect(result.records[0]!.values['AMT']).toEqual({ minorUnits: 123_499n, currency: 'USD', scale: 2 });
    expect(result.issues).toEqual([]);
  });

  it('reports CURRENCY_SCALE_MISMATCH when KRW (0 decimals) meets a V99 copybook', () => {
    const result = parseFile({ copybook: scaleCopybook, source: Buffer.from('000123499KRW', 'latin1') });
    expect(result.issues.some((i) => i.code === 'CURRENCY_SCALE_MISMATCH' && i.field === 'AMT')).toBe(true);
  });
});

describe('R2.6 — declared and computed control values are both returned', () => {
  it('exposes declared count/total next to the computed sum', () => {
    const result = parseFile({ copybook: cob820, source: bad820 });
    expect(result.declaredControl?.count).toBe(10n);
    expect(result.declaredControl?.total?.minorUnits).toBe(128_455_000n);
    // one record was altered by -100.00: the computed total is what the bytes say.
    expect(result.computedControl.totalsByCurrency['USD']!.minorUnits).toBe(128_445_000n);
  });

  it('reports SPEC_MISSING when the copybook expects a trailer the file lacks', () => {
    const lines = good820.toString('latin1').split('\n').filter(Boolean).slice(0, 10);
    const result = parseFile({ copybook: cob820, source: Buffer.from(`${lines.join('\n')}\n`, 'latin1') });
    expect(result.declaredControl).toBeUndefined();
    expect(result.issues.some((i) => i.code === 'SPEC_MISSING')).toBe(true);
  });
});

describe('framing — the copybook decides how records are delimited', () => {
  it('reads a COMP-3 stream with no line breaks as fixed 88-byte records', () => {
    const result = parseFile({ copybook: cobPacked, source: packed820 });
    expect(result.framing).toBe('fixed');
    expect(result.records).toHaveLength(11);
    expect(result.records[0]!.length).toBe(88);
    expect(result.records[0]!.values['AMOUNT']).toEqual({ minorUnits: 15_000_000n, currency: 'USD', scale: 2 });
    expect(result.computedControl.totalsByCurrency['USD']!.minorUnits).toBe(128_455_000n);
  });

  it('keeps a trailing partial record instead of dropping it', () => {
    const { records } = splitRecords(Buffer.from('X'.repeat(100) + 'Y'.repeat(44), 'latin1'), 100, 'fixed');
    expect(records).toEqual(['X'.repeat(100), 'Y'.repeat(44)]);
  });
});

describe('R3.1/R3.2 — round-trip fidelity', () => {
  it('serializes the 820 file back to identical bytes', () => {
    const result = parseFile({ copybook: cob820, source: good820 });
    expect(serializeParseResult(result).equals(good820)).toBe(true);
  });

  it('serializes the binary COMP-3 stream back to identical bytes', () => {
    const result = parseFile({ copybook: cobPacked, source: packed820 });
    expect(serializeParseResult(result).equals(packed820)).toBe(true);
  });

  it('serializes a file with a broken record back to identical bytes', () => {
    const result = parseFile({ copybook: cob820, source: bad820 });
    expect(serializeParseResult(result).equals(bad820)).toBe(true);
  });

  it('keeps a missing trailing newline missing', () => {
    const source = Buffer.from(`${'P'.padEnd(100, ' ')}\n${'T'.padEnd(100, ' ')}`, 'latin1');
    const result = parseFile({ copybook: cob820, source });
    expect(result.trailingNewline).toBe(false);
    expect(serializeParseResult(result).equals(source)).toBe(true);
  });

  it('keeps CRLF line endings', () => {
    const source = Buffer.from(`${'P'.padEnd(100, ' ')}\r\n${'T'.padEnd(100, ' ')}\r\n`, 'latin1');
    const result = parseFile({ copybook: cob820, source });
    expect(result.eol).toBe('\r\n');
    expect(serializeParseResult(result).equals(source)).toBe(true);
  });
});

describe('fingerprint — same input, same value', () => {
  it('is stable across two parses of the same bytes', () => {
    const a = parseFile({ copybook: cob820, source: good820 });
    const b = parseFile({ copybook: cob820, source: good820 });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when one byte of data changes', () => {
    const a = parseFile({ copybook: cob820, source: good820 });
    const b = parseFile({ copybook: cob820, source: bad820 });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('changes when the copybook changes, even with the same data', () => {
    const a = parseFile({ copybook: cob820, source: good820 });
    const copybook = compileCopybook(`${cob820.source.replace('PIC X(32).', 'PIC X(31).')}`);
    expect(copybook.recordLength).toBe(99);
    const b = parseFile({ copybook, source: good820 });
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });
});
