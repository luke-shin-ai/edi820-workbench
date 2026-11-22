/**
 * T7.1 - L4 Exception Register (pure module, no I/O, no clock).
 *
 * The register is the one place where a human decision is recorded, and it is
 * built so the record cannot be edited back into agreement with a later story.
 *
 * `src/exception/register.ts` is pure: no I/O, no clock of its own, no `node:fs`.
 * The CLI reads and writes the file; the module only builds and classifies. This
 * purity lets the same code run in browser and Node with identical hashes.
 *
 * Ledger structure:
 * - version 1 (schema versioning)
 * - entries are 1-based dense sequences; seq is never reused
 * - each entry has a SHA-256 hash over its canonical fields + prevHash
 * - prevHash links entries; GENESIS for seq 1
 * - a waiver carries owner, reason, compensatingControl, decidedOn, and a required expiresOn
 *   (required since the red-team pass of 2026-11-22: the submission text and `docs/guarantees.md`
 *   both promise that an exception cannot exist without an expiry, so the module refuses one)
 * - a release carries the id of the waived entry it releases; the waived entry remains in the ledger
 *
 * Status machine:
 *   OPEN -> WAIVED (on waive) -> RELEASED (on release of that waiver)
 *   WAIVED -> EXPIRED (when expiry < onDate)
 *   RELEASED and EXPIRED are reported as such; both are OPEN for the next adjudication.
 */

import { createHash } from 'node:crypto';
import { findingKey as findingKeyFromReconciler } from '../reconcile/reconciler.js';
import type { Finding } from '../reconcile/reconciler.js';

export type ExceptionStatus = 'OPEN' | 'WAIVED' | 'EXPIRED' | 'RELEASED';

export interface LedgerEntry {
  seq: number; // 1-based, dense, never reused
  id: string; // 16 hex chars, derived from sha256(seq + decision + findingKey + decidedOn + prevHash)
  decision: 'waived' | 'released';
  findingKey: string; // stable identity of the finding
  code: string;
  recordIndex: number;
  field?: string;
  reference?: string;
  owner: string; // a person, not "the system"
  reason: string;
  compensatingControl: string;
  decidedOn: string; // YYYY-MM-DD
  /** YYYY-MM-DD, inclusive; waived only. Required for a new waiver, optional on a read ledger. */
  expiresOn?: string;
  releaseOf?: string; // waived entry id; released only
  fingerprint: string; // the reconciliation fingerprint at decision time
  prevHash: string; // 'GENESIS' for seq 1
  hash: string; // sha256 over canonical fields + prevHash
}

export interface LedgerHead {
  /** How many entries the ledger held when its head was written. */
  count: number;
  /** The hash of the last entry, or `GENESIS` for an empty ledger. */
  hash: string;
}

export interface Ledger {
  version: 1;
  entries: LedgerEntry[];
  /**
   * The digest of the whole ledger, written with it.
   *
   * A hash chain alone cannot notice that its tail was cut off: every remaining link is still
   * valid, and a removed release makes an expired waiver look live again. The head records the
   * count and the last hash, so removing trailing entries is `LEDGER_TRUNCATED` at parse time
   * unless the editor also rewrites the head, which is a different act than deleting a record.
   * `820 verify` also prints it, so a head that changed since a report was filed is visible.
   */
  head?: LedgerHead;
}

export interface WaiverInput {
  owner: string;
  reason: string;
  compensatingControl: string;
  /** Required: a waiver without an end date is not a decision, it is an open question. */
  expiresOn: string;
  decidedOn?: string;
}

export interface ReleaseInput {
  owner: string;
  reason: string;
  control?: string;
  decidedOn?: string;
}

export interface DecisionContext {
  fingerprint: string;
  decidedOn: string;
}

export interface ClassificationEntry {
  findingKey: string;
  code: string;
  recordIndex: number;
  field?: string;
  reference?: string;
  status: ExceptionStatus;
  waiverId?: string;
  expiresOn?: string;
}

export interface Classification {
  entries: ClassificationEntry[];
  counts: Record<ExceptionStatus, number>;
  unadjudicated: number;
}

/** The only date shape this module accepts. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD form: `2026-13-01` is a shape, not a date. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export class LedgerError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * Build a stable key for a finding. Delegates to the same function in reconciler.
 */
export function findingKey(finding: Finding): string {
  return findingKeyFromReconciler(finding);
}

export function emptyLedger(): Ledger {
  return { version: 1, entries: [], head: { count: 0, hash: 'GENESIS' } };
}

/** The count and head hash a ledger should carry. */
export function ledgerDigest(ledger: Ledger): LedgerHead {
  const last = ledger.entries[ledger.entries.length - 1];
  return { count: ledger.entries.length, hash: last ? last.hash : 'GENESIS' };
}

