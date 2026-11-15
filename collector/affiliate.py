"""Import products from affiliate product feeds (Awin first).

Affiliate feeds are how big retailers and luxury multi-brand shops share their catalogues
legitimately: one feed from a department store or luxury e-tailer can carry hundreds of designer
brands (Miu Miu, Loewe, Acne...), plus high-street names that don't publish Shopify catalogues.

Setup (once you have an Awin publisher account and have joined some advertisers):
  Awin -> Toolbox -> Create-a-Feed -> pick advertisers, CSV, gzip -> copy the download URL
  GitHub repo -> Settings -> Secrets and variables -> Actions -> New secret
      name: AWIN_FEED_URL   value: <that URL>
The daily run then imports it automatically.

Usage:  python -m collector.affiliate [--file feed.csv.gz]
Adds to: data/items.json (items tagged source="awin"), data/collect_report.json
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import os
import re
import urllib.request
from pathlib import Path

from collector import shopify

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG = ROOT / "config"
MAX_PER_BRAND = 300
MAX_TOTAL = 40000

LUXURY = {"prada", "miu miu", "gucci", "loewe", "bottega veneta", "saint laurent", "celine", "valentino", "balenciaga",
          "chloé", "chloe", "fendi", "givenchy", "burberry", "jil sander", "the row", "khaite", "toteme", "totême",
          "alaïa", "alaia", "versace", "dolce & gabbana", "moncler", "max mara", "loro piana", "brunello cucinelli",
          "zegna", "tom ford", "alexander mcqueen", "acne studios", "ami paris", "jacquemus", "maison margiela",
          "lemaire", "dries van noten", "stella mccartney", "isabel marant", "ganni", "nanushka"}
HIGH_STREET = {"h&m", "uniqlo", "zara", "mango", "& other stories", "massimo dutti", "cos", "arket", "next", "asos design",
               "river island", "topshop", "whistles", "jigsaw", "hobbs", "phase eight", "marks & spencer", "m&s", "gap"}


def _get(row: dict, *names: str) -> str:
    for n in names:
        if row.get(n):
            return row[n].strip()
    return ""


def tier_for(brand: str, known: dict) -> str:
    b = brand.lower()
    if b in known:
        return known[b]
    if b in LUXURY:
        return "luxury"
    if b in HIGH_STREET:
        return "high-street"
    return "premium"


def normalise_row(row: dict, fx: dict, known_tiers: dict) -> dict | None:
    title = _get(row, "product_name")
    brand = _get(row, "brand_name") or _get(row, "merchant_name")
    url = _get(row, "aw_deep_link", "merchant_deep_link")
    image = _get(row, "aw_image_url", "merchant_image_url", "large_image")
    if not (title and brand and url and image):
        return None
    if _get(row, "in_stock", "stock_status").lower() in ("0", "false", "no", "out of stock"):
        return None
    cur = _get(row, "currency") or "GBP"
    rate = fx.get(cur)
    if rate is None:
        return None
    try:
        price = float(_get(row, "search_price", "store_price", "display_price").replace(",", ""))
    except ValueError:
        return None
    try:
        was = float(_get(row, "rrp_price", "product_price_old").replace(",", "") or 0)
    except ValueError:
        was = 0.0
    cat_text = " ".join([_get(row, "category_name"), _get(row, "merchant_category"), _get(row, "merchant_product_category_path")])
    fake = {"title": title, "product_type": cat_text, "tags": []}
    dept = shopify.detect_department({"title": f"{title} {cat_text}", "product_type": "", "tags": []})
    sizes = [s.strip() for s in re.split(r"[,|;]", _get(row, "Fashion:size", "fashion_size", "size")) if s.strip()]
    letters = sorted({shopify.LETTER_SIZES[s.lower()] for s in sizes if s.lower() in shopify.LETTER_SIZES},
                     key=shopify.LETTER_ORDER.index)
    return {
        "id": f"awin:{_get(row, 'aw_product_id', 'merchant_product_id')}",
        "brand": brand,
        "retailer": _get(row, "merchant_name"),
        "source": "awin",
        "tier": tier_for(brand, known_tiers),
        "title": title,
        "url": url,
        "image": image,
        "images": [image],
        "category": shopify.detect_category(fake),
        "department": dept,
        "price_gbp": round(price * rate, 2),
        "compare_at_gbp": round(was * rate, 2) if was > price else None,
        "currency": cur,
        "in_stock": True,
        "sizes_available": sizes,
        "letter_sized": bool(letters),
        "letter_sizes": letters,
        "waist_sizes": [],
        "shoe_sizes": [],
        "colour": _get(row, "colour", "Fashion:colour"),
        "published_at": None,
    }


def read_feed(path_or_url: str) -> bytes:
    if re.match(r"https?://", path_or_url):
        req = urllib.request.Request(path_or_url, headers={"User-Agent": "FashionPlaceBot/0.1"})
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.read()
    return Path(path_or_url).read_bytes()


def parse(raw: bytes, fx: dict, known_tiers: dict) -> list[dict]:
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8", errors="replace")))
    out, per_brand = [], {}
    for row in reader:
        it = normalise_row(row, fx, known_tiers)
        if not it or it["category"] == "underwear":
            continue
        if per_brand.get(it["brand"], 0) >= MAX_PER_BRAND:
            continue
        per_brand[it["brand"]] = per_brand.get(it["brand"], 0) + 1
        out.append(it)
        if len(out) >= MAX_TOTAL:
            break
    return out


def run(source: str | None = None) -> int:
    source = source or os.environ.get("AWIN_FEED_URL")
    if not source:
        print("no AWIN_FEED_URL set — skipping affiliate import")
        return 0
    cfg = json.loads((CONFIG / "brands.json").read_text())
    known = {b["name"].lower(): b.get("tier", "premium") for b in cfg["brands"]}
    items = parse(read_feed(source), cfg["fx_to_gbp"], known)
    path = DATA / "items.json"
    d = json.loads(path.read_text()) if path.exists() else {"updated": None, "items": []}
    d["items"] = [it for it in d["items"] if it.get("source") != "awin"] + items
    path.write_text(json.dumps(d, ensure_ascii=False))
    rep_path = DATA / "collect_report.json"
    rep = json.loads(rep_path.read_text()) if rep_path.exists() else {"brands": {}}
    rep["awin"] = {"products": len(items), "brands": len({i["brand"] for i in items}), "retailers": sorted({i["retailer"] for i in items})}
    rep_path.write_text(json.dumps(rep, indent=2))
    print(f"awin: {len(items)} products from {rep['awin']['brands']} brands")
    return len(items)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--file")
    run(ap.parse_args().file)
