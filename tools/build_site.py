"""Assemble the static site into _site/ (web app + data).

  python tools/build_site.py            -> _site/ with web files + data/ folder (for GitHub Pages)
  python tools/build_site.py --inline   -> _site/preview.html, one self-contained file with data baked in
"""
import argparse
import base64
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB, DATA, OUT = ROOT / "web", ROOT / "data", ROOT / "_site"
FILES = ["items.json", "vectors_meta.json", "vibes.json", "brands.json", "brand_stats.json", "refiners.json", "profiles/index.json"]


BINS = ["vectors.bin", "projection.bin"]
KEEP = ["id", "brand", "title", "url", "image", "category", "department", "price_gbp", "compare_at_gbp", "in_stock",
        "letter_sized", "letter_sizes", "waist_sizes", "shoe_sizes", "deal"]
DEAL_KEEP = ["verdict", "discount_pct", "is_lowest_price", "tracked_days"]


def slim_items(path: Path) -> None:
    """The web app only needs a few fields per product; trimming keeps the phone download small."""
    d = json.loads(path.read_text())
    out = []
    for it in d["items"]:
        x = {k: it[k] for k in KEEP if it.get(k) not in (None, [], False) or k in ("in_stock", "price_gbp")}
        if it.get("deal") and it["deal"].get("verdict"):
            x["deal"] = {k: it["deal"][k] for k in DEAL_KEEP if k in it["deal"]}
        else:
            x.pop("deal", None)
        out.append(x)
    path.write_text(json.dumps({"updated": d["updated"], "items": out}, ensure_ascii=False, separators=(",", ":")))


def main(inline: bool) -> None:
    OUT.mkdir(exist_ok=True)
    if not inline:
        for f in WEB.iterdir():
            shutil.copy(f, OUT / f.name)
        if (OUT / "data").exists():
            shutil.rmtree(OUT / "data")
        shutil.copytree(DATA, OUT / "data", ignore=shutil.ignore_patterns("price_history.json", "collect_report.json"))
        slim_items(OUT / "data" / "items.json")
        print("built", OUT)
        return
    names = FILES + [f"profiles/{p}.json" for p in json.loads((DATA / "profiles/index.json").read_text())]
    blob = {n: json.loads((DATA / n).read_text()) for n in names}
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
