/**
 * The grounded adapter - the default explanation layer, in its own module.
 *
 * "Grounded" is a claim, not a label: the explanation is written from the finding's own
 * declared, computed and delta values with deterministic templates, so every number it
 * cites exists in the deterministic layers' output and the guard passes by construction.
 * It costs zero credits and touches no network.
 *
 * It has no dependency on `node:child_process` (the live adapters in `adapters.ts` do), so
 * the static browser bundle can explain a finding without bundling a process spawner it
 * cannot run.
 */
import { formatAmount } from '../reconcile/index.js';
import type { Finding } from '../reconcile/index.js';
import type { ExplanationDraft, ExplainerAdapter } from './types.js';

function render(value: Finding['declared']): string {
  if (value === undefined) return '(not declared)';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  return formatAmount(value);
}

/**
 * Deterministic adapter: the finding is the only input, so the guard passes by
 * construction. It is also the honest baseline the write-up compares a model
 * against - if a model says something the templates cannot, it is either a
 * richer paraphrase or a number the guard will block.
 */
export function createGroundedAdapter(): ExplainerAdapter {
  return {
    name: 'grounded',
    live: false,
    async explain({ finding }): Promise<ExplanationDraft> {
      switch (finding.code) {
        case 'CONTROL_TOTAL_MISMATCH':
          return {
            cause: `The trailer declares ${render(finding.declared)} but the detail records sum to ${render(finding.computed)}; the difference is ${render(finding.delta)}.`,
            suggestedFix:
              'Find the record whose amount does not belong to the declared total (record-level amounts are in the evidence panel), correct the trailer or that record, then re-run verify.',
          };
        case 'CONTROL_COUNT_MISMATCH':
          return {
            cause: `The trailer declares ${render(finding.declared)} detail records but ${render(finding.computed)} were read.`,
            suggestedFix:
              'Locate the missing or extra detail record, correct the file or the trailer, and re-run verify.',
          };
        case 'MISSING_CURRENCY':
          return {
            cause: `${finding.detail}`,
            suggestedFix:
              'Check the currency field of the declared total and of the detail records; either the declaration or the detail amounts are in the wrong currency. Do not resolve this by borrowing another currency bucket.',
          };
        case 'REF_UNMATCHED':
          return finding.reference === undefined || finding.reference === ''
            ? {
                cause: `Record ${finding.recordIndex} has a blank reference field, so it cannot be matched to any counterpart.`,
                suggestedFix:
                  'Fill the reference on this record from the payment instruction, re-run reconcile, and confirm the reference now matches.',
              }
            : {
                cause: `Reference ${finding.reference} on record ${finding.recordIndex} has no counterpart on the other side.`,
                suggestedFix:
                  'Check whether this reference exists on the bank side under a different value, correct the reference on the side that is wrong, and re-run reconcile.',
              };
        case 'DATE_OUT_OF_WINDOW':
          return {
            cause: `Value date ${render(finding.computed)} on record ${finding.recordIndex} is outside the settlement window ${render(finding.declared)}.`,
            suggestedFix:
              'Confirm the value date with the settlement instruction; if the window is wrong for this run, pass the correct window to reconcile rather than editing the file.',
          };
        case 'FIELD_DECLARED_LENGTH_EXCEEDED':
          return {
            cause: `Field ${finding.field ?? '(unnamed)'} on record ${finding.recordIndex} carries more bytes than the copybook declares.`,
            suggestedFix: 'Re-encode the record from the copybook, or correct the picture in the copybook if the file is right.',
          };
        default:
          return {
            cause: `${finding.code} on record ${finding.recordIndex}: ${finding.detail}`,
            suggestedFix: 'Review the finding in the evidence panel and correct the file or the spec.',
          };
      }
    },
  };
}

