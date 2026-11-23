---
inclusion: always
---

# Product: 「820」

## What this is
「820」 is a resurrection workbench for **fixed-width corporate payment and reconciliation files** - the 820/823 style files that ANSI X12 EDI defines and that enterprises store positionally, described by **COBOL copybooks**, plus bank **BAI2** statements. In this build those formats are the fixed-width files a copybook describes; a delimited ANSI X12 transaction set (`ST*820*...~`) is not parsed. The file formats are alive in enterprise back offices; the tools and people who could read them are gone.

Given a data file plus its copybook, 「820」:
1. **types every record** with a deterministic parser (no AI),
2. **reconciles** control totals, amounts, currencies, and reference chains (no AI),
3. **explains each discrepancy** in plain language, citing only values produced by steps 1-2 (agent),
4. **hands the decision to a human**, who must attach a reason, an expiry date, and a compensating control to every exception.

## Who it is for
Finance back-office and compliance staff who receive these files daily and currently retype them into spreadsheets: treasury operations, settlement/reconciliation analysts, internal audit.

## Product promises (what we guarantee)
- A record that parses is typed exactly per the copybook (position, length, type, sign/decimal rules).
- Arithmetic and reference reconciliation is deterministic and re-runnable: the same input yields the same verdict and the same fingerprint.
- Every agent explanation cites existing parse/reconcile values; the agent may not introduce new numbers.

## What we explicitly do NOT guarantee
- Legal or accounting adequacy of a payment (human decision, layer L4).
- Coverage of every X12 transaction set or every bank dialect.
- Reading files with no usable copybook (out of scope; the tool reports `SPEC_MISSING`).

## Success criteria for the hackathon build
- Three sample files (820, 823, BAI2) parse, reconcile, and explain end-to-end from a single command and a single screen.
- At least one property-based test failure found and fixed during development, with the record kept.
- `.kiro/` artifacts (specs, steering, hooks) are real and were used to build the app.