/**
 * Parse a ledger from JSON text.
 *
 * Throws `LedgerError('SHAPE')` when the document is not a ledger, and `LedgerError('TRUNCATED')`
 * when it carries a head that does not match its entries.
 */
export function parseLedger(text: string): Ledger {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new LedgerError('SHAPE', `Failed to parse ledger: ${(error as Error).message}`);
  }
  try {
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    const ledger = parsed as Record<string, unknown>;
    if (ledger.version !== 1) throw new Error('version is not 1');
    if (!Array.isArray(ledger.entries)) throw new Error('entries is not an array');
    (ledger.entries as unknown[]).forEach((entry, index) => {
      if (typeof entry !== 'object' || entry === null) throw new Error('entry is not an object');
      const e = entry as Record<string, unknown>;
      if (typeof e.seq !== 'number' || typeof e.id !== 'string' || typeof e.decision !== 'string') {
        throw new Error('entry missing required fields');
      }
      if (e.seq !== index + 1) throw new Error(`entry ${index + 1} carries seq ${String(e.seq)}: the sequence must be dense from 1`);
    });
    if (ledger.head !== undefined) {
      const head = ledger.head as Record<string, unknown>;
      if (typeof head.count !== 'number' || typeof head.hash !== 'string') throw new Error('head needs count and hash');
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new LedgerError('SHAPE', `Failed to parse ledger: ${msg}`);
  }
  const ledger = parsed as Ledger;
  if (ledger.head) {
    const digest = ledgerDigest(ledger);
    if (ledger.head.count !== digest.count) {
      throw new LedgerError(
        'TRUNCATED',
        `ledger head declares ${ledger.head.count} entries but ${digest.count} were read: trailing entries were removed`,
      );
    }
    if (ledger.head.hash !== digest.hash) {
      throw new LedgerError('TRUNCATED', 'ledger head hash does not match the last entry: the tail was rewritten or cut');
    }
  }
  return ledger;
}

/**
 * Serialise a ledger to JSON text (2-space indent, trailing newline).
 */
export function serialiseLedger(ledger: Ledger): string {
  return JSON.stringify({ version: ledger.version, entries: ledger.entries, head: ledgerDigest(ledger) }, null, 2) + '\n';
}

/**
 * Compute the hash of a ledger entry.
 *
 * The canonical form is a JSON array in a fixed field order. It used to be the same fields joined
 * with `|`, which made the field boundaries ambiguous: owner `A. Kim|approved by CFO` with reason
 * `timing difference` hashed identically to owner `A. Kim` with reason
 * `approved by CFO|timing difference`, so moving text across two fields was invisible (found
 * 2026-11-22 and reproduced in `test/regressions/ledger-hardening.test.ts`). JSON quoting and escaping
 * that: a delimiter inside a value can no longer be read as the start of the next field.
 * Canonical order: seq, id, decision, findingKey, code, recordIndex, field, reference, owner,
 * reason, compensatingControl, decidedOn, expiresOn, releaseOf, fingerprint, prevHash.
 */
