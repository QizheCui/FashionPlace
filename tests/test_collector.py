import json
import subprocess
import sys
from pathlib import Path

from collector import collect, shopify

FIX = Path(__file__).parent / "fixtures"
BRAND = {"name": "Test", "domain": "t.example", "currency": "USD", "favourite": False}
FX = {"USD": 0.8, "GBP": 1.0}


def setup_module():
    subprocess.run([sys.executable, str(Path(__file__).parent / "make_fixtures.py")], check=True)


def raw(title="Oxford Shirt", ptype="Shirts", tags=("mens",), sizes=("S", "M", "L"), price="100.00", compare=None, avail=True):
    return {
        "id": 1, "title": title, "handle": "h", "product_type": ptype, "tags": list(tags),
        "options": [{"name": "Size"}], "images": [{"src": "https://cdn.shopify.com/x.jpg"}],
        "variants": [{"title": s, "option1": s, "price": price, "compare_at_price": compare, "available": avail} for s in sizes],
    }


def test_normalise_converts_currency_and_sale():
    it = shopify.normalise(raw(price="100.00", compare="150.00"), BRAND, FX)
    assert it["price_gbp"] == 80.0 and it["compare_at_gbp"] == 120.0
    assert it["size_m_available"] is True and it["category"] == "shirts"
    assert it["image"].endswith("?width=600")


def test_department_and_category_detection():
    assert shopify.normalise(raw("Women's Cardigan", "Knitwear", tags=()), BRAND, FX)["department"] == "women"
    assert shopify.normalise(raw("Suede Chore Jacket", "Jackets"), BRAND, FX)["category"] == "outerwear"
    assert shopify.normalise(raw("Penny Loafer", "Footwear", sizes=("9", "10")), BRAND, FX)["size_m_available"] is None


def test_history_and_deal_verdicts():
    hist = {}
    item = {"id": "a", "price_gbp": 100.0, "compare_at_gbp": None}
    collect.update_history(hist, [item], "2026-11-01")
    item2 = {"id": "a", "price_gbp": 70.0, "compare_at_gbp": 100.0}
    collect.update_history(hist, [item2], "2026-11-20")
    d = collect.deal_info(item2, hist["a"], "2026-11-20")
    assert d["verdict"] == "real_drop" and d["discount_pct"] == 30 and d["is_lowest_price"]

    # always 'reduced' for a month -> flagged as a permanent markdown
    h2 = {}
    fake = {"id": "b", "price_gbp": 50.0, "compare_at_gbp": 90.0}
    collect.update_history(h2, [fake], "2026-10-01")
    collect.update_history(h2, [fake], "2026-11-01")
    assert collect.deal_info(fake, h2["b"], "2026-11-01")["verdict"] == "always_on_sale"


def test_full_run_on_fixtures(tmp_path, monkeypatch):
    monkeypatch.setattr(collect, "DATA", tmp_path)
    report = collect.run(fixture_dir=FIX, today="2026-11-15")
    items = json.loads((tmp_path / "items.json").read_text())["items"]
    assert report["brands"]["Wax London"]["status"] == "ok"
    assert report["brands"]["Reiss"]["status"] == "skipped"
    assert report["brands"]["Sunspel"]["status"] == "failed"  # no fixture -> handled gracefully
    assert len(items) > 20 and all("deal" in i for i in items)


def test_no_false_accessory_matches():
    assert shopify.normalise(raw("Harrington Jacket", "Jackets"), BRAND, FX)["category"] == "outerwear"
    assert shopify.normalise(raw("Herringbone Wool Trousers", "Trousers"), BRAND, FX)["category"] == "trousers"
    assert shopify.normalise(raw("Milton Tee", "T-Shirts"), BRAND, FX)["category"] == "tshirts"


def test_basics_are_not_fashion_picks():
    assert shopify.normalise(raw("Superfine Cotton Boxer Briefs in Navy", "Underwear"), BRAND, FX)["category"] == "underwear"
    assert shopify.normalise(raw("Leather Briefcase", "Bags"), BRAND, FX)["category"] == "bags"


def test_letter_sizes_normalised():
    it = shopify.normalise(raw(sizes=("Small", "Medium", "Large")), BRAND, FX)
    assert it["letter_sized"] and it["letter_sizes"] == ["S", "M", "L"]
    shoe = shopify.normalise(raw("Loafer", "Shoes", sizes=("8", "9")), BRAND, FX)
    assert shoe["letter_sized"] is False and shoe["letter_sizes"] == []


def test_numeric_sizes():
    assert [shopify.numeric_size(x) for x in ["32", "W32", "32R", "32/32", "9.5", "UK 9", "EU 43", "M", "One Size"]] == \
        [32, 32, 32, 32, 9.5, 9, 43, None, None]
    tr = shopify.normalise(raw("Pleated Trouser", "Trousers", sizes=("30", "32", "34")), BRAND, FX)
    assert tr["waist_sizes"] == [30, 32, 34] and tr["shoe_sizes"] == []
    sh = shopify.normalise(raw("Suede Loafer", "Shoes", sizes=("EU 42", "EU 43")), BRAND, FX)
    assert sh["shoe_sizes"] == [8, 9]


def test_single_department_brand_claims_untagged_items():
    menswear = {**BRAND, "departments": ["men"]}
    assert shopify.normalise(raw("Oxford Shirt", tags=()), menswear, FX)["department"] == "men"
    both = {**BRAND, "departments": ["men", "women"]}
    assert shopify.normalise(raw("Oxford Shirt", tags=()), both, FX)["department"] == "unisex"
