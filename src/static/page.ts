/**
 * The static demo page — the same screen, with no server behind it.
 *
 * `docs/demo/index.html` is generated from this file by `scripts/build-static.ts`, and every
 * byte it shows comes from `bundle.js`: the parser, the reconciler, the BAI2 reader, the L3
 * template narrator and the L4 register all run in the tab. No request leaves the page after
 * the two files load, which is what makes the claim "nothing is uploaded" checkable instead of
 * a promise.
 */
import { PAGE_CSS } from '../web/css.js';

/** Styles only the static surface needs (the scenario rail and the L4 panel). */
const STATIC_CSS = `
  .scenarios { display: grid; gap: 6px; }
  .scenario {
    display: grid; grid-template-columns: 26px 1fr 38px; gap: 8px; align-items: center;
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
    padding: 7px 9px; cursor: pointer; text-align: left; color: var(--ink); font-size: 12px;
  }
  .scenario:hover { border-color: var(--accent); }
  .scenario.on { border-color: var(--hl); background: #211b0d; }
  .scenario .id { font-family: var(--mono); color: var(--muted); }
  .scenario .nm { font-family: var(--mono); font-size: 11px; }
  .scenario .exp { font-size: 10px; letter-spacing: 0.06em; }
  .scenario .exp.pass { color: #79d492; }
  .scenario .exp.fail { color: #ff9c94; }
  .banner {
    display: flex; gap: 10px; align-items: center; padding: 7px 20px; font-size: 12px;
    background: #101c28; border-bottom: 1px solid #25405a; color: #9dc7ea;
  }
  .banner b { color: #cfe6fb; font-weight: 600; }
  .l4 { border-top: 1px solid var(--line); margin-top: 14px; padding-top: 10px; }
  .l4 table { font-size: 11px; }
  .l4 .st { font-family: var(--mono); font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 1px solid; }
  .l4 .st.OPEN { color: #ff9c94; border-color: #5c2a26; background: #2a1513; }
  .l4 .st.WAIVED { color: #79d492; border-color: #2b5a3a; background: #10241a; }
  .l4 .st.EXPIRED { color: #e2b33c; border-color: #4a3a16; background: #2a2010; }
  .l4 .st.RELEASED { color: #9dc7ea; border-color: #25405a; background: #101c28; }
  .l4 form { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
  .l4 form input { font-size: 11px; padding: 5px 6px; }
  .l4 form .full { grid-column: 1 / span 2; }
  .l4 .chain { font-family: var(--mono); font-size: 10px; color: var(--muted); margin-top: 8px; word-break: break-all; }
  .l4 .row2 { display: flex; gap: 6px; margin-top: 8px; align-items: center; }
  .l4 button { padding: 5px 10px; font-size: 11px; }
  .l4 button.ghost { padding: 5px 10px; }
  .toast { position: fixed; right: 18px; bottom: 64px; background: var(--panel-2); border: 1px solid var(--accent);
    color: var(--ink); padding: 8px 12px; border-radius: 8px; font-size: 12px; opacity: 0; transition: opacity .2s; }
  .toast.on { opacity: 1; }
`;

export function renderStaticPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>「820」 — reconciliation workbench (runs in this tab)</title>
<style>
${PAGE_CSS}
${STATIC_CSS}
</style>
</head>
<body>
<header>
  <h1>「820」 resurrection workbench</h1>
  <span class="sub">fixed-width 820/823 + BAI2 · verdict by code, narration by agent</span>
  <span class="fingerprint" id="fp">fingerprint —</span>
</header>

<div class="banner">
  <b>Runs in this tab.</b>
  <span>Nothing is uploaded, nothing is stored on a server. The parser, reconciler, BAI2 reader, explainer and exception register are the same code the CLI runs, compiled for the browser.</span>
</div>

<div class="strip top" id="strip-top"><span class="tag">Guaranteed</span><span class="item">loading…</span></div>

<main>
  <section class="col col-left">
    <h2>1 · Scenario</h2>
    <div class="scenarios" id="scenarios"></div>

    <h3>Drop your own file</h3>
    <div class="drop" id="dropFile"><strong>Drop a payment file</strong>bytes are read here · the file never leaves the tab</div>
    <div class="drop" id="dropCopybook"><strong>Drop its copybook</strong>fixed-width only · 820.cpy is used otherwise</div>
    <div class="small muted" id="dropped" style="margin-top:6px"></div>
    <div class="row" style="margin-top:8px">
      <select id="selFormat">
        <option value="fixed">dropped file: fixed-width</option>
        <option value="bai2">dropped file: BAI2</option>
      </select>
      <button id="btnDrop" class="ghost">Run dropped</button>
    </div>
    <div class="row" style="margin-top:6px">
      <input id="inpWindow" type="text" value="2026-11-18..2026-11-20" />
    </div>

    <h3>Records as read</h3>
    <ul class="records" id="records"></ul>
  </section>

  <section class="col col-mid">
    <h2>2 · Verdict</h2>
    <div class="card">
      <div class="verdict">
        <span class="chip info" id="status">—</span>
        <span class="muted small" id="verdictMeta">pick a scenario</span>
      </div>
      <div class="counters">
        <div class="counter"><div class="n" id="cDet">—</div><div class="k">details</div></div>
        <div class="counter"><div class="n" id="cFind">—</div><div class="k">findings</div></div>
        <div class="counter"><div class="n" id="cMatched">—</div><div class="k">refs matched</div></div>
        <div class="counter"><div class="n" id="cOpen">—</div><div class="k">open exceptions</div></div>
      </div>
      <h3>Control totals (minor units)</h3>
      <table id="totals"><thead><tr><th>currency</th><th>declared</th><th>summed</th><th>delta</th></tr></thead><tbody></tbody></table>
      <div class="row" style="margin-top:10px">
        <button id="btnVerify">Re-derive and compare</button>
      </div>
      <div class="small" id="verifyOut" style="margin-top:6px;font-family:var(--mono)"></div>
    </div>

    <h3>Findings</h3>
    <ul class="findings" id="findings"></ul>
    <div class="empty" id="noFindings">No findings — every control total, reference and value date agrees.</div>

    <h3>Parse issues</h3>
    <ul class="issues" id="issues"></ul>

    <div class="l4">
      <h2>4 · Exception register (L4) — what a human decided</h2>
      <div class="small muted" id="l4note">A waiver records a reason, an owner, a compensating control and an expiry. It never changes the verdict above.</div>
      <table id="l4table"><thead><tr><th>status</th><th>finding</th><th>owner / reason</th></tr></thead><tbody></tbody></table>
      <form id="l4form" autocomplete="off">
        <input id="l4owner" class="full" placeholder="owner (a person, not a team)" />
        <input id="l4reason" class="full" placeholder="reason — why this exception is acceptable" />
        <input id="l4control" placeholder="compensating control" />
        <input id="l4expires" placeholder="expires YYYY-MM-DD (required)" />
        <div class="full row2">
          <button type="button" id="btnWaive">Waive selected finding</button>
          <button type="button" id="btnRelease" class="ghost">Release selected waiver</button>
          <button type="button" id="btnLedger" class="ghost">Check ledger</button>
          <button type="button" id="btnDownload" class="ghost">Download ledger.json</button>
        </div>
      </form>
      <div class="chain" id="chain"></div>
    </div>
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
<div class="toast" id="toast"></div>

<script src="bundle.js"></script>
</body>
</html>`;
}
