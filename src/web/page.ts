/**
 * The single page.
 *
 * One deliberate screen, three columns, two guarantee strips: what came in, what
 * was decided, and the bytes that decision rests on. No component library, no
 * router, no build step - the whole surface is one document served by
 * `server.ts`, so a reviewer can open it and read it top to bottom.
 *
 * `.kiro/steering/tech.md` names Vite + React for this screen. This environment
 * cannot install packages (no network at build time, and the repo ships no React),
 * so the screen is written as one dependency-free document. `design.md` §10.6
 * records the deviation and what it costs: nothing in the behaviour.
 */
import { PAGE_CSS } from './css.js';

export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>「820」: resurrection workbench</title>
<style>
${PAGE_CSS}

</style>
</head>
<body>
<header>
  <h1>「820」 resurrection workbench</h1>
  <span class="sub">fixed-width 820/823 + BAI2: verdict by code, narration by agent</span>
  <span class="fingerprint" id="fp">fingerprint -</span>
</header>

<div class="strip top" id="strip-top"><span class="tag">Guaranteed</span><span class="item brief">6 checks: format, layout, arithmetic, references, replay, grounding</span><button type="button" class="strip-toggle" aria-expanded="false">Show all (6)</button><div class="strip-items"><span class="item">loading...</span></div></div>

<main>
  <section class="col col-left">
    <h2>1. Input</h2>
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
    <div class="drop" id="dropFile"><strong>Drop a payment file</strong>bytes are read in the browser; never written</div>
    <div class="drop" id="dropCopybook"><strong>Drop its copybook</strong>fixed-width only</div>
    <div class="small muted" id="dropped" style="margin-top:6px"></div>

    <h3>Records as read</h3>
    <ul class="records" id="records"></ul>
  </section>

  <section class="col col-mid">
    <h2>2. Verdict</h2>
    <div class="card">
      <div class="verdict">
        <span class="chip info" id="status">-</span>
        <span class="muted small" id="verdictMeta">run a case to see a verdict</span>
      </div>
      <div class="counters">
        <div class="counter"><div class="n" id="cDet">-</div><div class="k">details</div></div>
        <div class="counter"><div class="n" id="cFind">-</div><div class="k">findings</div></div>
        <div class="counter"><div class="n" id="cMatched">-</div><div class="k">refs matched</div></div>
        <div class="counter"><div class="n" id="cUnmatched">-</div><div class="k">refs unmatched</div></div>
      </div>
      <h3>Control totals (minor units)</h3>
      <div class="tablewrap"><table id="totals"><thead><tr><th>currency</th><th>declared</th><th>summed</th><th>delta</th></tr></thead><tbody></tbody></table></div>
    </div>

    <h3>Findings</h3>
    <ul class="findings" id="findings"></ul>
    <div class="empty" id="noFindings">No findings: every control total, reference and value date agrees.</div>

    <h3>Parse issues</h3>
    <ul class="issues" id="issues"></ul>
  </section>

  <section class="col col-right">
    <h2>3. Evidence: the bytes this decision rests on</h2>
    <div class="card">
      <div class="small muted" id="evidenceNote">Select a finding to highlight its field.</div>
      <div class="ruler" id="ruler"></div>
      <div class="bytes" id="bytes"></div>
      <div id="fieldmeta"></div>
      <div id="explain"></div>
    </div>
  </section>
</main>

