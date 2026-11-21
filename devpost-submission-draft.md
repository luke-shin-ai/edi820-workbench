# Devpost submission draft: 「820」

Working draft for the Devpost form and the Kiro write-up. Everything here is answerable from the
repository. Nothing here claims a Kiro feature that was not executed and recorded; where a claim
would be a stretch, the last section says so.

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
   separate sign, COMP-3 packed decimal with no line breaks, implied decimals. Amounts are `bigint`
   minor units with an ISO 4217 currency. No floating point anywhere.
2. **Reconciler.** Compares control totals per currency, record counts, payment references and value
   dates against a settlement window, and emits coded findings with signed deltas.
3. **Explainer.** An optional agent layer that narrates a finding, and is only allowed to cite
   numbers the first two layers produced. Anything else is refused and replaced with
   `INSUFFICIENT_EVIDENCE`. By default it runs a deterministic template and spends no credits.
4. **Human.** The exception register. A reason, an expiry date and a compensating control are
   required before an exception can exist.

The verdict is deterministic and re-derivable: `820 verify` re-runs the deterministic layers from
the recorded inputs and compares a SHA-256 fingerprint, read-only.

Three surfaces share one core: a CLI with exit codes 0/2/3, a single web screen with three columns
and byte-offset evidence, and an MCP server with four tools.

All sample data is synthetic, from a fictional company. No customer, bank or employer data is used.

## [form] Links

- Repository: to be published (public GitHub, Apache-2.0, `.kiro/` at the root)
- Video: `demo-video/820-demo-en.mp4`, 2 minutes 41 seconds, English narration and subtitles
- No hosted app. The screen binds to `127.0.0.1` on purpose: payment files should not leave the
  machine they arrived on. The repository has a one-command start.

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
- `AgentStop`, which re-derives the verdict of the last output directory and reports fingerprint
  drift instead of trusting the previous run's claim;
- `PostTaskExecution`, which appends one row to `EVIDENCE.md`.

**Honest boundary:** the hook definitions are committed and their commands were exercised by hand,
which is how the rows in `EVIDENCE.md` were produced. I did not observe them firing inside a live
Kiro session, and no row claims it. That is the first thing the credit grant would buy: a session
where the hooks are the thing that writes the evidence.

### 4. Spec-driven development

`/README.md` is not the spec. The spec is `.kiro/specs/edi820-importer/`:

- `requirements.md`, 24 requirements in EARS form, in six groups, plus an explicit out-of-scope
  section;
- `design.md`, the layer split, the data model, the algorithms, and nine implementation deltas
  written while building, each recording what the design said first and why it changed;
- `tasks.md`, T0.1 to T6.6, each ending in a command whose output goes into the evidence log.

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

`src/mcp/` is a JSON-RPC 2.0 server over stdio with four tools: `parse_file`, `reconcile`,
`explain_findings`, `verify`. Each returns the same JSON the CLI writes, because all three surfaces
call `src/core/ops.ts`.

It is implemented against the protocol directly (newline-delimited JSON-RPC, `initialize`,
`tools/list`, `tools/call`, `-32601` for unknown methods, `-32700` for a malformed line) because the
MCP SDK could not be installed in this build environment. `test/unit/mcp.test.ts` runs a real stdio
session against the process, including a malformed line that must not kill the server.

The point of the surface: a finance team can drive the deterministic core from their own assistant
without re-implementing fixed-width parsing, and the numbers they get back are the same numbers the
CLI prints.

**Honest boundary:** the server is tested but not wired into a Kiro agent session. The reviewer
agent's config declares no MCP servers. Connecting the two is listed in "what's next".

### 7. Property-based testing

Six property suites, 22 properties, 222 tests in total.

- **Round trip:** parse a generated fixed-width file, serialize it, and the bytes are identical,
  including CRLF, a missing final newline, and a binary COMP-3 stream with no newlines at all.
- **Copybook compilation:** 500 generated copybooks compile to contiguous field starts from 1, and
  the field widths sum to the record length.
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

Two minutes forty one, English narration and burned-in subtitles, no music. A raw 100-byte record
file, the copybook that explains it, a PASS verdict on ten payments totalling 1,284,550.00 USD, then
a file with four defects and the byte range behind each finding. It ends on `verify` re-deriving the
same fingerprint, the guarantee boundary, and the `.kiro` tree.

---

## [form] Challenges

**Trust is the product.** The first version of the tool was easy. The hard part was removing every
place where the tool could quietly be right for the wrong reason: a short record silently
re-synchronised, a blank reference dropped, a matched count derived from prose, a BAI2 trailer
counted in three different branches. Four of the six defects listed in `EVIDENCE.md` are of that
kind.

**The copybook is not a spec.** It gives byte offsets and nothing about what must be true. Writing
24 requirements that a copybook cannot express is where most of the design work went.

**A confident reviewer is not a reviewer.** The custom agent's failure without read tools was more
instructive than its success, because the product makes the same distinction between a model that
narrates and a layer that proves.

## [form] Accomplishments

- 222 tests, 22 of them properties over generated inputs, with six regressions kept from real
  failures.
- Three byte layouts (trailing overpunch, COMP-3, leading separate sign) and three formats (820, 823,
  BAI2) through one reconciler.
- A verdict anyone can re-derive: `verify` prints both fingerprints and the first differing field
  path, and does not touch the report.
- An agent layer that cannot invent a number, and costs zero credits by default.
- A public statement of the boundary (`docs/guarantees.md`) that is part of the product: it is shown
  in both strips of the screen and printed by the CLI.

## [form] What's next

- Wire the MCP server into a Kiro agent session, so a reviewer can call `reconcile` instead of
  reading code about it.
- Run the spec inside a Kiro session with the hooks live, and let `PostTaskExecution` write the
  evidence rows rather than a manual invocation.
- The exception register (layer 4): reason, expiry and compensating control per exception, with a
  count of exceptions that have none, which should be zero.
- Streaming parse for files larger than memory, and a copybook dialect report for banks that send
  `REDEFINES`.

---

## Claims this submission does not make

Written here so a judge does not have to find them.

1. Kiro did not generate this code. The `.kiro` spec was the contract and the implementation ran in
   this workspace; the Kiro surface executed was the CLI, with a custom agent.
2. The hooks were not observed firing inside a Kiro session. Their commands were run by hand.
3. The MCP server is protocol-tested but not attached to a Kiro agent session.
4. Kiro powers were not used.
5. The web screen is local only. There is no hosted URL, by design.
