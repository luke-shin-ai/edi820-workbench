# samples/: fixtures, and two files banks published

**Never place real bank, customer or employer data in this folder.** Everything directly under
`copybooks/` and `data/` is generated for the demo under the fictional company *Northwind Pay*, by
`scripts/gen-fixtures.mjs`, and every planted defect is asserted by `test/unit/fixtures.test.ts`.
`samples/public/` holds the exception: two BAI2 files that banks published as format examples, copied
verbatim so the reader can be checked against bytes this project did not choose. Their sources and
copy notes are in `public/SOURCES.md`.

## Copybooks

| file | bytes/record | what it proves |
|---|---|---|
| `copybooks/820.cpy` | 100 | display amount with `SIGN TRAILING OVERPUNCH`, line framing, `P`/`T` records |
| `copybooks/820-packed.cpy` | 88 | the same payments as COMP-3 packed decimal, `@framing fixed` (binary, no newlines) |
| `copybooks/820-redefines.cpy` | 101 | the bank shape: one 100-byte area with two layouts, `PAYMENT-TRAILER REDEFINES PAYMENT-DETAIL`, activated by `@view` on `REC-TYPE` |
| `copybooks/823.cpy` | 80 | `SIGN LEADING SEPARATE`, an amount with no overpunch character |

## Data

| file | records | planted defect |
|---|---|---|
| `data/820-good.txt` + `data/823-bank.txt` | 11 / 11 | none - the pair reconciles to `PASS` |
| `data/820-bad.txt` | 11 | four defects (short record, control total -100.00, two reference breaks, one value date outside the window) |
| `data/820-packed-good.txt` | 11 | none - same payments, COMP-3 bytes, no line breaks |
| `data/820-redefines-good.txt` | 11 | none - the trailer is read through its own `REDEFINES` layout and agrees |
| `data/820-redefines-bad.txt` | 11 | the trailer layout declares 1,284,450.00 against a detail sum of 1,284,550.00 |
| `data/823-bad.txt` | 10 | trailer declares ten records and the full total, one detail missing |
| `data/bai2-good.txt` | 16 | none - comma-delimited statement of the same account |
| `data/bai2-bad.txt` | 16 | missing credit, a bank-side debit fee, and totals left at the good values |

The per-defect table with expected codes is `data/DEFECTS.md`; it is generated together with the
files so the two cannot drift.

## Generation rule

```bash
npx tsx scripts/gen-fixtures.mjs     # deterministic: same tables in, same bytes out
```

Amounts are round numbers so a delta is obvious at a glance; references are sequential
(`NWP-2611-0001` ...); every account, name and reference is invented.

## Published files (`public/`)

| file | published by | why it is here |
|---|---|---|
| `public/bai2-westpac-npp.txt` | Westpac / Qvalent | CRLF, `88` continuations, a `100` total at the end of an `03` |
| `public/bai2-southstate-guide.txt` | SouthState Bank | four accounts in one group, multi-summary `03` records |

`npm run verify:public` parses both and prints the result; `test/unit/public-bai2.test.ts` asserts
that each one reports no issues and the declared totals above.
