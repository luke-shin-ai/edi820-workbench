# Devpost submission draft: 「820」

Working draft for the Devpost form and the Kiro write-up. Everything here is answerable from the
repository. Nothing claims a Kiro feature that was not executed and recorded, and the closing
section states the five boundaries this submission keeps on purpose.

Form fields are marked **[form]**. The write-up answers are marked **[write-up]**.

---

## [form] Project name

「820」: a reconciliation workbench for dead payment files

## [form] Elevator pitch (tagline)

Read, reconcile and re-verify fixed-width EDI 820/823 payment files and BAI2 bank statements from
their COBOL copybooks, with a verdict that never comes from a model.

## [form] Category

Resurrection.

## [form] Built with

TypeScript, Node.js 22, Kiro CLI 3.5.0, a custom Kiro agent, Vitest with fast-check for property
based testing, an MCP server over stdio, and one dependency free HTML screen.

## [form] Text description

Corporate payment files never died. The people and tools that could read them did.

EDI 820 remittance orders, 823 confirmations, and BAI2 bank statements still move between banks and
ERP systems every day as fixed-width text. What each byte means is written in a COBOL copybook, and
a back office that cannot read it retypes the file into a spreadsheet.

「820」 takes a file plus its copybook (or a BAI2 file, which needs none) and runs four separate
layers:

1. **Parser.** Types every record at the copybook's byte offsets: trailing overpunch, leading
   separate sign, COMP-3 packed decimal with no line breaks, implied decimals. A copybook that
   declares `REDEFINES` (the same hundred bytes are the payment in one layout and the trailer in
   another) is read as a region: exactly the layout its discriminator selects, and an unmatched
   record is reported instead of guessed. Amounts are `bigint` minor units with an ISO 4217
   currency. No floating point anywhere.
2. **Reconciler.** Compares control totals per currency, record counts, payment references and value
   dates against a settlement window, and emits coded findings with signed deltas.
3. **Explainer.** An optional agent layer that narrates a finding, and is only allowed to cite
   numbers the first two layers produced. Anything else is refused and replaced with
   `INSUFFICIENT_EVIDENCE`. By default it runs a deterministic template and spends no credits.
4. **Human.** The exception register. A reason, an expiry date and a compensating control are
   required before an exception can exist.

The verdict is deterministic and re-derivable: `820 verify` re-runs the deterministic layers from
the recorded inputs and compares a SHA-256 fingerprint, read-only.

Three surfaces share one core: a CLI with exit codes 0/2/3, a web screen with three columns and
byte-offset evidence, and an MCP server with five tools. The web screen has two builds. One is
served locally on `127.0.0.1`. The other is a static, client-side build in `docs/demo` that runs
the same parser, reconciler, BAI2 reader, explainer and register compiled for the browser, so a
judge can click through the eight scenarios with no server at all, the two `REDEFINES` ones
included.

All sample data is synthetic, from a fictional company. No customer, bank or employer data is used.

## [form] Links

- Repository: to be published (public GitHub, Apache-2.0, `.kiro/` at the root)
- Video: `demo-video/820-demo-en.mp4`, 2 minutes 55 seconds (2:55.30, 175.3 s), English narration and subtitles
- Working application: the static build in `docs/demo/index.html` ("Runs in this tab"). It is the
  same engine compiled for the browser, so nothing is uploaded and the verdict still comes from
  code. Publishing that folder on GitHub Pages or Cloudflare Pages is one deploy and is the
  account holder's act; the URL is not claimed until it is live. The local server build
  (`npm run web`) remains the back-office path, bound to `127.0.0.1`.

---

## [write-up] How Kiro was used

The official write-up asks about eight Kiro features, plus a comparison to vibe coding. Each answer
below is tied to a file in the repository.

### 1. Kiro surfaces: IDE, CLI, Web, Crew

I used **Kiro CLI 3.5.0** and the **`.kiro` workspace format**. Not the IDE, not Web, not Crew.

