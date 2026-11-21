"""High-DPI captures for the demo video: full screens plus element crops.

Every image is a render of the running 「820」 web screen at devicePixelRatio 2, so a
crop of a panel is still sharp when the video scales it up. The JSON report records
what the page said at capture time (verdict, fingerprint, highlighted bytes).
"""
import json
import os
import subprocess
import time
from urllib.parse import urlencode

from playwright.sync_api import sync_playwright

ROOT = "/workspace/hackathons/kiroween-2026"
PORT = 8732
OUT = os.path.join(ROOT, "demo-video/screenshots")
os.makedirs(OUT, exist_ok=True)
WINDOW = "2026-11-18..2026-11-20"
BASE = "http://127.0.0.1:%d" % PORT


def u(**params):
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

env = dict(os.environ)
env["PATH"] = "/workspace/.toolchain/node-v22.23.5-linux-x64/bin:" + env.get("PATH", "")
server = subprocess.Popen(["npx", "tsx", "src/web/main.ts", "--port", str(PORT)],
                          cwd=ROOT, env=env, stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, start_new_session=True)
time.sleep(5)

report = {}

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1920, "height": 1200}, device_scale_factor=2)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        def open_case(url, expect):
            page.goto(url, wait_until="load")
            page.wait_for_selector(expect, timeout=25000)
            page.wait_for_timeout(600)

        def element(selector, name):
            el = page.query_selector(selector)
            if el is None:
                return None
            el.screenshot(path=os.path.join(OUT, name + "@2x.png"))
            return name

        def full(name):
            page.screenshot(path=os.path.join(OUT, name + "@2x.png"))

        # --- PASS
        open_case(PASS, "#status.pass")
        full("hd-pass")
        for sel, name in [(".col-mid", "hd-pass-mid"), ("#strip-top", "hd-pass-strip-top"),
                          (".col-right", "hd-pass-right"), ("#totals", "hd-pass-totals")]:
            element(sel, name)
        report["pass"] = {"status": page.inner_text("#status"), "fp": page.inner_text("#fp"),
                          "matched": page.inner_text("#cMatched"), "find": page.inner_text("#cFind"),
                          "total": page.inner_text("#totals")}

        # --- FAIL, two selections
        open_case(FAIL, "#status.fail")
        full("hd-fail")
        report["fail"] = {"status": page.inner_text("#status"), "fp": page.inner_text("#fp"),
                          "count": len(page.query_selector_all("#findings li")),
                          "codes": page.eval_on_selector_all(
                              "#findings .chip", "els => els.map(e => e.textContent)")}
        page.query_selector_all("#findings li")[0].click()
        page.wait_for_timeout(400)
        element(".col-mid", "hd-fail-mid-0")
        element(".col-right", "hd-fail-right-0")
        report["fail"]["row0"] = {"note": page.inner_text("#evidenceNote"),
                                  "hl": page.eval_on_selector_all(".byte.hl", "els => els.map(e => e.textContent).join('')")}
        page.query_selector_all("#findings li")[1].click()
        page.wait_for_timeout(400)
        element(".col-mid", "hd-fail-mid-1")
        element(".col-right", "hd-fail-right-1")
        report["fail"]["row1"] = {"note": page.inner_text("#evidenceNote"),
                                  "hl": page.eval_on_selector_all(".byte.hl", "els => els.map(e => e.textContent).join('')")}
        page.query_selector_all("#findings li")[3].click()
        page.wait_for_timeout(400)
        element(".col-right", "hd-fail-right-3")
        report["fail"]["row3"] = {"note": page.inner_text("#evidenceNote"),
                                  "hl": page.eval_on_selector_all(".byte.hl", "els => els.map(e => e.textContent).join('')")}
        element("#strip-top", "hd-fail-strip-top")
        element("#strip-bottom", "hd-fail-strip-bottom")

        # --- packed COMP-3 PASS
        open_case(PACKED, "#status.pass")
        element(".col-mid", "hd-packed-mid")
        report["packed"] = {"status": page.inner_text("#status"), "fp": page.inner_text("#fp"),
                            "total": page.inner_text("#totals")}

        # --- BAI2 bank file, no copybook
        open_case(BAI2, "#status.fail")
        full("hd-bai2")
        element(".col-mid", "hd-bai2-mid")
        element(".col-right", "hd-bai2-right")
        report["bai2"] = {"status": page.inner_text("#status"), "fp": page.inner_text("#fp"),
                          "codes": page.eval_on_selector_all("#findings .chip", "els => els.map(e => e.textContent)")}

        report["pageErrors"] = errors
        browser.close()
finally:
    server.terminate()

json.dump(report, open(os.path.join(ROOT, "demo-video/build/capture-hd-report.json"), "w"),
          indent=2, ensure_ascii=False)
print(json.dumps(report, indent=2, ensure_ascii=False))
