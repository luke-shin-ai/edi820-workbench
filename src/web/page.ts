/**
 * The single page.
 *
 * One deliberate screen, three columns, two guarantee strips: what came in, what
 * was decided, and the bytes that decision rests on. No component library, no
 * router, no build step — the whole surface is one document served by
 * `server.ts`, so a reviewer can open it and read it top to bottom.
 *
 * `.kiro/steering/tech.md` names Vite + React for this screen. This environment
 * cannot install packages (no network at build time, and the repo ships no React),
 * so the screen is written as one dependency-free document. `design.md` §10.6
 * records the deviation and what it costs: nothing in the behaviour.
 */
export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>「820」 — resurrection workbench</title>
<style>
  :root {
    --bg: #0d1117;
    --panel: #141a22;
    --panel-2: #1b232d;
    --line: #26303c;
    --ink: #e6edf3;
    --muted: #8b98a5;
    --pass: #2ea043;
    --fail: #d0453e;
    --hl: #f0b429;
    --accent: #4a9eda;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); }
  body { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  header {
    display: flex; align-items: baseline; gap: 16px; padding: 12px 20px;
    border-bottom: 1px solid var(--line); background: var(--panel);
  }
  header h1 { font-size: 16px; margin: 0; letter-spacing: 0.04em; }
  header .sub { color: var(--muted); font-size: 12px; }
  header .fingerprint { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--muted); }
  .strip { display: flex; gap: 8px; align-items: center; padding: 6px 20px; font-size: 12px; flex-wrap: wrap; }
  .strip.top { background: #10241a; border-bottom: 1px solid #1d3b2b; }
  .strip.bottom { background: #2a2010; border-top: 1px solid #4a3a16; position: sticky; bottom: 0; }
  .strip .tag { font-weight: 700; letter-spacing: 0.06em; font-size: 10px; text-transform: uppercase; }
  .strip.top .tag { color: #57c477; }
  .strip.bottom .tag { color: #e2b33c; }
  .strip .item { color: var(--muted); border: 1px solid var(--line); border-radius: 10px; padding: 1px 8px; }
  main { display: grid; grid-template-columns: 330px minmax(360px, 1fr) minmax(420px, 1.25fr); gap: 1px; background: var(--line); min-height: calc(100vh - 120px); }
  section.col { background: var(--bg); padding: 14px 16px 28px; overflow: auto; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin: 0 0 10px; }
  h3 { font-size: 12px; margin: 16px 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
  label { display: block; font-size: 11px; color: var(--muted); margin: 10px 0 3px; }
  select, input[type=text] {
    width: 100%; background: var(--panel-2); color: var(--ink); border: 1px solid var(--line);
    border-radius: 6px; padding: 6px 8px; font-family: var(--mono); font-size: 12px;
  }
  button {
    background: var(--accent); color: #08131d; border: 0; border-radius: 6px; padding: 8px 14px;
    font-weight: 700; cursor: pointer; font-size: 13px;
  }
  button.ghost { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
  button:disabled { opacity: 0.5; cursor: default; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row > * { flex: 1; }
  .drop {
    border: 1px dashed var(--line); border-radius: 8px; padding: 14px; text-align: center;
    color: var(--muted); font-size: 12px; margin-top: 8px; cursor: pointer;
  }
  .drop.over { border-color: var(--hl); color: var(--hl); }
  .drop strong { color: var(--ink); display: block; font-size: 12px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
  .verdict { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .chip { font-family: var(--mono); font-size: 12px; padding: 2px 9px; border-radius: 999px; border: 1px solid; }
  .chip.pass { color: #79d492; border-color: #2b5a3a; background: #10241a; }
  .chip.fail { color: #ff9c94; border-color: #5c2a26; background: #2a1513; }
  .chip.warn { color: #e2b33c; border-color: #4a3a16; background: #2a2010; }
  .chip.info { color: #9dc7ea; border-color: #25405a; background: #101c28; }
  .counters { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0 4px; }
  .counter { background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
  .counter .n { font-size: 20px; font-family: var(--mono); }
  .counter .k { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
  table { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 12px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
  td.neg { color: #ff9c94; }
  .findings { list-style: none; margin: 0; padding: 0; }
  .findings li {
    border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px; margin-bottom: 6px;
    cursor: pointer; background: var(--panel);
  }
  .findings li:hover { border-color: var(--accent); }
  .findings li.sel { border-color: var(--hl); background: #211b0d; }
  .findings .code { font-family: var(--mono); font-size: 12px; }
  .findings .meta { color: var(--muted); font-size: 11px; margin-top: 2px; }
  .findings .amt { font-family: var(--mono); font-size: 11px; color: #cbd5e1; margin-top: 3px; }
  .muted { color: var(--muted); }
  .small { font-size: 11px; }
  .bytes {
    font-family: var(--mono); font-size: 12px; background: #080d13; border: 1px solid var(--line);
    border-radius: 8px; padding: 10px; white-space: pre-wrap; word-break: break-all; line-height: 1.7;
  }
  .ruler { font-family: var(--mono); font-size: 10px; color: #4e5c6b; white-space: pre; overflow: hidden; margin-bottom: 2px; }
  .byte { border-bottom: 1px solid transparent; }
  .byte.hl { background: var(--hl); color: #191100; border-radius: 2px; }
  .fieldmeta { display: grid; grid-template-columns: 90px 1fr; gap: 2px 10px; font-size: 12px; margin: 10px 0; }
  .fieldmeta dt { color: var(--muted); }
  .fieldmeta dd { margin: 0; font-family: var(--mono); }
  .explain { border-left: 3px solid var(--accent); padding: 2px 0 2px 10px; margin-top: 10px; }
  .explain.blocked { border-left-color: var(--hl); }
  .explain .cause { margin: 6px 0; }
  .explain .fix { color: #b7c6d4; }
  .cited { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .cited span { font-family: var(--mono); font-size: 11px; border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; color: #9dc7ea; }
  .issues { list-style: none; padding: 0; margin: 0; }
  .issues li { font-size: 11px; color: #d9c48a; border-bottom: 1px solid var(--line); padding: 5px 0; }
  .records { list-style: none; padding: 0; margin: 0; font-family: var(--mono); font-size: 11px; max-height: 320px; overflow: auto; }
  .records li { white-space: pre; color: #7f8c9a; border-bottom: 1px solid #1a222c; padding: 2px 0; cursor: pointer; }
  .records li.on { color: var(--ink); background: #16202b; }
  .f0 { background: #1f4f6b; } .f1 { background: #6b4a1f; } .f2 { background: #4a2a6b; }
  .f3 { background: #1f6b45; } .f4 { background: #6b2540; } .f5 { background: #3a4a5c; }
  .byte.f0, .byte.f1, .byte.f2, .byte.f3, .byte.f4, .byte.f5 { color: #eaf2fa; }
  .legend { margin-top: 12px; font-size: 11px; width: 100%; }
  .legend td { padding: 2px 6px; border-bottom: 1px solid #1a222c; }
  .legend .sw { width: 12px; height: 12px; display: inline-block; border-radius: 2px; }
  .legend .nm { font-family: var(--mono); color: #cbd5e1; }
  .legend .pv { font-family: var(--mono); color: #9dc7ea; }
  .records li.issue { color: #e2b33c; }
  .records li.trailer { color: #5d6b7a; }
  .empty { color: var(--muted); font-size: 12px; padding: 12px 0; }
  .err { color: #ff9c94; font-size: 12px; font-family: var(--mono); white-space: pre-wrap; }
</style>
</head>
<body>
<header>
  <h1>「820」 resurrection workbench</h1>
  <span class="sub">fixed-width 820/823 + BAI2 · verdict by code, narration by agent</span>
  <span class="fingerprint" id="fp">fingerprint —</span>
</header>

<div class="strip top" id="strip-top"><span class="tag">Guaranteed</span><span class="item">loading…</span></div>

<main>
  <section class="col col-left">
    <h2>1 · Input</h2>
    <div class="card">
      <label for="selCopybook">Copybook (the byte contract)</label>
      <select id="selCopybook"></select>
      <label for="selFile">Payment file</label>
      <select id="selFile"></select>
      <label for="selBank">Bank side (optional)</label>
      <select id="selBank"></select>
      <label for="selBankFormat">Bank format</label>
      <select id="selBankFormat">
        <option value="fixed">fixed-width (needs its copybook)</option>
        <option value="bai2">BAI2 (no copybook)</option>
      </select>
      <label for="inpWindow">Settlement window (inclusive)</label>
      <input id="inpWindow" type="text" value="2026-11-18..2026-11-20" />
      <div class="row" style="margin-top:12px">
        <button id="btnRun">Run reconcile</button>
        <button id="btnPass" class="ghost" title="820-good + 823-bank">Sample PASS</button>
        <button id="btnFail" class="ghost" title="820-bad + 823-bank">Sample FAIL</button>
      </div>
    </div>

    <h3>Drop your own files</h3>
    <div class="drop" id="dropFile"><strong>Drop a payment file</strong>bytes are read in the browser · never written</div>
    <div class="drop" id="dropCopybook"><strong>Drop its copybook</strong>fixed-width only</div>
    <div class="small muted" id="dropped" style="margin-top:6px"></div>

    <h3>Records as read</h3>
    <ul class="records" id="records"></ul>
  </section>

  <section class="col col-mid">
    <h2>2 · Verdict</h2>
    <div class="card">
      <div class="verdict">
        <span class="chip info" id="status">—</span>
        <span class="muted small" id="verdictMeta">run a case to see a verdict</span>
      </div>
      <div class="counters">
        <div class="counter"><div class="n" id="cDet">—</div><div class="k">details</div></div>
        <div class="counter"><div class="n" id="cFind">—</div><div class="k">findings</div></div>
        <div class="counter"><div class="n" id="cMatched">—</div><div class="k">refs matched</div></div>
        <div class="counter"><div class="n" id="cUnmatched">—</div><div class="k">refs unmatched</div></div>
      </div>
      <h3>Control totals (minor units)</h3>
      <table id="totals"><thead><tr><th>currency</th><th>declared</th><th>summed</th><th>delta</th></tr></thead><tbody></tbody></table>
    </div>

    <h3>Findings</h3>
    <ul class="findings" id="findings"></ul>
    <div class="empty" id="noFindings">No findings — every control total, reference and value date agrees.</div>

    <h3>Parse issues</h3>
    <ul class="issues" id="issues"></ul>
  </section>

  <section class="col col-right">
    <h2>3 · Evidence — the bytes this decision rests on</h2>
    <div class="card">
      <div class="small muted" id="evidenceNote">Select a finding to highlight its field.</div>
      <div class="ruler" id="ruler"></div>
      <div class="bytes" id="bytes"></div>
      <div id="fieldmeta"></div>
      <div id="explain"></div>
    </div>
  </section>
</main>

<div class="strip bottom" id="strip-bottom"><span class="tag">Not guaranteed — a human decides</span><span class="item">loading…</span></div>

<script>
(function () {
  var state = { samples: null, view: null, selected: -1, spotlight: null, droppedFile: null, droppedCopybook: null };

  function el(id) { return document.getElementById(id); }

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fail(err) {
    el('evidenceNote').textContent = 'run failed';
    el('bytes').innerHTML = '<span class="err">' + esc(err && err.message ? err.message : err) + '</span>';
  }

  function fillSelect(select, items, placeholder) {
    var html = '<option value="">' + esc(placeholder) + '</option>';
    for (var i = 0; i < items.length; i++) {
      html += '<option value="' + esc(items[i].value) + '">' + esc(items[i].label) + '</option>';
    }
    select.innerHTML = html;
  }

  function loadSamples() {
    return fetch('/api/samples').then(function (r) { return r.json(); }).then(function (data) {
      state.samples = data;
      fillSelect(el('selCopybook'), data.copybooks, '(none — BAI2 needs no copybook)');
      fillSelect(el('selFile'), data.files, '(choose a payment file)');
      fillSelect(el('selBank'), data.files, '(no bank side)');
      var stripTop = el('strip-top');
      var stripBottom = el('strip-bottom');
      stripTop.innerHTML = '<span class="tag">Guaranteed</span>' + data.guarantees.guaranteed.map(function (g) {
        return '<span class="item">' + esc(g) + '</span>';
      }).join('');
      stripBottom.innerHTML = '<span class="tag">Not guaranteed — a human decides</span>' + data.guarantees.notGuaranteed.map(function (g) {
        return '<span class="item">' + esc(g) + '</span>';
      }).join('');
      return data;
    });
  }

  function requestForSample(file, bank, bankFormat) {
    var body = {
      filePath: file,
      copybookPath: el('selCopybook').value || 'samples/copybooks/820.cpy',
      format: 'fixed',
      bankPath: bank || undefined,
      bankFormat: bankFormat
    };
    var bankSelect = el('selBank').value;
    if (bank && bankFormat === 'fixed') body.bankCopybookPath = bank.indexOf('823') >= 0 ? 'samples/copybooks/823.cpy' : 'samples/copybooks/820.cpy';
    if (!bankSelect && !bank) delete body.bankPath;
    var w = el('inpWindow').value.trim();
    if (w) {
      var parts = w.split('..');
      if (parts.length === 2) body.window = { start: parts[0], end: parts[1] };
    }
    return body;
  }

  function runWith(body) {
    el('evidenceNote').textContent = 'reconciling…';
    return fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error) throw new Error(data.error);
      state.view = data.view;
      state.selected = data.view.findings.length > 0 ? 0 : -1;
      state.spotlight = { side: 'payment', index: firstDetailIndex(data.view, 'payment') };
      render();
    }).catch(fail);
  }

  function runSelection() {
    var file = el('selFile').value;
    if (state.droppedFile) return runWith(droppedRequest());
    if (!file) { fail('choose a payment file, or drop one'); return; }
    runWith(requestForSample(file, el('selBank').value, el('selBankFormat').value));
  }

  function droppedRequest() {
    var body = {
      fileBase64: bytesToBase64(state.droppedFile.bytes),
      fileName: state.droppedFile.name,
      format: el('selBankFormat').value === 'bai2' && state.droppedFile.name.indexOf('bai2') >= 0 ? 'bai2' : 'fixed'
    };
    if (state.droppedCopybook) {
      body.copybookBase64 = bytesToBase64(state.droppedCopybook.bytes);
      body.copybookName = state.droppedCopybook.name;
    } else body.copybookPath = el('selCopybook').value || 'samples/copybooks/820.cpy';
    return body;
  }

  function firstDetailIndex(view, side) {
    for (var i = 0; i < view.records.length; i++) {
      if (view.records[i].side === side && !view.records[i].isTrailer) return view.records[i].index;
    }
    return 0;
  }

  function findRecord(view, side, index) {
    for (var i = 0; i < view.records.length; i++) {
      if (view.records[i].side === side && view.records[i].index === index) return view.records[i];
    }
    return null;
  }

  function renderFields(record) {
    if (!record) { el('bytes').textContent = ''; el('ruler').textContent = ''; el('fieldmeta').innerHTML = ''; return; }
    var raw = record.raw;
    var owner = [];
    for (var f = 0; f < record.fields.length; f++) {
      var field = record.fields[f];
      for (var p = 0; p < field.length; p++) owner[field.start - 1 + p] = f % 6;
    }
    var html = '';
    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      var label = ch === ' ' ? '·' : esc(ch);
      html += '<span class="byte' + (owner[i] === undefined ? '' : ' f' + owner[i]) + '" title="byte ' + (i + 1) + '">' + label + '</span>';
    }
    el('bytes').innerHTML = html;
    var ruler = '';
    for (var q = 0; q < raw.length; q += 10) {
      var num = String(q + 1);
      while (num.length < 10) num += ' ';
      ruler += num;
    }
    el('ruler').textContent = ruler;
    var rows = '<tr><th>field</th><th>pic</th><th>bytes</th><th>as read</th></tr>';
    for (var g = 0; g < record.fields.length; g++) {
      var fd = record.fields[g];
      rows += '<tr><td><span class="sw f' + (g % 6) + '"></span><span class="nm">' + esc(fd.name) + '</span></td>' +
        '<td class="nm">' + esc(fd.pic) + '</td>' +
        '<td class="nm">' + esc(fd.start) + '-' + esc(fd.start + fd.length - 1) + '</td>' +
        '<td class="pv">' + esc(JSON.stringify(fd.text)) + '</td></tr>';
    }
    el('fieldmeta').innerHTML = '<table class="legend">' + rows + '</table>';
  }

  function renderBytes(record, span) {
    if (!record) { el('bytes').textContent = ''; el('ruler').textContent = ''; return; }
    var raw = record.raw;
    var html = '';
    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      var label = ch === ' ' ? '·' : esc(ch);
      var cls = 'byte';
      if (span && i >= span.start - 1 && i < span.start - 1 + span.length) cls += ' hl';
      html += '<span class="' + cls + '" title="byte ' + (i + 1) + '">' + label + '</span>';
    }
    el('bytes').innerHTML = html;
    var ruler = '';
    for (var p = 0; p < raw.length; p += 10) {
      var num = String(p + 1);
      while (num.length < 10) num += ' ';
      ruler += num;
    }
    el('ruler').textContent = ruler;
  }

  function renderEvidence() {
    var view = state.view;
    var finding = view && state.selected >= 0 ? view.findings[state.selected] : null;
    if (!view) { el('evidenceNote').textContent = 'Select a finding to highlight its field.'; renderBytes(null); el('fieldmeta').innerHTML = ''; el('explain').innerHTML = ''; return; }
    if (!finding) {
      var spot = state.spotlight || { side: 'payment', index: firstDetailIndex(view, 'payment') };
      var spotRecord = findRecord(view, spot.side, spot.index);
      el('evidenceNote').textContent = view.findings.length === 0
        ? 'No findings. Record ' + spot.index + ' (' + spot.side + ') sliced by its own spec — every field at its declared byte offset.'
        : 'Pick a finding to highlight the field it names, or a record below to read its layout.';
      renderFields(spotRecord);
      el('explain').innerHTML = view.findings.length === 0
        ? '<div class="muted small">The deterministic layers produced no discrepancy to explain, so L3 was not asked to narrate anything.</div>'
        : '<div class="muted small">L3 narrates a finding. Select one on the left of this panel.</div>';
      return;
    }

    var evidence = finding.evidence;
    var record = null;
    for (var i = 0; i < view.records.length; i++) {
      if (view.records[i].side === evidence.side && view.records[i].index === evidence.recordIndex) { record = view.records[i]; break; }
    }
    el('evidenceNote').textContent = evidence.note + ' · ' + evidence.side + ' file';
    renderBytes(record, evidence.span || null);
    var rows = '<dt>record</dt><dd>' + esc(evidence.side) + ' #' + esc(evidence.recordIndex) + '</dd>';
    if (evidence.field) rows += '<dt>field</dt><dd>' + esc(evidence.field) + (evidence.pic ? ' · ' + esc(evidence.pic) : '') + '</dd>';
    if (evidence.span) rows += '<dt>bytes</dt><dd>' + esc(evidence.span.start) + '–' + esc(evidence.span.start + evidence.span.length - 1) + ' (' + esc(evidence.span.length) + ' bytes)</dd>';
    if (evidence.fieldText !== undefined) rows += '<dt>as read</dt><dd>' + esc(JSON.stringify(evidence.fieldText)) + '</dd>';
    if (finding.declared !== undefined) rows += '<dt>declared</dt><dd>' + esc(finding.declared) + '</dd>';
    if (finding.computed !== undefined) rows += '<dt>computed</dt><dd>' + esc(finding.computed) + '</dd>';
    if (finding.delta !== undefined) rows += '<dt>delta</dt><dd>' + esc(finding.delta) + '</dd>';
    el('fieldmeta').innerHTML = '<dl class="fieldmeta">' + rows + '</dl>';

    var explanation = finding.explanation;
    if (!explanation) {
      el('explain').innerHTML = '<div class="muted small">No explanation was produced for this finding.</div>';
      return;
    }
    var blocked = explanation.status !== 'EXPLAINED';
    var html = '<div class="explain ' + (blocked ? 'blocked' : '') + '">' +
      '<div class="row" style="gap:8px;align-items:center"><span class="chip ' + (blocked ? 'warn' : 'info') + '">' + esc(explanation.status) + '</span>' +
      '<span class="small muted">L3 · ' + esc(explanation.adapter) + ' · cites ' + esc((explanation.citedValues || []).length) + ' value(s)</span></div>' +
      '<div class="cause">' + esc(explanation.cause) + '</div>' +
      '<div class="fix">' + esc(explanation.suggestedFix) + '</div>';
    if (explanation.citedValues && explanation.citedValues.length) {
      html += '<div class="cited">' + explanation.citedValues.map(function (v) { return '<span>' + esc(v) + '</span>'; }).join('') + '</div>';
    }
    if (explanation.rejection) {
      html += '<div class="small" style="color:#e2b33c;margin-top:8px">blocked draft cited ' +
        esc(explanation.rejection.unsupported.join(', ')) + ' — replaced with INSUFFICIENT_EVIDENCE</div>';
    }
    html += '<div class="small muted" style="margin-top:6px">citation ' + esc(explanation.citation) + '</div></div>';
    el('explain').innerHTML = html;
  }

  function render() {
    var view = state.view;
    if (!view) return;
    el('fp').textContent = 'fingerprint ' + view.fingerprint.slice(0, 16) + '…';
    var status = el('status');
    status.textContent = view.status;
    status.className = 'chip ' + (view.status === 'PASS' ? 'pass' : view.status === 'INCOMPLETE' ? 'warn' : 'fail');
    el('verdictMeta').textContent = view.files.payment.details + ' details · ' + view.files.payment.format +
      (view.files.bank ? ' + bank ' + view.files.bank.details + ' details (' + view.files.bank.format + ')' : '') +
      (view.summary.blockingParseIssues ? ' · ' + view.summary.blockingParseIssues + ' blocking parse issue(s)' : '') +
      ' · ' + view.files.payment.path;
    el('cDet').textContent = view.files.payment.details;
    el('cFind').textContent = view.findings.length;
    el('cMatched').textContent = view.summary.referencesMatched;
    el('cUnmatched').textContent = view.summary.referencesUnmatched;

    var totalsBody = '';
    for (var i = 0; i < view.totals.length; i++) {
      var t = view.totals[i];
      var basis = t.basis ? '<div class="small muted">' + esc(t.basis) +
        (t.credits || t.debits ? ' · credits ' + esc(t.credits || '0') + ' / debits ' + esc(t.debits || '0') : '') + '</div>' : '';
      totalsBody += '<tr><td>' + esc(t.currency) + basis + '</td><td>' + esc(t.declared) + '</td><td>' + esc(t.computed) +
        '</td><td class="' + (t.delta.charAt(0) === '-' ? 'neg' : '') + '">' + esc(t.delta) + '</td></tr>';
    }
    el('totals').querySelector('tbody').innerHTML = totalsBody || '<tr><td colspan="4" class="muted">no declared total</td></tr>';

    var list = '';
    for (var j = 0; j < view.findings.length; j++) {
      var f = view.findings[j];
      list += '<li data-i="' + j + '" class="' + (j === state.selected ? 'sel' : '') + '">' +
        '<div class="code"><span class="chip fail">' + esc(f.code) + '</span> record ' + esc(f.recordIndex) + (f.field ? ' · ' + esc(f.field) : '') + '</div>' +
        (f.reference ? '<div class="meta">ref ' + esc(f.reference) + '</div>' : '') +
        '<div class="amt">declared ' + esc(f.declared === undefined ? '—' : f.declared) + ' · computed ' + esc(f.computed === undefined ? '—' : f.computed) + ' · delta ' + esc(f.delta === undefined ? '—' : f.delta) + '</div>' +
        '</li>';
    }
    el('findings').innerHTML = list;
    el('findings').style.display = view.findings.length ? 'block' : 'none';
    el('noFindings').style.display = view.findings.length ? 'none' : 'block';

    var issues = '';
    for (var k = 0; k < view.issues.length; k++) {
      var issue = view.issues[k];
      issues += '<li>' + esc(issue.side) + ' · ' + esc(issue.code) + (issue.recordIndex !== undefined ? ' @record ' + esc(issue.recordIndex) : '') + ' — ' + esc(issue.detail) + '</li>';
    }
    el('issues').innerHTML = issues;

    var records = '';
    for (var r = 0; r < view.records.length; r++) {
      var rec = view.records[r];
      var cls = rec.issues.length ? 'issue' : (rec.isTrailer ? 'trailer' : '');
      if (state.spotlight && state.spotlight.side === rec.side && state.spotlight.index === rec.index && state.selected < 0) cls += ' on';
      records += '<li class="' + cls + '" data-side="' + esc(rec.side) + '" data-index="' + esc(rec.index) + '">' +
        esc(rec.side.charAt(0)) + String(rec.index).padStart(3, '0') + '  ' + esc(rec.raw) + '</li>';
    }
    el('records').innerHTML = records;
    renderEvidence();
  }

  el('findings').addEventListener('click', function (event) {
    var li = event.target.closest ? event.target.closest('li[data-i]') : null;
    if (!li) return;
    state.selected = Number(li.getAttribute('data-i'));
    render();
  });

  el('records').addEventListener('click', function (event) {
    var li = event.target.closest ? event.target.closest('li[data-index]') : null;
    if (!li) return;
    state.spotlight = { side: li.getAttribute('data-side'), index: Number(li.getAttribute('data-index')) };
    state.selected = -1;
    render();
  });

  el('btnRun').addEventListener('click', runSelection);
  el('btnPass').addEventListener('click', function () {
    el('selCopybook').value = 'samples/copybooks/820.cpy';
    el('selFile').value = 'samples/data/820-good.txt';
    el('selBank').value = 'samples/data/823-bank.txt';
    el('selBankFormat').value = 'fixed';
    el('inpWindow').value = '2026-11-18..2026-11-20';
    state.droppedFile = null;
    runWith({ filePath: 'samples/data/820-good.txt', copybookPath: 'samples/copybooks/820.cpy', format: 'fixed', bankPath: 'samples/data/823-bank.txt', bankCopybookPath: 'samples/copybooks/823.cpy', bankFormat: 'fixed', window: { start: '2026-11-18', end: '2026-11-20' } });
  });
  el('btnFail').addEventListener('click', function () {
    el('selCopybook').value = 'samples/copybooks/820.cpy';
    el('selFile').value = 'samples/data/820-bad.txt';
    el('selBank').value = 'samples/data/823-bank.txt';
    el('selBankFormat').value = 'fixed';
    el('inpWindow').value = '2026-11-18..2026-11-20';
    state.droppedFile = null;
    runWith({ filePath: 'samples/data/820-bad.txt', copybookPath: 'samples/copybooks/820.cpy', format: 'fixed', bankPath: 'samples/data/823-bank.txt', bankCopybookPath: 'samples/copybooks/823.cpy', bankFormat: 'fixed', window: { start: '2026-11-18', end: '2026-11-20' } });
  });

  function bytesToBase64(bytes) {
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function readFileBytes(file) {
    return file.arrayBuffer().then(function (buffer) {
      return { name: file.name, bytes: new Uint8Array(buffer) };
    });
  }

  function describeDropped() {
    el('dropped').textContent = (state.droppedFile ? 'file: ' + state.droppedFile.name + ' · ' + state.droppedFile.bytes.length + ' bytes' : '') +
      (state.droppedCopybook ? ' · copybook: ' + state.droppedCopybook.name : '');
  }

  function wireDrop(zone, key, accept) {
    var node = el(zone);
    node.addEventListener('dragover', function (e) { e.preventDefault(); node.classList.add('over'); });
    node.addEventListener('dragleave', function () { node.classList.remove('over'); });
    node.addEventListener('drop', function (e) {
      e.preventDefault();
      node.classList.remove('over');
      var file = e.dataTransfer.files[0];
      if (!file) return;
      readFileBytes(file).then(function (read) { state[key] = read; describeDropped(); });
    });
    node.addEventListener('click', function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = function () {
        var file = input.files[0];
        if (!file) return;
        readFileBytes(file).then(function (read) { state[key] = read; describeDropped(); });
      };
      input.click();
    });
  }
  wireDrop('dropFile', 'droppedFile', '.txt,.dat,.bai');
  wireDrop('dropCopybook', 'droppedCopybook', '.cpy,.cbl,.txt');

  loadSamples().then(function () {
    var params = new URLSearchParams(window.location.search);
    var file = params.get('file');
    if (!file) return;
    var body = {
      filePath: file,
      format: params.get('format') || 'fixed',
      copybookPath: params.get('copybook') || undefined
    };
    if (params.get('bank')) {
      body.bankPath = params.get('bank');
      body.bankFormat = params.get('bankFormat') || 'fixed';
      body.bankCopybookPath = params.get('bankCopybook') || undefined;
    }
    var w = params.get('window');
    if (w) { var parts = w.split('..'); if (parts.length === 2) body.window = { start: parts[0], end: parts[1] }; }
    el('selFile').value = file;
    el('selCopybook').value = params.get('copybook') || el('selCopybook').value;
    if (params.get('bank')) el('selBank').value = params.get('bank');
    el('selBankFormat').value = params.get('bankFormat') || 'fixed';
    if (w) el('inpWindow').value = w;
    var select = params.get('select');
    runWith(body).then(function () {
      if (select !== null && state.view && state.view.findings.length > 0) {
        state.selected = Math.min(Number(select), state.view.findings.length - 1);
        render();
      }
    });
  });
})();
</script>
</body>
</html>`;
}
