/**
 * Prompt construction for the optional live adapters.
 *
 * Two rules from `design.md` §5 shape this file:
 *  1. the model sees the finding's serialized values and the steering excerpt
 *     for that finding code - nothing else (no file contents, no other findings);
 *  2. the model returns prose only. The citation is attached by the guard, so a
 *     mis-citation is impossible by construction rather than by instruction.
 */
import type { Finding } from '../reconcile/index.js';
import { formatAmount } from '../reconcile/index.js';

/** Steering knowledge per finding code, quoted from `.kiro/steering/finance-file-conventions.md`. */
export const STEERING_HINT: Record<Finding['code'], string> = {
  CONTROL_TOTAL_MISMATCH:
    'Control totals in 820/823/BAI2 declare counts and sums. Compare count and sum separately; a matching sum with a wrong count is still a failure. Amounts are minor-unit-scaled by the copybook.',
  CONTROL_COUNT_MISMATCH:
    'A trailer declares how many detail records it controls. A missing or extra detail record is a count mismatch even when the money still sums correctly.',
  MISSING_CURRENCY:
    'A control total belongs to one currency bucket. If the declared currency has no detail amount, or a single total is declared against several currencies, which bucket it controls cannot be read from the file: report it and withhold the verdict instead of comparing against another bucket.',
  REF_UNMATCHED:
    '820 references (TRN/RMR) must be echoed by the bank side (823 RMR/REF, BAI2 customer reference). Matching is exact reference first, then amount+currency+value-date window; anything else is reported, never dropped.',
  DATE_OUT_OF_WINDOW:
    'Value dates come from the copybook-qualified date field, never guessed. The settlement window is declared for the run, with an explicit day tolerance (default 0).',
  FIELD_DECLARED_LENGTH_EXCEEDED:
    'A fixed-width field cannot hold more bytes than its picture declares. This code is reserved for records built by hand rather than read from a file.',
};

/** Serialize a finding with amounts spelled out, so the model never has to divide by 100. */
export function serialiseFinding(finding: Finding): Record<string, unknown> {
  const render = (value: Finding['declared']): unknown => {
    if (value === undefined) return undefined;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return value;
    return {
      formatted: formatAmount(value),
      minorUnits: value.minorUnits.toString(),
      currency: value.currency,
      scale: value.scale,
    };
  };
  return {
    code: finding.code,
    recordIndex: finding.recordIndex,
    field: finding.field,
    declared: render(finding.declared),
    computed: render(finding.computed),
    delta: render(finding.delta),
    reference: finding.reference,
    detail: finding.detail,
  };
}

export function buildPrompt(finding: Finding): string {
  return [
    'You explain one reconciliation finding for a fixed-width payment file (EDI 820/823, BAI2, COBOL copybook).',
    'Rules:',
    '- Use only the numbers in FINDING below. Do not introduce any other number, total, count or date.',
    '- Do not decide whether the file is acceptable; a human does that.',
    '- Answer in two short sentences at most: "cause" (what is wrong, in the file terms) and "suggestedFix" (the next action).',
    '- Reply with JSON only: {"cause": "...", "suggestedFix": "..."}',
    '',
    `DOMAIN RULE: ${STEERING_HINT[finding.code]}`,
    '',
    `FINDING: ${JSON.stringify(serialiseFinding(finding))}`,
  ].join('\n');
}

/** Parse an adapter's JSON reply; throws a typed error the explainer can fall back from. */
export function parseDraft(raw: string): { cause: string; suggestedFix: string } {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('adapter reply contains no JSON object');
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  const cause = typeof parsed.cause === 'string' ? parsed.cause.trim() : '';
  const suggestedFix = typeof parsed.suggestedFix === 'string' ? parsed.suggestedFix.trim() : '';
  if (!cause || !suggestedFix) throw new Error('adapter reply is missing cause/suggestedFix');
  return { cause, suggestedFix };
}
