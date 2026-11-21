# samples/ — synthetic fixtures only

**Never place real bank, customer or employer data in this folder.** Everything here is generated for the demo under the fictional company *Northwind Pay*.

## Contents (target state)

| path | what | deliberate defect |
|---|---|---|
| `copybooks/820.cpy` | 90-byte payment-order layout (✅ added) | — |
| `copybooks/823.cpy` | bank side of the same remittance | — |
| `copybooks/bai2.cpy` | bank statement layout (`03`/`16`/`49`/`98` records) | — |
| `data/820-good.txt` + `823-bank.txt` | matching pair, all checks pass | none |
| `data/820-bad.txt` + `823-bank.txt` | demo failure pair | ① control total off by −100.00 ② one record 1 byte short ③ one reference absent from the bank file |

## Generation rule
`scripts/gen-fixtures.mjs` (todo, task T0.3) creates the files from a seed so the demo is reproducible:
- account numbers `0000-####` sequential
- personal names from a fixed synthetic list
- amounts round numbers so a `delta` is visually obvious
- every defect is listed in `data/DEFECTS.md` next to the file it corrupts

The defect list is part of the demo: the video shows the tool finding exactly the defects the fixture author planted, and nothing else.
