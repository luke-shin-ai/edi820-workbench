/**
 * L1 (BAI2) - the dedicated reader for bank balance/transaction files.
 *
 * The reconciler does not know or care where a typed record came from: it reads
 * `values`, `slices` and `isTrailer`. This reader therefore produces the same
 * `ParseResult` shape the fixed-width parser does, from a format that has no
 * fixed width, no copybook and a sign convention of its own ("the type code
 * decides direction").
 *
 * What it checks internally (and reports as `BAI2_*` issues, never silently):
 *   - record nesting: 01 -> 02 -> 03 -> 16* -> 49 -> 98 -> 99;
 *   - the account trailer's record count and control total;
 *   - the group trailer's record count and control total;
 *   - the file trailer's record and group counts.
 *
 * The declared control this reader hands to L2 is the account summary code
 * `100` ("total credits"): the one number in a BAI2 file that is directly
 * comparable to a payment file's declared total. The `98` group control total is
 * *not* used as a payment total, because BAI2 defines it over account control
 * totals (which already include `03` summary amounts) - comparing it to detail
 * sums would be a category error. `docs/bai2.md` records that reasoning.
 */
import type { Copybook } from '../copybook/types.js';
import { fromLatin1, isBytes, toLatin1, type Bytes } from '../core/bytes.js';
import {
  CURRENCY_EXPONENTS,
  sha256,
  type Amount,
  type ControlDeclaration,
  type CurrencyTotal,
  type IssueCode,
  type ParseIssue,
  type ParseResult,
  type ParsedValue,
  type TypedRecord,
} from '../parser/parser.js';
import {
  BAI2_LAYOUTS,
  decodeBai2Amount,
  directionOfTypeCode,
  isoFromBai2Date,
  recordCodeOf,
  splitRecordFields,
  summaryTriples,
  toFieldMap,
  type Bai2SummaryTriple,
} from './schema.js';

/**
 * The BAI2 "spec" object.
 *
 * It is deliberately *not* a copybook: `fields` is empty and `recordLength` is 0,
 * because BAI2 has no fixed width. The layouts live in `schema.ts`, and every
 * record carries its own field offsets in `spans`. `docs/bai2.md` §1 records why
 * this is a separate reader rather than a disguised copybook.
 */
export function bai2Spec(notes: string[] = []): Copybook {
  return {
    name: 'BAI2-FILE',
    format: 'bai2',
    recordLength: 0,
    fields: [],
    semantics: {
      amount: 'AMOUNT',
      currency: 'CURRENCY',
      valueDate: 'AS-OF-DATE',
      dateFormat: 'YYMMDD',
      reference: 'CUSTOMER-REFERENCE',
      transactionType: 'TYPE-CODE',
    },
    framing: 'line',
    notes: [
      'BAI2 is comma-delimited: recordLength is 0 by definition and field offsets are per record (see TypedRecord.spans).',
      ...notes,
    ],
    source: [
      '# BAI2 (cash management balance reporting) - declared record layouts',
      ...Object.entries(BAI2_LAYOUTS).map(([code, fields]) => `${code}: ${fields.map((f) => f.name).join(', ')}`),
    ].join('\n'),
  };
}

export interface Bai2ParseOptions {
  /** Century applied to the YYMMDD dates BAI2 carries. Default 2000 (documented, not inferred). */
  century?: number;
  /** Currency exponents override, e.g. `{ USD: 3 }` for a bank that settles in mils. */
  currencyExponents?: Record<string, number>;
}

interface AccountState {
  account: string;
  currency: string;
  startIndex: number;
  /** Sum of the amounts a `03` record (and its `88` continuations) declare, as magnitudes. */
  summaryMinorUnits: bigint;
  /** Sum of the `16` detail amounts, as magnitudes. */
  detailMinorUnits: bigint;
  /** A trailing type code in the `03` whose amount arrives on the next `88` record. */
  pendingTypeCode: string | null;
}

