# Design — edi820-importer

## 1. Layer split (non-negotiable)

```
file + copybook
      │
      ▼
[L1 parser]        pure, deterministic, no I/O beyond reading the two files
      │  TypedRecord[] + ParseIssue[]
      ▼
[L2 reconciler]    pure functions over TypedRecord[]  → Finding[]
      │
      ▼
[L3 explainer]     agent adapter: Finding → {cause, suggestedFix, citation}
      │            (rejects unsupported numbers; INSUFFICIENT_EVIDENCE fallback)
      ▼
[L4 human]         exception register: reason + expiry + compensating control
      │
      ▼
report.json + report.md + fingerprint
```

Rationale: the demo's credibility comes from the fact that **the verdict is not produced by a model**. The model only narrates findings the deterministic layers already produced. This mirrors the playbook rule "AI를 신뢰하는 대신 역할을 분리한다".

## 2. Data model

```ts
type FieldType = 'string' | 'unsigned-int' | 'signed-int' | 'implied-decimal'
               | 'packed-decimal' | 'zoned-decimal' | 'filler';

interface CopybookField {
  name: string; start: number; length: number; type: FieldType;
  scale?: number; sign?: 'leading-separate' | 'trailing-separate' | 'trailing-overpunch';
}

interface Copybook { recordLength: number; fields: CopybookField[]; }

type Amount = { minorUnits: bigint; currency: string };

interface TypedRecord {
  index: number; raw: string;
  values: Record<string, string | number | Amount | null>;
  issues: ParseIssue[];
}

type IssueCode =
  | 'RECORD_LENGTH_MISMATCH' | 'FIELD_INVALID_NUMERIC' | 'COPYBOOK_UNPARSABLE'
  | 'COPYBOOK_OVERLAP' | 'SPEC_MISSING';

type FindingCode =
  | 'CONTROL_TOTAL_MISMATCH' | 'CONTROL_COUNT_MISMATCH' | 'REF_UNMATCHED'
  | 'DATE_OUT_OF_WINDOW' | 'FIELD_DECLARED_LENGTH_EXCEEDED';

interface Finding {
  code: FindingCode; recordIndex: number; field?: string;
  declared?: string | Amount; computed?: string | Amount;
  delta?: Amount; reference?: string; detail: string;
}
```

## 3. Parser algorithm
1. Compile copybook → fields with cumulative offsets; verify no overlap and that sum(length) = recordLength.
2. Slice each fixed-length record; do **not** trim, do **not** re-sync on mismatch (report and continue at boundary).
3. Convert per field type; carry amounts as `bigint` minor units.
4. Build `ParseResult { records, declaredControl?, computedControl, fingerprint }`.

**Round-trip**: keep the raw record slice (`raw`) plus a `serialize(record, copybook)` that re-emits from `raw` when there were no field writes — this makes byte-identical round-trip a property, not a hope.

## 4. Reconciliation algorithm
- Group by `(currency)` for totals; compute sum of `bigint`, compare to declared; `delta = declared - computed`.
- Count compare separately.
- Reference index: map `trace → record` for 820, `ref → record` for 823/BAI2; report 820-only and bank-only as `REF_UNMATCHED` with direction in `detail`.
- Verdict fingerprint: SHA-256 over `JSON.stringify(sortedNormalizedFindings)` + input file hashes.

## 5. Agent layer
- Adapter interface `Explainer { explain(f: Finding): Promise<Explanation> }`.
- Prompt includes the steering-file excerpt for the relevant finding code and **nothing else** (keeps the model from inventing context).
- Post-validation: every numeric literal in the explanation must appear in the finding's serialized values; otherwise the explanation is rejected and replaced with `INSUFFICIENT_EVIDENCE`.

## 6. CLI surface
```
820 parse     --copybook samples/copybooks/820.cpy --file samples/data/820-good.txt --out out/
820 reconcile --copybook ... --file ... --bank samples/data/823-good.txt
820 explain   --findings out/report.json
820 verify    out/            # re-derive, compare fingerprint, no mutation
```
Exit codes: `0` pass, `2` findings present, `3` spec/IO error. CI uses these codes directly.

