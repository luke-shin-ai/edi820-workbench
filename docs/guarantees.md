# What 「820」 guarantees, and what it does not

This file is part of the product, not a disclaimer appendix. It is shown in the web UI and printed by `820 verify`.

## Guaranteed (mechanically verifiable)
1. **Format interpretation** - each field is sliced exactly at the copybook's byte position and length; no trimming, no re-synchronisation.
2. **One layout per record** - a `REDEFINES` region (one byte range, several layouts) decodes exactly the layout its discriminator selects; an unmatched record is `REDEFINES_VIEW_UNMATCHED` and its bytes stay undecoded, never guessed.
3. **Arithmetic** - amounts are `bigint` minor units with an ISO-4217 currency; totals and deltas are exact, and never computed in floating point.
4. **Reference reconciliation** - every 820 reference either matches a bank record or appears in the report as `REF_UNMATCHED`; nothing is dropped silently.
5. **Reproducibility** - running `verify` on an output directory re-derives the verdict and compares a SHA-256 fingerprint. Same inputs, same verdict; otherwise the differing field path is printed.
6. **Explanation grounding** - an explanation may cite only numbers present in the finding it explains, or it is replaced with `INSUFFICIENT_EVIDENCE`; the default explainer is a zero-credit template, not a model.

## Not guaranteed (human decides)
1. **Legal or accounting adequacy** of a payment or its remittance advice.
2. **Whether an exception is acceptable** - a human must attach a reason, an expiry date, and a compensating control. The tool only refuses to let an exception exist without them.
3. **Coverage of unmodelled clauses** - `OCCURS DEPENDING ON`, binary `COMP`, `SIGN LEADING OVERPUNCH` and EBCDIC source are `UNSUPPORTED_STRUCTURE`; a `REDEFINES` with no activation rule is `COPYBOOK_SEMANTICS`; no copybook is `SPEC_MISSING`. None is guessed.
4. **Source data authenticity** - the tool verifies internal consistency, not whether the bank sent the right file.

## Why this file exists
Judges and reviewers reward systems that state their own limits. A reconciliation tool that claims to be "always right" is a liability; one that says "here is exactly where my guarantee stops, and here is who decides past that line" is usable in a regulated back office.
