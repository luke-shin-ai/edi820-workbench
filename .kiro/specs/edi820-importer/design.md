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
- Copybook dialect variance (COMP-3, REDEFINES) is **partial**: `REDEFINES` is recorded as `UNSUPPORTED_STRUCTURE`, not guessed.
- Very large files stream record-by-record; totals hold in `bigint`, so no overflow at realistic volumes.

## 10. Implementation deltas (agreed while building T1–T3)

The design above is the contract; building it forced five additions. Each is recorded here rather than left to be discovered in the code.

1. **`values` holds `bigint`, not `number`.** §2 typed numeric values as `number`. `tech.md` forbids floats for money, and `number` is a float. Amounts are `bigint` minor units; counts and dates are `bigint` display values.
2. **`Amount` carries `scale`.** `{ minorUnits, currency }` cannot render `1,284,550.00` without knowing the copybook's scale, and the UI needs to render. Nothing downstream infers scale from the currency code; it is carried from the picture.
3. **The copybook states semantics, not only layout.** `* @semantics`, `* @control`, `* @framing` (documented in `docs/copybook-dialect.md`) let the reconciler learn field roles from the spec. Without them, field names would be hard-coded — the opposite of “the copybook is the key”.
4. **Two issue codes were added:** `UNSUPPORTED_STRUCTURE` (§9 already named it) and `CURRENCY_SCALE_MISMATCH` (a `V99` copybook with a `KRW` currency is a spec contradiction that must be visible, not silently scaled by 2). `FIELD_DECLARED_LENGTH_EXCEEDED` is declared in §2 but not emitted yet: fixed-width data cannot exceed its own field width, so the only reachable case is a hand-built record, which `encodeRecord` refuses at the encoder instead.
5. **Signed delta is `computed − declared`.** `requirements.md` R4.1 says “signed delta” without naming a direction; `CONCEPT.md` §2-1 fixes it as `delta −100.00` for declared 1,284,550.00 vs summed 1,284,450.00. The product reads “this file is short by 100.00”, which is what an auditor asks for.

## 11. Record framing
`@framing line` joins records with the file's own terminator (CRLF or LF, trailing newline preserved); `@framing fixed` slices the byte stream every `recordLength` bytes. Both are needed: COMP-3 payloads are binary and cannot be newline-delimited safely. Round-trip fidelity (R3.1) is asserted on both, including a short final record.
