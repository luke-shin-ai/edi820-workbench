---
inclusion: always
---

# Tech — 「820」

## Stack (fixed choices — do not substitute without a written reason in the spec)
- **Language**: TypeScript (Node 20+) for parser, reconciler, CLI and MCP server; single language keeps the copybook model shared.
- **CLI**: `commander` — commands `parse`, `reconcile`, `explain`, `verify`.
- **Web screen**: Vite + React (single page, no router). No component library beyond CSS modules — the UI must read as one deliberate screen.
- **Tests**: `vitest` for unit tests, **`fast-check` for property-based tests**.
- **MCP server**: `@modelcontextprotocol/sdk`, stdio transport.
- **No network calls at runtime.** Files never leave the machine. Any telemetry is a local JSONL file.

## Fixed-width parsing rules (the heart of the project)
1. A copybook field is `(name, start, length, type, pic)`. `start` is 1-based, inclusive.
2. Types: `string`, `unsigned-int`, `signed-int`, `packed-decimal`, `zoned-decimal`, `implied-decimal(p)`, `filler`.
3. **Never trim inside parsing.** Trimming is a presentation concern; slice only.
4. Sign handling is explicit per copybook (`SIGN LEADING SEPARATE`, `SIGN TRAILING OVERPUNCH`). Overpunch is decoded by table, not by guess.
5. Implied decimals are applied by integer scaling; **amounts are carried as `bigint` minor units + ISO-4217 currency code**, never as floats.
6. A record whose length ≠ the copybook's record length is `RECORD_LENGTH_MISMATCH` — the parser reports it and continues at the declared boundary (it must not silently re-sync).
7. Rounding: half-up at the currency's minor unit, applied only at the boundary of a required total; never mid-pipeline.

## Reconciliation rules
- Control totals compare **declared vs summed** and report `delta` with sign and currency.
- Reference chain: `TRN*1*<trace>` ↔ 820 `RMR*<ref>` ↔ 823 `RMR`/`REF`; unmatched references are `REF_UNMATCHED`, never silently dropped.
- Date window: copybook-declared settlement window ± configured tolerance (default 0 days).
- Every finding carries a **stable code** and a **record index + field name**.

## Testing policy
- Every parser rule above needs a unit test **and** a property test.
- PBT properties: round-trip (parse→serialize returns the byte-identical original), boundary (min/max/zero/negative), no-truncation, currency and sign preservation, and randomized copybook generation against randomized data.
- A failing property test must be kept as a regression case in `test/regressions/`.

## Agent (L3) constraints
- The agent receives **structured findings** (code, record index, field, declared, computed, delta) and may only produce: plain-language cause, suggested fix, and a citation of the finding it refers to.
- If a finding has no evidence, the agent must answer `INSUFFICIENT_EVIDENCE` rather than speculate.
