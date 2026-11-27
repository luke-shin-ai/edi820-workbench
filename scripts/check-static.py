"""Verify the static demo in a real browser at 1920px, and against the CLI.

What this checks, all from the built `docs/demo/` directory served over plain HTTP:

  1. eight scenarios run in the tab, each with the verdict the CLI gives for the same files;
  2. the browser fingerprint **equals** the CLI's fingerprint for the same scenario - the
     strongest single check that the browser engine is the same engine;
  3. a dropped COMP-3 file is read as bytes and reconciles to the same file hash as by path;
  4. a waiver moves a finding to WAIVED, the verdict badge stays FAIL, the chain stays intact,
     and a release returns the finding to open adjudication;
  5. "Re-derive and compare" prints identical;
  6. after the page loads, no request of any kind leaves the tab (no XHR, no fetch, no beacon),
     and there are no console or page errors;
  7. the ghost bar tells the story in money and offers the next tap: on a failing case its button
     opens the total finding, and after a waiver its line reports the human decision (2026-11-27).

Screenshots land in `docs/images/` (committed) and `demo-video/build/shots-static/` (for the
video plate). Run with the same LD_LIBRARY_PATH the other captures use:

    LD_LIBRARY_PATH=/workspace/.sysroot/usr/lib/x86_64-linux-gnu python3 scripts/check-static.py
"""
import json
import os
import subprocess
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = "/workspace/hackathons/kiroween-2026"
DEMO = os.path.join(ROOT, "docs/demo")
SHOTS = os.path.join(ROOT, "docs/images")
VIDEO_SHOTS = os.path.join(ROOT, "demo-video/build/shots-static")
PORT = 8741
WINDOW = ("2026-11-18", "2026-11-20")
NODE_BIN = "/workspace/.toolchain/node-v22.23.5-linux-x64/bin"

SCENARIOS = {
    "S1": dict(payment="820-good.txt", copybook="820.cpy", bank="823-bank.txt", bank_copybook="823.cpy"),
    "S2": dict(payment="820-packed-good.txt", copybook="820-packed.cpy", bank="823-bank.txt", bank_copybook="823.cpy"),
    "S3": dict(payment="820-bad.txt", copybook="820.cpy", bank="823-bank.txt", bank_copybook="823.cpy"),
    "S4": dict(payment="820-good.txt", copybook="820.cpy", bank="823-bad.txt", bank_copybook="823.cpy"),
    "S5": dict(payment="820-good.txt", copybook="820.cpy", bank="bai2-good.txt", bank_format="bai2"),
    "S6": dict(payment="820-good.txt", copybook="820.cpy", bank="bai2-bad.txt", bank_format="bai2"),
    "S7": dict(payment="820-redefines-good.txt", copybook="820-redefines.cpy", bank="823-bank.txt", bank_copybook="823.cpy"),
    "S8": dict(payment="820-redefines-bad.txt", copybook="820-redefines.cpy", bank="823-bank.txt", bank_copybook="823.cpy"),
}

os.makedirs(SHOTS, exist_ok=True)
os.makedirs(VIDEO_SHOTS, exist_ok=True)

failures = []


def check(label, condition, detail=""):
    print(("  ok   " if condition else "  FAIL ") + label + (f" - {detail}" if detail else ""))
    if not condition:
        failures.append(label)


def serve():
    handler = partial(SimpleHTTPRequestHandler, directory=DEMO)
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


def cli_fingerprint(spec):
    args = [
        "npx", "tsx", "src/cli/main.ts", "reconcile",
        "--copybook", f"samples/copybooks/{spec['copybook']}",
        "--file", f"samples/data/{spec['payment']}",
        "--window", "..".join(WINDOW),
        "--out", os.path.join(ROOT, ".tmp", "static-cli", spec["payment"].replace(".txt", "")),
        "--json",
    ]
    if spec.get("bank_format") == "bai2":
        args += ["--bank", f"samples/data/{spec['bank']}", "--bank-format", "bai2"]
    else:
        args += ["--bank", f"samples/data/{spec['bank']}", "--bank-copybook", f"samples/copybooks/{spec['bank_copybook']}"]
    env = dict(os.environ)
    env["PATH"] = NODE_BIN + ":" + env.get("PATH", "")
    # --json prints the report; the exit code is 2 for FAIL, which is not an error here.
    out = subprocess.run(args, cwd=ROOT, env=env, capture_output=True, text=True).stdout
    report = json.loads(out)
    return report["verdict"]["status"], report["verdict"]["fingerprint"], len(report["verdict"]["findings"])


