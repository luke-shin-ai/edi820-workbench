#!/usr/bin/env node
/**
 * gen-fixtures.mjs — deterministic synthetic fixtures for 「820」 (task T0.3).
 *
 * Everything here is fictional (Northwind Pay, generated references, no real
 * accounts). The script is deterministic: same seed-free tables in, same bytes out,
 * so `verify` findings and the demo video can be reproduced months later.
 *
 * Run: npx tsx scripts/gen-fixtures.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCopybook } from '../src/copybook/index.js';
import { encodeRecord } from '../src/parser/serialize.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const cob820 = compileCopybook(read('samples/copybooks/820.cpy'));
const cob823 = compileCopybook(read('samples/copybooks/823.cpy'));
const cob820Packed = compileCopybook(read('samples/copybooks/820-packed.cpy'));

const CURRENCY = 'USD';
const SCALE = 2;

/** Payment table — round numbers so a delta is visible at a glance. */
export const PAYMENTS = [
  { reference: 'NWP-2611-0001', cents: 15_000_000n, date: '20261118', receiver: 'GREENFIELD-SUPPLY', txn: 'C ' },
  { reference: 'NWP-2611-0002', cents: 9_905_000n, date: '20261118', receiver: 'HARBOR-FREIGHT', txn: 'C ' },
  { reference: 'NWP-2611-0003', cents: 20_000_000n, date: '20261119', receiver: 'BLUE-RIDGE-ENERGY', txn: 'C ' },
  { reference: 'NWP-2611-0004', cents: 8_750_000n, date: '20261119', receiver: 'CEDAR-CONSULTING', txn: 'C ' },
  { reference: 'NWP-2611-0005', cents: 12_000_000n, date: '20261119', receiver: 'NORTHSTAR-LOGISTICS', txn: 'C ' },
  { reference: 'NWP-2611-0006', cents: 31_000_000n, date: '20261120', receiver: 'SUMMIT-HARDWARE', txn: 'C ' },
  { reference: 'NWP-2611-0007', cents: 6_600_000n, date: '20261120', receiver: 'LAKESIDE-PRINTING', txn: 'C ' },
  { reference: 'NWP-2611-0008', cents: 4_500_000n, date: '20261120', receiver: 'PINEHURST-MEDICAL', txn: 'C ' },
  { reference: 'NWP-2611-0009', cents: 12_800_000n, date: '20261120', receiver: 'ATLAS-STAFFING', txn: 'C ' },
  { reference: 'NWP-2611-0010', cents: 7_900_000n, date: '20261120', receiver: 'RIVERSTONE-FOODS', txn: 'C ' },
];

export const GOOD_TOTAL_CENTS = PAYMENTS.reduce((sum, p) => sum + p.cents, 0n);
export const GOOD_COUNT = BigInt(PAYMENTS.length);

const amount = (cents) => ({ minorUnits: cents, currency: CURRENCY, scale: SCALE });

function paymentRecord(cob, payment) {
  return encodeRecord(cob, {
    'REC-TYPE': 'P',
    'ORIG-ID': 'NWPAY00001',
    'RECEIVER-ID': payment.receiver.slice(0, 10),
    'TXN-TYPE': cob.name === 'PAYMENT-RECORD' ? payment.txn : 'C ',
    AMOUNT: amount(payment.cents),
    CURRENCY,
    'VALUE-DATE': BigInt(payment.date),
    REFERENCE: payment.reference,
    'REC-COUNT': 0n,
  });
}

function trailer820(cob, count, totalCents) {
  return encodeRecord(cob, {
    'REC-TYPE': 'T',
    'ORIG-ID': 'NWPAY00001',
    'RECEIVER-ID': 'BANK-STLMT',
    'TXN-TYPE': 'C ',
    AMOUNT: amount(totalCents),
    CURRENCY,
    'VALUE-DATE': 20261120n,
    REFERENCE: 'CTL-820-TRAILER',
    'REC-COUNT': count,
  });
}

function bankRecord(cob, payment) {
  return encodeRecord(cob, {
    'REC-TYPE': 'D',
    'ORIG-ID': 'NWPAY00001',
    'RECEIVER-ID': payment.receiver.slice(0, 10),
    CURRENCY,
    AMOUNT: amount(payment.cents),
    'VALUE-DATE': BigInt(payment.date),
    'BANK-REF': payment.reference,
    'REC-COUNT': 0n,
  });
}

function trailer823(cob, count, totalCents) {
  return encodeRecord(cob, {
    'REC-TYPE': 'T',
    'ORIG-ID': 'NWPAY00001',
    'RECEIVER-ID': 'BANK-STLMT',
    CURRENCY,
    AMOUNT: amount(totalCents),
    'VALUE-DATE': 20261120n,
    'BANK-REF': 'CTL-823-TRAILER',
    'REC-COUNT': count,
  });
}

/** 820-bad: four planted defects, each listed in samples/data/DEFECTS.md. */
const BAD_PAYMENTS = PAYMENTS.map((p, i) => {
  if (i === 7) return { ...p, cents: 4_490_000n }; // ② total −100.00
  if (i === 8) return { ...p, cents: 12_799_999n }; // ③a one cent moved out of record 8
  if (i === 2) return { ...p, date: '20261114' }; // ④ date outside the settlement window
  if (i === 9) return { ...p, cents: 7_900_001n, reference: 'NWP-2611-0011' }; // ③b reference break + one cent back
  return p;
});

