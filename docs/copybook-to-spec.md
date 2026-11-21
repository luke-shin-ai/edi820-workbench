# Copybook → Kiro spec: the conversion log

> This document is both a build artifact and a demo asset. It records **what actually happened**
> when three legacy record definitions were turned into a Kiro spec, including the parts that were
> typed by hand and the parts Kiro did not do.
> Rule: if a step was done by hand, it says `[manual]`. If it was not verified, it says so.

## Why convert a spec at all

A COBOL copybook is a *byte contract*: where a field starts, how wide it is, how the sign is
encoded, how many implied decimals it carries. None of that is a requirement. It is an
implementation detail of a file format whose readers have retired.

The meaning (what must be true about the numbers, and what must happen when it is not) was never
written down in the copybook. It lived in the heads of people who ran the settlement.

So the conversion is:

```
copybook (bytes)  →  requirements (what must hold)  →  design (how the code enforces it)  →  tasks (small verifiable steps)
```

The output of that conversion is `.kiro/specs/edi820-importer/{requirements,design,tasks}.md`.
This file records how each line got there.

## Step 0: the three byte contracts

Three synthetic copybooks were written first, each representing a real convention that modern
tooling drops. The numbers below are printed by `demo-video/build/dump-copybook.mjs`, which calls
the real compiler (`src/copybook/compiler.ts`), not a hand count.

| copybook | record length | framing | amount field | sign convention | bytes of AMOUNT |
|---|---|---|---|---|---|
| `820.cpy` | 100 | line (LF) | `PIC S9(11)V99` | trailing overpunch | 24–36 (13) |
| `820-packed.cpy` | 88 | fixed (no newlines) | `PIC S9(11)V99 COMP-3` | packed nibble C/D | 24–30 (7) |
| `823.cpy` | 80 | line (LF) | `PIC S9(11)V99 SIGN LEADING SEPARATE` | leading separate | 25–38 (14) |

Two facts came out of writing them:

1. **The three files carry the same numbers in three different byte layouts.** `820.cpy` and
   `820-packed.cpy` describe the same ten payments; only the amount encoding and the record width
   differ. If the parser handled "one copybook dialect", the claim "we resurrect fixed-width EDI"
   would be thinner than it sounds.
2. **`820-packed.cpy` cannot be newline-framed.** A COMP-3 payload is binary; the byte `0x0A` can
   appear inside an amount. That is why the compiler has a `@framing fixed` directive at all, and
   why `R3.1` (round trip) is asserted on a byte stream, not on lines.

## Step 1: what a copybook decides by itself (no human, no agent)

- field name, start offset, length, type
- picture → width: `X(n)` is n bytes, `9(n)V9(m)` is n+m, `COMP-3` is ⌈(digits+1)/2⌉
- record length, therefore the boundary at which a corrupted record must be reported
- sign convention, when the copybook declares one

The compiler refuses everything it cannot derive: a signed display field without a `SIGN` clause is
`COPYBOOK_UNPARSABLE`, `REDEFINES` / `OCCURS` / `COMP` are `UNSUPPORTED_STRUCTURE`, and two fields
that overlap are `COPYBOOK_OVERLAP` naming both. The full list is in
[`copybook-dialect.md`](copybook-dialect.md) §4.

## Step 2: what the copybook does not decide, and where each answer went

This is the actual conversion work. Each row is a decision that a spec has to make and a copybook
cannot.

| Question the bytes do not answer | Answer written into | How it was decided | Evidence |
|---|---|---|---|
| Is a short record re-synchronised, or reported? | `R2.2` | `[manual]` human decision: report and continue at the declared boundary | `test/unit/parser.test.ts`, `RECORD_LENGTH_MISMATCH` on record 6 of `820-bad` |
| Are declared totals compared per currency or as one number? | `R4.1` | `[manual]` human decision: a mixed-currency total is meaningless | `test/unit/reconcile.test.ts` (multi-currency case) |
| Is a reference match exact only, or is a fallback allowed? | `R4.3` | `[manual]` exact first, then amount + currency + value date inside the window; a fallback match is still a match and is never dropped | `src/reconcile/reconciler.ts` §matching, `docs/copybook-dialect.md` |
| May the agent explain a finding without values? | `R5.1–R5.3` | `[manual]` no: `INSUFFICIENT_EVIDENCE` instead | `test/unit/explain.test.ts` (adapter spy call count 0) |
| Are amounts floats? | `.kiro/steering/tech.md` §Amounts | `[manual]` never: `bigint` minor units plus the copybook's scale | `design.md` §10 delta 1 |
| Which field is the amount, the reference, the date? | `@semantics` directive | `[manual]` the copybook states it, so the reconciler never hard-codes a field name | `src/copybook/compiler.ts`, `COPYBOOK_SEMANTICS` on a bad reference |
| Does a trailer declare a count and a total? | `@control` directive | `[manual]` the file says so; without it the parse is valid but not reconcilable | `samples/copybooks/*.cpy`, `notes` on the compiled copybook |

`@semantics` / `@control` / `@framing` are not COBOL. They are a small extension this project added
to the comment block, so that **meaning travels with the byte contract** instead of being compiled
into the analyser. A copybook with no directives still parses; it simply cannot be reconciled, and
the compiler says so in `notes` rather than guessing a mapping.