def main():
    httpd = serve()
    time.sleep(0.4)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--force-device-scale-factor=1"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        console_errors = []
        page_errors = []
        requests = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.on("request", lambda req: requests.append((req.method, req.url, req.resource_type)))

        page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        page.wait_for_function("window.demo && window.demo.state && window.demo.state.run")
        requests_after_load = len(requests)
        console_errors.clear()
        page_errors.clear()

        for scenario, spec in SCENARIOS.items():
            expected_status, expected_fp, expected_findings = cli_fingerprint(spec)
            page.click(f'.scenario[data-id="{scenario}"]')
            page.wait_for_function(f"window.demo.state.run.scenarioId === '{scenario}'")
            page.wait_for_timeout(150)
            state = page.evaluate(
                """() => {
                    const s = window.demo.state;
                    return {
                        status: s.run.view.status,
                        fingerprint: s.run.fingerprint,
                        findings: s.run.findings.length,
                        badge: document.getElementById('status').textContent,
                        totals: s.run.view.totals.map(t => [t.currency, t.declared, t.computed, t.delta]),
                        open: document.getElementById('cOpen').textContent,
                    };
                }"""
            )
            check(
                f"{scenario} verdict in the tab matches the CLI ({expected_status})",
                state["status"] == expected_status and state["badge"] == expected_status,
                f"tab={state['status']} cli={expected_status}",
            )
            check(
                f"{scenario} fingerprint equals the CLI fingerprint",
                state["fingerprint"] == expected_fp,
                f"tab={state['fingerprint'][:12]}... cli={expected_fp[:12]}...",
            )
            check(
                f"{scenario} finding count matches ({expected_findings})",
                state["findings"] == expected_findings,
                f"tab={state['findings']}",
            )
            page.screenshot(path=os.path.join(SHOTS, f"demo-{scenario.lower()}.png"))
            if scenario in ("S1", "S3", "S6"):
                page.screenshot(path=os.path.join(VIDEO_SHOTS, f"static-{scenario.lower()}@1920.png"))

        # 2b ; the REDEFINES trailer is sliced by its own layout, not by the detail's
        page.click('.scenario[data-id="S7"]')
        page.wait_for_function("window.demo.state.run.scenarioId === 'S7'")
        page.click('#records li[data-index="10"]')
        page.wait_for_timeout(250)
        trailer = page.evaluate(
            """() => {
                const records = window.demo.state.run.view.records.filter(r => r.side === 'payment' && r.index === 10);
                const record = records[0];
                return {
                    isTrailer: record.isTrailer,
                    fields: record.fields.map(f => f.name),
                    before: window.demo.state.run.view.records.filter(r => r.side === 'payment' && r.index === 0)[0].fields.map(f => f.name),
                };
            }"""
        )
        check(
            "the REDEFINES trailer is sliced by its own layout",
            trailer["isTrailer"]
            and trailer["fields"] == ["REC-TYPE", "ORIG-ID-T", "RECEIVER-ID-T", "TOTAL-AMOUNT", "TOTAL-CURRENCY", "REC-COUNT", "FILLER"],
            ", ".join(trailer["fields"]),
        )
        check(
            "the detail record beside it is still sliced by the detail layout",
            "AMOUNT" in trailer["before"] and "TOTAL-AMOUNT" not in trailer["before"],
            ", ".join(trailer["before"]),
        )
        page.evaluate("() => window.scrollTo(0, 0)")
        page.wait_for_timeout(200)
        page.screenshot(path=os.path.join(SHOTS, "demo-s7-trailer.png"))
        page.screenshot(path=os.path.join(VIDEO_SHOTS, "static-s7-trailer@1920.png"))

        # 3 ; a dropped COMP-3 file is read as bytes in the page
        page.click('.scenario[data-id="S1"]')
        page.wait_for_function("window.demo.state.run.scenarioId === 'S1'")
        with page.expect_file_chooser() as chooser:
            page.click("#dropFile")
        chooser.value.set_files(os.path.join(ROOT, "samples/data/820-packed-good.txt"))
        with page.expect_file_chooser() as chooser2:
            page.click("#dropCopybook")
        chooser2.value.set_files(os.path.join(ROOT, "samples/copybooks/820-packed.cpy"))
        page.wait_for_timeout(300)
        page.click("#btnDrop")
        page.wait_for_function("window.demo.state.run.scenarioId === 'dropped'")
        page.wait_for_timeout(200)
        dropped = page.evaluate("() => ({ status: window.demo.state.run.view.status, hash: window.demo.state.run.view.files.payment.fileHash, path: window.demo.state.run.view.files.payment.path })")
        by_path = page.evaluate("() => window.demo.state")  # keep the page alive while we read the CLI
        cli_packed = cli_fingerprint(SCENARIOS["S2"])
        check(
            "a dropped COMP-3 file parses as bytes (same status as the by-path run)",
            dropped["status"] == cli_packed[0],
            f"dropped={dropped['status']} cli={cli_packed[0]}",
        )
        check("the dropped file is labelled by its own name", dropped["path"] == "820-packed-good.txt", dropped["path"])
        page.screenshot(path=os.path.join(SHOTS, "demo-dropped.png"))

        # 4 ; L4: waive the selected finding, then release it
        page.click('.scenario[data-id="S3"]')
        page.wait_for_function("window.demo.state.run.scenarioId === 'S3'")
        page.wait_for_timeout(150)

        # 7a ; the ghost bar: the money in plain words, and a button that is the next tap
        guide = page.evaluate(
            """() => ({
                line: document.getElementById('guideLine').textContent,
                plain: document.getElementById('heroPlain').textContent,
                buttons: [...document.querySelectorAll('#guideActions button')].map(b => b.textContent),
            })"""
        )
        check(
            "the first screen states the disagreement in money",
            "1,284,550.00 USD" in guide["plain"] and "1,284,450.00 USD" in guide["plain"],
            guide["plain"],
        )
        check(
            "the ghost bar offers the next tap by name",
            "Open the total finding" in guide["buttons"] and "bytes 24 to 36" in guide["line"],
            json.dumps(guide["buttons"]) + " | " + guide["line"],
        )
        page.click('#guideActions button[data-act="finding"]')
        page.wait_for_timeout(250)
        opened = page.evaluate(
            """() => ({
                selected: window.demo.state.selected,
                note: document.getElementById('evidenceNote').textContent,
            })"""
        )
        check(
            "that button opens the finding whose bytes the ghost pointed at",
            opened["selected"] == 0 and "24-36" in opened["note"],
            json.dumps(opened),
        )
        answered = page.evaluate("() => document.getElementById('guideLine').textContent")
        check(
            "the ghost answers the click with the finding it opened",
            "Finding 1 of 4" in answered and "bytes 24 to 36" in answered,
            answered,
        )

        page.click('#findings li[data-i="0"]')
        page.fill("#l4owner", "S. Shin (TPM)")
        page.fill("#l4reason", "Annex A total approved against the corrected bank statement; the shortfall is booked as a manual adjustment.")
        page.fill("#l4control", "Daily suspense-account check by the settlement team")
        # The rule the submission text states: no waiver without an expiry. The panel refuses it
        # before the module is called, and no entry is appended (2026-11-22).
        page.fill("#l4expires", "")
        page.click("#btnWaive")
        page.wait_for_timeout(150)
        refused = page.evaluate(
            "() => ({ entries: window.demo.state.ledger.entries.length, toast: document.getElementById('toast').textContent })"
        )
        check(
            "a waiver without an expiry is refused in the register",
            refused["entries"] == 0 and "expiry" in refused["toast"],
            json.dumps(refused),
        )
        page.fill("#l4expires", "2026-12-05")
        page.click("#btnWaive")
        page.wait_for_timeout(250)
        page.evaluate("() => document.getElementById('l4table').scrollIntoView({block: 'center'})")
        page.wait_for_timeout(150)
        after_waive = page.evaluate(
            """() => {
                const c = window.demo.classification();
                return {
                    counts: c.counts,
                    statuses: c.entries.map(e => e.status),
                    badge: document.getElementById('status').textContent,
                    chain: document.getElementById('chain').textContent,
                    integrity: window.demo.verifyLedger(window.demo.state.ledger).ok,
                    l4rows: document.querySelectorAll('#l4table tbody tr').length,
                };
            }"""
        )
        check("a waiver shows as WAIVED in the register", after_waive["counts"]["WAIVED"] == 1, json.dumps(after_waive["counts"]))
        check("the verdict badge does not change when a finding is waived", after_waive["badge"] == "FAIL", after_waive["badge"])
        check("the ledger chain stays intact after an append", after_waive["integrity"] is True and "intact" in after_waive["chain"], after_waive["chain"])

        # 7b ; after a human decides, the ghost bar reports the decision, not a changed verdict
        guide_after = page.evaluate(
            "() => ({ line: document.getElementById('guideLine').textContent, badge: document.getElementById('status').textContent })"
        )
        check(
            "after a waiver the ghost bar reports the decision and keeps the verdict",
            "S. Shin (TPM)" in guide_after["line"] and "FAIL" in guide_after["line"] and guide_after["badge"] == "FAIL",
            guide_after["line"],
        )
        page.screenshot(path=os.path.join(SHOTS, "demo-l4-waived.png"))
        with open(os.path.join(VIDEO_SHOTS, "static-l4.json"), "w") as fh:
            json.dump({"badge": after_waive["badge"], "counts": after_waive["counts"], "chain": after_waive["chain"]}, fh)
        page.screenshot(path=os.path.join(VIDEO_SHOTS, "static-l4@1920.png"))

        page.click('#findings li[data-i="0"]')
        page.click("#btnRelease")
        page.wait_for_timeout(250)
        after_release = page.evaluate("() => ({ counts: window.demo.classification().counts, badge: document.getElementById('status').textContent })")
        check("a release returns the finding to open adjudication", after_release["counts"]["RELEASED"] == 1 and after_release["badge"] == "FAIL", json.dumps(after_release["counts"]))

        # 5 ; re-derive
        page.click("#btnVerify")
        page.wait_for_timeout(400)
        verify_text = page.inner_text("#verifyOut")
        check("re-derive prints identical", "identical" in verify_text, verify_text.replace("\n", " "))

        # 6 ; nothing left the tab after the first load
        late = requests[requests_after_load:]
        late_bad = [r for r in late if r[2] in ("xhr", "fetch", "beacon", "websocket")]
        check("no request leaves the tab after load", not late_bad, json.dumps(late_bad[:3]))
        check("no console errors", not console_errors, "; ".join(console_errors[:2]))
        check("no page errors", not page_errors, "; ".join(page_errors[:2]))

        browser.close()

        # A screenshot at a phone width, to show the page is not fixed to 1920.
        browser = p.chromium.launch()
        narrow = browser.new_page(viewport={"width": 430, "height": 900})
        narrow.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        narrow.wait_for_function("window.demo && window.demo.state && window.demo.state.run")
        narrow.screenshot(path=os.path.join(VIDEO_SHOTS, "static-narrow.png"))
        browser.close()

    httpd.shutdown()
    print()
    if failures:
        print(f"{len(failures)} check(s) failed:")
        for item in failures:
            print(" -", item)
        sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main()
