"""Captures the empty state and an error state of the web screen for docs/images."""
import os
import subprocess
import time
from urllib.parse import urlencode

from playwright.sync_api import sync_playwright

ROOT = "/workspace/hackathons/kiroween-2026"
PORT = 8733
OUT = os.path.join(ROOT, "docs/images")
BASE = "http://127.0.0.1:%d" % PORT

env = dict(os.environ)
env["PATH"] = "/workspace/.toolchain/node-v22.23.5-linux-x64/bin:" + env.get("PATH", "")
server = subprocess.Popen(["npx", "tsx", "src/web/main.ts", "--port", str(PORT)],
                          cwd=ROOT, env=env, stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, start_new_session=True)
time.sleep(5)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1920, "height": 1200}, device_scale_factor=1)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(BASE + "/", wait_until="load")
        page.wait_for_timeout(1200)
        page.screenshot(path=os.path.join(OUT, "ui-empty.png"), full_page=True)
        print("empty:", page.inner_text("#status") if page.query_selector("#status") else "no status")

        bad = BASE + "/?" + urlencode({
            "file": "samples/data/missing-file.txt",
            "copybook": "samples/copybooks/820.cpy",
        })
        page.goto(bad, wait_until="load")
        page.wait_for_timeout(1500)
        page.screenshot(path=os.path.join(OUT, "ui-error.png"), full_page=True)
        txt = page.inner_text("body")[:600].replace("\n", " | ")
        print("error state text:", txt)
        print("pageErrors:", errors)
        browser.close()
finally:
    server.terminate()
