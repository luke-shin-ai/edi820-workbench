# EVIDENCE — build log

> Append-only. One row per completed spec task, written by the `PostTaskExecution` hook
> (`scripts/append-evidence.mjs`). Until the hook fires inside a Kiro session, the same script is
> invoked by hand with the same payload shape — the rows are identical either way, and this note
> says which way it was.
> Format: `YYYY-MM-DD HH:MM | task | command | result | commit`
> Test counts are from `npx vitest run`: **222 tests / 17 files** (194 unit, 22 property, 6
> regression) at T5, 148 before T4/T5.

| when | task | command | result | commit |
|---|---|---|---|---|
| 2026-11-21 (setup) | T0.0 scaffold | — | spec/steering/hooks/agents authored from the copybook contract | (pre-repo) |
| 2026-11-21 13:45 | T0.1 | `git ls-files .kiro` → 10 lines | 10 `.kiro` files tracked (specs 3, steering 5, hooks 1, agent 1); 55 files in the first commit | 6dfa9aa |
| 2026-11-21 13:45 | T0.2 | `node scripts/append-evidence.mjs` | hook script executed with a PostTaskExecution-shaped payload; this row written | 6dfa9aa |
| 2026-11-21 13:45 | T0.3 | `npx tsx scripts/gen-fixtures.mjs` | 5 fixtures / 54 records / 4,890 bytes; defects listed in `samples/data/DEFECTS.md` and asserted by the fixture tests | eaca8e9 |
| 2026-11-21 13:45 | T1.1 | `npx vitest run test/unit/copybook` | 19 passed (cumulative offsets, implied decimals, COMP-3 width, sign conventions) | 55c0f1e |
| 2026-11-21 13:45 | T1.2 | `npx vitest run test/unit/copybook -t R1.4` | 6 error-path tests passed: unparsable line, unknown clause, REDEFINES, OCCURS, overlap naming both fields, uncovered-gap note | 55c0f1e |
| 2026-11-21 13:45 | T1.3 | `npx vitest run test/pbt/copybook` | 3 properties / 500 generated copybooks (contiguous starts from 1, `recordLength` = Σlength, no silent overlap) | 6ea5bba |
| 2026-11-21 13:45 | T2.1 | `npx vitest run test/unit/parser` | 25 passed (slicing without trimming, trailer detection via the copybook, fixed framing) | 3dc4040 |
| 2026-11-21 13:45 | T2.2 | `npx vitest run test/unit/overpunch` | 57 passed: 22-case overpunch table (`{ } A–I J–R`), packed sign nibbles C/F/D, leading/trailing separate sign | 3dc4040 |
| 2026-11-21 13:45 | T2.3 | `npx vitest run test/unit/parser -t R2.2` | 4 passed (a 99-byte record keeps its neighbours in place; an invalid amount is a coded issue, not an exception) | 3dc4040 |
| 2026-11-21 13:45 | T2.4 | `npx vitest run test/pbt/parser` | 5 properties / 900 cases; parse→serialize byte-identical including CRLF, no final newline, and the binary COMP-3 stream | 6ea5bba |
| 2026-11-21 13:45 | T2.5 | `npx vitest run test/pbt/parser test/regressions` | truncation property (150 cases) + 6 regression tests kept from the first PBT failures (overpunch offset, implied-decimal width, packed padding nibble) | 6ea5bba |
| 2026-11-21 13:45 | T3.1 | `npx vitest run test/unit/reconcile` | 19 passed; delta = computed − declared: −100.00 USD on 820-bad, −45,000.00 USD on 823-bad, currencies kept in separate buckets | fffd2db |
| 2026-11-21 13:45 | T3.2 | `npx tsx scripts/demo-reconcile.mjs` | 820-bad vs 823-bank: `REF_UNMATCHED` ×2 — 820-only `NWP-2611-0011`, bank-only `NWP-2611-0010`; good pair 10/10 matched | fffd2db |
| 2026-11-21 13:45 | T3.3 | `npx tsx scripts/demo-reconcile.mjs` | `DATE_OUT_OF_WINDOW` at record 2 (2026-11-14 vs window 2026-11-18..2026-11-20, tolerance 0d); tolerance 4d accepts it | fffd2db |
| 2026-11-21 13:45 | T3.4 | `npx vitest run test/pbt/reconcile` + demo | 3 properties / 550 cases; two runs give identical fingerprints (S1 `b373f3a5…`, S3 `a69a9c1d…`) | 6ea5bba |
| 2026-11-21 13:45 | Kiro-CLI | `kiro-cli whoami`, `agent list`, `agent validate --path .kiro/agents/reviewer.json`, `chat --agent reviewer --no-interactive --model qwen3-coder-next` | Builder ID session on the account the credits were requested for (address redacted here; it is in the workspace's non-public `procedure-status.md`); `reviewer` discovered as a workspace agent; validate exit 0 (broken config exits 1); one smoke turn answered `READY` | 6dfa9aa → 72639cd |
| 2026-11-21 13:45 | TYPE | `npx tsc --noEmit` | 0 errors (strict + noUncheckedIndexedAccess) | 6ea5bba |
| 2026-11-21 13:58 | REVIEW-3 | `kiro-cli chat --agent reviewer --model claude-haiku-4.5 --trust-tools=read,grep,glob` | reviewer read `reconciler.ts` and `decode.ts` (tool log present); 1 real MINOR (matched-count derived from a detail string) | d301056 |
| 2026-11-21 14:00 | FIX-REVIEW | `npx vitest run test/unit/reconcile` | blank reference now reported as `REF_UNMATCHED` instead of being skipped; matched count tracked explicitly; 148 tests pass, tsc clean | d301056 |
| 2026-11-21 14:10 | T4.1 | `npx vitest run test/unit/explain` | 14 passed; the prompt carries the serialised finding plus the steering excerpt for that code and nothing else (asserted absent: record text, another finding's reference); the citation is attached by code, not by the model | d301056 |
| 2026-11-21 14:10 | T4.2 | `npx vitest run test/pbt/explain.pbt` | 5 properties / 700 generated cases: a foreign amount or record index is always rejected; the finding's own renderings are always accepted; evidence is monotone under added values | d301056 |
| 2026-11-21 14:10 | T4.3 | `npx vitest run test/unit/explain` | an evidence-less finding is refused before any adapter call (spy call count 0); the fallback text contains no digits; budget 0 falls back with `live-call budget 0 exhausted`; an HTTP 429 falls back keeping the reason | d301056 |
| 2026-11-21 14:10 | T5.1 | `npx tsx src/cli/main.ts reconcile --copybook samples/copybooks/820.cpy --file samples/data/820-bad.txt --bank samples/data/823-bank.txt --bank-copybook samples/copybooks/823.cpy --window 2026-11-18..2026-11-20` | FAIL, 4 findings, fingerprint `a69a9c1d…`, exit 2; `parse` exits 2 on `RECORD_LENGTH_MISMATCH`; spec/IO errors exit 3; 13 CLI tests including one real process-boundary exit code | d301056 |
| 2026-11-21 14:10 | T5.2 | `npx tsx src/cli/main.ts verify <outDir>` | recorded = recomputed fingerprint; report 5,582 → 5,582 bytes and mtime unchanged; a tampered fingerprint gives exit 2 and `first differing field: verdict.fingerprint`; a changed input file also gives exit 2 | d301056 |
| 2026-11-21 14:10 | T5.3 | `tsx src/web/main.ts --port 8720` + headless Chromium at 1920×1200 | PASS screen: 3 columns, 5 guaranteed + 4 not-guaranteed chips, 10 details, 0 findings; FAIL screen: 4 findings, clicking row 2 moved the highlight from `AMOUNT` bytes 24–36 to `VALUE-DATE` bytes 40–47; 0 page errors; `screenshots/ui-pass.png`, `screenshots/ui-fail.png` | d301056 |
| 2026-11-21 14:10 | T5.4 | `npx tsx src/mcp/main.ts` (real stdio session) | 4 tools (`parse_file`, `reconcile`, `explain_findings`, `verify`); `initialize` → `tools/list` → `tools/call parse_file` returns 11 records; a malformed line returns `-32700` and the server keeps serving; 9 tests | d301056 |
| 2026-11-21 14:10 | TYPE+TEST | `npx tsc --noEmit && npx vitest run` | 0 errors; 222 tests in 17 files (148 before this stage) — 194 unit, 22 property, 6 regression | d301056 |
| 2026-11-21 15:30 | T6.1 | `npx tsx demo-video/build/dump-copybook.mjs` | compiler-derived layout for three copybooks (100/88/80 bytes, AMOUNT at 24–36, 24–30, 25–38); `docs/copybook-to-spec.md` rewritten around those numbers, with the four Kiro questions answered and the answer "the IDE spec flow was not run" | c65a45f |
| 2026-11-21 15:52 | T6.3 | `python3 demo-video/build/capture_states.py` | real empty state and a real error state (`IO cannot read sample samples/data/missing-file.txt`) captured from the running screen; committed as `docs/images/ui-empty.png`, `ui-error.png` | c65a45f |
| 2026-11-21 15:55 | T6.2 | — | `devpost-submission-draft.md`: submission text plus all eight Kiro write-up topics and the vibe-coding comparison, each tied to a file, closing with five claims the submission does not make | c65a45f |
| 2026-11-21 15:56 | T6.3b | — | `review.md`: checklist status, five scores (8.0 average), five repairs applied in this pass, four residual risks, next actions by owner | c65a45f |
| 2026-11-21 16:05 | T6.4 | `python3 demo-video/build/build.py check` | 161.13 s (2:41), 17.14 MB, 1920×1080 H.264 752 kb/s + AAC 87 kb/s, 31 subtitle cues; page errors 0 during capture | c65a45f |
| 2026-11-21 16:06 | TYPE+TEST | `npx tsc --noEmit && npx vitest run` | 0 errors; 222 passed (222) in 17 files | c65a45f |

## Demo run (the numbers the video shows)

`npx tsx scripts/demo-reconcile.mjs` — full output saved under `out/<timestamp>/demo-report.json`.

| scenario | verdict | detail |
|---|---|---|
| S1 `820-good` + `823-bank` | **PASS** | 10 details each, declared 1,284,550.00 USD = summed, 0 findings |
| S2 `820-packed-good` + `823-bank` | **PASS** | same payments as S1 with COMP-3 amounts (88-byte records, no line breaks) |
| S3 `820-bad` + `823-bank` | **FAIL**, 4 findings | control total −100.00 USD; 1 short record; 2 unmatched references; 1 value date outside the window |
| S4 `820-good` + `823-bad` | **FAIL**, 3 findings | bank trailer declares 10 / 1,284,550.00, 9 records arrived: count −1, total −45,000.00, 1 unmatched reference |
| S5 `820-good` + `bai2-good` | **PASS** | comma-delimited statement; 03/100 total credits = summed details; 10/10 references matched |
| S6 `820-good` + `bai2-bad` | **FAIL**, 3 findings | control total −79,025.00 USD (missing detail + a bank-side debit fee), `REF_UNMATCHED` both directions (`NWP-2611-0010` 820-only, `BANK-FEE-2611` bank-only) |

## Defects found by the build itself (not planted in fixtures)

1. **The scaffold copybook contradicted itself**: header said 90 bytes, the `PIC` clauses summed to
   88, and a one-byte `SIGN-IND PIC X(1) SIGN TRAILING OVERPUNCH` field claimed to carry the sign of a
   *different* field's amount. The compiler derives `recordLength` from the field sum only; the layout
   was corrected and the convention moved onto the amount field itself (`docs/copybook-dialect.md` §5).
2. **Overpunch table off by one** — found by the first run of `test/pbt/amounts.pbt.test.ts`: the table
   was built from `'A' + 0`, mapping `A → 0 … J → +9` instead of `A → +1 … R → −9`. Every overpunched
   amount was wrong. Kept as `test/regressions/overpunch-and-width.test.ts`.
3. **Implied decimals dropped when encoding** — found by the "typed values re-encode to the same bytes"
   property on a `PIC 9(3)V99` copybook: the encoder sized values by integer digits only. Fixed; the
   regression file pins the width rule.
4. **A planted defect was invisible**: the first `820-bad` reference break was masked by the
   amount+date fallback match, because the broken record still matched a bank record on amount. The
   fixture now moves one cent between two records, so the reference break survives the fallback and
   the total still differs by exactly −100.00. That is the fallback being *tested*, not trusted.
5. **A blank reference was dropped** — found by the reviewer agent's second pass (which was otherwise
   full of invented line numbers) and confirmed by hand: `referenceRecords` skipped blank references,
   so such a record never reached `REF_UNMATCHED`. Fixed with a test; the matched count is now tracked
   inside the matching routine instead of being derived from finding text.
6. **The agent config had no tools** — `.kiro/agents/reviewer.json` declared resources but no `tools`
   array, so the reviewer could not read a file and produced a confident review of code it had never
   seen. Fixed (`read`, `grep`, `glob`, `thinking`); the prompts now say “read before you cite”.
7. **BAI2 record counting was wrong in the first draft** — the reader incremented a group
   record counter from three different branches, so the `98` count check could pass or fail
   for the wrong reason. Replaced with an index-derived count (`index - startIndex + 1`),
   which is what the trailer actually describes. Caught by writing the "self-consistent file
   has no issues" property before trusting the fixture.
8. **The web legend was invalid HTML** — the field legend was injected as `<tr>/<td>` into a
   `<dl>`, so the browser flattened it into one unreadable line. Found in the first real
   browser render (`screenshots/ui-pass.png`), fixed by emitting a real `<table>`; the second
   render shows the copybook's fields as coloured byte ranges. A screenshot is evidence —
   this one was wrong, and looking at it is what caught the defect.

## How the T6 rows were produced

- The rows above were appended by `node scripts/append-evidence.mjs` with the same payload shape the
  hook would pass. The hook is committed in `.kiro/hooks/parser-guardrails.json`; it was not observed
  firing inside a live Kiro session, and no row claims it did.
- The video's numbers are read from the files at render time: the copybook byte offsets come from the
  compiler (`dump-copybook.mjs`), the screenshots come from the running server with 0 page errors,
  and the terminal plates are rendered from the captured stdout in `demo-video/build/outputs/`.
