#!/usr/bin/env node
/**
 * `820` - the command-line surface (T5.1-T5.2, T7.1).
 *
 * Exit codes are part of the contract, because a CI job uses them directly:
 *   0  PASS / verified identical / no unadjudicated exceptions
 *   2  FAIL / findings present / verification differs / unadjudicated exceptions exist
 *   3  spec or I/O error (nothing was decided)
 *
 * `verify` is read-only: it re-derives the verdict from the inputs recorded in
 * `report.json` and compares. It never rewrites the report, and it prints the
 * report's own mtime and size before and after as proof.
 *
 * Exception commands (`exceptions`, `waive`, `release`) read and write a ledger.json.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  AppError,
  buildReport,
  defaultOutDir,
  ensureDir,
  explainReport,
  loadReport,
  reconcileCase,
  repoRoot,
  reviveFindings,
  verifyReport,
  writeReport,
  type CaseInputs,
  type FileFormat,
  type JsonFinding,
  type JsonIssue,
  type Report,
} from '../core/ops.js';
import { adapterByName, type Explanation } from '../explain/index.js';
import { formatAmount } from '../reconcile/index.js';
import {
  appendRelease,
  appendWaiver,
  classify,
  emptyLedger,
  isIsoDate,
  ledgerDigest,
  parseLedger,
  serialiseLedger,
  verifyLedger,
} from '../exception/index.js';

export const EXIT = { PASS: 0, FINDINGS: 2, ERROR: 3 } as const;

interface Streams {
  out: (line: string) => void;
  err: (line: string) => void;
}

const defaultStreams: Streams = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

export const USAGE = `820 - resurrection workbench for fixed-width payment files

Usage:
  820 parse     --copybook <path> --file <path> [--format fixed|bai2] [--out <dir>] [--json]
  820 reconcile --copybook <path> --file <path> [--bank <path>]
                [--bank-copybook <path> | --bank-format bai2]
                [--window YYYY-MM-DD..YYYY-MM-DD] [--tolerance <days>]
                [--out <dir>] [--json]
  820 explain   --findings <report.json|dir> [--adapter grounded|kiro-cli|openai]
                [--max-live <n>] [--out <dir>] [--json]
  820 verify    <report.json|dir> [--json]
  820 exceptions <report.json|dir> [--ledger <path>] [--today YYYY-MM-DD] [--json]
  820 waive     --report <dir> --index <n> --owner <who> --reason <why>
                --control <compensating control> --expires YYYY-MM-DD
                [--ledger <path>] [--today YYYY-MM-DD]
  820 release   --report <dir> --id <waiver id> --owner <who> --reason <why>
                --control <what changed> [--ledger <path>] [--today YYYY-MM-DD]

BAI2 files need no copybook: pass --format bai2 (payment) or --bank-format bai2.
Exit codes: 0 pass (and no unadjudicated exception), 2 findings / incomplete parse /
verification difference / OPEN or EXPIRED exception, 3 spec or I/O error.
Verdicts: PASS (every check agreed), INCOMPLETE (a parse issue left bytes uninterpreted,
so no PASS is earned), FAIL (findings exist).
`;

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq > 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next;
      i += 1;
    } else {
      flags[body] = true;
    }
  }
  return { positional, flags };
}

function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === 'string' ? value : undefined;
}

function requireFlag(args: ParsedArgs, name: string): string {
  const value = flagString(args, name);
  if (!value) throw new AppError('USAGE', `--${name} is required`);
  return value;
}

/** `--today` is a date a decision is recorded against, so it has to be a real one. */
function todayFlag(args: ParsedArgs): string | undefined {
  const raw = flagString(args, 'today');
  if (raw === undefined) return undefined;
  if (!isIsoDate(raw)) throw new AppError('USAGE', `--today must be a real date in YYYY-MM-DD form (got "${raw}")`);
  return raw;
}

function formatFlag(raw: string | undefined, fallback: FileFormat): FileFormat {
  if (raw === undefined) return fallback;
  if (raw === 'fixed' || raw === 'bai2') return raw;
  throw new AppError('USAGE', `unknown format "${raw}" (fixed | bai2)`);
}

