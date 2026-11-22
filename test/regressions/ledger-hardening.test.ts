/**
 * Regressions for the three defects a cold read of the exception register found on 2026-11-22:
 *
 *   1. the hash joined its fields with `|`, so moving text across two fields kept the same hash;
 *   2. nothing recorded the ledger's length, so cutting off trailing entries still verified;
 *   3. `decidedOn` and the classification date were never checked to be real dates.
 *
 * Each test is written against the module first (fast) and then, where the exit code is the
 * contract, at the CLI boundary.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendRelease,
  appendWaiver,
  classify,
  emptyLedger,
  ledgerDigest,
  parseLedger,
  serialiseLedger,
  verifyLedger,
  LedgerError,
  type Finding,
} from '../../src/exception/index.js';
import { verifyReport } from '../../src/core/ops.js';

const root = join(import.meta.dirname, '..', '..');
const cliEntry = join(root, 'src', 'cli', 'main.ts');
const tsxBin = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const out = join(root, '.tmp', `ledger-hardening-${process.pid}`);

const finding = (code: string, recordIndex: number): Finding => ({
  code: code as Finding['code'],
  recordIndex,
  detail: `Mock finding ${code}`,
});
const context = { fingerprint: 'a'.repeat(64), decidedOn: '2026-11-20' };
const waiver = (owner: string, reason: string) =>
  appendWaiver(
    emptyLedger(),
    { owner, reason, compensatingControl: 'Daily suspense-account check', expiresOn: '2026-12-20', decidedOn: '2026-11-20' },
    finding('CONTROL_TOTAL_MISMATCH', 3),
    context,
  );

describe('ledger hardening: the entry hash has no field boundary to move', () => {
  it('two different owner/reason splits of the same text do not share a hash', () => {
    const a = waiver('A. Kim|approved by CFO', 'timing difference');
    const b = waiver('A. Kim', 'approved by CFO|timing difference');
    expect(a.entries[0]!.hash).not.toBe(b.entries[0]!.hash);
  });

  it('moving that text after the fact is a hash mismatch, not a valid ledger', () => {
    const ledger = waiver('A. Kim|approved by CFO', 'timing difference');
    ledger.entries[0]!.owner = 'A. Kim';
    ledger.entries[0]!.reason = 'approved by CFO|timing difference';
    const check = verifyLedger(ledger);
    expect(check.ok).toBe(false);
    expect(check.firstInvalidSeq).toBe(1);
  });

  it('the hash is over a JSON array, so a quote inside a value cannot forge it', () => {
    const a = waiver('A. Kim', 'paid "twice"');
    const b = waiver('A. Kim', 'paid \\"twice\\"');
    expect(a.entries[0]!.hash).not.toBe(b.entries[0]!.hash);
  });
});

describe('ledger hardening: cutting the tail off the ledger is visible', () => {
  const three = () => {
    let ledger = appendWaiver(
      emptyLedger(),
      { owner: 'A. Kim', reason: 'Known timing difference', compensatingControl: 'Suspense check', expiresOn: '2026-12-20', decidedOn: '2026-11-20' },
      finding('CONTROL_TOTAL_MISMATCH', 3),
      context,
    );
    ledger = appendRelease(
      ledger,
      { owner: 'B. Lee', reason: 'Trailer re-issued', control: 'Re-issued', decidedOn: '2026-11-21' },
      ledger.entries[0]!.id,
    );
    ledger = appendWaiver(
      ledger,
      { owner: 'C. Park', reason: 'Second review pending', compensatingControl: 'Daily check', expiresOn: '2026-12-24', decidedOn: '2026-11-22' },
      finding('REF_UNMATCHED', 7),
      { fingerprint: 'b'.repeat(64), decidedOn: '2026-11-22' },
    );
    return ledger;
  };

  it('carries the entry count and the head hash', () => {
    const ledger = three();
    expect(ledgerDigest(ledger)).toEqual({ count: 3, hash: ledger.entries[2]!.hash });
    expect(verifyLedger(ledger)).toMatchObject({ ok: true, entries: 3, headHash: ledger.entries[2]!.hash });
  });

  it('refuses a ledger whose trailing entry was removed but whose head was left in place', () => {
    const text = serialiseLedger(three());
    const parsed = JSON.parse(text) as { entries: unknown[] };
    parsed.entries.pop();
    const truncated = JSON.stringify(parsed, null, 2);
    let error: LedgerError | null = null;
    try {
      parseLedger(truncated);
    } catch (caught) {
      error = caught as LedgerError;
    }
    expect(error).toBeInstanceOf(LedgerError);
    expect(error!.code).toBe('TRUNCATED');
    expect(error!.message).toContain('trailing entries were removed');
  });

  it('verifyLedger also reports a stale head on an in-memory ledger', () => {
    const ledger = three();
    const stale = { ...ledger, entries: ledger.entries.slice(0, 2) };
    const check = verifyLedger(stale);
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('head declares 3 entries');
  });

  it('a document with no head at all is still accepted, and its limit is stated', () => {
    // Compatibility with a ledger written before the head existed. The chain verifies, but a cut
    // tail is not detectable, which is why every write now includes the head.
    const text = serialiseLedger(three());
    const withoutHead = JSON.parse(text) as { head?: unknown; entries: unknown[] };
    delete withoutHead.head;
    const parsed = parseLedger(JSON.stringify(withoutHead));
    expect(parsed.head).toBeUndefined();
    expect(verifyLedger(parsed).ok).toBe(true);
  });
});

describe('ledger hardening: dates are checked, not parsed loosely', () => {
  it('refuses a decidedOn that is not a real day', () => {
    const attempt = () =>
      appendWaiver(
        emptyLedger(),
        { owner: 'A. Kim', reason: 'r', compensatingControl: 'c', expiresOn: '2026-12-20', decidedOn: '2026-13-01' },
        finding('TEST', 1),
        context,
      );
    expect(attempt).toThrow(/decidedOn.*YYYY-MM-DD/);
  });

  it('refuses a release dated to a day that does not exist', () => {
    const ledger = waiver('A. Kim', 'reason');
    expect(() =>
      appendRelease(ledger, { owner: 'B. Lee', reason: 'r', control: 'c', decidedOn: '2026-02-30' }, ledger.entries[0]!.id),
    ).toThrow(/decidedOn.*YYYY-MM-DD/);
  });

  it('refuses a classification date that is not a real day', () => {
    expect(() => classify([finding('TEST', 1)], emptyLedger(), '2026-02-30')).toThrow(/classification date/);
  });
});

describe('ledger hardening: the CLI and verify surface report the head', () => {
  beforeAll(() => {
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const built = spawnSync(
      process.execPath,
      [
        tsxBin,
        cliEntry,
        'reconcile',
        '--copybook', join(root, 'samples/copybooks/820.cpy'),
        '--file', join(root, 'samples/data/820-bad.txt'),
        '--bank', join(root, 'samples/data/823-bank.txt'),
        '--bank-copybook', join(root, 'samples/copybooks/823.cpy'),
        '--window', '2026-11-18..2026-11-20',
        '--out', out,
      ],
      { encoding: 'utf8', cwd: root },
    );
    expect(built.status).toBe(2);
    const waived = spawnSync(
      process.execPath,
      [tsxBin, cliEntry, 'waive', '--report', out, '--index', '0', '--owner', 'S. Shin (TPM)', '--reason', 'Known timing difference while the bank re-issues the trailer.', '--control', 'Daily suspense-account check', '--expires', '2026-12-20', '--today', '2026-11-21'],
      { encoding: 'utf8', cwd: root },
    );
    expect(waived.status).toBe(0);
  });

  afterAll(() => {
    rmSync(out, { recursive: true, force: true });
  });

  const cli = (...argv: string[]) => spawnSync(process.execPath, [tsxBin, cliEntry, ...argv], { encoding: 'utf8', cwd: root });

  it('prints the entry count and head hash from `exceptions` and `verify`', () => {
    const exceptions = cli('exceptions', out, '--today', '2026-11-21');
    // One of four findings is waived here, so the exit code is still 2; what this test reads is
    // the ledger line above it.
    expect(exceptions.status).toBe(2);
    expect(exceptions.stdout).toMatch(/ledger head: 1 entries, hash [0-9a-f]{64}/);

    const verified = cli('verify', out);
    expect(verified.status).toBe(0);
    expect(verified.stdout).toMatch(/ledger .*: 1 entries, head [0-9a-f]{64}/);
  });

  it('`verify` fails when the ledger tail was removed after the report was filed', () => {
    const path = join(out, 'ledger.json');
    const original = readFileSync(path, 'utf8');
    const parsed = JSON.parse(original) as { entries: unknown[] };
    parsed.entries.pop();
    writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
    const before = verifyReport(out);
    expect(before.ok).toBe(false);
    expect(before.firstDifference).toBeNull();
    expect(before.ledger?.ok).toBe(false);
    expect(before.ledger?.detail).toContain('trailing entries were removed');
    writeFileSync(path, original);
    expect(verifyReport(out).ok).toBe(true);
  });

  it('refuses --today values that are not real days', () => {
    const exceptions = cli('exceptions', out, '--today', '2026-02-30');
    expect(exceptions.status).toBe(3);
    expect(exceptions.stderr).toContain('YYYY-MM-DD');
    const waived = cli('waive', '--report', out, '--index', '1', '--owner', 'S. Shin (TPM)', '--reason', 'Backdated attempt.', '--control', 'Daily check', '--expires', '2026-12-20', '--today', '2026-13-01');
    expect(waived.status).toBe(3);
    expect(waived.stderr).toContain('YYYY-MM-DD');
  });
});
