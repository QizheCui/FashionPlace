"""Assemble the static site into _site/ (web app + data).

  python tools/build_site.py            -> _site/ with web files + data/ folder (for GitHub Pages)
  python tools/build_site.py --inline   -> _site/preview.html, one self-contained file with data baked in
"""
import argparse
import base64
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB, DATA, OUT = ROOT / "web", ROOT / "data", ROOT / "_site"
FILES = ["meta-men.json", "meta-women.json", "vibes.json", "brands.json", "brand_stats.json", "refiners.json", "profiles/index.json"]


BINS = ["vectors-men.bin", "vectors-women.bin", "projection.bin"]
KEEP = ["id", "brand", "title", "url", "image", "category", "department", "price_gbp", "compare_at_gbp", "in_stock",
        "letter_sized", "letter_sizes", "waist_sizes", "shoe_sizes", "deal", "tier", "retailer", "colour", "materials", "ptype"]
DEAL_KEEP = ["verdict", "discount_pct", "is_lowest_price", "tracked_days"]


def shard_items() -> dict:
    """The web app only needs a few fields per product, split by department; trimming keeps the phone download small."""
    d = json.loads((DATA / "items.json").read_text())
    out = []
    for it in d["items"]:
        x = {k: it[k] for k in KEEP if it.get(k) not in (None, [], False) or k in ("in_stock", "price_gbp")}
        if it.get("deal") and it["deal"].get("verdict"):
            x["deal"] = {k: it["deal"][k] for k in DEAL_KEEP if k in it["deal"]}
        else:
            x.pop("deal", None)
        out.append(x)
    return {dept: {"updated": d["updated"], "items": [x for x in out if x.get("department") in (dept, "unisex")]}
            for dept in ("men", "women")}


LANDING_CATS = ["outerwear", "knitwear", "dresses", "trousers", "shirts", "shoes", "tops", "bags", "tailoring", "skirts", "denim"]


def landing(shards: dict) -> dict:
    """A small, varied shop window for the front page (loads instantly, before the full catalogue):
    four menswear and four womenswear pieces, different brands and categories, in season."""
    import random
    every = list({it["id"]: it for d in shards.values() for it in d["items"]}.values())
    rnd = random.Random(next(iter(shards.values()))["updated"])  # same picks all day, new ones tomorrow
    picks, brands, cats = [], set(), {}
    pools = {}
    for dept in ("men", "women"):
        pool = [it for it in every if it.get("department") == dept and it.get("image") and it.get("in_stock")
                and 60 <= it["price_gbp"] <= 350 and it["category"] in LANDING_CATS]
        month = int(next(iter(shards.values()))["updated"][5:7])
        if month in (10, 11, 12, 1, 2, 3):  # keep the shop window seasonal
            pool = [it for it in pool if not re.search(r"short sleeve|\bss\b|linen|seersucker|swim|bikini|sandal|shorts", it["title"], re.I)]
        rnd.shuffle(pool)
        pools[dept] = pool
    for _ in range(4):
        for dept in ("women", "men"):
            for it in pools[dept]:
                if it["brand"] in brands or cats.get(it["category"], 0) >= 2:
                    continue
                picks.append(it); brands.add(it["brand"]); cats[it["category"]] = cats.get(it["category"], 0) + 1
                break
    counts = {}
    for it in every:
        counts[it["brand"]] = counts.get(it["brand"], 0) + 1
    names = [b for b, _ in sorted(counts.items(), key=lambda kv: -kv[1])]
    return {"pieces": len(every), "brands": len(names), "names": names[:24], "picks": picks}


def main(inline: bool) -> None:
    OUT.mkdir(exist_ok=True)
    if not inline:
        for f in WEB.iterdir():
            shutil.copy(f, OUT / f.name)
        if (OUT / "data").exists():
            shutil.rmtree(OUT / "data")
        shutil.copytree(DATA, OUT / "data", ignore=shutil.ignore_patterns("price_history.json", "collect_report.json", "items.json"))
        shards = shard_items()
        for dept, items in shards.items():
            (OUT / "data" / f"items-{dept}.json").write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")))
        (OUT / "data" / "landing.json").write_text(json.dumps(landing(shards), ensure_ascii=False))
        print("built", OUT)
        return
    names = FILES + [f"profiles/{p}.json" for p in json.loads((DATA / "profiles/index.json").read_text())]
    blob = {n: json.loads((DATA / n).read_text()) for n in names}
    shards = shard_items()
    for dept, items in shards.items():
        blob[f"items-{dept}.json"] = items
    blob["landing.json"] = landing(shards)
    for b in BINS:
        blob[b] = base64.b64encode((DATA / b).read_bytes()).decode()
    html = (WEB / "index.html").read_text()
    html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>{(WEB / 'style.css').read_text()}</style>")
    js = (WEB / "app.js").read_text()
    data_js = "window.FP_DATA=" + json.dumps(blob).replace("</", "<\\/") + ";"
    html = html.replace('<script src="app.js"></script>', f"<script>{data_js}</script>\n<script>{js}</script>")
    (OUT / "preview.html").write_text(html)
    print("built", OUT / "preview.html")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--inline", action="store_true")
    main(ap.parse_args().inline)