## 7. Web screen
One page, three columns: **file drop**, **verdict card** (counters: records, findings, exceptions), **evidence panel** (finding → record → field slice highlighted with byte offsets). The bottom strip always shows "guaranteed / not guaranteed" (from `docs/guarantees.md`).

## 8. MCP surface
Tools: `parse_file(copybookPath, filePath)`, `reconcile(files[])`, `explain_findings(reportPath)`, `verify(outDir)`. Each returns the same JSON as the CLI. Rationale (for the write-up): the deterministic core becomes usable by any agent, so a finance team can drive it from their own assistant without re-implementing fixed-width parsing.

## 9. Failure modes and honest limits
- Copybook dialect variance: COMP-3 and `REDEFINES` are supported; `REDEFINES` is read as a region
  of shared bytes with one active layout per record, and a layout the copybook does not bind to a
  discriminator value is refused (`COPYBOOK_SEMANTICS`), not guessed. `OCCURS` and binary `COMP`
  remain `UNSUPPORTED_STRUCTURE`.
- Very large files stream record-by-record; totals hold in `bigint`, so no overflow at realistic volumes.

## 10. Implementation deltas (agreed while building T1–T3)

The design above is the contract; building it forced five additions. Each is recorded here rather than left to be discovered in the code.

1. **`values` holds `bigint`, not `number`.** §2 typed numeric values as `number`. `tech.md` forbids floats for money, and `number` is a float. Amounts are `bigint` minor units; counts and dates are `bigint` display values.
2. **`Amount` carries `scale`.** `{ minorUnits, currency }` cannot render `1,284,550.00` without knowing the copybook's scale, and the UI needs to render. Nothing downstream infers scale from the currency code; it is carried from the picture.
3. **The copybook states semantics, not only layout.** `* @semantics`, `* @control`, `* @framing` (documented in `docs/copybook-dialect.md`) let the reconciler learn field roles from the spec. Without them, field names would be hard-coded — the opposite of “the copybook is the key”.
4. **Two issue codes were added:** `UNSUPPORTED_STRUCTURE` (§9 already named it) and `CURRENCY_SCALE_MISMATCH` (a `V99` copybook with a `KRW` currency is a spec contradiction that must be visible, not silently scaled by 2). `FIELD_DECLARED_LENGTH_EXCEEDED` is declared in §2 but not emitted yet: fixed-width data cannot exceed its own field width, so the only reachable case is a hand-built record, which `encodeRecord` refuses at the encoder instead.
5. **Signed delta is `computed − declared`.** `requirements.md` R4.1 says “signed delta” without naming a direction; the demo narrative fixes it as `delta −100.00` for declared 1,284,550.00 vs summed 1,284,450.00. The product reads “this file is short by 100.00”, which is what an auditor asks for.

## 11. Record framing
`@framing line` joins records with the file's own terminator (CRLF or LF, trailing newline preserved); `@framing fixed` slices the byte stream every `recordLength` bytes. Both are needed: COMP-3 payloads are binary and cannot be newline-delimited safely. Round-trip fidelity (R3.1) is asserted on both, including a short final record.

## 12. Implementation deltas for T4–T5 (written while building them)

### 6. BAI2 is a reader, not a copybook
§2 modelled one spec shape. BAI2 has no fixed width and no copybook, so the spec object
carries `format: 'bai2'`, `recordLength: 0` and `fields: []`, and each record carries its
own field offsets in `TypedRecord.spans`. The alternative — inventing a fixed layout for a
comma-delimited format — would have made `verify` reproduce a layout the bank never sent.
The declared control handed to L2 is BAI2's `03`/`100` total credits, not the `98` group
total; §4 of `docs/bai2.md` records why.

### 7. The MCP server is implemented against the protocol, not with the SDK
`tech.md` names `@modelcontextprotocol/sdk`. It is not installed here (the build runs
where `npm install` cannot reach the registry), so `src/mcp/server.ts` implements the
stdio transport directly: newline-delimited JSON-RPC 2.0, `initialize`,
`notifications/initialized`, `tools/list`, `tools/call`, `ping`, `-32601` for unknown
methods, `-32700` for unparsable lines. `test/unit/mcp.test.ts` runs a real stdio session
against the process, so the transport is tested, not assumed. Swapping in the SDK later
changes the transport code only — the four tools call `src/core/ops.ts`, which is what
keeps CLI, MCP and web returning the same JSON.

