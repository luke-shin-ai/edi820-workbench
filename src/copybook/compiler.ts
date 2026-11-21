/**
 * Copybook compiler — text copybook → `Copybook` model with byte offsets.
 *
 * Supported dialect (documented in `docs/copybook-dialect.md`):
 *   01  RECORD-NAME.
 *       05  FIELD-NAME   PIC <picture> [SIGN <convention>] [USAGE <usage>] [POSITION <n>].
 *      * @semantics amount=... currency=... valueDate=... ...
 *      * @control  typeField=... trailerValue=... countField=... totalField=...
 *      * @framing  line | fixed
 *
 * Anything outside this dialect fails loudly (`COPYBOOK_UNPARSABLE`,
 * `UNSUPPORTED_STRUCTURE`). The compiler never skips a line it does not
 * understand: a copybook is a contract, and a silent skip is a silent lie.
 */
import {
  CopybookError,
  type ControlSpec,
  type Copybook,
  type CopybookField,
  type CopybookSemantics,
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
}

/** Interpret everything after the picture (SIGN, USAGE, POSITION, unsupported). */
function parseClauses(raw: string, line: number): ClauseResult {
  let rest = ` ${raw.replace(/\s+/g, ' ').trim()} `;
  const result: ClauseResult = { usage: 'display' };

  const unsupported: Array<[RegExp, string]> = [
    [/\sREDEFINES\s+[A-Z0-9_-]+/i, 'REDEFINES'],
    [/\sOCCURS\s+\d+/i, 'OCCURS'],
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

/** Byte width of a numeric picture — the only place byte widths are decided. */
export function numericWidth(picture: Picture, usage: Usage, sign: SignConvention | undefined): number {
  const digitCount = picture.digits + picture.decimals;
  if (usage === 'comp-3') return Math.ceil((digitCount + 1) / 2);
  const separate = sign === 'leading-separate' || sign === 'trailing-separate' ? 1 : 0;
  return digitCount + separate;
}

export function compileCopybook(text: string): Copybook {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const fields: CopybookField[] = [];
  const notes: string[] = [];
  const semantics: CopybookSemantics = {};
  let control: ControlSpec | undefined;
  let framing: Framing = 'line';
  let recordName = '';
  let anyExplicit = false;

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
        default:
          notes.push(`copybook line ${line}: directive @${name.slice(1)} ignored`);
          return;
      }
    }

    const noPic = NO_PIC_RE.exec(lineText);
    if (noPic && !/PIC/i.test(lineText)) {
      const level = Number(noPic[1]);
      const name = noPic[2]!;
      if (level === 1) {
        recordName = name;
        return;
      }
      if (level === 88) return;
      fail(`group/section line "${lineText.trim()}" has no PIC clause`, line);
    }

    const match = FIELD_RE.exec(lineText);
    if (!match) fail(`line is not a field definition: "${lineText.trim()}"`, line);

    const level = Number(match[1]);
    const name = match[2]!;
    const remainder = match[3]!;
    if (!NAME_RE.test(name)) fail(`invalid field name "${name}"`, line);

    const picIndex = remainder.search(/PIC\s+/i);
    if (picIndex < 0) fail(`field ${name} has no PIC clause`, line);
    const afterPic = remainder.slice(picIndex).replace(/^PIC\s+/i, '');
    const picTokenMatch = /^(\S+?)\.?(\s|$)/.exec(afterPic);
    if (!picTokenMatch) fail(`field ${name} has an empty PIC clause`, line);
    const picToken = (picTokenMatch[1] ?? '').replace(/\.$/, '');
    const picture = parsePicture(picToken, line);
    const clauses = parseClauses(afterPic.slice(picTokenMatch[0]!.length), line);

    if (picture.kind === 'string' && clauses.usage === 'comp-3') fail(`COMP-3 requires a numeric PICTURE (field ${name})`, line);
    if (picture.kind === 'string' && clauses.sign) fail(`SIGN requires a numeric PICTURE (field ${name})`, line);
    if (picture.kind === 'numeric' && clauses.usage === 'display' && (picture.signed || clauses.sign) && !clauses.sign) {
      fail(`signed field ${name} must declare its sign convention (SIGN LEADING/ TRAILING SEPARATE or SIGN TRAILING OVERPUNCH)`, line);
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

    const normalisedPic = picture.kind === 'string'
      ? `X(${picture.stringLength})`
      : `${picture.signed ? 'S' : ''}9(${picture.digits})${picture.decimals > 0 ? `V${'9'.repeat(picture.decimals)}` : ''}`;

    if (clauses.position !== undefined) anyExplicit = true;

    fields.push({
      name,
      level,
      start: clauses.position ?? 0,
      length,
      type,
      pic: normalisedPic,
      ...(picture.kind === 'numeric' ? { digits: picture.digits, decimals: picture.decimals } : {}),
      signed,
      ...(clauses.sign ? { sign: clauses.sign } : {}),
      usage,
      explicitPosition: clauses.position !== undefined,
      line,
    });
  });

  if (fields.length === 0) {
    throw new CopybookError('COPYBOOK_UNPARSABLE', 'copybook declares no fields');
  }

  // Assign cumulative starts where the copybook did not state one.
  let cursor = 1;
  for (const field of fields) {
    if (!field.explicitPosition) field.start = cursor;
    cursor = field.start + field.length;
  }

  // Overlap (R1.5) — explicit POSITION makes this reachable, so it is checked, not assumed.
  const ordered = [...fields].sort((a, b) => a.start - b.start || a.length - b.length);
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1]!;
    const cur = ordered[i]!;
    const prevEnd = prev.start + prev.length;
    if (cur.start < prevEnd) {
      throw new CopybookError(
        'COPYBOOK_OVERLAP',
        `fields ${prev.name} (bytes ${prev.start}-${prevEnd - 1}) and ${cur.name} (bytes ${cur.start}-${cur.start + cur.length - 1}) overlap (copybook line ${cur.line})`,
        { line: cur.line, fields: [prev.name, cur.name] },
      );
    }
    if (cur.start > prevEnd) {
      notes.push(`bytes ${prevEnd}-${cur.start - 1} are not covered by any field`);
    }
  }

  const recordLength = Math.max(...fields.map((f) => f.start + f.length - 1));
  const fieldNames = new Set(fields.map((f) => f.name));
  const fieldOf = (name: string, key: string) => {
    const field = fields.find((f) => f.name === name);
    if (!field) {
      throw new CopybookError('COPYBOOK_SEMANTICS', `@semantics ${key}=${name} does not name a field in this copybook`);
    }
    return field;
  };

  for (const key of ['amount', 'currency', 'valueDate', 'reference', 'transactionType'] as const) {
    const name = semantics[key];
    if (!name) continue;
    const field = fieldOf(name, key);
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
    const typeField = fieldOf(control.typeField, 'control.typeField');
    if (typeField.type !== 'string') {
      throw new CopybookError('COPYBOOK_SEMANTICS', `@control typeField=${control.typeField} must be alphabetic`);
    }
    if (control.countField) fieldOf(control.countField, 'control.countField');
    if (control.totalField) fieldOf(control.totalField, 'control.totalField');
    if (control.currencyField) fieldOf(control.currencyField, 'control.currencyField');
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