function caseInputsFromFlags(args: ParsedArgs): CaseInputs {
  const paymentPath = requireFlag(args, 'file');
  const format = formatFlag(flagString(args, 'format'), 'fixed');
  const copybook = flagString(args, 'copybook');
  if (format === 'fixed' && !copybook) throw new AppError('USAGE', '--copybook is required for a fixed-width file');
  const inputs: CaseInputs = {
    payment: { path: paymentPath, format, ...(copybook ? { copybookPath: copybook } : {}) },
  };
  const bankPath = flagString(args, 'bank');
  if (bankPath) {
    const bankFormat = formatFlag(flagString(args, 'bank-format'), 'fixed');
    const bankCopybook = flagString(args, 'bank-copybook');
    if (bankFormat === 'fixed' && !bankCopybook) {
      throw new AppError('USAGE', '--bank-copybook is required for a fixed-width bank file');
    }
    inputs.bank = { path: bankPath, format: bankFormat, ...(bankCopybook ? { copybookPath: bankCopybook } : {}) };
  }
  const window = flagString(args, 'window');
  if (window) {
    const match = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(window);
    if (!match) throw new AppError('USAGE', '--window must look like 2026-11-18..2026-11-20');
    inputs.settlementWindow = { start: match[1]!, end: match[2]! };
  }
  const tolerance = flagString(args, 'tolerance');
  if (tolerance !== undefined) {
    const days = Number(tolerance);
    if (!Number.isInteger(days) || days < 0) throw new AppError('USAGE', '--tolerance must be a non-negative integer');
    inputs.toleranceDays = days;
  }
  return inputs;
}

function printFinding(finding: JsonFinding, index: number): string[] {
  const lines = [`  ${index + 1}. ${finding.code}  record=${finding.recordIndex}${finding.field ? `  field=${finding.field}` : ''}${finding.reference ? `  ref=${finding.reference}` : ''}`];
  const render = (value: unknown): string => {
    if (value === undefined || value === null) return '-';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'object' && 'minorUnits' in (value as Record<string, unknown>)) {
      const amount = value as { minorUnits: string | bigint; currency: string; scale: number };
      return formatAmount({ ...amount, minorUnits: BigInt(amount.minorUnits) });
    }
    return JSON.stringify(value);
  };
  lines.push(`     declared ${render(finding.declared)}   computed ${render(finding.computed)}   delta ${render(finding.delta)}`);
  lines.push(`     ${finding.detail}`);
  return lines;
}

function printVerdict(report: Report, out: (line: string) => void): void {
  const verdict = report.verdict!;
  out(`verdict: ${verdict.status}   findings: ${verdict.findings.length}   fingerprint: ${verdict.fingerprint}`);
  if (verdict.status === 'INCOMPLETE') {
    out(`  INCOMPLETE: ${verdict.summary.blockingParseIssues} parse issue(s) left bytes uninterpreted, so this run does not earn a PASS`);
  }
  out(
    `820 ${report.files.payment.details}/${report.files.payment.records} records (${report.files.payment.format})` +
      (report.files.bank ? `   bank ${report.files.bank.details}/${report.files.bank.records} records (${report.files.bank.format})` : '') +
      `   references matched ${verdict.summary.referencesMatched}, unmatched ${verdict.summary.referencesUnmatched}`,
  );
  for (const issue of report.files.payment.issues as JsonIssue[]) {
    out(`  parse issue ${issue.code}${issue.recordIndex !== undefined ? ` @record ${issue.recordIndex}` : ''}: ${issue.detail}`);
  }
  for (const issue of (report.files.bank?.issues ?? []) as JsonIssue[]) {
    out(`  bank issue ${issue.code}${issue.recordIndex !== undefined ? ` @record ${issue.recordIndex}` : ''}: ${issue.detail}`);
  }
  for (const [currency, totals] of Object.entries(verdict.summary.totals)) {
    out(`  control total ${currency}: declared ${totals.declared} summed ${totals.computed} delta ${totals.delta} (minor units)`);
  }
  if (verdict.findings.length > 0) {
    out('findings:');
    verdict.findings.forEach((finding, index) => printFinding(finding, index).forEach(out));
  }
}

