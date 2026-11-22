import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptyLedger,
  parseLedger,
  serialiseLedger,
  appendWaiver,
  appendRelease,
  verifyLedger,
  classify,
  findingKey,
  LedgerError,
  type Finding,
  type Ledger,
} from '../../src/exception/index.js';

const mockFinding = (code: string, recordIndex: number, field?: string): Finding => ({
  code: code as any,
  recordIndex,
  field,
  detail: `Mock finding ${code}`,
});

const mockContext = () => ({
  fingerprint: 'abcd1234' + 'efgh5678'.repeat(6),
  decidedOn: '2026-11-20',
});

describe('Exception register (T7.1, R8.1-R8.8)', () => {
  describe('R8.1 - waiver structure', () => {
    it('creates an empty ledger', () => {
      const ledger = emptyLedger();
      expect(ledger.version).toBe(1);
      expect(ledger.entries).toEqual([]);
    });

    it('appends a waiver with all required fields', () => {
      const ledger = emptyLedger();
      const finding = mockFinding('CONTROL_TOTAL_MISMATCH', 5, 'AMOUNT');
      const input = { owner: 'Alice', reason: 'Known issue', compensatingControl: 'Manual review', expiresOn: '2026-12-20' };
      const context = mockContext();

      const newLedger = appendWaiver(ledger, input, finding, context);
      expect(newLedger.entries).toHaveLength(1);
      const entry = newLedger.entries[0]!;
      expect(entry.seq).toBe(1);
      expect(entry.decision).toBe('waived');
      expect(entry.owner).toBe('Alice');
      expect(entry.reason).toBe('Known issue');
      expect(entry.compensatingControl).toBe('Manual review');
      expect(entry.decidedOn).toBe('2026-11-20');
      expect(entry.expiresOn).toBe('2026-12-20');
      expect(entry.prevHash).toBe('GENESIS');
      expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('appends a waiver with an expiry date', () => {
      const ledger = emptyLedger();
      const finding = mockFinding('REF_UNMATCHED', 3);
      const input = { owner: 'Bob', reason: 'Temporary', compensatingControl: 'Follow-up', expiresOn: '2026-12-20' };
      const context = mockContext();

      const newLedger = appendWaiver(ledger, input, finding, context);
      expect(newLedger.entries[0]!.expiresOn).toBe('2026-12-20');
    });

    it('stores the finding key in the waiver', () => {
      const ledger = emptyLedger();
      const finding = mockFinding('DATE_OUT_OF_WINDOW', 7, 'VALUE_DATE');
      const input = { owner: 'Charlie', reason: 'Test', compensatingControl: 'Note', expiresOn: '2026-12-20' };
      const context = mockContext();

      const newLedger = appendWaiver(ledger, input, finding, context);
      const key = findingKey(finding);
      expect(newLedger.entries[0]!.findingKey).toBe(key);
    });
  });

  describe('R8.2 - validation of waiver inputs', () => {
    const finding = mockFinding('TEST', 1);
    const context = mockContext();

    it('rejects empty owner', () => {
      const ledger = emptyLedger();
      const input = { owner: '', reason: 'Test', compensatingControl: 'Control', expiresOn: '2026-12-20' };
      expect(() => appendWaiver(ledger, input, finding, context)).toThrow(LedgerError);
    });

    it('rejects empty reason', () => {
      const ledger = emptyLedger();
      const input = { owner: 'Owner', reason: '', compensatingControl: 'Control', expiresOn: '2026-12-20' };
      expect(() => appendWaiver(ledger, input, finding, context)).toThrow(LedgerError);
    });

    it('rejects empty compensatingControl', () => {
      const ledger = emptyLedger();
      const input = { owner: 'Owner', reason: 'Reason', compensatingControl: '', expiresOn: '2026-12-20' };
      expect(() => appendWaiver(ledger, input, finding, context)).toThrow(LedgerError);
    });

    it('rejects expiry date before decision date', () => {
      const ledger = emptyLedger();
      const input = { owner: 'Owner', reason: 'Reason', compensatingControl: 'Control', expiresOn: '2026-11-10' };
      expect(() => appendWaiver(ledger, input, finding, context)).toThrow(LedgerError);
    });

    it('rejects a waiver with no expiry date (the "(no expiry)" path is gone)', () => {
      const ledger = emptyLedger();
      // R8.1 as the submission text reads it: reason, expiry and compensating control are required.
      const input = { owner: 'Owner', reason: 'Reason', compensatingControl: 'Control' } as unknown as Parameters<typeof appendWaiver>[1];
      expect(() => appendWaiver(ledger, input, finding, context)).toThrow(/expiresOn is required/);
      const blank = { owner: 'Owner', reason: 'Reason', compensatingControl: 'Control', expiresOn: '   ' };
      expect(() => appendWaiver(ledger, blank, finding, context)).toThrow(LedgerError);
      const notADate = { owner: 'Owner', reason: 'Reason', compensatingControl: 'Control', expiresOn: 'next month' };
      expect(() => appendWaiver(ledger, notADate, finding, context)).toThrow(LedgerError);
    });

    it('does not mutate the original ledger on error', () => {
      const ledger = emptyLedger();
      const input = { owner: '', reason: 'Test', compensatingControl: 'Control', expiresOn: '2026-12-20' };
      try {
        appendWaiver(ledger, input, finding, context);
      } catch (error) {
        // Expected
      }
      expect(ledger.entries).toHaveLength(0);
    });
  });

  describe('R8.3 - ledger verification', () => {
    it('verifies an empty ledger as OK', () => {
      const ledger = emptyLedger();
      const result = verifyLedger(ledger);
      expect(result.ok).toBe(true);
      expect(result.firstInvalidSeq).toBeNull();
    });

    it('verifies a single waiver entry', () => {
      let ledger = emptyLedger();
      const finding = mockFinding('TEST', 1);
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-12-20' };
      ledger = appendWaiver(ledger, input, finding, mockContext());

      const result = verifyLedger(ledger);
      expect(result.ok).toBe(true);
    });

    it('detects a tampered reason in an entry', () => {
      let ledger = emptyLedger();
      const finding = mockFinding('TEST', 1);
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-12-20' };
      ledger = appendWaiver(ledger, input, finding, mockContext());

      // Tamper with the reason
      ledger.entries[0]!.reason = 'TAMPERED';
      const result = verifyLedger(ledger);
      expect(result.ok).toBe(false);
      expect(result.firstInvalidSeq).toBe(1);
    });

    it('detects a broken prevHash link', () => {
      let ledger = emptyLedger();
      const finding = mockFinding('TEST', 1);
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-12-20' };
      ledger = appendWaiver(ledger, input, finding, mockContext());

      // Add a second entry
      ledger = appendWaiver(ledger, input, mockFinding('TEST2', 2), mockContext());

      // Tamper with the prevHash of the second entry
      ledger.entries[1]!.prevHash = 'BROKEN';
      const result = verifyLedger(ledger);
      expect(result.ok).toBe(false);
      expect(result.firstInvalidSeq).toBe(2);
    });

    it('refuses to classify findings from a corrupted ledger', () => {
      let ledger = emptyLedger();
      const finding = mockFinding('TEST', 1);
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-12-20' };
      ledger = appendWaiver(ledger, input, finding, mockContext());

      // Tamper
      ledger.entries[0]!.hash = 'TAMPERED';

      expect(() => classify([finding], ledger, '2026-11-20')).toThrow(LedgerError);
    });
  });

  describe('R8.4 - status classification', () => {
    const finding = mockFinding('CONTROL_TOTAL_MISMATCH', 5, 'AMOUNT');

    it('classifies a finding with no waiver as OPEN', () => {
      const ledger = emptyLedger();
      const result = classify([finding], ledger, '2026-11-20');
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.status).toBe('OPEN');
      expect(result.counts.OPEN).toBe(1);
      expect(result.unadjudicated).toBe(1);
    });

    it('classifies a waived finding as WAIVED when expiry covers the date', () => {
      let ledger = emptyLedger();
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-12-20' };
      ledger = appendWaiver(ledger, input, finding, mockContext());

      const result = classify([finding], ledger, '2026-11-20');
      expect(result.entries[0]!.status).toBe('WAIVED');
      expect(result.counts.WAIVED).toBe(1);
      expect(result.unadjudicated).toBe(0);
    });

    it('classifies a waived finding as EXPIRED when expiry is before the date', () => {
      let ledger = emptyLedger();
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-11-15' };
      ledger = appendWaiver(ledger, input, finding, { fingerprint: 'a'.repeat(64), decidedOn: '2026-11-10' });

      const result = classify([finding], ledger, '2026-11-20');
      expect(result.entries[0]!.status).toBe('EXPIRED');
      expect(result.counts.EXPIRED).toBe(1);
      expect(result.unadjudicated).toBe(1);
    });

    it('classifies a waived finding as WAIVED while its expiry still covers the reporting date', () => {
      let ledger = emptyLedger();
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-12-20' };
      ledger = appendWaiver(ledger, input, finding, mockContext());

      const result = classify([finding], ledger, '2026-12-01');
      expect(result.entries[0]!.status).toBe('WAIVED');
      expect(result.unadjudicated).toBe(0);
    });

    it('a waiver for one findingKey does not cover a different findingKey', () => {
      let ledger = emptyLedger();
      const f1 = mockFinding('CONTROL_TOTAL_MISMATCH', 5, 'AMOUNT');
      const f2 = mockFinding('CONTROL_COUNT_MISMATCH', 6, 'COUNT');
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-12-20' };
      ledger = appendWaiver(ledger, input, f1, mockContext());

      const result = classify([f1, f2], ledger, '2026-11-20');
      expect(result.entries[0]!.status).toBe('WAIVED');
      expect(result.entries[1]!.status).toBe('OPEN');
    });
  });

  describe('R8.5 - release', () => {
    const finding = mockFinding('TEST', 1);

    it('appends a release entry to a ledger', () => {
      let ledger = emptyLedger();
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-12-20' };
      ledger = appendWaiver(ledger, input, finding, mockContext());
      const waiverId = ledger.entries[0]!.id;

      const releaseInput = { owner: 'Alice', reason: 'Released', control: 'Confirmed' };
      ledger = appendRelease(ledger, releaseInput, waiverId);

      expect(ledger.entries).toHaveLength(2);
      const release = ledger.entries[1]!;
      expect(release.decision).toBe('released');
      expect(release.releaseOf).toBe(waiverId);
      expect(release.owner).toBe('Alice');
      expect(release.reason).toBe('Released');
      expect(release.seq).toBe(2);
    });

    it('keeps the waived entry when releasing', () => {
      let ledger = emptyLedger();
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-12-20' };
      ledger = appendWaiver(ledger, input, finding, mockContext());
      const waiverId = ledger.entries[0]!.id;

      const releaseInput = { owner: 'Alice', reason: 'Released', control: 'Confirmed' };
      ledger = appendRelease(ledger, releaseInput, waiverId);

      expect(ledger.entries[0]!.decision).toBe('waived');
      expect(ledger.entries[1]!.decision).toBe('released');
    });

    it('classifies a released waiver as RELEASED', () => {
      let ledger = emptyLedger();
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-12-20' };
      ledger = appendWaiver(ledger, input, finding, mockContext());
      const waiverId = ledger.entries[0]!.id;

      const releaseInput = { owner: 'Alice', reason: 'Released', control: 'Confirmed' };
      ledger = appendRelease(ledger, releaseInput, waiverId);

      const result = classify([finding], ledger, '2026-11-20');
      expect(result.entries[0]!.status).toBe('RELEASED');
      expect(result.counts.RELEASED).toBe(1);
      // A release puts the finding back in front of a human, so it is unadjudicated again
      // (design 13.4). The authored assertion said 0, which contradicted that sentence.
      expect(result.unadjudicated).toBe(1);
    });

    it('rejects release for a non-existent waiver', () => {
      const ledger = emptyLedger();
      const releaseInput = { owner: 'Alice', reason: 'Released', control: 'Confirmed' };
      expect(() => appendRelease(ledger, releaseInput, 'NONEXISTENT')).toThrow(LedgerError);
    });

    it('rejects empty owner on release', () => {
      let ledger = emptyLedger();
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-12-20' };
      ledger = appendWaiver(ledger, input, finding, mockContext());
      const waiverId = ledger.entries[0]!.id;

      const releaseInput = { owner: '', reason: 'Released', control: 'Confirmed' };
      expect(() => appendRelease(ledger, releaseInput, waiverId)).toThrow(LedgerError);
    });
  });

  describe('Serialization and round-trip', () => {
    it('serialises and parses an empty ledger', () => {
      const original = emptyLedger();
      const serialised = serialiseLedger(original);
      const parsed = parseLedger(serialised);
      expect(parsed).toEqual(original);
    });

    it('serialises a ledger with entries', () => {
      let ledger = emptyLedger();
      const finding = mockFinding('TEST', 1);
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-12-20' };
      ledger = appendWaiver(ledger, input, finding, mockContext());

      const serialised = serialiseLedger(ledger);
      const parsed = parseLedger(serialised);
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0]!.owner).toBe('Test');
    });

    it('rejects malformed JSON', () => {
      expect(() => parseLedger('not json')).toThrow(LedgerError);
    });

    it('rejects a ledger with wrong version', () => {
      const invalid = JSON.stringify({ version: 2, entries: [] });
      expect(() => parseLedger(invalid)).toThrow(LedgerError);
    });

    it('round-trips a ledger with waiver and release: text identity and verification', () => {
      let ledger = emptyLedger();
      const finding = mockFinding('CONTROL_TOTAL_MISMATCH', 5, 'AMOUNT');
      const waiverInput = { owner: 'Alice', reason: 'Known issue', compensatingControl: 'Manual review', expiresOn: '2026-12-20' };
      ledger = appendWaiver(ledger, waiverInput, finding, mockContext());
      const waiverId = ledger.entries[0]!.id;

      const releaseInput = { owner: 'Bob', reason: 'Corrected', control: 'Confirmed' };
      ledger = appendRelease(ledger, releaseInput, waiverId);

      // Serialise and parse back
      const text = serialiseLedger(ledger);
      const roundTripped = parseLedger(text);
      const textAgain = serialiseLedger(roundTripped);

      // Assert text identity
      expect(textAgain).toBe(text);

      // Assert verify still passes
      const verifyResult = verifyLedger(roundTripped);
      expect(verifyResult.ok).toBe(true);
      expect(verifyResult.firstInvalidSeq).toBeNull();
    });
  });

  describe('Finding key stability', () => {
    it('produces the same key for identical findings', () => {
      const f1 = mockFinding('CONTROL_TOTAL_MISMATCH', 5, 'AMOUNT');
      const f2 = mockFinding('CONTROL_TOTAL_MISMATCH', 5, 'AMOUNT');
      expect(findingKey(f1)).toBe(findingKey(f2));
    });

    it('produces different keys for different record indices', () => {
      const f1 = mockFinding('CONTROL_TOTAL_MISMATCH', 5, 'AMOUNT');
      const f2 = mockFinding('CONTROL_TOTAL_MISMATCH', 6, 'AMOUNT');
      expect(findingKey(f1)).not.toBe(findingKey(f2));
    });

    it('produces different keys for different codes', () => {
      const f1 = mockFinding('CONTROL_TOTAL_MISMATCH', 5);
      const f2 = mockFinding('CONTROL_COUNT_MISMATCH', 5);
      expect(findingKey(f1)).not.toBe(findingKey(f2));
    });
  });

  describe('Immutability', () => {
    it('does not mutate the original ledger on appendWaiver', () => {
      const original = emptyLedger();
      const finding = mockFinding('TEST', 1);
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-12-20' };
      const newLedger = appendWaiver(original, input, finding, mockContext());

      expect(original.entries).toHaveLength(0);
      expect(newLedger.entries).toHaveLength(1);
    });

    it('does not mutate the original ledger on appendRelease', () => {
      let ledger = emptyLedger();
      const finding = mockFinding('TEST', 1);
      const input = { owner: 'Test', reason: 'Test', compensatingControl: 'Test', expiresOn: '2026-12-20' };
      ledger = appendWaiver(ledger, input, finding, mockContext());
      const waiverId = ledger.entries[0]!.id;

      const original = ledger;
      const releaseInput = { owner: 'Alice', reason: 'Released', control: 'Confirmed' };
      const newLedger = appendRelease(original, releaseInput, waiverId);

      expect(original.entries).toHaveLength(1);
      expect(newLedger.entries).toHaveLength(2);
    });
  });
});

