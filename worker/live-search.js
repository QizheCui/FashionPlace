/**
 * Atelier ONE helper — a tiny Cloudflare Worker (free plan is plenty).
 *
 *   GET  /?q=charcoal+wool+trousers&dept=men   live search: asks Shopify brands' public predictive
 *                                              search right now
 *   POST /plan  {"text": "...", "dept": "men"}  the stylist: an AI model turns any request (a feeling,
 *                                              a model name, an occasion) into a precise search plan
 *   GET  /pinterest?board=<board url>          the pins of a public Pinterest board (images only)
 *   GET  /img?u=<pinimg url>                   passes a Pinterest image through so the app can read it
 *
 * Secrets (Cloudflare → this worker → Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY   needed for /plan only
 */
const SITE = "https://qizhecui.github.io/FashionPlace";
const ALLOWED_ORIGINS = ["https://qizhecui.github.io"];
const PER_BRAND = 6;
const TIMEOUT_MS = 6000;
const MODEL = "claude-haiku-5-5";
const DAILY_PLAN_LIMIT = 400; // per worker instance; the Anthropic console spend limit is the real cap

let planCount = 0, planDay = "";

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
    try {
      if (url.pathname === "/plan" && request.method === "POST") return json(await plan(request, env));
      if (url.pathname === "/pinterest") return json(await pinterest(url.searchParams.get("board") || ""));
      if (url.pathname === "/img") return await pinImage(url.searchParams.get("u") || "", cors);
      return await liveSearch(url, ctx, cors);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },
};

// ---------- the stylist ----------
const STYLIST = `You are the search planner for Atelier ONE, a UK fashion app that searches ~300 brands
(independent labels, premium and some designer; sneaker shops carry Nike, adidas, On, New Balance).
Turn the shopper's request into a search plan. Reply with ONLY a JSON object:
{
  "understood": "one short sentence in plain English saying what you think they want",
  "department": "men" | "women" | "any",
  "kind": "exact" | "style",
  "pieces": [
    {"label": "2-4 word name shown to the shopper, e.g. 'Navy unstructured blazer'",
     "query": "a short visual description to match product photos, e.g. 'navy unstructured wool blazer'",
     "category": one of "trousers","denim","knitwear","shirts","tshirts","outerwear","tailoring","shoes","bags","accessories","dresses","skirts","tops","sweats","activewear","shorts" or null,
     "colour": a basic colour word or null,
     "material": a fabric word or null,
     "must_words": ["exact words that MUST be in the product title, only for model names like 'evo sl'"],
     "max_price_gbp": number or null}
  ]
}
Rules:
- "exact": the shopper named a specific product or model (e.g. "adidas evo sl"). Return ONE piece with
  must_words set to the model name words (not the brand) and the right category.
- "style": a feeling, occasion, aesthetic or look (e.g. "modern city finance", "Sunday in Copenhagen").
  Act like a stylist: return 4-6 complementary pieces that together make the look, specific about cut,
  colour and fabric, and set department if the words imply it.
- A plain garment request ("black wool trousers under £150") is "style" with ONE piece.
- Respect any budget, colour, fabric or department the shopper gave.`;

async function plan(request, env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the worker");
  const today = new Date().toISOString().slice(0, 10);
  if (planDay !== today) { planDay = today; planCount = 0; }
  if (++planCount > DAILY_PLAN_LIMIT) throw new Error("daily limit reached");
  const { text = "", dept = "any" } = await request.json();
  const msg = String(text).slice(0, 300);
  if (!msg.trim()) throw new Error("empty request");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 700, system: STYLIST,
      messages: [{ role: "user", content: `Shopper's profile department: ${dept}\nRequest: ${msg}` }],
    }),
  });
  if (!r.ok) throw new Error(`AI service error ${r.status}`);
  const d = await r.json();
  const textOut = (d.content || []).map((c) => c.text || "").join("");
  const m = textOut.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no plan returned");
  const p = JSON.parse(m[0]);
  p.pieces = (p.pieces || []).slice(0, 6);
  return p;
}

// ---------- Pinterest boards (public boards, via their RSS feed) ----------
async function pinterest(board) {
  const u = new URL(board.startsWith("http") ? board : `https://www.pinterest.com/${board}`);
  if (!/(^|\.)pinterest\.[a-z.]+$/.test(u.hostname)) throw new Error("not a Pinterest link");
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("use a board link like pinterest.com/name/board");
  const r = await fetch(`https://www.pinterest.com/${parts[0]}/${parts[1]}.rss`, {
    headers: { "User-Agent": "AtelierONE/0.1 (personal style import)" }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Pinterest said ${r.status} (is the board public?)`);
  const xml = await r.text();
  const imgs = [...xml.matchAll(/https:\/\/i\.pinimg\.com\/[^"'\s<>]+?\.(?:jpg|jpeg|png|webp)/g)]
    .map((m) => m[0].replace(/\/(236x|474x|564x|originals)\//, "/474x/"));
  return { board: `${parts[0]}/${parts[1]}`, images: [...new Set(imgs)].slice(0, 25) };
}
async function pinImage(u, cors) {
  const url = new URL(u);
  if (url.hostname !== "i.pinimg.com") return new Response("only Pinterest images", { status: 400, headers: cors });
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  return new Response(r.body, { status: r.status, headers: { ...cors, "Content-Type": r.headers.get("Content-Type") || "image/jpeg", "Cache-Control": "max-age=86400" } });
}

// ---------- live search across shops ----------
async function liveSearch(url, ctx, cors) {
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const dept = url.searchParams.get("dept") || "any";
  if (!q) return new Response(JSON.stringify({ ok: true, service: "Atelier ONE helper" }), { headers: cors });
  const cache = caches.default;
  const key = new Request(`${url.origin}/?q=${encodeURIComponent(q.toLowerCase())}&dept=${dept}`);
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, { headers: cors });
  const brands = (await (await fetch(`${SITE}/data/brands.json`, { cf: { cacheTtl: 3600 } })).json())
    .filter((b) => b.source === "shopify" && b.live !== false && (dept === "any" || !b.departments || b.departments.includes(dept)));
  // the free plan allows ~50 outgoing requests per call, so ask up to 45 shops, 15 at a time
  const results = [];
  for (let i = 0; i < brands.length && i < 45; i += 15) {
    results.push(...(await Promise.all(brands.slice(i, i + 15).map((b) => searchBrand(b, q)))).flat());
  }
  const body = JSON.stringify({ q, items: results, brands: Math.min(brands.length, 45), at: new Date().toISOString() });
  ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": "max-age=1800" } })));
  return new Response(body, { headers: cors });
}

async function searchBrand(brand, q) {
  const u = `https://${brand.domain}/search/suggest.json?q=${encodeURIComponent(q)}` +
    `&resources[type]=product&resources[limit]=${PER_BRAND}&resources[options][unavailable_products]=hide`;
  try {
    const r = await fetch(u, {
      headers: { "User-Agent": "AtelierONE/0.1 (personal shopping aggregator)", Accept: "application/json" },
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
