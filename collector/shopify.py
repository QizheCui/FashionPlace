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
SIZE_M_VALUES = {"m", "medium", "md", "m/l"}
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


def detect_category(p: dict) -> str:
    blob = f"{p.get('product_type', '')} {p.get('title', '')}".lower()
    for cat, pattern in CATEGORY_RULES:
        if re.search(pattern, blob):
            return cat
    return "other"


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
    sizes_available, size_m_available = [], False
    for v in variants:
        value = v.get(f"option{idx + 1}") if idx is not None else v.get("title")
        if value and v.get("available"):
            sizes_available.append(value)
            if value.strip().lower() in SIZE_M_VALUES:
                size_m_available = True
    has_letter_sizes = any(
        (v.get(f"option{idx + 1}") or "").strip().lower() in {"xs", "s", "m", "l", "xl", "xxl", "medium", "small", "large"}
        for v in variants
    ) if idx is not None else False

    available = [v for v in variants if v.get("available")] or variants
    price = min(float(v["price"]) for v in available if v.get("price"))
    compare = max((float(v["compare_at_price"]) for v in available if v.get("compare_at_price")), default=0.0)
    images = [i.get("src") for i in (p.get("images") or []) if i.get("src")]

    return {
        "id": f"{brand['domain']}:{p['id']}",
        "brand": brand["name"],
        "favourite_brand": bool(brand.get("favourite")),
        "title": p.get("title", "").strip(),
        "url": f"https://{brand['domain']}/products/{p.get('handle')}",
        "image": _shopify_img(images[0]) if images else "",
        "images": [_shopify_img(s) for s in images[:4]],
        "category": detect_category(p),
        "department": detect_department(p),
        "price_gbp": round(price * rate, 2),
        "compare_at_gbp": round(compare * rate, 2) if compare > price else None,
        "currency": brand.get("currency", "GBP"),
        "in_stock": any(v.get("available") for v in variants),
        "sizes_available": sizes_available,
        # None = sizing isn't S/M/L (e.g. waist sizes, one-size) so we can't judge
        "size_m_available": size_m_available if has_letter_sizes else None,
        "published_at": p.get("published_at"),
    }
