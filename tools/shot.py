"""Dev helper: click through the inline preview with headless Chrome and screenshot each screen.
usage: python tools/shot.py OUT_DIR [path/to/preview.html]"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/shots")
page_file = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "_site" / "preview.html"
out.mkdir(exist_ok=True, parents=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.route("**/*", lambda r: r.abort() if not r.request.url.startswith(("file:", "data:")) else r.continue_())
    shot = lambda name: pg.screenshot(path=str(out / f"{name}.png"))

    pg.goto(page_file.as_uri()); pg.wait_for_timeout(400); shot("01_welcome")
    pg.click("[data-person=qizhe]"); pg.wait_for_timeout(300); shot("02_foryou")
    pg.click(".card:nth-child(1) [data-act=like]", force=True)
    pg.click(".card:nth-child(2) [data-act=pass]", force=True)
    pg.click("[data-nudge=darker]"); pg.click("[data-nudge=smarter]"); pg.wait_for_timeout(200); shot("02b_nudged")
    pg.click("[data-tab=explore]"); pg.wait_for_timeout(300); shot("03_explore")
    if pg.locator(".bcard").count():
        pg.click(".bcard"); pg.wait_for_timeout(300); shot("04_explore_brand")
    else:
        print("note: no brand cards")
    pg.click("[data-tab=saved]"); pg.wait_for_timeout(200); shot("05_saved")
    pg.click("[data-tab=foryou]"); pg.click("[data-open=tune]"); pg.wait_for_timeout(200); shot("06_tune_vibes")
    pg.click("[data-vibe=workwear]"); pg.click("[data-vibe=street]"); pg.click("[data-vibe=street]")
    pg.click("[data-step='0']"); pg.wait_for_timeout(100); shot("07_tune_basics")
    pg.click("#edSave"); pg.wait_for_timeout(300); shot("08_after_tune")
    # new profile onboarding
    pg.click("#whoBtn"); pg.click("#newProfile"); pg.fill("#fName", "Mia")
    pg.click("[data-dept=women]"); pg.click("[data-size=S]"); shot("09_new_basics")
    pg.click("#edNext"); pg.click("[data-vibe=french-girl]"); pg.click("[data-vibe=minimal-chic]"); pg.click("[data-spark=texture]")
    shot("10_new_vibes")
    pg.click("#edNext"); pg.wait_for_timeout(100); shot("11_new_words")
    pg.click("#edNext"); pg.wait_for_timeout(200); shot("11b_new_brands")
    pg.click("#edNext"); pg.wait_for_timeout(300); shot("12_new_picks")
    pg.click(".pick:nth-child(1)")
    pg.click("#edNext"); pg.wait_for_timeout(300); shot("13_new_feed")
    pg.click("#whoBtn"); pg.wait_for_timeout(200); shot("14_welcome_two")
    pg.click("[data-person=qizhe]")
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(300); shot("15_mobile")
    pg.click("[data-open=tune]"); pg.wait_for_timeout(200); shot("16_mobile_tune")
    print("errors:", errors)
    b.close()