- `kiro-cli whoami` shows a Builder ID session for the same account that requested the credits.
- `kiro-cli agent list` shows the project's `reviewer` agent discovered as a workspace agent, next
  to the three built in ones.
- `kiro-cli agent validate --path .kiro/agents/reviewer.json` exits 0. A deliberately broken config
  exits 1 with a schema error, so the 0 is a real pass, not a no-op.
- Four `kiro-cli chat --no-interactive` turns with the custom agent, the cheapest model
  (`qwen3-coder-next`, 0.05x) and `claude-haiku-4.5` (0.40x), with tool grants varied on purpose.

Why the CLI: the Kiro Web IDE requires a paid plan, and the free plan gives 50 credits a month while
the 4,000 credit request was pending. The CLI is the surface that could run headless, be logged, and
be replayed.

**Honest boundary:** I did not run the IDE spec flow (`spec to tasks to implementation inside a
session`). The spec was authored in this workspace from the copybooks, and the implementation ran
here with the spec as the contract. The repository says exactly that in `docs/copybook-to-spec.md`
rather than implying Kiro generated the code.

### 2. Custom agents

`.kiro/agents/reviewer.json` defines an adversarial cross-review agent: it reads the spec artifacts
and the deterministic layer's findings and tries to break the claims. It is not allowed to rewrite
code.

The most useful thing in the whole build came from this agent, and it is a negative result. With no
`tools` array in its config, the reviewer produced a fluent, confident review with file and line
citations, and three of its four claims were false because it had never read a file: it said no
decoder existed for zoned or packed decimal (both exist in `src/parser/decode.ts`), that
`CURRENCY_SCALE_MISMATCH` was emitted nowhere (it is emitted in `src/parser/parser.ts`), and that an
invalid overpunch returned zero silently (it throws, and a test asserts it).

With `tools: [read, grep, glob, thinking]` and a prompt that says read before you cite, the same
agent found two real defects:

- a record with a blank reference was skipped entirely, so it never appeared as `REF_UNMATCHED`,
  which is exactly the silent drop the tool claims not to do;
- the matched-reference count was derived by string-matching a human sentence in a finding's detail
  text, instead of being counted where matching happens.

Both are fixed with tests. This is why the product's agent layer may only cite numbers the
deterministic layers produced: a reviewer's confidence is not evidence.

### 3. Agent hooks

`.kiro/hooks/parser-guardrails.json` declares three hooks:

- `PostFileSave` matching `.(ts|mjs)$` and `copybooks/*.cpy`, which runs the unit and property test
  suites so the deterministic core stays honest while an agent edits;
- the stop hook (trigger `Stop` on CLI V3; `AgentStop` is only the display name and never fired),
  which resolves the newest report that holds a verdict and re-derives it with the real CLI entry,
  so fingerprint drift and a missing run both surface in the session;
- the task hook (trigger `PostTaskExec` on CLI V3, which is the name that fires; the documented
  display name `Post Task Execution` is not one), which appends one row to `EVIDENCE.md` and logs
  its own firing.

**What changed since the first draft:** all three now fire in live sessions, and `out/hook-log.txt`
is committed, so a reader can check the firings rather than take them on trust:

```
2026-11-21T09:32:22.134Z  trigger=PostFileSave  unit+pbt tests ran
2026-11-22T01:45:25.455Z  trigger=PostTaskExec  evidence row appended
2026-11-22T01:45:27.543Z  trigger=Stop  run=final-check  ...  exit=0
```

Each of them was broken before and was fixed by probing, not by reading: the stop hook's command
pointed at a module with no entry point and at `out/` instead of `out/<timestamp>/`, which printed
nothing and exited 0; its trigger name was `AgentStop`, which never fires; the task hook's trigger
name was `PostTaskExecution` instead of `PostTaskExec`, and no session had the spec tools at all
without `--mode spec`, so the hook could not have fired whatever it was called. The probe that
found each one is in `docs/kiro-session-evidence.md` (§2.1 and §8).

