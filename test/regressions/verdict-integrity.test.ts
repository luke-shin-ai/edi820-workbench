/**
 * Regression: verdict integrity (defects found 2026-11-21, review §5 #2, #3, #7).
 *
 * Three claims are asserted here, each one a thing the tool used to get wrong:
 *   1. a file with a record that is one byte short cannot earn `PASS`;
 *   2. `verify` gives the same answer from any working directory;
 *   3. a BAI2 `03`/`100` credit declaration is compared against a figure whose
 *      credit and debit parts are named, instead of an anonymous net.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../../src/cli/index.js';
import { buildReport, verifyReport } from '../../src/core/ops.js';
import { reconcile } from '../../src/reconcile/index.js';
import { compileCopybook } from '../../src/copybook/index.js';
import { parseFile } from '../../src/parser/index.js';
import { parseBai2 } from '../../src/bai2/index.js';

const root = join(import.meta.dirname, '..', '..');
const cliEntry = join(root, 'src', 'cli', 'main.ts');
const tsxBin = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const GOOD = join(root, 'samples/data/820-good.txt');
const COB820 = join(root, 'samples/copybooks/820.cpy');
const BANK = join(root, 'samples/data/823-bank.txt');
const COB823 = join(root, 'samples/copybooks/823.cpy');

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `820-${prefix}-`));
}

/** 820-good with one FILLER byte removed from the second record: 99 bytes instead of 100. */
function truncatedGoodFile(): string {
  const text = readFileSync(GOOD, 'latin1');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const records = text.split(eol).filter((line) => line.length > 0);
  const second = records[1]!;
  records[1] = second.slice(0, 99);
  const dir = tempDir('truncated');
  const path = join(dir, '820-truncated.txt');
  writeFileSync(path, `${records.join(eol)}${eol}`);
  return path;
}

describe('a record that is one byte short never earns PASS', () => {
  it('reconcile reports INCOMPLETE, not PASS, when only a parse issue fired', () => {
    const source = readFileSync(truncatedGoodFile(), 'latin1');
    const copybook = compileCopybook(readFileSync(COB820, 'utf8'));
    const payment = parseFile({ copybook, source: Buffer.from(source, 'latin1'), filename: '820-truncated.txt' });
    const result = reconcile({
      payment,
      options: { settlementWindow: { start: '2026-11-18', end: '2026-11-20' } },
    });
    expect(payment.issues.map((issue) => issue.code)).toContain('RECORD_LENGTH_MISMATCH');
    expect(result.findings).toEqual([]);
    expect(result.status).toBe('INCOMPLETE');
    expect(result.summary.blockingParseIssues).toBeGreaterThan(0);
  });

  it('leaves a genuinely clean file at PASS (the rule is about issues, not about strictness)', () => {
    const report = buildReport({
      payment: { path: GOOD, copybookPath: COB820 },
      bank: { path: BANK, copybookPath: COB823 },
      settlementWindow: { start: '2026-11-18', end: '2026-11-20' },
    });
    expect(report.verdict?.status).toBe('PASS');
    expect(report.verdict?.summary.blockingParseIssues).toBe(0);
  });

  it('the process boundary agrees: exit code is 2 for INCOMPLETE', () => {
    const out = tempDir('incomplete-out');
    const truncated = truncatedGoodFile();
    const child = spawnSync(
      process.execPath,
      [tsxBin, cliEntry, 'reconcile', '--copybook', COB820, '--file', truncated, '--window', '2026-11-18..2026-11-20', '--out', out],
      { encoding: 'utf8' },
    );
    expect(child.status).toBe(2);
    expect(child.stdout).toContain('verdict: INCOMPLETE');
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as { verdict: { status: string } };
    expect(report.verdict.status).toBe('INCOMPLETE');
    rmSync(out, { recursive: true, force: true });
  });
});