## Step 3: the spec chain as it was built

- `requirements.md` — 24 requirements in EARS form across six groups (copybook model, parsing,
  round trip, reconciliation, explanation, verification), plus an explicit out-of-scope section.
- `design.md` — the layer split (L1 parser → L2 reconciler → L3 explainer → L4 human), the data
  model, the algorithms, and **nine implementation deltas** written while building, each naming
  what the design said first and why it changed.
- `tasks.md` — T0.1 through T6.6, each with the command whose output goes into `EVIDENCE.md`.

The chain was used backwards as well as forwards: when the PBT suite found that an overpunch table
mapped `A → 0` instead of `A → +1`, the fix landed in code and the regression was recorded in
`tasks.md` T2.5, not quietly patched.

## Step 4: where Kiro changed the outcome

The four questions this section was created to answer, answered honestly.

- [x] **Requirement Kiro added that we had missed.**
  Not from the Kiro spec flow, which was not run inside the IDE (see below). It came from the Kiro
  **custom reviewer agent**. Its pass-2 review claimed a blank reference could match another blank
  reference. That specific claim was wrong in direction, but checking it by hand exposed the real
  hole: `referenceRecords` **skipped** records with a blank reference, so such a record never
  reached `REF_UNMATCHED`. That is a dropped reference, against guarantee 3. It is now `R4.3`
  behaviour with two tests: "reports a blank reference instead of letting two blanks agree" and
  "counts matched references directly". `[manual]` confirmation, agent-originated lead.
- [x] **Design decision Kiro proposed and we rejected, and why.**
  Reviewer pass 2, with no tools in its config, reported a BLOCKER that "no decoder exists for
  zoned/packed; `parseField()` returns `value as number`". `decodeZonedDecimal` and
  `decodePackedDecimal` are both in `src/parser/decode.ts`, and `parseField` does not exist. Two
  further MAJOR findings were false in the same way (`CURRENCY_SCALE_MISMATCH` *is* emitted in
  `src/parser/parser.ts`; an invalid overpunch *does* throw). Rejected on evidence, and the reason
  is recorded in `docs/kiro-cli-validation.md` §5 because it is the failure mode this product is
  built against: a model narrating confidently about code it never opened.
- [x] **Test the spec-driven flow produced that we would not have written.**
  Two, both from the reviewer's third pass (config fixed with `tools: [read, grep, glob, thinking]`):
  the blank-reference test above, and a test that the matched count is computed inside the matching
  routine instead of being derived by string-matching a human sentence in `detail`. The second one
  caught a real fragility: `summary.referencesMatched` was being computed by subtracting findings
  whose detail contained `820-only`.
- [x] **Steering rule that visibly changed generated code.**
  `tech.md` §Amounts says amounts are never floating point. `design.md` §2 had typed numeric values
  as `number`, which is a float. The implementation uses `bigint` minor units plus the copybook's
  scale, and the change is recorded as implementation delta 1 in `design.md` §10 so a reviewer can
  see the steering file winning over the design draft.

**What Kiro did not do, stated plainly (this is also in the video and the write-up):**

- The Kiro IDE spec flow (`spec → tasks → implementation inside a session`) was **not** run. The
  spec was authored in this workspace from the copybooks, and the code was implemented here with
  the spec as the contract. `kiro-cli` was the Kiro surface actually executed: `whoami`,
  `agent list`, `agent validate`, and four `chat` turns with the custom reviewer agent.
- The hook definitions in `.kiro/hooks/parser-guardrails.json` are committed and were exercised by
  invoking the same commands by hand (`node scripts/append-evidence.mjs` produced the rows in
  `EVIDENCE.md`). Whether Kiro fires them inside a session is **not verified**, and no row in
  `EVIDENCE.md` claims it did.

## Step 5: what the conversion got wrong

Recorded here rather than in a commit message nobody reads.

1. **The first `820.cpy` contradicted itself.** Its header said 90 bytes, its `PIC` clauses summed
   to 88, and a one-byte `SIGN-IND PIC X(1) SIGN TRAILING OVERPUNCH` field claimed to carry the
   sign of a *different* field's amount. A compiler cannot implement that without inventing a rule.
   The record length now comes from the field sum only, and the sign convention sits on the amount
   field itself.
2. **The first reconciliation draft derived a number from prose.** `referencesMatched` was computed
   by counting findings whose `detail` contained `820-only`. It produced the right number in the
   demo and would have broken on the first wording change. It is now counted where the matching
   happens.
3. **The first BAI2 reader counted records in three branches.** A group record counter was
   incremented in three places, so the `98` trailer check could pass or fail for the wrong reason.
   It is now derived from the record index (`index - startIndex + 1`), which is what the trailer
   actually describes.

## Step 6: what this is worth in the write-up

The conversion produced 24 requirements, 9 recorded design deltas, and 222 tests from three
copybooks that contain no requirements at all. Six of the nine design deltas exist because a rule
had to be *decided*, and one of them exists because a steering file overruled the design draft.

That is the claim this project makes: a copybook tells you where the bytes are, and the spec is what
you write down so the next person does not have to be the person who knew.