function printGuarantees(report: Report, out: (line: string) => void): void {
  out('');
  out(`guaranteed (${report.guarantees.sourcePath}):`);
  for (const item of report.guarantees.guaranteed) out(`  + ${item}`);
  out('not guaranteed: a human decides:');
  for (const item of report.guarantees.notGuaranteed) out(`  - ${item}`);
}

function printExplanation(explanation: Explanation, index: number, out: (line: string) => void): void {
  out(`  ${index + 1}. ${explanation.citation}  [${explanation.status}] via ${explanation.adapter}`);
  out(`     cause: ${explanation.cause}`);
  out(`     fix:   ${explanation.suggestedFix}`);
  if (explanation.rejection) {
    out(`     blocked: cited ${explanation.rejection.unsupported.join(', ')} which the finding does not contain`);
    out(`     draft  : ${explanation.rejection.draft.cause}`);
  }
  if (explanation.note) out(`     note:  ${explanation.note}`);
}

/**
 * Helper functions for exception register CLI commands (T7.1, R8.6).
 */
namespace exceptionCommands {
  /**
   * `exceptions` - read-only: show the classification of findings against a ledger.
   */
  export function exceptions(args: ParsedArgs): {
    classification: ReturnType<typeof classify>;
    legacyPath: string;
    head: { count: number; hash: string };
  } {
    const reportDir = args.positional[0] ?? flagString(args, 'report');
    if (!reportDir) throw new AppError('USAGE', 'exceptions needs a report directory or --report');
    const { report } = loadReport(reportDir);
    if (!report.verdict) throw new AppError('SPEC', 'report has no verdict');

    const ledgerPath = flagString(args, 'ledger') ?? join(dirname(reportDir.endsWith('.json') ? reportDir : join(reportDir, 'report.json')), 'ledger.json');
    let ledger = emptyLedger();
    if (existsSync(ledgerPath)) {
      const text = readFileSync(ledgerPath, 'utf8');
      ledger = parseLedger(text);
    }

    const onDate = todayFlag(args) ?? new Date().toISOString().split('T')[0]!;
    const classification = classify(reviveFindings(report.verdict.findings), ledger, onDate);
    return { classification, legacyPath: ledgerPath, head: ledgerDigest(ledger) };
  }

  /**
   * `waive` - append a waiver for a finding to the ledger.
   * Requires --report, --index (0-based finding index), --owner, --reason, --control, --expires, --today.
   */
  export function waive(args: ParsedArgs): { newLedger: ReturnType<typeof appendWaiver>; legacyPath: string } {
    const reportDir = flagString(args, 'report');
    if (!reportDir) throw new AppError('USAGE', '--report is required');
    const { report } = loadReport(reportDir);
    if (!report.verdict) throw new AppError('SPEC', 'report has no verdict');

    const indexStr = flagString(args, 'index');
    if (!indexStr) throw new AppError('USAGE', '--index is required');
    const findingIndex = Number(indexStr);
    if (!Number.isInteger(findingIndex) || findingIndex < 0 || findingIndex >= report.verdict.findings.length) {
      throw new AppError('USAGE', `--index must be 0..${report.verdict.findings.length - 1}`);
    }
    // Revive the JSON amounts back to `bigint` before the finding key is computed, so the
    // key the ledger stores is the same one a live reconciliation produces.
    const finding = reviveFindings(report.verdict.findings)[findingIndex]!;

    const owner = flagString(args, 'owner');
    if (!owner) throw new AppError('USAGE', '--owner is required');
    const reason = flagString(args, 'reason');
    if (!reason) throw new AppError('USAGE', '--reason is required');
    const control = flagString(args, 'control');
    if (!control) throw new AppError('USAGE', '--control is required');
    // R8.1 as the submission text states it: reason, expiry and compensating control are all
    // required. Expiry was optional until 2026-11-22; the module and this command now refuse a
    // waiver without one instead of printing "(no expiry)".
    const expiresOn = flagString(args, 'expires');
    if (!expiresOn) throw new AppError('USAGE', '--expires <YYYY-MM-DD> is required: a waiver is a decision with an end date');
    if (!isIsoDate(expiresOn)) throw new AppError('USAGE', `--expires must be a real date in YYYY-MM-DD form (got "${expiresOn}")`);
    const decidedOn = todayFlag(args) ?? new Date().toISOString().split('T')[0]!;

    const ledgerPath = flagString(args, 'ledger') ?? join(dirname(reportDir.endsWith('.json') ? reportDir : join(reportDir, 'report.json')), 'ledger.json');
    let ledger = emptyLedger();
    if (existsSync(ledgerPath)) {
      const text = readFileSync(ledgerPath, 'utf8');
      ledger = parseLedger(text);
    }

    const integrity = verifyLedger(ledger);
    if (!integrity.ok) {
      throw new AppError('SPEC', `ledger integrity failed at seq ${integrity.firstInvalidSeq}: ${integrity.detail ?? 'hash chain broken'}`);
    }

    const newLedger = appendWaiver(
      ledger,
      { owner, reason, compensatingControl: control, expiresOn, decidedOn },
      finding,
      { fingerprint: report.verdict.fingerprint, decidedOn },
    );
    return { newLedger, legacyPath: ledgerPath };
  }

