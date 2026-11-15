/**
 * FashionPlace live search — a tiny Cloudflare Worker (free plan is plenty).
 *
 * The web app can't ask shops directly (browsers block cross-site requests), so this worker
 * does it: one request from the app fans out to every Shopify brand's public predictive-search
 * endpoint at the same moment and returns what's in stock right now.
 *
 *   GET https://<your-worker>.workers.dev/?q=charcoal+wool+trousers&dept=men
 *
 * Deploy: see worker/README.md. The brand list is read from the live site so it stays in sync.
 */
const SITE = "https://qizhecui.github.io/FashionPlace";
const ALLOWED_ORIGIN = "https://qizhecui.github.io";
const PER_BRAND = 10;
const TIMEOUT_MS = 6000;

export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET",
      "Content-Type": "application/json",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
    const dept = url.searchParams.get("dept") || "any";
    if (!q) return new Response(JSON.stringify({ error: "missing q" }), { status: 400, headers: cors });

    // cache identical searches for 30 minutes so we're gentle with the shops
    const cache = caches.default;
    const key = new Request(`${url.origin}/?q=${encodeURIComponent(q.toLowerCase())}&dept=${dept}`);
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, { headers: cors });

    const brands = (await (await fetch(`${SITE}/data/brands.json`, { cf: { cacheTtl: 3600 } })).json())
      .filter((b) => b.source === "shopify" && b.live !== false && (dept === "any" || !b.departments || b.departments.includes(dept)));

    const results = await Promise.all(brands.map((b) => searchBrand(b, q)));
    const body = JSON.stringify({ q, items: results.flat(), brands: brands.length, at: new Date().toISOString() });
    ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": "max-age=1800" } })));
    return new Response(body, { headers: cors });
  },
};

async function searchBrand(brand, q) {
  const u = `https://${brand.domain}/search/suggest.json?q=${encodeURIComponent(q)}` +
    `&resources[type]=product&resources[limit]=${PER_BRAND}&resources[options][unavailable_products]=hide`;
  try {
    const r = await fetch(u, {
      headers: { "User-Agent": "FashionPlaceBot/0.1 (personal shopping aggregator)", Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return [];
    const d = await r.json();
    return ((d.resources && d.resources.results && d.resources.results.products) || []).map((p) => ({
      id: `${brand.domain}:${p.id}`,
      brand: brand.name,
      title: p.title,
      url: p.url && p.url.startsWith("http") ? p.url : `https://${brand.domain}${(p.url || "").split("?")[0]}`,
      image: p.image || (p.featured_image && p.featured_image.url) || "",
      price_gbp: Number(p.price) ? Math.round(Number(p.price) * (brand.fx || 1) * 100) / 100 : null,
      compare_at_gbp: Number(p.compare_at_price_max) > Number(p.price) ? Math.round(Number(p.compare_at_price_max) * (brand.fx || 1) * 100) / 100 : null,
      type: p.type || "",
      available: p.available !== false,
    }));
  } catch {
    return [];
  }
}
