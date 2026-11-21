/**
 * T5.1–T5.2 — the CLI surface and its exit codes.
 *
 * The exit code is the API a CI job consumes, so it is asserted as a number, not
 * as a string in the output. `verify` is also asserted to be read-only: bytes and
 * mtime of `report.json` must be identical before and after.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../../src/cli/index.js';

const cliEntry = join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts');
const tsxBin = join(import.meta.dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(...argv: string[]): Promise<RunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(argv, {
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `820-${prefix}-`));
}

const GOOD = 'samples/data/820-good.txt';
const BAD = 'samples/data/820-bad.txt';
const COB820 = 'samples/copybooks/820.cpy';
const BANK = 'samples/data/823-bank.txt';
const COB823 = 'samples/copybooks/823.cpy';
const WINDOW = '2026-11-18..2026-11-20';

describe('T5.1 — exit codes 0 / 2 / 3', () => {
  it('reconcile exits 0 for a matching pair', async () => {
    const out = tempDir('pass');
    const result = await run('reconcile', '--copybook', COB820, '--file', GOOD, '--bank', BANK, '--bank-copybook', COB823, '--window', WINDOW, '--out', out);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('verdict: PASS');
    expect(readFileSync(join(out, 'report.json'), 'utf8')).toContain('"status": "PASS"');
    rmSync(out, { recursive: true, force: true });
  });

  it('reconcile exits 2 when findings exist', async () => {
    const out = tempDir('fail');
    const result = await run('reconcile', '--copybook', COB820, '--file', BAD, '--bank', BANK, '--bank-copybook', COB823, '--window', WINDOW, '--out', out);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('verdict: FAIL');
    rmSync(out, { recursive: true, force: true });
  });

  it('exits 3 for an unreadable input and for a usage error', async () => {
    const missing = await run('reconcile', '--copybook', COB820, '--file', 'samples/data/nope.txt');
    expect(missing.code).toBe(3);
    expect(missing.stderr).toContain('error (IO)');

    const noCopybook = await run('reconcile', '--file', GOOD);
    expect(noCopybook.code).toBe(3);
    expect(noCopybook.stderr).toContain('--copybook is required');

    const brokenSpec = await run('reconcile', '--copybook', 'samples/data/820-good.txt', '--file', GOOD);
    expect(brokenSpec.code).toBe(3);
    expect(brokenSpec.stderr).toContain('error (SPEC)');

    const unknown = await run('frobnicate');
    expect(unknown.code).toBe(3);
  });

  it('parse exits 2 when the file itself has a coded issue', async () => {
    const out = tempDir('parse');
    const clean = await run('parse', '--copybook', COB820, '--file', GOOD, '--out', out);
    expect(clean.code).toBe(0);
    const withIssue = await run('parse', '--copybook', COB820, '--file', BAD, '--out', out);
    expect(withIssue.code).toBe(2);
    expect(withIssue.stdout).toContain('RECORD_LENGTH_MISMATCH');
    rmSync(out, { recursive: true, force: true });
  });

  it('the contract holds at the process boundary too (real exit code)', () => {
    const out = tempDir('spawn');
    const child = spawnSync(
      process.execPath,
      [tsxBin, cliEntry, 'reconcile', '--copybook', COB820, '--file', BAD, '--bank', BANK, '--bank-copybook', COB823, '--window', WINDOW, '--out', out],
      { encoding: 'utf8' },
    );
    expect(child.status).toBe(2);
    expect(child.stdout).toContain('CONTROL_TOTAL_MISMATCH');
    rmSync(out, { recursive: true, force: true });
  });
});

describe('T5.2 — verify re-derives, compares, and does not mutate', () => {
  it('prints both fingerprints, agrees, and leaves the report untouched', async () => {
    const out = tempDir('verify');
    await run('reconcile', '--copybook', COB820, '--file', BAD, '--bank', BANK, '--bank-copybook', COB823, '--window', WINDOW, '--out', out);
    const reportPath = join(out, 'report.json');
    const beforeBytes = readFileSync(reportPath);
    const beforeMtime = statSync(reportPath).mtimeMs;

    const result = await run('verify', out);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('RESULT: identical');
    expect(result.stdout).toMatch(/recorded fingerprint\s+([0-9a-f]{64})/);
    expect(result.stdout).toMatch(/recomputed fingerprint\s+([0-9a-f]{64})/);

    expect(readFileSync(reportPath).equals(beforeBytes)).toBe(true);
    expect(statSync(reportPath).mtimeMs).toBe(beforeMtime);
    rmSync(out, { recursive: true, force: true });
  });

  it('exits 2 and names the first differing field when the report was altered', async () => {
    const out = tempDir('verify-diff');
    await run('reconcile', '--copybook', COB820, '--file', GOOD, '--bank', BANK, '--bank-copybook', COB823, '--window', WINDOW, '--out', out);
    const reportPath = join(out, 'report.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { verdict: { fingerprint: string } };
    report.verdict.fingerprint = 'f'.repeat(64);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const result = await run('verify', out);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('first differing field: verdict.fingerprint');
    rmSync(out, { recursive: true, force: true });
  });

  it('detects a changed input file, which is the case CI cares about', async () => {
    const out = tempDir('verify-input');
    const inputsDir = join(out, 'inputs');
    mkdirSync(inputsDir, { recursive: true });
    copyFileSync(GOOD, join(inputsDir, '820.txt'));
    copyFileSync(BANK, join(inputsDir, '823.txt'));
    await run('reconcile', '--copybook', COB820, '--file', join(inputsDir, '820.txt'), '--bank', join(inputsDir, '823.txt'), '--bank-copybook', COB823, '--window', WINDOW, '--out', out);

    const original = readFileSync(join(inputsDir, '820.txt'), 'utf8');
    writeFileSync(join(inputsDir, '820.txt'), original.replace('000001500000{', '000001500001{'), 'utf8');
    const result = await run('verify', out);
    expect(result.code).toBe(2);
    expect(result.stdout).toMatch(/first differing field: (files|verdict)/);
    rmSync(out, { recursive: true, force: true });
  });

  it('exits 3 when there is no report to verify', async () => {
    const out = tempDir('verify-missing');
    const result = await run('verify', out);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain('no report.json');
    rmSync(out, { recursive: true, force: true });
  });
});

describe('T5.1 — explain reads a report and writes explanations beside it', () => {
  it('explains every finding with the mock adapter and records zero live calls', async () => {
    const out = tempDir('explain');
    await run('reconcile', '--copybook', COB820, '--file', BAD, '--bank', BANK, '--bank-copybook', COB823, '--window', WINDOW, '--out', out);
    const result = await run('explain', '--findings', out);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('live calls: 0');
    const written = JSON.parse(readFileSync(join(out, 'explanations.json'), 'utf8')) as {
      liveCalls: number;
      explanations: Array<{ status: string; citation: string }>;
    };
    expect(written.liveCalls).toBe(0);
    expect(written.explanations).toHaveLength(4);
    expect(written.explanations.every((e) => e.status === 'EXPLAINED')).toBe(true);
    expect(written.explanations[0]!.citation).toContain('CONTROL_TOTAL_MISMATCH');
    // report.json is not rewritten by explain (the explanations live beside it)
    const reportAfter = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as { explanations?: unknown };
    expect(reportAfter.explanations).toBeUndefined();
    rmSync(out, { recursive: true, force: true });
  });

  it('exits 3 when the report has no verdict', async () => {
    const out = tempDir('explain-noverdict');
    await run('parse', '--copybook', COB820, '--file', GOOD, '--out', out);
    const result = await run('explain', '--findings', out);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain('no verdict');
    rmSync(out, { recursive: true, force: true });
  });
});

describe('T5.1 — the demo command walks every fixture pair', () => {
  it('prints six scenarios, BAI2 included, and exits 2 because some fail by design', async () => {
    const result = await run('demo');
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('S1 820-good + 823-bank: PASS');
    expect(result.stdout).toContain('S2 820-packed-good + 823-bank: PASS');
    expect(result.stdout).toContain('S3 820-bad + 823-bank: FAIL (4 findings)');
    expect(result.stdout).toContain('S4 820-good + 823-bad: FAIL (3 findings)');
    expect(result.stdout).toContain('S5 820-good + bai2-good: PASS');
    expect(result.stdout).toContain('S6 820-good + bai2-bad: FAIL (3 findings)');
    // a bare bigint delta (count mismatch) must render, not throw "Do not know how to serialize a BigInt"
    expect(result.stdout).toContain('CONTROL_COUNT_MISMATCH');
    expect(result.stderr).toBe('');
  });
});

describe('T5.1 — BAI2 is reachable from the command line without a copybook', () => {
  it('reconciles an 820 file against a BAI2 statement', async () => {
    const out = tempDir('bai2');
    const pass = await run('reconcile', '--copybook', COB820, '--file', GOOD, '--bank', 'samples/data/bai2-good.txt', '--bank-format', 'bai2', '--window', WINDOW, '--out', out);
    expect(pass.code).toBe(0);
    expect(pass.stdout).toContain('bank 10/16 records (bai2)');
    const fail = await run('reconcile', '--copybook', COB820, '--file', GOOD, '--bank', 'samples/data/bai2-bad.txt', '--bank-format', 'bai2', '--window', WINDOW, '--out', out);
    expect(fail.code).toBe(2);
    expect(fail.stdout).toContain('BANK-FEE-2611');
    rmSync(out, { recursive: true, force: true });
  });

  it('--json emits the same report the file holds', async () => {
    const out = tempDir('json');
    const result = await run('reconcile', '--copybook', COB820, '--file', GOOD, '--out', out, '--json');
    expect(result.code).toBe(0);
    const printed = JSON.parse(result.stdout) as { verdict: { status: string }; guarantees: { guaranteed: string[] } };
    expect(printed.verdict.status).toBe('PASS');
    expect(printed.guarantees.guaranteed.length).toBeGreaterThanOrEqual(5);
    rmSync(out, { recursive: true, force: true });
  });
});