  /**
   * `release` - append a release for a waiver to the ledger.
   * Requires --report, --id (waiver id), --owner, --reason, optional --control, --today.
   */
  export function release(args: ParsedArgs): { newLedger: ReturnType<typeof appendRelease>; legacyPath: string } {
    const reportDir = flagString(args, 'report');
    if (!reportDir) throw new AppError('USAGE', '--report is required');
    const { report } = loadReport(reportDir);

    const waiverId = flagString(args, 'id');
    if (!waiverId) throw new AppError('USAGE', '--id (waiver id) is required');

    const owner = flagString(args, 'owner');
    if (!owner) throw new AppError('USAGE', '--owner is required');
    const reason = flagString(args, 'reason');
    if (!reason) throw new AppError('USAGE', '--reason is required');
    // R8.1: every entry carries a compensating control, including the one that withdraws a waiver.
    const control = flagString(args, 'control');
    if (!control) throw new AppError('USAGE', '--control is required');
    const decidedOn = todayFlag(args) ?? new Date().toISOString().split('T')[0]!;

    const ledgerPath = flagString(args, 'ledger') ?? join(dirname(reportDir.endsWith('.json') ? reportDir : join(reportDir, 'report.json')), 'ledger.json');
    if (!existsSync(ledgerPath)) {
      throw new AppError('SPEC', `ledger not found at ${ledgerPath}`);
    }
    const text = readFileSync(ledgerPath, 'utf8');
    const ledger = parseLedger(text);

    const integrity = verifyLedger(ledger);
    if (!integrity.ok) {
      throw new AppError('SPEC', `ledger integrity failed at seq ${integrity.firstInvalidSeq}: ${integrity.detail ?? 'hash chain broken'}`);
    }

    const newLedger = appendRelease(ledger, { owner, reason, control, decidedOn }, waiverId);
    return { newLedger, legacyPath: ledgerPath };
  }
}

