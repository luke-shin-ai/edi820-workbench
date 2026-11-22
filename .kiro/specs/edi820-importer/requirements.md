# Requirements: edi820-importer

> Written in EARS form. These requirements are the contract for `src/parser`, `src/reconcile`.
> Source material: the sample COBOL copybooks in `samples/copybooks/` and the public X12 820/823 + BAI2 record layouts.

## 1. Copybook model
**R1.1** WHEN a copybook file is loaded, THE SYSTEM SHALL parse each `NN name PIC <pic>` / `value` line into a field with `(name, start, length, type, pic)` where `start` is derived cumulatively from declared lengths, 1-based.
**R1.2** WHEN a copybook declares `PIC 9(n)V9(m)`, THE SYSTEM SHALL expose the field as `implied-decimal` with scale `m` and integer capacity `n`.
**R1.3** WHEN a copybook declares `SIGN TRAILING OVERPUNCH`, THE SYSTEM SHALL record the sign convention on the field so the parser decodes it by table.
**R1.4** WHEN a copybook line cannot be understood, THE SYSTEM SHALL fail with `COPYBOOK_UNPARSABLE` naming the line number - it SHALL NOT skip the line silently.
**R1.5** IF two fields overlap in byte range, THEN THE SYSTEM SHALL report `COPYBOOK_OVERLAP` with both field names.

## 2. Parsing fixed-width data
**R2.1** WHEN a data file is parsed with a copybook, THE SYSTEM SHALL slice each record by the copybook's field boundaries without trimming.
**R2.2** WHEN a record's byte length differs from the copybook record length, THE SYSTEM SHALL emit `RECORD_LENGTH_MISMATCH` with record index and both lengths, and SHALL continue parsing at the declared record boundary.
**R2.3** WHEN a numeric field contains characters invalid for its `pic`, THE SYSTEM SHALL emit `FIELD_INVALID_NUMERIC` with record index and field name.
**R2.4** WHEN a signed field is decoded, THE SYSTEM SHALL preserve the sign exactly as declared (leading separate, trailing separate, trailing overpunch).
**R2.5** WHEN a field has an implied decimal, THE SYSTEM SHALL scale the integer to minor units using the copybook scale and attach the record's ISO-4217 currency code.
**R2.6** WHEN the file declares a record count or control total, THE SYSTEM SHALL return both declared and computed values in the parse result.

## 3. Round-trip fidelity
**R3.1** WHEN a parsed file is serialized back, THE SYSTEM SHALL produce a byte-identical file to the input (property-verified).
**R3.2** WHEN parsing fails for a record, THE SYSTEM SHALL still allow serializing the surrounding records byte-identically.

## 4. Reconciliation
**R4.1** WHEN control totals are present, THE SYSTEM SHALL compare declared vs summed amounts per currency and emit `CONTROL_TOTAL_MISMATCH` with signed `delta`.
**R4.2** WHEN record counts are present, THE SYSTEM SHALL compare declared vs actual count and emit `CONTROL_COUNT_MISMATCH`.
**R4.3** WHEN a payment reference in an 820 has no counterpart in the matching 823/BAI2 record set, THE SYSTEM SHALL emit `REF_UNMATCHED` with the reference and its record index.
**R4.4** WHEN a value date falls outside the settlement window, THE SYSTEM SHALL emit `DATE_OUT_OF_WINDOW` with both dates.
**R4.5** WHEN all checks pass, THE SYSTEM SHALL emit a verdict object with `status=PASS` and a fingerprint over the normalized result.
**R4.6** WHEN a declared control total names a currency no detail record uses, or names none while the details carry more than one currency, THE SYSTEM SHALL emit `MISSING_CURRENCY` and SHALL NOT compare the total against another currency's bucket.

## 5. Explanation (agent layer)
**R5.1** WHEN findings exist, THE SYSTEM SHALL present each finding to the agent as structured data only (code, record index, field, declared, computed, delta).
**R5.2** WHEN the agent explains a finding, THE SYSTEM SHALL reject any explanation that cites a number not present in the finding.
**R5.3** WHEN a finding has no supporting values, THE SYSTEM SHALL return `INSUFFICIENT_EVIDENCE` instead of an explanation.

## 6. Verification and guarantees
**R6.1** WHEN `verify` is run on an existing output directory, THE SYSTEM SHALL re-derive the verdict and compare fingerprints without mutating any file.
**R6.2** WHEN fingerprints differ, THE SYSTEM SHALL print both and the first differing field path.
**R6.3** The report SHALL list what it guarantees and what it does not (referencing `docs/guarantees.md`).

## 7. Out of scope (recorded so it is not silently assumed)
- Full X12 transaction-set coverage; bank-specific dialects without a copybook; any network transfer of file contents; automatic payment authorization.

## 8. L4: exception register (the human decision, recorded)

> `docs/guarantees.md` says an exception is the human's call and the tool only refuses to let
> one exist without a reason, an expiry and a compensating control. These requirements are
> that sentence made executable.

**R8.1** WHEN an exception is waived, THE SYSTEM SHALL append one immutable entry to a ledger holding the finding key, code, record index, owner, reason, compensating control, decision date, an expiry date, the reconciliation fingerprint it was decided against, and the hash chain (`prevHash`, `hash`). The expiry is required: an exception without an end date is not a decision.
**R8.2** WHEN a decision entry is appended, THE SYSTEM SHALL reject an empty owner, an empty reason, an empty compensating control, a missing or malformed expiry date, or an expiry date before the decision date, and SHALL leave the ledger unchanged when it rejects.
**R8.3** WHEN a ledger is read, THE SYSTEM SHALL re-derive every hash and every `prevHash` link, and SHALL refuse to classify findings from a ledger that fails, naming the first invalid sequence number.
**R8.4** WHEN a finding is classified against a ledger, THE SYSTEM SHALL return `OPEN` (no waiver), `WAIVED` (a waiver whose expiry still covers the reporting date), `EXPIRED` (expiry before the reporting date) or `RELEASED` (a release recorded for that waiver); a waiver whose finding key differs SHALL NOT cover the finding.
**R8.5** WHEN a waiver is released, THE SYSTEM SHALL require the id of an existing unreleased waiver and SHALL keep the earlier decision in the ledger; the finding returns to `OPEN` adjudication rather than disappearing.
**R8.6** WHEN the CLI reports exceptions, THE SYSTEM SHALL exit 0 when no finding is `OPEN` or `EXPIRED`, 2 when at least one is, and 3 on a ledger integrity failure or a waiver naming a finding the report does not hold.
**R8.7** WHEN the register is consulted, THE SYSTEM SHALL NOT change the deterministic verdict: a waived finding keeps the L2 verdict and is reported beside it, never instead of it.
**R8.8** WHEN the reviewer agent needs the register state, THE SYSTEM SHALL expose it as a read-only MCP tool (`exceptions`) returning the same classification as the CLI.
