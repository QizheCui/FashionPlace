"""Fetch and normalise products from a Shopify store's public /products.json feed."""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
import urllib.robotparser

USER_AGENT = "FashionPlaceBot/0.1 (personal shopping aggregator; github.com/QizheCui/FashionPlace)"
PAGE_SIZE = 250
MAX_PAGES = 40
DELAY_SECONDS = 1.5  # be polite: one request every 1.5s per store

WOMEN_RE = re.compile(r"\b(women'?s?|womens|womenswear|ladies|female)\b", re.I)
MEN_RE = re.compile(r"\b(men'?s?|mens|menswear|male)\b", re.I)
LETTER_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"]
LETTER_SIZES = {
    **{x.lower(): x for x in LETTER_ORDER},
    "small": "S", "medium": "M", "md": "M", "large": "L", "x-small": "XS", "x-large": "XL",
    "xx-large": "XXL", "2xl": "XXL", "3xl": "XXXL", "extra small": "XS", "extra large": "XL",
}
NON_SIZE_OPTIONS = {"color", "colour", "style", "material", "title"}

CATEGORY_RULES = [
    ("underwear", r"boxer|\bbriefs?\b|\btrunks\b|underwear|undershirt|vest top|pyjama|pajama|lounge pant|robe\b|gift card|gift voucher"),
    ("shoes", r"shoe|boot|loafer|sneaker|trainer|derby|sandal|mule|slipper"),
    ("bags", r"\bbag|tote|backpack|holdall|duffle|pouch|wallet|card holder"),
    ("accessories", r"\bhats?\b|beanie|\bcaps?\b|scarf|scarves|glove|\bbelts?\b|\bties?\b|\bsocks?\b|sunglass|umbrella|jewel|\brings?\b|necklace"),
    ("tailoring", r"blazer|suit|waistcoat|sport coat|tuxedo"),
    ("outerwear", r"jacket|coat|parka|gilet|vest|overcoat|bomber|harrington|anorak|overshirt|chore"),
    ("knitwear", r"knit|jumper|sweater|cardigan|crew neck|crewneck|roll ?neck|turtle|polo neck|merino|cashmere|lambswool"),
    ("sweats", r"sweatshirt|hoodie|sweat\b|fleece"),
    ("tshirts", r"t-shirt|tee\b|tees\b|t shirt|polo"),
    ("shirts", r"shirt|oxford|flannel"),
    ("trousers", r"trouser|chino|pant|cord\b|corduroy"),
    ("denim", r"jean|denim"),
    ("shorts", r"short"),
]


class FetchError(Exception):
    pass


def _get_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if "json" not in resp.headers.get("Content-Type", ""):
            raise FetchError(f"not JSON ({resp.headers.get('Content-Type')})")
        return json.loads(resp.read().decode("utf-8"))


def allowed_by_robots(domain: str) -> bool:
    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(f"https://{domain}/robots.txt")
    try:
        rp.read()
    except Exception:
        return True  # no robots.txt reachable -> default allow
    return rp.can_fetch(USER_AGENT, f"https://{domain}/products.json")


def detect_currency(domain: str) -> str | None:
    """Shopify's cart endpoint reports the store's currency, so we don't have to guess."""
    try:
        return _get_json(f"https://{domain}/cart.js").get("currency")
    except Exception:
        return None


def fetch_store(domain: str) -> list[dict]:
    """Return raw Shopify products for a store. Raises FetchError if it isn't a usable Shopify store."""
    if not allowed_by_robots(domain):
        raise FetchError("robots.txt disallows /products.json")
    products: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        url = f"https://{domain}/products.json?limit={PAGE_SIZE}&page={page}"
        try:
            data = _get_json(url)
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as e:
            if page == 1:
                raise FetchError(str(e)) from e
            break
        batch = data.get("products") or []
        products.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        time.sleep(DELAY_SECONDS)
    if not products:
        raise FetchError("no products returned")
    return products


def _text_blob(p: dict) -> str:
    tags = p.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",")]
    return " ".join([p.get("title", ""), p.get("product_type", ""), " ".join(tags)])


def detect_department(p: dict) -> str:
    blob = _text_blob(p)
    w, m = bool(WOMEN_RE.search(blob)), bool(MEN_RE.search(blob))
    if w and not m:
        return "women"
    if m and not w:
        return "men"
    return "unisex"


