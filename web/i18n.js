/* Atelier ONE — 中文 / English.
 * The app is written in English; in Chinese mode this file translates what's on screen as it appears
 * (text, placeholders, tooltips). Product titles and brand names stay as the brands write them. */
(function () {
  const KEY = "fp:lang";
  const CAT = { trousers: "裤装", denim: "牛仔", jeans: "牛仔裤", knitwear: "针织", shirts: "衬衫", tshirts: "T恤", "t-shirts": "T恤", outerwear: "外套",
    tailoring: "西装", shoes: "鞋履", bags: "包袋", accessories: "配饰", dresses: "连衣裙", skirts: "半身裙", tops: "上衣", sweats: "卫衣",
    activewear: "运动服", shorts: "短裤", all: "全部", other: "其他" };
  const ZH = {
    // landing
    "How it works": "如何运作", "Brands": "品牌", "Sign in": "登录", "A private stylist for one": "只为你一人的私人造型师",
    "Your taste,": "你的品味，", "found in every brand.": "在每个品牌里找到。",
    "Describe your style — in a word, a feeling or a photo. Atelier ONE searches": "用一个词、一种感觉或一张照片描述你的风格。Atelier ONE 搜遍",
    "brands and brings back pieces that are truly you, in your size, at the right price.": "个品牌，带回真正属于你的单品——合你的尺码，价格也刚好。",
    "Describe your style": "描述你的风格", "Show me": "开始寻找", "Try:": "试试：",
    "Quiet luxury, under £200": "低调奢华，£200 以内", "Dark trousers for work and dinner": "上班和晚餐都能穿的深色长裤",
    "Blue cashmere scarf for winter": "冬天的蓝色羊绒围巾", "French girl, but make it winter": "法式少女风，冬日版",
    "Tell us your taste": "告诉我们你的品味", "A feeling, a photo, a few pieces you love. It takes a minute.": "一种感觉、一张照片、几件你喜欢的单品。只需一分钟。",
    "We search every brand": "我们搜遍每个品牌", "Independent labels to designer houses — filtered to your size and budget.": "从独立品牌到设计师品牌——按你的尺码和预算筛选。",
    "Buy at the right price": "在对的价格入手", "We track prices daily, so you see genuine discounts — and when it's worth waiting.": "我们每天追踪价格，让你看到真正的折扣，也知道什么时候值得再等等。",
    "One feed across": "一个页面，汇集", "Find my style — it's free": "找到我的风格——免费",
    "We read brands' public catalogues once a day and link you straight to the brand to buy. Prices are shown in pounds; some brands ship from abroad.": "我们每天读取一次品牌公开的商品目录，并直接链接到品牌官网购买。价格以英镑显示，部分品牌从海外发货。",
    "Your profile and likes are saved only on this device. No account needed. We count searches and clicks anonymously to improve results: no cookies, nothing that identifies you.": "你的资料和收藏只保存在这台设备上，无需注册。我们会匿名统计搜索和点击来改进结果：不用 Cookie，不收集任何能识别你的信息。",
    "Today in the feed": "今日精选", "More that matches": "更多相符单品", "Make this my taste →": "把这设为我的品味 →",
    "Searching every brand…": "正在搜索所有品牌…", "Nothing in our brands matches that yet — try removing a word or two.": "暂时没有相符的单品——试着删掉一两个词。",
    "Search works on the live site.": "搜索功能在正式网站上可用。",
    // the stylist
    "The edit": "造型师精选", "Our stylist is reading your words…": "造型师正在理解你的描述…", "Planning the look, piece by piece…": "正在逐件搭配整体造型…",
    "Searching every brand for each piece…": "正在为每一件搜索所有品牌…", "Planned by an AI stylist, found by our own search across every brand.": "由 AI 造型师搭配，由我们的搜索在所有品牌中找到。",
    "Part of the look": "整体造型的一部分", "Understanding your words…": "正在理解你的描述…",
    "Chinese search needs our AI stylist, which can't be reached just now — try again in a moment, or search in English.": "中文搜索需要 AI 造型师，目前暂时连接不上——请稍后再试，或用英文搜索。",
    // app header and tabs
    "For You": "为你推荐", "Explore": "探索", "Deals": "折扣", "Saved": "收藏", "Search": "搜索",
    "Every brand, one feed, ranked by your taste. ♥ or ✕ and it reshapes instantly.": "所有品牌，一个页面，按你的品味排序。点 ♥ 或 ✕，推荐会立刻调整。",
    "Close to your taste, one step outside it — mostly from labels you haven't met yet.": "贴近你的品味，又往外走一步——大多来自你还不认识的品牌。",
    "Discounts on pieces that are actually you. We check price history, so fake 'sales' don't make it here.": "真正适合你的单品折扣。我们核查历史价格，假打折不会出现在这里。",
    "Everything you've ♥'d — we keep an eye on price and your size.": "你 ♥ 过的所有单品——我们帮你盯着价格和尺码。",
    "What you asked for first, then ranked by your taste.": "先显示你要找的，再按你的品味排序。",
    "Nothing matches that in our brands yet — try removing a filter above.": "暂时没有相符的单品——试着去掉上面的某个筛选。",
    "Nothing saved yet — tap ♥ on anything you love.": "还没有收藏——看到喜欢的就点 ♥。", "Nothing here — try widening the price range or sizes.": "这里还没有单品——试着放宽价格或尺码。",
    "Loading every piece in this category…": "正在载入这个品类的所有单品…", "Loading…": "载入中…",
    "Your feed leans": "你的推荐偏向", "♥ and ✕ pieces to teach it": "点 ♥ 和 ✕ 来调教它", "Tune my taste": "调整我的品味",
    "Not quite right?": "不太对？", "Nudge the feed": "微调推荐", "Keep in my taste": "保存到我的品味", "Reset": "重置", "Apply": "应用",
    "…or tell me: “darker trousers for work and a dinner date”": "…或者直接告诉我：“上班和约会都能穿的深色长裤”",
    "Darker": "更深色", "Lighter": "更浅色", "Smarter": "更正式", "More casual": "更休闲", "Plainer": "更素净", "Bolder": "更大胆",
    "Slimmer fit": "更修身", "Roomier fit": "更宽松", "Warmer": "更保暖", "Dressier": "更精致",
    "Price": "价格", "Familiar": "熟悉", "Surprise me": "给我惊喜", "Brands to know": "值得认识的品牌", "See their pieces →": "看看他们的单品 →",
    "Showing their pieces ✓": "正在显示他们的单品 ✓", "New brand to you": "新认识的品牌", "Lowest we've seen": "历史最低价", "Live from the shops": "实时来自各店铺",
    "searching every brand right now…": "正在实时搜索所有品牌…", "couldn't reach the shops just now": "暂时连接不上店铺",
    "Looking for": "正在找", "Clear": "清除", "Menswear": "男装", "Womenswear": "女装",
    "Love it": "喜欢", "Your photos": "你的照片", "your photos": "你的照片", "Love": "喜欢", "Switch to English": "Switch to English", "Not for me": "不适合我", "Surprise me with this": "用这个给我惊喜",
    "Sold out": "已售罄", "Not in your size right now": "暂无你的尺码", "Back in your size": "你的尺码有货了",
    "Few sizes left — may not last": "尺码所剩不多——可能很快售罄", "Black Friday weekend — check the brand's site for codes": "黑五周末——去品牌官网看看优惠码",
    "Wait? Winter sales usually start around Boxing Day": "要不要等等？冬季大促通常在节礼日（12月26日）前后开始",
    "Summer sales are on or close — worth checking": "夏季大促已经开始或即将开始——值得看看",
    "Saved — more like this": "已收藏——会推荐更多类似的", "Got it — less like this": "明白——会减少这类推荐", "Saved to your taste": "已保存到你的品味",
    "Re-ranked with your note": "已按你的描述重新排序", "Taste updated": "品味已更新",
    // profiles
    "Who's shopping?": "谁在逛？", "+ New profile": "+ 新建资料", "Not set up yet": "尚未设置", "Remove": "移除",
    "No profiles on this device yet. Setting one up takes a minute — it's saved here, on this device.": "这台设备上还没有资料。设置只需一分钟——只保存在这台设备上。",
    "Remove this profile": "移除这个资料", "Reset to the original taste": "恢复最初的品味", "Switch profile": "切换资料", "Remove? Tap again": "确定移除？再点一次",
    "Reset? Likes will be lost": "确定重置？收藏会丢失",
    // setup
    "Basics": "基本信息", "Vibes": "风格", "Words & photos": "文字与照片", "Pick favourites": "挑选喜欢的",
    "1. Basics": "1. 基本信息", "2. Vibes": "2. 风格", "3. Words & photos": "3. 文字与照片", "4. Pick favourites": "4. 挑选喜欢的",
    "Back": "返回", "Next": "下一步", "Save & close": "保存并关闭", "Save": "保存", "Show my feed": "查看我的推荐", "Close": "关闭",
    "Let's set you up": "我们来设置一下", "Name": "名字", "Your name": "你的名字", "Shopping for": "选购", "Both": "都看",
    "Kinds of brands": "品牌类型", "tap all you shop": "选择所有你会逛的", "High street": "大众品牌", "Independent & boutique": "独立与精品品牌",
    "Premium & designer": "高端与设计师品牌", "Luxury": "奢侈品牌", "Your sizes": "你的尺码", "tap all that fit": "选择所有合身的",
    "Waist": "腰围", "for trousers — optional": "用于裤装——可选", "Shoe size (UK)": "鞋码（英码）", "optional": "可选", "Price range per item": "单件价格范围",
    "Which vibes feel like you?": "哪些风格像你？", "Tap once for": "点一次为", "♥ love": "♥ 喜欢", ", again for": "，再点为", "✕ not me": "✕ 不适合我",
    ", again to clear. Tap": "，再点一次取消。点", "on anything you'd like to be": "标记你想在「探索」里被", "surprised": "惊喜", "by in Explore.": "的风格。",
    "Describe it in your own words": "用你自己的话描述", "Optional — skip if the vibes say it all.": "可选——如果风格已经说明一切，可以跳过。",
    "Feelings work best — a place, a season, a person, a mood. e.g.": "描述感觉效果最好——一个地方、一个季节、一个人、一种心情。例如",
    "“Sunday in Copenhagen in October”": "“十月哥本哈根的周日”", "“what a well-dressed architect wears”": "“一位很会穿的建筑师会穿什么”",
    "Describe a feeling or a look…": "描述一种感觉或造型…", "+ Love": "+ 喜欢", "+ Avoid": "+ 避开", "Outfit photos": "穿搭照片",
    "screenshots, saved posts, your own outfits": "截图、收藏的帖子、你自己的穿搭", "＋ Add photos you love": "＋ 添加你喜欢的照片",
    "Saved nudges": "已保存的微调", "Pick your favourites": "挑选你喜欢的",
    "Picked for you from what you've told us so far. Tap the ones you'd wear — every tap swaps the rest for closer matches.": "根据你目前告诉我们的为你挑选。点你会穿的——每点一次，其余的都会换成更接近的单品。",
    "Show different ones": "换一批", "Top match": "最相符",
    "No pieces fit these sizes and prices — go back and widen them.": "没有符合这些尺码和价格的单品——返回放宽一些。",
    "Word matching works on the live site, not in this demo.": "文字匹配在正式网站上可用，演示版不支持。",
    "Loading the style model (one-time download, ~60 MB)…": "正在载入风格模型（仅首次下载，约 60 MB）…", "Reading your words…": "正在理解你的描述…",
    "Loading the photo model (one-time download, ~90 MB)…": "正在载入图片模型（仅首次下载，约 90 MB）…",
    "Photos work on the live site.": "照片功能在正式网站上可用。", "Word matching works on the live site.": "文字匹配在正式网站上可用。",
    "Search by feeling works on the live site.": "按感觉搜索在正式网站上可用。", "Notes work on the live site.": "描述功能在正式网站上可用。",
    // vibes
    "Old money": "老钱风", "Heritage fabrics, quiet polish, nothing shouts": "传承面料，低调精致，从不张扬",
    "Ivy & prep": "常春藤学院风", "Oxford shirts, rugby stripes, varsity knits": "牛津衬衫、橄榄球条纹、校园针织",
    "Quiet luxury": "低调奢华", "Beautiful materials, no logos": "上好的面料，没有logo",
    "Scandi minimal": "北欧极简", "Clean lines, muted palette, functional": "干净的线条，低饱和配色，实用",
    "Workwear": "工装", "Chore jackets, canvas, cord, built to last": "工装夹克、帆布、灯芯绒，经久耐穿",
    "Parisian casual": "巴黎休闲", "Effortless, a bit undone, very chic": "毫不费力，略带随性，非常有型",
    "Soft tailoring": "软西装", "Unstructured blazers, pleats, relaxed suiting": "无衬西装外套、打褶裤、宽松西装",
    "European autumn": "欧洲之秋", "Wool, suede, corduroy, warm earth tones": "羊毛、麂皮、灯芯绒，温暖的大地色",
    "Japanese Americana": "日式美式复古", "Selvedge denim, vintage cuts, craft detail": "赤耳丹宁、复古剪裁、工艺细节",
    "Coastal & sailing": "海岸航海风", "Fishermen knits, linen, navy and white": "渔夫毛衣、亚麻、海军蓝与白",
    "Outdoor & technical": "户外机能", "Shells, fleeces, trail-ready but clean": "冲锋衣、抓绒，能上山也够干净利落",
    "Streetwear": "街头", "Graphics, hoodies, oversized, logos": "图案、连帽卫衣、宽松版型、logo",
    "Bold colour": "大胆用色", "Rich colour that still looks elegant": "浓郁但依然优雅的颜色",
    "Texture": "质感", "Bouclé, mohair, cable knit, suede": "圈圈呢、马海毛、绞花针织、麂皮",
    "Vintage character": "复古韵味", "Patterns and pieces with a past": "有故事的图案和单品",
    "Evening & smart": "晚间与正式", "Dinner, events, sharper pieces": "晚餐、活动、更利落的单品",
    "Romantic & feminine": "浪漫女人味", "Florals, ruffles, soft and pretty": "碎花、荷叶边，温柔美好",
    "Minimal chic": "极简优雅", "Clean shapes, neutral, polished": "干净的廓形，中性色，精致",
    "French girl": "法式少女", "Tea dresses, knits, red lip energy": "茶歇裙、针织、红唇气场",
    "Power tailoring": "气场西装", "Sharp blazers, wide trousers": "利落西装外套、阔腿裤",
    "Boho": "波西米亚", "Flowing, earthy, a bit free": "飘逸、自然、自由一点",
    "Going out": "出门聚会", "Party tops, slip dresses, shine": "派对上衣、吊带裙、光泽感",
    "Cosy knits": "舒适针织", "Chunky cardigans, soft layers": "粗针开衫，柔软叠穿",
    "Print lover": "印花控", "Bold prints and pattern clashing": "大胆印花与撞色图案",
    "Athleisure": "运动休闲", "Clean sportswear you wear all day": "能穿一整天的简洁运动服",
    "Runner": "跑者", "Running shoes and performance kit": "跑鞋与专业装备",
    // styles (v2)
    "Most chosen in menswear": "男装最常选", "Most chosen in womenswear": "女装最常选", "Most chosen": "最常选",
    "Classic & smart": "经典与正式", "Minimal & modern": "极简与现代", "Relaxed & heritage": "休闲与传承", "Street & sport": "街头与运动", "Expressive": "个性表达", "Occasion": "场合",
    "City smart": "都市通勤", "Office to dinner: sharp, modern, not stiff": "从办公室到晚餐：利落、现代、不刻板",
    "Classic tailoring": "经典正装", "Proper suits, shirts and ties, done well": "讲究的西装、衬衫与领带",
    "British country": "英伦乡村", "Tweed, waxed jackets, Fair Isle, brogues": "粗花呢、油蜡夹克、费尔岛针织、布洛克鞋",
    "Clean & polished": "干净利落", "Sleek basics, slicked-back, gold hoops": "顺滑的基础款、利落发型、金色耳环",
    "Everyday basics": "日常基础款", "Great tees, jeans, sweatshirts, done right": "好T恤、牛仔裤、卫衣，样样到位",
    "All black & avant-garde": "全黑与先锋", "Dark, draped, sculptural, a bit dramatic": "暗色、垂坠、雕塑感，带点戏剧性",
    "Rugged & western": "粗犷西部", "Suede, denim, boots, worn-in leather": "麂皮、丹宁、靴子、做旧皮革",
    "Tea dresses, knits, red-lip energy": "茶歇裙、针织、红唇气场",
    "Mediterranean summer": "地中海之夏", "Linen, knitted polos, loafers, holiday ease": "亚麻、针织Polo、乐福鞋，度假般松弛",
    "Dark academia": "暗黑学院风", "Tweed, turtlenecks, library colours": "粗花呢、高领、图书馆色调",
    "Skate & 90s": "滑板与九十年代", "Baggy denim, flannels, beat-up sneakers": "宽松牛仔、法兰绒、旧球鞋",
    "Techwear": "机能风", "Black shells, cargo straps, city-ninja": "黑色硬壳、工装绑带、都市忍者",
    "Outdoor & gorpcore": "户外山系", "Retro sport": "复古运动", "Track tops, football shirts, classic trainers": "运动外套、球衣、经典运动鞋",
    "Seventies": "七十年代", "Flares, suede, big collars, warm browns": "喇叭裤、麂皮、大翻领、暖棕色",
    "Rock & grunge": "摇滚与颓废风", "Leather jackets, black denim, boots": "皮夹克、黑色牛仔、靴子",
    "Copenhagen colour": "哥本哈根色彩", "Playful colour, big collars, happy dressing": "俏皮用色、大翻领、多巴胺穿搭",
    "Balletcore & coquette": "芭蕾风与甜美风", "Bows, wrap tops, ballet flats, soft pink": "蝴蝶结、裹身上衣、芭蕾平底鞋、柔粉色",
    "Y2K": "千禧辣妹风", "Low-rise, baby tees, shiny and fun": "低腰、短款紧身T恤，闪亮又好玩",
    "Holiday & resort": "度假风", "Swim cover-ups, breezy sets, sandals": "泳装罩衫、清爽套装、凉鞋",
    // facet chips
    "Trousers": "长裤", "Jeans": "牛仔裤", "Scarves": "围巾", "Hats": "帽子", "Gloves": "手套", "Belts": "腰带", "Cardigans": "开衫", "Knitwear": "针织",
    "Coats": "大衣", "Jackets": "夹克", "Blazers": "西装外套", "Suits": "西装", "T-shirts": "T恤", "Polos": "Polo衫", "Shirts": "衬衫", "Sweats": "卫衣",
    "Dresses": "连衣裙", "Skirts": "半身裙", "Tops": "上衣", "Boots": "靴子", "Loafers": "乐福鞋", "Formal": "正装", "Smart": "精致正式", "Smart casual": "商务休闲", "Casual": "休闲", "Sporty": "运动", "Winter": "冬季", "Summer": "夏季", "Oversized": "宽松", "Wide leg": "阔腿", "Slim fit": "修身", "Relaxed fit": "宽松版型", "Backpacks": "双肩包", "Trainers": "运动鞋", "Shoes": "鞋履", "Bags": "包袋",
    "Shorts": "短裤", "Activewear": "运动服", "Black": "黑色", "White": "白色", "Cream": "米白", "Grey": "灰色", "Navy": "藏青", "Blue": "蓝色", "Green": "绿色",
    "Olive": "橄榄绿", "Brown": "棕色", "Beige": "米色", "Red": "红色", "Burgundy": "酒红", "Pink": "粉色", "Purple": "紫色", "Yellow": "黄色", "Orange": "橙色",
    "Wool": "羊毛", "Cashmere": "羊绒", "Merino": "美丽诺羊毛", "Cotton": "棉", "Linen": "亚麻", "Silk": "丝绸", "Leather": "皮革", "Suede": "麂皮",
    "Denim": "丹宁", "Corduroy": "灯芯绒", "Cord": "灯芯绒", "Mohair": "马海毛", "Tweed": "粗花呢", "Velvet": "丝绒", "Fleece": "抓绒", "Satin": "缎面",
    "Remove this filter": "去掉这个筛选", "Add back": "加回来",
    "We search fashion brands, so costumes and fancy dress are rare here — these are the closest pieces to build the look from.": "我们搜索的是时装品牌，戏服和变装服很少——这些是最接近、可以用来搭出这个造型的单品。",
    // attributes
    "Atelier ONE home": "Atelier ONE 首页", "How adventurous": "探索程度", "Minimum price": "最低价格", "Maximum price": "最高价格", "Pieces": "单品",
    "e.g. black wool trousers under £150 — or a feeling": "例如：£150 以内的黑色羊毛长裤——或者一种感觉",
    "Search anything — “black wool trousers for work under £150” or a feeling": "搜索任何东西——“£150 以内上班穿的黑色羊毛长裤”或一种感觉",
  };
  const PAT = [
    [/^For “(.+)”$/, (m) => `「${tr(m[1])}」`],
    [/^(\d+|Hundreds of) match(?:es)? across (\d+) brands\. Save it and we'll keep finding more, in your size\.$/, (m) => `${m[1] === "Hundreds of" ? "数百件" : m[1] + " 件"}相符单品，来自 ${m[2]} 个品牌。保存后我们会按你的尺码持续为你寻找。`],
    [/^No exact match — showing the closest without (.+)\.$/, (m) => `没有完全相符的——显示去掉「${m[1].split(" or ").map((x) => tr(cap(x))).join("、")}」后最接近的。`],
    [/^closest without (.+)$/, (m) => `去掉「${m[1].split(" or ").map((x) => tr(cap(x))).join("、")}」后最接近的`],
    [/^We don't have “(.+)” in our shops right now — here's the closest we have\.$/, (m) => `我们的店铺目前没有「${m[1]}」——这些是最接近的。`],
    [/^([\d,+]+) pieces · what you asked for first, then ranked by your taste\.$/, (m) => `${m[1]} 件 · 先显示你要找的，再按你的品味排序。`],
    [/^([\d,]+) pieces · updated (.+)$/, (m) => `${m[1]} 件单品 · 更新于 ${m[2]}`],
    [/^(\d+) vibes · (\d+) ♥ · (.+)$/, (m) => `${m[1]} 种风格 · ${m[2]} ♥ · ${m[3]}`],
    [/^Learning from (\d+) ♥ and (\d+) ✕$/, (m) => `正在从 ${m[1]} 个 ♥ 和 ${m[2]} 个 ✕ 中学习`],
    [/^On sale now \(−(\d+)%\)$/, (m) => `正在打折（−${m[1]}%）`], [/^Sale −(\d+)%$/, (m) => `折扣 −${m[1]}%`], [/^Price drop −(\d+)%$/, (m) => `降价 −${m[1]}%`],
    [/^Buy now — genuinely (\d+)% below what we've seen$/, (m) => `现在入手——比我们见过的价格真实低 ${m[1]}%`],
    [/^Wait\? Black Friday is in (\d+) days?$/, (m) => `要不要等等？距离黑五还有 ${m[1]} 天`],
    [/^(.+) rarely discounts — buy when you're ready$/, (m) => `${m[1]} 很少打折——想买就买`],
    [/^Dropped (£\d+) since you saved it$/, (m) => `收藏后已降价 ${m[1]}`],
    [/^Saved (\S+) at (£\d+)$/, (m) => `${m[1]} 以 ${m[2]} 收藏`],
    [/^Close to the (.+) you liked$/, (m) => `接近你喜欢的 ${m[1]}`],
    [/^Matches: (.+)$/, (m) => `符合：${tr(cap(m[1]))}`], [/^(.+), with a bolder twist$/, (m) => `${tr(cap(m[1]))}，更大胆一点`],
    [/^Closest in style to ([^.]+), which you love\.$/, (m) => `风格最接近你喜欢的 ${m[1]}。`],
    [/^Leans ([^.]+)\.$/, (m) => `偏${tr(cap(m[1]))}。`],
    [/^Strongest for you in ([^.]+)\.$/, (m) => `最适合你的品类：${m[1].split(" & ").map((c) => CAT[c.toLowerCase()] || tr(c)).join("、")}。`],
    [/^Usually (£\d+)–(£\d+)\.?$/, (m) => `通常 ${m[1]}–${m[2]}。`],
    [/^picked for (.+)$/, (m) => `为 ${m[1]} 挑选`], [/^Welcome, (.+) — here's your feed$/, (m) => `欢迎，${m[1]}——这是你的推荐`],
    [/^Live from (.+)$/, (m) => `实时来自 ${m[1]}`], [/^(\d+) fresh matches across (.+) brands$/, (m) => `${m[1]} 件新鲜单品，来自 ${m[2]} 个品牌`],
    [/^Updated from your (\d+) picks?\.$/, (m) => `已根据你挑选的 ${m[1]} 件更新。`],
    [/^Added “(.+)”\.$/, (m) => `已添加「${m[1]}」。`], [/^Added (\d+) photos? — your brand suggestions now use them\.$/, (m) => `已添加 ${m[1]} 张照片——品牌推荐已经用上它们。`],
    [/^Reading photo (\d+) of (\d+)…$/, (m) => `正在读取第 ${m[1]} 张照片，共 ${m[2]} 张…`],
    [/^Already in your taste ×(\d+)$/, (m) => `已在你的品味中 ×${m[1]}`], [/^(.+) — re-ranked$/, (m) => `${tr(m[1])}——已重新排序`],
    [/^and (\d+) more$/, (m) => `等另外 ${m[1]} 个`], [/^Sold here via (.+)\.$/, (m) => `经由 ${m[1]} 销售。`], [/^via (.+)$/, (m) => `经由 ${m[1]}`],
    [/^Couldn't (.+)\((.+)\)(.*)$/, (m) => `暂时出错了（${m[2]}），请稍后再试。`],
    [/^Show (\d+) more styles$/, (m) => `显示另外 ${m[1]} 种风格`],
    [/^Under £(\d+)$/, (m) => `£${m[1]} 以内`], [/^Over £(\d+)$/, (m) => `£${m[1]} 以上`],
    // generic wrappers last, so they never swallow a more specific line
    [/^(.+) ✕$/, (m) => `${tr(m[1])} ✕`], [/^(.+) \+$/, (m) => `${tr(m[1])} +`],
    [/^(.+) ×(\d+)$/, (m) => `${tr(m[1])} ×${m[2]}`], [/^(.+) ·$/, (m) => `${tr(m[1])} ·`],
    [/^♥ (.+)$/, (m) => `♥ ${tr(m[1])}`],
  ];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function tr(s) {
    if (!s) return s;
    if (ZH[s] !== undefined) return ZH[s];
    if (CAT[s] !== undefined) return CAT[s];
    for (const [re, f] of PAT) { const m = s.match(re); if (m) return f(m); }
    const parts = s.split(/(?<=\.) (?=[A-Z])/); // a few sentences in one line
    if (parts.length > 1) { const out = parts.map(tr); if (out.some((x, i) => x !== parts[i])) return out.join(""); }
    return s;
  }

  let lang = "en";
  try { lang = localStorage.getItem(KEY) || (/^zh/i.test(navigator.language || "") ? "zh" : "en"); } catch {}
  const SKIP = ".card .t, .card .b, .lcard .meta .t, .lcard .meta .b, .ph, #lNames, .no-tr, script, style, input, textarea";
  const orig = new WeakMap(); // node -> English text (so switching back restores it)
  const ATTRS = ["placeholder", "title", "aria-label"];
  let busy = false;

  function doText(n) {
    const p = n.parentElement; if (!p || p.closest(SKIP)) return;
    const cur = n.nodeValue, o = orig.get(n);
    const en = o && (cur === o.zh) ? o.en : cur; // already translated by us → start from the English
    if (lang === "en") { if (o && cur === o.zh) n.nodeValue = o.en; return; }
    const t = en.trim(); if (!t || !/[A-Za-z]/.test(t)) return;
    const z = tr(t); if (z === t) return;
    const out = en.replace(t, z); orig.set(n, { en, zh: out }); if (cur !== out) n.nodeValue = out;
  }
  function doAttrs(el) {
    if (el.closest && el.closest(".card .t, .lcard .meta")) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a); if (!v) continue;
      const k = `data-en-${a}`, en = el.getAttribute(k) ?? v;
      if (lang === "en") { if (el.hasAttribute(k)) { el.setAttribute(a, en); el.removeAttribute(k); } continue; }
      const z = tr(en); if (z !== en) { el.setAttribute(k, en); if (v !== z) el.setAttribute(a, z); }
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches(SKIP)) return;
    doAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n; while ((n = w.nextNode())) n.nodeType === 3 ? doText(n) : doAttrs(n);
  }
  function apply() {
    busy = true;
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = lang === "zh" ? "Atelier ONE — 只为你一人的私人造型师" : "Atelier ONE — a private stylist for one";
    walk(document.body);
    document.querySelectorAll("[data-lang-btn]").forEach((b) => { b.textContent = lang === "zh" ? "EN" : "中文"; b.title = lang === "zh" ? "Switch to English" : "切换到中文"; });
    busy = false;
  }
  new MutationObserver((muts) => {
    if (busy || lang === "en") return;
    busy = true;
    for (const m of muts) {
      if (m.type === "characterData") doText(m.target);
      else if (m.type === "attributes") doAttrs(m.target);
      else m.addedNodes.forEach(walk);
    }
    busy = false;
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  window.I18N = {
    get lang() { return lang; },
    t: (s) => (lang === "zh" ? tr(s) : s),
    set(l) { lang = l; try { localStorage.setItem(KEY, l); } catch {} apply(); document.dispatchEvent(new CustomEvent("langchange")); },
    toggle() { this.set(lang === "zh" ? "en" : "zh"); },
  };
  document.addEventListener("click", (e) => { if (e.target.closest("[data-lang-btn]")) { e.preventDefault(); window.I18N.toggle(); } });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
})();
