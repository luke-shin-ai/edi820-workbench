"""Captures the local back-office screen (127.0.0.1) for docs/images and README.

Four states: PASS, FAIL with the second finding selected (so the evidence panel and the
`L3: grounded` line are on screen), the empty state, and an error state. Every image is a
real render of `src/web`, against the same samples the CLI reads, so the README cannot show
a screen the product does not produce.

    LD_LIBRARY_PATH=/workspace/.sysroot/usr/lib/x86_64-linux-gnu python3 capture_ui.py
"""
import os
import subprocess
import time
from urllib.parse import urlencode

from playwright.sync_api import sync_playwright

ROOT = "/workspace/hackathons/kiroween-2026"
PORT = 8735
OUT = os.path.join(ROOT, "docs/images")
BASE = "http://127.0.0.1:%d" % PORT
WINDOW = "2026-11-18..2026-11-20"


def url(**params):
    return BASE + "/?" + urlencode(params)


PASS = url(file="samples/data/820-good.txt", copybook="samples/copybooks/820.cpy",
           bank="samples/data/823-bank.txt", bankCopybook="samples/copybooks/823.cpy",
           bankFormat="fixed", window=WINDOW)
FAIL = url(file="samples/data/820-bad.txt", copybook="samples/copybooks/820.cpy",
           bank="samples/data/823-bank.txt", bankCopybook="samples/copybooks/823.cpy",
           bankFormat="fixed", window=WINDOW)

env = dict(os.environ)
env["PATH"] = "/workspace/.toolchain/node-v22.23.5-linux-x64/bin:" + env.get("PATH", "")
server = subprocess.Popen(["npx", "tsx", "src/web/main.ts", "--port", str(PORT)],
                          cwd=ROOT, env=env, stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, start_new_session=True)
time.sleep(5)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(PASS, wait_until="load")
        page.wait_for_selector("#status.pass", timeout=20000)
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(OUT, "ui-pass.png"), full_page=True)
        print("pass:", page.inner_text("#status"), page.inner_text("#fp"))

        page.goto(FAIL, wait_until="load")
        page.wait_for_selector("#status.fail", timeout=20000)
        page.wait_for_timeout(400)
        rows = page.query_selector_all("#findings li")
        if len(rows) > 1:
            rows[1].click()
            page.wait_for_timeout(400)
        page.screenshot(path=os.path.join(OUT, "ui-fail.png"), full_page=True)
        print("fail:", page.inner_text("#status"), "· L3 line:", page.inner_text("#explain").split("\n")[0])

        page.goto(BASE + "/", wait_until="load")
        page.wait_for_timeout(1200)
        page.screenshot(path=os.path.join(OUT, "ui-empty.png"), full_page=True)

        page.goto(url(file="samples/data/missing-file.txt", copybook="samples/copybooks/820.cpy"), wait_until="load")
        page.wait_for_timeout(1500)
        page.screenshot(path=os.path.join(OUT, "ui-error.png"), full_page=True)
        print("page errors:", errors)
        browser.close()
finally:
    server.terminate()
