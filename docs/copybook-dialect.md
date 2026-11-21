# Copybook dialect — what 「820」 reads, and what it refuses

The compiler (`src/copybook/compiler.ts`) accepts a **deliberate subset** of COBOL data
declarations. The subset is small on purpose: every clause it does not understand is a
line it would otherwise have to guess at, and guessing is how a 99-byte record silently
becomes a 100-byte one.

## 1. Field lines

```
      * @framing line
       01  PAYMENT-RECORD.
           05  REC-TYPE   PIC X(1).
           05  AMOUNT     PIC S9(11)V99 SIGN TRAILING OVERPUNCH.
           05  ORIG-ID    PIC X(10).
```

- Level numbers are accepted (`01` names the record, `05` names a field). A line without
  a `PIC` clause is a record or a refused group line; it is never silently skipped.
- Field names keep their source spelling (upper case, `-` or `_`), because the copybook is
  the vocabulary the finance team already uses.
- `POSITION n` / `OFFSET n` may state a field's 1-based byte offset explicitly. Without it,
  offsets accumulate. Explicit positions are what makes `COPYBOOK_OVERLAP` reachable, so it
  is checked rather than assumed.

## 2. Picture → type, sign, width

| picture | type | bytes |
|---|---|---|
| `X(n)` | `string` | n |
| `9(n)` | `unsigned-int` | n |
| `9(n)V9(m)` | `implied-decimal`, scale m | n+m |
| `S9(n)` / `S9(n)V9(m)` + `SIGN LEADING SEPARATE` | `signed-int` | n+m+1 |
| `S9(n)` / `S9(n)V9(m)` + `SIGN TRAILING SEPARATE` | `signed-int` | n+m+1 |
| `S9(n)` / `S9(n)V9(m)` + `SIGN TRAILING OVERPUNCH` | `zoned-decimal` | n+m |
| `S9(n)` / `S9(n)V9(m)` + `COMP-3` | `packed-decimal` | ⌈(n+m+1)/2⌉ |
| `FILLER` (any picture) | `filler` (sliced, not exposed) | per picture |

Rules that are enforced, not documented-and-hoped:

- A **signed display** field must declare its sign convention. COBOL's implicit default is
  a convention, not a fact about the file, so the compiler refuses to assume it:
  `COPYBOOK_UNPARSABLE` naming the line.
- `V` never consumes a byte. `PIC 9(11)V99` is 13 bytes; `PIC S9(11)V99` is 13 bytes with the
  sign folded into the last digit; `COMP-3` is 7 bytes.
- `COMP-3` requires a numeric picture. The sign nibble is `C`/`F` (positive) or `D` (negative);
  any other nibble is `FIELD_INVALID_NUMERIC`, not a guess.

## 3. Directives — the part that is not COBOL

Comment lines beginning `*` are comments, except `* @name key=value ...`, which the compiler
reads as metadata. This is how a copybook states *meaning* as well as layout:

```
* @framing line
* @semantics amount=AMOUNT currency=CURRENCY valueDate=VALUE-DATE dateFormat=CCYYMMDD reference=REFERENCE transactionType=TXN-TYPE creditValue=C debitValue=D
* @control typeField=REC-TYPE trailerValue=T countField=REC-COUNT totalField=AMOUNT currencyField=CURRENCY
```

- `@semantics` names the fields the reconciler must treat as the amount, its currency, the
  value date, the reference and the transaction type. Without it the file parses but cannot
  be reconciled — and the compiler says so in `notes` instead of inventing a mapping.
- `@control` names the trailer record and the fields that hold its count and total.
- `@framing line|fixed`: `line` means newline-delimited records; `fixed` means an unblocked
  byte stream sliced every `recordLength` bytes (what a mainframe file usually is, and what
  COMP-3 data forces — a binary payload can contain `0x0A`).

Referenced field names are validated: a directive pointing at a field that does not exist, or
at a field of the wrong kind (an amount that is alphabetic), is `COPYBOOK_SEMANTICS`.

## 4. `REDEFINES` — one byte range, several layouts

A bank's copybook does not give the trailer its own field range. It gives the record one
100-byte area and declares the trailer as a second description of that same area:

```
       05  RECORD-BODY.
           10  PAYMENT-DETAIL.
               15  AMOUNT          PIC S9(11)V99 SIGN TRAILING OVERPUNCH.
               ...
           10  PAYMENT-TRAILER REDEFINES PAYMENT-DETAIL.
               15  TOTAL-AMOUNT    PIC S9(11)V99 SIGN TRAILING OVERPUNCH.
               15  REC-COUNT       PIC 9(6).
               ...
```

「820」 reads that as a **region**: one byte range (`PAYMENT-DETAIL`, bytes 2–101 in
`samples/copybooks/820-redefines.cpy`) with two **layouts**. What COBOL does not say is which
record type uses which layout, and that is exactly the place where a reader can produce a
number nobody can audit. So the copybook must say it, with one directive per layout:

```
* @view layout=PAYMENT-DETAIL  typeField=REC-TYPE value=P
* @view layout=PAYMENT-TRAILER typeField=REC-TYPE value=T
```

Rules the compiler enforces, not documents-and-hopes:

- The redefining item must be at the same level-number and must not be wider than the item it
  redefines (`COPYBOOK_REDEFINES`).
- Every layout needs an activation rule. A `REDEFINES` with no `@view` is refused
  (`COPYBOOK_SEMANTICS`) rather than read as whichever layout happens to fit.
- `typeField` must be alphabetic and must sit **outside** the region — a discriminator that
  changes with the layout cannot choose it.
- One discriminator value selects one layout; two layouts claiming the same value are refused.
- Overlap is only allowed between layouts of the same region. Two fields of one layout that
  overlap are still `COPYBOOK_OVERLAP`.
- Level numbers 01/05/10/15 may form groups (`05 RECORD-BODY.`); a group owns no bytes and its
  width is the sum of its children.

At parse time the discriminator is read from the bytes, exactly one layout is decoded, and the
other layout's field names are **absent** from the record (they are not decoded to null, they
are not present at all). A record whose discriminator matches no layout is reported as
`REDEFINES_VIEW_UNMATCHED`; its shared bytes stay undecoded and the run cannot earn a `PASS`.

A record with no region in play (an `820.cpy` without `REDEFINES`) contributes no new
component to the fingerprint, so the six original sample scenarios keep the fingerprints an
earlier build recorded (`test/regressions/redefines-view.test.ts` pins them).

## 5. Refused on purpose (`UNSUPPORTED_STRUCTURE`)

| clause | why |
|---|---|
| `OCCURS n TIMES`, `OCCURS DEPENDING ON` | repeated groups change every offset after them, and the repeat count lives in the data rather than the copybook |
| `COMP`, `COMP-1`, `COMP-2`, `BINARY` | binary integers/floats are not the same byte order or width as packed decimal |
| `SIGN LEADING OVERPUNCH` | not a real convention |
| EBCDIC source encoding | the samples are ASCII transliterations; EBCDIC needs a code-page decision at the door, not inside field parsing |

Each refusal names the clause and the copybook line, so a reviewer can see exactly where the
guarantee stops (`docs/guarantees.md`).

## 6. What the scaffold copybook got wrong (real, recorded)

The first `samples/copybooks/820.cpy` in this repo said "90 bytes per record" in its header
while its fields summed to 88, and it carried a one-byte `SIGN-IND PIC X(1) SIGN TRAILING
OVERPUNCH` field whose sign was supposed to apply to a *different* field's amount. Neither
could be implemented without inventing a rule, so:

- the record length now comes from the field sum only (a comment can never change it), and
- the amount field itself carries the overpunch (`PIC S9(11)V99 SIGN TRAILING OVERPUNCH`),
  which is the convention the steering file's table describes, and
- the layout was completed with `REC-COUNT` and a `T` trailer so control totals are declared
  where they belong — in the file.

This is the honest version of "the copybook is the spec": when the spec contradicts itself,
the tool says so and a human fixes the spec.

## 7. What is *not* a copybook at all

BAI2 is comma-delimited and has no copybook. It is read by `src/bai2/reader.ts`, whose
spec object declares `format: 'bai2'`, `recordLength: 0` and no fields — the field
offsets live on each record (`TypedRecord.spans`) because they depend on the record's
own content. Faking a fixed layout for it would have made `verify` reproduce a layout the
bank never sent. [`docs/bai2.md`](bai2.md) has the record tables and the control-total
reasoning.
