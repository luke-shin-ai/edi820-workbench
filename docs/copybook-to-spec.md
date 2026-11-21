# Copybook → Kiro spec: the conversion log

> This document is both a build artifact and a demo asset. It records **what actually happened** when a legacy 1970s-style record definition was turned into a Kiro spec.
> Rule: only write here what happened; if a step was done by hand, say so.

## Why convert a spec at all
A COBOL copybook is a *byte contract*: it says where a field starts, how wide it is, how the sign is encoded and how many implied decimals it carries. None of that is a requirement — it is an implementation detail. The resurrection problem is that the **meaning** (what must be true about the numbers) was never written down anywhere; it lived in people's heads.

So the conversion is:
`copybook (bytes)` → **requirements (what must hold)** → **design (how the parser enforces it)** → **tasks (small verifiable steps)**

## What the copybook decides by itself
- Field name, start offset, length, type, sign convention, implied decimal scale
- Record length, therefore the boundary at which a corrupted record must be reported

## What it does NOT decide (and needed a human/agent decision)
| Question | Where it was decided | Note |
|---|---|---|
| Is a short record re-synchronised or reported? | `requirements.md` R2.2 | reported, never re-synced — silent re-sync hides exactly the corruption auditors care about |
| Are declared totals compared per currency or as one number? | R4.1 | per currency; a mixed-currency total is meaningless |
| Is a reference match "exact only" or "fuzzy"? | R4.3 | exact, then (amount, currency, value-date) window; anything else is a finding |
| May the agent explain without a finding? | R5.1–R5.3 | no; `INSUFFICIENT_EVIDENCE` instead |
| Are amounts floats? | `tech.md` §Amounts | never; `bigint` minor units |

## Where Kiro changed the outcome (fill in as it happens)
- [ ] Requirement Kiro added that we had missed: ______
- [ ] Design decision Kiro proposed and we rejected, and why: ______
- [ ] Test the spec-driven flow produced that we would not have written: ______
- [ ] Steering rule that visibly changed generated code: ______

## Honest notes
- Conversion was done with `kiro-cli` on the sample copybooks in `samples/copybooks/`.
- Anything that was typed by hand rather than produced by Kiro is marked **[manual]**.
