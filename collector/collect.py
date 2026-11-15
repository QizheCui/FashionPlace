"""Daily collector: pull every brand's catalogue, normalise, update price history.

Usage:  python -m collector.collect [--only "Wax London"] [--fixture tests/fixtures]
Writes: data/items.json, data/price_history.json, data/collect_report.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

from collector import shopify

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG = ROOT / "config"
HISTORY_DAYS = 90


def load_json(path: Path, default):
    return json.loads(path.read_text()) if path.exists() else default


def update_history(history: dict, items: list[dict], today: str) -> None:
    """Record a price point whenever an item's price changes; keep ~90 days."""
    cutoff = (dt.date.fromisoformat(today) - dt.timedelta(days=HISTORY_DAYS)).isoformat()
    for it in items:
        h = history.setdefault(it["id"], {"first_seen": today, "points": []})
        h["last_seen"] = today
        pts = h["points"]
        if not pts or pts[-1][1] != it["price_gbp"]:
            pts.append([today, it["price_gbp"]])
        # keep the last point before the cutoff so we still know the "previous" price
        old = [p for p in pts if p[0] < cutoff]
        h["points"] = old[-1:] + [p for p in pts if p[0] >= cutoff]


def deal_info(item: dict, hist: dict | None, today: str) -> dict:
    """Is this a *real* deal? Compare against prices we've actually seen, not just the 'was' price."""
    pts = (hist or {}).get("points", [])
    seen_prices = [p[1] for p in pts]
    highest_seen = max(seen_prices, default=item["price_gbp"])
    lowest_seen = min(seen_prices, default=item["price_gbp"])
    was = item.get("compare_at_gbp")
    tracked_days = (dt.date.fromisoformat(today) - dt.date.fromisoformat(hist["first_seen"])).days if hist else 0

    reference = max(highest_seen, was or 0)
    pct = round(100 * (1 - item["price_gbp"] / reference)) if reference > item["price_gbp"] else 0
    if highest_seen > item["price_gbp"]:
        verdict = "real_drop"          # we watched the price fall
    elif was and tracked_days < 14:
        verdict = "on_sale_unverified"  # brand says it's reduced, we haven't tracked long enough
    elif was:
        verdict = "always_on_sale"      # 'reduced' the whole time we've watched -> fake-ish
    else:
        verdict = None
    return {
        "verdict": verdict,
        "discount_pct": pct,
        "lowest_seen_gbp": lowest_seen,
        "is_lowest_price": item["price_gbp"] <= lowest_seen,
        "tracked_days": tracked_days,
    }


def load_fixture(fixture_dir: Path, brand: dict) -> list[dict]:
    path = fixture_dir / f"{brand['domain']}.json"
    if not path.exists():
        raise shopify.FetchError("no fixture")
    return json.loads(path.read_text())["products"]


def run(only: str | None = None, fixture_dir: Path | None = None, today: str | None = None) -> dict:
    today = today or dt.date.today().isoformat()
    cfg = load_json(CONFIG / "brands.json", {})
    fx = cfg.get("fx_to_gbp", {"GBP": 1.0})
    DATA.mkdir(exist_ok=True)

    previous = {it["id"]: it for it in load_json(DATA / "items.json", {"items": []})["items"]}
    history = load_json(DATA / "price_history.json", {})
    report, items = {"date": today, "brands": {}}, []

    for brand in cfg["brands"]:
        if only and brand["name"] != only:
            continue
        if brand["source"] != "shopify":
            report["brands"][brand["name"]] = {"status": "skipped", "reason": f"source={brand['source']} (needs feed)"}
            continue
        try:
            raw = load_fixture(fixture_dir, brand) if fixture_dir else shopify.fetch_store(brand["domain"])
        except shopify.FetchError as e:
            # keep yesterday's items for this brand so one bad day doesn't empty the feed
            kept = [it for it in previous.values() if it["brand"] == brand["name"]]
            items.extend(kept)
            report["brands"][brand["name"]] = {"status": "failed", "reason": str(e), "kept_previous": len(kept)}
            print(f"✗ {brand['name']}: {e}")
            continue
        norm = [n for n in (shopify.normalise(p, brand, fx) for p in raw) if n]
        items.extend(norm)
        report["brands"][brand["name"]] = {"status": "ok", "products": len(norm)}
        print(f"✓ {brand['name']}: {len(norm)} products")

    update_history(history, items, today)
    for it in items:
        it["deal"] = deal_info(it, history.get(it["id"]), today)
        prev = previous.get(it["id"])
        it["first_seen"] = history[it["id"]]["first_seen"]
        it["is_new"] = prev is None and bool(previous)

    (DATA / "items.json").write_text(json.dumps({"updated": today, "items": items}, ensure_ascii=False))
    (DATA / "price_history.json").write_text(json.dumps(history, separators=(",", ":")))
    (DATA / "collect_report.json").write_text(json.dumps(report, indent=2))
    return report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="collect a single brand by name")
    ap.add_argument("--fixture", type=Path, help="read raw products from fixture dir instead of the web")
    ap.add_argument("--today", help="override today's date (YYYY-MM-DD), for testing")
    a = ap.parse_args()
    run(a.only, a.fixture, a.today)


if __name__ == "__main__":
    main()
