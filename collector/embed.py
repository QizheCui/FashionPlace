"""Turn product photos and taste descriptions into vectors on one shared "style map".

Uses CLIP (images and words live in the same space), so a phrase like
"european autumn menswear, wool and corduroy" can be matched directly to product photos.

Usage:  python -m collector.embed            # real CLIP model (needs sentence-transformers)
        python -m collector.embed --fake     # offline: hashed bag-of-words vectors, for tests/dev
Writes: data/vectors.bin + vectors_meta.json + projection.bin, data/vibes.json, data/refiners.json, data/profiles/<id>.json
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from collector import shopify

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG = ROOT / "config"
CACHE = ROOT / ".cache" / "image_vectors.npz"
import os

# Two photo models can be built side by side: the general one ("clip", in data/) and the fashion-trained
# one ("fsl", in data/fsl/). The site reads whichever it is told to.
VARIANT = os.environ.get("EMBED_MODEL", "clip")
OUT = DATA / "fsl" if VARIANT == "fsl" else DATA
DIM = 768 if VARIANT == "fsl" else 512
MODEL_NAME = "marqo-fashionSigLIP" if VARIANT == "fsl" else "clip-ViT-B-32"
PROJ_DIM = 192
MAX_NEW_PER_RUN = int(os.environ.get("MAX_NEW_EMBED", "6000" if VARIANT == "fsl" else "45000"))
CORE_PER_BRAND = 80


# ---------- encoders ----------
class FakeEncoder:
    """Deterministic, dependency-free stand-in: words -> hashed vector. Good enough to test ranking."""

    def _vec(self, text: str) -> np.ndarray:
        v = np.zeros(DIM, dtype=np.float32)
        for w in re.findall(r"[a-z]+", text.lower()):
            h = int(hashlib.md5(w.encode()).hexdigest(), 16)
            v[h % DIM] += 1.0
            v[(h >> 16) % DIM] += 0.5
        n = np.linalg.norm(v)
        return v / n if n else v

    def text(self, texts: list[str]) -> np.ndarray:
        return np.stack([self._vec(t) for t in texts])

    def items(self, items: list[dict]) -> np.ndarray:
        return self.text([f"{it['title']} {it['category']}" for it in items])


class ClipEncoder:
    def __init__(self) -> None:
        from sentence_transformers import SentenceTransformer  # heavy import, only when used

        self.model = SentenceTransformer(MODEL_NAME)

    def text(self, texts: list[str]) -> np.ndarray:
        return self.model.encode(texts, normalize_embeddings=True, convert_to_numpy=True)

    def _download(self, url: str):
        from PIL import Image

        try:
            url = url.replace("width=600", "width=320")  # CLIP looks at 224px; a smaller download is much faster
            req = urllib.request.Request(url, headers={"User-Agent": "FashionPlaceBot/0.1"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return Image.open(io.BytesIO(r.read())).convert("RGB")
        except Exception:
            return None

    def items(self, items: list[dict]) -> np.ndarray:
        cache = dict(np.load(CACHE, allow_pickle=True)["d"].item()) if CACHE.exists() else {}
        todo = [it for it in items if it["image"] and it["image"] not in cache]
        backlog = max(0, len(todo) - MAX_NEW_PER_RUN)
        todo = todo[:MAX_NEW_PER_RUN]  # a huge first catch-up is spread over a few nightly runs
        print(f"embedding {len(todo)} new images ({len(items) - len(todo) - backlog} cached, {backlog} left for later runs)")
        for start in range(0, len(todo), 64):
            chunk = todo[start : start + 64]
            with ThreadPoolExecutor(16) as ex:
                imgs = list(ex.map(lambda it: self._download(it["image"]), chunk))
            ok = [(it, im) for it, im in zip(chunk, imgs) if im is not None]
            if ok:
                vecs = self.model.encode([im for _, im in ok], normalize_embeddings=True, convert_to_numpy=True)
                for (it, _), v in zip(ok, vecs):
                    cache[it["image"]] = v.astype(np.float16)
        CACHE.parent.mkdir(exist_ok=True)
        np.savez_compressed(CACHE, d=np.array(cache, dtype=object))
        # A piece whose photo couldn't be read gets NO vector (it's left out of matching). Embedding its
        # title as text instead made it sit close to every typed search and float to the top of all of them.
        out = np.zeros((len(items), DIM), dtype=np.float32)
        for i, it in enumerate(items):
            if it["image"] in cache:
                out[i] = cache[it["image"]]
        return out


class FslEncoder:
    """Marqo-FashionSigLIP: the same kind of model, trained on fashion product photos and their descriptions."""

    def __init__(self) -> None:
        import open_clip
        import torch

        from collector import embed_fsl

        self.torch, self.fsl = torch, embed_fsl
        torch.set_num_threads(4)
        self.model, _, self.pre = open_clip.create_model_and_transforms(embed_fsl.MODEL)
        self.tok = open_clip.get_tokenizer(embed_fsl.MODEL)
        self.model.eval()

    def text(self, texts: list[str]) -> np.ndarray:
        out = []
        with self.torch.inference_mode():
            for i in range(0, len(texts), 32):
                out.append(self.model.encode_text(self.tok(texts[i : i + 32]), normalize=True).numpy())
        return np.concatenate(out).astype(np.float32)

    def items(self, items: list[dict]) -> np.ndarray:
        keys, vecs = self.fsl.load_cache()
        pos = {k: i for i, k in enumerate(keys)}
        todo = [it["image"] for it in items if it["image"] and it["image"] not in pos]
        todo = list(dict.fromkeys(todo))
        backlog = max(0, len(todo) - MAX_NEW_PER_RUN)
        todo = todo[:MAX_NEW_PER_RUN]
        print(f"fashion model: reading {len(todo)} new photos ({len(pos)} cached, {backlog} left for later runs)")
        new_k, new_v = [], []
        for start in range(0, len(todo), 32):
            chunk = todo[start : start + 32]
            with ThreadPoolExecutor(16) as ex:
                imgs = list(ex.map(self.fsl.download, chunk))
            ok = [(u, im) for u, im in zip(chunk, imgs) if im is not None]
            if ok:
                with self.torch.inference_mode():
                    v = self.model.encode_image(self.torch.stack([self.pre(im) for _, im in ok]), normalize=True).numpy()
                new_k += [u for u, _ in ok]
                new_v.append(v.astype(np.float16))
        if new_k:
            keys, vecs = keys + new_k, np.concatenate([vecs, *new_v])
            pos = {k: i for i, k in enumerate(keys)}
            self.fsl.save_cache(keys, vecs)
        out = np.zeros((len(items), DIM), dtype=np.float32)
        for i, it in enumerate(items):
            j = pos.get(it["image"])
            if j is not None:
                out[i] = vecs[j]
        return out


# ---------- helpers ----------
def unit(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n else v


def pack(mat: np.ndarray) -> tuple[str, float]:
    """int8-quantise a matrix of unit vectors -> base64 (keeps the web download small)."""
    scale = float(np.abs(mat).max()) or 1.0
    q = np.clip(np.round(mat / scale * 127), -127, 127).astype(np.int8)
    return base64.b64encode(q.tobytes()).decode(), scale


def build_profile(enc, profile: dict) -> dict:
    taste = enc.text(profile["taste_prompts"])
    avoid = enc.text(profile.get("avoid_prompts") or ["x"])
    surprise = enc.text(profile.get("surprise_prompts") or ["x"])
    vec = lambda m: [round(float(x), 5) for x in unit(m.mean(0))]
    return {
        **{k: profile.get(k) for k in ("id", "name", "department", "sizes", "budget", "vibes", "surprise_vibes", "brands", "tiers")},
        "taste": vec(taste),
        "avoid": vec(avoid),
        "surprise": vec(surprise),
        # individual prompt vectors so the app can explain *which* part of your taste matched
        "facets": [
            {"label": p, "vec": [round(float(x), 5) for x in v]} for p, v in zip(profile["taste_prompts"], taste)
        ],
    }


CATEGORY_PROMPTS = {
    "tshirts": "a photo of a t-shirt or polo shirt", "shirts": "a photo of a button-up shirt",
    "knitwear": "a photo of a knitted jumper or cardigan", "sweats": "a photo of a sweatshirt, hoodie or joggers",
    "outerwear": "a photo of a jacket or coat", "tailoring": "a photo of a tailored blazer or suit",
    "trousers": "a photo of trousers", "denim": "a photo of jeans", "shorts": "a photo of shorts",
    "shoes": "a photo of shoes, boots or trainers", "bags": "a photo of a bag",
    "accessories": "a photo of a hat, scarf, belt, socks or jewellery", "dresses": "a photo of a dress",
    "skirts": "a photo of a skirt", "tops": "a photo of a women's top or blouse",
    "underwear": "a photo of underwear, swimwear or pyjamas",
}


def fix_categories(enc, items: list[dict], mat: np.ndarray) -> None:
    """Shop titles are often unhelpful ('Calcata', 'Braida'); ask CLIP what the photo shows instead.
    Rule-based category wins; the photo fills in when the rules found nothing."""
    cats = list(CATEGORY_PROMPTS)
    t = enc.text([CATEGORY_PROMPTS[c] for c in cats])
    logits = 100.0 * mat @ t.T
    probs = np.exp(logits - logits.max(1, keepdims=True))
    probs /= probs.sum(1, keepdims=True)
    changed = 0
    for it, pr in zip(items, probs):
        best = int(pr.argmax())
        # titles are right when they name the garment ('jean', 'scarf', 'sweatpant'); when the title is
        # just a name ('Calcata') the shop's product type can be off, so a confident photo wins
        if it["category"] == "lifestyle":
            continue  # perfume, candles, books: never turn them into clothes
        title_says = shopify.detect_category({"title": it["title"], "product_type": ""})
        if title_says == "other" and cats[best] != it["category"] and pr[best] > (0.4 if it["category"] == "other" else 0.6):
            it["category"] = cats[best]
            changed += 1
    # untagged 'unisex' pieces: if the photo clearly shows a man or a woman wearing it, use that
    g = enc.text(["a photo of a man wearing menswear", "a photo of a woman wearing womenswear"])
    gl = 100.0 * mat @ g.T
    gp = np.exp(gl - gl.max(1, keepdims=True))
    gp /= gp.sum(1, keepdims=True)
    moved = 0
    for it, pr in zip(items, gp):
        if it.get("department") == "unisex" and pr.max() > 0.85:
            it["department"] = "men" if pr[0] > pr[1] else "women"
            moved += 1
    print(f"unisex pieces assigned from photos: {moved}")
    # colour: the shop's own colour option/title wins; the photo fills in the rest
    cols = list(shopify.COLOURS)
    c = enc.text([f"a photo of {x} clothing" for x in cols])
    cl = 100.0 * mat @ c.T
    cp = np.exp(cl - cl.max(1, keepdims=True))
    cp /= cp.sum(1, keepdims=True)
    filled = 0
    for it, pr in zip(items, cp):
        if not it.get("colour") and pr.max() > 0.45:
            it["colour"] = cols[int(pr.argmax())]
            it["colour_from_photo"] = True
            filled += 1
    print(f"colours read from photos: {filled}")
    by_id = {it["id"]: (it["category"], it.get("department"), it.get("colour"), it.get("colour_from_photo")) for it in items}
    full = json.loads((DATA / "items.json").read_text())
    for it in full["items"]:
        if it["id"] in by_id:
            it["category"], it["department"], it["colour"], cfp = by_id[it["id"]]
            if cfp:
                it["colour_from_photo"] = True
    (DATA / "items.json").write_text(json.dumps(full, ensure_ascii=False))
    print(f"categories corrected from photos: {changed}")


ANCHOR_N, ANCHOR_W = 40, 0.5


def build_vibes(enc, items: list[dict], mat: np.ndarray, gen: np.ndarray) -> None:
    """Each style gets a vector per department. Words alone are a loose guide for a photo model, so each
    vector is the style's descriptions blended with the pieces in that department that match them best
    (a spread of brands and garment types). The style then points at real clothes, not just at a sentence."""
    cfg = json.loads((CONFIG / "vibes.json").read_text())
    bias = (mat @ gen.T).mean(1)
    rows = {d: np.array([i for i, it in enumerate(items) if it.get("department") in (d, "unisex")
                         and it.get("category") not in ("other", "accessories", "bags")], dtype=int) for d in ("men", "women")}
    out, report = [], {}
    for v in cfg["vibes"]:
        pr = v["prompts"]
        pr = pr if isinstance(pr, dict) else {d: pr for d in ("men", "women") if v.get("for", "any") in ("any", d)}
        vecs = {}
        for dept, prompts in pr.items():
            t = unit(enc.text(prompts).mean(0))
            r = rows[dept]
            vec, picked = t, []
            if len(r) >= 200:
                sc = mat[r] @ t - 0.7 * bias[r]
                per_brand, per_cat = {}, {}
                for j in np.argsort(-sc)[:3000]:
                    it = items[r[j]]
                    if per_brand.get(it["brand"], 0) >= 2 or per_cat.get(it["category"], 0) >= 10:
                        continue
                    per_brand[it["brand"]] = per_brand.get(it["brand"], 0) + 1
                    per_cat[it["category"]] = per_cat.get(it["category"], 0) + 1
                    picked.append(int(r[j]))
                    if len(picked) >= ANCHOR_N:
                        break
                if len(picked) >= 15:
                    vec = unit(t + ANCHOR_W * unit(mat[picked].mean(0)))
            vecs[dept] = [round(float(x), 4) for x in vec]
            report[f"{v['id']}|{dept}"] = [f"{items[i]['category']} | {items[i]['brand']} | {items[i]['title'][:60]}" for i in picked[:10]]
        out.append({"id": v["id"], "label": v["label"], "desc": v["desc"], "group": v.get("group", ""),
                    "for": v.get("for", "any"), "top": v.get("top", {}), "vecs": vecs})
    (OUT / "vibes.json").write_text(json.dumps({"groups": cfg.get("groups", []), "vibes": out}))
    (OUT / "style_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=0))
    for k, titles in report.items():
        print(f"STYLE {k}: " + " ;; ".join(titles[:8]))


def run(fake: bool = False) -> None:
    items = [it for it in json.loads((DATA / "items.json").read_text())["items"]
             if it.get("in_stock") and it.get("category") not in ("underwear", "lifestyle")]
    OUT.mkdir(parents=True, exist_ok=True)
    enc = FakeEncoder() if fake else FslEncoder() if VARIANT == "fsl" else ClipEncoder()
    mat = enc.items(items).astype(np.float32)
    keep = np.linalg.norm(mat, axis=1) > 0
    if not keep.all():
        print(f"no photo vector for {int((~keep).sum())} pieces; leaving them out of matching")
        items = [it for it, k in zip(items, keep) if k]
        mat = mat[keep]
    mat /= np.linalg.norm(mat, axis=1, keepdims=True) + 1e-9
    if not fake and VARIANT == "clip":  # categories/colours are corrected once, by the first pass
        fix_categories(enc, items, mat)
    # Shrink 512 -> K dims for the browser download. Uncentred SVD keeps item·query dot products
    # (what ranking uses) as intact as possible; the browser projects its own text/photo vectors
    # with the same matrix, so everything stays on one map.
    k = min(PROJ_DIM, *mat.shape)
    _, _, vt = np.linalg.svd(mat, full_matrices=False)
    proj = vt[:k].T.astype(np.float32)                      # 512 x k
    low = mat @ proj
    scale = float(np.abs(low).max()) or 1.0
    q = np.clip(np.round(low / scale * 127), -127, 127).astype(np.int8)
    (OUT / "projection.bin").write_bytes(proj.tobytes())  # float32, row-major 512 x k
    # Shards, so a phone only downloads what it shows:
    #   <dept>-core : a varied slice of every brand (newest pieces + genuine deals) for the feed and the front page
    #   <dept>-<category> : every piece of one kind (all men's shoes, all women's coats…), loaded on demand
    meta_base = {"model": "fake" if fake else MODEL_NAME, "dim": DIM, "k": k, "scale": scale}
    index = {}
    for old_f in list(OUT.glob("vectors-*.bin")) + list(OUT.glob("meta-*.json")):
        old_f.unlink()
    for dept in ("men", "women"):
        rows = [i for i, it in enumerate(items) if it.get("department") in (dept, "unisex")]
        per_brand, core = {}, []
        for i in rows:  # items arrive newest-first per brand from the collector
            it = items[i]
            b = it["brand"]
            if per_brand.get(b, 0) < CORE_PER_BRAND or (it.get("deal") or {}).get("verdict") == "real_drop":
                core.append(i)
                per_brand[b] = per_brand.get(b, 0) + 1
        groups = {"core": core}
        for i in rows:
            groups.setdefault(items[i]["category"], []).append(i)
        index[dept] = {}
        for name, idx in groups.items():
            if name in ("underwear", "lifestyle", "other") or not idx:
                continue
            (OUT / f"vectors-{dept}-{name}.bin").write_bytes(q[idx].tobytes())
            (OUT / f"meta-{dept}-{name}.json").write_text(json.dumps({**meta_base, "ids": [items[i]["id"] for i in idx]}))
            index[dept][name] = len(idx)
    (OUT / "shards.json").write_text(json.dumps(index))
    for old in ("vectors.json", "vectors.bin", "vectors_meta.json"):
        (OUT / old).unlink(missing_ok=True)
    (OUT / "profiles").mkdir(exist_ok=True)
    for pf in sorted((CONFIG / "profiles").glob("*.json")):
        prof = build_profile(enc, json.loads(pf.read_text()))
        (OUT / "profiles" / pf.name).write_text(json.dumps(prof))
        print(f"profile {prof['id']} built")
    # styles offered during setup: one vector per department, anchored on real pieces from the catalogue
    generic = ["a photo of clothing", "a photo of a garment", "a product photo", "fashion", "an outfit",
               "a photo of a piece of clothing on a white background", "a model wearing clothes", "menswear",
               "womenswear", "a photo of an item for sale"]
    gen = enc.text(generic)
    build_vibes(enc, items, mat, gen)
    # Some photos (text-heavy banners, flat lays) sit close to *any* sentence. The app subtracts each
    # piece's average closeness to these bland captions, so typed searches surface real matches.
    (OUT / "generic.json").write_text(json.dumps([[round(float(x), 5) for x in v] for v in gen]))
    # "Not quite right?" nudges: a direction from 'less' towards 'more'
    refiners = json.loads((CONFIG / "refiners.json").read_text())["refiners"]
    # Each direction blends a text one ("dark clothing" minus "light clothing") with one learned from the
    # catalogue's own photos: the average of pieces whose titles say 'charcoal/navy/black' minus those
    # saying 'cream/ecru/stone'. The photo-based half lives where the products live, so it moves the feed more.
    titles = [it["title"].lower() for it in items]

    def photo_dir(more: str, less: str):
        a = [i for i, t in enumerate(titles) if re.search(more, t) and not re.search(less, t)]
        b = [i for i, t in enumerate(titles) if re.search(less, t) and not re.search(more, t)]
        if len(a) < 20 or len(b) < 20:
            return None
        return unit(unit(mat[a].mean(0)) - unit(mat[b].mean(0)))

    out = []
    for r in refiners:
        d = unit(unit(enc.text(r["more"]).mean(0)) - unit(enc.text(r["less"]).mean(0)))
        pdir = photo_dir(r["title_more"], r["title_less"]) if r.get("title_more") else None
        if pdir is not None:
            d = unit(0.4 * d + 1.0 * pdir)
        out.append({"id": r["id"], "label": r["label"], "vec": [round(float(x), 5) for x in d]})
    (OUT / "refiners.json").write_text(json.dumps(out))
    cfg = json.loads((CONFIG / "brands.json").read_text())
    report = json.loads((DATA / "collect_report.json").read_text())["brands"] if (DATA / "collect_report.json").exists() else {}
    out = []
    for b in cfg["brands"]:
        cur = (report.get(b["name"]) or {}).get("currency") or b.get("currency", "GBP")
        out.append({**{k: b.get(k) for k in ("name", "domain", "source", "blurb", "departments")},
                    "currency": cur, "fx": cfg["fx_to_gbp"].get(cur, 1.0),
                    "tier": b.get("tier", "boutique"),
                    "live": (report.get(b["name"]) or {}).get("status") == "ok"})
    (OUT / "brands.json").write_text(json.dumps(out, ensure_ascii=False))
    live = CONFIG / "live.json"
    if live.exists():
        (OUT / "live.json").write_text(live.read_text())
    index = [p.stem for p in sorted((CONFIG / "profiles").glob("*.json"))]
    (OUT / "profiles" / "index.json").write_text(json.dumps(index))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fake", action="store_true")
    run(ap.parse_args().fake)
