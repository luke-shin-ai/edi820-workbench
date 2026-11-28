# EVIDENCE: build log

> Append-only. One row per completed spec task. Rows up to 2026-11-21, and T9.1 to T9.4, were written
> by `scripts/append-evidence.mjs` invoked by hand with the same payload shape, because no session had
> run a spec task through Kiro's task tools; each says which session it came from. From 2026-11-22 the
> task hook (`trigger` `PostTaskExec`) writes the row itself: the last four rows of the table are its
> own output, unedited, including the two that came out wrong before its payload picker was fixed.
> Format: `YYYY-MM-DD HH:MM | task | command | result | commit`
> Test counts are from `npx vitest run`: **334 tests / 25 files** after the hardening pass of 2026-11-23
> (2026-11-22 10:18); 300 / 22 after the `REDEFINES` work (2026-11-21 20:05); 284 / 21 after the
> static demo, 275 / 20 after T7.1, 222 / 17 at T5, 148 before T4/T5.

| when | task | command | result | commit |
|---|---|---|---|---|
| 2026-11-21 (setup) | T0.0 scaffold | - | spec/steering/hooks/agents authored from the copybook contract | (pre-repo) |
| 2026-11-21 13:45 | T0.1 | `git ls-files .kiro` -> 10 lines | 10 `.kiro` files tracked (specs 3, steering 5, hooks 1, agent 1); 55 files in the first commit | 6dfa9aa |
| 2026-11-21 13:45 | T0.2 | `node scripts/append-evidence.mjs` | hook script executed with a PostTaskExecution-shaped payload; this row written | 6dfa9aa |
| 2026-11-21 13:45 | T0.3 | `npx tsx scripts/gen-fixtures.mjs` | 5 fixtures / 54 records / 4,890 bytes; defects listed in `samples/data/DEFECTS.md` and asserted by the fixture tests | eaca8e9 |
| 2026-11-21 13:45 | T1.1 | `npx vitest run test/unit/copybook` | 19 passed (cumulative offsets, implied decimals, COMP-3 width, sign conventions) | 55c0f1e |
| 2026-11-21 13:45 | T1.2 | `npx vitest run test/unit/copybook -t R1.4` | 6 error-path tests passed: unparsable line, unknown clause, REDEFINES, OCCURS, overlap naming both fields, uncovered-gap note | 55c0f1e |
| 2026-11-21 13:45 | T1.3 | `npx vitest run test/pbt/copybook` | 3 properties / 500 generated copybooks (contiguous starts from 1, `recordLength` = sum of the field lengths, no silent overlap) | 6ea5bba |
| 2026-11-21 13:45 | T2.1 | `npx vitest run test/unit/parser` | 25 passed (slicing without trimming, trailer detection via the copybook, fixed framing) | 3dc4040 |
| 2026-11-21 13:45 | T2.2 | `npx vitest run test/unit/overpunch` | 57 passed: 22-case overpunch table (`{ } A-I J-R`), packed sign nibbles C/F/D, leading/trailing separate sign | 3dc4040 |
| 2026-11-21 13:45 | T2.3 | `npx vitest run test/unit/parser -t R2.2` | 4 passed (a 99-byte record keeps its neighbours in place; an invalid amount is a coded issue, not an exception) | 3dc4040 |
| 2026-11-21 13:45 | T2.4 | `npx vitest run test/pbt/parser` | 5 properties / 900 cases; parse->serialize byte-identical including CRLF, no final newline, and the binary COMP-3 stream | 6ea5bba |
| 2026-11-21 13:45 | T2.5 | `npx vitest run test/pbt/parser test/regressions` | truncation property (150 cases) + 6 regression tests kept from the first PBT failures (overpunch offset, implied-decimal width, packed padding nibble) | 6ea5bba |
| 2026-11-21 13:45 | T3.1 | `npx vitest run test/unit/reconcile` | 19 passed; delta = computed - declared: -100.00 USD on 820-bad, -45,000.00 USD on 823-bad, currencies kept in separate buckets | fffd2db |
| 2026-11-21 13:45 | T3.2 | `npx tsx scripts/demo-reconcile.mjs` | 820-bad vs 823-bank: `REF_UNMATCHED` x2 - 820-only `NWP-2611-0011`, bank-only `NWP-2611-0010`; good pair 10/10 matched | fffd2db |
| 2026-11-21 13:45 | T3.3 | `npx tsx scripts/demo-reconcile.mjs` | `DATE_OUT_OF_WINDOW` at record 2 (2026-11-14 vs window 2026-11-18..2026-11-20, tolerance 0d); tolerance 4d accepts it | fffd2db |
| 2026-11-21 13:45 | T3.4 | `npx vitest run test/pbt/reconcile` + demo | 3 properties / 550 cases; two runs give identical fingerprints (S1 `b373f3a5...`, S3 `a69a9c1d...`) | 6ea5bba |
| 2026-11-21 13:45 | Kiro-CLI | `kiro-cli whoami`, `agent list`, `agent validate --path .kiro/agents/reviewer.json`, `chat --agent reviewer --no-interactive --model qwen3-coder-next` | Builder ID session on the account the credits were requested for (address redacted here; it is in the workspace's non-public `procedure-status.md`); `reviewer` discovered as a workspace agent; validate exit 0 (broken config exits 1); one smoke turn answered `READY` | 6dfa9aa -> 72639cd |
| 2026-11-21 13:45 | TYPE | `npx tsc --noEmit` | 0 errors (strict + noUncheckedIndexedAccess) | 6ea5bba |
| 2026-11-21 13:58 | REVIEW-3 | `kiro-cli chat --agent reviewer --model claude-haiku-4.5 --trust-tools=read,grep,glob` | reviewer read `reconciler.ts` and `decode.ts` (tool log present); 1 real MINOR (matched-count derived from a detail string) | d301056 |
| 2026-11-21 14:00 | FIX-REVIEW | `npx vitest run test/unit/reconcile` | blank reference now reported as `REF_UNMATCHED` instead of being skipped; matched count tracked explicitly; 148 tests pass, tsc clean | d301056 |
| 2026-11-21 14:10 | T4.1 | `npx vitest run test/unit/explain` | 14 passed; the prompt carries the serialised finding plus the steering excerpt for that code and nothing else (asserted absent: record text, another finding's reference); the citation is attached by code, not by the model | d301056 |
| 2026-11-21 14:10 | T4.2 | `npx vitest run test/pbt/explain.pbt` | 5 properties / 700 generated cases: a foreign amount or record index is always rejected; the finding's own renderings are always accepted; evidence is monotone under added values | d301056 |
| 2026-11-21 14:10 | T4.3 | `npx vitest run test/unit/explain` | an evidence-less finding is refused before any adapter call (spy call count 0); the fallback text contains no digits; budget 0 falls back with `live-call budget 0 exhausted`; an HTTP 429 falls back keeping the reason | d301056 |
| 2026-11-21 14:10 | T5.1 | `npx tsx src/cli/main.ts reconcile --copybook samples/copybooks/820.cpy --file samples/data/820-bad.txt --bank samples/data/823-bank.txt --bank-copybook samples/copybooks/823.cpy --window 2026-11-18..2026-11-20` | FAIL, 4 findings, fingerprint `a69a9c1d...`, exit 2; `parse` exits 2 on `RECORD_LENGTH_MISMATCH`; spec/IO errors exit 3; 13 CLI tests including one real process-boundary exit code | d301056 |
| 2026-11-21 14:10 | T5.2 | `npx tsx src/cli/main.ts verify <outDir>` | recorded = recomputed fingerprint; report 5,582 -> 5,582 bytes and mtime unchanged; a tampered fingerprint gives exit 2 and `first differing field: verdict.fingerprint`; a changed input file also gives exit 2 | d301056 |
| 2026-11-21 14:10 | T5.3 | `tsx src/web/main.ts --port 8720` + headless Chromium at 1920x1200 | PASS screen: 3 columns, 5 guaranteed + 4 not-guaranteed chips, 10 details, 0 findings; FAIL screen: 4 findings, clicking row 2 moved the highlight from `AMOUNT` bytes 24-36 to `VALUE-DATE` bytes 40-47; 0 page errors; `screenshots/ui-pass.png`, `screenshots/ui-fail.png` | d301056 |
| 2026-11-21 14:10 | T5.4 | `npx tsx src/mcp/main.ts` (real stdio session) | 4 tools (`parse_file`, `reconcile`, `explain_findings`, `verify`); `initialize` -> `tools/list` -> `tools/call parse_file` returns 11 records; a malformed line returns `-32700` and the server keeps serving; 9 tests | d301056 |
| 2026-11-21 14:10 | TYPE+TEST | `npx tsc --noEmit && npx vitest run` | 0 errors; 222 tests in 17 files (148 before this stage) - 194 unit, 22 property, 6 regression | d301056 |
| 2026-11-21 15:30 | T6.1 | `npx tsx demo-video/build/dump-copybook.mjs` | compiler-derived layout for three copybooks (100/88/80 bytes, AMOUNT at 24-36, 24-30, 25-38); `docs/copybook-to-spec.md` rewritten around those numbers, with the four Kiro questions answered and the answer "the IDE spec flow was not run" | c65a45f |
| 2026-11-21 15:52 | T6.3 | `python3 demo-video/build/capture_states.py` | real empty state and a real error state (`IO cannot read sample samples/data/missing-file.txt`) captured from the running screen; committed as `docs/images/ui-empty.png`, `ui-error.png` | c65a45f |
| 2026-11-21 15:55 | T6.2 | - | `devpost-submission-draft.md`: submission text plus all eight Kiro write-up topics and the vibe-coding comparison, each tied to a file, closing with five claims the submission does not make | c65a45f |
| 2026-11-21 15:56 | T6.3b | - | `review.md`: checklist status, five scores (8.0 average), five repairs applied in this pass, four residual risks, next actions by owner | c65a45f |
| 2026-11-21 16:05 | T6.4 | `python3 demo-video/build/build.py check` | 161.13 s (2:41), 17.14 MB, 1920x1080 H.264 752 kb/s + AAC 87 kb/s, 31 subtitle cues; page errors 0 during capture | c65a45f |
| 2026-11-21 18:05 | INTEGRITY | `npx vitest run test/regressions/verdict-integrity.test.ts` + `cd /tmp && 820 verify out/evidence` | 7 regression tests: a 99-byte record now yields verdict `INCOMPLETE` (exit 2, was `PASS` with 0 findings), `verify` from another cwd prints `RESULT: identical` instead of `ENOENT samples/copybooks/820.cpy`, and S6's delta now names its parts (`credits 1,205,550.00 minus debits 25.00`, delta -79,025.00) | 13ef2ec |
| 2026-11-21 18:05 | HOOK-FIX | probe hook on `AgentStop` vs `Stop` | `AgentStop` never fired; `Stop` fired on the next session. Trigger corrected, command replaced by `scripts/verify-latest.mjs` (real entry `src/cli/main.ts verify`, newest `out/*/report.json`), every firing logged to `out/hook-log.txt` | 13ef2ec |
| 2026-11-21 18:05 | WEB-DROP | `npx vitest run test/unit/web.test.ts` | a COMP-3 sample dropped as base64 parses to the same `fileHash` and fingerprint as the same file read by path; 10 web tests | 13ef2ec |
| 2026-11-21 18:29 | T7.1 | `kiro-cli chat --v3 --agent 820-implementer --no-interactive --trust-all-tools --model claude-haiku-4.5` (3 turns) | `src/exception/register.ts` 384 lines, CLI `exceptions/waive/release`, MCP `exceptions`, 38 tests; session ended with `tsc 0 errors`, `20 files / 270 tests passed` | d813a37 |
| 2026-11-21 18:30 | T7.1-REVIEW | `kiro-cli chat --v3 --agent reviewer --trust-tools=read,grep,glob,@820` | reviewer called `@820/reconcile` (FAIL, 4 findings, fingerprint `7af64454...`), `@820/exceptions` (4 OPEN, unadjudicated 4) and `@820/verify` (ok true, 6107 -> 6107 bytes, mtime unchanged); one MINOR (release `compensatingControl` could be empty) | d813a37 |
| 2026-11-21 18:31 | HOOK-FIRED | `cat out/hook-log.txt` | `09:30:16 Stop run=l4-review exit=0`; `09:32:22 PostFileSave unit+pbt tests ran`; `09:32:33 Stop run=l4-review exit=0` - the hooks fired inside live Kiro sessions | d813a37 |
| 2026-11-21 18:32 | T7.1-FIX | `npx tsc --noEmit && npx vitest run` | integrity check before an append, `unadjudicated` counts `RELEASED`, `--control` required on release, EPIPE guard, 4 CLI exit-code tests (OPEN->2, all waived->0, release->2, tampered ledger->3, expired->2); 275 tests / 20 files, 0 errors | d813a37 |
| 2026-11-21 18:32 | T7.2 | - | `docs/kiro-session-evidence.md`: 3 sessions, hook firings with their log lines, the reviewer's MCP calls and returned values, the 6 post-session repairs, the reviewer's MINOR, and the limits (non-interactive, `PostTaskExecution` unobserved, no credit count) | d813a37 |
| 2026-11-21 18:40 | DEMO-BUILD | `npx tsx scripts/build-static.ts` | `docs/demo/bundle.js` 131 KB + `index.html` 14 KB from the same parser, reconciler, BAI2 reader, L3 template and L4 register; `node:crypto` aliased to `src/static/sha256-browser.ts`, whose digests are asserted equal to `node:crypto` for ASCII, high-byte strings, byte arrays and the real COMP-3/BAI2 samples | 6af46e6 |
| 2026-11-21 18:41 | DEMO-CHECK | `python3 scripts/check-static.py` (Chromium, 1920x1080) | 6 scenarios: verdict and fingerprint equal the CLI for all six (S1 `c459b81b...`, S2 `85646a69...`, S3 `7af64454...`, S4 `071371bf...`, S5 `923e8f7e...`, S6 `84fd2c5e...`); a dropped COMP-3 file parses as bytes; a waiver shows WAIVED while the badge stays FAIL; release reopens; re-derive prints identical; 0 requests after load; 0 console/page errors | 6af46e6 |
| 2026-11-21 18:55 | VIDEO | `python3 demo-video/build/{plates,make_tts,build}.py` | new opening from the hook log and the MCP client run, static demo plates for PASS/FAIL/evidence/BAI2, a register scene, 2:52.30, 19.51 MB, 38 cues, 0 em dashes | (this commit) |
| 2026-11-21 18:58 | DOCS | - | README, `devpost-submission-draft.md`, `review.md` re-scored (7.6, from the cold 6.4), this file, `demo-video/build/README.md` updated to the shipped state; `samples/data/DEFECTS.md`, `.kiro/steering/finance-file-conventions.md` corrected earlier in `13ef2ec` | (this commit) |
| 2026-11-21 20:00 | T8.1 | `npx tsx demo-video/build/dump-copybook.mjs` | `820-redefines.cpy` compiles to 101 bytes: one 100-byte region (`PAYMENT-DETAIL`, bytes 2-101) with two layouts, `PAYMENT-TRAILER` activated by `REC-TYPE=T`, detail by `P`; the compiler refuses an unbound `REDEFINES` (`COPYBOOK_SEMANTICS`), a wider redefining item and a discriminator inside its own region (`COPYBOOK_REDEFINES`) | (this commit) |
| 2026-11-21 20:01 | T8.2 | `npx vitest run test/unit/copybook test/pbt/copybook` | 27 copybook tests (group items, region offsets, overlap only across layouts, refusal paths) + 4 properties, including 120 generated two-layout copybooks where both layouts cover the same bytes and only the selected one is decoded | (this commit) |
| 2026-11-21 20:01 | T8.3 | `npx tsx scripts/gen-fixtures.mjs` | `820-redefines-good.txt` and `820-redefines-bad.txt` (11 x 101 bytes); DEFECTS.md regenerated with both | (this commit) |
| 2026-11-21 20:02 | T8.4 | `npx vitest run test/unit/fixtures test/regressions/redefines-view` | good pair PASS; bad pair FAIL with one finding (`CONTROL_TOTAL_MISMATCH` on `TOTAL-AMOUNT`, delta 100.00 USD); the six pre-existing scenario fingerprints unchanged (`c459b81b...`, `85646a69...`, `7af64454...`, `071371bf...`, `923e8f7e...`, `84fd2c5e...`); a damaged `REC-TYPE` is `REDEFINES_VIEW_UNMATCHED` and blocks a PASS | (this commit) |
| 2026-11-21 20:03 | UI | `npx vitest run test/unit/explain test/unit/cli` | the default explainer is named `grounded` everywhere (adapter, CLI `--adapter`, MCP enum, screen label `L3: grounded`); no `L3: mock` string remains in `src/` | (this commit) |
| 2026-11-21 20:08 | DEMO-CHECK | `python3 scripts/check-static.py` (Chromium, 1920x1080) | 8 scenarios: verdict and fingerprint equal the CLI for all eight (S7 `344591ae...`, S8 `426cc093...`); the `REDEFINES` trailer is sliced by `REC-TYPE, ORIG-ID-T, RECEIVER-ID-T, TOTAL-AMOUNT, TOTAL-CURRENCY, REC-COUNT, FILLER` while its neighbour is still sliced by the detail layout; dropped COMP-3, waiver/release, re-derive, 0 requests after load, 0 console/page errors | (this commit) |
| 2026-11-21 20:20 | VIDEO | `python3 demo-video/build/{plates,make_tts,build}.py` | 2:57.67, 19.01 MB, 1920x1080 30 fps + AAC, 40 cues; new shot 3 is the `REDEFINES` copybook plate, new shot 3b is the trailer read through its layout; tests plate reads 300; subtitles restyled with a box; 0 em dashes, 0 en dashes, 0 emoji | (this commit) |
| 2026-11-21 20:26 | DOCS | - | README, `devpost-submission-draft.md` (§9 rewritten to the 2:57 cut; closing section now leads with how spec, steering, agent, hooks, MCP and CLI combine), `review.md` re-scored, the internal Korean summary (kept out of the repository), `docs/copybook-dialect.md` §4-5, `docs/guarantees.md`, `.kiro/specs/.../design.md` §14, `samples/README.md` | (this commit) |
| 2026-11-21 16:06 | TYPE+TEST | `npx tsc --noEmit && npx vitest run` | 0 errors; 222 passed (222) in 17 files | c65a45f |
| 2026-11-22 13:40 | HOUSEKEEPING | `python3` scan of `package.json`, `src/web/`, `src/static/`, `docs/`, `.kiro/`, `EVIDENCE.md`, `review.md`, `devpost-submission-draft.md` | 0 em dashes, 0 en dashes, 0 middots, 0 arrows, 0 smart quotes, 0 ellipses, 0 emoji in those files; the two layer diagrams in `design.md` redrawn in `+ - |` ASCII; `npm run build:static` regenerated `docs/demo/` (bundle.js 156.5 KB, index.html 14.3 KB) and `capture_ui.py` refreshed the four `docs/images/ui-*.png` shots; `tsc --noEmit` 0 errors, `npx vitest run` 311 tests / 23 files, `check-static.py` 37 checks, `check:claims` 12/12; the S1/S2/S3/S7 fingerprints unchanged (`c459b81b`, `85646a69`, `7af64454`, `344591ae`) | (this commit) |

The last four rows, and why two of them are unusable:

```
| 2026-11-22 10:32 | n/a | - | - | - |
| 2026-11-22 10:32 | T9.5 **Claim checker** - a script that fails when a published document states a  (.kiro/specs/edi820-importer/tasks.md) | - | - | - |
| 2026-11-22 10:33 | T9.5 (.kiro/specs/edi820-importer/tasks.md) | - | task_success=true | - |
| 2026-11-22 10:45 | T9.5 (.kiro/specs/edi820-importer/tasks.md) | - | task_success=true | - |
```

They are the hook's own output, kept as written, with punctuation normalised to ASCII (2026-11-22). The first two are before `append-evidence.mjs` knew
the event's field names (`task_name`, `task_success`), so it printed `n/a` and then the whole task
line. `out/hook-payload/*.json` holds the payload the hook received (a runtime path, not committed);
`docs/kiro-session-evidence.md` §8.4 quotes it, which is how the names were found instead of guessed. The rows are not tidied afterwards: an append-only log that edits its own
mistakes is not a log.

## Demo run (the numbers the video shows)

`npx tsx scripts/demo-reconcile.mjs` - full output saved under `out/<timestamp>/demo-report.json`.

| scenario | verdict | detail |
|---|---|---|
| S1 `820-good` + `823-bank` | **PASS** | 10 details each, declared 1,284,550.00 USD = summed, 0 findings |
| S2 `820-packed-good` + `823-bank` | **PASS** | same payments as S1 with COMP-3 amounts (88-byte records, no line breaks) |
| S3 `820-bad` + `823-bank` | **FAIL**, 4 findings | control total -100.00 USD; 1 short record; 2 unmatched references; 1 value date outside the window |
| S4 `820-good` + `823-bad` | **FAIL**, 3 findings | bank trailer declares 10 / 1,284,550.00, 9 records arrived: count -1, total -45,000.00, 1 unmatched reference |
| S5 `820-good` + `bai2-good` | **PASS** | comma-delimited statement; 03/100 total credits = summed details; 10/10 references matched |
| S6 `820-good` + `bai2-bad` | **FAIL**, 3 findings | control total -79,025.00 USD (missing detail + a bank-side debit fee), `REF_UNMATCHED` both directions (`NWP-2611-0010` 820-only, `BANK-FEE-2611` bank-only) |
| S7 `820-redefines-good` + `823-bank` | **PASS** | the bank dialect: 10 details read through `PAYMENT-DETAIL`, the trailer through `PAYMENT-TRAILER` (`REDEFINES`), declared total 1,284,550.00 USD = summed |
| S8 `820-redefines-bad` + `823-bank` | **FAIL**, 1 finding | the trailer layout declares 1,284,450.00 USD against a detail sum of 1,284,550.00: `CONTROL_TOTAL_MISMATCH` on `TOTAL-AMOUNT`, delta 100.00 USD |

## Defects found by the build itself (not planted in fixtures)

1. **The scaffold copybook contradicted itself**: header said 90 bytes, the `PIC` clauses summed to
   88, and a one-byte `SIGN-IND PIC X(1) SIGN TRAILING OVERPUNCH` field claimed to carry the sign of a
   *different* field's amount. The compiler derives `recordLength` from the field sum only; the layout
   was corrected and the convention moved onto the amount field itself (`docs/copybook-dialect.md` §5).
2. **Overpunch table off by one** - found by the first run of `test/pbt/amounts.pbt.test.ts`: the table
   was built from `'A' + 0`, mapping `A -> 0 ... J -> +9` instead of `A -> +1 ... R -> -9`. Every overpunched
   amount was wrong. Kept as `test/regressions/overpunch-and-width.test.ts`.
3. **Implied decimals dropped when encoding** - found by the "typed values re-encode to the same bytes"
   property on a `PIC 9(3)V99` copybook: the encoder sized values by integer digits only. Fixed; the
   regression file pins the width rule.
4. **A planted defect was invisible**: the first `820-bad` reference break was masked by the
   amount+date fallback match, because the broken record still matched a bank record on amount. The
   fixture now moves one cent between two records, so the reference break survives the fallback and
   the total still differs by exactly -100.00. That is the fallback being *tested*, not trusted.
5. **A blank reference was dropped** - found by the reviewer agent's second pass (which was otherwise
   full of invented line numbers) and confirmed by hand: `referenceRecords` skipped blank references,
   so such a record never reached `REF_UNMATCHED`. Fixed with a test; the matched count is now tracked
   inside the matching routine instead of being derived from finding text.
6. **The agent config had no tools** - `.kiro/agents/reviewer.json` declared resources but no `tools`
   array, so the reviewer could not read a file and produced a confident review of code it had never
   seen. Fixed (`read`, `grep`, `glob`, `thinking`); the prompts now say "read before you cite".
7. **BAI2 record counting was wrong in the first draft** - the reader incremented a group
   record counter from three different branches, so the `98` count check could pass or fail
   for the wrong reason. Replaced with an index-derived count (`index - startIndex + 1`),
   which is what the trailer actually describes. Caught by writing the "self-consistent file
   has no issues" property before trusting the fixture.
8. **The web legend was invalid HTML** - the field legend was injected as `<tr>/<td>` into a
   `<dl>`, so the browser flattened it into one unreadable line. Found in the first real
   browser render (`screenshots/ui-pass.png`), fixed by emitting a real `<table>`; the second
   render shows the copybook's fields as coloured byte ranges. A screenshot is evidence -
   this one was wrong, and looking at it is what caught the defect.

## How the T6 rows were produced

- The rows above were appended by `node scripts/append-evidence.mjs` with the same payload shape the
  hook passes. The hook is committed in `.kiro/hooks/parser-guardrails.json`; on 2026-11-22 it was
  observed firing in a live session (trigger `PostTaskExec`, see `docs/kiro-session-evidence.md` §8),
  and the four rows at the end of the table are its own output rather than a hand-run script.
- The video's numbers are read from the files at render time: the copybook byte offsets come from the
  compiler (`dump-copybook.mjs`), the screenshots come from the running server with 0 page errors,
  and the terminal plates are rendered from the captured stdout in `demo-video/build/outputs/`.
| 2026-11-22 10:12 | T9.0 | `npx vitest run` (baseline) | 300 tests / 22 files, 31 properties; `npx tsc --noEmit` 0 errors. The starting point the red-team review scored | (this commit) |
| 2026-11-22 10:15 | T9.1 | `npx vitest run test/unit/exception test/pbt/exception test/regressions/red-team-code` | `appendWaiver` refuses a missing, blank, malformed or past `expiresOn`; `820 waive` requires `--expires` and exits 3 without it; the register panel in the static build refuses too; R8.1/R8.2/R8.4 and design §15.1 amended | (this commit) |
| 2026-11-22 10:16 | T9.2 | `npx vitest run test/regressions/red-team-code` | `MISSING_CURRENCY` (R4.6) replaces the `Object.keys(buckets)[0]` fallback: a USD declaration against an all-EUR file is now a finding, not a PASS; the summary row says "not compared" instead of borrowing a currency | (this commit) |
| 2026-11-22 10:17 | T9.3 | `npx vitest run test/regressions/red-team-code test/unit/explain test/pbt/explain` | the L3 guard keeps identifier tokens (`0011`) apart from values (`11`): `Record 11 was never sent` on a finding anchored to record 9 is rejected; the reference itself still cites | (this commit) |
| 2026-11-22 10:18 | T9.4 | `npx tsc --noEmit && npx vitest run` | 0 errors, 311 tests / 23 files, 31 properties. The exception PBT now releases waivers and asserts `unadjudicated = OPEN + EXPIRED + RELEASED`; the last non-English strings are gone from `src/`, `docs/`, `samples/` and `scripts/` | (this commit) |
| 2026-11-22 10:32 | T9.5 | `kiro-cli chat --v3 --mode spec ... "T9.5 in_progress, run npm run check:claims, T9.5 completed"` | the task hook fired for the first time in this repository's history: `trigger=PostTaskExecution evidence row appended`, and the row below is its output | (this commit) |
| 2026-11-22 10:32 | n/a | - | - | - |
| 2026-11-22 10:32 | T9.5 **Claim checker** - a script that fails when a published document states a  (.kiro/specs/edi820-importer/tasks.md) | - | - | - |
| 2026-11-22 10:33 | T9.5 (.kiro/specs/edi820-importer/tasks.md) | - | task_success=true | - |
| 2026-11-22 10:45 | T9.5 (.kiro/specs/edi820-importer/tasks.md) | - | task_success=true | - |
| 2026-11-22 14:15 | DEMO-UX | `npx vitest run && npx tsc --noEmit && python3 scripts/check-static.py && npm run check:claims` | first screen freed: both guarantee strips are one line with a `Show all` toggle (`#strip-top` / `#strip-bottom` and their items stay in the document), header 39px and banner 28px, so 1. Scenario, 2. Verdict and 3. Evidence all start at y=94 on 1440x900; `@media (max-width: 1080px)` gives one column in reading order, the bottom strip stops being sticky, counters 2 across, register form 1 across, tables wrapped in `overflow-x: auto`; 311 tests, 45 static checks with all 8 fingerprints equal to the CLI, 12/12 claims; `document.scrollWidth == innerWidth` at 320, 375, 390, 430, 620, 768, 834, 1024, 1080, 1081, 1280, 1366, 1440, 1920 and 2560 wide, 0 console errors | 619d4f5 |
| 2026-11-23 02:52 | T10.1 | `npx vitest run test/unit/mcp` | the MCP server applies a path policy: `filePath`/`copybookPath`/`bankFilePath` only under `samples/`, `out/` or the working directory, `outDir` only under `out/`, symlinks resolved before the check; `maxLiveCalls` capped at 3; `today` and the settlement window must be real dates. `.kiro/settings/mcp.json` auto-approves only `parse_file` and `verify` | (this commit) |
| 2026-11-23 02:52 | T10.2 | `npx vitest run test/regressions/ledger-hardening` | the ledger entry hash is now `JSON.stringify([...])`, so `owner="A. Kim\|approved by CFO"` and `reason="approved by CFO\|timing difference"` no longer collide with the same text split differently; every write records `head {count, hash}`, and removing trailing entries is `LEDGER_TRUNCATED` at parse time and makes `820 verify` fail on the ledger while the report still re-derives; `decidedOn` and `--today` are checked with `isIsoDate`; `820 exceptions` and `820 verify` print the entry count and head hash | (this commit) |
| 2026-11-23 02:49 | T10.3 | `npm run verify:public` | the reader now reads every `[type code, amount]` group of an `03` record and the `88` continuations that carry the rest of one, and the `49` control total adds the amounts as they appear on the wire. Two bank-published files parse with **0 issues**: Westpac/Qvalent NPP sample (27 records, 10 detail, 4,000,000 AUD) and SouthState BAI-2 guide sample (27 records, 12 detail, four accounts, 20,042,948 USD). The S5/S6 fingerprints moved with the rule and are re-pinned in `test/regressions/redefines-view.test.ts`; no committed report uses a BAI2 input, so `out/evidence/report.json` still verifies | (this commit) |
| 2026-11-23 02:55 | T10.4 | `npm run check:claims` (cold, after `rm .tmp/vitest-claims.json`) | the checker runs vitest itself, reports the measured counts, and fails with a readable message instead of ENOENT when the report is missing; it now also reads the one current-count line in this file. Published counts: README and this file at 334 tests / 25 files; the Devpost text and the video subtitle stay at 311, the count in force when they were recorded | (this commit) |
| 2026-11-23 02:56 | T10.5 | `npx tsc --noEmit && npx tsc -p tsconfig.static.json --noEmit && npx vitest run && python3 scripts/check-static.py` | 0 type errors both projects, 334 tests / 25 files, static checks pass with every scenario fingerprint equal to the CLI; `docs/guarantees.md` states where the three trimming comparisons are and names EBCDIC as a roadmap item; `docs/kiro-cli-validation.md`, `docs/kiro-session-evidence.md` and `out/evidence/report.json` no longer carry a `/workspace` path, an account address or a credit-request note, and the video build scripts derive their paths from `demo-video/build/paths.py`; the web screen now validates `toleranceDays` with the same rule as the CLI and MCP (`USAGE`, 400) instead of passing it through | (this commit) |
| 2026-11-23 04:10 | T10.6 Devpost sync | `npm run verify:public && npm run check:claims` and the Devpost `#1315473` project details and additional info forms | the submitted body now states 334 tests / 25 files (31 properties) and names the video's older count in place, 311 as recorded on 2026-11-22, instead of leaving the submission at a number the repository no longer measures. A new paragraph states the BAI2 check against the two bank-published files at 0 issues, the MCP paragraph states the path policy and the live-call cap of 3 (default 0), the register bullet states the JSON-array hash and the recorded head (`LEDGER_TRUNCATED`), and what's next adds the 823 mode and EBCDIC as a roadmap item. Body 11,448 chars, the Kiro-requirement field moved from 311 to 334; the entry is still `Submitted` / `5/5 steps done`; the video and its subtitle are untouched; 12/12 claims | (this commit) |
| 2026-11-23 19:28 | T10.7 | `npx tsc --noEmit && npx tsc -p tsconfig.static.json --noEmit && npx vitest run && npm run check:claims && python3 scripts/check-static.py` | the positional format is separated from ANSI X12 in README, `docs/guarantees.md` and the submission text: fixed-width 820/823 copybook files and BAI2 statements, not the delimited `ST*820*...~` transaction set, and no X12 segment parser in this build; 823 is stated as the bank side remittance and lockbox confirmation rather than a receipt that a payment was made; and the register is stated as tamper evident rather than tamper proof, because the chain and its head catch an edited, reordered or truncated entry while recomputing every hash and the head still verifies, so an outside anchor is a roadmap item. Both new limits are read from `docs/guarantees.md` by `820 verify` and by both screen strips. 0 type errors in both projects, 334 tests / 25 files, 12/12 claims, static checks pass with every scenario fingerprint equal to the CLI | (this commit) |
| 2026-11-23 19:50 | T10.8 Devpost sync | the Devpost `#1315473` About body, saved and read back on the public page | the submitted body now separates the fixed-width copybook formats from the delimited ANSI X12 transaction set that carries the same 820/823 numbers and states that no X12 segment parser is in this build, reads 823 as the bank side remittance and lockbox confirmation rather than a payment receipt, and states the register as tamper evidence rather than tamper proof, because a local chain without an outside anchor cannot stop a full rewrite. Body 12,211 characters (SHA-256 `ff62a677e7e479a81276aa6d6bcec2d16a53ceda3706a42f186a0e2148612e6a`), rendered headings, list and code spans checked on the public page, the entry still `Submitted` / `5/5 steps done`, and the video and its subtitle untouched. `.kiro/steering/product.md` gained one sentence so the steering file names the same scope as the README. 334 tests / 25 files, 12/12 claims | (this commit) |
| 2026-11-28 15:57 | T10.9 count cleanup | `npm run typecheck && npm test && npm run check:claims && npm run verify:public`, then the Devpost `#1315473` About body, saved and read back on the public page | an outside reviewer read the video as claiming 311 tests while the README said 334; the video linked in the README has been the 2026-11-27 cut, whose screen and subtitles state 334 tests in 25 files, so the stale sentences were the README build status line and two Devpost body sentences (the recorded-on-2026-11-22 sentence and the Update cross reference naming it). Both removed, the README line now says the linked video shows the same line on screen, and the Devpost body carries no 311 and no 2026-11-22 anywhere (17,291 to 16,994 chars, only those 297 removed). Entry still `Submitted`, video url unchanged. 0 type errors, 334 tests / 25 files, 19/19 claims, 2/2 published BAI2 files at 0 issues; evidence in `evidence/devpost-about-update-2026-11-28.md` and `evidence/devpost-property-para-311-removed-2026-11-28.png` | (this commit) |