**What is still a boundary:** the `EVIDENCE.md` rows for T7.1 were written by the same script the
hook calls, invoked from the CLI, and they are marked that way. Only the T9.5 row is the hook's own
output.

### 4. Spec-driven development

`/README.md` is not the spec. The spec is `.kiro/specs/edi820-importer/`:

- `requirements.md`, 33 requirements in EARS form, in seven groups (25 core R1-R6, plus R8.1-R8.8
  for the register), and an explicit out-of-scope section;
- `design.md`, the layer split, the data model, the algorithms, and a delta log for every decision
  that changed while building (§10, §12, §14, §15), each recording what the design said first and
  why it changed;
- `tasks.md`, T0.1 to T9.5, each ending in a command whose output goes into the evidence log.

The conversion is documented in `docs/copybook-to-spec.md`: what the copybook decides by itself
(offsets, widths, sign, scale), what it cannot decide (is a short record re-synchronised or
reported? are totals compared per currency? may the agent explain a finding with no values?), and
where each of those answers was written.

**Compared to vibe coding:** a generated parser would have looked right and lost money. The first
`820.cpy` in this repo contradicted itself (header said 90 bytes, fields summed to 88) and the first
reconciliation draft derived a number from prose. Both were caught because a written requirement and
a property test existed to disagree with the code, not because a model was asked to be careful.

### 5. Steering docs

Five steering files, and one of them visibly changed the code:

- `tech.md` says money is never floating point. `design.md` section 2 had typed numeric values as
  `number`, which is a float. The implementation uses `bigint` minor units with the copybook's
  scale, and the change is recorded as implementation delta 1 in `design.md` section 10. A reviewer
  can see the steering file win over the design draft.
- `finance-file-conventions.md` holds the domain rules the projects depends on: per-currency totals,
  value date windows, sign conventions per file type, and the rule that a reference fallback match
  must still be reported when it fails.
- `conventions.md` holds the evidence rule (every task ends with a command whose output is logged)
  and the prohibitions (no floats, no silent re-sync, no model in the verdict path).
- `product.md` states who the tool is for and what it refuses to decide.
- `structure.md` keeps the layer boundaries that the review agent is asked to check.

**The strategy that made the biggest difference:** writing the prohibitions down as rules, not
preferences. "Never silently re-synchronise" is the kind of thing a generator will happily violate
because it makes the demo pass.

### 6. MCP

`src/mcp/` is a JSON-RPC 2.0 server over stdio with five tools: `parse_file`, `reconcile`,
`explain_findings`, `verify`, `exceptions`. Each returns the same JSON the CLI writes, because all
three surfaces call `src/core/ops.ts`.

It is implemented against the protocol directly (newline-delimited JSON-RPC, `initialize`,
`tools/list`, `tools/call`, `-32601` for unknown methods, `-32700` for a malformed line) because the
MCP SDK could not be installed in this build environment. `test/unit/mcp.test.ts` runs a real stdio
session against the process, including a malformed line that must not kill the server.

The point of the surface: a finance team can drive the deterministic core from their own assistant
without re-implementing fixed-width parsing, and the numbers they get back are the same numbers the
CLI prints.

**What changed since the first draft:** the server is now attached to the reviewer agent.
`.kiro/settings/mcp.json` registers it, and `.kiro/agents/reviewer.json` sets `includeMcpJson:
true` with `@820` in `allowedTools`. In the review session the agent called `@820/reconcile`,
`@820/exceptions` and `@820/verify`, and got back the verdict `FAIL` with 4 findings and the
fingerprint `7af64454…`. The same call replayed outside an agent (`node scripts/mcp-call.mjs`)
prints the same values, which is the point: the agent and the CLI are not two implementations.

### 7. Property-based testing

Seven property suites, 31 property tests, 311 tests in total.

- **Round trip:** parse a generated fixed-width file, serialize it, and the bytes are identical,
  including CRLF, a missing final newline, and a binary COMP-3 stream with no newlines at all.
- **Copybook compilation:** 500 generated copybooks compile to contiguous field starts from 1, and
  the field widths sum to the record length.