def department_for(p: dict, brand: dict) -> str:
    """Untagged items take their brand's department: a menswear-only label's 'unisex' tee is menswear."""
    dept = detect_department(p)
    deps = brand.get("departments") or []
    if dept == "unisex" and len(deps) == 1:
        return deps[0]
    return dept


def detect_category(p: dict) -> str:
    blob = f"{p.get('product_type', '')} {p.get('title', '')}".lower()
    for cat, pattern in CATEGORY_RULES:
        if re.search(pattern, blob):
            return cat
    return "other"


NUM_SIZE_RE = re.compile(r"^\s*(?:W\s*)?(\d{1,2}(?:\.5)?)\s*(?:\"|in|R|S|L|UK|EU|/\s*\d{2}|\s*[x(].*)?\s*$", re.I)


def numeric_size(value: str) -> float | None:
    """'32', 'W32', '32R', '32/32', '9.5', 'UK 9', 'EU 43' -> number; anything else -> None."""
    v = re.sub(r"^(UK|EU|US)\s*", "", value.strip(), flags=re.I)
    m = NUM_SIZE_RE.match(v)
    if not m:
        return None
    n = float(m.group(1))
    return n if 4 <= n <= 50 else None


def eu_to_uk(n: float) -> float:
    """Shoe sizes >= 35 are EU; UK ~= EU - 34 (rounded to the half size)."""
    return round((n - 34) * 2) / 2 if n >= 35 else n


def _size_option_index(p: dict) -> int | None:
    for i, opt in enumerate(p.get("options") or []):
        name = (opt.get("name") if isinstance(opt, dict) else str(opt)).strip().lower()
        if "size" in name:
            return i
    for i, opt in enumerate(p.get("options") or []):
        name = (opt.get("name") if isinstance(opt, dict) else str(opt)).strip().lower()
        if name not in NON_SIZE_OPTIONS:
            return i
    return None


def _shopify_img(src: str, width: int = 600) -> str:
    if not src:
        return ""
    sep = "&" if "?" in src else "?"
    return f"{src}{sep}width={width}"


def normalise(p: dict, brand: dict, fx: dict) -> dict | None:
    variants = p.get("variants") or []
    if not variants:
        return None
    rate = fx.get(brand.get("currency", "GBP"), 1.0)
    idx = _size_option_index(p)
    sizes_available, letter_sizes, num_sizes = [], set(), set()
    letter_sized = False
    for v in variants:
        value = (v.get(f"option{idx + 1}") if idx is not None else v.get("title")) or ""
        letter = LETTER_SIZES.get(value.strip().lower())
        letter_sized |= letter is not None
        if value and v.get("available"):
            sizes_available.append(value)
            if letter:
                letter_sizes.add(letter)
            n = numeric_size(value)
            if n is not None:
                num_sizes.add(n)

    available = [v for v in variants if v.get("available")] or variants
    price = min(float(v["price"]) for v in available if v.get("price"))
    compare = max((float(v["compare_at_price"]) for v in available if v.get("compare_at_price")), default=0.0)
    images = [i.get("src") for i in (p.get("images") or []) if i.get("src")]

    cat = detect_category(p)
    return {
        "id": f"{brand['domain']}:{p['id']}",
        "brand": brand["name"],
        "favourite_brand": bool(brand.get("favourite")),
        "title": p.get("title", "").strip(),
        "url": f"https://{brand['domain']}/products/{p.get('handle')}",
        "image": _shopify_img(images[0]) if images else "",
        "images": [_shopify_img(s) for s in images[:4]],
        "category": cat,
        "department": department_for(p, brand),
        "price_gbp": round(price * rate, 2),
        "compare_at_gbp": round(compare * rate, 2) if compare > price else None,
        "currency": brand.get("currency", "GBP"),
        "in_stock": any(v.get("available") for v in variants),
        "sizes_available": sizes_available,
        # letter sizes in stock, normalised (XS..XXL); [] with letter_sized=False means waist/shoe/one-size
        "letter_sized": letter_sized,
        "letter_sizes": sorted(letter_sizes, key=LETTER_ORDER.index),
        # waist sizes for trousers/denim, UK sizes for shoes (EU converted); empty if not numeric
        "waist_sizes": sorted(num_sizes) if cat in ("trousers", "denim", "shorts") else [],
        "shoe_sizes": sorted({eu_to_uk(n) for n in num_sizes}) if cat == "shoes" else [],
        # kept for older app versions
        "size_m_available": ("M" in letter_sizes) if letter_sized else None,
        "published_at": p.get("published_at"),
    }
