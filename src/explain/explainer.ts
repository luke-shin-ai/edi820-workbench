/**
 * L3 orchestration — the only path an explanation can take.
 *
 *     Finding ──▶ adapter draft ──▶ numeric guard ──▶ Explanation (or INSUFFICIENT_EVIDENCE)
 *
 * The guard is applied to every adapter, the mock included. That is deliberate:
 * if the default path skipped validation, the guarantee in `docs/guarantees.md` §5
 * would hold only for the adapters nobody uses in the demo.
 */
import type { Finding } from '../reconcile/index.js';
import { createMockAdapter } from './adapters.js';
import { citationOf, findingHasEvidence, validateExplanation } from './evidence.js';
import { buildPrompt } from './prompt.js';
import type { Explanation, ExplainOptions, ExplanationDraft, ExplainerAdapter } from './types.js';

const INSUFFICIENT_CAUSE = 'INSUFFICIENT_EVIDENCE';

const NO_VALUES_FIX =
  'The deterministic layers produced no value for this finding, so there is nothing to explain. Supply the missing value or fix the spec, then re-run.';

const REJECTED_FIX =
  'A drafted explanation cited values that are not in the finding, so it was withheld. Read the evidence panel for the values the deterministic layers did produce.';

export function insufficientExplanation(
  finding: Finding,
  options: { adapter: string; noEvidenceValues?: boolean; rejection?: Explanation['rejection'] },
): Explanation {
  return {
    code: finding.code,
    recordIndex: finding.recordIndex,
    ...(finding.field ? { field: finding.field } : {}),
    status: 'INSUFFICIENT_EVIDENCE',
    cause: INSUFFICIENT_CAUSE,
    suggestedFix: options.noEvidenceValues ? NO_VALUES_FIX : REJECTED_FIX,
    citation: citationOf(finding),
    adapter: options.adapter,
    citedValues: [],
    ...(options.rejection ? { rejection: options.rejection } : {}),
    ...(options.noEvidenceValues ? { noEvidenceValues: true } : {}),
  };
}

interface ExplainState {
  liveCalls: number;
}

function resolveAdapters(options: ExplainOptions): { primary: ExplainerAdapter; fallback: ExplainerAdapter } {
  return {
    primary: options.adapter ?? createMockAdapter(),
    fallback: options.fallback ?? createMockAdapter(),
  };
}

async function draftWithBudget(
  finding: Finding,
  options: ExplainOptions,
  state: ExplainState,
): Promise<{ draft: ExplanationDraft; adapter: string; note?: string }> {
  const { primary, fallback } = resolveAdapters(options);
  const maxLive = options.maxLiveCalls ?? 0;
  const prompt = buildPrompt(finding);

  if (!primary.live) {
    return { draft: await primary.explain({ finding, prompt }), adapter: primary.name };
  }
  if (state.liveCalls >= maxLive) {
    return {
      draft: await fallback.explain({ finding, prompt }),
      adapter: fallback.name,
      note: `${primary.name} skipped: live-call budget ${maxLive} exhausted`,
    };
  }

  state.liveCalls += 1;
  try {
    return { draft: await primary.explain({ finding, prompt }), adapter: primary.name };
  } catch (error) {
    return {
      draft: await fallback.explain({ finding, prompt }),
      adapter: fallback.name,
      note: `${primary.name} failed (${(error as Error).message}); ${fallback.name} used instead`,
    };
  }
}

/**
 * Explain one finding.
 *
 * Order matters: an evidence-less finding is refused *before* any adapter is
 * called, so no budget can be spent on a finding that cannot be grounded.
 */
export async function explainFinding(finding: Finding, options: ExplainOptions = {}): Promise<Explanation> {
  if (!findingHasEvidence(finding)) {
    return insufficientExplanation(finding, { adapter: 'none', noEvidenceValues: true });
  }

  const { draft, adapter, note } = await draftWithBudget(finding, options, { liveCalls: 0 });
  const text = `${draft.cause}\n${draft.suggestedFix}`;
  const guard = validateExplanation(text, finding);
  const base = {
    code: finding.code,
    recordIndex: finding.recordIndex,
    ...(finding.field ? { field: finding.field } : {}),
    citation: citationOf(finding),
    ...(note ? { note } : {}),
  };

  if (!guard.ok) {
    return {
      ...base,
      status: 'INSUFFICIENT_EVIDENCE',
      cause: INSUFFICIENT_CAUSE,
      suggestedFix: REJECTED_FIX,
      adapter,
      citedValues: [],
      rejection: { unsupported: guard.unsupported, draft },
    };
  }

  return {
    ...base,
    status: 'EXPLAINED',
    cause: draft.cause,
    suggestedFix: draft.suggestedFix,
    adapter,
    citedValues: guard.cited,
  };
}

export interface ExplainRunResult {
  explanations: Explanation[];
  /** Live (credit-spending) adapter calls actually made. */
  liveCalls: number;
  /** Explanations that fell back to a template because the budget was zero. */
  budgetLimited: number;
}

export async function explainFindings(
  findings: Finding[],
  options: ExplainOptions = {},
): Promise<ExplainRunResult> {
  const state: ExplainState = { liveCalls: 0 };
  const explanations: Explanation[] = [];
  let budgetLimited = 0;

  for (const finding of findings) {
    if (!findingHasEvidence(finding)) {
      explanations.push(insufficientExplanation(finding, { adapter: 'none', noEvidenceValues: true }));
      continue;
    }
    const { draft, adapter, note } = await draftWithBudget(finding, options, state);
    if (note?.includes('budget')) budgetLimited += 1;
    const guard = validateExplanation(`${draft.cause}\n${draft.suggestedFix}`, finding);
    const base = {
      code: finding.code,
      recordIndex: finding.recordIndex,
      ...(finding.field ? { field: finding.field } : {}),
      citation: citationOf(finding),
      ...(note ? { note } : {}),
    };
    if (!guard.ok) {
      explanations.push({
        ...base,
        status: 'INSUFFICIENT_EVIDENCE',
        cause: INSUFFICIENT_CAUSE,
        suggestedFix: REJECTED_FIX,
        adapter,
        citedValues: [],
        rejection: { unsupported: guard.unsupported, draft },
      });
      continue;
    }
    explanations.push({
      ...base,
      status: 'EXPLAINED',
      cause: draft.cause,
      suggestedFix: draft.suggestedFix,
      adapter,
      citedValues: guard.cited,
    });
  }

  return { explanations, liveCalls: state.liveCalls, budgetLimited };
}
