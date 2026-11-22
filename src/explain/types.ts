/**
 * L3 — the explanation layer's contract.
 *
 * The verdict never comes from here. L2 hands over a `Finding`; L3 may only
 * return a plain-language cause, a suggested next action, and a citation that
 * this module attaches deterministically. Anything a model wrote that cites a
 * number L2 did not produce is replaced with `INSUFFICIENT_EVIDENCE`
 * (`requirements.md` R5.2–R5.3, `docs/guarantees.md` §5).
 */
import type { Finding } from '../reconcile/index.js';

export type ExplanationStatus = 'EXPLAINED' | 'INSUFFICIENT_EVIDENCE';

/** What an adapter is allowed to return: prose, never a citation or a verdict. */
export interface ExplanationDraft {
  cause: string;
  suggestedFix: string;
}

export interface RejectionRecord {
  /** Numeric literals the draft cited that the finding does not contain. */
  unsupported: string[];
  /** Kept so a reviewer can see exactly what was blocked, not just that it was. */
  draft: ExplanationDraft;
}

export interface Explanation {
  code: Finding['code'];
  recordIndex: number;
  field?: string;
  status: ExplanationStatus;
  cause: string;
  suggestedFix: string;
  /** Built here from the finding, never from model output. */
  citation: string;
  /** Adapter that produced the draft (`grounded`, `kiro-cli`, `openai-compatible`, `none`). */
  adapter: string;
  /** Numeric literals in the accepted text, in order of appearance. */
  citedValues: string[];
  rejection?: RejectionRecord;
  /** Why a live adapter was skipped or replaced (budget, failure). */
  note?: string;
  /** True when no adapter call was made because the finding carries no values. */
  noEvidenceValues?: boolean;
}

export interface ExplainerAdapter {
  readonly name: string;
  /** True when the adapter leaves the machine (spends credits / network). */
  readonly live: boolean;
  explain(input: { finding: Finding; prompt: string }): Promise<ExplanationDraft>;
}

export interface ExplainOptions {
  adapter?: ExplainerAdapter;
  /**
   * Maximum number of *live* adapter calls for this run. Defaults to 0: the
   * free-tier build never spends a credit unless a caller asks for it
   * (the build plan allowed one 0.05x-model call for validation, no more).
   */
  maxLiveCalls?: number;
  /** Adapter used when a live call is not allowed or the live call fails. */
  fallback?: ExplainerAdapter;
}
