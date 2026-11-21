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
- [x] T4.1 Adapter with structured findings only (R5.1). Evidence: prompt/response capture.
  - **Delivered:** `src/explain/{types,evidence,prompt,adapters,explainer}.ts`. The prompt carries `serialiseFinding(finding)` plus the steering excerpt for that finding code and nothing else (asserted: the sample record text and other references never appear). Three adapters: `mock` (deterministic, default, off-network), `kiro-cli` (headless, injectable runner), `openai-compatible` (any chat-completions endpoint). Citations are attached by `citationOf()`, not by the model.
- [x] T4.2 Numeric-literal validation (R5.2). Evidence: rejected-explanation test.
  - **Delivered:** the guard in `evidence.ts` compares every numeric literal in a draft against the finding's own values (grouped/ungrouped/minor-unit forms, magnitudes, record index, reference fragments, ISO date components). A draft citing `999,999.99` on a finding whose values are `1,284,550.00 / 1,284,450.00 / −100.00` is replaced with `INSUFFICIENT_EVIDENCE` and the draft is kept in `rejection` for review. 14 unit tests + 5 properties (foreign amount always rejected, own values always accepted, evidence monotone).
- [x] T4.3 `INSUFFICIENT_EVIDENCE` fallback (R5.3). Evidence: test.
  - **Delivered:** a finding with none of declared/computed/delta/reference is refused before any adapter call (test asserts the spy adapter is never called); the fallback text contains no digits of its own. Live calls are budgeted (`maxLiveCalls`, default 0) and a skipped or failed live call falls back to the template with the reason on the explanation.

## Phase 5 — surfaces
- [x] T5.1 CLI `parse|reconcile|explain|verify` with exit codes 0/2/3. Evidence: four command outputs.
  - **Delivered:** `src/cli/{index,main}.ts` plus a `demo` command that reconciles all six sample pairs. `parse` exits 2 on a coded parse issue, `reconcile` 0/2 on PASS/FAIL, `explain` 2 when any finding is refused, `verify` 0/2. 13 tests, including a real process-boundary exit code.
- [x] T5.2 `verify` read-only proof (R6.1–R6.2): mtime unchanged + differing-field path printed. Evidence: `stat` before/after.
  - **Delivered:** `verifyReport()` re-runs the deterministic layers from `report.inputs` and deep-diffs `{inputs, files, verdict}`, printing both fingerprints and the first differing path (`verdict.fingerprint`). The CLI prints report bytes and mtime before/after; tests assert byte and mtime equality and that a tampered report (and a changed input file) yields exit 2 with the path.
- [x] T5.3 Web screen (three columns + guarantee strip). Evidence: screenshots (1920 wide) incl. empty and error states.
  - **Delivered:** `src/web/{server,view,page,main}.ts` — one page on 127.0.0.1: [left] sample pickers, drop zones, records-as-read, [middle] verdict card, control totals, findings, parse issues, [right] byte-offset highlight (or the copybook's field-by-field layout when there is nothing to highlight) plus the L3 explanation, with the guaranteed / not-guaranteed strips top and bottom. Screenshots: `screenshots/ui-pass.png` (PASS) and `screenshots/ui-fail.png` (FAIL, VALUE-DATE bytes 40–47 highlighted after clicking the finding). 9 HTTP tests + a real headless-browser run (1920×1200, 0 page errors).
- [x] T5.4 MCP server with 4 tools. Evidence: tool list + one call trace.
  - **Delivered:** `src/mcp/{server,main}.ts` — `parse_file`, `reconcile`, `explain_findings`, `verify` over newline-delimited JSON-RPC on stdio, each returning the same JSON the CLI writes. 9 tests including a real stdio session (`initialize` → `tools/list` → `tools/call parse_file`) and a `-32700` recovery.

## Phase 6 — Kiro evidence and submission
- [x] T6.1 `docs/copybook-to-spec.md`: the actual conversion story (what the spec filled in, what it got wrong, what steering changed).
  - **Delivered:** rewritten around the compiler's own output (`demo-video/build/dump-copybook.mjs`): three byte contracts (100/88/80 bytes, AMOUNT at 24–36, 24–30, 25–38), the seven questions a copybook cannot answer and where each answer was written, the four Kiro questions answered (including "the IDE spec flow was not run"), and three things the conversion got wrong.
- [x] T6.2 Write-up answering **all nine** Kiro questions (IDE/CLI/Web/Crew, custom agents, hooks, spec-driven, steering, MCP, PBT, powers) — including what did not help.
  - **Delivered:** `devpost-submission-draft.md`. Eight official topics from the rules plus the vibe-coding comparison (the ninth asked-for question), each tied to a file; form fields filled; a closing list of five claims the submission does not make.
- [x] T6.3 `review.md`: self-scoring on the five 20% criteria with the submitted build.
  - **Delivered:** checklist status against rules §5, five scores averaging 8.0 (Impact 8.0, Implementation 7.0, Design 8.5, Innovation 8.0, Presentation 8.5), five repairs applied in the same pass (README video and judge path, empty/error captures, claim ledger, evidence table repaired), four residual risks, next actions by owner.
- [x] T6.4 Demo video < 3 min (English subtitles), YouTube public.
  - **Delivered:** `demo-video/820-demo-en.mp4` — 2:41.13, 1920×1080 30 fps, 17.14 MB, English narration + burned subtitles, `.srt` with 31 cues. **YouTube upload not done** (a public upload in the account holder's name).
- [ ] T6.5 Blog post + social post with `#KiroweenHackathon26` at the start. Not attempted in this run: both are public posts under the account holder's name.
- [ ] T6.6 Final Devpost submission before **2026-12-04 23:00 KST** (8 hours of buffer). The form text is ready in `devpost-submission-draft.md`; the entry itself is the account holder's act.