### 8. The web screen is one dependency-free document
`tech.md` names Vite + React for the screen. Neither is installed here, and adding a
build step would have made the demo depend on a toolchain the judge may not have. The
screen is one HTML document (embedded CSS + a small script) served by `src/web/server.ts`
on 127.0.0.1. What the steering asked for is preserved: one page, three columns, the
guarantee strips top and bottom, byte-offset evidence, empty and error states. What is
lost: component structure and hot reload — irrelevant for a submission that ships a
running server, and recorded here rather than discovered by a reviewer.

### 9. L3 details the design left open
- The **citation** is built by `citationOf(finding)`, never taken from model output, so a
  mis-citation cannot happen by instruction-following failure.
- The **evidence vocabulary** is derived from `declared`, `computed`, `delta`,
  `recordIndex`, `reference` and `detail`, including the forms a reader would derive from
  them (`1,284,550.00`, `1284550.00`, `128455000`, magnitude of a signed delta). A
  finding with none of declared/computed/delta/reference is refused **before** any adapter
  is called (R5.3), so an empty finding cannot spend a credit.
- **Budgets**: `maxLiveCalls` defaults to `0`; a live adapter that is not allowed or that
  fails is replaced by the deterministic template, and the reason is kept on the
  explanation (`note`). The free-tier build therefore produces the demo without touching
  the 50-credit allowance.


## 13. L4 — exception register (contract for T7.1)

The register is the one place where a human decision is recorded, and it is built so the
record cannot be edited back into agreement with a later story.

### 13.1 Module boundary

`src/exception/register.ts` is pure: no I/O, no clock of its own, no `node:fs`. The CLI
reads and writes the file; the module only builds and classifies. That is what lets the
same code run in the browser bundle of the static demo and in the Node CLI with identical
hashes.

```ts
export type ExceptionStatus = 'OPEN' | 'WAIVED' | 'EXPIRED' | 'RELEASED';

export interface LedgerEntry {
  seq: number;                     // 1-based, dense, never reused
  id: string;                      // 16 hex chars, derived from seq + decision + findingKey + decidedOn + prevHash
  decision: 'waived' | 'released';
  findingKey: string;              // stable identity of the finding (see 13.2)
  code: string;
  recordIndex: number;
  field?: string;
  reference?: string;
  owner: string;                   // a person, not "the system"
  reason: string;
  compensatingControl: string;     // what keeps this safe while the exception stands
  decidedOn: string;               // YYYY-MM-DD
  expiresOn?: string;              // YYYY-MM-DD, inclusive; waived only
  releaseOf?: string;              // waived entry id; released only
  fingerprint: string;             // the reconciliation fingerprint the decision was made against
  prevHash: string;                // 'GENESIS' for seq 1
  hash: string;                    // sha256 over the canonical fields below + prevHash
}

export interface Ledger { version: 1; entries: LedgerEntry[]; }

export function findingKey(finding: Finding): string;
export function emptyLedger(): Ledger;
export function parseLedger(text: string): Ledger;                     // throws LedgerError('SHAPE')
export function serialiseLedger(ledger: Ledger): string;               // 2-space JSON + trailing newline
export function appendWaiver(ledger: Ledger, input: WaiverInput, finding: Finding, context: DecisionContext): Ledger;
export function appendRelease(ledger: Ledger, input: ReleaseInput, waiverId: string): Ledger;
export function verifyLedger(ledger: Ledger): { ok: boolean; firstInvalidSeq: number | null; detail?: string };
export function classify(findings: Finding[], ledger: Ledger, onDate: string): Classification;
```

`WaiverInput = { owner, reason, compensatingControl, expiresOn?, decidedOn? }`;
`DecisionContext = { fingerprint: string; decidedOn: string }` (the caller supplies the date,
so a test can decide "today" without freezing the real clock).
`Classification = { entries: Array<{ findingKey, code, recordIndex, field?, reference?, status,
waiverId?, expiresOn? }>; counts: Record<ExceptionStatus, number>; unadjudicated: number }`
where `unadjudicated` counts `OPEN + EXPIRED + RELEASED`: an exception that was released or
that lapsed is once again in front of a human, because the finding it names still exists.

