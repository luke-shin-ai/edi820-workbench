/**
 * The guarantee strip - read from `docs/guarantees.md`, not restated in code.
 *
 * R6.3 says the report lists what it guarantees and what it does not, referencing
 * that document. Parsing the document means the CLI and the web screen cannot
 * drift from the file a reviewer reads.
 */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, sep } from 'node:path';
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
    'The ANSI X12 transaction set - the input is a positional file with its copybook or a BAI2 statement; a delimited X12 transaction set is not parsed.',
    'An immutable history - the register chain detects an edited, reordered or truncated entry, but it has no external anchor, so a full rewrite verifies.',
  ],
  sourcePath: '(built-in copy of docs/guarantees.md)',
};

export function guaranteesPath(): string {
  return fileURLToPath(new URL('../../docs/guarantees.md', import.meta.url));
}

/**
 * The path as it is printed and recorded: project-relative when the file is inside the project.
 *
 * `report.json` is committed as evidence, so an absolute path there would publish the home
 * directory of whoever ran the command. The fallback copy keeps its description, which is
 * already relative.
 */
function displayPath(path: string): string {
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const rel = relative(root, path);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return path;
  return rel.split(sep).join('/');
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
  if (guaranteed.length === 0 || notGuaranteed.length === 0) return { ...FALLBACK, sourcePath: displayPath(path) };
  return { guaranteed, notGuaranteed, sourcePath: displayPath(path) };
}
