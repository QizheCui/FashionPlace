# Atelier ONE
Your taste, curated across every brand, plus the labels you haven’t met yet.

## What it does
- **For You** – one feed across all brands, ranked by your taste. ♥ or ✕ and it learns.
- **Explore** – close to your taste but one step outside it, mostly from brands you don't know yet. A *Familiar ↔ Surprise me* slider sets how far it stretches (colour, texture, vintage character).
- **Deals** – discounts on pieces that are actually you, checked against our own price history so permanent "sales" are flagged.
- **Profiles** – each person has their own taste profile (`config/profiles/*.json`).

## How it works
```
GitHub Actions (daily) ──► collector/collect.py   pull each brand's public Shopify catalogue
                                                  → data/items.json + data/price_history.json
                       ──► collector/embed.py     CLIP turns product photos + your taste words
                                                  into vectors on one shared "style map"
                       ──► web/ (GitHub Pages)    static app ranks everything in your browser
```
Likes and passes are saved in your browser, per profile.

## Editing your taste
Edit `config/profiles/<you>.json`:
- `taste_prompts` – describe what you like, in plain words or feelings
- `avoid_prompts` – what to push down
- `surprise_prompts` – what kind of "outside my comfort zone" you enjoy
- `size`, `budget`

Commit the change and the site rebuilds.

## Adding a brand
Add it to `config/brands.json`. `source: "shopify"` works for most independent brands. Big retailers (`source: "affiliate"`) need an affiliate product feed and are skipped for now. After each run, `data/collect_report.json` shows which brands worked.

## Running locally
```bash
pip install -r requirements.txt
python -m collector.collect                 # or: --fixture tests/fixtures  (offline demo data)
python -m collector.embed                   # or: --fake  (no ML model needed)
python tools/build_site.py --inline         # → _site/preview.html
python -m pytest -q tests
```

## Being a good guest
The collector only reads the public product catalogue, respects `robots.txt`, identifies itself, and waits between requests. It runs once a day.
