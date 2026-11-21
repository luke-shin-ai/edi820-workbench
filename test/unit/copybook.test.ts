import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CopybookError, compileCopybook, numericWidth, parsePicture } from '../../src/copybook/index.js';

const root = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const cpy820 = read('samples/copybooks/820.cpy');
const cpy823 = read('samples/copybooks/823.cpy');
const cpyPacked = read('samples/copybooks/820-packed.cpy');

function expectCopybookError(fn: () => unknown): CopybookError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CopybookError) return error;
    throw error;
  }
  throw new Error('expected a CopybookError, none was thrown');
}

describe('R1.1 — field offsets are derived cumulatively, 1-based', () => {
  it('compiles 820.cpy into 10 fields with exact byte offsets', () => {
    const cb = compileCopybook(cpy820);
    expect(cb.fields.map((f) => [f.name, f.start, f.length])).toEqual([
      ['REC-TYPE', 1, 1],
      ['ORIG-ID', 2, 10],
      ['RECEIVER-ID', 12, 10],
      ['TXN-TYPE', 22, 2],
      ['AMOUNT', 24, 13],
      ['CURRENCY', 37, 3],
      ['VALUE-DATE', 40, 8],
      ['REFERENCE', 48, 15],
      ['REC-COUNT', 63, 6],
      ['FILLER', 69, 32],
    ]);
    expect(cb.recordLength).toBe(100);
  });

  it('a repeated 9 count in a picture adds up (9(3)9(2) = 5 digits)', () => {
    const picture = parsePicture('9(3)9(2)', 1);
    expect(picture.digits).toBe(5);
    expect(picture.decimals).toBe(0);
  });
});

describe('R1.2 — implied decimals become scale, not a float', () => {
  it('AMOUNT PIC S9(11)V99 is 11 integer digits, scale 2, 13 bytes', () => {
    const amount = compileCopybook(cpy820).fields.find((f) => f.name === 'AMOUNT')!;
    expect(amount.digits).toBe(11);
    expect(amount.decimals).toBe(2);
    expect(amount.length).toBe(13);
    expect(amount.type).toBe('zoned-decimal');
  });

  it('PIC 9(8) is an unsigned 8-byte integer with scale 0', () => {
    const date = compileCopybook(cpy820).fields.find((f) => f.name === 'VALUE-DATE')!;
    expect(date.type).toBe('unsigned-int');
    expect(date.decimals).toBe(0);
  });
});

describe('R1.3 — the sign convention is recorded on the field', () => {
  it('820.cpy declares trailing overpunch', () => {
    const amount = compileCopybook(cpy820).fields.find((f) => f.name === 'AMOUNT')!;
    expect(amount.signed).toBe(true);
    expect(amount.sign).toBe('trailing-overpunch');
  });

  it('823.cpy declares a leading separate sign, a different convention on the same data', () => {
    const amount = compileCopybook(cpy823).fields.find((f) => f.name === 'AMOUNT')!;
    expect(amount.sign).toBe('leading-separate');
    expect(amount.length).toBe(14);
    expect(amount.type).toBe('signed-int');
  });

  it('COMP-3 is 7 bytes for 13 digits + sign', () => {
    const amount = compileCopybook(cpyPacked).fields.find((f) => f.name === 'AMOUNT')!;
    expect(amount.usage).toBe('comp-3');
    expect(amount.type).toBe('packed-decimal');
    expect(amount.length).toBe(7);
    expect(numericWidth({ kind: 'numeric', stringLength: 0, signed: true, digits: 11, decimals: 2 }, 'comp-3', undefined)).toBe(7);
  });

  it('a signed display field without a sign convention is refused rather than guessed', () => {
    const error = expectCopybookError(() =>
      compileCopybook(['       01  R.', '           05  AMT   PIC S9(5)V99.'].join('\n')),
    );
    expect(error.code).toBe('COPYBOOK_UNPARSABLE');
    expect(error.line).toBe(2);
    expect(error.message).toContain('sign convention');
  });
});