- **`REDEFINES`:** for generated two-layout copybooks, both layouts cover the same byte range, a
  record written through one layout parses back with that layout's fields and none of the other's,
  and a discriminator that selects no layout is reported rather than decoded.
- **Amounts:** typed values re-encode to the same bytes across overpunch, separate sign and packed
  decimal encodings. This property found a real bug: the encoder sized values by integer digits only,
  so implied decimals were dropped.
- **Truncation:** a 99-byte record keeps its neighbours in place and is reported, not re-synced.
- **Explanation grounding:** a draft that cites a foreign amount is always rejected, the finding's
  own values are always accepted, and evidence is monotone under added values.
- **Reconciliation:** two runs over the same inputs give the same fingerprint.

The overpunch table was also wrong in the first draft: it was built from `'A' + 0`, so `A` mapped to
0 instead of +1. The property that caught it is kept as
`test/regressions/overpunch-and-width.test.ts`.

### 8. Kiro powers

Not used. Nothing in this repository depends on a bundled power, and I would rather say that than
describe a power I read about.

If I were rebuilding it with the credit grant, the two that fit are a testing power (to make the
property suites part of the hook loop rather than a command I run) and a documentation power for the
copybook dialect page, which is the document a finance team would actually read first.

### 9. What the video shows

Two minutes fifty five (2:55.30, 175.3 s), English narration and burned-in subtitles, no music. It
opens on Kiro, not on a logo:

- **0:00 to 0:26** the hook log from a real session (a file save ran the tests, the stop hook
  re-derived the newest verdict, and the task hook appended its own evidence row), then a replay of
  the reviewer agent's MCP calls with the verdict and fingerprint the server returned.
- **0:26** the product arrives on a copybook: this bank copybook gives one 100-byte area two
  meanings, the payment and the trailer declared with `REDEFINES`, drawn with the compiler's own
  byte ranges (2 to 101, twice) and the rule that picks one (`REC-TYPE` = P or T).
- **0:41.9** a trailer record read through its own layout: `TOTAL-AMOUNT` at bytes 22 to 34, the
  detail fields that share those bytes absent from the record.
- **1:03.6** a PASS on ten payments totalling 1,284,550.00 USD, then a file with four defects and
  the byte range behind each finding, then the BAI2 delta with its credits and debits named.
- **1:50.9** a waiver in the exception register that leaves the verdict at FAIL, `verify`
  re-deriving the same fingerprint, 311 tests (31 of them properties), and the session evidence:
  including task 9.5 run through Kiro's task runner, where the task hook wrote the evidence row.

---

## [form] Challenges

**Trust is the product.** The first version of the tool was easy. The hard part was removing every
place where the tool could quietly be right for the wrong reason: a short record silently
re-synchronised, a blank reference dropped, a matched count derived from prose, a BAI2 trailer
counted in three different branches. Four of the six defects listed in `EVIDENCE.md` are of that
kind.

**The copybook is not a spec.** It gives byte offsets and nothing about what must be true. Writing
25 core requirements that a copybook cannot express is where most of the design work went.

**A confident reviewer is not a reviewer.** The custom agent's failure without read tools was more
instructive than its success, because the product makes the same distinction between a model that
narrates and a layer that proves.

## [form] Accomplishments

- 311 tests, 31 of them properties over generated inputs, with a regression file for every failure
  the build found in itself, including a truncated record that used to reach `PASS` with zero
  findings (now `INCOMPLETE`, exit 2) and a `REDEFINES` record whose type byte was damaged in
  transit (now reported, its bytes left undecoded).
- Three byte layouts (trailing overpunch, COMP-3, leading separate sign), one `REDEFINES` region
  with two active layouts, and three formats (820, 823, BAI2) through one reconciler.
- A verdict anyone can re-derive: `verify` prints both fingerprints and the first differing field
  path, and does not touch the report.
