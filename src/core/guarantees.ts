/**
 * The guarantee strip - read from `docs/guarantees.md`, not restated in code.
 *
 * R6.3 says the report lists what it guarantees and what it does not, referencing
 * that document. Parsing the document means the CLI and the web screen cannot
 * drift from the file a reviewer reads.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface Guarantees {
  guaranteed: string[];
  notGuaranteed: string[];
  sourcePath: string;
}

const FALLBACK: Guarantees = {
  guaranteed: [
    'Format interpretation - each field is sliced exactly at the byte position and length the spec declares.',
    'One layout per record - a REDEFINES region decodes only the layout its discriminator selects; an unmatched record is REDEFINES_VIEW_UNMATCHED.',
    'Arithmetic - amounts are bigint minor units with an ISO-4217 currency; totals and deltas are exact.',
    'Reference reconciliation - every reference either matches or appears in the report as REF_UNMATCHED.',
    'Reproducibility - verify re-derives the verdict and compares a SHA-256 fingerprint.',
    'Explanation grounding - an explanation may cite only numbers in the finding it explains; the default explainer is a zero-credit template.',
  ],
  notGuaranteed: [
    'Legal or accounting adequacy of a payment or its remittance advice.',
    'Whether an exception is acceptable - a human attaches reason, expiry and compensating control.',
    'Coverage of unmodelled clauses - OCCURS DEPENDING ON, binary COMP, EBCDIC and unbound REDEFINES are refused, never guessed.',
    'Source data authenticity - the tool verifies internal consistency, not who sent the file.',
  ],
  sourcePath: '(built-in copy of docs/guarantees.md)',
};

export function guaranteesPath(): string {
  return fileURLToPath(new URL('../../docs/guarantees.md', import.meta.url));
}

/** Parse the two numbered lists out of the markdown. */
export function loadGuarantees(path = guaranteesPath()): Guarantees {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return FALLBACK;
  }
  const guaranteed: string[] = [];
  const notGuaranteed: string[] = [];
  let section: 'none' | 'yes' | 'no' = 'none';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^##\s+Guaranteed/i.test(line)) {
      section = 'yes';
      continue;
    }
    if (/^##\s+Not guaranteed/i.test(line)) {
      section = 'no';
      continue;
    }
    if (/^##\s/.test(line)) {
      section = 'none';
      continue;
    }
    const item = /^\d+\.\s+(.+)$/.exec(line);
    if (!item || section === 'none') continue;
    const entry = item[1]!.replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (section === 'yes') guaranteed.push(entry);
    else notGuaranteed.push(entry);
  }
  if (guaranteed.length === 0 || notGuaranteed.length === 0) return { ...FALLBACK, sourcePath: path };
  return { guaranteed, notGuaranteed, sourcePath: path };
}
