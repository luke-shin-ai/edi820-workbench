/**
 * The static demo's client: one browser tab, no server.
 *
 * Every number on the screen is produced here by the same modules the CLI imports —
 * `parseFile`, `parseBai2`, `reconcile`, `explainFindings` (the deterministic template adapter),
 * `buildViewModel` and the L4 register. Nothing is fetched after `bundle.js` loads, and a
 * dropped file is read as bytes (`arrayBuffer`), not as text, so a COMP-3 amount survives.
 */
import { compileCopybook } from '../copybook/index.js';
import { parseFile, type ParseResult } from '../parser/index.js';
import { parseBai2 } from '../bai2/index.js';
import { reconcile, type Finding } from '../reconcile/index.js';
import { explainFindings } from '../explain/explainer.js'; // no node:child_process in this path
import { buildViewModel, type ViewModel } from '../web/view.js';
import type { FileSummary } from '../core/ops.js';
import { toLatin1 } from '../core/bytes.js';
import {
  appendRelease,
  appendWaiver,
  classify,
  emptyLedger,
  parseLedger,
  serialiseLedger,
  verifyLedger,
  type Classification,
  type Ledger,
} from '../exception/index.js';
import { COPYBOOKS, DATA, GUARANTEES, type SampleFile } from './samples.generated.js';

const TODAY = new Date().toISOString().slice(0, 10);
const LEDGER_KEY = '820-ledger-v1';

interface Scenario {
  id: string;
  name: string;
  payment: string;
  copybook?: string;
  bank?: string;
  bankCopybook?: string;
  bankFormat?: 'fixed' | 'bai2';
  expect: 'PASS' | 'FAIL';
}

const WINDOW = { start: '2026-11-18', end: '2026-11-20' };

const SCENARIOS: Scenario[] = [
  { id: 'S1', name: '820-good + 823-bank', payment: '820-good.txt', copybook: '820.cpy', bank: '823-bank.txt', bankCopybook: '823.cpy', expect: 'PASS' },
  { id: 'S2', name: '820-packed (COMP-3) + 823-bank', payment: '820-packed-good.txt', copybook: '820-packed.cpy', bank: '823-bank.txt', bankCopybook: '823.cpy', expect: 'PASS' },
  { id: 'S3', name: '820-bad + 823-bank', payment: '820-bad.txt', copybook: '820.cpy', bank: '823-bank.txt', bankCopybook: '823.cpy', expect: 'FAIL' },
  { id: 'S4', name: '820-good + 823-bad', payment: '820-good.txt', copybook: '820.cpy', bank: '823-bad.txt', bankCopybook: '823.cpy', expect: 'FAIL' },
  { id: 'S5', name: '820-good + BAI2 good', payment: '820-good.txt', copybook: '820.cpy', bank: 'bai2-good.txt', bankFormat: 'bai2', expect: 'PASS' },
  { id: 'S6', name: '820-good + BAI2 bad', payment: '820-good.txt', copybook: '820.cpy', bank: 'bai2-bad.txt', bankFormat: 'bai2', expect: 'FAIL' },
  { id: 'S7', name: '820-redefines good + 823-bank', payment: '820-redefines-good.txt', copybook: '820-redefines.cpy', bank: '823-bank.txt', bankCopybook: '823.cpy', expect: 'PASS' },
  { id: 'S8', name: '820-redefines bad + 823-bank', payment: '820-redefines-bad.txt', copybook: '820-redefines.cpy', bank: '823-bank.txt', bankCopybook: '823.cpy', expect: 'FAIL' },
];

interface RunState {
  view: ViewModel;
  findings: Finding[];
  fingerprint: string;
  scenarioId: string;
}

const state: {
  run: RunState | null;
  ledger: Ledger;
  selected: number;
  /** Record whose layout the evidence panel shows when no finding is selected. */
  spotlight: { side: 'payment' | 'bank'; index: number } | null;
  droppedFile: { name: string; bytes: Uint8Array } | null;
  droppedCopybook: { name: string; bytes: Uint8Array } | null;
} = { run: null, ledger: emptyLedger(), selected: -1, spotlight: null, droppedFile: null, droppedCopybook: null };

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as unknown as T;

