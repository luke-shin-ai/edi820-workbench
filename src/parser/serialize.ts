/**
 * Serialisation — the right-hand side of the round-trip property.
 *
 * `serializeParseResult` re-emits exactly the bytes that were parsed: it joins
 * the stored record slices with the file's own terminator. `encodeRecord`
 * rebuilds a record from typed values, which is what proves that *decoding did
 * not lose information* — a stronger claim than "I kept the original string".
 */
import type { Copybook, CopybookView } from '../copybook/types.js';
import { fromLatin1, type Bytes } from '../core/bytes.js';
import type { ParsedValue, ParseResult, TypedRecord } from './parser.js';
import { encodeField } from './encode.js';
import { FieldDecodeError } from './decode.js';

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

/**
 * Which layout of each `REDEFINES` region a record's values describe.
 *
 * An explicit `__layout` value names the layout. Otherwise the layout whose
 * non-filler fields all carry a value is the only candidate; if that is ambiguous
 * the encoder says so instead of choosing.
 */
function resolveViews(copybook: Copybook, values: Record<string, ParsedValue>): Record<string, string> {
  if (!copybook.views || copybook.views.length === 0) return {};
  const regions = new Map<string, CopybookView[]>();
  for (const view of copybook.views) {
    const list = regions.get(view.region);
    if (list) list.push(view);
    else regions.set(view.region, [view]);
  }
  const forced = typeof values.__layout === 'string' ? values.__layout : undefined;
  const active: Record<string, string> = {};
  for (const [regionName, layouts] of regions) {
    if (forced) {
      const match = layouts.find((layout) => layout.layout === forced);
      if (!match) throw new FieldDecodeError(`__layout=${forced} is not a layout of the REDEFINES region ${regionName}`);
      active[regionName] = match.layout;
      continue;
    }
    const complete = layouts.filter((layout) =>
      layout.fields.every((name) => {
        const field = copybook.fields.find((entry) => entry.name === name);
        // A group owns no bytes and takes no value; a filler is written as spaces.
        if (!field || field.group || field.type === 'filler') return true;
        return values[name] !== undefined && values[name] !== null;
      }),
    );
    if (complete.length !== 1) {
      throw new FieldDecodeError(
        `cannot tell which layout of ${regionName} these values describe (${complete.map((layout) => layout.layout).join(', ') || 'none'}); pass __layout`,
      );
    }
    active[regionName] = complete[0]!.layout;
  }
  return active;
}

/** Re-encode a record from typed values (used by tests and the diff view). */
export function encodeRecord(copybook: Copybook, values: Record<string, ParsedValue>): string {
  const activeViews = resolveViews(copybook, values);
  const out: string[] = new Array(copybook.recordLength).fill(' ');
  for (const field of copybook.fields) {
    if (field.group) continue;
    if (field.region !== undefined && activeViews[field.region] !== field.layout) continue;
    const value = values[field.name] ?? null;
    if (value === null && field.type !== 'filler') {
      throw new FieldDecodeError(`${field.name}: cannot encode a null value`);
    }
    const text = encodeField(field, value);
    for (let i = 0; i < text.length; i += 1) out[field.start - 1 + i] = text[i]!;
  }
  return out.join('');
}