interface GroupState {
  asOfDate: string | null;
  currency: string;
  startIndex: number;
  /** Account control totals declared by the group's 49 records. */
  accountControlTotals: bigint[];
}

export function parseBai2(source: Bytes | string, options: Bai2ParseOptions = {}): ParseResult {
  const buffer: Bytes = isBytes(source) ? source : fromLatin1(source);
  const text = toLatin1(buffer);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = text.length > 0 && text.endsWith(eol);
  const lines = text.length === 0 ? [] : text.split(eol);
  if (trailingNewline) lines.pop();

  const exponents = { ...CURRENCY_EXPONENTS, ...(options.currencyExponents ?? {}) };
  const century = options.century ?? 2000;
  const issues: ParseIssue[] = [];
  const records: TypedRecord[] = [];
  const totalsByCurrency: Record<string, CurrencyTotal> = {};
  // Gross splits. The `03` code `100` is a *total credits* declaration, so the
  // comparison against it has to be able to say which part is credits and which
  // is a debit (a bank fee, for example) instead of folding the two together.
  const creditTotalsByCurrency: Record<string, CurrencyTotal> = {};
  const debitTotalsByCurrency: Record<string, CurrencyTotal> = {};

  let group: GroupState | null = null;
  let account: AccountState | null = null;
  let currentCurrency = '';
  let groupCount = 0;
  let seenFileHeader = false;
  let seenFileTrailer = false;
  let fileTrailerIssues: ParseIssue[] = [];

  const declaredCredits = new Map<string, { minorUnits: bigint; scale: number; recordIndex: number }>();
  /** Whether the previous amount-bearing record was a `03` (its `88` carries summaries) or a `16`. */
  let lastAmountRecord: '03' | '16' | null = null;

  /**
   * Add the amount of each [type code, amount] pair of an `03` record, or of an `88` that
   * continues one, to the account's control-total sum.
   *
   * The `49` control total is the sum of the amount values in the `03`, `16` and `88` records
   * as they appear on the wire: a debit is a positive number whose direction comes from its type
   * code, so the control total adds magnitudes. That is the rule the two bank-published
   * files in `samples/public/` satisfy exactly, and what `docs/bai2.md` §4 records.
   */
  const addSummary = (
    state: AccountState,
    triples: Bai2SummaryTriple[],
    scale: number,
    recordIndex: number,
  ): void => {
    for (const triple of triples) {
      let minorUnits: bigint;
      try {
        minorUnits = decodeBai2Amount(triple.amount, scale).minorUnits;
      } catch (error) {
        issues.push({
          code: 'FIELD_INVALID_NUMERIC',
          recordIndex,
          field: 'AMOUNT',
          detail: `${triple.typeCode} summary amount is not a BAI2 amount: ${(error as Error).message}`,
        });
        continue;
      }
      const magnitude = minorUnits < 0n ? -minorUnits : minorUnits;
      state.summaryMinorUnits += magnitude;
      if (triple.typeCode === '100') {
        const bucket = declaredCredits.get(state.currency);
        if (bucket) bucket.minorUnits += magnitude;
        else declaredCredits.set(state.currency, { minorUnits: magnitude, scale, recordIndex });
      }
    }
  };

  lines.forEach((line, index) => {
    const recordIssues: ParseIssue[] = [];
    const pushIssue = (code: IssueCode, detail: string, extra: Partial<ParseIssue> = {}): void => {
      const issue: ParseIssue = { code, recordIndex: index, detail, ...extra };
      recordIssues.push(issue);
      issues.push(issue);
    };

    const code = recordCodeOf(line);
    const splitFields = splitRecordFields(line);
    const { values: rawFields, spans } = toFieldMap(code, splitFields, line);
    const values: Record<string, ParsedValue> = {};
    const slices: Record<string, string> = {};
    for (const [name, fieldText] of Object.entries(rawFields)) {
      slices[name] = fieldText;
      values[name] = fieldText;
    }
    values['REC-CODE'] = code;
    let isTrailer = true;

    switch (code) {
      case '01': {
        if (index !== 0) pushIssue('BAI2_STRUCTURE', 'the file header (01) is not the first record');
        seenFileHeader = true;
        if (rawFields['VERSION'] && rawFields['VERSION'] !== '2') {
          pushIssue('BAI2_STRUCTURE', `file header declares version ${rawFields['VERSION']}, not BAI2 (2)`);
        }
        break;
      }
      case '02': {
        if (!seenFileHeader) pushIssue('BAI2_STRUCTURE', 'a group header (02) appears before the file header (01)');
        if (group) pushIssue('BAI2_STRUCTURE', 'a group header (02) opened while the previous group had no trailer (98)');
        groupCount += 1;
        const currency = (rawFields['CURRENCY'] ?? '').trim();
        const asOfRaw = (rawFields['AS-OF-DATE'] ?? '').trim();
        const iso = isoFromBai2Date(asOfRaw, century);
        if (!iso) pushIssue('BAI2_RECORD_INVALID', `group header as-of date ${JSON.stringify(asOfRaw)} is not YYMMDD`);
        else values['AS-OF-DATE__iso'] = iso;
        group = { asOfDate: iso, currency, startIndex: index, accountControlTotals: [] };
        currentCurrency = currency;
        break;
      }
      case '03': {
        if (!group) pushIssue('BAI2_STRUCTURE', 'an account record (03) appears outside a group');
        if (account) pushIssue('BAI2_STRUCTURE', 'an account record (03) opened while the previous account had no trailer (49)');
        const currency = (rawFields['CURRENCY'] ?? '').trim() || (group?.currency ?? '');
        currentCurrency = currency;
        const scale = exponents[currency] ?? 2;
        if (currency !== '' && exponents[currency] === undefined) {
          pushIssue('CURRENCY_SCALE_MISMATCH', `${currency} is not in the ISO-4217 table; a ${scale}-digit scale was assumed for the 03 amount`);
        }
        let minorUnits: bigint | undefined;
        try {
          minorUnits = decodeBai2Amount(rawFields['AMOUNT'] ?? '', scale).minorUnits;
          values['AMOUNT'] = { minorUnits, currency, scale } satisfies Amount;
        } catch (error) {
          pushIssue('FIELD_INVALID_NUMERIC', `03 amount is not a BAI2 amount: ${(error as Error).message}`, { field: 'AMOUNT' });
        }
        // An `03` record is a list of [type code, amount, item count, funds type] groups and a
        // trailing type code may push its amount onto the next `88`. Reading only the first group
        // (which this reader did until 2026-11-22) missed a `100` total that was not declared
        // first, and could not check the `49` total over the whole record.
        const summaryScan = summaryTriples(splitFields, 3);
        account = {
          account: (rawFields['ACCOUNT'] ?? '').trim(),
          currency,
          startIndex: index,
          summaryMinorUnits: 0n,
          detailMinorUnits: 0n,
          pendingTypeCode: summaryScan.pendingTypeCode ?? null,
        };
        addSummary(account, summaryScan.triples, scale, index);
        lastAmountRecord = '03';
        break;
      }
      case '16': {
        isTrailer = false;
        lastAmountRecord = '16';
        if (!account) pushIssue('BAI2_STRUCTURE', 'a detail record (16) appears outside an account block');
        const typeCode = (rawFields['TYPE-CODE'] ?? '').trim();
        const currency = account?.currency || currentCurrency;
        const scale = exponents[currency] ?? 2;
        const direction = directionOfTypeCode(typeCode);
        if (direction === 'unknown') {
          pushIssue(
            'BAI2_RECORD_INVALID',
            `type code ${JSON.stringify(typeCode)} is outside the BAI2 credit (100-399) and debit (400-699) ranges; the amount was taken as positive`,
            { field: 'TYPE-CODE', actual: typeCode },
          );
        }
        try {
          const { minorUnits, negative } = decodeBai2Amount(rawFields['AMOUNT'] ?? '', scale);
          const signed = negative || direction === 'debit' ? -minorUnits : minorUnits;
          const amount: Amount = { minorUnits: signed, currency, scale };
          values['AMOUNT'] = amount;
          if (account) {
            // The `49` control total adds the amount values as they appear on the wire.
            account.detailMinorUnits += signed < 0n ? -signed : signed;
          }
          const bucket = (totalsByCurrency[currency] ??= { minorUnits: 0n, scale, records: 0 });
          bucket.minorUnits += signed;
          bucket.records += 1;
          const grossTarget = signed < 0n ? debitTotalsByCurrency : creditTotalsByCurrency;
          const grossBucket = (grossTarget[currency] ??= { minorUnits: 0n, scale, records: 0 });
          grossBucket.minorUnits += signed < 0n ? -signed : signed;
          grossBucket.records += 1;
        } catch (error) {
          pushIssue('FIELD_INVALID_NUMERIC', `16 amount is not a BAI2 amount: ${(error as Error).message}`, { field: 'AMOUNT' });
        }
        const asOf = group?.asOfDate ?? null;
        if (asOf) {
          values['AS-OF-DATE'] = BigInt(asOf.replaceAll('-', '').slice(2));
          values['AS-OF-DATE__iso'] = asOf;
        }
        break;
      }
      case '49': {
        if (!account) {
          pushIssue('BAI2_STRUCTURE', 'an account trailer (49) appears with no open account block');
          break;
        }
        const accountRecords = index - account.startIndex + 1;
        const declaredCountRaw = (rawFields['NUMBER-OF-RECORDS'] ?? '').trim();
        if (declaredCountRaw !== '' && /^\d+$/.test(declaredCountRaw) && BigInt(declaredCountRaw) !== BigInt(accountRecords)) {
          pushIssue(
            'BAI2_CONTROL_MISMATCH',
            `account ${account.account} trailer declares ${declaredCountRaw} records but ${accountRecords} were read in the account block (03..49)`,
            { field: 'NUMBER-OF-RECORDS', declared: Number(declaredCountRaw), actual: accountRecords },
          );
        }
        const scale = exponents[account.currency] ?? 2;
        const declaredTotalRaw = (rawFields['ACCOUNT-CONTROL-TOTAL'] ?? '').trim();
        if (declaredTotalRaw !== '') {
          try {
            const { minorUnits } = decodeBai2Amount(declaredTotalRaw, scale);
            const computed = account.summaryMinorUnits + account.detailMinorUnits;
            group?.accountControlTotals.push(minorUnits);
            if (minorUnits !== computed) {
              pushIssue(
                'BAI2_CONTROL_MISMATCH',
                `account ${account.account} control total declares ${minorUnits} minor units but the 03 summaries, 16 details and 88 continuations sum to ${computed}`,
                { field: 'ACCOUNT-CONTROL-TOTAL', declared: minorUnits.toString(), actual: computed.toString() },
              );
            }
          } catch (error) {
            pushIssue('BAI2_RECORD_INVALID', `account trailer control total is not an amount: ${(error as Error).message}`);
          }
        }
        account = null;
        lastAmountRecord = null;
        break;
      }
      case '88': {
        if (!seenFileHeader) pushIssue('BAI2_STRUCTURE', 'a continuation record (88) appears before the file header');
        // A continuation carries either the rest of an `03` summary list or the text of a `16`.
        // Only the summary case has amounts that the `49` control total counts.
        if (account && lastAmountRecord === '03') {
          const scan = summaryTriples(splitFields, 1);
          const triples: Bai2SummaryTriple[] = [...scan.triples];
          if (account.pendingTypeCode) {
            const first = (splitFields[1]?.text ?? '').trim();
            if (/^[+-]?\d+$/.test(first)) {
              triples.unshift({ typeCode: account.pendingTypeCode, amount: first });
              account.pendingTypeCode = null;
            }
          }
          addSummary(account, triples, exponents[account.currency] ?? 2, index);
          account.pendingTypeCode = scan.pendingTypeCode ?? account.pendingTypeCode;
        }
        break;
      }
      case '98': {
        if (!group) {
          pushIssue('BAI2_STRUCTURE', 'a group trailer (98) appears with no open group');
          break;
        }
        const groupRecords = index - group.startIndex + 1;
        const declaredCountRaw = (rawFields['NUMBER-OF-RECORDS'] ?? '').trim();
        if (declaredCountRaw !== '' && /^\d+$/.test(declaredCountRaw) && BigInt(declaredCountRaw) !== BigInt(groupRecords)) {
          pushIssue(
            'BAI2_CONTROL_MISMATCH',
            `group trailer declares ${declaredCountRaw} records but ${groupRecords} were read in the group (02..98)`,
            { field: 'NUMBER-OF-RECORDS', declared: Number(declaredCountRaw), actual: groupRecords },
          );
        }
        const declaredAccounts = (rawFields['NUMBER-OF-ACCOUNTS'] ?? '').trim();
        const accountCount = records.filter((r, i) => i >= group!.startIndex && i < index && r.values['REC-CODE'] === '03').length;
        if (declaredAccounts !== '' && /^\d+$/.test(declaredAccounts) && Number(declaredAccounts) !== accountCount) {
          pushIssue(
            'BAI2_CONTROL_MISMATCH',
            `group trailer declares ${declaredAccounts} accounts but ${accountCount} account records (03) were read`,
            { field: 'NUMBER-OF-ACCOUNTS', declared: Number(declaredAccounts), actual: accountCount },
          );
        }
        const scale = exponents[group.currency] ?? 2;
        const declaredTotalRaw = (rawFields['GROUP-CONTROL-TOTAL'] ?? '').trim();
        if (declaredTotalRaw !== '') {
          try {
            const { minorUnits } = decodeBai2Amount(declaredTotalRaw, scale);
            const summed = group.accountControlTotals.reduce((acc, v) => acc + v, 0n);
            if (minorUnits !== summed) {
              pushIssue(
                'BAI2_CONTROL_MISMATCH',
                `group control total declares ${minorUnits} minor units but the account control totals sum to ${summed}`,
                { field: 'GROUP-CONTROL-TOTAL', declared: minorUnits.toString(), actual: summed.toString() },
              );
            }
          } catch (error) {
            pushIssue('BAI2_RECORD_INVALID', `group trailer control total is not an amount: ${(error as Error).message}`);
          }
        }
        group = null;
        account = null;
        currentCurrency = '';
        break;
      }
      case '99': {
        seenFileTrailer = true;
        if (group) pushIssue('BAI2_STRUCTURE', 'the file trailer (99) closed a file with an open group');
        if (account) pushIssue('BAI2_STRUCTURE', 'the file trailer (99) closed a file with an open account');
        const declaredGroups = (rawFields['NUMBER-OF-GROUPS'] ?? '').trim();
        if (declaredGroups !== '' && /^\d+$/.test(declaredGroups) && Number(declaredGroups) !== groupCount) {
          pushIssue(
            'BAI2_CONTROL_MISMATCH',
            `file trailer declares ${declaredGroups} groups but ${groupCount} group headers were read`,
            { field: 'NUMBER-OF-GROUPS', declared: Number(declaredGroups), actual: groupCount },
          );
        }
        const declaredRecords = (rawFields['NUMBER-OF-RECORDS'] ?? '').trim();
        if (declaredRecords !== '' && /^\d+$/.test(declaredRecords) && Number(declaredRecords) !== lines.length) {
          pushIssue(
            'BAI2_CONTROL_MISMATCH',
            `file trailer declares ${declaredRecords} records but the file holds ${lines.length}`,
            { field: 'NUMBER-OF-RECORDS', declared: Number(declaredRecords), actual: lines.length },
          );
        }
        break;
      }
      default:
        pushIssue('BAI2_STRUCTURE', `unknown record code ${JSON.stringify(code)} on line ${index + 1}`);
        break;
    }

    records.push({
      index,
      raw: line,
      length: line.length,
      values,
      slices,
      spans,
      issues: recordIssues,
      isTrailer,
    });
  });

  fileTrailerIssues = [];
  if (!seenFileHeader) fileTrailerIssues.push({ code: 'BAI2_STRUCTURE', recordIndex: 0, detail: 'the file has no header record (01)' });
  if (!seenFileTrailer) {
    fileTrailerIssues.push({ code: 'BAI2_STRUCTURE', recordIndex: records.length - 1, detail: 'the file has no trailer record (99)' });
  }
  if (group) fileTrailerIssues.push({ code: 'BAI2_STRUCTURE', recordIndex: records.length - 1, detail: 'the file ended inside a group (no 98 trailer)' });
  if (account) fileTrailerIssues.push({ code: 'BAI2_STRUCTURE', recordIndex: records.length - 1, detail: 'the file ended inside an account block (no 49 trailer)' });
  issues.push(...fileTrailerIssues);

  let declaredControl: ControlDeclaration | undefined;
  if (declaredCredits.size === 1) {
    const [currency, bucket] = [...declaredCredits.entries()][0]!;
    declaredControl = { recordIndex: bucket.recordIndex, total: { minorUnits: bucket.minorUnits, currency, scale: bucket.scale } };
  } else if (declaredCredits.size > 1) {
    issues.push({
      code: 'SPEC_MISSING',
      detail: `03 records declare total credits in ${declaredCredits.size} currencies (${[...declaredCredits.keys()].join(', ')}); no single declared credit total can be compared, so control totals are left to the per-account checks`,
    });
  } else {
    issues.push({
      code: 'SPEC_MISSING',
      detail: 'no 03 account summary declares BAI2 type code 100 (total credits), so there is no declared credit total to compare against',
    });
  }

  const detailCount = records.filter((r) => !r.isTrailer).length;
  const copybook = bai2Spec([
    declaredControl
      ? 'declared control: 03 account summary code 100 (total credits), the only BAI2 number comparable to a payment total'
      : 'declared control: none (no single 03 code 100 total)',
    'the 98 group control total covers account control totals (which include 03 summary amounts), so it is checked at the BAI2 level and not used as a payment total',
    'dates: BAI2 carries YYMMDD without a century; this reader applies 2000 (documented in docs/bai2.md §3)',
  ]);
  const copybookHash = sha256(copybook.source);
  const fileHash = sha256(buffer);
  const fingerprint = sha256(
    [
      `bai2:${copybookHash}`,
      `file:${fileHash}`,
      `records:${records.map((r) => sha256(r.raw)).join(',')}`,
      `issues:${issues.map((i) => `${i.code}@${i.recordIndex ?? '-'}:${i.field ?? '-'}`).join(',')}`,
      declaredControl?.total ? `declared:${declaredControl.total.minorUnits.toString()}${declaredControl.total.currency}` : 'declared:-',
    ].join('|'),
  );

  return {
    copybook,
    framing: 'line',
    records,
    issues,
    ...(declaredControl ? { declaredControl } : {}),
    computedControl: { recordCount: records.length, detailCount, totalsByCurrency, creditTotalsByCurrency, debitTotalsByCurrency },
    eol: lines.length === 0 ? null : eol,
    trailingNewline,
    fileHash,
    copybookHash,
    fingerprint,
    source: buffer,
  };
}
