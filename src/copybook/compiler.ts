/**
 * Copybook compiler - text copybook -> `Copybook` model with byte offsets.
 *
 * Supported dialect (documented in `docs/copybook-dialect.md`):
 *   01  RECORD-NAME.
 *       05  FIELD-NAME   PIC <picture> [SIGN <convention>] [USAGE <usage>] [POSITION <n>].
 *       05  GROUP-NAME.
 *       05  VIEW-NAME    REDEFINES OTHER-NAME.
 *      * @semantics amount=... currency=... valueDate=... ...
 *      * @control  typeField=... trailerValue=... countField=... totalField=...
 *      * @framing  line | fixed
 *      * @view     layout=VIEW-NAME typeField=... value=...
 *
 * `REDEFINES` is supported as a *view over shared bytes*, not as a guess. The clause
 * says that two layouts describe the same byte range (a payment detail and the trailer
 * that closes the file, typically). The copybook must also say which record type makes
 * a layout the active one, with one `* @view` directive per layout; a `REDEFINES` with
 * no activation rule is refused rather than read as whichever layout happens to fit.
 *
 * Anything outside this dialect fails loudly (`COPYBOOK_UNPARSABLE`,
 * `UNSUPPORTED_STRUCTURE`, `COPYBOOK_REDEFINES`). The compiler never skips a line it
 * does not understand: a copybook is a contract, and a silent skip is a silent lie.
 */
import {
  CopybookError,
  type ControlSpec,
  type Copybook,
  type CopybookField,
  type CopybookSemantics,
  type CopybookView,
  type Framing,
  type SignConvention,
  type Usage,
} from './types.js';

interface Picture {
  kind: 'string' | 'numeric';
  /** Bytes for a `PIC X(n)` field. */
  stringLength: number;
  signed: boolean;
  digits: number;
  decimals: number;
}

const FIELD_RE = /^\s*(\d{1,2})\s+([A-Z0-9][A-Z0-9_-]*)\s+(.*)$/;
const NO_PIC_RE = /^\s*(\d{1,2})\s+([A-Z0-9][A-Z0-9_-]*)\.?\s*$/;
const NAME_RE = /^[A-Z0-9][A-Z0-9_-]*$/;

function fail(message: string, line: number, code: 'COPYBOOK_UNPARSABLE' | 'UNSUPPORTED_STRUCTURE' = 'COPYBOOK_UNPARSABLE'): never {
  throw new CopybookError(code, `${message} (copybook line ${line})`, { line });
}

function readCount(pic: string, at: number): { count: number; next: number } {
  if (pic[at] !== '(') return { count: 1, next: at };
  const close = pic.indexOf(')', at);
  if (close < 0) return { count: 1, next: at };
  const raw = pic.slice(at + 1, close);
  if (!/^\d+$/.test(raw)) return { count: 1, next: at };
  const count = Number(raw);
  return { count, next: close + 1 };
}

/** Parse the `PIC` clause body into a normalised picture. */
export function parsePicture(raw: string, line: number): Picture {
  const pic = raw.replace(/\s+/g, '').toUpperCase().replace(/\.$/, '');
  if (pic.length === 0) fail('empty PICTURE clause', line);

  let i = 0;
  let signed = false;
  if (pic[i] === 'S') {
    signed = true;
    i += 1;
  }

  let stringLength = 0;
  let digits = 0;
  let decimals = 0;
  let inDecimals = false;
  let sawX = false;
  let saw9 = false;

  while (i < pic.length) {
    const ch = pic[i]!;
    if (ch === 'X') {
      if (signed) fail(`a signed PICTURE cannot be alphabetic: ${raw}`, line);
      if (inDecimals) fail(`implied decimals require a numeric PICTURE: ${raw}`, line);
      sawX = true;
      const { count, next } = readCount(pic, i + 1);
      if (count < 1) fail(`invalid PICTURE repeat count in ${raw}`, line);
      stringLength += count;
      i = next;
    } else if (ch === '9') {
      saw9 = true;
      const { count, next } = readCount(pic, i + 1);
      if (count < 1) fail(`invalid PICTURE repeat count in ${raw}`, line);
      if (inDecimals) decimals += count;
      else digits += count;
      i = next;
    } else if (ch === 'V') {
      if (inDecimals) fail(`duplicate V in PICTURE ${raw}`, line);
      inDecimals = true;
      i += 1;
    } else {
      fail(`unsupported PICTURE symbol "${ch}" in ${raw}`, line);
    }
  }

  if (sawX && saw9) fail(`mixed alphabetic/numeric PICTURE ${raw}`, line);
  if (sawX) return { kind: 'string', stringLength: stringLength || 1, signed: false, digits: 0, decimals: 0 };
  if (!saw9) fail(`no data characters in PICTURE ${raw}`, line);
  return { kind: 'numeric', stringLength: 0, signed, digits, decimals };
}

