# 「820」 — resurrection workbench for dead payment files

> Kiroween 2026 · **Resurrection** category · built with Kiro (spec-driven, steering, hooks, MCP, PBT)

> **Build status (2026-11-21):** stages 1 and 2 are implemented and green — L1 (copybook compiler + fixed-width parser + **BAI2 reader**), L2 (reconciler), **L3 (grounded explainer)**, and all four surfaces (**CLI, web screen, MCP server, BAI2**). `npx tsc --noEmit` is clean and `npx vitest run` is **222 tests / 17 files** (194 unit, 22 property-based, 6 regression), up from 148 before T4/T5. Stage 3 (T6: write-up, video, blog, Devpost submission) is what remains.

Corporate payment files never died. The people and tools that could read them did.

**EDI 820/823** remittance files, bank **BAI2** statements, and the **COBOL copybooks** that describe them still move between banks and ERP systems every day — as fixed-width text that no modern system can interpret. Back-office teams retype them into spreadsheets and hope.

「820」 takes a file **and its copybook** (or a BAI2 file, which needs none) and does four things, in four separate layers:

| Layer | What it does | AI? | Where |
|---|---|---|---|
| L1 parser | types every record exactly per the copybook or the BAI2 layout (position, length, sign, implied decimals) | no | `src/copybook`, `src/parser`, `src/bai2` |
| L2 reconciler | control totals, counts, references, date windows → coded findings with signed `bigint` deltas | no | `src/reconcile` |
| L3 explainer | explains each finding in plain language, citing only numbers L1/L2 produced; anything else becomes `INSUFFICIENT_EVIDENCE` | agent, optional | `src/explain` |
| L4 human | attaches reason + expiry + compensating control to each exception | human | (next stage) |

The verdict is **deterministic and re-verifiable** (`820 verify`); the model never decides whether numbers match, and by default it is not called at all.

## Run it

```bash
npm install
npm test                       # 222 tests: npx vitest run
npx tsc --noEmit               # strict typecheck, 0 errors
npm run demo:cli               # parse + reconcile six scenarios (820/823/fixed/COMP-3/BAI2), exit 0 if all PASS
```

### CLI

```bash
# fixed-width: the file plus its copybook
npm run cli -- parse     --copybook samples/copybooks/820.cpy --file samples/data/820-good.txt --out out/demo
npm run cli -- reconcile --copybook samples/copybooks/820.cpy --file samples/data/820-bad.txt \
                                  --bank samples/data/823-bank.txt --bank-copybook samples/copybooks/823.cpy \
                                  --window 2026-11-18..2026-11-20 --out out/demo
# BAI2: no copybook, just --format bai2
npm run cli -- reconcile --copybook samples/copybooks/820.cpy --file samples/data/820-good.txt \
                                  --bank samples/data/bai2-bad.txt --bank-format bai2 --out out/demo
npm run cli -- explain   --findings out/demo            # L3, deterministic adapter, 0 credits
npm run cli -- verify    out/demo                       # re-derive + compare, read-only
```

Exit codes: `0` all checks pass · `2` findings present (or a verification difference) · `3` spec or I/O error.
`explain` exits `2` when a finding cannot be grounded. `--json` prints the same document the report file holds.

### Web screen (three columns)

```bash
npm run web -- --port 8720     # then open http://127.0.0.1:8720/
```

[Left] copybook/file pickers, drop zones for your own files, records as read · [middle] verdict card, counters, control totals, findings, parse issues · [right] the record with the finding's field highlighted **at its byte offsets**, or the copybook's field-by-field layout when there is nothing to highlight, plus the L3 explanation and the values it cited. The guaranteed / not-guaranteed strips are fixed at the top and bottom of the screen.

![PASS](docs/images/ui-pass.png)
![FAIL with a highlighted byte range](docs/images/ui-fail.png)

Binds to `127.0.0.1` only; files never leave the machine and dropped files are parsed from the request body without being written anywhere.

### MCP server (4 tools)

```bash
npm run mcp                  # newline-delimited JSON-RPC 2.0 on stdio
```

| tool | returns |
|---|---|
| `parse_file` | typed-record counts, coded parse issues, hashes, fingerprint (no verdict) |
| `reconcile` | PASS/FAIL, findings with declared/computed/delta, summary, fingerprint |
| `explain_findings` | one grounded explanation per finding (`INSUFFICIENT_EVIDENCE` when it cannot be grounded) |
| `verify` | both fingerprints, first differing field path, proof the report was not modified |

Each returns the same JSON the CLI writes, because all three surfaces call `src/core/ops.ts`.

## BAI2 is read, not disguised

BAI2 has no fixed width and no copybook. Rather than fake a layout for a comma-delimited format, `src/bai2` is a dedicated reader for records `01/02/03/16/49/88/98/99` that produces the same `ParseResult` the reconciler already understands: amounts as `bigint` minor units with the currency's exponent, direction from the type code (`100–399` credit, `400–699` debit), per-record field offsets for the evidence panel, and its own checks of the account, group and file trailers. See [`docs/bai2.md`](docs/bai2.md).

## How Kiro built it (evidence, not adjectives)

- `.kiro/specs/edi820-importer/` — `requirements.md` (EARS) → `design.md` → `tasks.md`, derived from the copybooks themselves; `design.md` §12 records every implementation delta, including the two stack substitutions (MCP protocol implemented directly instead of `@modelcontextprotocol/sdk`; the screen as one dependency-free document instead of Vite + React) and why
- `.kiro/steering/` — product, tech (parsing rules), structure, conventions, and finance-file domain rules
- `.kiro/hooks/` — tests on save, re-verify after each agent turn, evidence appended on task completion
- `.kiro/agents/reviewer.json` — adversarial cross-review agent
- `EVIDENCE.md` — the append-only build log those hooks produced, including the defects the build found in itself (overpunch table off by one, implied decimals dropped when encoding, a blank reference silently dropped, BAI2 record counting, invalid HTML in the field legend)
- `docs/copybook-to-spec.md` — how a legacy spec document became a Kiro spec (what it got right, what it got wrong)

## What this guarantees / does not guarantee
See [`docs/guarantees.md`](docs/guarantees.md), which is parsed and printed by `820 verify` and shown in both strips of the web screen. Short version: it guarantees format interpretation, exact arithmetic, reference reconciliation, reproducibility and explanation grounding; it does **not** guarantee legal or accounting adequacy — that stays with a human, on purpose.

## Data

All sample data is **synthetic** (fictional company *Northwind Pay*). No customer, bank or employer data is used anywhere in this repository.

## License

Apache-2.0 — see `LICENSE`.
