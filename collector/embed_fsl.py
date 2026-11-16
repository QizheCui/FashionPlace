"""Backfill: read every product photo with the fashion-trained model (Marqo-FashionSigLIP).

Runs beside the nightly job without touching it. The catalogue is split into shards so several machines can
work at once; each writes only its new vectors, and a merge step folds them into one cache.

  python -m collector.embed_fsl --shard 3 --of 12 --minutes 300   # embed this shard's missing photos
  python -m collector.embed_fsl --merge parts/                    # fold shard files into the cache
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CACHE = ROOT / ".cache" / "fsl" / "merged.npz"
MODEL = "hf-hub:Marqo/marqo-fashionSigLIP"
DIM = 768


def load_cache(path: Path = CACHE) -> tuple[list[str], np.ndarray]:
    if not path.exists():
        return [], np.zeros((0, DIM), dtype=np.float16)
    z = np.load(path, allow_pickle=False)
    return [str(k) for k in z["keys"]], z["vecs"]


def save_cache(keys: list[str], vecs: np.ndarray, path: Path = CACHE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(path, keys=np.array(keys), vecs=vecs.astype(np.float16))


def wanted() -> list[str]:
    items = json.loads((DATA / "items.json").read_text())["items"]
    urls = {it["image"] for it in items if it.get("image") and it.get("in_stock") and it.get("category") not in ("underwear", "lifestyle")}
    return sorted(urls)


def shard_of(url: str, n: int) -> int:
    return int(hashlib.md5(url.encode()).hexdigest(), 16) % n


def download(url: str):
    from PIL import Image

    try:
        req = urllib.request.Request(url.replace("width=600", "width=320"), headers={"User-Agent": "FashionPlaceBot/0.1"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return Image.open(io.BytesIO(r.read())).convert("RGB")
    except Exception:
        return None


def embed(shard: int, of: int, minutes: float, out: Path) -> None:
    import open_clip
    import torch

    done = set(load_cache()[0])
    todo = [u for u in wanted() if shard_of(u, of) == shard and u not in done]
    print(f"shard {shard}/{of}: {len(todo)} photos to read ({len(done)} already in the cache overall)", flush=True)
    keys, vecs = [], []
    if todo:
        torch.set_num_threads(4)
        model, _, pre = open_clip.create_model_and_transforms(MODEL)
        model.eval()
        t0, deadline = time.time(), time.time() + minutes * 60
        for start in range(0, len(todo), 32):
            if time.time() > deadline:
                break
            chunk = todo[start : start + 32]
            with ThreadPoolExecutor(16) as ex:
                imgs = list(ex.map(download, chunk))
            ok = [(u, im) for u, im in zip(chunk, imgs) if im is not None]
            if ok:
                with torch.inference_mode():
                    v = model.encode_image(torch.stack([pre(im) for _, im in ok]), normalize=True).numpy()
                keys += [u for u, _ in ok]
                vecs.append(v.astype(np.float16))
            if (start // 32) % 20 == 0:
                rate = len(keys) / max(1e-6, time.time() - t0)
                print(f"  {len(keys)} read, {rate:.1f}/s, about {(len(todo) - start) / max(rate, 1e-6) / 60:.0f} min left", flush=True)
    out.mkdir(parents=True, exist_ok=True)
    save_cache(keys, np.concatenate(vecs) if vecs else np.zeros((0, DIM), dtype=np.float16), out / f"shard-{shard}.npz")
    print(f"shard {shard}: wrote {len(keys)} new vectors, {len(todo) - len(keys)} still to do", flush=True)


def merge(parts: Path) -> int:
    keys, vecs = load_cache()
    have = {k: i for i, k in enumerate(keys)}
    add_k, add_v = [], []
    for f in sorted(parts.rglob("shard-*.npz")):
        k2, v2 = load_cache(f)
        for k, v in zip(k2, v2):
            if k not in have:
                have[k] = -1
                add_k.append(k)
                add_v.append(v)
    if add_k:
        keys, vecs = keys + add_k, np.concatenate([vecs, np.stack(add_v)])
    save_cache(keys, vecs)
    left = sum(1 for u in wanted() if u not in have)
    print(f"cache now holds {len(keys)} photos (+{len(add_k)}); {left} of the current catalogue still to read")
    return left


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--shard", type=int, default=0)
    ap.add_argument("--of", type=int, default=1)
    ap.add_argument("--minutes", type=float, default=300)
    ap.add_argument("--out", default="parts")
    ap.add_argument("--merge")
    a = ap.parse_args()
    if a.merge:
        left = merge(Path(a.merge))
        Path("fsl_left.txt").write_text(str(left))
    else:
        embed(a.shard, a.of, a.minutes, Path(a.out))