/**
 * CLI contract for the register (R8.6). Added after the authored tests: the exit code
 * is the part a CI job reads, so it is asserted at the process boundary, not only
 * through the module.
 */
describe('R8.6 - the CLI exit code follows the adjudication state', () => {
  const cliEntry = join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts');
  const tsxBin = join(import.meta.dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const root = join(import.meta.dirname, '..', '..');
  const out = join(root, '.tmp', `exception-cli-${process.pid}`);

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
    expect(built.status).toBe(2); // the report must hold findings for this test to mean anything
  });

  afterAll(() => {
    rmSync(out, { recursive: true, force: true });
  });

  const cli = (...argv: string[]) => spawnSync(process.execPath, [tsxBin, cliEntry, ...argv], { encoding: 'utf8', cwd: root });

  /** Waive every finding the report holds, so `exceptions` can reach exit 0. */
  function waiveAll(): string[] {
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as { verdict: { findings: unknown[] } };
    const ids: string[] = [];
    for (let index = 0; index < report.verdict.findings.length; index += 1) {
      const result = cli(
        'waive',
        '--report', out,
        '--index', String(index),
        '--owner', 'S. Shin (TPM)',
        '--reason', `Approved after reviewing finding ${index} against the bank statement.`,
        '--control', 'Daily suspense-account check',
        '--expires', '2026-12-31',
        '--today', '2026-11-21',
      );
      expect(result.status).toBe(0);
      ids.push(/waived: (\w+)/.exec(result.stdout)?.[1] ?? '');
    }
    return ids;
  }

  it('exits 2 while a finding is OPEN', () => {
    const before = cli('exceptions', out, '--today', '2026-11-21');
    expect(before.status).toBe(2);
    expect(before.stdout).toContain('OPEN: 4');
  });

  it('exits 0 once every finding is WAIVED, then 2 again after a release', () => {
    const ids = waiveAll();
    expect(ids.filter((id) => id.length === 16)).toHaveLength(ids.length);
    const waived = cli('exceptions', out, '--today', '2026-11-21');
    expect(waived.status).toBe(0);
    expect(waived.stdout).toContain('WAIVED: 4');

    const released = cli(
      'release',
      '--report', out,
      '--id', ids[0]!,
      '--owner', 'S. Shin (TPM)',
      '--reason', 'Corrected trailer received from the payment team.',
      '--control', 'Trailer re-issued by the payment team',
      '--today', '2026-11-22',
    );
    expect(released.status).toBe(0);
    const after = cli('exceptions', out, '--today', '2026-11-22');
    expect(after.status).toBe(2);
    expect(after.stdout).toContain('RELEASED: 1');
  });

  it('exits 3 when the ledger was edited after the fact', () => {
    const path = join(out, 'ledger.json');
    const ledger = JSON.parse(readFileSync(path, 'utf8')) as { entries: Array<{ reason: string }> };
    ledger.entries[0]!.reason = 'rewritten later';
    writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
    const result = cli('exceptions', out, '--today', '2026-11-22');
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('hash mismatch at seq 1');
  });

  it('exits 3 when a waiver is attempted without an expiry date', () => {
    rmSync(join(out, 'ledger.json'), { force: true });
    const result = cli(
      'waive',
      '--report', out,
      '--index', '0',
      '--owner', 'S. Shin (TPM)',
      '--reason', 'Accepted for now.',
      '--control', 'Daily suspense-account check',
      '--today', '2026-11-21',
    );
    // Exit 3, not 2: nothing was decided, which is what ERROR means in this CLI.
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('--expires');
    expect(result.stderr).toContain('required');

    const notADate = cli('waive', '--report', out, '--index', '0', '--owner', 'S. Shin (TPM)', '--reason', 'Accepted for now.', '--control', 'Daily suspense-account check', '--expires', '2026-13-01', '--today', '2026-11-21');
    expect(notADate.status).toBe(3);
    expect(notADate.stderr).toContain('YYYY-MM-DD');
  });

  it('an expiry before the reporting date reads EXPIRED and does not count as waived', () => {
    rmSync(join(out, 'ledger.json'), { force: true });
    const result = cli(
      'waive',
      '--report', out,
      '--index', '0',
      '--owner', 'S. Shin (TPM)',
      '--reason', 'Temporary acceptance while the bank re-issues the trailer.',
      '--control', 'Daily suspense-account check',
      '--expires', '2026-11-30',
      '--today', '2026-11-21',
    );
    expect(result.status).toBe(0);
    const later = cli('exceptions', out, '--today', '2026-12-01');
    expect(later.status).toBe(2);
    expect(later.stdout).toContain('EXPIRED: 1');
  });
});
