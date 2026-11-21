# Kiro sessions — what the agent did, what fired, what it returned

This file is evidence, not a write-up of an intention. Every line below comes from a command
that ran on **2026-11-21** in this repository with `kiro-cli 3.5.0`, logged in with a Builder ID
and the free credit allowance. Where a claim could not be checked, the file says so.

## 1. Sessions

| # | purpose | command shape | model | turns | outcome |
|---|---|---|---|---|---|
| S1 | implement spec task **T7.1 (L4 exception register)** | `kiro-cli chat --v3 --agent 820-implementer --no-interactive --trust-workspace --trust-all-tools` | `claude-haiku-4.5` | 3 (the first two were cut by the 300 s tool budget and resumed with `-r`) | `src/exception/{register,index}.ts`, CLI `exceptions/waive/release`, MCP `exceptions` tool, 37 unit tests + PBT suite |
| S2 | adversarial review of T7.1 **through the project's own MCP server** | `kiro-cli chat --v3 --agent reviewer --no-interactive --trust-tools=read,grep,glob,@820` | `claude-haiku-4.5` | 1 | 3 MCP tool calls, one MINOR finding, all R8 rows checked |
| S3 | add one round-trip test (to exercise `PostFileSave` on a `.ts` save) | same as S1 | `claude-haiku-4.5` | 1 | one test added, 38 exception tests pass |

Credits: the four sessions and two earlier smoke runs used the free allowance; no paid credit
was purchased. The exact balance is not printed by the CLI, so this file does not claim a number.

The raw CLI transcripts are in `logs/kiro-t71-pass{1..4}.log` and `logs/kiro-reviewer-l4.log`.
`logs/` is deliberately outside the public repository (it also holds earlier login attempts), so
the excerpts in §5 are the part a reviewer can read.

## 2. Hooks that actually fired

Measured by each hook writing one line to `out/hook-log.txt` when it runs (`scripts/log-hook.mjs`
for the test hook, `scripts/verify-latest.mjs` for the stop hook). The file is reproduced here
verbatim; times are UTC.

```
2026-11-21T09:30:16.746Z  trigger=Stop  run=l4-review  command=.../tsx .../src/cli/main.ts verify out/l4-review  exit=0
2026-11-21T09:32:22.134Z  trigger=PostFileSave  unit+pbt tests ran
2026-11-21T09:32:33.573Z  trigger=Stop  run=l4-review  command=.../tsx .../src/cli/main.ts verify out/l4-review  exit=0
```

(An earlier line at `09:28:20.092Z` records the same `Stop` hook verifying `out/evidence` with
`exit=0` at the end of S1.)

The `Stop` hook's own terminal output — the one a session shows to the agent:

```
verify: newest run out/l4-review
verify: npx tsx src/cli/main.ts verify out/l4-review
verify .../out/l4-review/report.json
  recorded fingerprint   7af64454555de8d89b5c4f763009547caaa6f53b1c040db8d8c462c04335c118
  recomputed fingerprint 7af64454555de8d89b5c4f763009547caaa6f53b1c040db8d8c462c04335c118
  recorded verdict FAIL   recomputed verdict FAIL
  read-only: report 6107 → 6107 bytes, mtime unchanged
  RESULT: identical — same inputs, same verdict
```

### 2.1 Two trigger names were wrong, and one of them hid a dead hook

- `.kiro/hooks/parser-guardrails.json` declared the stop hook with `"trigger": "AgentStop"`.
  A probe hook that wrote to a file on `AgentStop` **never fired**; the same probe on `Stop`
  fired on the next session (`UserPromptSubmit` fired too). `AgentStop` is the display name in
  the docs; on CLI V3 the trigger is `Stop`. The file now says `Stop`.
- The command itself pointed at `src/cli/index.ts`, which exports `runCli` and has no entry
  point, and at `out/`, while reports live in `out/<timestamp>/`. That produced no output and
  `exit 0` — the exact "silent no-op" a reviewer would call a fake. It now calls
  `scripts/verify-latest.mjs`, which resolves the newest `out/*/report.json` that holds a
  verdict and hands it to the real entry point `src/cli/main.ts verify`, exiting with the CLI's
  own code and logging the firing.
- File and task triggers need the V3 engine; with the default engine under `--no-interactive`
  nothing fires. Every session above therefore ran `--v3`.