describe('verify is independent of the working directory', () => {
  it('re-derives a report whose inputs live outside the current directory', () => {
    const out = tempDir('verify-cwd');
    const report = buildReport({
      payment: { path: GOOD, copybookPath: COB820 },
      bank: { path: BANK, copybookPath: COB823 },
      settlementWindow: { start: '2026-11-18', end: '2026-11-20' },
    });
    const dir = join(out, 'run');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    // The report records repository-relative paths; record a copy and verify it from
    // a directory that has neither `samples/` nor the repository in its ancestry.
    const cwd = process.cwd();
    const child = spawnSync(process.execPath, [tsxBin, cliEntry, 'verify', dir], { encoding: 'utf8', cwd: tmpdir() });
    expect(process.cwd()).toBe(cwd);
    expect(child.status).toBe(0);
    expect(child.stdout).toContain('RESULT: identical');
    expect(child.stderr).toBe('');
    const inProcess = verifyReport(dir);
    expect(inProcess.ok).toBe(true);
    expect(inProcess.firstDifference).toBeNull();
    rmSync(out, { recursive: true, force: true });
  });

  it('a report that was copied next to its inputs also verifies', () => {
    const out = tempDir('verify-copied');
    const report = buildReport({ payment: { path: GOOD, copybookPath: COB820 } });
    mkdirSync(join(out, 'samples/data'), { recursive: true });
    mkdirSync(join(out, 'samples/copybooks'), { recursive: true });
    writeFileSync(join(out, 'samples/data/820-good.txt'), readFileSync(GOOD));
    writeFileSync(join(out, 'samples/copybooks/820.cpy'), readFileSync(COB820));
    writeFileSync(join(out, 'run.json'), `${JSON.stringify(report, null, 2)}\n`);
    const outcome = verifyReport(join(out, 'run.json'));
    expect(outcome.ok).toBe(true);
    rmSync(out, { recursive: true, force: true });
  });
});

describe('BAI2 credit declaration vs a net detail figure', () => {
  it('names the credit and debit parts of the S6 delta', () => {
    const bank = parseBai2(readFileSync(join(root, 'samples/data/bai2-bad.txt')));
    const copybook = compileCopybook(readFileSync(COB820, 'utf8'));
    const payment = parseFile({ copybook, source: readFileSync(GOOD), filename: '820-good.txt' });
    const result = reconcile({ payment, bank, options: { settlementWindow: { start: '2026-11-18', end: '2026-11-20' } } });
    const total = result.findings.find((finding) => finding.code === 'CONTROL_TOTAL_MISMATCH');
    expect(total).toBeDefined();
    expect(total!.detail).toContain('credits 1,205,550.00');
    expect(total!.detail).toContain('minus debits 25.00');
    expect(total!.delta).toEqual({ minorUnits: -7_902_500n, currency: 'USD', scale: 2 });
    // The bank row states its basis, so the number in the report explains itself.
    expect(result.summary.totals['USD (bank 03/100 credits)']).toMatchObject({
      declared: '128455000',
      computed: '120552500',
      delta: '-7902500',
      basis: 'credits minus debits (net)',
      credits: '120555000',
      debits: '2500',
    });
  });
});

describe('the CLI never prints PASS for a case it could not type', () => {
  it('reconcile --json exposes the same INCOMPLETE status the file holds', async () => {
    const out = tempDir('json-incomplete');
    const lines: string[] = [];
    const code = await runCli(
      ['reconcile', '--copybook', COB820, '--file', truncatedGoodFile(), '--window', '2026-11-18..2026-11-20', '--out', out, '--json'],
      { out: (line) => lines.push(line), err: () => undefined },
    );
    expect(code).toBe(2);
    const printed = JSON.parse(lines.join('\n')) as { verdict: { status: string; summary: { blockingParseIssues: number } } };
    expect(printed.verdict.status).toBe('INCOMPLETE');
    expect(printed.verdict.summary.blockingParseIssues).toBeGreaterThan(0);
    rmSync(out, { recursive: true, force: true });
  });
});
