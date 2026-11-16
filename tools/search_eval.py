"""Scores the live site's search against tests/search_cases.json using the real models in a real browser.
Usage: python tools/search_eval.py   (SITE env to point elsewhere, ONLY=group to run one group)"""
import json, os, re, time, collections
from playwright.sync_api import sync_playwright

SITE = os.environ.get("SITE", "https://qizhecui.github.io/FashionPlace/?debug=1")
ONLY = os.environ.get("ONLY", "")
cases = json.load(open("tests/search_cases.json"))["cases"]
if ONLY: cases = [c for c in cases if c["group"] == ONLY]
os.makedirs("e2e", exist_ok=True)

def ok_item(c, it):
    text = " ".join([it["title"], it.get("ptype", ""), it.get("colour", ""), " ".join(it.get("materials", [])), it["category"]]).lower()
    if "cat" in c and it["category"] not in c["cat"]: return False
    if "colour" in c and not re.search(c["colour"], (it.get("colour", "") + " " + it["title"]).lower()): return False
    if "material" in c and not re.search(c["material"], (" ".join(it.get("materials", [])) + " " + it["title"]).lower()): return False
    if "max_price" in c and it["price"] > c["max_price"]: return False
    if "dept" in c and it["department"] not in (c["dept"], "unisex"): return False
    if "title" in c and not re.search(c["title"], text): return False
    if "brand" in c and c["brand"] not in it["brand"].lower() and c["brand"] not in it["title"].lower(): return False
    if "any" in c and not re.search(c["any"], text): return False
    if "not" in c and re.search(c["not"], text): return False
    return True

def score(c, r):
    if "error" in r: return 0.0, "error: " + r["error"][:80]
    notes = []
    if r["dropped"]: notes.append("dropped " + "/".join(r["dropped"]))
    if r["missing"]: notes.append("says missing")
    if c.get("miss_ok") and (r["missing"] or not r["items"]): return 1.0, "honest miss"
    if not r["items"]: return 0.0, "no results"
    s = sum(ok_item(c, it) for it in r["items"]) / len(r["items"])
    if c.get("no_drop") and (r["dropped"] or r["missing"]): s = min(s, 0.25)
    return s, "; ".join(notes)

results = []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 900})
    pg.goto(SITE); pg.wait_for_function("() => window.__fp && window.__fp.S.items.length > 1000", timeout=120000)
    pg.evaluate("(off) => { window.__fp.S.planWait = 20000; window.__fp.S.noStylist = off; }", bool(os.environ.get("BASELINE")))
    for i, c in enumerate(cases):
        t0 = time.time()
        try:
            r = pg.evaluate("""async (q) => { try { return await Promise.race([window.__fp.searchFor(q), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 90000))]); } catch (e) { return { error: String(e.message || e) }; } }""", c["q"])
        except Exception as e:
            r = {"error": str(e)[:200]}
        s, note = score(c, r)
        results.append({"case": c, "score": round(s, 3), "pass": s >= c["thr"], "note": note, "secs": round(time.time() - t0, 1),
                        **{k: r.get(k) for k in ("en", "kind", "engine", "mood", "named", "facets", "matches")},
                        "top": [f'{it["category"]} | {it["brand"]} | {it["title"][:60]}' for it in r.get("items", [])[:8]]})
        print(f'{"PASS" if s >= c["thr"] else "FAIL"} {s:.2f} [{c["group"]}] {c["q"]}  {("— " + note) if note else ""}', flush=True)
    b.close()

by = collections.defaultdict(list)
for r in results: by[r["case"]["group"]].append(r)
summary = {g: {"cases": len(v), "passed": sum(x["pass"] for x in v), "score": round(sum(x["score"] for x in v) / len(v), 3)} for g, v in by.items()}
overall = {"cases": len(results), "passed": sum(r["pass"] for r in results), "score": round(sum(r["score"] for r in results) / max(1, len(results)), 3),
           "stylist_used": sum(1 for r in results if r.get("kind")), "engines": dict(collections.Counter(r.get("engine") or "none" for r in results)),
           "median_secs": sorted(r["secs"] for r in results)[len(results) // 2] if results else 0}
json.dump({"overall": overall, "groups": summary, "results": results}, open("e2e/search_eval.json", "w"), ensure_ascii=False, indent=1)
print("\n===== SUMMARY =====")
for g, v in summary.items(): print(f'SUM {g:9s} {v["passed"]}/{v["cases"]} passed, score {v["score"]:.2f}')
print(f'SUM OVERALL   {overall["passed"]}/{overall["cases"]} passed, score {overall["score"]:.3f}, stylist used {overall["stylist_used"]}, engines {overall["engines"]}, median {overall["median_secs"]}s')
print("\n===== FAILURES =====")
for r in sorted((r for r in results if not r["pass"]), key=lambda r: r["score"]):
    print(f'FAILED {r["score"]:.2f} [{r["case"]["group"]}] {r["case"]["q"]} | en={r.get("en")} | kind={r.get("kind")} | facets={r.get("facets")} | named={r.get("named")} | {r["note"]}')
    for t in r["top"][:5]: print("        " + t)
