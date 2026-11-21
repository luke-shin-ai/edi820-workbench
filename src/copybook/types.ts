/**
 * Copybook model — the byte contract that 「820」 reads.
 *
 * A copybook is the only thing that says where a field starts, how wide it is,
 * how the sign is encoded and how many implied decimals it carries. Everything
 * downstream (parser, reconciler, explainer) is driven by this model, never by
 * hard-coded field names or offsets.
 */

export type FieldType =
  | 'string'
  | 'unsigned-int'
  | 'signed-int'
  | 'implied-decimal'
  | 'zoned-decimal'
  | 'packed-decimal'
  | 'filler';

export type SignConvention = 'leading-separate' | 'trailing-separate' | 'trailing-overpunch';

/** How records are framed in the data file. */
export type Framing = 'line' | 'fixed';

export type Usage = 'display' | 'comp-3';

export interface CopybookField {
  /** Source name, verbatim (never normalised — see `.kiro/steering/structure.md`). */
  name: string;
  level: number;
  /** 1-based, inclusive byte offset inside the record. */
  start: number;
  /** Width in bytes. */
  length: number;
  type: FieldType;
  /** Normalised picture, e.g. `S9(11)V99`. */
  pic: string;
  /** Integer digits (COBOL `n` in `9(n)`), numeric fields only. */
  digits?: number;
  /** Implied decimal digits (COBOL `m` in `V9(m)`), numeric fields only. */
  decimals?: number;
  signed: boolean;
  sign?: SignConvention;
  usage: Usage;
  /** True when the copybook stated an explicit POSITION instead of relying on cumulation. */
  explicitPosition: boolean;
  /** 1-based copybook line the field came from. */
  line: number;
}

/**
 * Optional semantic mapping declared in the copybook (`* @semantics ...`).
 * This is what keeps the reconciler generic: it learns *which* field is the
 * amount, currency, value date, reference and transaction type from the spec.
 */
export interface CopybookSemantics {
  amount?: string;
  currency?: string;
  valueDate?: string;
  dateFormat?: 'CCYYMMDD' | 'YYMMDD';
  reference?: string;
  transactionType?: string;
  creditValue?: string;
  debitValue?: string;
}

/** Trailer / control record declaration (`* @control ...`). */
export interface ControlSpec {
  typeField: string;
  trailerValue: string;
  countField?: string;
  totalField?: string;
  currencyField?: string;
}

export interface Copybook {
  /** Record name from the `01 <NAME>.` line (or the file stem). */
  name: string;
  /** Bytes per record — derived from the fields, never guessed from a comment. */
  recordLength: number;
  fields: CopybookField[];
  semantics: CopybookSemantics;
  control?: ControlSpec;
  framing: Framing;
  /** Non-fatal observations found while compiling (gaps, ignored clauses). */
  notes: string[];
  /** Normalised source text, kept for hashing and for the UI's side-by-side view. */
  source: string;
}

export type CopybookIssueCode =
  | 'COPYBOOK_UNPARSABLE'
  | 'COPYBOOK_OVERLAP'
  | 'UNSUPPORTED_STRUCTURE'
  | 'COPYBOOK_SEMANTICS';

export class CopybookError extends Error {
  readonly code: CopybookIssueCode;
  readonly line?: number;
  readonly fields?: string[];

  constructor(
    code: CopybookIssueCode,
    message: string,
    options: { line?: number; fields?: string[] } = {},
  ) {
    super(message);
    this.name = 'CopybookError';
    this.code = code;
    this.line = options.line;
    this.fields = options.fields;
  }
}
