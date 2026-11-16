# Atelier ONE helper (Cloudflare Worker)

Live at https://atelier-one.qc420.workers.dev — deployed automatically by Cloudflare Workers Builds
from this folder whenever `main` changes.

- `GET /?q=…&dept=men` — live search across Shopify brands' public predictive search
- `POST /plan` — the AI stylist: turns any request into a precise search plan (needs the secret below)
- `GET /pinterest?board=<link>` and `GET /img?u=…` — import a public Pinterest board as taste photos

## The one secret
Cloudflare → Workers & Pages → atelier-one → Settings → Variables and Secrets → Add →
type **Secret**, name `ANTHROPIC_API_KEY`, value: a key from console.anthropic.com
(set a monthly spend limit there first).
