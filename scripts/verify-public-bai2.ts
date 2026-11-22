#!/usr/bin/env node
/**
 * Parse the files banks publish as BAI2 samples and print what the reader found.
 *
 * The point is the opposite of `gen-fixtures.mjs`: these bytes were not chosen here, so an issue
 * the reader reports is a fact about the reader or about the published file, not about our fixture
 * generator. See `samples/public/SOURCES.md` for where each file came from.
 *
 * Exit code 0 when both files parse with no issues, 1 otherwise.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBai2 } from '../src/bai2/index.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export interface PublicSample {
  file: string;
  label: string;
  expected: { records: number; details: number; creditsMinorUnits: bigint; currency: string };
}

export interface PublicSampleResult {
  file: string;
  label: string;
  bytes: number;
  eol: string;
  records: number;
  details: number;
  declaredCredits: { minorUnits: string; currency: string; scale: number; recordIndex: number } | null;
  issues: Array<{ code: string; recordIndex?: number; detail: string }>;
  ok: boolean;
  problems: string[];
}

export const PUBLIC_SAMPLES: PublicSample[] = [
  {
    file: 'samples/public/bai2-westpac-npp.txt',
    label: 'Westpac / Qvalent BAI2 NPP sample',
    expected: { records: 27, details: 10, creditsMinorUnits: 4_000_000n, currency: 'AUD' },
  },
  {
    file: 'samples/public/bai2-southstate-guide.txt',
    label: 'SouthState Bank BAI-2 user guide sample',
    expected: { records: 27, details: 12, creditsMinorUnits: 20_042_948n, currency: 'USD' },
  },
];

export function verifyPublicSamples(): PublicSampleResult[] {
  return PUBLIC_SAMPLES.map((sample) => {
    const bytes = readFileSync(join(root, sample.file));
    const result = parseBai2(bytes);
    const declared = result.declaredControl;
    const total = declared?.total;
    const problems: string[] = [];
    if (result.issues.length > 0) problems.push(`${result.issues.length} parse issue(s)`);
    if (result.computedControl.recordCount !== sample.expected.records) {
      problems.push(`record count ${result.computedControl.recordCount} != ${sample.expected.records}`);
    }
    if (result.computedControl.detailCount !== sample.expected.details) {
      problems.push(`detail count ${result.computedControl.detailCount} != ${sample.expected.details}`);
    }
    if (total?.minorUnits !== sample.expected.creditsMinorUnits) {
      problems.push(`declared credits ${total?.minorUnits ?? '-'} != ${sample.expected.creditsMinorUnits}`);
    }
    return {
      file: sample.file,
      label: sample.label,
      bytes: bytes.length,
      eol: result.eol === '\r\n' ? 'CRLF' : 'LF',
      records: result.computedControl.recordCount,
      details: result.computedControl.detailCount,
      declaredCredits: declared && total
        ? {
            minorUnits: total.minorUnits.toString(),
            currency: total.currency,
            scale: total.scale,
            recordIndex: declared.recordIndex,
          }
        : null,
      issues: result.issues.map((issue) => ({ code: issue.code, recordIndex: issue.recordIndex, detail: issue.detail })),
      ok: problems.length === 0,
      problems,
    };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = verifyPublicSamples();
  for (const row of rows) {
    console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${row.file}  (${row.label})`);
    console.log(`     ${row.bytes} bytes, ${row.eol}, ${row.records} records, ${row.details} detail records, issues: ${row.issues.length}`);
    console.log(
      `     declared total credits: ${row.declaredCredits ? `${row.declaredCredits.minorUnits} ${row.declaredCredits.currency} at scale ${row.declaredCredits.scale} (record ${row.declaredCredits.recordIndex})` : 'none'}`,
    );
    for (const issue of row.issues) console.log(`     issue ${issue.code} @${issue.recordIndex ?? '-'}: ${issue.detail}`);
    for (const problem of row.problems) console.log(`     problem: ${problem}`);
  }
  const failed = rows.filter((row) => !row.ok).length;
  console.log(`\n${rows.length - failed}/${rows.length} published files parse cleanly`);
  process.exitCode = failed > 0 ? 1 : 0;
}
