"""Turn product photos and taste descriptions into vectors on one shared "style map".

Uses CLIP (images and words live in the same space), so a phrase like
"european autumn menswear, wool and corduroy" can be matched directly to product photos.

Usage:  python -m collector.embed            # real CLIP model (needs sentence-transformers)
        python -m collector.embed --fake     # offline: hashed bag-of-words vectors, for tests/dev
Writes: data/vectors.json, data/profiles/<id>.json
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

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG = ROOT / "config"
CACHE = ROOT / ".cache" / "image_vectors.npz"
DIM = 512
MODEL_NAME = "clip-ViT-B-32"


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
            req = urllib.request.Request(url, headers={"User-Agent": "FashionPlaceBot/0.1"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return Image.open(io.BytesIO(r.read())).convert("RGB")
        except Exception:
            return None

    def items(self, items: list[dict]) -> np.ndarray:
        cache = dict(np.load(CACHE, allow_pickle=True)["d"].item()) if CACHE.exists() else {}
        todo = [it for it in items if it["image"] and it["image"] not in cache]
        print(f"embedding {len(todo)} new images ({len(items) - len(todo)} cached)")
        for start in range(0, len(todo), 64):
            chunk = todo[start : start + 64]
            with ThreadPoolExecutor(8) as ex:
                imgs = list(ex.map(lambda it: self._download(it["image"]), chunk))
            ok = [(it, im) for it, im in zip(chunk, imgs) if im is not None]
            if ok:
                vecs = self.model.encode([im for _, im in ok], normalize_embeddings=True, convert_to_numpy=True)
                for (it, _), v in zip(ok, vecs):
                    cache[it["image"]] = v.astype(np.float16)
        CACHE.parent.mkdir(exist_ok=True)
        np.savez_compressed(CACHE, d=np.array(cache, dtype=object))
        # items whose image failed fall back to a text embedding of the title
        out = np.zeros((len(items), DIM), dtype=np.float32)
        missing = [i for i, it in enumerate(items) if it["image"] not in cache]
        for i, it in enumerate(items):
            if it["image"] in cache:
                out[i] = cache[it["image"]]
        if missing:
            out[missing] = self.text([f"a photo of {items[i]['title']}" for i in missing])
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
        **{k: profile.get(k) for k in ("id", "name", "department", "sizes", "budget", "vibes", "surprise_vibes", "brands")},
        "taste": vec(taste),
        "avoid": vec(avoid),
        "surprise": vec(surprise),
        # individual prompt vectors so the app can explain *which* part of your taste matched
        "facets": [
            {"label": p, "vec": [round(float(x), 5) for x in v]} for p, v in zip(profile["taste_prompts"], taste)
        ],
    }


def run(fake: bool = False) -> None:
    items = json.loads((DATA / "items.json").read_text())["items"]
    enc = FakeEncoder() if fake else ClipEncoder()
    mat = enc.items(items).astype(np.float32)
    b64, scale = pack(mat)
    (DATA / "vectors.json").write_text(
        json.dumps({"model": "fake" if fake else MODEL_NAME, "dim": DIM, "scale": scale,
                    "ids": [it["id"] for it in items], "data": b64})
    )
    (DATA / "profiles").mkdir(exist_ok=True)
    for pf in sorted((CONFIG / "profiles").glob("*.json")):
        prof = build_profile(enc, json.loads(pf.read_text()))
        (DATA / "profiles" / pf.name).write_text(json.dumps(prof))
        print(f"profile {prof['id']} built")
    # style moods offered during setup, each as a vector on the same style map
    vibes = json.loads((CONFIG / "vibes.json").read_text())["vibes"]
    (DATA / "vibes.json").write_text(json.dumps([
        {"id": v["id"], "label": v["label"], "desc": v["desc"], "vec": [round(float(x), 5) for x in unit(enc.text(v["prompts"]).mean(0))]}
        for v in vibes
    ]))
    brands = json.loads((CONFIG / "brands.json").read_text())["brands"]
    (DATA / "brands.json").write_text(json.dumps(
        [{k: b.get(k) for k in ("name", "domain", "source", "blurb")} for b in brands], ensure_ascii=False))
    index = [p.stem for p in sorted((CONFIG / "profiles").glob("*.json"))]
    (DATA / "profiles" / "index.json").write_text(json.dumps(index))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fake", action="store_true")
    run(ap.parse_args().fake)
