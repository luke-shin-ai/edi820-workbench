"""Captures 1920x1080 screenshots from the real 「820」 web screen.

The server is started for the duration of this script only (the sandbox kills child
processes when the tool call ends), every screen is a real render of the running app,
and the numbers in the JSON report are read out of the page, not from the fixtures.
"""
import json
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

from paths import NODE_BIN, ROOT  # noqa: E402  (see paths.py)
PORT = 8731
OUT = os.path.join(ROOT, "demo-video/screenshots")
os.makedirs(OUT, exist_ok=True)

WINDOW = "2026-11-18..2026-11-20"
BASE = "http://127.0.0.1:%d" % PORT


def u(**params):
    from urllib.parse import urlencode
    return BASE + "/?" + urlencode(params)


PASS = u(file="samples/data/820-good.txt", copybook="samples/copybooks/820.cpy",
         bank="samples/data/823-bank.txt", bankCopybook="samples/copybooks/823.cpy",
         bankFormat="fixed", window=WINDOW)
FAIL = u(file="samples/data/820-bad.txt", copybook="samples/copybooks/820.cpy",
         bank="samples/data/823-bank.txt", bankCopybook="samples/copybooks/823.cpy",
         bankFormat="fixed", window=WINDOW)
PACKED = u(file="samples/data/820-packed-good.txt", copybook="samples/copybooks/820-packed.cpy",
           bank="samples/data/823-bank.txt", bankCopybook="samples/copybooks/823.cpy",
           bankFormat="fixed", window=WINDOW)
BAI2 = u(file="samples/data/820-good.txt", copybook="samples/copybooks/820.cpy",
         bank="samples/data/bai2-bad.txt", bankFormat="bai2", window=WINDOW)

report = {}

env = dict(os.environ)
env["PATH"] = NODE_BIN + os.pathsep + env.get("PATH", "")
server = subprocess.Popen(
    ["npx", "tsx", "src/web/main.ts", "--port", str(PORT)],
    cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    start_new_session=True,
)
time.sleep(5)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        def shot(url, name, wait_selector, select=None, timeout=20000):
            page.goto(url, wait_until="load")
            page.wait_for_selector(wait_selector, timeout=timeout)
            page.wait_for_timeout(500)
            if select is not None:
                rows = page.query_selector_all("#findings li")
                if len(rows) > select:
                    rows[select].click()
                    page.wait_for_timeout(300)
            page.screenshot(path=os.path.join(OUT, name + ".png"))
            return {
                "status": page.inner_text("#status"),
                "fp": page.inner_text("#fp"),
                "findings": page.eval_on_selector_all("#findings li", "els => els.map(e => e.innerText.replace(/\\n/g,' | '))"),
                "totals": page.eval_on_selector_all("#totals tr", "els => els.map(e => e.innerText.replace(/\\n/g,' | '))"),
                "counters": {
                    "details": page.inner_text("#cDet"),
                    "matched": page.inner_text("#cMatched"),
                    "unmatched": page.inner_text("#cUnmatched"),
                    "findings": page.inner_text("#cFind"),
                    "verdictMeta": page.inner_text("#verdictMeta"),
                },
                "evidenceNote": page.inner_text("#evidenceNote"),
                "highlight": page.eval_on_selector_all(".byte.hl", "els => els.map(e => e.textContent).join('')"),
                "explanation": page.inner_text("#explain"),
                "issues": page.eval_on_selector_all("#issues li", "els => els.map(e => e.textContent)"),
                "stripTop": page.eval_on_selector_all("#strip-top .item", "els => els.map(e => e.innerText.replace(/\\n/g,' '))"),
                "stripBottom": page.eval_on_selector_all("#strip-bottom .item", "els => els.map(e => e.innerText.replace(/\\n/g,' '))"),
            }

        report["pass"] = shot(PASS, "s-pass", "#status.pass")
        report["fail0"] = shot(FAIL, "s-fail-0", "#status.fail", select=0)
        report["fail1"] = shot(FAIL, "s-fail-1", "#status.fail", select=1)
        report["fail3"] = shot(FAIL, "s-fail-3", "#status.fail", select=3)
        # two runs of the same input must print the same fingerprint
        report["fail_again"] = shot(FAIL, "s-fail-again", "#status.fail", select=1)
        report["packed"] = shot(PACKED, "s-packed", "#status.pass")
        report["bai2"] = shot(BAI2, "s-bai2", "#status.fail", select=0)

        # geometry for the crops the video uses
        boxes = {}
        for sel in ["header", "#verdict", "#page", "body", "#col-left", "#col-mid", "#col-right", "#strip-top", "#strip-bottom", "#explain", "#bytes"]:
            el = page.query_selector(sel)
            boxes[sel] = el.bounding_box() if el else None
        report["boxes"] = boxes
        report["pageErrors"] = errors
        page.screenshot(path=os.path.join(OUT, "s-bai2-full.png"), full_page=True)
        browser.close()
finally:
    server.terminate()

json.dump(report, open(os.path.join(ROOT, "demo-video/build/capture-report.json"), "w"), indent=2, ensure_ascii=False)
print(json.dumps({k: report[k] for k in report if k not in ("boxes",)}, indent=2, ensure_ascii=False)[:6000])
print("BOXES", json.dumps(report["boxes"], indent=1))