function esc(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(message: string): void {
  const node = el('toast');
  node.textContent = message;
  node.classList.add('on');
  window.setTimeout(() => node.classList.remove('on'), 2600);
}

function bytesOf(name: string, pool: SampleFile[] = DATA): Uint8Array {
  const entry = pool.find((sample) => sample.name === name);
  if (!entry) throw new Error(`sample ${name} is not bundled`);
  const binary = atob(entry.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const copybookOf = (name: string): string => toLatin1(bytesOf(name, COPYBOOKS));

function summaryOf(
  role: 'payment' | 'bank',
  label: string,
  format: 'fixed' | 'bai2',
  copybookPath: string | null,
  result: ParseResult,
): FileSummary {
  return {
    role,
    path: label,
    format,
    copybookPath,
    recordLength: result.copybook.recordLength,
    records: result.computedControl.recordCount,
    details: result.computedControl.detailCount,
    fileHash: result.fileHash,
    copybookHash: result.copybookHash,
    fingerprint: result.fingerprint,
    issues: result.issues.map((issue) => ({ ...issue, detail: issue.detail })),
  };
}

async function runScenario(id: string): Promise<void> {
  const scenario = SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`unknown scenario ${id}`);
  const paymentBytes = bytesOf(scenario.payment);
  const payment = parseFile({
    copybook: compileCopybook(copybookOf(scenario.copybook ?? '820.cpy')),
    source: paymentBytes,
    filename: scenario.payment,
  });
  let bank: ParseResult | undefined;
  if (scenario.bank) {
    bank =
      scenario.bankFormat === 'bai2'
        ? parseBai2(bytesOf(scenario.bank))
        : parseFile({
            copybook: compileCopybook(copybookOf(scenario.bankCopybook ?? '823.cpy')),
            source: bytesOf(scenario.bank),
            filename: scenario.bank,
          });
  }
  await present(scenario.id, payment, bank, scenario);
}

async function present(
  scenarioId: string,
  payment: ParseResult,
  bank: ParseResult | undefined,
  scenario?: Scenario,
  label?: { payment: string; copybook?: string | null },
): Promise<void> {
  const window = readWindow();
  const result = reconcile({
    payment,
    ...(bank ? { bank } : {}),
    options: { settlementWindow: window },
  });
  const explanations = (await explainFindings(result.findings)).explanations;
  const paymentLabel = label?.payment ?? scenario?.payment ?? '(dropped file)';
  const files = {
    payment: summaryOf('payment', paymentLabel, 'fixed', label?.copybook ?? scenario?.copybook ?? null, payment),
    ...(bank ? { bank: summaryOf('bank', scenario?.bank ?? '(dropped bank)', scenario?.bankFormat ?? 'fixed', scenario?.bankCopybook ?? null, bank) } : {}),
  };
  const view = buildViewModel({
    payment,
    ...(bank ? { bank } : {}),
    result,
    files,
    explanations,
    guarantees: { ...GUARANTEES },
  });
  state.run = { view, findings: result.findings, fingerprint: result.fingerprint, scenarioId };
  state.selected = result.findings.length > 0 ? 0 : -1;
  state.spotlight = null;
  render();
}

function readWindow(): { start: string; end: string } {
  const raw = el<HTMLInputElement>('inpWindow').value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(raw);
  if (!match) throw new Error('the settlement window must look like 2026-11-18..2026-11-20');
  return { start: match[1]!, end: match[2]! };
}

async function runDropped(): Promise<void> {
  if (!state.droppedFile) {
    toast('drop a payment file first');
    return;
  }
  const format = el<HTMLSelectElement>('selFormat').value as 'fixed' | 'bai2';
  const payment =
    format === 'bai2'
      ? parseBai2(state.droppedFile.bytes)
      : parseFile({
          copybook: compileCopybook(state.droppedCopybook ? toLatin1(state.droppedCopybook.bytes) : copybookOf('820.cpy')),
          source: state.droppedFile.bytes,
          filename: state.droppedFile.name,
        });
  await present('dropped', payment, undefined, undefined, {
    payment: state.droppedFile.name,
    copybook: state.droppedCopybook?.name ?? null,
  });
}

function classification(): Classification | null {
  if (!state.run) return null;
  try {
    return classify(state.run.findings, state.ledger, TODAY);
  } catch (error) {
    return null;
  }
}

function renderScenarios(): void {
  el('scenarios').innerHTML = SCENARIOS.map(
    (scenario) => `<button class="scenario ${state.run?.scenarioId === scenario.id ? 'on' : ''}" data-id="${scenario.id}">
      <span class="id">${scenario.id}</span>
      <span class="nm">${esc(scenario.name)}</span>
      <span class="exp ${scenario.expect.toLowerCase()}">${scenario.expect}</span>
    </button>`,
  ).join('');
}

function renderRecords(): void {
  const view = state.run?.view;
  if (!view) return;
  el('records').innerHTML = view.records
    .map(
      (record) =>
        `<li class="${record.issues.length ? 'issue' : record.isTrailer ? 'trailer' : ''}${
          state.spotlight && state.spotlight.side === record.side && state.spotlight.index === record.index ? ' on' : ''
        }" data-side="${record.side}" data-index="${record.index}">${record.side[0]}${String(record.index).padStart(3, '0')}  ${esc(record.raw)}</li>`,
    )
    .join('');
}

function renderVerdict(): void {
  const view = state.run?.view;
  if (!view) return;
  el('fp').textContent = `fingerprint ${view.fingerprint.slice(0, 16)}…`;
  const status = el('status');
  status.textContent = view.status;
  status.className = `chip ${view.status === 'PASS' ? 'pass' : view.status === 'INCOMPLETE' ? 'warn' : 'fail'}`;
  el('verdictMeta').textContent = `${view.files.payment.details} details · ${view.files.payment.format}` +
    (view.files.bank ? ` + bank ${view.files.bank.details} details (${view.files.bank.format})` : '') +
    (view.summary.blockingParseIssues ? ` · ${view.summary.blockingParseIssues} blocking parse issue(s)` : '') +
    ` · ${view.files.payment.path}`;
  el('cDet').textContent = String(view.files.payment.details);
  el('cFind').textContent = String(view.findings.length);
  el('cMatched').textContent = String(view.summary.referencesMatched);
  const c = classification();
  el('cOpen').textContent = c ? String(c.counts.OPEN + c.counts.EXPIRED) : '—';

  el('totals').querySelector('tbody')!.innerHTML = view.totals.length
    ? view.totals
        .map((total) => {
          const basis = total.basis
            ? `<div class="small muted">${esc(total.basis)}${total.credits || total.debits ? ` · credits ${esc(total.credits ?? '0')} / debits ${esc(total.debits ?? '0')}` : ''}</div>`
            : '';
          return `<tr><td>${esc(total.currency)}${basis}</td><td>${esc(total.declared)}</td><td>${esc(total.computed)}</td><td class="${total.delta.startsWith('-') ? 'neg' : ''}">${esc(total.delta)}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="4" class="muted">no declared total</td></tr>';

  el('findings').innerHTML = view.findings
    .map(
      (finding, index) =>
        `<li data-i="${index}" class="${index === state.selected ? 'sel' : ''}">
          <div class="code"><span class="chip fail">${esc(finding.code)}</span> record ${esc(finding.recordIndex)}${finding.field ? ` · ${esc(finding.field)}` : ''}</div>
          ${finding.reference ? `<div class="meta">ref ${esc(finding.reference)}</div>` : ''}
          <div class="amt">declared ${esc(finding.declared ?? '—')} · computed ${esc(finding.computed ?? '—')} · delta ${esc(finding.delta ?? '—')}</div>
        </li>`,
    )
    .join('');
  el('findings').style.display = view.findings.length ? 'block' : 'none';
  el('noFindings').style.display = view.findings.length ? 'none' : 'block';

  el('issues').innerHTML = view.issues
    .map(
      (issue) =>
        `<li>${esc(issue.side)} · ${esc(issue.code)}${issue.recordIndex !== undefined ? ` @record ${esc(issue.recordIndex)}` : ''} — ${esc(issue.detail)}</li>`,
    )
    .join('');
}

function statusOf(key: string): string {
  const c = classification();
  return c?.entries.find((entry) => entry.findingKey === key)?.status ?? 'OPEN';
}

function renderLedger(): void {
  const c = classification();
  const integrity = verifyLedger(state.ledger);
  el('l4table').querySelector('tbody')!.innerHTML = c
    ? c.entries
        .map((entry) => {
          const waiver = state.ledger.entries.find((candidate) => candidate.id === entry.waiverId);
          return `<tr><td><span class="st ${entry.status}">${entry.status}</span></td>
            <td>${esc(entry.code)}<div class="small muted">record ${esc(entry.recordIndex)}${entry.expiresOn ? ` · expires ${esc(entry.expiresOn)}` : ''}</div></td>
            <td>${waiver ? `${esc(waiver.owner)}<div class="small muted">${esc(waiver.reason)}</div>` : '<span class="muted">—</span>'}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="3" class="muted">run a scenario to see the register</td></tr>';
  el('chain').textContent = state.ledger.entries.length
    ? `${state.ledger.entries.length} entr${state.ledger.entries.length === 1 ? 'y' : 'ies'} · chain ${integrity.ok ? 'intact' : `BROKEN at seq ${integrity.firstInvalidSeq}`} · head ${state.ledger.entries[state.ledger.entries.length - 1]!.hash.slice(0, 16)}…`
    : 'ledger empty — no decision recorded yet';
}

function firstDetail(side: 'payment' | 'bank'): number {
  const view = state.run?.view;
  if (!view) return 0;
  const record = view.records.find((entry) => entry.side === side && !entry.isTrailer);
  return record ? record.index : 0;
}

function renderEvidence(): void {
  const view = state.run?.view;
  if (!view) return;
  const finding = state.selected >= 0 ? view.findings[state.selected] : undefined;
  if (!finding) {
    const spot = state.spotlight ?? { side: 'payment' as const, index: firstDetail('payment') };
    const record = view.records.find((entry) => entry.side === spot.side && entry.index === spot.index);
    el('evidenceNote').textContent = record
      ? `${record.side} record ${record.index} sliced by its own spec — every field at the declared byte offset${record.isTrailer ? ' (control trailer)' : ''}.`
      : 'Pick a record below to read its layout.';
    if (!record) return;
    el('bytes').innerHTML = [...record.raw]
      .map((char, index) => `<span class="byte" title="byte ${index + 1}">${char === ' ' ? '·' : esc(char)}</span>`)
      .join('');
    el('ruler').textContent = ruler(record.raw.length);
    el('fieldmeta').innerHTML = `<table class="legend"><tr><th>field</th><th>pic</th><th>bytes</th><th>as read</th></tr>${record.fields
      .map(
        (field, index) =>
          `<tr><td><span class="sw f${index % 6}"></span><span class="nm">${esc(field.name)}</span></td><td class="nm">${esc(field.pic)}</td><td class="nm">${field.start}-${field.start + field.length - 1}</td><td class="pv">${esc(JSON.stringify(field.text))}</td></tr>`,
      )
      .join('')}</table>`;
    el('explain').innerHTML = '<div class="muted small">L3 narrates a finding. Select one in the verdict column.</div>';
    return;
  }

  const evidence = finding.evidence;
  const record = view.records.find((entry) => entry.side === evidence.side && entry.index === evidence.recordIndex);
  el('evidenceNote').textContent = `${evidence.note} · ${evidence.side} file`;
  if (record) {
    el('bytes').innerHTML = [...record.raw]
      .map((char, index) => {
        const inSpan = evidence.span && index >= evidence.span.start - 1 && index < evidence.span.start - 1 + evidence.span.length;
        return `<span class="byte${inSpan ? ' hl' : ''}" title="byte ${index + 1}">${char === ' ' ? '·' : esc(char)}</span>`;
      })
      .join('');
    el('ruler').textContent = ruler(record.raw.length);
  }
  const rows: string[] = [`<dt>record</dt><dd>${esc(evidence.side)} #${esc(evidence.recordIndex)}</dd>`];
  if (evidence.field) rows.push(`<dt>field</dt><dd>${esc(evidence.field)}${evidence.pic ? ` · ${esc(evidence.pic)}` : ''}</dd>`);
  if (evidence.span) rows.push(`<dt>bytes</dt><dd>${evidence.span.start}–${evidence.span.start + evidence.span.length - 1} (${evidence.span.length} bytes)</dd>`);
  if (evidence.fieldText !== undefined) rows.push(`<dt>as read</dt><dd>${esc(JSON.stringify(evidence.fieldText))}</dd>`);
  if (finding.declared !== undefined) rows.push(`<dt>declared</dt><dd>${esc(finding.declared)}</dd>`);
  if (finding.computed !== undefined) rows.push(`<dt>computed</dt><dd>${esc(finding.computed)}</dd>`);
  if (finding.delta !== undefined) rows.push(`<dt>delta</dt><dd>${esc(finding.delta)}</dd>`);
  el('fieldmeta').innerHTML = `<dl class="fieldmeta">${rows.join('')}</dl>`;

  const explanation = finding.explanation;
  if (!explanation) {
    el('explain').innerHTML = '<div class="muted small">No explanation was produced for this finding.</div>';
    return;
  }
  const blocked = explanation.status !== 'EXPLAINED';
  el('explain').innerHTML = `<div class="explain ${blocked ? 'blocked' : ''}">
    <div class="row" style="gap:8px;align-items:center">
      <span class="chip ${blocked ? 'warn' : 'info'}">${esc(explanation.status)}</span>
      <span class="small muted">L3 · ${esc(explanation.adapter)} · cites ${esc((explanation.citedValues ?? []).length)} value(s)</span>
    </div>
    <div class="cause">${esc(explanation.cause)}</div>
    <div class="fix">${esc(explanation.suggestedFix)}</div>
    <div class="cited">${(explanation.citedValues ?? []).map((value) => `<span>${esc(value)}</span>`).join('')}</div>
    <div class="small muted" style="margin-top:6px">citation ${esc(explanation.citation)}</div>
  </div>`;
}

function ruler(length: number): string {
  let out = '';
  for (let position = 0; position < length; position += 10) {
    out += String(position + 1).padEnd(10, ' ');
  }
  return out;
}

function render(): void {
  renderScenarios();
  renderRecords();
  renderVerdict();
  renderEvidence();
  renderLedger();
}

function selectedFinding(): Finding | null {
  return state.run && state.selected >= 0 ? (state.run.findings[state.selected] ?? null) : null;
}

function renderVerify(identical: boolean, note: string): void {
  el('verifyOut').innerHTML = identical
    ? `<span style="color:#79d492">identical — same inputs, same verdict</span><br/>${esc(note)}`
    : `<span style="color:#ff9c94">DIFFERENT — ${esc(note)}</span>`;
}

function wire(): void {
  el('scenarios').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('.scenario') as HTMLElement | null;
    if (!button) return;
    void runScenario(button.dataset.id!);
  });

  el('findings').addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest('li[data-i]') as HTMLElement | null;
    if (!item) return;
    state.selected = Number(item.dataset.i);
    render();
  });

  el('records').addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest('li[data-index]') as HTMLElement | null;
    state.selected = -1;
    if (item) {
      state.spotlight = { side: item.dataset.side as 'payment' | 'bank', index: Number(item.dataset.index) };
    }
    render();
  });

  el('btnVerify').addEventListener('click', () => {
    const run = state.run;
    if (!run) return;
    void (async () => {
      const before = run.fingerprint;
      const scenario = SCENARIOS.find((entry) => entry.id === run.scenarioId);
      if (!scenario) {
        await runDropped();
        const afterDropped = state.run!.fingerprint;
        renderVerify(before === afterDropped, `dropped file · recorded ${before.slice(0, 16)}… · recomputed ${afterDropped.slice(0, 16)}…`);
        return;
      }
      await runScenario(scenario.id);
      const after = state.run!.fingerprint;
      renderVerify(before === after, `recorded ${before.slice(0, 16)}… · recomputed ${after.slice(0, 16)}…`);
    })();
  });

  el('btnWaive').addEventListener('click', () => {
    const finding = selectedFinding();
    if (!finding) {
      toast('select a finding in the verdict column first');
      return;
    }
    const owner = el<HTMLInputElement>('l4owner').value.trim();
    const reason = el<HTMLInputElement>('l4reason').value.trim();
    const control = el<HTMLInputElement>('l4control').value.trim();
    const expires = el<HTMLInputElement>('l4expires').value.trim();
    try {
      state.ledger = appendWaiver(
        state.ledger,
        { owner, reason, compensatingControl: control, ...(expires ? { expiresOn: expires } : {}), decidedOn: TODAY },
        finding,
        { fingerprint: state.run!.fingerprint, decidedOn: TODAY },
      );
      persist();
      render();
      toast(`waived ${finding.code} — the verdict above is unchanged`);
    } catch (error) {
      toast((error as Error).message);
    }
  });

  el('btnRelease').addEventListener('click', () => {
    const finding = selectedFinding();
    if (!finding) return;
    const c = classification();
    const entry = c?.entries.find((candidate) => candidate.code === finding.code && candidate.recordIndex === finding.recordIndex);
    if (!entry?.waiverId) {
      toast('this finding has no waiver to release');
      return;
    }
    try {
      state.ledger = appendRelease(
        state.ledger,
        {
          owner: el<HTMLInputElement>('l4owner').value.trim() || 'demo operator',
          reason: el<HTMLInputElement>('l4reason').value.trim() || 'exception withdrawn in the demo',
          control: el<HTMLInputElement>('l4control').value.trim() || 'waiver withdrawn',
          decidedOn: TODAY,
        },
        entry.waiverId,
      );
      persist();
      render();
      toast('released — the finding is open again');
    } catch (error) {
      toast((error as Error).message);
    }
  });

  el('btnLedger').addEventListener('click', () => {
    const integrity = verifyLedger(state.ledger);
    toast(integrity.ok ? 'ledger chain intact' : `ledger BROKEN at seq ${integrity.firstInvalidSeq}`);
  });

  el('btnDownload').addEventListener('click', () => {
    const blob = new Blob([serialiseLedger(state.ledger)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'ledger.json';
    link.click();
    URL.revokeObjectURL(link.href);
  });

  el('btnDrop').addEventListener('click', () => {
    void (async () => {
      try {
        await runDropped();
      } catch (error) {
        toast((error as Error).message);
      }
    })();
  });

  for (const [zone, key] of [['dropFile', 'droppedFile'], ['dropCopybook', 'droppedCopybook']] as const) {
    const node = el(zone);
    const accept = (file: File | undefined): void => {
      if (!file) return;
      void file.arrayBuffer().then((buffer) => {
        state[key] = { name: file.name, bytes: new Uint8Array(buffer) };
        el('dropped').textContent = `${state.droppedFile ? `file: ${state.droppedFile.name} (${state.droppedFile.bytes.length} bytes)` : ''}` +
          `${state.droppedCopybook ? ` · copybook: ${state.droppedCopybook.name}` : ''}`;
      });
    };
    node.addEventListener('dragover', (event) => {
      event.preventDefault();
      node.classList.add('over');
    });
    node.addEventListener('dragleave', () => node.classList.remove('over'));
    node.addEventListener('drop', (event) => {
      event.preventDefault();
      node.classList.remove('over');
      accept(event.dataTransfer?.files[0]);
    });
    node.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = key === 'droppedCopybook' ? '.cpy,.cbl,.txt' : '.txt,.dat,.bai';
      input.onchange = () => accept(input.files?.[0]);
      input.click();
    });
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(LEDGER_KEY, serialiseLedger(state.ledger));
  } catch {
    /* a demo may run with storage disabled; the register still works in memory */
  }
}

