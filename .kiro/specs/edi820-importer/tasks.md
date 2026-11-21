# Tasks — edi820-importer

> Ordered for spec-driven execution with Kiro. Each task is small enough to complete in one agent turn and ends with a command whose output goes into `EVIDENCE.md`.
> Status: `[ ]` todo · `[~]` doing · `[x]` done (hook appends evidence on `PostTaskExecution`)

## Phase 0 — repo and evidence
- [x] T0.1 Create repo skeleton per `.kiro/steering/structure.md`, add Apache-2.0 LICENSE, confirm `.kiro/` is tracked. Evidence: `git ls-files .kiro | wc -l` > 0.
- [x] T0.2 Add `EVIDENCE.md` + `PostTaskExecution` hook. Evidence: hook config path + first appended line.
- [x] T0.3 Generate three synthetic sample pairs (820/823/BAI2 good+bad) with a script under `scripts/`. Evidence: file sizes + intentional defect list.
  - **Delivered:** three byte contracts — `820.cpy` (display + overpunch), `820-packed.cpy` (COMP-3, fixed framing, binary), `823.cpy` (leading separate sign) with good/bad variants; `scripts/gen-fixtures.mjs` regenerates them and `test/unit/fixtures.test.ts` asserts every documented defect.
  - **BAI2 deferred:** BAI2 is comma-delimited, not fixed-width. Faking it as a copybook layout would be exactly the kind of lie this project is built against; it needs its own record reader (planned with T5). The reconciler already accepts any typed record set, so BAI2 becomes a reader, not a rewrite.

## Phase 1 — copybook (L1a)
- [x] T1.1 Copybook tokenizer + field compiler (R1.1–R1.3). Evidence: `vitest run test/unit/copybook`.
- [x] T1.2 Error paths R1.4–R1.5. Evidence: test names + pass count.
- [x] T1.3 PBT: random copybooks → compile → sum(length) == recordLength and no overlap. Evidence: property names.

## Phase 2 — parser (L1b)
- [x] T2.1 Slicing + typed conversion (R2.1–R2.5). Evidence: `vitest run test/unit/parser`.
- [x] T2.2 Overpunch/sign decode table (R2.4) incl. `{ } A–I J–R`. Evidence: table-driven test.
- [x] T2.3 Mismatch and invalid-numeric issues (R2.2–R2.3). Evidence: 2 tests.
- [x] T2.4 **PBT round-trip** (R3.1–R3.2): parse→serialize is byte-identical. Evidence: property + any failure found.
- [x] T2.5 **PBT boundary/truncation**: zero, negative, max length, one-byte-short record. Evidence: property + regression file for each failure.

## Phase 3 — reconciler (L2)
- [x] T3.1 Control total & count compare (R4.1–R4.2) with `bigint` deltas. Evidence: 4 tests (pos/neg/zero/multi-currency).
- [x] T3.2 Reference matching across 820 ↔ 823/BAI2 (R4.3). Evidence: matched/unmatched counts on sample pair.
- [x] T3.3 Date window (R4.4). Evidence: test + configured tolerance shown.
- [x] T3.4 Verdict + fingerprint (R4.5). Evidence: two runs, identical fingerprint.

## Phase 4 — explainer (L3)
- [ ] T4.1 Adapter with structured findings only (R5.1). Evidence: prompt/response capture.
- [ ] T4.2 Numeric-literal validation (R5.2). Evidence: rejected-explanation test.
- [ ] T4.3 `INSUFFICIENT_EVIDENCE` fallback (R5.3). Evidence: test.

## Phase 5 — surfaces
- [ ] T5.1 CLI `parse|reconcile|explain|verify` with exit codes 0/2/3. Evidence: four command outputs.
- [ ] T5.2 `verify` read-only proof (R6.1–R6.2): mtime unchanged + differing-field path printed. Evidence: `stat` before/after.
- [ ] T5.3 Web screen (three columns + guarantee strip). Evidence: screenshots (1920 wide) incl. empty and error states.
- [ ] T5.4 MCP server with 4 tools. Evidence: tool list + one call trace.

## Phase 6 — Kiro evidence and submission
- [ ] T6.1 `docs/copybook-to-spec.md`: the actual conversion story (what the spec filled in, what it got wrong, what steering changed).
- [ ] T6.2 Write-up answering **all nine** Kiro questions (IDE/CLI/Web/Crew, custom agents, hooks, spec-driven, steering, MCP, PBT, powers) — including what did not help.
- [ ] T6.3 `review.md`: self-scoring on the five 20% criteria with the submitted build.
- [ ] T6.4 Demo video ≤ 3 min (English subtitles), YouTube public.
- [ ] T6.5 Blog post + social post with `#KiroweenHackathon26` at the start.
- [ ] T6.6 Final Devpost submission before **2026-12-04 23:00 KST** (8 hours of buffer).
