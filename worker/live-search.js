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
 *   AI binding          Cloudflare Workers AI, used by /plan (set in wrangler.toml, no key needed)
 *   ANTHROPIC_API_KEY   optional: if set, /plan uses Claude instead (sharper)
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
      if (url.pathname === "/plan") return await cachedPlan(request, env, ctx, cors);
      if (url.pathname === "/ev") { ctx.waitUntil(logEvent(request, env).catch(() => {})); return new Response(null, { status: 204, headers: cors }); }
      if (url.pathname === "/stats") return json(await stats(env, +url.searchParams.get("days") || 7));
      if (url.pathname === "/pinterest") return json(await pinterest(url.searchParams.get("board") || ""));
      if (url.pathname === "/img") return await pinImage(url.searchParams.get("u") || "", cors);
      return await liveSearch(url, ctx, cors);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },
};

// ---------- anonymous usage log ----------
// What people search, which searches find nothing, what they click through to, and errors in their browser.
// No IP address, no browser fingerprint, no account: just the event. Stored in Cloudflare D1 (free tier).
let tableReady = false;
async function ensureTable(env) {
  if (tableReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ev (ts INTEGER, day TEXT, t TEXT, q TEXT, n INTEGER, item TEXT, brand TEXT, x TEXT)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS ev_day ON ev (day, t)`).run();
  tableReady = true;
}
// drop anything that looks like contact details someone pasted by mistake
const clean = (v, n) => String(v ?? "").replace(/\S+@\S+/g, "[email]").replace(/\+?\d[\d\s-]{7,}\d/g, "[number]").slice(0, n);
async function logEvent(request, env) {
  if (!env.DB) return;
  const raw = await request.text();
  if (raw.length > 3000) return;
  const e = JSON.parse(raw), t = ["view", "search", "click", "error", "save"].includes(e.t) ? e.t : null;
  if (!t) return;
  await ensureTable(env);
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO ev VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(now, new Date(now).toISOString().slice(0, 10), t,
    clean(e.q, 120), Number.isFinite(+e.n) ? Math.round(+e.n) : null, clean(e.item, 120), clean(e.brand, 60),
    clean(JSON.stringify(e.x || {}), 400)).run();
}
async function stats(env, days) {
  if (!env.DB) return { error: "no database" };
  await ensureTable(env);
  const since = new Date(Date.now() - Math.min(days, 90) * 864e5).toISOString().slice(0, 10);
  const all = async (sql) => (await env.DB.prepare(sql).bind(since).all()).results;
  return {
    since,
    per_day: await all(`SELECT day, t, COUNT(*) AS n FROM ev WHERE day >= ? GROUP BY day, t ORDER BY day`),
    top_searches: await all(`SELECT lower(q) AS q, COUNT(*) AS times, ROUND(AVG(n)) AS avg_results FROM ev WHERE day >= ? AND t = 'search' GROUP BY lower(q) ORDER BY times DESC LIMIT 40`),
    no_results: await all(`SELECT lower(q) AS q, COUNT(*) AS times FROM ev WHERE day >= ? AND t = 'search' AND n = 0 GROUP BY lower(q) ORDER BY times DESC LIMIT 40`),
    clicked_brands: await all(`SELECT brand, COUNT(*) AS clicks FROM ev WHERE day >= ? AND t = 'click' GROUP BY brand ORDER BY clicks DESC LIMIT 30`),
    clicks_from: await all(`SELECT json_extract(x, '$.where') AS place, COUNT(*) AS clicks FROM ev WHERE day >= ? AND t = 'click' GROUP BY place ORDER BY clicks DESC`),
    errors: await all(`SELECT q AS message, COUNT(*) AS times, MAX(day) AS last FROM ev WHERE day >= ? AND t = 'error' GROUP BY q ORDER BY times DESC LIMIT 20`),
  };
}

// ---------- the stylist ----------
// the same request gets the same plan for a week: faster, and it saves the free AI allowance
async function cachedPlan(request, env, ctx, cors) {
  let text = "", dept = "any", lang = "en";
  if (request.method === "POST") ({ text = "", dept = "any", lang = "en" } = await request.json());
  else { const u = new URL(request.url); text = u.searchParams.get("text") || ""; dept = u.searchParams.get("dept") || "any"; lang = u.searchParams.get("lang") || "en"; }
  text = String(text).trim().replace(/\s+/g, " ").slice(0, 300);
  if (!text) throw new Error("empty request");
  const key = new Request(`https://plan.atelier-one.cache/v${PLAN_VERSION}?t=${encodeURIComponent(text.toLowerCase())}&d=${dept}&l=${lang}`);
  const hit = await caches.default.match(key);
  if (hit) { const r = new Response(hit.body, hit); for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); r.headers.set("X-Plan-Cache", "hit"); return r; }
  const p = await plan({ text, dept, lang }, env);
  const body = JSON.stringify(p);
  ctx.waitUntil(caches.default.put(key, new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=604800" } })));
  return new Response(body, { headers: cors });
}

const STYLIST = `You are the search planner for Atelier ONE, a UK fashion app that searches ~300 brands
(independent labels, premium and some designer; sneaker shops carry Nike, adidas, On, New Balance).
Turn the shopper's request into a search plan. Reply with ONLY a JSON object:
{
  "understood": "one short sentence saying what you think they want, in the reply language",
  "search_en": "the whole request rewritten as a short English shopping search, keeping any garment, colour, fabric, budget and department, e.g. 'black wool trousers for work under £150'",
  "department": "men" | "women" | "any",
  "kind": "exact" | "style",
  "mood": "one English sentence describing how the whole look appears in photos: colours, fabrics, shapes, e.g. 'warm brown and olive wool, suede and corduroy layers, relaxed tailoring'",
  "formality": "formal" | "smart" | "smart casual" | "casual" | "sport" | null  (how dressed-up the occasion is; null if it doesn't say),
  "season": "winter" | "summer" | null  (only if the request implies the weather),
  "named": {"garment": the English garment word the shopper literally asked for or null, "colour": a colour they literally said or null, "material": a fabric they literally said or null},
  "pieces": [
    {"label": "2-4 word name shown to the shopper in the reply language, e.g. 'Navy unstructured blazer'",
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
- A request that names a garment ("cashmere scarf", "blue dress", "black wool trousers under £150") is "style" with
  exactly ONE piece: that garment with every colour and fabric the shopper gave. Never add other garments to it.
  "cashmere scarf" means a scarf made of cashmere, not other cashmere things and not other scarves.
- Respect any budget, colour, fabric or department the shopper gave.
- "named" holds ONLY what the shopper literally wrote. A mood, place, season or occasion ("European autumn",
  "old money", "for a wedding") names no garment, colour or material: use null. Never put your own ideas in "named".
- The shopper may write in Chinese or English. "query", "search_en", "category", "colour", "material" and "must_words"
  are ALWAYS English. Write "understood" and "label" in the reply language you are told.`;

const CF_MODELS = ["@cf/qwen/qwen3-30b-a3b-fp8", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
const PLAN_VERSION = "6"; // bump to drop cached plans

async function plan({ text, dept, lang }, env) {
  const today = new Date().toISOString().slice(0, 10);
  if (planDay !== today) { planDay = today; planCount = 0; }
  if (++planCount > DAILY_PLAN_LIMIT) throw new Error("daily limit reached");
  const msg = text;
  const replyLang = lang === "zh" ? "Simplified Chinese (简体中文)" : "English";
  const user = `Reply language: ${replyLang}\nShopper's profile department: ${dept}\nRequest: ${msg}`;
  let out = "", engine = "", lastErr = null;
  if (env.ANTHROPIC_API_KEY) {
    // Claude (sharper) when a key has been added
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system: STYLIST, messages: [{ role: "user", content: user }] }),
    });
    if (r.ok) { const d = await r.json(); out = (d.content || []).map((c) => c.text || "").join(""); engine = "claude"; }
  }
  const parse = (txt) => {
    const m = String(txt || "").replace(/<think>[\s\S]*?<\/think>/g, "").match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { const p = JSON.parse(m[0]); return Array.isArray(p.pieces) && p.pieces.length ? p : null; } catch { return null; }
  };
  let p = parse(out);
  if (!p && env.AI) {
    // Cloudflare Workers AI: built in, no key needed, free daily allowance. The lighter model goes first
    // (about six times cheaper per request); the larger one only if its answer can't be used.
    for (const model of CF_MODELS) {
      try {
        const r = await env.AI.run(model, {
          messages: [{ role: "system", content: STYLIST }, { role: "user", content: user + (model.includes("qwen") ? " /no_think" : "") }],
          max_tokens: 900, temperature: 0.2,
        });
        const txt = typeof r.response === "string" ? r.response : r.response ? JSON.stringify(r.response)
          : (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || "";
        p = parse(txt);
        if (p) { engine = model.split("/").pop(); break; }
      } catch (e) { lastErr = e; }
    }
  }
  if (!p) throw new Error(lastErr ? `stylist unavailable: ${String(lastErr.message || lastErr).slice(0, 120)}` : "no plan returned");
  p.pieces = (p.pieces || []).slice(0, 6).map((x) => ({ ...x, must_words: Array.isArray(x.must_words) ? x.must_words : [] }));
  p.engine = engine;
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