function restore(): void {
  try {
    const text = window.localStorage.getItem(LEDGER_KEY);
    if (text) state.ledger = parseLedger(text);
  } catch {
    state.ledger = emptyLedger();
  }
}

function stripGuarantees(): void {
  el('strip-top').innerHTML = '<span class="tag">Guaranteed</span>' +
    GUARANTEES.guaranteed.map((item) => `<span class="item">${esc(item)}</span>`).join('');
  el('strip-bottom').innerHTML = '<span class="tag">Not guaranteed — a human decides</span>' +
    GUARANTEES.notGuaranteed.map((item) => `<span class="item">${esc(item)}</span>`).join('');
}

function boot(): void {
  wire();
  stripGuarantees();
  restore();
  renderScenarios();
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('scenario');
  const id = requested && SCENARIOS.some((entry) => entry.id === requested) ? requested : 'S3';
  void runScenario(id).catch((error) => toast((error as Error).message));
}

boot();

// Exposed for the headless check (`scripts/check-static.py`) so it can assert on state rather
// than on pixels alone. It is read-only in practice: the demo itself never calls it.
(window as unknown as { demo: unknown }).demo = {
  state,
  SCENARIOS,
  today: TODAY,
  /** Run a scenario and resolve when the view is on screen. */
  async run(id: string) {
    await runScenario(id);
    return state.run?.fingerprint ?? null;
  },
  classification,
  verifyLedger,
};