- `PostTaskExecution` is declared but was **not observed firing** in these sessions: the agent
  never ran a spec task through Kiro's task runner (the task text was passed as a prompt). The
  `EVIDENCE.md` rows that a task hook would have appended are written by hand below and marked
  with the session they came from.

## 3. MCP: the project's own server, called by the project's own agent

`.kiro/settings/mcp.json` registers the stdio server, and `.kiro/agents/reviewer.json` carries
`includeMcpJson: true` plus `@820` in `allowedTools`:

```json
{ "mcpServers": { "820": { "command": "npx", "args": ["tsx", "src/mcp/main.ts"] } } }
```

`kiro-cli mcp list` resolves it for `kiro_default`, `820-implementer` and `reviewer`. The
reviewer's session (S2) then made three real calls. Its own summary, with the values the server
returned:

```
[tool] @820/reconcile
[tool] status: Completed
[tool] @820/exceptions
[tool] status: Completed
[tool] @820/verify
[tool] status: Completed

Reconcile: status FAIL with 4 findings
  fingerprint 7af64454555de8d89b5c4f763009547caaa6f53b1c040db8d8c462c04335c118
  CONTROL_TOTAL_MISMATCH, DATE_OUT_OF_WINDOW, REF_UNMATCHED (x2)
Verify: ok true — recomputed fingerprint equals recorded, report bytes 6107 -> 6107,
  mtime unchanged, recorded FAIL = recomputed FAIL
Exceptions: all 4 findings OPEN, unadjudicated 4
```

Its answers to the three questions it was asked, quoted from the session:

> 1. **Does a waiver change the verdict?** NO. The @820/verify call proves the verdict
>    fingerprint remains identical whether a ledger exists or not.
> 2. **Does a waiver for one finding cover another?** NO. The finding key is computed over
>    `code|recordIndex|field|reference|declared|computed|delta`.
> 3. **What exit code would an OPEN exception produce?** `2`.

The same fingerprint is what the CLI prints for the same inputs, because both surfaces call
`src/core/ops.ts`. That equality is the point of exposing the core over MCP at all.

### 3.1 A machine-readable copy of one call

The review session was also run once with `--output-format stream-json`, which records each tool
call as an event. `logs/kiro-mcp-stream.jsonl` (kept out of the public repository with the rest of
`logs/`) has, at line 93, the call with its arguments:

```
{"type":"sessionUpdate","data":{"update":{"sessionUpdate":"tool_call","toolCallId":"tooluse_VVXyTkR2CooOyl2Gg9AJra",
 "title":"@820/reconcile","rawInput":{"filePath":"samples/data/820-bad.txt","copybookPath":"samples/copybooks/820.cpy", ...}}}}
```

and at line 97 the same call completed, carrying the server's JSON reply. `scripts/mcp-call.mjs`
replays the same three calls without an agent in front of the server, so the numbers can be
reproduced by anyone:

```
$ node scripts/mcp-call.mjs
@820/reconcile
  verdict     FAIL
  findings    4  (CONTROL_TOTAL_MISMATCH, DATE_OUT_OF_WINDOW, REF_UNMATCHED)
  fingerprint 7af64454555de8d89b5c4f763009547caaa6f53b1c040db8d8c462c04335c118
@820/verify
  ok          true   first difference: none
  report      6107 -> 6107 bytes, mtime unchanged
@820/exceptions
  counts      OPEN 4  WAIVED 0  EXPIRED 0  RELEASED 0   unadjudicated 4
```

## 4. What the session produced, and what it got wrong

Files written by S1, with the diff readable in the commit that follows this file:

| file | what it is |
|---|---|
| `src/exception/register.ts` | the pure register: finding identity, hash chain, `appendWaiver`, `appendRelease`, `verifyLedger`, `classify` |
| `src/exception/index.ts` | re-export |
| `src/reconcile/reconciler.ts` | `findingKey()` exported and reused by `normaliseFinding()` so a waiver and a verdict cannot disagree about identity |
| `src/cli/index.ts` | `exceptions`, `waive`, `release` |
| `src/mcp/server.ts` | read-only `exceptions` tool |
| `test/unit/exception.test.ts`, `test/pbt/exception.pbt.test.ts` | 38 tests: status machine, rejected input, tamper detection, finding identity, append immutability, round-trip, chain properties |

The agent's own final line was `TypeScript: 0 errors / Test Files 20 passed / Tests 270 passed`.
Both were re-run independently after the session: `npx tsc --noEmit` exits 0, and
`npx vitest run` printed `20 passed / 270 passed`. The claim was true.

