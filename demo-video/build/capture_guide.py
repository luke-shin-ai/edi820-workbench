"""High-DPI captures of the public demo after the ghost bar landed (2026-11-27).

The video needs the screen exactly as a judge sees it: the hero line, the money
sentence, the COBOL GHOST bar, the bytes of finding 1, and the register after a
person waives that finding while the verdict stays FAIL.

Every image is the real page, rendered from `docs/demo` over plain HTTP at
devicePixelRatio 2, so a 3840 wide capture downsamples cleanly into the 2560 wide
plate. Selectors and flows are the same ones `scripts/check-static.py` asserts, so
a capture cannot show a state the check would refuse.

Run:
    LD_LIBRARY_PATH=/workspace/.sysroot/usr/lib/x86_64-linux-gnu python3 capture_guide.py
"""
import json
import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

from paths import ROOT  # noqa: E402

DEMO = os.path.join(ROOT, "docs/demo")
OUT = os.path.join(ROOT, "demo-video/screenshots")
PORT = 8744

os.makedirs(OUT, exist_ok=True)


def serve():
    handler = partial(SimpleHTTPRequestHandler, directory=DEMO)
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


report = {}
httpd = serve()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto("http://127.0.0.1:%d/index.html" % PORT, wait_until="load")
        page.wait_for_function("() => window.demo && window.demo.state && window.demo.state.run")
        page.click('.scenario[data-id="S3"]')
        page.wait_for_function("window.demo.state.run.scenarioId === 'S3'")
        page.wait_for_timeout(500)
        page.evaluate("() => window.scrollTo(0, 0)")
        page.wait_for_timeout(200)

        page.screenshot(path=os.path.join(OUT, "guide-hero@2x.png"))
        report["hero"] = {
            "plain": page.inner_text("#heroPlain"),
            "guide": page.inner_text("#guideLine"),
            "buttons": page.eval_on_selector_all("#guideActions button", "els => els.map(e => e.textContent)"),
            "hero": page.inner_text("#heroLine"),
        }

        page.click('#guideActions button[data-act="finding"]')
        page.wait_for_timeout(400)
        page.screenshot(path=os.path.join(OUT, "guide-finding@2x.png"))
        report["finding"] = {
            "guide": page.inner_text("#guideLine"),
            "note": page.inner_text("#evidenceNote"),
            "bytes": page.eval_on_selector_all(".byte.hl", "els => els.map(e => e.textContent).join('')"),
        }

        # A person records a waiver; the verdict must stay FAIL.
        page.click('#findings li[data-i="0"]')
        page.fill("#l4owner", "S. Shin (TPM)")
        page.fill("#l4reason", "Annex A total approved against the corrected bank statement; the shortfall is booked as a manual adjustment.")
        page.fill("#l4control", "Daily suspense-account check by the settlement team")
        page.fill("#l4expires", "2026-12-05")
        page.click("#btnWaive")
        page.wait_for_timeout(300)
        page.evaluate("() => window.scrollTo(0, 0)")
        page.wait_for_timeout(200)
        page.screenshot(path=os.path.join(OUT, "guide-waived-top@2x.png"))
        page.locator("#guide").screenshot(path=os.path.join(OUT, "guide-bar-waived@2x.png"))
        page.locator(".l4").screenshot(path=os.path.join(OUT, "guide-l4-waived@2x.png"))
        l4box = page.locator(".l4").bounding_box()
        tablebox = page.locator("#l4table").bounding_box()
        report["waiver"] = {
            "guide": page.inner_text("#guideLine"),
            "badge": page.inner_text("#status"),
            "counts": page.evaluate("() => window.demo.classification().counts"),
            "chain": page.inner_text("#chain"),
            "table_bottom_ratio": round((tablebox["y"] + tablebox["height"] - l4box["y"]) / l4box["height"], 4),
            "bar_height_ratio": round(page.locator("#guide").bounding_box()["height"] / 1080, 4),
        }

        page.click('.scenario[data-id="S1"]')
        page.wait_for_function("window.demo.state.run.scenarioId === 'S1'")
        page.wait_for_timeout(400)
        page.evaluate("() => window.scrollTo(0, 0)")
        page.wait_for_timeout(200)
        page.screenshot(path=os.path.join(OUT, "guide-pass@2x.png"))
        report["pass"] = {"plain": page.inner_text("#heroPlain"), "guide": page.inner_text("#guideLine")}

        report["pageErrors"] = errors
        report["console"] = page.evaluate("() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })")
        browser.close()
finally:
    httpd.shutdown()

json.dump(report, open(os.path.join(ROOT, "demo-video/build/capture-guide-report.json"), "w"), indent=2, ensure_ascii=False)
print(json.dumps(report, indent=2, ensure_ascii=False))
