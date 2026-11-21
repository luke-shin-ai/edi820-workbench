/**
 * The one stylesheet both screens use.
 *
 * `page.ts` (served by the local server) and `src/static/page.ts` (the client-side demo)
 * share it, so the hosted demo and the local screen cannot drift apart visually.
 */
export const PAGE_CSS = `
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
  .records li.trailer.on { color: var(--ink); }
  .empty { color: var(--muted); font-size: 12px; padding: 12px 0; }
  .err { color: #ff9c94; font-size: 12px; font-family: var(--mono); white-space: pre-wrap; }
`;
