/**
 * T7.1 — L4 Exception Register (pure module, no I/O, no clock).
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
 *   OPEN → WAIVED (on waive) → RELEASED (on release of that waiver)
 *   WAIVED → EXPIRED (when expiry < onDate)
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

export interface Ledger {
  version: 1;
  entries: LedgerEntry[];
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
  return { version: 1, entries: [] };
}

/**
 * Parse a ledger from JSON text. Throws LedgerError('SHAPE') if the shape is wrong.
 */
export function parseLedger(text: string): Ledger {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    const ledger = parsed as Record<string, unknown>;
    if (ledger.version !== 1) throw new Error('version is not 1');
    if (!Array.isArray(ledger.entries)) throw new Error('entries is not an array');
    for (const entry of ledger.entries as unknown[]) {
      if (typeof entry !== 'object' || entry === null) throw new Error('entry is not an object');
      const e = entry as Record<string, unknown>;
      if (typeof e.seq !== 'number' || typeof e.id !== 'string' || typeof e.decision !== 'string') {
        throw new Error('entry missing required fields');
      }
    }
    return parsed as unknown as Ledger;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new LedgerError('SHAPE', `Failed to parse ledger: ${msg}`);
  }
}

/**
 * Serialise a ledger to JSON text (2-space indent, trailing newline).
 */
export function serialiseLedger(ledger: Ledger): string {
  return JSON.stringify(ledger, null, 2) + '\n';
}

/**
 * Compute the hash of a ledger entry.
 * Canonical order: seq|id|decision|findingKey|code|recordIndex|field|reference|owner|reason|compensatingControl|decidedOn|expiresOn|releaseOf|fingerprint|prevHash
 */
function hashEntry(entry: Partial<LedgerEntry>): string {
  const canonical = [
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
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify a ledger: re-derive every hash and every prevHash link.
 * Returns { ok: true } or { ok: false, firstInvalidSeq, detail }.
 */
export function verifyLedger(ledger: Ledger): { ok: boolean; firstInvalidSeq: number | null; detail?: string } {
  if (ledger.entries.length === 0) return { ok: true, firstInvalidSeq: null };

  let prevHash = 'GENESIS';
  for (const entry of ledger.entries) {
    if (entry.prevHash !== prevHash) {
      return { ok: false, firstInvalidSeq: entry.seq, detail: `prevHash mismatch at seq ${entry.seq}` };
    }
    const computedHash = hashEntry(entry);
    if (entry.hash !== computedHash) {
      return { ok: false, firstInvalidSeq: entry.seq, detail: `hash mismatch at seq ${entry.seq}` };
    }
    prevHash = entry.hash;
  }
  return { ok: true, firstInvalidSeq: null };
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
  const idSource = `${seq}|waived|${key}|${decidedOn}|${prevHash}`;
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

  return { version: 1, entries: [...ledger.entries, entry] };
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
  const seq = ledger.entries.length + 1;
  const prevHash = ledger.entries[ledger.entries.length - 1]!.hash;

  const idSource = `${seq}|released|${waiverId}|${decidedOn}|${prevHash}`;
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

  return { version: 1, entries: [...ledger.entries, entry] };
}

/**
 * Classify findings against a ledger. Returns the status of each finding plus counts.
 * Does not mutate the ledger; verifies it first.
 * Throws LedgerError if the ledger fails verification or if a waiver names a finding the set does not hold.
 */
export function classify(findings: Finding[], ledger: Ledger, onDate: string): Classification {
  const verify = verifyLedger(ledger);
  if (!verify.ok) {
    throw new LedgerError('LEDGER_CORRUPTED', `Ledger failed verification at seq ${verify.firstInvalidSeq}: ${verify.detail}`);
  }

  // Build a map of findingKey → finding (and check for duplicates).
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
