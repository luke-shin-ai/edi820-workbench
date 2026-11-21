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

## 4. Refused on purpose (`UNSUPPORTED_STRUCTURE`)

| clause | why |
|---|---|
| `REDEFINES` | overlapping views need an active-view rule; guessing one produces numbers nobody can audit |
| `OCCURS n TIMES` | repeated groups change every offset after them |
| `COMP`, `COMP-1`, `COMP-2`, `BINARY` | binary integers/floats are not the same byte order or width as packed decimal |
| `SIGN LEADING OVERPUNCH` | not a real convention |
| EBCDIC source encoding | the samples are ASCII transliterations; EBCDIC needs a code-page decision at the door, not inside field parsing |

Each refusal names the clause and the copybook line, so a reviewer can see exactly where the
guarantee stops (`docs/guarantees.md`).

## 5. What the scaffold copybook got wrong (real, recorded)

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