### 13.2 Finding identity

`findingKey(finding)` is the same normalisation the verdict fingerprint already uses
(`code | recordIndex | field | reference | declared | computed | delta`), newly exported from
`src/reconcile/reconciler.ts` as `findingKey` and reused by `normaliseFinding`. Consequence:
a waiver survives re-runs of the same file (no timestamps, no report paths) and cannot attach
to a different finding that merely shares a code.

### 13.3 Hash chain

`hash = sha256(canonical)` where `canonical` is the entry's fields in the fixed order
`seq|id|decision|findingKey|code|recordIndex|field|reference|owner|reason|compensatingControl|decidedOn|expiresOn|releaseOf|fingerprint|prevHash`,
each rendered as an empty string when absent, joined with `|`. `prevHash` is the previous
entry's `hash` (`GENESIS` for the first). `verifyLedger` recomputes both and reports the first
`seq` where either fails. Editing any field of any entry, or removing one, therefore fails.

### 13.4 Status machine

```
        waive(reason, owner, control, expiry)          release(id)
OPEN ───────────────────────────────────▶ WAIVED ──────────────────▶ RELEASED
 ▲                                          │  expiry < onDate          │
 │                                          ▼                          │
 └──────────────────────────────  EXPIRED  ─┘  (a released or expired      )
                                               exception is OPEN for      )
                                               the next adjudication      )
```

A waiver for finding key A never covers finding key B, even with the same code. `RELEASED`
and `EXPIRED` are reported as such; neither is silently dropped from the classification.

### 13.5 Surfaces

- CLI: `exceptions --report <dir> [--ledger <path>] [--today YYYY-MM-DD] [--json]` (read-only),
  `waive --report <dir> --index <n> --owner --reason --control [--expires]`,
  `release --report <dir> --id <waiverId> --owner --reason [--control]`.
  Default ledger path: `<report dir>/ledger.json`. Exit codes per R8.6.
- MCP: `exceptions(reportPath, ledgerPath?, today?)`, read-only, same classification object.
- Web/static: a panel beside the findings; the verdict badge keeps `FAIL`/`INCOMPLETE` while
  the panel shows what a human decided. A waiver never turns the badge green, because the
  deterministic answer did not change.

### 13.6 What the register deliberately does not do

- It does not edit the input files or the report.
- It does not re-run reconciliation to make the finding disappear.
- It does not require a model: a waiver is a human's typed reason, and the chain proves the
  record was not rewritten afterwards.

## 14. Implementation delta for T8 — `REDEFINES` as a region with declared layouts

§9 first said `REDEFINES` was refused as `UNSUPPORTED_STRUCTURE`. That was honest but it left the
most common bank copybook shape unreadable, so T8 replaced the refusal with a model:

- **The region.** A `REDEFINES X` line makes X a region: one byte range with more than one layout.
  X itself is the first layout; the redefining item is another. Group items (`05 NAME.`) are
  supported because a layout is usually a group; a group owns no bytes and its width is the sum of
  its children, so the flat field list still tiles the record.
- **The activation rule is the copybook's.** COBOL says which bytes are shared and says nothing
  about which record type uses which layout. The compiler therefore requires one directive per
  layout (`* @view layout=… typeField=… value=…`), validates that the discriminator is alphabetic
  and outside the region, and refuses a `REDEFINES` with no rule or with one value selecting two
  layouts. This is the same principle as the sign convention: a default is not a fact about the
  file.
- **One layout is decoded.** For each record the parser resolves the region's active layout and
  decodes only those fields; the other layout's names are absent from `values` and `slices`, not
  null. A record whose discriminator matches no layout gets `REDEFINES_VIEW_UNMATCHED`, a blocking
  parse issue, so its shared bytes cannot contribute to a `PASS`.
- **The trailer may own its total.** `@control totalField`/`currencyField` may name fields that
  exist only in the trailer layout, so the declared total is read where the bank put it instead of
  reusing the detail's amount field.
- **Fingerprints do not move without a reason.** The parser adds a `views:` component to the
  fingerprint only when the copybook declares a region, so the six sample scenarios without
  `REDEFINES` keep the exact fingerprints recorded before T8 (pinned in
  `test/regressions/redefines-view.test.ts`).