### 4.1 Repairs made after the session (so the code matches `design.md` §13)

1. **Typing at the boundary.** The CLI and MCP passed `report.verdict.findings` (JSON) straight
   into `classify` with `as any`. Both now call `reviveFindings()`, so a finding's amounts are
   `bigint` again before its key is computed — the same code path L3 uses.
2. **A tampered ledger could be extended.** `waive` and `release` appended to whatever the file
   held. Both now run `verifyLedger` first and exit 3 (`error (SPEC): ledger integrity failed at
   seq 1: hash mismatch at seq 1`) instead of chaining a new decision onto a broken history.
3. **`unadjudicated` contradicted the status machine.** `classify` counted only `OPEN + EXPIRED`,
   while §13.4 says a released exception is back in front of a human. It now counts
   `OPEN + EXPIRED + RELEASED`; the authored test that asserted `unadjudicated === 0` after a
   release was corrected to 1 (the test, not the sentence, was wrong).
4. **`release` now requires `--control`**, because R8.1 says every entry carries a compensating
   control. This closes the reviewer's only MINOR finding (see §6).
5. **EPIPE guard** in `src/cli/main.ts`: piping the CLI to `head` (which a hook does) used to
   crash with an unhandled `EPIPE` stack trace.
6. **CLI-level exit-code tests** were added for R8.6 (OPEN→2, all waived→0, release→2, tampered
   ledger→3, expired→2), because the authored tests exercised the module but not the process
   boundary.

After those repairs the suite is **275 tests, 20 files** (`npx vitest run`, 2026-11-21 18:32 KST).

## 5. Transcript excerpts

S1, first turn (implementation):

```
I'll execute T7.1 step by step. Let me start by reading the requirements and design specs.
[tool] Read File            [tool] status: Completed
[tool] Code Intelligence    [tool] status: Completed
...
Good, it's already exported via `export *`. Now let me update the exception register to import
findingKey from reconciler instead of implementing it locally:
[tool] Replace in File      [tool] status: Completed
Now let me add the CLI subcommands for `exceptions`, `waive`, and `release`.
[tool] Replace in File      [tool] status: Completed
Now let me add the MCP tool for exceptions.
[tool] Replace in File      [tool] status: Completed
Now let's create comprehensive tests for the exception register.
[tool] Write File           [tool] status: Completed
```

S1, third turn (finish + verify):

```
Continue and finish T7.1: fix the remaining failing tests by correcting the code (not by
deleting assertions), then run 'npx tsc --noEmit' and 'npx vitest run' one final time ...
[tool] Check for TypeScript compilation errors   [tool] status: Completed
[tool] Run all tests and capture results         [tool] status: Completed
Test Files  20 passed (20)
     Tests  270 passed (270)
```

S3 (the save that fired `PostFileSave`, then `Stop`):

```
Now I'll add one test that builds a ledger with a waiver and a release, writes and reads it back
[tool] Replace in File      [tool] status: Completed
[tool] Run Command          [tool] status: Completed
Report: Added one test ... 'npx vitest run test/unit/exception.test.ts' -> 38 passed
```

## 6. The reviewer's finding, and the rest of its verdict

The only item it raised against the register:

> **MINOR** — `src/exception/register.ts`: the release entry's `compensatingControl` defaults to
> `''` when not provided, but R8.1 says every entry carries a compensating control.

Resolved by requiring `--control` on `kiro-cli`'s release path (§4.1 item 4), so the field is
never empty from the CLI. The module still accepts an empty one from a direct caller; that is
recorded in `design.md` §13.6 as a caller's responsibility rather than papered over.

Everything else it marked ✓ against R8.1–R8.8 with file and line references, and it answered the
three contract questions from tool output rather than from the prose — which is the reason the
MCP server exists.

## 7. Limits of this evidence

- These are **non-interactive** sessions. No human typed in the same window; the agent's tool
  calls arrived from a prompt that named the spec task, which is what a CI or a scripted run
  would do. The IDE surface was not used, and the write-up says so.
- The reviewer had read-only tools plus `@820`; it could not have changed code, and did not.
- Two of S1's turns were cut by the 300-second budget of the tool that launched them and resumed
  with `kiro-cli chat -r`; that is why S1 has three turns rather than one.
- `PostTaskExecution` remains declared-but-unobserved (§2.1). No row in `EVIDENCE.md` claims it.
- The credit balance is not visible to the CLI, so no credit count is claimed here.
