import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { compileCopybook } from '../../src/copybook/index.js';
import { parseFile } from '../../src/parser/index.js';
import { encodeRecord } from '../../src/parser/serialize.js';

/**
 * T1.3: property: for any copybook the compiler accepts, the fields tile the
 * record exactly: starts are contiguous from 1, no overlap, sum(length) = recordLength.
 */

interface FieldSpec {
  name: string;
  pic: string;
  clause: string;
}

const picArb = fc.oneof(
  fc.integer({ min: 1, max: 20 }).map((n) => `X(${n})`),
  fc.integer({ min: 1, max: 9 }).map((n) => `9(${n})`),
  fc
    .tuple(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 1, max: 4 }))
    .map(([n, m]) => `9(${n})V${'9'.repeat(m)}`),
  fc
    .tuple(fc.integer({ min: 7, max: 12 }), fc.integer({ min: 0, max: 2 }))
    .map(([n, m]) => (m === 0 ? `S9(${n}) COMP-3` : `S9(${n})V${'9'.repeat(m)} COMP-3`)),
  fc
    .tuple(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 0, max: 2 }))
    .map(([n, m]) => (m === 0 ? `S9(${n}) SIGN TRAILING OVERPUNCH` : `S9(${n})V${'9'.repeat(m)} SIGN TRAILING OVERPUNCH`)),
  fc
    .tuple(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 0, max: 2 }))
    .map(([n, m]) => (m === 0 ? `S9(${n}) SIGN LEADING SEPARATE` : `S9(${n})V${'9'.repeat(m)} SIGN LEADING SEPARATE`)),
);

const fieldArb = picArb.map((pic) => pic);

const copybookArb = fc
  .array(fieldArb, { minLength: 1, maxLength: 8 })
  .map((fields) =>
    [
      '       01  GENERATED.',
      ...fields.map((pic, i) => `           ${String(5).padStart(2, '0')}  ${`F${i}`.padEnd(10)}   PIC ${pic}.`),
    ].join('\n'),
  );

describe('REDEFINES - generated two-layout copybooks keep one byte range', () => {
  const widths = fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 1, maxLength: 4 });

  const twoLayoutCopybook = fc.tuple(widths, widths).map(([a, b]) => {
    const total = a.reduce((sum, n) => sum + n, 0);
    const used = b.reduce((sum, n) => sum + n, 0);
    if (used > total) return null;
    const pad = total - used;
    const lines = [
      '      * @view layout=A typeField=T value=A',
      '      * @view layout=B typeField=T value=B',
      '       01  R.',
      '           05  T   PIC X(1).',
      '           05  BODY.',
      '               10  A.',
      ...a.map((n, i) => `                   15  F${i}  PIC X(${n}).`),
      '               10  B   REDEFINES A.',
      ...b.map((n, i) => `                   15  G${i}  PIC X(${n}).`),
      ...(pad > 0 ? [`                   15  FILLER PIC X(${pad}).`] : []),
    ];
    return { text: lines.join('\n'), total };
  });

  it('both layouts cover the same bytes and exactly one is decoded per record', () => {
    fc.assert(
      fc.property(twoLayoutCopybook, (generated) => {
        fc.pre(generated !== null);
        const { text, total } = generated!;
        const cb = compileCopybook(text);
        expect(cb.recordLength).toBe(total + 1);
        const [first, second] = cb.views ?? [];
        expect(first).toBeDefined();
        expect(second).toBeDefined();
        expect([first!.start, first!.length]).toEqual([second!.start, second!.length]);
        expect(first!.length).toBe(total);

        // A record written through layout A is read back with A's fields only.
        const aValues = Object.fromEntries((first!.fields as string[])
          .map((name) => cb.fields.find((field) => field.name === name))
          .filter((field) => field !== undefined && !field.group && field.type !== 'filler')
          .map((field) => [field!.name, 'x'.repeat(field!.length)]));
        const recordA = encodeRecord(cb, { T: 'A', ...aValues });
        expect(recordA.length).toBe(cb.recordLength);
        const parsedA = parseFile({ copybook: cb, source: recordA });
        expect(parsedA.issues).toEqual([]);
        expect(parsedA.records[0]!.views?.[first!.region]).toBe('A');
        for (const name of Object.keys(aValues)) expect(parsedA.records[0]!.values[name]).toBeDefined();
        for (const name of second!.fields) {
          const field = cb.fields.find((entry) => entry.name === name);
          if (!field || field.group) continue;
          expect(parsedA.records[0]!.values[name]).toBeUndefined();
        }
      }),
      { numRuns: 120 },
    );
  });

  it('a record whose discriminator matches no layout is refused, not guessed', () => {
    const cb = compileCopybook(
      [
        '      * @view layout=A typeField=T value=A',
        '      * @view layout=B typeField=T value=B',
        '       01  R.',
        '           05  T   PIC X(1).',
        '           05  BODY.',
        '               10  A.',
        '                   15  F0  PIC X(4).',
        '               10  B   REDEFINES A.',
        '                   15  G0  PIC X(4).',
      ].join('\n'),
    );
    const parsed = parseFile({ copybook: cb, source: 'Zxxxx' });
    expect(parsed.issues.map((issue) => issue.code)).toEqual(['REDEFINES_VIEW_UNMATCHED']);
    expect(parsed.records[0]!.values['F0']).toBeUndefined();
    expect(parsed.records[0]!.values['G0']).toBeUndefined();
  });
});

describe('T1.3 - generated copybooks tile their record exactly', () => {
  it('starts are contiguous from 1 and recordLength equals the sum of lengths', () => {
    fc.assert(
      fc.property(copybookArb, (text) => {
        const cb = compileCopybook(text);
        let expectedStart = 1;
        for (const field of cb.fields) {
          expect(field.start).toBe(expectedStart);
          expect(field.length).toBeGreaterThan(0);
          expectedStart += field.length;
        }
        expect(cb.recordLength).toBe(expectedStart - 1);
      }),
      { numRuns: 200 },
    );
  });

  it('byte width per family is ceil(digits/2)+1 for COMP-3 and digits(+1 sign) for display', () => {
    fc.assert(
      fc.property(copybookArb, (text) => {
        const cb = compileCopybook(text);
        for (const field of cb.fields) {
          const digits = (field.digits ?? 0) + (field.decimals ?? 0);
          if (field.type === 'packed-decimal') {
            expect(field.length).toBe(Math.ceil((digits + 1) / 2));
          } else if (field.type === 'string') {
            expect(field.length).toBeGreaterThan(0);
          } else {
            const separate = field.sign === 'leading-separate' || field.sign === 'trailing-separate' ? 1 : 0;
            expect(field.length).toBe(digits + separate);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('explicit POSITION can only produce overlap errors, never silent overlap', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        (a, b, pos) => {
          const text = [
            '       05  A   PIC X(' + a + ').',
            '       05  B   PIC X(' + b + ') POSITION ' + pos + '.',
          ].join('\n');
          try {
            const cb = compileCopybook(text);
            for (let i = 1; i < cb.fields.length; i += 1) {
              const prev = cb.fields[i - 1]!;
              expect(prev.start + prev.length - 1).toBeLessThan(cb.fields[i]!.start);
            }
          } catch (error) {
            expect((error as { code?: string }).code).toBe('COPYBOOK_OVERLAP');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
