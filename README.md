# 「820」 — resurrection workbench for dead payment files

> Kiroween 2026 · **Resurrection** category · built with Kiro (spec-driven, steering, hooks, MCP, PBT)

> **Build status (2026-11-21):** repository scaffolding. `.kiro` spec, steering, hooks and agent definitions are complete; `src/` lands per `tasks.md`. The commands below describe the target CLI contract (tasks T5.1–T5.4).

Corporate payment files never died. The people and tools that could read them did.

**EDI 820/823** remittance files, bank **BAI2** statements, and the **COBOL copybooks** that describe them still move between banks and ERP systems every day — as fixed-width text that no modern system can interpret. Back-office teams retype them into spreadsheets and hope.

「820」 takes a file **and its copybook** and does four things, in four separate layers:

| Layer | What it does | AI? |
|---|---|---|
| L1 parser | types every record exactly per the copybook (position, length, sign, implied decimals) | no |
| L2 reconciler | control totals, counts, references, date windows → coded findings with signed deltas | no |
| L3 explainer | explains each finding in plain language, citing only values L1/L2 produced | yes (Kiro agent) |
| L4 human | attaches reason + expiry + compensating control to each exception | human |

The verdict is **deterministic and re-verifiable** (`820 verify`); the model never decides whether numbers match.

## Run it

```bash
npm install
npx tsx src/cli/index.ts parse     --copybook samples/copybooks/820.cpy --file samples/data/820-good.txt --out out/
npx tsx src/cli/index.ts reconcile --copybook samples/copybooks/820.cpy --file samples/data/820-bad.txt --bank samples/data/823-bank.txt
npx tsx src/cli/index.ts explain   --findings out/report.json
npx tsx src/cli/index.ts verify    out/     # re-derive + compare fingerprint, read-only
```

Exit codes: `0` all checks pass · `2` findings present · `3` spec or I/O error.

## How Kiro built it (evidence, not adjectives)

- `.kiro/specs/edi820-importer/` — `requirements.md` (EARS) → `design.md` → `tasks.md`, derived from the copybooks themselves
- `.kiro/steering/` — product, tech (parsing rules), structure, conventions, and finance-file domain rules
- `.kiro/hooks/` — tests on save, re-verify after each agent turn, evidence appended on task completion
- `.kiro/agents/reviewer.json` — adversarial cross-review agent
- `EVIDENCE.md` — the append-only build log those hooks produced
- `docs/copybook-to-spec.md` — how a legacy spec document became a Kiro spec (what it got right, what it got wrong)

## What this guarantees / does not guarantee

See [`docs/guarantees.md`](docs/guarantees.md). Short version: it guarantees format interpretation and arithmetic/reference reconciliation; it does **not** guarantee legal or accounting adequacy — that stays with a human, on purpose.

## Data

All sample data is **synthetic** (fictional company *Northwind Pay*). No customer, bank or employer data is used anywhere in this repository.

## License

Apache-2.0 — see `LICENSE`.