<div class="strip bottom" id="strip-bottom"><span class="tag">Not guaranteed: a human decides</span><span class="item brief">4 limits: legal adequacy, exception sign-off, unmodelled clauses, source authenticity</span><button type="button" class="strip-toggle" aria-expanded="false">Show all (4)</button><div class="strip-items"><span class="item">loading...</span></div></div>

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

  // One compact strip: tag, a one-line summary, a toggle and the full list (closed by default).
  function stripHtml(tag, brief, items) {
    var html = '<span class="tag">' + esc(tag) + '</span><span class="item brief">' + esc(brief) + '</span>' +
      '<button type="button" class="strip-toggle" aria-expanded="false">Show all (' + items.length + ')</button>' +
      '<div class="strip-items">';
    for (var i = 0; i < items.length; i++) html += '<span class="item">' + esc(items[i]) + '</span>';
    return html + '</div>';
  }

  function wireStrip(id) {
    var node = el(id);
    node.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('.strip-toggle') : null;
      if (!button) return;
      var open = node.className.indexOf('open') < 0;
      node.className = open ? node.className + ' open' : node.className.replace(' open', '');
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      button.textContent = open ? 'Hide' : 'Show all (' + node.querySelectorAll('.strip-items .item').length + ')';
    });
  }
  wireStrip('strip-top');
  wireStrip('strip-bottom');

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
      fillSelect(el('selCopybook'), data.copybooks, '(none; BAI2 needs no copybook)');
      fillSelect(el('selFile'), data.files, '(choose a payment file)');
      fillSelect(el('selBank'), data.files, '(no bank side)');
      el('strip-top').innerHTML = stripHtml('Guaranteed',
        '6 checks: format, layout, arithmetic, references, replay, grounding', data.guarantees.guaranteed);
      el('strip-bottom').innerHTML = stripHtml('Not guaranteed: a human decides',
        '4 limits: legal adequacy, exception sign-off, unmodelled clauses, source authenticity', data.guarantees.notGuaranteed);
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
    el('evidenceNote').textContent = 'reconciling...';
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
      var label = ch === ' ' ? '.' : esc(ch);
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
      var label = ch === ' ' ? '.' : esc(ch);
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
        ? 'No findings. Record ' + spot.index + ' (' + spot.side + ') sliced by its own spec: every field at its declared byte offset.'
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
    el('evidenceNote').textContent = evidence.note + ', ' + evidence.side + ' file';
    renderBytes(record, evidence.span || null);
    var rows = '<dt>record</dt><dd>' + esc(evidence.side) + ' #' + esc(evidence.recordIndex) + '</dd>';
    if (evidence.field) rows += '<dt>field</dt><dd>' + esc(evidence.field) + (evidence.pic ? ', ' + esc(evidence.pic) : '') + '</dd>';
    if (evidence.span) rows += '<dt>bytes</dt><dd>' + esc(evidence.span.start) + '-' + esc(evidence.span.start + evidence.span.length - 1) + ' (' + esc(evidence.span.length) + ' bytes)</dd>';
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
      '<span class="small muted">L3: ' + esc(explanation.adapter) + '; cites ' + esc((explanation.citedValues || []).length) + ' value(s)</span></div>' +
      '<div class="cause">' + esc(explanation.cause) + '</div>' +
      '<div class="fix">' + esc(explanation.suggestedFix) + '</div>';
    if (explanation.citedValues && explanation.citedValues.length) {
      html += '<div class="cited">' + explanation.citedValues.map(function (v) { return '<span>' + esc(v) + '</span>'; }).join('') + '</div>';
    }
    if (explanation.rejection) {
      html += '<div class="small" style="color:#e2b33c;margin-top:8px">blocked draft cited ' +
        esc(explanation.rejection.unsupported.join(', ')) + '; replaced with INSUFFICIENT_EVIDENCE</div>';
    }
    html += '<div class="small muted" style="margin-top:6px">citation ' + esc(explanation.citation) + '</div></div>';
    el('explain').innerHTML = html;
  }

  function render() {
    var view = state.view;
    if (!view) return;
    el('fp').textContent = 'fingerprint ' + view.fingerprint.slice(0, 16) + '...';
    var status = el('status');
    status.textContent = view.status;
    status.className = 'chip ' + (view.status === 'PASS' ? 'pass' : view.status === 'INCOMPLETE' ? 'warn' : 'fail');
    el('verdictMeta').textContent = view.files.payment.details + ' details, ' + view.files.payment.format +
      (view.files.bank ? ' + bank ' + view.files.bank.details + ' details (' + view.files.bank.format + ')' : '') +
      (view.summary.blockingParseIssues ? ', ' + view.summary.blockingParseIssues + ' blocking parse issue(s)' : '') +
      '; ' + view.files.payment.path;
    el('cDet').textContent = view.files.payment.details;
    el('cFind').textContent = view.findings.length;
    el('cMatched').textContent = view.summary.referencesMatched;
    el('cUnmatched').textContent = view.summary.referencesUnmatched;

    var totalsBody = '';
    for (var i = 0; i < view.totals.length; i++) {
      var t = view.totals[i];
      var basis = t.basis ? '<div class="small muted">' + esc(t.basis) +
        (t.credits || t.debits ? '; credits ' + esc(t.credits || '0') + ' / debits ' + esc(t.debits || '0') : '') + '</div>' : '';
      totalsBody += '<tr><td>' + esc(t.currency) + basis + '</td><td>' + esc(t.declared) + '</td><td>' + esc(t.computed) +
        '</td><td class="' + (t.delta.charAt(0) === '-' ? 'neg' : '') + '">' + esc(t.delta) + '</td></tr>';
    }
    el('totals').querySelector('tbody').innerHTML = totalsBody || '<tr><td colspan="4" class="muted">no declared total</td></tr>';

    var list = '';
    for (var j = 0; j < view.findings.length; j++) {
      var f = view.findings[j];
      list += '<li data-i="' + j + '" class="' + (j === state.selected ? 'sel' : '') + '">' +
        '<div class="code"><span class="chip fail">' + esc(f.code) + '</span> record ' + esc(f.recordIndex) + (f.field ? '; ' + esc(f.field) : '') + '</div>' +
        (f.reference ? '<div class="meta">ref ' + esc(f.reference) + '</div>' : '') +
        '<div class="amt">declared ' + esc(f.declared === undefined ? '-' : f.declared) + '; computed ' + esc(f.computed === undefined ? '-' : f.computed) + '; delta ' + esc(f.delta === undefined ? '-' : f.delta) + '</div>' +
        '</li>';
    }
    el('findings').innerHTML = list;
    el('findings').style.display = view.findings.length ? 'block' : 'none';
    el('noFindings').style.display = view.findings.length ? 'none' : 'block';

    var issues = '';
    for (var k = 0; k < view.issues.length; k++) {
      var issue = view.issues[k];
      issues += '<li>' + esc(issue.side) + ', ' + esc(issue.code) + (issue.recordIndex !== undefined ? ' @record ' + esc(issue.recordIndex) : '') + ': ' + esc(issue.detail) + '</li>';
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
    el('dropped').textContent = (state.droppedFile ? 'file: ' + state.droppedFile.name + ' (' + state.droppedFile.bytes.length + ' bytes)' : '') +
      (state.droppedCopybook ? ', copybook: ' + state.droppedCopybook.name : '');
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
