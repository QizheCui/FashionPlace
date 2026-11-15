"""Generate small *synthetic* Shopify-shaped fixtures so the pipeline and UI can be tested offline.
These are invented test products, not real catalogue data."""
import json
import random
from pathlib import Path

random.seed(7)
OUT = Path(__file__).parent / "fixtures"
OUT.mkdir(exist_ok=True)

CATALOGUE = {
    "www.waxlondon.com": [
        ("Fowey Overshirt - Olive Cord", "Overshirts", 145, None, "men"),
        ("Milton Tee - Off White Sailing Graphic", "T-Shirts", 56, 70, "men"),
        ("Alston Trouser - Navy Wool Blend Pleated", "Trousers", 135, None, "men"),
        ("Kemp Jacket - Camel Wool Harrington", "Jackets", 229, 285, "men"),
        ("Hampton Knit - Brown Chunky Cable Lambswool", "Knitwear", 125, None, "men"),
        ("Neon Running Shorts - Shiny Technical", "Shorts", 45, None, "men"),
        ("Women's Leah Cardigan - Cream", "Knitwear", 110, None, "women"),
    ],
    "percivalclo.com": [
        ("Oxford Button Down Shirt - Ecru", "Shirts", 95, None, "men"),
        ("Varsity Cardigan - Burgundy Mohair", "Knitwear", 175, None, "men"),
        ("Pleated Corduroy Trousers - Tobacco Brown", "Trousers", 120, 150, "men"),
        ("Big Logo Hoodie - Black", "Sweats", 90, None, "men"),
        ("Suede Chore Jacket - Chocolate", "Jackets", 395, None, "men"),
        ("Rugby Shirt - Navy Cream Stripe Vintage", "Shirts", 110, None, "men"),
    ],
    "oliverspencer.co.uk": [
        ("Grandad Collar Shirt - Navy Flannel", "Shirts", 125, None, "men"),
        ("Fisherman Cardigan - Ecru Boucle", "Knitwear", 215, 275, "men"),
        ("Relaxed Wool Trousers - Grey Herringbone", "Trousers", 165, None, "men"),
        ("Buckland Jacket - Green Moleskin", "Jackets", 279, None, "men"),
        ("Leather Loafers - Dark Brown Suede", "Shoes", 195, None, "men"),
    ],
    "www.kestin.co": [
        ("Inverness Overshirt - Moss Wool", "Overshirts", 165, None, "men"),
        ("Crew Neck Jumper - Rust Lambswool", "Knitwear", 115, 145, "men"),
        ("Tapered Chino - Stone Cotton Twill", "Trousers", 110, None, "men"),
        ("Leather Tote Bag - Tan", "Bags", 185, None, "men"),
    ],
    "www.colhays.com": [
        ("Shawl Collar Cardigan - Bottle Green Cashmere Blend", "Knitwear", 245, None, "men"),
        ("Fair Isle Crew - Oatmeal Vintage Pattern", "Knitwear", 185, None, "men"),
        ("Lambswool Scarf - Camel", "Scarves", 65, None, "men"),
    ],
}


def product(i, domain, title, ptype, price, compare, dept):
    sizes = ["S", "M", "L", "XL"] if ptype not in ("Shoes", "Bags", "Scarves") else ["One Size"]
    if ptype == "Shoes":
        sizes = ["8", "9", "10", "11"]
    sold_out_m = random.random() < 0.15
    handle = title.lower().replace(" - ", "-").replace(" ", "-").replace("'", "")
    return {
        "id": 1000 + i,
        "title": title,
        "handle": handle,
        "product_type": ptype,
        "tags": ["womens" if dept == "women" else "mens"],
        "options": [{"name": "Size", "position": 1}],
        "images": [{"src": f"https://cdn.shopify.com/s/files/test/{handle}.jpg"}],
        "variants": [
            {"title": s, "option1": s, "price": f"{price:.2f}",
             "compare_at_price": f"{compare:.2f}" if compare else None,
             "available": not (s == "M" and sold_out_m)}
            for s in sizes
        ],
        "published_at": "2026-11-01T10:00:00+00:00",
    }


for domain, rows in CATALOGUE.items():
    prods = [product(i, domain, *r) for i, r in enumerate(rows)]
    (OUT / f"{domain}.json").write_text(json.dumps({"products": prods}, indent=1))
print("fixtures written to", OUT)
