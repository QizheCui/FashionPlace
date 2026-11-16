"""End-to-end check on the LIVE site with the real models: does a sentence (Chinese and English)
and an outfit photo added during setup actually change the feed? Writes e2e/results.json + screenshots."""
import json, os, re, sys, urllib.request
from playwright.sync_api import sync_playwright

SITE = os.environ.get("SITE", "https://qizhecui.github.io/FashionPlace/?debug=1")
os.makedirs("e2e", exist_ok=True)
out = {"site": SITE, "runs": []}

def items_from(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('#grid .card, .grid .card')].slice(0, 18).map(c => ({
        brand: c.querySelector('.b')?.textContent.trim(), title: c.querySelector('.t')?.textContent.trim(),
        why: c.querySelector('.why')?.textContent.trim(), cat: (window.__fp && window.__fp.S.byId[c.dataset.id] || {}).category }))""")

def pick_photo(pg):
    """a real product photo from today's catalogue: brown loafers, to see if the feed follows it"""
    meta = pg.evaluate("""async () => { const r = await fetch('data/items-men-shoes.json'); return r.ok ? r.json() : null; }""")
    cands = [i for i in (meta or {}).get("items", meta or []) if isinstance(i, dict) and re.search(r"loafer", i.get("title", ""), re.I) and i.get("image")]
    it = cands[0] if cands else None
    if not it: return None, None
    req = urllib.request.Request(it["image"], headers={"User-Agent": "Mozilla/5.0"})
    open("e2e/photo.jpg", "wb").write(urllib.request.urlopen(req, timeout=30).read())
    return "e2e/photo.jpg", it["title"]

def setup(pg, lang, name, word=None, photo=None, vibe=False):
    pg.goto(SITE); pg.wait_for_timeout(1500)
    pg.evaluate(f"localStorage.clear(); localStorage.setItem('fp:lang', '{lang}')"); pg.goto(SITE); pg.wait_for_timeout(3000)
    pg.click("#signIn"); pg.wait_for_timeout(400); pg.click("#newProfile"); pg.wait_for_timeout(400)
    pg.fill("#fName", name); pg.click("[data-dept=men]"); pg.wait_for_timeout(1500)
    pg.click("#edNext"); pg.wait_for_timeout(600)
    if vibe: pg.click(".vibe >> nth=0")
    pg.click("#edNext"); pg.wait_for_timeout(600)
    log = {}
    if word:
        pg.fill("#fWord", word); pg.click("#fAddLove")
        pg.wait_for_function("() => /Added|已添加|Couldn|暂时|needs|需要/.test(document.querySelector('#fStatus').textContent)", timeout=180000)
        log["word_status"] = pg.inner_text("#fStatus")
    if photo:
        pg.set_input_files("input[type=file]", photo)
        pg.wait_for_function("() => /photo|照片|Couldn|暂时/.test(document.querySelector('#fStatus').textContent) && !/Reading|Loading|正在/.test(document.querySelector('#fStatus').textContent)", timeout=240000)
        log["photo_status"] = pg.inner_text("#fStatus")
    pg.screenshot(path=f"e2e/{name}-words.png")
    log["words_shown"] = pg.evaluate("() => [...document.querySelectorAll('.words .word, .thumbs .thumb')].map(e => e.textContent.trim() || 'thumb')")
    pg.click("#edNext"); pg.wait_for_timeout(4000)
    log["picks"] = pg.evaluate("() => [...document.querySelectorAll('.pick')].slice(0, 8).map(e => e.innerText.replace(/\\n+/g, ' | ').slice(0, 120))")
    pg.screenshot(path=f"e2e/{name}-picks.png")
    pg.click("#edNext"); pg.wait_for_timeout(5000)
    log["profile_words"] = pg.evaluate("""() => { const p = JSON.parse(localStorage.getItem('fp:v2')); const q = Object.values(p.profiles)[0];
        return q.words.map(w => ({ label: w.label, photo: !!w.thumb, dims: w.vec.length, ok: w.vec.every(Number.isFinite) && Math.hypot(...w.vec) > 0.5 })); }""")
    log["feed"] = items_from(pg)
    pg.screenshot(path=f"e2e/{name}-feed.png", full_page=False)
    return log

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
    pg.goto(SITE); pg.wait_for_timeout(3000)
    photo, photo_title = pick_photo(pg)
    out["photo_title"] = photo_title
    runs = [("baseline", "en", dict()), ("zh-words", "zh", dict(word="十月哥本哈根的周日，温暖的羊毛和麂皮")),
            ("en-words", "en", dict(word="dark wool trousers for the office")), ("photo", "en", dict(photo=photo)),
            ("vibe+photo", "en", dict(photo=photo, vibe=True)), ("zh-words+photo", "zh", dict(word="十月哥本哈根的周日，温暖的羊毛和麂皮", photo=photo))]
    for name, lang, kw in runs:
        try: r = setup(pg, lang, name, **kw)
        except Exception as e: r = {"error": str(e)[:400]}
        out["runs"].append({"name": name, "lang": lang, **r})
        print(f"== {name}: {r.get('word_status') or r.get('photo_status') or r.get('error', '')}", flush=True)
        print("   picks:", " / ".join(r.get("picks", [])[:8]), flush=True)
        for f in r.get("feed", [])[:18]: print(f"   {f.get('cat')} | {f.get('brand')} | {(f.get('title') or '')[:70]} | {f.get('why')}", flush=True)
    out["errors"] = errs[:30]
    print("photo was:", photo_title); print("page errors:", errs[:8])
    b.close()
json.dump(out, open("e2e/results.json", "w"), ensure_ascii=False, indent=1)
