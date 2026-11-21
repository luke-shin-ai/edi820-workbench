/**
 * Serialisation — the right-hand side of the round-trip property.
 *
 * `serializeParseResult` re-emits exactly the bytes that were parsed: it joins
 * the stored record slices with the file's own terminator. `encodeRecord`
 * rebuilds a record from typed values, which is what proves that *decoding did
 * not lose information* — a stronger claim than "I kept the original string".
 */
import type { Copybook } from '../copybook/types.js';
import { fromLatin1, type Bytes } from '../core/bytes.js';
import type { ParsedValue, ParseResult, TypedRecord } from './parser.js';
import { encodeField } from './encode.js';

export function serializeRecord(record: TypedRecord): string {
  return record.raw;
}

export function serializeParseResult(result: ParseResult): Bytes {
  if (result.framing === 'fixed') {
    return fromLatin1(result.records.map((r) => r.raw).join(''));
  }
  const eol = result.eol ?? '\n';
  const body = result.records.map((r) => r.raw).join(eol);
  return fromLatin1(result.trailingNewline ? `${body}${eol}` : body);
}

/** Re-encode a record from typed values (used by tests and the diff view). */
export function encodeRecord(copybook: Copybook, values: Record<string, ParsedValue>): string {
  let out = '';
  for (const field of copybook.fields) {
    out += encodeField(field, values[field.name] ?? null);
  }
  return out;
}