interface ClauseResult {
  sign?: SignConvention;
  usage: Usage;
  position?: number;
  redefines?: string;
}

const REDEFINES_RE = /\sREDEFINES\s+(?:IS\s+)?([A-Z0-9][A-Z0-9_-]*)\b/i;

/**
 * Interpret the clauses that may follow a group item's name.
 *
 * A group has no picture, so it has no sign, usage or decimal rule; it may only be
 * redefined (or redefine another item). Everything else is a line the compiler does
 * not understand, and it says so.
 */
function parseGroupClauses(raw: string, line: number): { redefines?: string } {
  let rest = ` ${raw.replace(/\s+/g, ' ').trim()} `;
  let redefines: string | undefined;
  const match = REDEFINES_RE.exec(rest);
  if (match) {
    redefines = (match[1] ?? '').toUpperCase();
    rest = rest.replace(REDEFINES_RE, ' ');
  }
  rest = rest.trim().replace(/\.$/, '').trim();
  if (rest.length > 0) fail(`unrecognised clause "${rest}" on a group item`, line);
  return { ...(redefines ? { redefines } : {}) };
}

/** Interpret everything after the picture (SIGN, USAGE, POSITION, REDEFINES, unsupported). */
function parseClauses(raw: string, line: number): ClauseResult {
  let rest = ` ${raw.replace(/\s+/g, ' ').trim()} `;
  const result: ClauseResult = { usage: 'display' };

  const redefinesMatch = REDEFINES_RE.exec(rest);
  if (redefinesMatch) {
    result.redefines = (redefinesMatch[1] ?? '').toUpperCase();
    rest = rest.replace(REDEFINES_RE, ' ');
  }

  const unsupported: Array<[RegExp, string]> = [
    [/\sOCCURS\b/i, 'OCCURS (fixed or DEPENDING ON)'],
    [/\s(COMP|COMPUTATIONAL|COMP-1|COMP-2|COMPUTATIONAL-1|COMPUTATIONAL-2|BINARY|INDEX)(?![0-9-])/i, 'binary COMP usage'],
  ];

  // `USAGE IS <token>` first, so that `USAGE COMP-3` is not mistaken for `USAGE COMP`.
  const usageRe = /\sUSAGE\s+(?:IS\s+)?(DISPLAY|COMP-3|COMPUTATIONAL-3|PACKED-DECIMAL|COMP|COMPUTATIONAL|BINARY|COMP-1|COMP-2)\b/i;
  const usageMatch = usageRe.exec(rest);
  if (usageMatch) {
    const token = (usageMatch[1] ?? '').toUpperCase();
    if (token === 'DISPLAY') result.usage = 'display';
    else if (token === 'COMP-3' || token === 'COMPUTATIONAL-3' || token === 'PACKED-DECIMAL') result.usage = 'comp-3';
    else {
      throw new CopybookError('UNSUPPORTED_STRUCTURE', `USAGE ${token} is outside the supported copybook dialect (copybook line ${line})`, { line });
    }
    rest = rest.replace(usageRe, ' ');
  }

  for (const [re, label] of unsupported) {
    if (re.test(rest)) {
      throw new CopybookError('UNSUPPORTED_STRUCTURE', `${label} is outside the supported copybook dialect (copybook line ${line})`, { line });
    }
  }

  const packedRe = /\s(COMP-3|COMPUTATIONAL-3|PACKED-DECIMAL)\b/i;
  if (packedRe.test(rest)) {
    result.usage = 'comp-3';
    rest = rest.replace(packedRe, ' ');
  }

  const signRe = /\sSIGN\s+(?:IS\s+)?(LEADING|TRAILING)(?:\s+(SEPARATE|OVERPUNCH))?\b/i;
  const signMatch = signRe.exec(rest);
  if (signMatch) {
    const position = (signMatch[1] ?? '').toUpperCase();
    const kind = (signMatch[2] ?? 'SEPARATE').toUpperCase();
    if (kind === 'OVERPUNCH') {
      if (position === 'LEADING') {
        throw new CopybookError('UNSUPPORTED_STRUCTURE', `SIGN LEADING OVERPUNCH is outside the supported copybook dialect (copybook line ${line})`, { line });
      }
      result.sign = 'trailing-overpunch';
    } else {
      result.sign = position === 'LEADING' ? 'leading-separate' : 'trailing-separate';
    }
    rest = rest.replace(signRe, ' ');
  } else if (/\sSIGN\b/i.test(rest)) {
    fail('SIGN clause without LEADING/TRAILING is ambiguous', line);
  }

  const positionRe = /\s(?:POSITION|OFFSET)\s+(?:IS\s+)?(\d+)\b/i;
  const positionMatch = positionRe.exec(rest);
  if (positionMatch) {
    result.position = Number(positionMatch[1]);
    if (result.position < 1) fail('POSITION must be 1-based', line);
    rest = rest.replace(positionRe, ' ');
  }

  // A stray VALUE clause on a group/level-88 line is meaningless here; anything
  // else left over means we did not understand the line.
  rest = rest.replace(/\sVALUE\s+(?:IS\s+)?.+$/i, ' ').replace(/\sPLAY\s+IS\s+\S+/i, ' ');
  rest = rest.trim().replace(/\.$/, '').trim();
  if (rest.length > 0) fail(`unrecognised clause "${rest}"`, line);

  return result;
}