export async function runCli(argv: string[], streams: Streams = defaultStreams): Promise<number> {
  const { out, err } = streams;
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  const json = args.flags.json === true;

  try {
    switch (command) {
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        out(USAGE);
        return EXIT.PASS;

      case 'parse': {
        const inputs = caseInputsFromFlags(args);
        const report = buildReport(inputs, { includeVerdict: false });
        const dir = ensureDir(flagString(args, 'out') ?? defaultOutDir());
        const path = writeReport(report, dir);
        if (json) {
          out(JSON.stringify(report, null, 2));
        } else {
          out(`parsed ${inputs.payment.path} (${report.files.payment.format}) - ${report.files.payment.records} records, ${report.files.payment.details} details`);
          for (const issue of report.files.payment.issues as JsonIssue[]) {
            out(`  issue ${issue.code}${issue.recordIndex !== undefined ? ` @record ${issue.recordIndex}` : ''}: ${issue.detail}`);
          }
          if (report.files.bank) out(`parsed bank ${inputs.bank!.path} - ${report.files.bank.records} records`);
          out(`report: ${path}`);
        }
        return report.files.payment.issues.length === 0 && (report.files.bank?.issues.length ?? 0) === 0
          ? EXIT.PASS
          : EXIT.FINDINGS;
      }

      case 'reconcile': {
        const inputs = caseInputsFromFlags(args);
        const report = buildReport(inputs);
        const dir = ensureDir(flagString(args, 'out') ?? defaultOutDir());
        const path = writeReport(report, dir);
        if (json) {
          out(JSON.stringify(report, null, 2));
        } else {
          printVerdict(report, out);
          printGuarantees(report, out);
          out(`report: ${path}`);
        }
        return report.verdict!.status === 'PASS' ? EXIT.PASS : EXIT.FINDINGS;
      }

      case 'explain': {
        const target = flagString(args, 'findings') ?? args.positional[0];
        if (!target) throw new AppError('USAGE', '--findings <report.json|dir> is required');
        const { report, path } = loadReport(target);
        const adapterName = flagString(args, 'adapter') ?? 'grounded';
        const maxLiveRaw = flagString(args, 'max-live');
        const maxLiveCalls = maxLiveRaw === undefined ? 0 : Number(maxLiveRaw);
        if (!Number.isInteger(maxLiveCalls) || maxLiveCalls < 0) throw new AppError('USAGE', '--max-live must be a non-negative integer');
        const adapter = adapterByName(adapterName);
        const run = await explainReport(report, { adapter, maxLiveCalls });
        const enriched: Report = { ...report, explanations: run.explanations };
        const dir = ensureDir(flagString(args, 'out') ?? dirname(path));
        const explanationsPath = join(dir, 'explanations.json');
        writeFileSync(
          explanationsPath,
          `${JSON.stringify({ generatedAt: new Date().toISOString(), liveCalls: run.liveCalls, explanations: run.explanations }, null, 2)}\n`,
          'utf8',
        );
        if (json) {
          out(JSON.stringify({ liveCalls: run.liveCalls, budgetLimited: run.budgetLimited, explanations: enriched.explanations }, null, 2));
        } else {
          out(`explaining ${enriched.explanations!.length} finding(s) with adapter "${adapterName}" (live calls: ${run.liveCalls})`);
          enriched.explanations!.forEach((explanation, index) => printExplanation(explanation, index, out));
          out(`explanations: ${explanationsPath}`);
        }
        return enriched.explanations!.every((e) => e.status === 'EXPLAINED') ? EXIT.PASS : EXIT.FINDINGS;
      }

      case 'verify': {
        const target = args.positional[0] ?? flagString(args, 'report');
        if (!target) throw new AppError('USAGE', 'verify needs a report directory or report.json');
        const outcome = verifyReport(target);
        if (json) {
          out(JSON.stringify(outcome, null, 2));
        } else {
          out(`verify ${outcome.reportPath}`);
          out(`  recorded fingerprint   ${outcome.recordedFingerprint ?? '-'}`);
          out(`  recomputed fingerprint ${outcome.recomputedFingerprint ?? '-'}`);
          out(`  recorded verdict ${outcome.recordedStatus ?? '-'}   recomputed verdict ${outcome.recomputedStatus ?? '-'}`);
          out(
            `  read-only: report ${outcome.mutation.reportBytesBefore} -> ${outcome.mutation.reportBytesAfter} bytes, mtime ${outcome.mutation.reportMtimeBefore} -> ${outcome.mutation.reportMtimeAfter}`,
          );
          if (outcome.ledger) {
            out(
              `  ledger ${outcome.ledger.path}: ${outcome.ledger.entries ?? '-'} entries, head ${outcome.ledger.headHash ?? '-'}${outcome.ledger.ok ? '' : ` - ${outcome.ledger.detail ?? 'verification failed'}`}`,
            );
          }
          if (outcome.ok) {
            out('  RESULT: identical - same inputs, same verdict');
          } else if (outcome.firstDifference === null) {
            out('  RESULT: the report re-derives, but the exception ledger does not verify');
          } else {
            out(`  RESULT: DIFFERENT - first differing field: ${outcome.firstDifference}`);
          }
          out('');
          out(`guaranteed (${outcome.guarantees.sourcePath}):`);
          for (const item of outcome.guarantees.guaranteed) out(`  + ${item}`);
          out('not guaranteed: a human decides:');
          for (const item of outcome.guarantees.notGuaranteed) out(`  - ${item}`);
        }
        return outcome.ok ? EXIT.PASS : EXIT.FINDINGS;
      }

      case 'demo': {
        // Convenience for the video: reconcile every sample pair in one run.
        const root = repoRoot();
        const pairs: Array<{ name: string; inputs: CaseInputs }> = [
          {
            name: 'S1 820-good + 823-bank',
            inputs: {
              payment: { path: join(root, 'samples/data/820-good.txt'), copybookPath: join(root, 'samples/copybooks/820.cpy') },
              bank: { path: join(root, 'samples/data/823-bank.txt'), copybookPath: join(root, 'samples/copybooks/823.cpy') },
              settlementWindow: { start: '2026-11-18', end: '2026-11-20' },
            },
          },
          {
            name: 'S2 820-packed-good + 823-bank',
            inputs: {
              payment: { path: join(root, 'samples/data/820-packed-good.txt'), copybookPath: join(root, 'samples/copybooks/820-packed.cpy') },
              bank: { path: join(root, 'samples/data/823-bank.txt'), copybookPath: join(root, 'samples/copybooks/823.cpy') },
              settlementWindow: { start: '2026-11-18', end: '2026-11-20' },
            },
          },
          {
            name: 'S3 820-bad + 823-bank',
            inputs: {
              payment: { path: join(root, 'samples/data/820-bad.txt'), copybookPath: join(root, 'samples/copybooks/820.cpy') },
              bank: { path: join(root, 'samples/data/823-bank.txt'), copybookPath: join(root, 'samples/copybooks/823.cpy') },
              settlementWindow: { start: '2026-11-18', end: '2026-11-20' },
            },
          },
          {
            name: 'S4 820-good + 823-bad',
            inputs: {
              payment: { path: join(root, 'samples/data/820-good.txt'), copybookPath: join(root, 'samples/copybooks/820.cpy') },
              bank: { path: join(root, 'samples/data/823-bad.txt'), copybookPath: join(root, 'samples/copybooks/823.cpy') },
              settlementWindow: { start: '2026-11-18', end: '2026-11-20' },
            },
          },
          {
            name: 'S5 820-good + bai2-good',
            inputs: {
              payment: { path: join(root, 'samples/data/820-good.txt'), copybookPath: join(root, 'samples/copybooks/820.cpy') },
              bank: { path: join(root, 'samples/data/bai2-good.txt'), format: 'bai2' },
              settlementWindow: { start: '2026-11-18', end: '2026-11-20' },
            },
          },
          {
            name: 'S6 820-good + bai2-bad',
            inputs: {
              payment: { path: join(root, 'samples/data/820-good.txt'), copybookPath: join(root, 'samples/copybooks/820.cpy') },
              bank: { path: join(root, 'samples/data/bai2-bad.txt'), format: 'bai2' },
              settlementWindow: { start: '2026-11-18', end: '2026-11-20' },
            },
          },
          {
            name: 'S7 820-redefines-good + 823-bank',
            inputs: {
              payment: { path: join(root, 'samples/data/820-redefines-good.txt'), copybookPath: join(root, 'samples/copybooks/820-redefines.cpy') },
              bank: { path: join(root, 'samples/data/823-bank.txt'), copybookPath: join(root, 'samples/copybooks/823.cpy') },
              settlementWindow: { start: '2026-11-18', end: '2026-11-20' },
            },
          },
          {
            name: 'S8 820-redefines-bad + 823-bank',
            inputs: {
              payment: { path: join(root, 'samples/data/820-redefines-bad.txt'), copybookPath: join(root, 'samples/copybooks/820-redefines.cpy') },
              bank: { path: join(root, 'samples/data/823-bank.txt'), copybookPath: join(root, 'samples/copybooks/823.cpy') },
              settlementWindow: { start: '2026-11-18', end: '2026-11-20' },
            },
          },
        ];
        let worst: number = EXIT.PASS;
        for (const pair of pairs) {
          const { result } = reconcileCase(pair.inputs);
          out(`\n=== ${pair.name}: ${result.status} (${result.findings.length} findings)`);
          result.findings.forEach((finding, index) =>
            printFinding(finding as unknown as JsonFinding, index).forEach(out),
          );
          if (result.status !== 'PASS') worst = EXIT.FINDINGS;
        }
        return worst;
      }

      case 'exceptions': {
        const { classification, legacyPath, head } = exceptionCommands.exceptions(args);
        if (json) {
          out(JSON.stringify({ ...classification, ledger: { path: legacyPath, entries: head.count, headHash: head.hash } }, null, 2));
        } else {
          out(`exceptions (${legacyPath}):`);
          out(`  ledger head: ${head.count} entries, hash ${head.hash}`);
          out(`  OPEN: ${classification.counts.OPEN}   WAIVED: ${classification.counts.WAIVED}   EXPIRED: ${classification.counts.EXPIRED}   RELEASED: ${classification.counts.RELEASED}`);
          out(`  unadjudicated: ${classification.unadjudicated}`);
          for (const entry of classification.entries) {
            const waiverNote = entry.waiverId ? ` (waived ${entry.waiverId}${entry.expiresOn ? ` expires ${entry.expiresOn}` : ''})` : '';
            out(`    ${entry.status} ${entry.code} @record ${entry.recordIndex}${entry.field ? ` field=${entry.field}` : ''}${entry.reference ? ` ref=${entry.reference}` : ''}${waiverNote}`);
          }
        }
        // R8.6: exit 0 if no OPEN or EXPIRED, 2 if at least one is, 3 on ledger integrity failure
        return classification.unadjudicated > 0 ? EXIT.FINDINGS : EXIT.PASS;
      }

      case 'waive': {
        const { newLedger, legacyPath } = exceptionCommands.waive(args);
        writeFileSync(legacyPath, serialiseLedger(newLedger), 'utf8');
        if (json) {
          out(JSON.stringify({ ledgerPath: legacyPath, entriesCount: newLedger.entries.length }, null, 2));
        } else {
          const entry = newLedger.entries[newLedger.entries.length - 1]!;
          out(`waived: ${entry.id}  finding=${entry.findingKey}`);
          out(`  owner ${entry.owner}; decided ${entry.decidedOn}; expires ${entry.expiresOn}`);
          out(`  ledger: ${legacyPath} (${newLedger.entries.length} entries, head ${ledgerDigest(newLedger).hash})`);
        }
        return EXIT.PASS;
      }

      case 'release': {
        const { newLedger, legacyPath } = exceptionCommands.release(args);
        writeFileSync(legacyPath, serialiseLedger(newLedger), 'utf8');
        if (json) {
          out(JSON.stringify({ ledgerPath: legacyPath, entriesCount: newLedger.entries.length }, null, 2));
        } else {
          out(`released: ${legacyPath} now has ${newLedger.entries.length} entries, head ${ledgerDigest(newLedger).hash}`);
        }
        return EXIT.PASS;
      }

      default:
        throw new AppError('USAGE', `unknown command "${command}"\n\n${USAGE}`);
    }
  } catch (error) {
    if (error instanceof AppError) {
      err(`error (${error.kind}): ${error.message}`);
      return EXIT.ERROR;
    }
    err(`error: ${(error as Error).message}`);
    return EXIT.ERROR;
  }
}