describe('R1.4 — a line that cannot be understood fails, naming the line', () => {
  it('reports COPYBOOK_UNPARSABLE with the line number for a malformed line', () => {
    const error = expectCopybookError(() =>
      compileCopybook(['       01  R.', '           05  A   PIC X(3).', '           05  B   PIC Q(4).'].join('\n')),
    );
    expect(error.code).toBe('COPYBOOK_UNPARSABLE');
    expect(error.line).toBe(3);
  });

  it('reports COPYBOOK_UNPARSABLE for an unrecognised clause instead of ignoring it', () => {
    const error = expectCopybookError(() => compileCopybook('       05  A   PIC X(3) FROBNICATE.'));
    expect(error.code).toBe('COPYBOOK_UNPARSABLE');
    expect(error.message).toContain('FROBNICATE');
  });

  it('reports SPEC_MISSING-style structural gaps as errors, not skips (REDEFINES)', () => {
    const error = expectCopybookError(() =>
      compileCopybook(['       05  A   PIC X(3).', '       05  B   PIC X(4) REDEFINES A.'].join('\n')),
    );
    expect(error.code).toBe('UNSUPPORTED_STRUCTURE');
    expect(error.message).toContain('REDEFINES');
  });

  it('refuses OCCURS (table fields) instead of mis-slicing them', () => {
    const error = expectCopybookError(() => compileCopybook('       05  A   PIC X(3) OCCURS 4 TIMES.'));
    expect(error.code).toBe('UNSUPPORTED_STRUCTURE');
  });
});

describe('R1.5 — overlapping fields are reported with both names', () => {
  it('POSITION can make fields overlap; the compiler names both', () => {
    const error = expectCopybookError(() =>
      compileCopybook(
        [
          '       05  A   PIC X(10).',
          '       05  B   PIC X(5) POSITION 8.',
        ].join('\n'),
      ),
    );
    expect(error.code).toBe('COPYBOOK_OVERLAP');
    expect(error.fields).toEqual(['A', 'B']);
    expect(error.message).toContain('A');
    expect(error.message).toContain('B');
  });

  it('a gap between explicitly positioned fields is recorded as a note, not hidden', () => {
    const cb = compileCopybook(['       05  A   PIC X(4).', '       05  B   PIC X(2) POSITION 8.'].join('\n'));
    expect(cb.recordLength).toBe(9);
    expect(cb.notes.some((n) => n.includes('not covered'))).toBe(true);
  });
});

describe('copybook metadata — semantics and control drive the layers above', () => {
  it('reads @semantics and @control', () => {
    const cb = compileCopybook(cpy820);
    expect(cb.semantics).toMatchObject({
      amount: 'AMOUNT',
      currency: 'CURRENCY',
      valueDate: 'VALUE-DATE',
      dateFormat: 'CCYYMMDD',
      reference: 'REFERENCE',
      transactionType: 'TXN-TYPE',
    });
    expect(cb.control).toEqual({
      typeField: 'REC-TYPE',
      trailerValue: 'T',
      countField: 'REC-COUNT',
      totalField: 'AMOUNT',
      currencyField: 'CURRENCY',
    });
  });

  it('reads @framing fixed for the unblocked mainframe stream', () => {
    expect(compileCopybook(cpyPacked).framing).toBe('fixed');
    expect(compileCopybook(cpy820).framing).toBe('line');
  });

  it('rejects a @semantics pointer to a field that does not exist', () => {
    const error = expectCopybookError(() =>
      compileCopybook(
        [
          '      * @semantics amount=NOPE currency=CUR',
          '       05  AMT   PIC 9(5).',
          '       05  CUR   PIC X(3).',
        ].join('\n'),
      ),
    );
    expect(error.code).toBe('COPYBOOK_SEMANTICS');
    expect(error.message).toContain('NOPE');
  });

  it('rejects an amount semantics pointing at an alphabetic field', () => {
    const error = expectCopybookError(() =>
      compileCopybook(['      * @semantics amount=REF', '       05  REF   PIC X(5).'].join('\n')),
    );
    expect(error.code).toBe('COPYBOOK_SEMANTICS');
  });
});

describe('record length comes from the field sum, never from a comment', () => {
  it('ignores a header comment that disagrees with the PIC sum', () => {
    const cb = compileCopybook(['      * 90 bytes per record.', '       05  A   PIC X(4).', '       05  B   PIC 9(4).'].join('\n'));
    expect(cb.recordLength).toBe(8);
  });
});
