---
inclusion: fileMatch
fileMatchPattern: ["src/copybook/**", "src/parser/**", "src/reconcile/**", "samples/copybooks/**"]
---

# Finance file conventions (domain knowledge for the parser)

## Amounts
- Amounts arrive **minor-unit-scaled** by an implied decimal or packed decimal. Carry `bigint` + currency.
- Sign conventions differ per copybook: `SIGN TRAILING OVERPUNCH` encodes `{`=+0, `}`=-0, `A`..`I`=+1..9, `J`..`R`=-1..-9. Decode by table only.
- A credit (payment out) and a debit (payment in) may both appear in 820; never infer direction from sign alone - the copybook's `TRANSACTION_TYPE` field decides.

## Control totals in 820/823/BAI2
- `CTR` / trailer records declare counts and sums. **Compare count and sum separately**; a matching sum with a wrong count is still a failure.
- BAI2 record codes are not interchangeable: `03` is the **account identifier and summary**
  (the only place a `100` *total credits* declaration lives), `49` is the **account trailer**,
  `98` the **group trailer**, and `99` the **file trailer** holding the file control total,
  the number of groups and the number of records. `49`/`98`/`99` are trailers, `03` is not.
- BAI2 `03`/`100` is a **gross credits** declaration. Compare it against a figure whose
  credit and debit parts are both named; never fold a debit (a bank fee) into the same
  delta without saying so (`docs/bai2.md` §4).

## References and matching
- 820: `TRN*1*<trace>` (interchange trace), `RMR*<ref>*<amount>` (remittance detail).
- 823: `RMR`/`REF*` echo the same references from the bank side.
- Matching rule: reference exact match first; then `(amount, currency, value-date)` window; anything else is unmatched and must be reported, never dropped.

## Dates
- `DTM*` qualified dates (0097 = value date, 0035 = settlement). Copybook declares the format (`CCYYMMDD` vs `YYMMDD`); never guess the century.

## Data hygiene
- Sample data is synthetic. Use the fictional company **Northwind Pay**, account numbers like `0000-{sequence}`, and generated personal names. Never paste anything from an employer's systems.
