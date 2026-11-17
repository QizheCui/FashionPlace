"""Tags every piece with formality, season and fit, so 'smart', 'for winter' or 'oversized' can be exact filters.

The title decides when it says something clear; the photo (zero-shot, against short descriptions) fills in
formality and season when it's confident. Fit is only taken from the title: a photo can't tell a slim cut
from a model's pose reliably.

Codes kept short because they ship to every browser:
  fm (formality): f formal · s smart · c casual · a athletic
  ss (season):    w warm weather · c cold weather · (absent = all year)
  ft (fit):       s slim · r relaxed · o oversized · w wide      (absent = unknown)
"""
from __future__ import annotations

import re

import numpy as np

FM_TITLE = [  # first match wins
    ("a", r"\b(running|run|trail|tennis|gym|training|workout|yoga|legging|sports? bra|compression|track ?(pant|suit|top|jacket)|jersey\b.*\b(fc|club|kit)|football (shirt|boot)|basketball|cycling|golf|swim)"),
    ("f", r"\b(tuxedo|dinner jacket|black tie|three piece|3 piece|two piece suit|suit jacket|suit trousers?|dress shirt|bow tie|neck ?tie|(silk|knit(ted)?|wool|linen|grenadine|repp|cotton|cashmere|printed|paisley|striped|woven) ties?\b(?! ?(shirt|top|dress|blouse|front|back|waist))|cufflink|oxford shoe|patent|evening gown|gown)"),
    ("c", r"\b(hoodie|hooded|hood\b|zip[- ]up|sweatshirt|sweatpant|jogger|t-?shirt|\btee\b|tank|graphic|cargo|fleece|shorts|sandal|slide|flip|trainer|sneaker|beanie|cap\b|bucket hat|denim|jeans?|overall|dungaree|vest top|crop top|pyjama|lounge|camp collar|rugby|workwear|chore|utility)"),
    ("s", r"\b(blazer|tailored|suit\b|waistcoat|loafer|derby|brogue|chelsea boot|pleated trousers?|wool trousers?|flannel trousers?|chino|knit(ted)? polo|merino|cashmere|overcoat|trench|topcoat|silk (shirt|blouse)|blouse|midi (dress|skirt)|pencil skirt|oxford shirt|poplin shirt|turtle ?neck|roll ?neck|cardigan)"),
]
SS_TITLE = [
    ("w", r"\b(linen|seersucker|shorts|swim|bikini|sandal|slide|espadrille|tank|vest top|camisole|sundress|crochet|raffia|short.?sleeve|s/s\b|ss\b|terry)"),
    ("c", r"\b(wool|cashmere|merino|lambswool|mohair|alpaca|tweed|flannel|fleece|puffer|down\b|padded|quilted|insulated|parka|overcoat|coat\b|shearling|sherpa|corduroy|cord\b|beanie|scarf|glove|thermal|knit|jumper|sweater|cardigan|boot|chelsea|roll ?neck|turtle ?neck|gilet)"),
]
FIT_TITLE = [
    ("o", r"\b(oversized?|over-sized|boxy|baggy|drop(ped)? shoulder)\b"),
    ("w", r"\b(wide(-| )?leg|wide fit|wide trousers?|palazzo|barrel|balloon)\b"),
    ("r", r"\b(relaxed|loose|easy fit|regular[- ]fit|straight(-| )?(leg|fit))\b"),
    ("s", r"\b(slim|skinny|fitted|tapered|tailored fit|body ?con|second skin)\b"),
]

FM_PROMPTS = {
    "f": ["a photo of formal tailoring, a suit or evening wear", "a photo of black tie formal clothing"],
    "s": ["a photo of smart elegant clothing for the office", "a photo of polished smart casual clothing"],
    "c": ["a photo of casual everyday clothing", "a photo of relaxed weekend streetwear"],
    "a": ["a photo of sportswear for running or the gym", "a photo of athletic performance clothing"],
}
SS_PROMPTS = {
    "w": ["a photo of light summer clothing for hot weather"],
    "c": ["a photo of warm winter clothing for cold weather"],
    "n": ["a photo of a light everyday garment for any season"],
}


def _title_tag(rules, text: str):
    for code, pat in rules:
        if re.search(pat, text):
            return code
    return None


def _zero_shot(enc, mat: np.ndarray, prompts: dict) -> tuple[list[str], np.ndarray]:
    codes = list(prompts)
    t = np.stack([enc.text(prompts[c]).mean(0) for c in codes])
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    logits = 100.0 * mat @ t.T
    p = np.exp(logits - logits.max(1, keepdims=True))
    return codes, p / p.sum(1, keepdims=True)


def tag_items(enc, items: list[dict], mat: np.ndarray) -> dict:
    """Adds fm / ss / ft to each item in place; returns a small report."""
    fm_codes, fm_p = _zero_shot(enc, mat, FM_PROMPTS)
    ss_codes, ss_p = _zero_shot(enc, mat, SS_PROMPTS)
    src = {"fm_title": 0, "fm_photo": 0, "ss_title": 0, "ss_photo": 0, "ft_title": 0}
    for it, fp, sp in zip(items, fm_p, ss_p):
        text = f"{it.get('title', '')} {it.get('ptype', '')}".lower()
        for k in ("fm", "ss", "ft"):
            it.pop(k, None)
        fm = _title_tag(FM_TITLE, text)
        if fm:
            src["fm_title"] += 1
        else:
            cat = it.get("category")
            fm = "a" if cat == "activewear" else "s" if cat == "tailoring" else fm_codes[int(fp.argmax())] if fp.max() > 0.45 else None
            if fm == "f":  # a photo alone over-reads black clothes and jewellery as formal: call it smart
                fm = "s"
            if cat in ("accessories", "bags") and fm in ("f", "s") and fp.max() < 0.7:
                fm = None
            if fm:
                src["fm_photo"] += 1
        if fm:
            it["fm"] = fm
        ss = _title_tag(SS_TITLE, text)
        if ss:
            src["ss_title"] += 1
        elif sp.max() > 0.8 and ss_codes[int(sp.argmax())] != "n":
            ss = ss_codes[int(sp.argmax())]
            src["ss_photo"] += 1
        if ss:
            it["ss"] = ss
        ft = _title_tag(FIT_TITLE, text)
        if ft:
            it["ft"] = ft
            src["ft_title"] += 1
    n = len(items) or 1
    counts = {k: {c: sum(1 for it in items if it.get(k) == c) for c in "fscawro"} for k in ("fm", "ss", "ft")}
    print(f"tags: formality from title {src['fm_title']}, from photo {src['fm_photo']}, none {n - src['fm_title'] - src['fm_photo']}; "
          f"season from title {src['ss_title']}, from photo {src['ss_photo']}; fit from title {src['ft_title']}")
    print("tag counts:", {k: {c: v for c, v in d.items() if v} for k, d in counts.items()})
    for k, code in [("fm", "f"), ("fm", "s"), ("fm", "c"), ("fm", "a"), ("ss", "w"), ("ss", "c"), ("ft", "o"), ("ft", "w")]:
        ex = [it["title"][:50] for it in items if it.get(k) == code][::max(1, counts[k][code] // 8 or 1)][:8]
        print(f"TAG {k}={code}: " + " ;; ".join(ex))
    return {"source": src, "counts": counts}