- An agent layer that cannot invent a number, and costs zero credits by default.
- A human layer that cannot be edited back into agreement: the exception register is append only
  and hash chained, a waiver carries an owner, a reason, a compensating control and an expiry, and
  editing any entry afterwards breaks the chain at that sequence number.
- One engine in three places: the CLI, the local screen and a static browser build share the
  parser and the reconciler, and the static build's fingerprints are asserted equal to the CLI's
  for all eight sample scenarios (`scripts/check-static.py`).
- A public statement of the boundary (`docs/guarantees.md`) that is part of the product: it is shown
  in both strips of the screen and printed by the CLI.

## [form] What's next

- Publish the static build so the URL is live, then upload the video and submit.
- A host-side witness: two independent runs of the same file on different machines, compared by
  fingerprint.
- Streaming parse for files larger than memory, and `OCCURS DEPENDING ON`, which changes every
  offset after it and therefore needs a decided rule rather than a parser tweak.

---

## How the Kiro pieces fit, and the five lines this submission does not cross

One Kiro CLI workspace, with five mechanisms inside it, used as one loop rather than as six features
in a list:

- **Spec** (`.kiro/specs/edi820-importer/`): the copybooks became 33 EARS requirements, a design
  that records a delta for every decision that changed while building, and tasks whose last line is
  a command. Layer 4, the exception register, was then implemented from task T7.1 inside a Kiro
  session.
- **Steering** (`.kiro/steering/`): five files carry the rules that make the spec bite: money is
  never a float, never re-synchronise silently, no model in the verdict path. One of them overruled
  the design draft (delta 1, `bigint` minor units), which is the clearest evidence that steering was
  read rather than filed.
- **Custom agent** (`.kiro/agents/reviewer.json`): an adversarial reviewer with read, grep and glob
  grants. Its first pass, without tools, produced confident nonsense with citations; once it could
  read, it found two real defects that are now fixed and tested. The explainer layer is built on the
  same lesson: confidence is not evidence.
- **Hooks** (`.kiro/hooks/parser-guardrails.json`): `PostFileSave` runs the unit and property suites
  while an agent edits, the stop hook re-derives the newest verdict and reports fingerprint drift,
  and the task hook appends the evidence row. `out/hook-log.txt` is committed and holds every
  firing, including the one the task hook wrote for itself.
- **MCP** (`src/mcp/`, `.kiro/settings/mcp.json`): the deterministic engine as five tools, attached
  to the reviewer agent, so the review session called `@820/reconcile`, `@820/verify` and
  `@820/exceptions` and received the engine's own answer instead of a description of the code.
- **CLI V3**: the surface that ran headless and could be replayed: `kiro-cli chat --no-interactive`
  with the custom agent, `agent validate`, and tool grants varied on purpose.

The loop, in one sentence: the spec said what must be true, steering said what is forbidden, the
agent tried to break both, the hooks ran the proofs, and the MCP server gave the agent the same
numbers the command line prints.

Five boundaries are stated here so a judge does not have to find them:

1. **Scope of generation.** Kiro implemented layer 4 (the exception register, its CLI commands, its
   MCP tool, 38 tests) from spec task T7.1 in one session. The earlier layers were built in this
   workspace with the spec as the contract, alongside the CLI sessions and the steering files.
   `EVIDENCE.md` marks which rows came from which session.
2. **The task hook.** It was unobserved until 2026-11-22: the T7.1 task was passed as a prompt
   rather than through the task runner, and the hook's trigger name was wrong. Now task T9.5 is set
   to `in_progress` and `completed` by Kiro's own `task_update` tool inside a `--mode spec` session,
   and the `PostTaskExec` hook appends its row; the firings are in the committed `out/hook-log.txt`.
3. **Kiro powers.** Not used. Nothing here depends on a bundled power.
4. **Hosting.** The static build is verified in a browser and is not deployed yet. Publishing it is
   the account holder's act, and the URL is not claimed until it is live.
5. **The video.** It is 2:55 with a synthesised voice, so nobody has watched it end to end with a
   human ear, and the IDE surface (as opposed to the CLI) was not part of the build.
