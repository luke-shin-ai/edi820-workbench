# BAI2: why it has its own reader

BAI2 (cash-management balance reporting) is a live format: banks still push it over
SFTP every night. It is **not** fixed width and it has **no copybook**, so faking it
as one would have been exactly the lie this repository exists to avoid (T0.3 said so
when the fixture set was built; T5 delivered the reader).

## 1. What the reader is

`src/bai2/reader.ts` produces the same `ParseResult` shape the fixed-width parser does,
so L2 (`src/reconcile`) reconciles it without knowing where the records came from.
The spec object it carries declares `format: 'bai2'`, `recordLength: 0` and
`fields: []`, because:

- BAI2 has no record length - the longest line is a fact about a file, not a contract;
- a field's position depends on the record, so offsets live on the record
  (`TypedRecord.spans`), not in a global layout.

`docs/guarantees.md` still holds: bytes are sliced exactly where the declared layout
says, and nothing is trimmed inside a value.

## 2. Record layouts read

| code | record | fields used |
|---|---|---|
| `01` | file header | sender, receiver, creation date/time, file id, version (must be 2) |
| `02` | group header | originator, group status, as-of date (`YYMMDD`), currency |
| `03` | account summary | account, currency, type code, amount, item count, funds type |
| `16` | transaction detail | type code, amount, funds type, bank ref, customer ref, text |
| `49` | account trailer | account control total, number of records (`03`..`49`) |
| `88` | continuation | carried, not interpreted |
| `98` | group trailer | group control total, number of accounts, number of records (`02`..`98`) |
| `99` | file trailer | file control total, number of groups, number of records (`01`..`99`) |

Bold rules this reader implements and tests:

- **Amounts are integers with implied decimals.** The scale comes from the ISO-4217
  exponent table (`USD` 2, `KRW` 0, ...). A currency not in the table is
  `CURRENCY_SCALE_MISMATCH`, never a silent assumption of two decimals.
- **The type code decides direction.** `100-399` credit (positive), `400-699` debit
  (negative). A code outside both ranges keeps its amount positive and is reported as
  `BAI2_RECORD_INVALID` - a reader may not invent a sign.
- **The `16` text field may contain commas.** Everything from field 7 onward is text;
  field offsets are taken from the raw line so a comma inside a description cannot
  shift the reference fields.

## 3. Dates

BAI2 carries `YYMMDD` and no century. The reader applies `2000` and says so in the
spec notes; `parseBai2(source, { century })` changes it. The value date of a `16`
record is therefore the **group's as-of date** - BAI2 has no per-transaction value
date, and the screen labels it that way rather than pretending otherwise.

## 4. Control totals: which number is compared to what

This is the part a naive implementation gets wrong, so it is written down here and in
the reader's comments:

- The account trailer (`49`) control total is defined over the `03` summary amounts
  **and** the `16` detail amounts. The reader checks that identity and reports
  `BAI2_CONTROL_MISMATCH` when it fails. (Some bank templates total the `16` amounts
  only, because their `03` is a summary of the same details. The reader does not guess
  which convention a file uses; it applies the documented identity above and reports a
  mismatch rather than silently choosing one. A file built to the other convention shows
  up as a `49` mismatch, which is exactly what that check exists for.)
- The group trailer (`98`) total is the sum of the `49` totals; the reader checks that
  too, plus the record and account counts in `49`, `98` and `99`.
- The number handed to L2 as the **declared control total** is the `03` summary code
  `100` ("total credits"). It is the only BAI2 number directly comparable to a payment
  file's declared total. Using the `98` total instead would compare a payment total to
  a total that already includes summary amounts - a category error, not a finding.
- BAI2's `98` record count includes `02`/`03`/`16`/`49`/`88`, so it is **not** a detail
  count; the reader leaves `declaredControl.count` unset rather than produce a
  `CONTROL_COUNT_MISMATCH` that means nothing.

### The comparison basis (fixed 2026-11-21)

`03`/`100` declares **gross credits**; the `16` records the reader sums into
`computedControl` are signed, so a debit makes that sum **net**. Comparing the two without
saying so folded a bank fee into a "control total mismatch" (review §5 #7). The reader now
keeps both views per currency:

| field | meaning |
|---|---|
| `computedControl.totalsByCurrency` | signed sum: credits positive, debits negative (the net) |
| `computedControl.creditTotalsByCurrency` | gross credit magnitudes |
| `computedControl.debitTotalsByCurrency` | gross debit magnitudes |

The reconciliation detail therefore reads, for `bai2-bad.txt`:

> bank control total declares 1,284,550.00 USD but the detail records net to 1,205,525.00 USD (credits 1,205,550.00 minus debits 25.00) (delta -79,025.00 USD)

and `summary.totals["USD (bank 03/100 credits)"]` states `basis: "credits minus debits
(net)"` with `credits` and `debits` beside it. The delta itself is unchanged, because
net-of-fees is what the payment total is compared against; what changed is that the fee is
now named instead of hidden. A reader who wants the gross view has the number in the same
finding.

## 5. Fixtures: `samples/data/bai2-good.txt`, `bai2-bad.txt`

| file | records | what it proves |
|---|---|---|
| `bai2-good.txt` | 16 | comma-delimited statement of the same settlement account; reconciles to `PASS` against `820-good.txt` |
| `bai2-bad.txt` | 16 | (1) detail `NWP-2611-0010` missing (820-only `REF_UNMATCHED`), (2) bank-only debit fee `BANK-FEE-2611` (type code `409`, so -25.00), (3) the `03`/`49`/`98` totals left at the good values -> `CONTROL_TOTAL_MISMATCH` delta -79,025.00 USD (credits 1,205,550.00 - debits 25.00) and `BAI2_CONTROL_MISMATCH` at the account trailer |

Both are generated by `scripts/gen-fixtures.mjs` and asserted by
`test/unit/fixtures.test.ts`, so a fixture that drifts from this document fails the
build.
