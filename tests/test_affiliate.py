import gzip

from collector import affiliate

CSV = """aw_product_id,product_name,brand_name,merchant_name,aw_deep_link,aw_image_url,search_price,rrp_price,currency,category_name,merchant_category,in_stock,Fashion:size
1,Miu Miu Cropped Wool Cardigan,Miu Miu,Luxury Store,https://www.awin1.com/x,https://img/1.jpg,1250.00,,GBP,Women's Knitwear,Womens > Knitwear,1,"XS,S,M"
2,Wide Leg Tailored Trousers,COS,Big Retailer,https://www.awin1.com/y,https://img/2.jpg,69.00,89.00,GBP,Women's Trousers,Womens > Trousers,1,"S,M,L"
3,Sold Out Shirt,COS,Big Retailer,https://www.awin1.com/z,https://img/3.jpg,40.00,,GBP,Men's Shirts,Mens > Shirts,0,M
4,Boxer Briefs 3-Pack,Uniqlo,Big Retailer,https://www.awin1.com/w,https://img/4.jpg,19.00,,GBP,Men's Underwear,Mens > Underwear,1,M
"""


def test_parse_awin_feed():
    fx = {"GBP": 1.0}
    items = affiliate.parse(gzip.compress(CSV.encode()), fx, {"cos": "high-street"})
    assert [i["title"] for i in items] == ["Miu Miu Cropped Wool Cardigan", "Wide Leg Tailored Trousers"]
    miu, cos = items
    assert miu["tier"] == "luxury" and miu["department"] == "women" and miu["category"] == "knitwear"
    assert miu["letter_sizes"] == ["XS", "S", "M"] and miu["retailer"] == "Luxury Store"
    assert cos["tier"] == "high-street" and cos["compare_at_gbp"] == 89.0 and cos["category"] == "trousers"