function directiveValues(body: string, line: number, allowBare = false): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of body.trim().split(/\s+/)) {
    if (!token) continue;
    const eq = token.indexOf('=');
    if (eq <= 0) {
      if (allowBare) {
        out[''] = token;
        continue;
      }
      fail(`directive flag "${token}" is not key=value`, line);
    }
    out[token.slice(0, eq).toLowerCase()] = token.slice(eq + 1);
  }
  return out;
}

/** Byte width of a numeric picture - the only place byte widths are decided. */
export function numericWidth(picture: Picture, usage: Usage, sign: SignConvention | undefined): number {
  const digitCount = picture.digits + picture.decimals;
  if (usage === 'comp-3') return Math.ceil((digitCount + 1) / 2);
  const separate = sign === 'leading-separate' || sign === 'trailing-separate' ? 1 : 0;
  return digitCount + separate;
}

/** One shared byte range: the redefined item plus every item that redefines it. */
interface Region {
  name: string;
  start: number;
  length: number;
  layouts: Map<string, string[]>;
}

/** A group item that is still open, so its width is not known yet. */
interface Frame {
  name: string;
  level: number;
  start: number;
  group: CopybookField;
  region?: string;
  layout?: string;
  /** Exclusive end of the region this frame redefines, if it is a view root. */
  regionEnd?: number;
}