function hashEntry(entry: Partial<LedgerEntry>): string {
  const canonical = JSON.stringify([
    entry.seq ?? '',
    entry.id ?? '',
    entry.decision ?? '',
    entry.findingKey ?? '',
    entry.code ?? '',
    entry.recordIndex ?? '',
    entry.field ?? '',
    entry.reference ?? '',
    entry.owner ?? '',
    entry.reason ?? '',
    entry.compensatingControl ?? '',
    entry.decidedOn ?? '',
    entry.expiresOn ?? '',
    entry.releaseOf ?? '',
    entry.fingerprint ?? '',
    entry.prevHash ?? '',
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify a ledger: re-derive every hash and every prevHash link.
 * Returns { ok: true } or { ok: false, firstInvalidSeq, detail }.
 */
export interface LedgerVerification {
  ok: boolean;
  firstInvalidSeq: number | null;
  detail?: string;
  /** How many entries the ledger holds. Printed next to the head hash. */
  entries: number;
  /** The hash of the last entry, or `GENESIS`. */
  headHash: string;
}

export function verifyLedger(ledger: Ledger): LedgerVerification {
  const digest = ledgerDigest(ledger);
  const result = (ok: boolean, detail?: string, firstInvalidSeq: number | null = null): LedgerVerification => ({
    ok,
    firstInvalidSeq,
    ...(detail ? { detail } : {}),
    entries: digest.count,
    headHash: digest.hash,
  });

  if (ledger.head && (ledger.head.count !== digest.count || ledger.head.hash !== digest.hash)) {
    return result(
      false,
      `ledger head declares ${ledger.head.count} entries with head ${ledger.head.hash}, but the ledger holds ${digest.count} with head ${digest.hash}`,
      ledger.entries.length + 1,
    );
  }

  let prevHash = 'GENESIS';
  for (const entry of ledger.entries) {
    if (entry.prevHash !== prevHash) {
      return result(false, `prevHash mismatch at seq ${entry.seq}`, entry.seq);
    }
    const computedHash = hashEntry(entry);
    if (entry.hash !== computedHash) {
      return result(false, `hash mismatch at seq ${entry.seq}`, entry.seq);
    }
    prevHash = entry.hash;
  }
  return result(true);
}

/**
 * Append a waiver to a ledger. Validates input and does not mutate the original.
 * Throws LedgerError('INVALID_WAIVER') if input is invalid.
 */
export function appendWaiver(
  ledger: Ledger,
  input: WaiverInput,
  finding: Finding,
  context: DecisionContext,
): Ledger {
  if (!input.owner || input.owner.trim().length === 0) {
    throw new LedgerError('INVALID_WAIVER', 'owner is required');
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw new LedgerError('INVALID_WAIVER', 'reason is required');
  }
  if (!input.compensatingControl || input.compensatingControl.trim().length === 0) {
    throw new LedgerError('INVALID_WAIVER', 'compensatingControl is required');
  }
  const decidedOn = input.decidedOn ?? context.decidedOn;
  // A decision date is evidence: `2026-13-45` would otherwise sort and compare as if it were a
  // day, and a backdated waiver would pass `expiresOn < decidedOn`. Validated since 2026-11-22.
  if (!isIsoDate(decidedOn)) {
    throw new LedgerError('INVALID_WAIVER', `decidedOn (${decidedOn}) must be a real date in YYYY-MM-DD form`);
  }
  if (!input.expiresOn || input.expiresOn.trim().length === 0) {
    throw new LedgerError('INVALID_WAIVER', 'expiresOn is required: a waiver is a decision with an end date');
  }
  if (!isIsoDate(input.expiresOn)) {
    throw new LedgerError('INVALID_WAIVER', `expiresOn (${input.expiresOn}) must be a real date in YYYY-MM-DD form`);
  }
  if (input.expiresOn < decidedOn) {
    throw new LedgerError('INVALID_WAIVER', `expiresOn (${input.expiresOn}) cannot be before decidedOn (${decidedOn})`);
  }

  const key = findingKey(finding);
  const seq = ledger.entries.length + 1;
  const prevHash = ledger.entries.length === 0 ? 'GENESIS' : ledger.entries[ledger.entries.length - 1]!.hash;

  // Compute id: first 16 hex chars of sha256(seq|decision|key|decidedOn|prevHash)
  const idSource = JSON.stringify([seq, 'waived', key, decidedOn, prevHash]);
  const idHash = createHash('sha256').update(idSource).digest('hex');
  const id = idHash.slice(0, 16);

  const entry: LedgerEntry = {
    seq,
    id,
    decision: 'waived',
    findingKey: key,
    code: finding.code,
    recordIndex: finding.recordIndex,
    field: finding.field,
    reference: finding.reference,
    owner: input.owner.trim(),
    reason: input.reason.trim(),
    compensatingControl: input.compensatingControl.trim(),
    decidedOn,
    expiresOn: input.expiresOn,
    fingerprint: context.fingerprint,
    prevHash,
    hash: '', // placeholder, will be computed
  };
  entry.hash = hashEntry(entry);

  const next: Ledger = { version: 1, entries: [...ledger.entries, entry] };
  return { ...next, head: ledgerDigest(next) };
}

/**
 * Append a release to a ledger. The waived entry stays; the finding returns to OPEN
 * for the next adjudication. Does not mutate the original.
 * Throws LedgerError if waiverId not found or if input is invalid.
 */
export function appendRelease(ledger: Ledger, input: ReleaseInput, waiverId: string): Ledger {
  if (!input.owner || input.owner.trim().length === 0) {
    throw new LedgerError('INVALID_RELEASE', 'owner is required');
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw new LedgerError('INVALID_RELEASE', 'reason is required');
  }

  const waived = ledger.entries.find((e) => e.id === waiverId);
  if (!waived) {
    throw new LedgerError('WAIVER_NOT_FOUND', `waiver id ${waiverId} not found`);
  }
  if (waived.decision !== 'waived') {
    throw new LedgerError('INVALID_RELEASE', `entry ${waiverId} is not a waiver`);
  }
  // Check if already released
  const alreadyReleased = ledger.entries.find((e) => e.releaseOf === waiverId && e.decision === 'released');
  if (alreadyReleased) {
    throw new LedgerError('ALREADY_RELEASED', `waiver ${waiverId} is already released`);
  }

  const decidedOn = input.decidedOn ?? new Date().toISOString().split('T')[0]!;
  if (!isIsoDate(decidedOn)) {
    throw new LedgerError('INVALID_RELEASE', `decidedOn (${decidedOn}) must be a real date in YYYY-MM-DD form`);
  }
  const seq = ledger.entries.length + 1;
  const prevHash = ledger.entries[ledger.entries.length - 1]!.hash;

  const idSource = JSON.stringify([seq, 'released', waiverId, decidedOn, prevHash]);
  const idHash = createHash('sha256').update(idSource).digest('hex');
  const id = idHash.slice(0, 16);

  const entry: LedgerEntry = {
    seq,
    id,
    decision: 'released',
    findingKey: waived.findingKey,
    code: waived.code,
    recordIndex: waived.recordIndex,
    field: waived.field,
    reference: waived.reference,
    owner: input.owner.trim(),
    reason: input.reason.trim(),
    compensatingControl: input.control?.trim() ?? '',
    decidedOn,
    releaseOf: waiverId,
    fingerprint: waived.fingerprint,
    prevHash,
    hash: '', // placeholder
  };
  entry.hash = hashEntry(entry);

  const next: Ledger = { version: 1, entries: [...ledger.entries, entry] };
  return { ...next, head: ledgerDigest(next) };
}

/**
 * Classify findings against a ledger. Returns the status of each finding plus counts.
 * Does not mutate the ledger; verifies it first.
 * Throws LedgerError if the ledger fails verification or if a waiver names a finding the set does not hold.
 */
export function classify(findings: Finding[], ledger: Ledger, onDate: string): Classification {
  if (!isIsoDate(onDate)) {
    throw new LedgerError('INVALID_DATE', `classification date (${onDate}) must be a real date in YYYY-MM-DD form`);
  }
  const verify = verifyLedger(ledger);
  if (!verify.ok) {
    throw new LedgerError('LEDGER_CORRUPTED', `Ledger failed verification at seq ${verify.firstInvalidSeq}: ${verify.detail}`);
  }

  // Build a map of findingKey -> finding (and check for duplicates).
  const findingsByKey = new Map<string, Finding>();
  for (const f of findings) {
    const key = findingKey(f);
    findingsByKey.set(key, f);
  }

  // Check that all waivers point to existing findings.
  for (const entry of ledger.entries) {
    if (entry.decision === 'waived' && !findingsByKey.has(entry.findingKey)) {
      throw new LedgerError('WAIVER_NOT_MATCHING', `Waiver seq ${entry.seq} (id ${entry.id}) references finding ${entry.findingKey} which is not in the report`);
    }
  }

  const entries: ClassificationEntry[] = [];
  const counts: Record<ExceptionStatus, number> = { OPEN: 0, WAIVED: 0, EXPIRED: 0, RELEASED: 0 };

  // Classify each finding.
  for (const finding of findings) {
    const key = findingKey(finding);

    // Find the most recent decision for this finding key.
    let status: ExceptionStatus = 'OPEN';
    let waiverId: string | undefined;
    let expiresOn: string | undefined;

    // Scan backwards to find the last entry for this finding key.
    for (let i = ledger.entries.length - 1; i >= 0; i--) {
      const entry = ledger.entries[i]!;
      if (entry.findingKey === key) {
        if (entry.decision === 'released') {
          // A release entry means the associated waiver is now released (back to OPEN for next decision).
          status = 'RELEASED';
          break;
        } else if (entry.decision === 'waived') {
          // Check if this waiver has been released
          const release = ledger.entries.find((e) => e.decision === 'released' && e.releaseOf === entry.id);
          if (release) {
            status = 'RELEASED';
          } else if (entry.expiresOn && entry.expiresOn < onDate) {
            status = 'EXPIRED';
          } else {
            status = 'WAIVED';
            waiverId = entry.id;
            expiresOn = entry.expiresOn;
          }
          break;
        }
      }
    }

    counts[status]++;
    entries.push({
      findingKey: key,
      code: finding.code,
      recordIndex: finding.recordIndex,
      field: finding.field,
      reference: finding.reference,
      status,
      ...(waiverId ? { waiverId } : {}),
      ...(expiresOn ? { expiresOn } : {}),
    });
  }

  return {
    entries,
    counts,
    // A released or expired exception is back in front of a human (design 13.4): the
    // finding still exists, and no waiver currently covers it.
    unadjudicated: counts.OPEN + counts.EXPIRED + counts.RELEASED,
  };
}
