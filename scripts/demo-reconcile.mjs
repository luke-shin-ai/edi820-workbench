#!/usr/bin/env node
/**
 * demo-reconcile.mjs — end-to-end proof of the deterministic core (L1+L2).
 *
 * This is not the product CLI (that is task T5.1); it is the script the build
 * evidence and the demo video run, so that "it works" is a command anyone can
 * re-run:  npx tsx scripts/demo-reconcile.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCopybook } from '../src/copybook/index.js';
import { parseFile, serializeParseResult } from '../src/parser/index.js';
import { formatAmount, reconcile } from '../src/reconcile/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readText = (p) => readFileSync(join(root, p), 'utf8');
const readBuf = (p) => readFileSync(join(root, p));

const WINDOW = { settlementWindow: { start: '2026-11-18', end: '2026-11-20' } };
const book = {
  p820: compileCopybook(readText('samples/copybooks/820.cpy')),
  p820packed: compileCopybook(readText('samples/copybooks/820-packed.cpy')),
  b823: compileCopybook(readText('samples/copybooks/823.cpy')),
};

function load822(copybook, path) {
  return parseFile({ copybook, source: readBuf(path) });
}

const scenarios = [
  {
    name: 'S1  matching pair (820 display)',
    payment: () => load822(book.p820, 'samples/data/820-good.txt'),
    bank: () => load822(book.b823, 'samples/data/823-bank.txt'),
  },
  {
    name: 'S2  same payments, COMP-3 layout',
    payment: () => load822(book.p820packed, 'samples/data/820-packed-good.txt'),
    bank: () => load822(book.b823, 'samples/data/823-bank.txt'),
  },
  {
    name: 'S3  planted defects (820-bad)',
    payment: () => load822(book.p820, 'samples/data/820-bad.txt'),
    bank: () => load822(book.b823, 'samples/data/823-bank.txt'),
  },
  {
    name: 'S4  bank side short (823-bad)',
    payment: () => load822(book.p820, 'samples/data/820-good.txt'),
    bank: () => load822(book.b823, 'samples/data/823-bad.txt'),
  },
];

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(root, 'out', stamp);
mkdirSync(outDir, { recursive: true });

const report = { generatedAt: new Date().toISOString(), window: WINDOW, scenarios: [] };

for (const scenario of scenarios) {
  const payment = scenario.payment();
  const bank = scenario.bank();
  const result = reconcile({ payment, bank, options: WINDOW });
  const roundTrip =
    serializeParseResult(payment).equals(payment.source) && serializeParseResult(bank).equals(bank.source);

  console.log(`\n=== ${scenario.name}`);
  console.log(
    `  records: 820 ${payment.computedControl.detailCount}/${payment.computedControl.recordCount}` +
      `  bank ${bank.computedControl.detailCount}/${bank.computedControl.recordCount}` +
      `  round-trip: ${roundTrip ? 'byte-identical' : 'DIFFERS'}`,
  );
  if (payment.issues.length > 0) {
    for (const issue of payment.issues) {
      console.log(`  issue ${issue.code} @record ${issue.recordIndex}: ${issue.detail}`);
    }
  }
  console.log(`  verdict: ${result.status}   findings: ${result.findings.length}`);
  for (const [currency, totals] of Object.entries(result.summary.totals)) {
    console.log(
      `  total ${currency}: declared ${Number(totals.declared) / 100}` +
        ` vs summed ${Number(totals.computed) / 100} → delta ${Number(totals.delta) / 100}`,
    );
  }
  for (const finding of result.findings) {
    const declared =
      finding.declared && typeof finding.declared === 'object' ? formatAmount(finding.declared) : finding.declared;
    const delta = finding.delta && typeof finding.delta === 'object' ? formatAmount(finding.delta) : finding.delta;
    console.log(
      `   - ${finding.code} @record ${finding.recordIndex}` +
        (finding.reference ? ` ref ${finding.reference}` : '') +
        (declared !== undefined ? ` declared ${declared}` : '') +
        (delta !== undefined ? ` delta ${delta}` : ''),
    );
  }
  console.log(`  fingerprint ${result.fingerprint}`);

  report.scenarios.push({
    name: scenario.name,
    status: result.status,
    roundTrip,
    paymentFileHash: result.paymentFileHash,
    bankFileHash: result.bankFileHash,
    fingerprint: result.fingerprint,
    summary: result.summary,
    issues: payment.issues,
    findings: result.findings,
  });
}

writeFileSync(join(outDir, 'demo-report.json'), `${JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n`);
console.log(`\nreport written to ${join('out', stamp, 'demo-report.json')}`);
