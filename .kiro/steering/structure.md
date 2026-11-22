---
inclusion: always
---

# Structure: 「820」

```
/                       repo root (this folder) - must contain .kiro/ and LICENSE
  README.md             what it does, how to run, what is guaranteed
  LICENSE               Apache-2.0 (About area on GitHub)
  .kiro/                specs, steering, hooks, agents - never .gitignore'd
  src/
    copybook/           copybook model + compiler (text -> Field[])
    parser/             fixed-width -> typed records
    reconcile/          control totals, references, dates
    explain/            L3 agent adapter (structured findings in, narration out)
    cli/                parse | reconcile | explain | verify
    mcp/                MCP server exposing parser/reconciler as tools
    web/                single-page UI
  test/
    unit/               rule-by-rule
    pbt/                fast-check properties
    regressions/        every PBT failure kept forever
  samples/               SYNTHETIC data only (Northwind Pay). Never real bank data.
    copybooks/          820.cpy, 823.cpy, bai2.cpy (with deliberate variants)
    data/               paired good/bad files for the demo
  docs/
    copybook-to-spec.md how a legacy spec document becomes a Kiro spec (demo artifact)
    guarantees.md       what the report guarantees / does not guarantee
  EVIDENCE.md           append-only run log written by a hook (build evidence)
```

## Conventions
- One module = one responsibility. `parser` never imports `reconcile`; `explain` never imports `parser` (it only sees findings).
- Names: findings are `SCREAMING_SNAKE` codes (`CONTROL_TOTAL_MISMATCH`); copybook fields keep their source name verbatim.
- Every slice of parsing logic carries the copybook field name in its error message.
- No file in `samples/` may contain real account numbers, real personal names, or real bank routing numbers.
