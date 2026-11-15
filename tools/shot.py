"""Dev helper: screenshot the inline preview in each tab (and phone size) with headless Chrome."""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
page_url = (ROOT / "_site" / "preview.html").as_uri()
out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/shots")
out.mkdir(exist_ok=True, parents=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/*", lambda r: r.abort() if not r.request.url.startswith("file:") else r.continue_())
    pg.goto(page_url)
    pg.wait_for_timeout(400)
    pg.screenshot(path=str(out / "foryou.png"))
    # like two items, then check explore + deals
    pg.click(".card:nth-child(1) [data-act=like]", force=True)
    pg.click(".card:nth-child(3) [data-act=like]", force=True)
    pg.screenshot(path=str(out / "foryou_after_likes.png"))
    for tab in ["explore", "deals", "saved"]:
        pg.click(f"[data-tab={tab}]")
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"{tab}.png"))
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.click("[data-tab=foryou]")
    pg.wait_for_timeout(300)
    pg.screenshot(path=str(out / "mobile.png"))
    print("titles:", pg.eval_on_selector_all(".card .t", "els => els.slice(0,8).map(e => e.textContent)"))
    print("errors:", errors)
    b.close()
