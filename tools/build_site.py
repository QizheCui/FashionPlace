"""Assemble the static site into _site/ (web app + data).

  python tools/build_site.py            -> _site/ with web files + data/ folder (for GitHub Pages)
  python tools/build_site.py --inline   -> _site/preview.html, one self-contained file with data baked in
"""
import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB, DATA, OUT = ROOT / "web", ROOT / "data", ROOT / "_site"
FILES = ["items.json", "vectors.json", "vibes.json", "brands.json", "profiles/index.json"]


def main(inline: bool) -> None:
    OUT.mkdir(exist_ok=True)
    if not inline:
        for f in WEB.iterdir():
            shutil.copy(f, OUT / f.name)
        if (OUT / "data").exists():
            shutil.rmtree(OUT / "data")
        shutil.copytree(DATA, OUT / "data")
        print("built", OUT)
        return
    names = FILES + [f"profiles/{p}.json" for p in json.loads((DATA / "profiles/index.json").read_text())]
    blob = {n: json.loads((DATA / n).read_text()) for n in names}
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