const outDir = join(root, 'samples/data');
mkdirSync(outDir, { recursive: true });

const writeLines = (name, lines) => {
  writeFileSync(join(outDir, name), `${lines.join('\n')}\n`, 'latin1');
  return lines;
};

// ① 820-good: matching pair with 823-bank.txt
const good820 = writeLines('820-good.txt', [
  ...PAYMENTS.map((p) => paymentRecord(cob820, p)),
  trailer820(cob820, GOOD_COUNT, GOOD_TOTAL_CENTS),
]);

// ② 820-bad: one record deliberately one byte short (planted defect ①)
const bad820 = writeLines(
  '820-bad.txt',
  [
    ...BAD_PAYMENTS.map((p, i) => {
      const record = paymentRecord(cob820, p);
      return i === 6 ? record.slice(0, -1) : record; // ① record 6 is 99 bytes
    }),
    trailer820(cob820, GOOD_COUNT, GOOD_TOTAL_CENTS),
  ],
);

// ③ 820-packed-good: same meaning, COMP-3 bytes, no line breaks (fixed framing)
const packedRecords = [
  ...PAYMENTS.map((p) => paymentRecord(cob820Packed, p)),
  trailer820(cob820Packed, GOOD_COUNT, GOOD_TOTAL_CENTS),
];
writeFileSync(join(outDir, '820-packed-good.txt'), Buffer.from(packedRecords.join(''), 'latin1'));

// ④ 823-bank: the bank side of the good pair (all references echo)
const bank823 = writeLines('823-bank.txt', [
  ...PAYMENTS.map((p) => bankRecord(cob823, p)),
  trailer823(cob823, GOOD_COUNT, GOOD_TOTAL_CENTS),
]);

// ⑤ 823-bad: trailer declares 10 records and the full total, only 9 arrived
const bankBad = writeLines('823-bad.txt', [
  ...PAYMENTS.slice(0, 7).map((p) => bankRecord(cob823, p)),
  ...PAYMENTS.slice(8).map((p) => bankRecord(cob823, p)),
  trailer823(cob823, GOOD_COUNT, GOOD_TOTAL_CENTS),
]);

const defects = `# DEFECTS — what each fixture is supposed to prove

All data is synthetic (Northwind Pay). Generated by \`scripts/gen-fixtures.mjs\`; the
byte-level outcomes below are asserted by \`test/unit/fixtures.test.ts\`, so a fixture
that drifts from its documented defect fails the build.

| file | records | planted defect | expected finding / issue |
|---|---|---|---|
| \`820-good.txt\` + \`823-bank.txt\` | ${good820.length} / ${bank823.length} | none — the pair must reconcile clean | verdict \`PASS\` |
| \`820-bad.txt\` | ${bad820.length} | ① record index 6 is 99 bytes (one byte short) | \`RECORD_LENGTH_MISMATCH\` (declared 100, actual 99) |
| | | ② record index 7 amount is 44,900.00 instead of 45,000.00 | \`CONTROL_TOTAL_MISMATCH\` delta −100.00 USD |
| | | ③a record index 8 amount is 127,999.99 and ③b record index 9 is 79,000.01 with reference \`NWP-2611-0011\` (one cent reallocated between them, so the total still differs by exactly −100.00) | \`REF_UNMATCHED\` 820-only for \`…0011\` and bank-only for \`…0010\` — the amount+date fallback must **not** paper over a broken reference |
| | | ④ record index 2 value date is 2026-11-14, before the settlement window | \`DATE_OUT_OF_WINDOW\` (window 2026-11-18..2026-11-20) |
| \`820-packed-good.txt\` | ${packedRecords.length} | none — same payments as \`820-good.txt\`, COMP-3 amounts, no line breaks | verdict \`PASS\` against \`823-bank.txt\` |
| \`823-bad.txt\` | ${bankBad.length} | trailer declares 10 records / full total, one detail record missing | \`CONTROL_COUNT_MISMATCH\` (10 vs 9) + \`CONTROL_TOTAL_MISMATCH\` delta −45,000.00 USD |

## Why the record length is the interesting defect
Fixed-width files fail quietly: a 99-byte record inside a 100-byte layout shifts every
following field if the reader re-synchronises on newlines. 「820」 never re-synchronises.
It slices at the copybook's boundary and reports the short record, so the amount on
record 7 still reads correctly and the missing byte is a *finding*, not a corrupted total.
`;

writeFileSync(join(outDir, 'DEFECTS.md'), defects, 'utf8');

console.log('fixtures written to samples/data/');
for (const [name, lines] of [
  ['820-good.txt', good820],
  ['820-bad.txt', bad820],
  ['820-packed-good.txt', packedRecords],
  ['823-bank.txt', bank823],
  ['823-bad.txt', bankBad],
] ) {
  const bytes = readFileSync(join(outDir, name)).length;
  console.log(`  ${name.padEnd(20)} ${lines.length} records  ${bytes} bytes`);
}
console.log(`good total: ${GOOD_TOTAL_CENTS} minor units (${GOOD_TOTAL_CENTS / 100n}.00 ${CURRENCY}) over ${GOOD_COUNT} payments`);