export function compileCopybook(text: string): Copybook {
  // EBCDIC source is not ASCII transliteration: detecting it at the door is honest,
  // decoding it field by field would be a guess.
  if (/[\u0080-\u00ff]/.test(text)) {
    throw new CopybookError(
      'UNSUPPORTED_STRUCTURE',
      'this copybook contains non-ASCII bytes, so it is probably EBCDIC; 「820」 reads ASCII transliterations only',
    );
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const fields: CopybookField[] = [];
  const notes: string[] = [];
  const semantics: CopybookSemantics = {};
  const regions = new Map<string, Region>();
  const viewRules = new Map<string, { typeField: string; values: string[] }>();
  let control: ControlSpec | undefined;
  let framing: Framing = 'line';
  let recordName = '';

  const frames: Frame[] = [];
  let cursor = 1;

  const closeFrames = (level: number) => {
    while (frames.length > 0 && frames[frames.length - 1]!.level >= level) {
      const frame = frames.pop()!;
      const contentLength = cursor - frame.start;
      if (contentLength < 1) {
        throw new CopybookError(
          'COPYBOOK_REDEFINES',
          `group item ${frame.name} declares no fields, so its width is zero (copybook line ${frame.group.line})`,
          { line: frame.group.line, fields: [frame.name] },
        );
      }
      frame.group.length = contentLength;
      if (frame.regionEnd !== undefined) {
        if (contentLength > frame.regionEnd - frame.start) {
          throw new CopybookError(
            'COPYBOOK_REDEFINES',
            `${frame.name} is ${contentLength} bytes, wider than the ${frame.regionEnd - frame.start} bytes it redefines (copybook line ${frame.group.line})`,
            { line: frame.group.line, fields: [frame.name] },
          );
        }
        cursor = Math.max(cursor, frame.regionEnd);
      }
    }
  };

  const registerInLayout = (regionName: string, layoutName: string, fieldName: string) => {
    const region = regions.get(regionName)!;
    const list = region.layouts.get(layoutName);
    if (list) list.push(fieldName);
    else region.layouts.set(layoutName, [fieldName]);
  };

  /**
   * Open (or join) the region that `redefines` names, and mark every field already
   * inside that byte range as the first layout of the region.
   */
  const regionFor = (redefined: CopybookField, line: number): Region => {
    const existing = regions.get(redefined.name);
    if (existing) return existing;
    const region: Region = { name: redefined.name, start: redefined.start, length: redefined.length, layouts: new Map() };
    regions.set(redefined.name, region);
    const rangeStart = redefined.start;
    const rangeEnd = redefined.start + redefined.length;
    for (const field of fields) {
      // A group that is still open has no width yet, and a group that merely contains
      // the redefined item is not one of its layouts.
      if (field.group && frames.some((frame) => frame.name === field.name)) continue;
      const enclosingGroup =
        field.group === true && field.name !== redefined.name && field.start <= rangeStart && field.start + field.length >= rangeEnd;
      if (enclosingGroup) continue;
      if (field.start >= rangeStart && field.start + field.length <= rangeEnd) {
        // An inner region keeps its own membership; `??=` is the nesting rule.
        field.region ??= redefined.name;
        field.layout ??= redefined.name;
        if (field.region === redefined.name) registerInLayout(redefined.name, redefined.name, field.name);
      }
    }
    if (!region.layouts.has(redefined.name)) {
      throw new CopybookError(
        'COPYBOOK_REDEFINES',
        `REDEFINES ${redefined.name} names an item with no fields inside it (copybook line ${line})`,
        { line },
      );
    }
    return region;
  };

  const directiveValuesFor = (name: string, body: string, line: number) =>
    directiveValues(body, line, name.toLowerCase() === 'framing');

  lines.forEach((lineText, idx) => {
    const line = idx + 1;
    const trimmed = lineText.trim();
    if (trimmed.length === 0) return;

    if (trimmed.startsWith('*')) {
      const body = trimmed.slice(1).trim();
      if (!body.startsWith('@')) return;
      const [name = '', ...rest] = body.split(/\s+/);
      const values = directiveValuesFor(name.slice(1), rest.join(' '), line);
      switch (name.slice(1).toLowerCase()) {
        case 'semantics': {
          if (values.amount) semantics.amount = values.amount.toUpperCase();
          if (values.currency) semantics.currency = values.currency.toUpperCase();
          if (values.valuedate) semantics.valueDate = values.valuedate.toUpperCase();
          if (values.dateformat) {
            const fmt = values.dateformat.toUpperCase();
            if (fmt !== 'CCYYMMDD' && fmt !== 'YYMMDD') fail(`unsupported dateFormat ${values.dateformat} (use CCYYMMDD or YYMMDD)`, line);
            semantics.dateFormat = fmt;
          }
          if (values.reference) semantics.reference = values.reference.toUpperCase();
          if (values.transactiontype) semantics.transactionType = values.transactiontype.toUpperCase();
          if (values.creditvalue) semantics.creditValue = values.creditvalue;
          if (values.debitvalue) semantics.debitValue = values.debitvalue;
          return;
        }
        case 'control': {
          const typeField = values.typefield?.toUpperCase();
          const trailerValue = values.trailervalue;
          if (!typeField || trailerValue === undefined) fail('@control requires typeField and trailerValue', line);
          control = {
            typeField,
            trailerValue,
            ...(values.countfield ? { countField: values.countfield.toUpperCase() } : {}),
            ...(values.totalfield ? { totalField: values.totalfield.toUpperCase() } : {}),
            ...(values.currencyfield ? { currencyField: values.currencyfield.toUpperCase() } : {}),
          };
          return;
        }
        case 'framing': {
          const mode = (values.mode ?? values[''] ?? rest.join(' ')).trim().toLowerCase();
          if (mode !== 'line' && mode !== 'fixed') fail(`@framing must be line or fixed, got "${mode}"`, line);
          framing = mode;
          return;
        }
        case 'view': {
          const layout = values.layout?.toUpperCase();
          const typeField = (values.typefield ?? values.discriminator)?.toUpperCase();
          const rawValues = values.value ?? values.values;
          if (!layout || !typeField || rawValues === undefined) {
            fail('@view requires layout, typeField and value (e.g. `@view layout=TRAILER typeField=REC-TYPE value=T`)', line);
          }
          const list = rawValues
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
          if (list.length === 0) fail(`@view ${layout} declares no value`, line);
          viewRules.set(layout, { typeField, values: list });
          return;
        }
        default:
          notes.push(`copybook line ${line}: directive @${name.slice(1)} ignored`);
          return;
      }
    }

    const hasPic = /PIC\s+/i.test(lineText);
    let level: number;
    let name: string;
    let remainder = '';
    let clauses: ClauseResult = { usage: 'display' };

    const bare = hasPic ? null : NO_PIC_RE.exec(lineText);
    if (bare) {
      level = Number(bare[1]);
      name = bare[2]!;
      if (level === 1) {
        recordName = name;
        return;
      }
      if (level === 88) return;
      // A group item with no clauses.
    } else {
      const match = FIELD_RE.exec(lineText);
      if (!match) fail(`line is not a field definition: "${lineText.trim()}"`, line);
      level = Number(match[1]);
      name = match[2]!;
      remainder = match[3]!;
      if (!NAME_RE.test(name)) fail(`invalid field name "${name}"`, line);
      if (!hasPic) {
        const groupClauses = parseGroupClauses(remainder, line);
        clauses = { usage: 'display', ...groupClauses };
      }
    }

    closeFrames(level);

    let picture: Picture | undefined;
    if (hasPic) {
      const picIndex = remainder.search(/PIC\s+/i);
      if (picIndex < 0) fail(`field ${name} has no PIC clause`, line);
      const afterPic = remainder.slice(picIndex).replace(/^PIC\s+/i, '');
      const picTokenMatch = /^(\S+?)\.?(\s|$)/.exec(afterPic);
      if (!picTokenMatch) fail(`field ${name} has an empty PIC clause`, line);
      const picToken = (picTokenMatch[1] ?? '').replace(/\.$/, '');
      picture = parsePicture(picToken, line);
      clauses = parseClauses(afterPic.slice(picTokenMatch[0]!.length), line);
      if (picture.kind === 'string' && clauses.usage === 'comp-3') fail(`COMP-3 requires a numeric PICTURE (field ${name})`, line);
      if (picture.kind === 'string' && clauses.sign) fail(`SIGN requires a numeric PICTURE (field ${name})`, line);
      if (picture.kind === 'numeric' && clauses.usage === 'display' && (picture.signed || clauses.sign) && !clauses.sign) {
        fail(`signed field ${name} must declare its sign convention (SIGN LEADING/ TRAILING SEPARATE or SIGN TRAILING OVERPUNCH)`, line);
      }
    }

    // REDEFINES: the item shares the byte range of an item declared earlier.
    let redefined: CopybookField | undefined;
    if (clauses.redefines) {
      redefined = fields.find((field) => field.name === clauses.redefines);
      if (!redefined) {
        throw new CopybookError(
          'COPYBOOK_REDEFINES',
          `REDEFINES names ${clauses.redefines}, which is not declared before this line (copybook line ${line})`,
          { line },
        );
      }
      if (redefined.level !== level) {
        throw new CopybookError(
          'COPYBOOK_REDEFINES',
          `REDEFINES ${redefined.name} must be at the same level-number (${redefined.level}), not ${level} (copybook line ${line})`,
          { line, fields: [redefined.name, name] },
        );
      }
      if (frames.some((frame) => frame.name === redefined!.name)) {
        throw new CopybookError(
          'COPYBOOK_REDEFINES',
          `REDEFINES ${redefined.name} names a group that is still open, so its width is not known yet (copybook line ${line})`,
          { line, fields: [redefined.name, name] },
        );
      }
      if (redefined.length < 1) {
        throw new CopybookError(
          'COPYBOOK_REDEFINES',
          `REDEFINES ${redefined.name} names an item with no width (copybook line ${line})`,
          { line },
        );
      }
      regionFor(redefined, line);
    }

    const parent = frames[frames.length - 1];
    const start = clauses.position ?? (redefined ? redefined.start : cursor);
    if (!hasPic && clauses.position !== undefined) fail(`group item ${name} cannot declare POSITION`, line);

    if (!picture) {
      const group: CopybookField = {
        name,
        level,
        start,
        length: 0,
        type: 'string',
        pic: 'GROUP',
        signed: false,
        usage: 'display',
        explicitPosition: false,
        line,
        group: true,
        ...(redefined ? { redefines: redefined.name } : {}),
      };
      if (redefined) {
        group.region = redefined.name;
        group.layout = name;
      } else if (parent?.region) {
        group.region = parent.region;
        group.layout = parent.layout;
      }
      if (group.region) registerInLayout(group.region, group.layout!, name);
      fields.push(group);
      cursor = start;
      frames.push({
        name,
        level,
        start,
        group,
        ...(group.region ? { region: group.region, layout: group.layout } : {}),
        ...(redefined ? { regionEnd: redefined.start + redefined.length } : {}),
      });
      return;
    }

    const signed = picture.signed || clauses.sign !== undefined;
    const usage = clauses.usage;
    let type: CopybookField['type'];
    if (name === 'FILLER') type = 'filler';
    else if (picture.kind === 'string') type = 'string';
    else if (usage === 'comp-3') type = 'packed-decimal';
    else if (clauses.sign === 'trailing-overpunch') type = 'zoned-decimal';
    else if (signed) type = 'signed-int';
    else if (picture.decimals > 0) type = 'implied-decimal';
    else type = 'unsigned-int';

    const length =
      picture.kind === 'string' ? picture.stringLength : numericWidth(picture, usage, clauses.sign);

    if (redefined && length > redefined.length) {
      throw new CopybookError(
        'COPYBOOK_REDEFINES',
        `${name} is ${length} bytes, wider than the ${redefined.length} bytes it redefines (${redefined.name}) (copybook line ${line})`,
        { line, fields: [redefined.name, name] },
      );
    }

    const normalisedPic = picture.kind === 'string'
      ? `X(${picture.stringLength})`
      : `${picture.signed ? 'S' : ''}9(${picture.digits})${picture.decimals > 0 ? `V${'9'.repeat(picture.decimals)}` : ''}`;

    const field: CopybookField = {
      name,
      level,
      start,
      length,
      type,
      pic: normalisedPic,
      ...(picture.kind === 'numeric' ? { digits: picture.digits, decimals: picture.decimals } : {}),
      signed,
      ...(clauses.sign ? { sign: clauses.sign } : {}),
      usage,
      explicitPosition: clauses.position !== undefined,
      line,
      ...(redefined ? { redefines: redefined.name } : {}),
    };
    if (redefined) {
      field.region = redefined.name;
      field.layout = name;
    } else if (parent?.region) {
      field.region = parent.region;
      field.layout = parent.layout;
    }
    if (field.region) registerInLayout(field.region, field.layout!, field.name);
    fields.push(field);

    cursor = start + length;
    if (redefined) cursor = redefined.start + redefined.length;
  });

  closeFrames(0);

  if (!fields.some((field) => !field.group)) {
    throw new CopybookError('COPYBOOK_UNPARSABLE', 'copybook declares no fields');
  }

  // Overlap (R1.5) - explicit POSITION makes this reachable, so it is checked, not
  // assumed. Two layouts of one region share the same bytes on purpose; any other
  // overlap is a contract that contradicts itself.
  const leaves = fields.filter((field) => !field.group);
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i]!;
      const b = leaves[j]!;
      const overlaps = a.start < b.start + b.length && b.start < a.start + a.length;
      if (!overlaps) continue;
      const sharedRegion =
        a.region !== undefined && a.region === b.region && a.layout !== b.layout;
      if (sharedRegion) continue;
      throw new CopybookError(
        'COPYBOOK_OVERLAP',
        `fields ${a.name} (bytes ${a.start}-${a.start + a.length - 1}) and ${b.name} (bytes ${b.start}-${b.start + b.length - 1}) overlap (copybook line ${b.line})`,
        { line: b.line, fields: [a.name, b.name] },
      );
    }
  }

  // Gaps: bytes no field covers. Views make the union of intervals necessary -
  // a byte covered by one layout is covered.
  const intervals = fields
    .map((field) => [field.start, field.start + field.length - 1] as [number, number])
    .sort((x, y) => x[0] - y[0]);
  let covered = 0;
  for (const [start, end] of intervals) {
    if (start > covered + 1) notes.push(`bytes ${covered + 1}-${start - 1} are not covered by any field`);
    covered = Math.max(covered, end);
  }

  const recordLength = Math.max(...fields.map((field) => field.start + field.length - 1));
  const fieldOf = (name: string, key: string) => {
    const field = fields.find((entry) => entry.name === name && !entry.group);
    if (!field) {
      throw new CopybookError('COPYBOOK_SEMANTICS', `@${key} names ${name}, which is not a field in this copybook`);
    }
    return field;
  };

  for (const key of ['amount', 'currency', 'valueDate', 'reference', 'transactionType'] as const) {
    const name = semantics[key];
    if (!name) continue;
    const field = fieldOf(name, `semantics ${key}`);
    if (key === 'currency' || key === 'reference' || key === 'transactionType') {
      if (field.type !== 'string') {
        throw new CopybookError('COPYBOOK_SEMANTICS', `@semantics ${key}=${name} must name an alphabetic field, but ${name} is ${field.type}`);
      }
    } else if (key === 'amount') {
      if (field.type === 'string' || field.type === 'filler') {
        throw new CopybookError('COPYBOOK_SEMANTICS', `@semantics amount=${name} must name a numeric field, but ${name} is ${field.type}`);
      }
    } else if (field.type === 'string' || field.type === 'filler') {
      throw new CopybookError('COPYBOOK_SEMANTICS', `@semantics valueDate=${name} must name a numeric field, but ${name} is ${field.type}`);
    }
  }

  if (control) {
    const typeField = fieldOf(control.typeField, 'control typeField');
    if (typeField.type !== 'string') {
      throw new CopybookError('COPYBOOK_SEMANTICS', `@control typeField=${control.typeField} must be alphabetic`);
    }
    if (control.countField) fieldOf(control.countField, 'control countField');
    if (control.totalField) fieldOf(control.totalField, 'control totalField');
    if (control.currencyField) fieldOf(control.currencyField, 'control currencyField');
  }

  // Every layout of a REDEFINES region must say how it is activated.
  const views: CopybookView[] = [];
  for (const region of regions.values()) {
    for (const [layoutName, layoutFieldNames] of region.layouts) {
      const rule = viewRules.get(layoutName);
      if (!rule) {
        throw new CopybookError(
          'COPYBOOK_SEMANTICS',
          `REDEFINES layout ${layoutName} has no activation rule: add '* @view layout=${layoutName} typeField=<field> value=<value>' naming the record type that selects it`,
        );
      }
      views.push({
        region: region.name,
        layout: layoutName,
        start: region.start,
        length: region.length,
        fields: [...layoutFieldNames],
        typeField: rule.typeField,
        values: rule.values,
      });
    }
  }
  if (views.length > 0) {
    for (const view of views) {
      const typeField = fields.find((field) => field.name === view.typeField && !field.group);
      if (!typeField) {
        throw new CopybookError('COPYBOOK_SEMANTICS', `@view ${view.layout} names typeField=${view.typeField}, which is not a field`);
      }
      if (typeField.type !== 'string') {
        throw new CopybookError('COPYBOOK_SEMANTICS', `@view ${view.layout} typeField=${view.typeField} must be alphabetic`);
      }
      if (typeField.region !== undefined) {
        throw new CopybookError(
          'COPYBOOK_SEMANTICS',
          `@view ${view.layout} typeField=${view.typeField} sits inside a REDEFINES region, so it cannot choose the layout`,
        );
      }
    }
    // One value must select exactly one layout per discriminator.
    const selected = new Map<string, string>();
    for (const view of views) {
      for (const value of view.values ?? []) {
        const key = `${view.typeField}\u0000${value}`;
        const previous = selected.get(key);
        if (previous && previous !== view.layout) {
          throw new CopybookError(
            'COPYBOOK_SEMANTICS',
            `@view: value ${value} of ${view.typeField} selects both ${previous} and ${view.layout}`,
          );
        }
        selected.set(key, view.layout);
      }
    }
  } else if (viewRules.size > 0) {
    const unknown = [...viewRules.keys()][0]!;
    throw new CopybookError(
      'COPYBOOK_SEMANTICS',
      `@view layout=${unknown} does not name a layout of any REDEFINES region in this copybook`,
    );
  }
  // Regions exist: every layout of the region is listed in `views`, so the parser can
  // refuse a record the discriminator does not explain.
  for (const region of regions.values()) {
    const layouts = [...region.layouts.keys()];
    if (layouts.length < 2) {
      const only = layouts[0] ?? region.name;
      throw new CopybookError(
        'COPYBOOK_REDEFINES',
        `REDEFINES region ${region.name} has one layout (${only}) and describes nothing; remove the clause or add the redefining item`,
      );
    }
  }

  if (semantics.amount && !semantics.currency) {
    notes.push('@semantics declares an amount but no currency field: amounts will carry an empty currency');
  }
  if (!semantics.amount && !semantics.reference) {
    notes.push('no @semantics amount/reference declared: this copybook parses records but cannot be reconciled');
  }
  const name = recordName || 'RECORD';
  return {
    name,
    recordLength,
    fields,
    semantics,
    ...(control ? { control } : {}),
    framing,
    ...(views.length > 0 ? { views } : {}),
    notes,
    source: text.replace(/\r\n/g, '\n'),
  };
}

export function compileCopybookFile(path: string, readFile: (p: string) => string): Copybook {
  let text: string;
  try {
    text = readFile(path);
  } catch (error) {
    throw new CopybookError('COPYBOOK_UNPARSABLE', `cannot read copybook ${path}: ${(error as Error).message}`);
  }
  return compileCopybook(text);
}
