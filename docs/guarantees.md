# What 「820」 guarantees, and what it does not

This file is part of the product, not a disclaimer appendix. It is shown in the web UI and printed by `820 verify`.

## Guaranteed (mechanically verifiable)
1. **Format interpretation** - each field is sliced exactly at the byte position and length the copybook declares, and every value is reported as the bytes hold it. Three comparisons read a value after trimming surrounding spaces, and they are the only ones: the `REDEFINES` discriminator (`@view`), the trailer's record-type check, and the currency code.
2. **One layout per record** - a `REDEFINES` region (one byte range, several layouts) decodes exactly the layout its discriminator selects; an unmatched record is `REDEFINES_VIEW_UNMATCHED` and its bytes stay undecoded, never guessed.
3. **Arithmetic** - amounts are `bigint` minor units with an ISO-4217 currency; totals and deltas are exact, and never computed in floating point.
4. **Reference reconciliation** - every 820 reference either matches a bank record or appears in the report as `REF_UNMATCHED`; nothing is dropped silently.
5. **Reproducibility** - running `verify` on an output directory re-derives the verdict and compares a SHA-256 fingerprint. Same inputs, same verdict; otherwise the differing field path is printed. When an exception ledger sits beside the report, `verify` also prints its entry count and head hash and fails if the ledger no longer matches them.
6. **Explanation grounding** - an explanation may cite only numbers present in the finding it explains, or it is replaced with `INSUFFICIENT_EVIDENCE`; the default explainer is a zero-credit template, not a model.

## Not guaranteed (human decides)
1. **Legal or accounting adequacy** of a payment or its remittance advice.
2. **Whether an exception is acceptable** - a human must attach a reason, an expiry date, and a compensating control. The tool only refuses to let an exception exist without them.
3. **Coverage of unmodelled clauses** - `OCCURS DEPENDING ON`, binary `COMP` and `SIGN LEADING OVERPUNCH` are `UNSUPPORTED_STRUCTURE` in a copybook; a `REDEFINES` with no activation rule is `COPYBOOK_SEMANTICS`; no copybook is `SPEC_MISSING`. None is guessed. **EBCDIC source is not decoded**: this build reads ASCII and latin1 bytes, so an EBCDIC file fails the layout and amount checks (`RECORD_LENGTH_MISMATCH`, `FIELD_INVALID_NUMERIC`, `BAI2_STRUCTURE`) and cannot earn a PASS. It is the largest gap for mainframe estates, and reading it is a roadmap item rather than a claim.
4. **Source data authenticity** - the tool verifies internal consistency, not whether the bank sent the right file.
5. **The ANSI X12 transaction set** - the input is a positional file plus its copybook, or a BAI2 statement. A delimited ANSI X12 transaction set (`ST*820*...~`), which carries the same 820/823 numbers, is not parsed: there is no segment parser in this build and it is a roadmap item. An 823 is read here as the bank side remittance and lockbox confirmation, not as a receipt saying a payment was made.
6. **An immutable history** - the register is a keyless SHA-256 chain: each link hashes the previous hash and the entry, and the head (count and hash) is recorded beside it. That detects an entry that was edited, reordered or cut from the tail, and `820 verify` fails on one. It does not prevent the edit. Anyone who can write the ledger file can recompute every hash and the head and produce a file that still verifies, because there is no key the writer lacks and no witness outside the file. This is tamper detection, not proof of an original history: an outside anchor for the head is a roadmap item.

## Why this file exists
The web screen and `820 verify` read this file rather than restating it, so the guarantee a reviewer sees on screen is the one the code implements, and neither can drift without the other changing in the same commit. The list also draws the line the product will not cross on its own: past it, a named person makes the decision and signs the ledger entry. A reconciliation tool that cannot say where its certainty ends is not usable in a regulated back office, and a reader that guessed there would be worse than one that refuses.
