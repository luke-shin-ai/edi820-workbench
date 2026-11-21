/**
 * T4 — the explanation layer (R5.1–R5.3).
 *
 * The interesting assertions are the negative ones: a model that invents a
 * number must be silenced, and a finding with no values must never reach a
 * model at all.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileCopybook } from '../../src/copybook/index.js';
import { parseFile } from '../../src/parser/index.js';
import { formatAmount, reconcile, type Finding } from '../../src/reconcile/index.js';
import {
  createMockAdapter,
  evidenceVocabulary,
  explainFinding,
  explainFindings,
  findingHasEvidence,
  insufficientExplanation,
  serialiseFinding,
  validateExplanation,
  type ExplanationDraft,
  type ExplainerAdapter,
} from '../../src/explain/index.js';

const root = join(import.meta.dirname, '..', '..');
const readText = (p: string) => readFileSync(join(root, p), 'utf8');
const readBuf = (p: string) => readFileSync(join(root, p));

const cob820 = compileCopybook(readText('samples/copybooks/820.cpy'));
const cob823 = compileCopybook(readText('samples/copybooks/823.cpy'));
const WINDOW = { settlementWindow: { start: '2026-11-18', end: '2026-11-20' } };

function badFindings(): Finding[] {
  const payment = parseFile({ copybook: cob820, source: readBuf('samples/data/820-bad.txt') });
  const bank = parseFile({ copybook: cob823, source: readBuf('samples/data/823-bank.txt') });
  return reconcile({ payment, bank, options: WINDOW }).findings;
}

const totalMismatch = (findings: Finding[]): Finding => findings.find((f) => f.code === 'CONTROL_TOTAL_MISMATCH')!;

describe('R5.1 — adapters receive structured findings only', () => {
  it('the prompt carries the finding values and the domain rule, not file contents', async () => {
    const finding = totalMismatch(badFindings());
    let seen = '';
    const spy: ExplainerAdapter = {
      name: 'spy',
      live: false,
      async explain({ prompt }) {
        seen = prompt;
        return { cause: 'The declared total and the summed detail amounts differ by the reported delta.', suggestedFix: 'Correct the trailer.' };
      },
    };
    await explainFinding(finding, { adapter: spy });
    const serialised = JSON.stringify(serialiseFinding(finding));
    expect(seen).toContain(serialised);
    expect(seen).toContain('Compare count and sum separately');
    expect(seen).not.toContain('PNWPAY00001');
    expect(seen).not.toContain('NWP-2611-0001');
  });

  it('the citation is attached from the finding, never taken from the adapter', async () => {
    const finding = totalMismatch(badFindings());
    const adapter: ExplainerAdapter = {
      name: 'liar',
      live: false,
      async explain() {
        return { cause: 'The trailer total does not match the detail sum.', suggestedFix: 'Re-run verify after correcting the trailer.' };
      },
    };
    const explanation = await explainFinding(finding, { adapter });
    expect(explanation.status).toBe('EXPLAINED');
    expect(explanation.citation).toBe(`CONTROL_TOTAL_MISMATCH record=${finding.recordIndex} field=AMOUNT`);
  });
});

describe('R5.2 — an explanation may not cite a number the finding does not contain', () => {
  it('rejects a plausible but invented amount and replays the draft in the rejection record', async () => {
    const finding = totalMismatch(badFindings());
    // 999,999.99 exists nowhere in this finding.
    const adapter: ExplainerAdapter = {
      name: 'hallucinating',
      live: false,
      async explain() {
        return {
          cause: 'The file is short by 999,999.99 USD because a payment was omitted.',
          suggestedFix: 'Re-send the missing payment.',
        };
      },
    };
    const explanation = await explainFinding(finding, { adapter });
    expect(explanation.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(explanation.cause).toBe('INSUFFICIENT_EVIDENCE');
    expect(explanation.rejection?.unsupported).toContain('999999.99');
    expect(explanation.rejection?.draft.cause).toContain('999,999.99');
    expect(explanation.citedValues).toEqual([]);
  });

  it('accepts the same number written with different separators, sign or grouping', () => {
    const finding: Finding = {
      code: 'CONTROL_TOTAL_MISMATCH',
      recordIndex: 10,
      field: 'AMOUNT',
      declared: { minorUnits: 128_455_000n, currency: 'USD', scale: 2 },
      computed: { minorUnits: 128_445_000n, currency: 'USD', scale: 2 },
      delta: { minorUnits: -10_000n, currency: 'USD', scale: 2 },
      detail: 'declared 1,284,550.00 vs summed 1,284,450.00 (delta -100.00)',
    };
    for (const text of [
      'The declared total is 1,284,550.00 USD and the details sum to 1284450.00 USD.',
      'The file is short by 100.00 USD (delta \u2212100.00).',
      'The discrepancy is 128455000 minor units against 128445000 minor units.',
      'Record 10 carries the trailer amount.',
    ]) {
      expect(validateExplanation(text, finding).ok).toBe(true);
    }
  });

  it('rejects an off-by-one record index and an invented date on a real finding', async () => {
    const findings = badFindings();
    const dateFinding = findings.find((f) => f.code === 'DATE_OUT_OF_WINDOW')!;
    expect(validateExplanation('Record 2 has value date 2026-11-14, outside the window.', dateFinding).ok).toBe(true);
    const wrongDate = validateExplanation('Record 2 has value date 2026-11-15, outside the window.', dateFinding);
    expect(wrongDate.ok).toBe(false);
    expect(wrongDate.unsupported).toContain('15');
    const wrongRecord = validateExplanation('Record 9 has value date 2026-11-14, outside the window.', dateFinding);
    expect(wrongRecord.ok).toBe(false);
    expect(wrongRecord.unsupported).toContain('9');
  });

  it('the evidence vocabulary is derived only from the finding fields', () => {
    const finding = totalMismatch(badFindings());
    const vocabulary = evidenceVocabulary(finding);
    expect(vocabulary).toContain('10000');
    expect(vocabulary).toContain('-10000');
    expect(vocabulary).toContain('1284550');
    expect(vocabulary).not.toContain('999999');
  });
});

describe('R5.3 — INSUFFICIENT_EVIDENCE', () => {
  const emptyFinding: Finding = {
    code: 'FIELD_DECLARED_LENGTH_EXCEEDED',
    recordIndex: 4,
    field: 'AMOUNT',
    detail: 'the record carries more bytes than the copybook declares',
  };

  it('refuses before any adapter is called when the finding has no values', async () => {
    let calls = 0;
    const spy: ExplainerAdapter = {
      name: 'spy',
      live: false,
      async explain() {
        calls += 1;
        return { cause: 'x', suggestedFix: 'y' };
      },
    };
    const explanation = await explainFinding(emptyFinding, { adapter: spy });
    expect(findingHasEvidence(emptyFinding)).toBe(false);
    expect(explanation.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(explanation.noEvidenceValues).toBe(true);
    expect(explanation.adapter).toBe('none');
    expect(calls).toBe(0);
  });

  it('the fallback text contains no numbers of its own', () => {
    const explanation = insufficientExplanation(emptyFinding, { adapter: 'none', noEvidenceValues: true });
    expect(explanation.suggestedFix).not.toMatch(/\d/);
    expect(explanation.cause).toBe('INSUFFICIENT_EVIDENCE');
  });
});

describe('the default adapter explains every fixture finding without inventing numbers', () => {
  it('mock explanations all pass the guard', async () => {
    const findings = badFindings();
    expect(findings.length).toBeGreaterThanOrEqual(4);
    const { explanations, liveCalls } = await explainFindings(findings);
    expect(liveCalls).toBe(0);
    expect(explanations).toHaveLength(findings.length);
    for (const explanation of explanations) {
      expect(explanation.status).toBe('EXPLAINED');
      expect(explanation.adapter).toBe('mock');
      expect(explanation.rejection).toBeUndefined();
    }
  });

  it('a two-cent REF_UNMATCHED finding is explained with its own reference, not a neighbouring one', async () => {
    const findings = badFindings();
    const refs = findings.filter((f) => f.code === 'REF_UNMATCHED');
    const explanations = await Promise.all(refs.map((f) => explainFinding(f)));
    for (let i = 0; i < refs.length; i += 1) {
      expect(explanations[i]!.status).toBe('EXPLAINED');
      if (refs[i]!.reference) expect(explanations[i]!.cause).toContain(refs[i]!.reference!);
    }
  });

  it('CONTROL_TOTAL_MISMATCH is explained with the signed delta', async () => {
    const finding = totalMismatch(badFindings());
    const explanation = await explainFinding(finding);
    const delta = finding.delta as { minorUnits: bigint; currency: string; scale: number };
    expect(explanation.cause).toContain(formatAmount(delta));
  });
});

describe('credit discipline — live adapters are opt-in and budgeted', () => {
  const liveAdapter = (draft: ExplanationDraft): ExplainerAdapter & { calls: number } => {
    let calls = 0;
    return {
      name: 'live-test',
      live: true,
      get calls() {
        return calls;
      },
      async explain() {
        calls += 1;
        return draft;
      },
    };
  };

  it('never calls a live adapter when the budget is zero, and says so', async () => {
    const adapters = liveAdapter({ cause: 'A finding exists.', suggestedFix: 'Read the evidence.' });
    const result = await explainFindings(badFindings(), { adapter: adapters });
    expect(adapters.calls).toBe(0);
    expect(result.liveCalls).toBe(0);
    expect(result.budgetLimited).toBe(badFindings().length);
    expect(result.explanations.every((e) => e.adapter === 'mock')).toBe(true);
    expect(result.explanations[0]?.note).toContain('live-call budget 0 exhausted');
  });

  it('spends at most the stated number of live calls', async () => {
    const adapters = liveAdapter({
      cause: 'The trailer declares a total that the detail records do not sum to.',
      suggestedFix: 'Correct the trailer and re-run verify.',
    });
    const result = await explainFindings(badFindings(), { adapter: adapters, maxLiveCalls: 1 });
    expect(adapters.calls).toBe(1);
    expect(result.liveCalls).toBe(1);
    expect(result.explanations.filter((e) => e.adapter === 'live-test')).toHaveLength(1);
  });

  it('falls back to the template when the live adapter fails, keeping the reason', async () => {
    const failing: ExplainerAdapter = {
      name: 'broken',
      live: true,
      async explain() {
        throw new Error('model endpoint returned HTTP 429');
      },
    };
    const explanation = await explainFinding(totalMismatch(badFindings()), { adapter: failing, maxLiveCalls: 1 });
    expect(explanation.adapter).toBe('mock');
    expect(explanation.note).toContain('HTTP 429');
    expect(explanation.status).toBe('EXPLAINED');
    expect(createMockAdapter().name).toBe('mock');
  });
});
