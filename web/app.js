/* FashionPlace web app — no build step, no framework.
 *
 * Every product photo, every style "vibe" and every taste description is a vector on one
 * shared style map (made by collector/embed.py with CLIP). A person's taste is a blend of:
 *   vibes they picked + their own words + brands they love + pieces they ♥ (minus ✕)
 * so it changes the moment they tune it or react to a product.
 * Profiles live in this browser (localStorage); built-in profiles are seeds you can edit. */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const LETTERS = ["XS", "S", "M", "L", "XL", "XXL"];
  const STORE = "fp:v2";
  const S = {
    tab: "foryou", category: "all", brand: null, surprise: 0.4, query: null,
    items: [], byId: {}, vecs: {}, vibes: [], vibeById: {}, brands: [], brandInfo: {}, brandCentroid: {},
    builtins: [], model: "", brandStats: {}, refiners: [], refinerById: {},
    steer: { nudges: {}, words: [] }, steerVec: null, profiles: {}, current: null, taste: null, avoid: null, twist: null,
  };

  // ---------- small helpers ----------
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const norm = (a) => { let n = 0; for (const x of a) n += x * x; n = Math.sqrt(n) || 1; return a.map((x) => x / n); };
  const mean = (rows) => {
    rows = rows.filter(Boolean); if (!rows.length) return null;
    const out = new Array(rows[0].length).fill(0);
    for (const r of rows) for (let i = 0; i < r.length; i++) out[i] += r[i];
    return out.map((x) => x / rows.length);
  };
  const blend = (parts) => { // [[vec, weight], ...]
    let out = null;
    for (const [v, w] of parts) { if (!v || !w) continue; out = out ? out.map((x, i) => x + w * v[i]) : v.map((x) => w * x); }
    return out ? norm(out) : null;
  };
  const quantile = (arr, q) => { if (!arr.length) return -Infinity; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]; };
  const money = (n) => `£${Math.round(n)}`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tint = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 22% 82%)`; };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const today = () => new Date().toISOString().slice(0, 10);
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200); }

  // ---------- storage ----------
  function loadStore() {
    try { const s = JSON.parse(localStorage.getItem(STORE)) || {}; S.profiles = s.profiles || {}; S.lastId = s.current; }
    catch { S.profiles = {}; }
    try { // carry over likes from the first version of the app
      const old = JSON.parse(localStorage.getItem("fp:feedback:qizhe"));
      if (old && !S.profiles.qizhe) S.pendingOldFeedback = old;
    } catch {}
  }
  function saveStore() { try { localStorage.setItem(STORE, JSON.stringify({ profiles: S.profiles, current: S.current && S.current.id })); } catch {} }
  const P = () => S.current;

  // ---------- data ----------
  async function getBin(path) {
    if (window.FP_DATA && typeof window.FP_DATA[path] === "string") {
      const bin = atob(window.FP_DATA[path]), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u.buffer;
    }
    const r = await fetch(`data/${path}`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.arrayBuffer();
  }
  async function getJSON(path) {
    if (window.FP_DATA && window.FP_DATA[path]) return window.FP_DATA[path];
    const r = await fetch(`data/${path}`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
  // Items arrive already shrunk to k dims; anything made at full size (text, photos, vibes)
  // is projected with the same matrix so it lands on the same map.
  function decodeVectors(meta, buf) {
    const q = new Int8Array(buf), k = meta.k;
    meta.ids.forEach((id, r) => { S.vecs[id] = norm(Array.from(q.subarray(r * k, (r + 1) * k), (x) => (x / 127) * meta.scale)); });
  }
  const projCache = new WeakMap();
  function pv(v) { // full-size (512) vector -> map vector (k); cached per array
    if (!v || v.length === S.k) return v;
    let out = projCache.get(v);
    if (out) return out;
    const k = S.k, P = S.proj; out = new Array(k).fill(0);
    for (let i = 0; i < v.length; i++) { const x = v[i]; if (!x) continue; const row = i * k; for (let j = 0; j < k; j++) out[j] += x * P[row + j]; }
    out = norm(out); projCache.set(v, out); return out;
  }

  // ---------- catalogue shards (men / women), loaded on demand ----------
  S.loaded = {};
  function ensureShard(dept) {
    const depts = dept === "any" ? ["men", "women"] : [dept];
    return Promise.all(depts.map((d) => (S.loaded[d] ||= (async () => {
      const [items, meta, buf] = await Promise.all([getJSON(`items-${d}.json`), getJSON(`meta-${d}.json`), getBin(`vectors-${d}.bin`)]);
      S.model = meta.model; S.updated = items.updated;
      for (const it of items.items) if (!S.byId[it.id] || S.byId[it.id].live) { S.byId[it.id] = it; S.items.push(it); }
      decodeVectors(meta, buf);
      rebuildBrands();
    })())));
  }
  function rebuildBrands() {
    const groups = {};
    for (const it of S.items) if (S.vecs[it.id] && it.category !== "underwear") (groups[it.brand] ||= []).push(S.vecs[it.id]);
    S.brandCentroid = {}; S.brandCount = {};
    for (const [b, rows] of Object.entries(groups)) { S.brandCentroid[b] = norm(mean(rows)); S.brandCount[b] = rows.length; }
    S.globalCentroid = norm(mean(Object.values(S.brandCentroid)));
    S.summaryCache = {};
    const n = Object.keys(groups).length;
    $("#foot").textContent = `${S.items.length.toLocaleString()} pieces from ${n} brands · updated ${S.updated}` + (S.model === "fake" ? " · demo data" : "");
  }

  // ---------- profiles ----------
  function profileFromBuiltin(b) {
    return {
      id: b.id, name: b.name, builtin: true, department: b.department || "men",
      sizes: b.sizes || ["M"],
      price: { min: (b.budget && b.budget.min_gbp) || 0, max: (b.budget && b.budget.hard_max_gbp) || 300 },
      vibes: b.vibes || [], avoidVibes: [], surpriseVibes: b.surprise_vibes || [],
      brands: b.brands || [], tiers: b.tiers || [],
      words: (b.facets || []).map((f) => ({ label: f.label, vec: f.vec })),
      avoidWords: b.avoid ? [{ label: "loud logos, fast fashion, shiny sportswear", vec: b.avoid }] : [],
      liked: [], disliked: [], saved: {}, setupDone: true,
    };
  }
  function newProfile(name) {
    return {
      id: `p-${uid()}`, name, department: "men", sizes: ["M"], price: { min: 0, max: 250 },
      vibes: [], avoidVibes: [], surpriseVibes: ["bold-colour", "texture", "vintage"], brands: [], tiers: [],
      words: [], avoidWords: [], liked: [], disliked: [], saved: {}, setupDone: false,
    };
  }
  function allPeople() {
    const list = Object.values(S.profiles);
    for (const b of S.builtins) if (!S.profiles[b.id]) list.unshift(profileFromBuiltin(b));
    return list;
  }
  async function useProfile(p) {
    await ensureShard(p.department);
    if (!S.profiles[p.id]) {
      S.profiles[p.id] = p;
      if (p.id === "qizhe" && S.pendingOldFeedback) { p.liked = S.pendingOldFeedback.liked || []; p.disliked = S.pendingOldFeedback.disliked || []; }
    }
    S.current = S.profiles[p.id];
    S.current.saved ||= {};
    for (const [id, x] of Object.entries(S.current.extra || {})) { S.byId[id] ||= x.item; if (x.vec && !S.vecs[id]) S.vecs[id] = pv(x.vec); }
    S.brand = null; S.category = "all"; S.query = null; S.steer = { nudges: {}, words: [] };
    recompute(); saveStore();
    $("#whoName").textContent = S.current.name;
  }

  // ---------- taste ----------
  const vibeVecs = (ids) => ids.map((id) => S.vibeById[id] && S.vibeById[id].vec).filter(Boolean);
  function tasteFrom(p, { withFeedback = true } = {}) {
    const liked = withFeedback ? mean(p.liked.map((id) => S.vecs[id])) : null;
    const disliked = withFeedback ? mean(p.disliked.map((id) => S.vecs[id])) : null;
    const t = blend([
      [mean(vibeVecs(p.vibes)), 1.0],
      [mean(p.words.map((w) => pv(w.vec))), 1.0],
      [mean(p.brands.map((b) => S.brandCentroid[b])), 0.6],
      [liked, Math.min(1.6, 0.3 * p.liked.length)],
      [disliked, -Math.min(0.8, 0.2 * p.disliked.length)],
    ]);
    return t || S.globalCentroid;
  }
  // "Not quite right?" — nudges (directions) and words, from this session + saved in the profile
  const WORD_W = 2; // a typed note counts like two nudges
  function steerVector(p) {
    const parts = [];
    const nudges = { ...(p.nudges || {}) };
    for (const [id, n] of Object.entries(S.steer.nudges)) nudges[id] = (nudges[id] || 0) + n;
    for (const [id, n] of Object.entries(nudges)) { const r = S.refinerById[id]; if (r && n) parts.push([r.vec, n]); }
    for (const w of [...(p.steerWords || []), ...S.steer.words]) parts.push([pv(w.vec), WORD_W]);
    if (!parts.length) return null;
    S.steerStrength = Math.min(4, parts.reduce((a, [, w]) => a + w, 0));
    const out = new Array(parts[0][0].length).fill(0);
    for (const [v, w] of parts) for (let i = 0; i < v.length; i++) out[i] += w * v[i];
    return out;
  }
  const steering = () => Object.keys(S.steer.nudges).length + S.steer.words.length;
  function recompute() {
    const p = P();
    S.steerVec = steerVector(p);
    S.taste = tasteFrom(p);
    S.avoid = blend([[mean(vibeVecs(p.avoidVibes)), 1], [mean(p.avoidWords.map((w) => pv(w.vec))), 1]]);
    S.twist = blend([[mean(vibeVecs(p.surpriseVibes.length ? p.surpriseVibes : ["bold-colour", "texture", "vintage"])), 1]]);
  }
  function leans(taste) {
    const sims = S.vibes.map((v) => [v.label, dot(taste, v.vec)]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const ex = sims.map(([, s]) => Math.exp(s * 30)), tot = ex.reduce((a, b) => a + b, 0);
    return sims.map(([l], i) => [l, Math.round((100 * ex[i]) / tot)]).filter(([, pc]) => pc >= 8).slice(0, 3);
  }

  // ---------- filtering & scoring ----------
  function fits(it, p, { ignoreCategory = false, ignorePrice = false } = {}) {
    if (p.department !== "any" && it.department !== "unisex" && it.department !== p.department) return false;
    if (!it.in_stock || it.category === "underwear") return false;
    if (p.tiers && p.tiers.length && !it.live) { const tier = it.tier || (S.brandInfo[it.brand] || {}).tier; if (tier && !p.tiers.includes(tier)) return false; }
    if (it.letter_sized && p.sizes.length && !(it.letter_sizes || []).some((s) => p.sizes.includes(s))) return false;
    if (p.waist && p.waist.length && it.waist_sizes && it.waist_sizes.length && !it.waist_sizes.some((w) => p.waist.includes(w))) return false;
    if (p.shoe && p.shoe.length && it.shoe_sizes && it.shoe_sizes.length && !it.shoe_sizes.some((w) => p.shoe.includes(w) || p.shoe.includes(w - 0.5))) return false;
    if (!ignorePrice && (it.price_gbp < p.price.min || (p.price.max < 1000 && it.price_gbp > p.price.max))) return false;
    if (!ignoreCategory && S.category !== "all" && it.category !== S.category) return false;
    if (S.brand && it.brand !== S.brand) return false;
    return !!S.vecs[it.id];
  }
  const score = (it) => { const v = S.vecs[it.id]; return dot(v, S.taste) - (S.avoid ? 0.35 * dot(v, S.avoid) : 0); };
  // Nudges are measured against the pieces actually on screen (z-scores), so "Darker" visibly
  // reorders trousers even though every trouser is already close to your taste.
  const zs = (arr) => { if (!arr.length) return arr; const m = arr.reduce((a, b) => a + b, 0) / arr.length; const sd = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length) || 1; return arr.map((x) => (x - m) / sd); };
  function steerPool(pool) { // every score from here on is a z-score within the pool
    if (pool.length < 3) return pool;
    const zt = zs(pool.map((x) => x.s));
    if (!S.steerVec) return pool.map((x, i) => ({ ...x, s: zt[i] }));
    const zn = zs(pool.map((x) => dot(S.vecs[x.it.id], S.steerVec))), w = 0.45 * S.steerStrength;
    return pool.map((x, i) => ({ ...x, s: zt[i] + w * zn[i] }));
  }

  function reason(it, mode) {
    const v = S.vecs[it.id], p = P();
    let best = null, bestSim = 0.85;
    for (const id of p.liked) { const lv = S.vecs[id]; if (!lv || id === it.id) continue; const s = dot(v, lv); if (s > bestSim) { bestSim = s; best = id; } }
    if (best && S.byId[best]) return `Close to the ${shortTitle(S.byId[best].title)} you liked`;
    const cands = [
      ...p.vibes.map((id) => S.vibeById[id]).filter(Boolean).map((x) => [x.label, x.vec]),
      ...p.words.map((w) => [w.thumb ? "your photos" : w.label, pv(w.vec)]),
    ].filter(([l]) => facetFits(l, it.category)).map(([l, vec]) => [l, dot(v, vec)]).sort((a, b) => b[1] - a[1]);
    const top = cands[0] ? shorten(cands[0][0]) : (leans(S.taste)[0] || ["your taste"])[0];
    if (mode === "explore" && S.twist && dot(v, S.twist) > dot(v, S.taste) * 0.92) return `${cap(top)}, with a bolder twist`;
    return `Matches: ${top}`;
  }
  // don't say a jumper "matches: pleated trousers" — a description that names a garment only explains that garment
  const FACET_CATS = [[/trouser|chino|\bpants?\b/i, ["trousers", "denim"]], [/jumper|knit|cardigan|sweater/i, ["knitwear"]],
    [/overshirt|chore jacket|jacket|coat|blazer/i, ["outerwear", "tailoring"]], [/\bshirt/i, ["shirts", "outerwear"]], [/shoe|loafer|boot/i, ["shoes"]]];
  function facetFits(label, cat) {
    const named = FACET_CATS.filter(([re]) => re.test(label));
    return !named.length || named.some(([, cats]) => cats.includes(cat));
  }
  const shortTitle = (t) => t.split(/ - | \| /)[0];
  const shorten = (s) => s.replace(/^(a|an) /i, "").split(",")[0].replace(/ menswear| men's/g, "").slice(0, 56);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function diversify(ranked, perBrandRun = 2) {
    const out = [], pool = ranked.slice(0, 600);
    while (pool.length) {
      const recent = out.slice(-6).map((x) => x.it.brand);
      let idx = pool.findIndex((x) => recent.filter((b) => b === x.it.brand).length < perBrandRun);
      if (idx < 0) idx = 0;
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  // ---------- buy now or wait? ----------
  function blackFriday(year) { // the day after the 4th Thursday of November
    const d = new Date(Date.UTC(year, 10, 1)); const firstThu = (4 - d.getUTCDay() + 7) % 7 + 1;
    return new Date(Date.UTC(year, 10, firstThu + 21 + 1));
  }
  function advice(it, p) {
    const d = it.deal || {}, now = new Date(), stats = (S.brandStats[it.brand] || {}).days || [];
    if (d.verdict === "real_drop") return { cls: "buy", text: `Buy now — genuinely ${d.discount_pct}% below what we've seen` };
    if (d.verdict === "on_sale_unverified") return { cls: "buy", text: `On sale now (−${d.discount_pct}%)` };
    const mine = it.letter_sized ? (it.letter_sizes || []).filter((x) => p.sizes.includes(x)) : [];
    if (it.letter_sized && (it.letter_sizes || []).length <= 2 && mine.length) return { cls: "buy", text: "Few sizes left — may not last" };
    const rarely = stats.length >= 30 && Math.max(...stats.map((x) => x[1])) < 0.05;
    if (rarely) return { cls: "", text: `${it.brand} rarely discounts — buy when you're ready` };
    const bf = blackFriday(now.getUTCFullYear()), days = Math.ceil((bf - now) / 864e5);
    if (days >= 1 && days <= 24) return { cls: "wait", text: `Wait? Black Friday is in ${days} day${days > 1 ? "s" : ""}` };
    if (days <= 0 && days > -4) return { cls: "wait", text: "Black Friday weekend — check the brand's site for codes" };
    const m = now.getUTCMonth(), day = now.getUTCDate();
    if (m === 11 && day <= 24) return { cls: "wait", text: "Wait? Winter sales usually start around Boxing Day" };
    if ((m === 5 && day >= 10) || m === 6) return { cls: "wait", text: "Summer sales are on or close — worth checking" };
    return null;
  }

  function savedStatus(it, p) {
    const s = p.saved[it.id];
    if (!it) return null;
    if (!it.in_stock) return { cls: "warn", text: "Sold out" };
    if (it.letter_sized && p.sizes.length && !(it.letter_sizes || []).some((x) => p.sizes.includes(x))) return { cls: "warn", text: "Not in your size right now" };
    if (s && s.price && it.price_gbp < s.price - 0.5) return { cls: "deal", text: `Dropped ${money(s.price - it.price_gbp)} since you saved it` };
    if (s && s.outOfSize) return { cls: "new", text: "Back in your size" };
    return null;
  }

  function build() {
    const p = P();
    if (S.tab === "saved") {
      return p.liked.map((id) => S.byId[id]).filter(Boolean).map((it) => {
        const st = savedStatus(it, p);
        return { it, status: st, advice: advice(it, p), why: p.saved[it.id] ? `Saved ${p.saved[it.id].date} at ${money(p.saved[it.id].price)}` : "" };
      }).sort((a, b) => (b.status && b.status.cls === "deal") - (a.status && a.status.cls === "deal"));
    }
    const base = steerPool(S.items.filter((it) => fits(it, p)).map((it) => ({ it, s: score(it) })));
    const seen = new Set([...p.liked, ...p.disliked]);

    if (S.query) { // search by feeling: the query leads, your taste breaks ties
      const qv = pv(S.query.vec);
      const zq = zs(base.map((x) => dot(S.vecs[x.it.id], qv)));
      const ranked = base.map((x, i) => ({ ...x, q: zq[i] + 0.35 * x.s }))
        .sort((a, b) => b.q - a.q).slice(0, 240);
      return diversify(ranked, 2).map((x) => ({ ...x, why: reason(x.it, "search") }));
    }
    if (S.tab === "deals") {
      const cutoff = quantile(base.map((x) => x.s), 0.35);
      return base.filter((x) => x.it.deal && x.it.deal.verdict && x.it.deal.verdict !== "always_on_sale" && x.s >= cutoff)
        .sort((a, b) => b.s - a.s).map((x) => ({ ...x, why: reason(x.it, "deals"), advice: advice(x.it, p) }));
    }
    if (S.tab === "explore") {
      const k = S.surprise, mine = new Set(p.brands);
      const floor = quantile(base.map((x) => x.s), 0.55 - 0.35 * k);
      const top = S.brand ? new Set() : new Set(base.slice().sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.it.id));
      const cand = base.filter((x) => (S.brand || x.s >= floor) && !seen.has(x.it.id) && !top.has(x.it.id));
      const zw = zs(cand.map((x) => (S.twist ? dot(S.vecs[x.it.id], S.twist) : 0)));
      const ranked = cand.map((x, i) => ({ ...x, e: (1 - k) * x.s + 1.5 * k * zw[i] + (mine.has(x.it.brand) ? 0 : 0.5) }))
        .sort((a, b) => b.e - a.e);
      const pool = ranked.length ? ranked : base.filter((x) => !seen.has(x.it.id)).sort((a, b) => b.s - a.s); // tiny catalogue fallback
      return (S.brand ? pool : diversify(pool, 1)).map((x) => ({ ...x, why: reason(x.it, "explore") }));
    }
    const ranked = base.filter((x) => !p.disliked.includes(x.it.id)).sort((a, b) => b.s - a.s);
    return (S.brand ? ranked : diversify(ranked)).map((x) => ({ ...x, why: reason(x.it, "foryou") }));
  }

  // ---------- brands to know ----------
  function brandsToKnow() {
    const p = P(), mine = new Set(p.brands);
    const prevBrand = S.brand, prevCat = S.category; S.brand = null; S.category = "all";
    const scored = steerPool(S.items.filter((it) => fits(it, p)).map((it) => ({ it, s: score(it) })));
    S.brand = prevBrand; S.category = prevCat;
    const strong = quantile(scored.map((x) => x.s), 0.85);
    const by = {};
    for (const x of scored) (by[x.it.brand] ||= []).push(x);
    return Object.entries(by).filter(([b]) => !mine.has(b)).map(([b, xs]) => {
      xs.sort((a, c) => c.s - a.s);
      const matches = xs.filter((x) => x.s >= strong);
      const top5 = xs.slice(0, 5).reduce((a, x) => a + x.s, 0) / Math.min(5, xs.length);
      const cats = {}; for (const x of matches) cats[x.it.category] = (cats[x.it.category] || 0) + 1;
      const catList = Object.entries(cats).sort((a, c) => c[1] - a[1]).slice(0, 2).map(([c]) => (c === "tshirts" ? "T-shirts" : c));
      const prices = (matches.length ? matches : xs.slice(0, 10)).map((x) => x.it.price_gbp);
      let near = null, nearSim = -1;
      for (const m of p.brands) { const c1 = S.brandCentroid[m], c2 = S.brandCentroid[b]; if (!c1 || !c2) continue; const s = dot(c1, c2); if (s > nearSim) { nearSim = s; near = m; } }
      const vibe = leans(norm(mean(xs.slice(0, 20).map((x) => S.vecs[x.it.id]))))[0];
      return { brand: b, top5, matches: matches.length, cats: catList, lo: quantile(prices, 0.2), hi: quantile(prices, 0.8), near, vibe: vibe && vibe[0], cover: xs[0].it };
    }).filter((c) => c.matches > 0).sort((a, c) => c.top5 - a.top5).slice(0, 6);
  }
  function renderBrandsRow() {
    const row = $("#brandsRow");
    if (S.tab !== "explore" || S.query) { row.hidden = true; return; }
    const cards = brandsToKnow();
    row.hidden = !cards.length;
    row.innerHTML = `<h2>Brands to know <span>picked for ${esc(P().name)}</span></h2><div class="bcards">${cards.map((c) => {
      const info = S.brandInfo[c.brand] || {};
      const why = [
        c.near ? `Closest in style to ${esc(c.near)}, which you love.` : c.vibe ? `Leans ${esc(c.vibe.toLowerCase())}.` : "",
        c.cats.length ? `Strongest for you in ${esc(c.cats.join(" & "))}.` : "",
        `Usually ${money(c.lo)}–${money(c.hi)}.`,
      ].join(" ");
      return `<button class="bcard ${S.brand === c.brand ? "on" : ""}" data-brand="${esc(c.brand)}">
        <div class="bimg" style="background:${tint(c.brand)}">${c.cover.image ? `<img src="${esc(c.cover.image)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>
        <div class="btxt"><div class="bn">${esc(c.brand)} <span>${c.matches} matches</span></div>
        <p class="bb">${esc(info.blurb || brandSummary(c.brand))}</p><p class="bw">${why}</p><span class="bgo">${S.brand === c.brand ? "Showing their pieces ✓" : "See their pieces →"}</span></div></button>`;
    }).join("")}</div>`;
  }

  // ---------- render main ----------
  const INTROS = {
    foryou: ["For You", "Every brand, one feed, ranked by your taste. ♥ or ✕ and it reshapes instantly."],
    explore: ["Explore", "Close to your taste, one step outside it — mostly from labels you haven't met yet."],
    deals: ["Deals", "Discounts on pieces that are actually you. We check price history, so fake 'sales' don't make it here."],
    saved: ["Saved", "Everything you've ♥'d — we keep an eye on price and your size."],
  };
  function badges(it, status) {
    const b = [], d = it.deal || {};
    if (status) b.push(`<span class="badge ${status.cls}">${esc(status.text)}</span>`);
    if (d.verdict === "real_drop") b.push(`<span class="badge deal">Price drop −${d.discount_pct}%</span>`);
    else if (d.verdict === "on_sale_unverified") b.push(`<span class="badge deal">Sale −${d.discount_pct}%</span>`);
    if (d.is_lowest_price && d.tracked_days >= 14 && d.verdict) b.push(`<span class="badge">Lowest we've seen</span>`);
    if (S.tab === "explore" && !P().brands.includes(it.brand)) b.push(`<span class="badge new">New brand to you</span>`);
    return b.join("");
  }
  function card({ it, why, status, advice: adv }) {
    const liked = P().liked.includes(it.id);
    return `<article class="card" data-id="${esc(it.id)}">
      <div class="photo">
        <div class="ph" style="background:${tint(it.title)}">${esc(shortTitle(it.title))}</div>
        ${it.image ? `<img src="${esc(it.image)}" alt="${esc(it.title)}" loading="lazy" onerror="this.remove()">` : ""}
        <div class="badges">${badges(it, status)}</div>
        <div class="actions ${liked ? "keep" : ""}">
          <button data-act="pass" title="Not for me">✕</button>
          <button data-act="like" class="${liked ? "liked" : ""}" title="Love it">♥</button>
        </div>
      </div>
      <div class="meta">
        <div class="b">${esc(it.brand)}${it.retailer && it.retailer !== it.brand ? ` <span class="via">via ${esc(it.retailer)}</span>` : ""}</div>
        <div class="t"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></div>
        <div class="price">${money(it.price_gbp)}${it.compare_at_gbp ? `<s>${money(it.compare_at_gbp)}</s>` : ""}</div>
        ${why ? `<div class="why">${esc(why)}</div>` : ""}
        ${adv ? `<div class="advice ${adv.cls}">${esc(adv.text)}</div>` : ""}
      </div>
    </article>`;
  }
  function renderTastebar() {
    const p = P(), l = leans(S.taste);
    $("#tastebar").hidden = S.tab === "saved";
    $("#tastebar").innerHTML = `
      <form class="search" id="searchForm"><input id="q" placeholder="Search by feeling — “Sunday in Copenhagen in October”${S.live ? " (searches every shop live too)" : ""}" value="${S.query ? esc(S.query.text) : ""}" maxlength="140">${S.query ? `<button type="button" class="ghost sm" id="qClear">Clear</button>` : ""}</form>
      <div class="tasterow"><div class="leans"><span class="lbl">Your feed leans</span>${l.map(([n, pc]) => `<span class="lean"><b>${esc(n)}</b> ${pc}%</span>`).join("")}</div>
      <div class="learn">${p.liked.length + p.disliked.length ? `Learning from ${p.liked.length} ♥ and ${p.disliked.length} ✕` : "♥ and ✕ pieces to teach it"}</div>
      <button class="ghost sm" data-open="tune">Tune my taste</button></div>
      <div class="steer ${S.steerOpen || steering() ? "open" : ""}"><button class="lbl steertoggle" id="steerToggle">Not quite right? <span>▾</span></button>
        ${S.refiners.map((r) => { const n = S.steer.nudges[r.id] || 0, saved = (p.nudges || {})[r.id] || 0;
          return `<button class="nudge ${n ? "on" : ""}" data-nudge="${r.id}" title="${saved ? `Already in your taste ×${saved}` : "Nudge the feed"}">${esc(r.label)}${n > 1 ? ` ×${n}` : ""}${saved ? " ·" : ""}</button>`; }).join("")}
        <form class="steerform" id="steerForm"><input id="steerText" placeholder="…or tell me: “darker trousers for work and a dinner date”" maxlength="140"><button class="ghost sm">Apply</button></form>
        ${S.steer.words.map((w, i) => `<span class="word">“${esc(w.label)}” <button data-unsteer="${i}" aria-label="Remove">✕</button></span>`).join("")}
        ${steering() ? `<button class="solid sm" id="steerKeep">Keep in my taste</button><button class="link" id="steerReset">Reset</button>` : ""}
      </div>
      <p class="status" id="qStatus"></p>`;
  }
  function renderChips() {
    const p = P();
    const counts = {};
    for (const i of S.items) if (fits(i, p, { ignoreCategory: true })) counts[i.category] = (counts[i.category] || 0) + 1;
    const cats = ["all", ...Object.entries(counts).filter(([c, n]) => n >= 8 && c !== "other" && c !== "underwear").sort((a, b) => b[1] - a[1]).map(([c]) => c)];
    $("#chips").innerHTML = (S.brand ? `<button class="chip on" data-clearbrand>${esc(S.brand)} ✕</button>` : "") + cats.map((c) =>
      `<button class="chip ${c === S.category ? "on" : ""}" data-cat="${c}">${c === "tshirts" ? "T-shirts" : c}</button>`).join("");
  }
  function priceLabel(pr) { return `${money(pr.min)} – ${pr.max >= 1000 ? "£1000+" : money(pr.max)}`; }
  function renderPrice() {
    const p = P(); $("#priceMin").value = p.price.min; $("#priceMax").value = p.price.max;
    $("#priceVal").textContent = priceLabel(p.price);
    $("#priceFill").style.left = `${p.price.min / 10}%`; $("#priceFill").style.right = `${100 - p.price.max / 10}%`;
  }
  function render() {
    if (!P()) return;
    const [h, sub] = S.query ? ["Search", "Matched on your words first, then nudged by your taste."] : INTROS[S.tab];
    $("#intro").innerHTML = `<h1>${h}</h1><p>${sub}</p>`;
    $("#surpriseWrap").hidden = S.tab !== "explore" || !!S.query;
    $("#controls").hidden = S.tab === "saved";
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", !S.query && b.dataset.tab === S.tab));
    $("#savedCount").textContent = P().liked.length || "";
    renderTastebar(); renderBrandsRow(); renderChips(); renderPrice(); renderLive();
    const list = build().slice(0, 120);
    $("#grid").innerHTML = list.map(card).join("");
    $("#empty").hidden = list.length > 0;
    $("#empty").textContent = S.tab === "saved" ? "Nothing saved yet — tap ♥ on anything you love." : "Nothing here — try widening the price range or sizes.";
  }

  // ---------- who's shopping ----------
  function openWelcome() {
    $("#people").innerHTML = allPeople().map((p) => `<div class="prow"><button class="person" data-person="${esc(p.id)}">
        <span class="av" style="background:${tint(p.name)}">${esc((p.name || "?")[0])}</span>
        <span><b>${esc(p.name)}</b><small>${p.setupDone ? `${p.vibes.length} vibes · ${p.liked.length} ♥ · ${priceLabel(p.price)}` : "Not set up yet"}</small></span>
      </button>${S.profiles[p.id] ? `<button class="pdel" data-delperson="${esc(p.id)}" title="${p.builtin ? "Reset to the original taste" : "Remove this profile"}">${p.builtin ? "Reset" : "Remove"}</button>` : ""}</div>`).join("");
    $("#welcome").hidden = false;
  }

  // ---------- taste editor (setup + tuning) ----------
  const TIERS = { "high-street": "High street", boutique: "Independent & boutique", premium: "Premium & designer", luxury: "Luxury" };
  const STEPS = ["Basics", "Vibes", "Words & photos", "Brands", "Tap what you'd wear"];
  const vibesFor = (dept) => S.vibes.filter((v) => !v.for || v.for === "any" || dept === "any" || v.for === dept);
  const brandFitsDept = (b, dept) => dept === "any" || !b.departments || b.departments.includes(dept);
  const ED = { step: 0, draft: null, onboarding: false, shown: new Set() };

  function openEditor(p, onboarding, step = 0) {
    ED.draft = JSON.parse(JSON.stringify(p)); ED.onboarding = onboarding; ED.step = step; ED.shown = new Set();
    $("#editor").hidden = false; renderEditor();
  }
  function renderEditor() {
    const d = ED.draft;
    $("#steps").innerHTML = STEPS.map((s, i) => `<button class="step ${i === ED.step ? "on" : ""} ${i < ED.step ? "done" : ""}" data-step="${i}" ${ED.onboarding && i > ED.step ? "disabled" : ""}>${i + 1}. ${s}</button>`).join("");
    $("#edBack").hidden = ED.step === 0;
    $("#edNext").textContent = ED.step === STEPS.length - 1 ? (ED.onboarding ? "Show my feed" : "Save") : "Next";
    $("#edSave").hidden = ED.onboarding || ED.step === STEPS.length - 1;
    const body = $("#edBody");
    if (ED.step === 0) {
      body.innerHTML = `<h2>${ED.onboarding ? "Let's set you up" : "Basics"}</h2>
        <label class="field">Name<input id="fName" value="${esc(d.name)}" maxlength="30" placeholder="Your name"></label>
        <div class="field">Shopping for<div class="seg">${[["men", "Menswear"], ["women", "Womenswear"], ["any", "Both"]].map(([v, l]) => `<button data-dept="${v}" class="${d.department === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
        <div class="field">Kinds of brands <small>tap all you shop</small><div class="seg">${Object.entries(TIERS).map(([v, l]) => `<button data-tier="${v}" class="${!d.tiers.length || d.tiers.includes(v) ? "on" : ""}">${l}</button>`).join("")}</div></div>
        <div class="field">Your sizes <small>tap all that fit</small><div class="seg">${LETTERS.map((s) => `<button data-size="${s}" class="${d.sizes.includes(s) ? "on" : ""}">${s}</button>`).join("")}</div></div>
        <div class="field">Waist <small>for trousers — optional</small><div class="seg">${[28, 29, 30, 31, 32, 33, 34, 36, 38].map((w) => `<button data-waist="${w}" class="${(d.waist || []).includes(w) ? "on" : ""}">${w}</button>`).join("")}</div></div>
        <div class="field">Shoe size (UK) <small>optional</small><div class="seg">${[6, 7, 8, 9, 10, 11, 12].map((w) => `<button data-shoe="${w}" class="${(d.shoe || []).includes(w) ? "on" : ""}">${w}</button>`).join("")}</div></div>
        <div class="field">Price range per item <b id="fPriceVal"></b>
          <div class="range2 wide"><input type="range" id="fMin" min="0" max="1000" step="10" value="${d.price.min}" aria-label="Minimum price"><input type="range" id="fMax" min="0" max="1000" step="10" value="${d.price.max}" aria-label="Maximum price"><div class="fill" id="fFill"></div></div></div>`;
      syncEdPrice();
    } else if (ED.step === 1) {
      body.innerHTML = `<h2>Which vibes feel like you?</h2>
        <p class="sub">Tap once for <b>♥ love</b>, again for <b>✕ not me</b>, again to clear. Tap <b>✦</b> on anything you'd like to be <i>surprised</i> by in Explore.</p>
        <div class="vibes">${vibesFor(d.department).map((v) => {
          const st = d.vibes.includes(v.id) ? "love" : d.avoidVibes.includes(v.id) ? "avoid" : "";
          return `<div class="vibe ${st}" data-vibe="${v.id}" role="button" tabindex="0"><b>${esc(v.label)}</b><small>${esc(v.desc)}</small>
            <span class="vstate">${st === "love" ? "♥ Love" : st === "avoid" ? "✕ Not me" : ""}</span>
            <button class="spark ${d.surpriseVibes.includes(v.id) ? "on" : ""}" data-spark="${v.id}" title="Surprise me with this">✦</button></div>`;
        }).join("")}</div>`;
    } else if (ED.step === 2) {
      const demo = S.model === "fake";
      body.innerHTML = `<h2>Describe it in your own words</h2>
        <p class="sub">Feelings work best — a place, a season, a person, a mood. e.g. <i>“Sunday in Copenhagen in October”</i>, <i>“what a well-dressed architect wears”</i>.${demo ? "<br><b>Word matching works on the live site, not in this demo.</b>" : ""}</p>
        <div class="addrow"><input id="fWord" placeholder="Describe a feeling or a look…" maxlength="140"><button class="solid" id="fAddLove">+ Love</button><button class="ghost" id="fAddAvoid">+ Avoid</button></div>
        <p class="status" id="fStatus"></p>
        <div class="words">${d.words.map((w, i) => w.thumb ? "" : `<span class="word">♥ ${esc(w.label)} <button data-delword="${i}" aria-label="Remove">✕</button></span>`).join("")}
        ${d.avoidWords.map((w, i) => `<span class="word avoid">✕ ${esc(w.label)} <button data-delavoid="${i}" aria-label="Remove">✕</button></span>`).join("")}</div>
        <h3>Outfit photos <small>screenshots, saved posts, your own outfits</small></h3>
        <label class="upload"><input type="file" id="fPhotos" accept="image/*" multiple hidden>＋ Add photos you love</label>
        <div class="thumbs">${d.words.filter((w) => w.thumb).map((w) => `<span class="thumb"><img src="${w.thumb}" alt=""><button data-delword="${d.words.indexOf(w)}" aria-label="Remove">✕</button></span>`).join("")}</div>
        ${Object.keys(d.nudges || {}).length || (d.steerWords || []).length ? `<h3>Saved nudges</h3><div class="words">
          ${Object.entries(d.nudges || {}).map(([id, n]) => `<span class="word">${esc((S.refinerById[id] || { label: id }).label)}${n > 1 ? ` ×${n}` : ""} <button data-delnudge="${id}" aria-label="Remove">✕</button></span>`).join("")}
          ${(d.steerWords || []).map((w, i) => `<span class="word">“${esc(w.label)}” <button data-delsteer="${i}" aria-label="Remove">✕</button></span>`).join("")}</div>` : ""}
        ${!d.words.length && !d.avoidWords.length ? `<p class="sub">Optional — skip if the vibes say it all.</p>` : ""}`;
    } else if (ED.step === 3) {
      body.innerHTML = `<h2>Brands for you</h2><p class="sub">Ranked by everything you've told us so far — tap ♥ on the ones you already love. The rest are ones Explore will introduce you to.</p><div class="bpick">${brandStepCards(d)}</div>`;
    } else {
      body.innerHTML = `<h2>Tap what you'd wear</h2><p class="sub">Pick anything that catches your eye — even a few helps. <button class="link" id="fMore">Show me others</button></p><div class="pickgrid" id="pickGrid"></div>`;
      fillPicks();
    }
  }
  function brandSummary(name) { // for brands without a written blurb: describe them from their own catalogue
    if ((S.summaryCache ||= {})[name] !== undefined) return S.summaryCache[name];
    return (S.summaryCache[name] = brandSummaryRaw(name));
  }
  function brandSummaryRaw(name) {
    const its = S.items.filter((i) => i.brand === name && i.in_stock);
    if (!its.length) return "";
    const cats = {}; for (const i of its) if (i.category !== "other") cats[i.category] = (cats[i.category] || 0) + 1;
    const top = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => (c === "tshirts" ? "T-shirts" : c));
    const pr = its.map((i) => i.price_gbp);
    return `Mostly ${top.join(" & ")}, usually ${money(quantile(pr, 0.2))}–${money(quantile(pr, 0.8))}.`;
  }
  function brandStepCards(d) {
    const t = tasteFrom(d, { withFeedback: false });
    const hasTaste = d.vibes.length || d.words.length;
    const sources = [...d.vibes.map((id) => S.vibeById[id]).filter(Boolean).map((v) => [v.label, v.vec]), ...d.words.map((w) => [w.thumb ? "your photos" : `“${w.label}”`, pv(w.vec)])];
    const tierOk = (b) => !d.tiers.length || d.tiers.includes(b.tier);
    const list = S.brands.filter((b) => S.brandCentroid[b.name] && brandFitsDept(b, d.department) && tierOk(b)).map((b) => {
      const c = S.brandCentroid[b.name];
      const because = sources.map(([l, v]) => [l, dot(c, v)]).sort((a, x) => x[1] - a[1])[0];
      return { b, s: hasTaste ? dot(c, t) : 0, because: because && because[0] };
    }).sort((a, x) => x.s - a.s);
    return list.map(({ b, because }, i) => `<button class="bp ${d.brands.includes(b.name) ? "on" : ""}" data-pickbrand="${esc(b.name)}">
      <b>${esc(b.name)}</b>${hasTaste && i < 6 ? `<span class="top">Top match</span>` : ""}
      <small>${esc(b.blurb || brandSummary(b.name))}</small><span class="tierlbl">${esc(TIERS[b.tier] || "")} · ${S.brandCount[b.name]} pieces</span>${hasTaste && because ? `<em>Fits ${esc(because.toLowerCase().startsWith("“") ? because : because.toLowerCase())}</em>` : ""}</button>`).join("")
      + (() => { const soon = S.brands.filter((b) => !S.brandCentroid[b.name] && b.source !== "shopify" && brandFitsDept(b, d.department) && tierOk(b));
        return soon.length ? `<p class="sub" style="grid-column:1/-1"><b>Coming with partner feeds:</b> ${soon.map((b) => esc(b.name)).join(", ")}.</p>` : ""; })();
  }
  function syncEdPrice() {
    const d = ED.draft, a = +$("#fMin").value, b = +$("#fMax").value;
    d.price.min = Math.min(a, b); d.price.max = Math.max(a, b, d.price.min + 10);
    $("#fPriceVal").textContent = priceLabel(d.price);
    $("#fFill").style.left = `${d.price.min / 10}%`; $("#fFill").style.right = `${100 - d.price.max / 10}%`;
  }
  function fillPicks() {
    const d = ED.draft, prevB = S.brand, prevC = S.category; S.brand = null; S.category = "all";
    const t = tasteFrom(d, { withFeedback: false });
    let pool = S.items.filter((it) => fits(it, d) && it.image && !ED.shown.has(it.id) && !["accessories", "bags", "shoes", "other"].includes(it.category));
    S.brand = prevB; S.category = prevC;
    const hasTaste = d.vibes.length || d.words.length || d.brands.length;
    pool = pool.map((it) => ({ it, s: hasTaste ? dot(S.vecs[it.id], t) : Math.random() })).sort((a, b) => b.s - a.s).slice(0, 300);
    // farthest-point sampling so the 16 picks are varied, not 16 navy jumpers
    const out = [], perBrand = {};
    if (pool.length) { const first = pool[Math.floor(Math.random() * Math.min(20, pool.length))]; out.push(first); perBrand[first.it.brand] = 1; }
    while (out.length < 16) {
      let best = null, bestD = -Infinity;
      for (const x of pool) {
        if (out.includes(x) || (perBrand[x.it.brand] || 0) >= 3) continue;
        let near = -1; for (const o of out) near = Math.max(near, dot(S.vecs[o.it.id], S.vecs[x.it.id]));
        const dscore = (1 - near) + 0.15 * x.s;
        if (dscore > bestD) { bestD = dscore; best = x; }
      }
      if (!best) break;
      out.push(best); perBrand[best.it.brand] = (perBrand[best.it.brand] || 0) + 1;
    }
    out.forEach((x) => ED.shown.add(x.it.id));
    $("#pickGrid").innerHTML = out.map(({ it }) => `<button class="pick ${d.liked.includes(it.id) ? "on" : ""}" data-pick="${esc(it.id)}" style="background:${tint(it.title)}">
      <img src="${esc(it.image)}" alt="${esc(it.title)}" loading="lazy" onerror="this.remove()"><span>${esc(it.brand)}</span></button>`).join("")
      || `<p class="sub">No pieces fit these sizes and prices — go back and widen them.</p>`;
  }
  function saveEditor() {
    const d = ED.draft; d.setupDone = true; d.name = d.name.trim() || "Me"; d.saved ||= {};
    for (const id of d.liked) if (!d.saved[id] && S.byId[id]) d.saved[id] = { price: S.byId[id].price_gbp, date: today() };
    const wasOnboarding = ED.onboarding;
    if (!S.current || S.current.id !== d.id) S.steer = { nudges: {}, words: [] }; // nudges belong to whoever made them
    S.profiles[d.id] = d; S.current = d;
    ensureShard(d.department).then(() => { recompute(); render(); });
    recompute(); saveStore();
    $("#whoName").textContent = d.name; $("#editor").hidden = true; $("#welcome").hidden = true;
    if (wasOnboarding) S.tab = "foryou";
    render(); window.scrollTo({ top: 0 });
    toast(wasOnboarding ? `Welcome, ${d.name} — here's your feed` : "Taste updated");
  }

  // ---------- free text → style vector (CLIP text model, loaded on first use) ----------
  let clipText = null;
  async function encodeText(text, statusEl) {
    if (S.model === "fake") throw new Error("demo mode");
    if (!clipText) {
      if (statusEl) statusEl.textContent = "Loading the style model (one-time download, ~60 MB)…";
      const T = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3");
      const id = "Xenova/clip-vit-base-patch32";
      clipText = { tok: await T.AutoTokenizer.from_pretrained(id), model: await T.CLIPTextModelWithProjection.from_pretrained(id) };
    }
    if (statusEl) statusEl.textContent = "Reading your words…";
    const inputs = clipText.tok([text], { padding: true, truncation: true });
    const { text_embeds } = await clipText.model(inputs);
    return norm(Array.from(text_embeds.data));
  }
  let clipVision = null;
  async function encodeImage(file, statusEl) {
    if (S.model === "fake") throw new Error("demo mode");
    if (!clipVision) {
      statusEl.textContent = "Loading the photo model (one-time download, ~90 MB)…";
      const T = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3");
      const id = "Xenova/clip-vit-base-patch32";
      clipVision = { T, proc: await T.AutoProcessor.from_pretrained(id), model: await T.CLIPVisionModelWithProjection.from_pretrained(id) };
    }
    const img = await clipVision.T.RawImage.fromBlob(file);
    const { image_embeds } = await clipVision.model(await clipVision.proc(img));
    return norm(Array.from(image_embeds.data));
  }
  function thumbOf(file) {
    return new Promise((res) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => { const c = document.createElement("canvas"), k = 96 / Math.max(im.width, im.height);
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.7)); };
      im.onerror = () => res("");
      im.src = url;
    });
  }
  async function addPhotos(files) {
    const st = $("#fStatus");
    let n = 0;
    for (const f of [...files].slice(0, 12)) {
      try {
        st.textContent = `Reading photo ${n + 1} of ${Math.min(files.length, 12)}…`;
        const vec = await encodeImage(f, st);
        ED.draft.words.push({ label: f.name.replace(/\.[a-z]+$/i, "").slice(0, 40) || "photo", vec: vec.map((x) => Math.round(x * 1e5) / 1e5), thumb: await thumbOf(f) });
        n++;
      } catch (e) { st.textContent = S.model === "fake" ? "Photos work on the live site." : `Couldn't read that photo (${e.message}).`; return; }
    }
    renderEditor(); $("#fStatus").textContent = `Added ${n} photo${n === 1 ? "" : "s"} — your brand suggestions now use them.`;
  }
  async function addWord(kind) {
    const inp = $("#fWord"), text = inp.value.trim(), st = $("#fStatus"); if (!text) return;
    try {
      const vec = await encodeText(text, st);
      (kind === "love" ? ED.draft.words : ED.draft.avoidWords).push({ label: text, vec: vec.map((x) => Math.round(x * 1e5) / 1e5) });
      renderEditor(); $("#fStatus").textContent = `Added “${text}”.`;
    } catch (e) {
      st.textContent = S.model === "fake" ? "Word matching works on the live site." : `Couldn't load the style model (${e.message}). Try again in a moment.`;
    }
  }
  // ---------- live search across every shop (needs the worker in worker/) ----------
  async function encodeTexts(texts) {
    const out = [];
    for (let i = 0; i < texts.length; i += 24) {
      const inputs = clipText.tok(texts.slice(i, i + 24), { padding: true, truncation: true });
      const { text_embeds } = await clipText.model(inputs);
      const [n, d] = text_embeds.dims;
      for (let r = 0; r < n; r++) out.push(norm(Array.from(text_embeds.data.slice(r * d, (r + 1) * d))));
    }
    return out;
  }
  async function liveSearch(text, qvec) {
    if (!S.live || !S.live.search_url) return;
    const p = P(), token = (S.liveToken = (S.liveToken || 0) + 1);
    S.liveResults = { text, loading: true, items: [] }; renderLive();
    try {
      const r = await fetch(`${S.live.search_url}/?q=${encodeURIComponent(text)}&dept=${p.department}`);
      const d = await r.json();
      const perBrand = {};
      let items = (d.items || []).filter((it) => it.available && it.image && it.price_gbp && !S.byId[it.id] &&
        it.price_gbp >= p.price.min && (p.price.max >= 1000 || it.price_gbp <= p.price.max) &&
        (perBrand[it.brand] = (perBrand[it.brand] || 0) + 1) <= 5);
      if (token !== S.liveToken) return;
      const vecs = await encodeTexts(items.map((it) => `a photo of ${it.title}`));
      const qv = pv(qvec);
      items = items.map((it, i) => {
        const v = pv(vecs[i]);
        return { it: { ...it, category: "other", department: p.department, in_stock: true, live: true }, v, full: vecs[i], s: 0.65 * dot(v, qv) + 0.35 * dot(v, S.taste) };
      }).sort((a, b) => b.s - a.s).slice(0, 24);
      for (const x of items) { S.byId[x.it.id] = x.it; S.vecs[x.it.id] = x.v; S.liveVec = { ...(S.liveVec || {}), [x.it.id]: x.full }; }
      if (token !== S.liveToken) return;
      S.liveResults = { text, loading: false, items: items.map((x) => ({ it: x.it, why: `Live from ${x.it.brand}` })), brands: d.brands };
    } catch (e) {
      S.liveResults = { text, loading: false, items: [], error: e.message };
    }
    renderLive();
  }
  function renderLive() {
    const el = $("#liveRow"); if (!el) return;
    const L = S.liveResults;
    if (!S.query || !L || L.text !== S.query.text) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<h2>Live from the shops <span>${L.loading ? "searching every brand right now…" : L.error ? "couldn't reach the shops just now" : `${L.items.length} fresh matches across ${L.brands || "all"} brands`}</span></h2>
      <div class="grid live">${L.items.map(card).join("")}</div>`;
  }
  async function runSearch(text) {
    const st = $("#qStatus");
    try {
      const vec = await encodeText(text, st);
      S.query = { text, vec }; S.brand = null; render(); window.scrollTo({ top: 0 });
      liveSearch(text, vec);
    } catch (e) {
      st.textContent = S.model === "fake" ? "Search by feeling works on the live site." : `Couldn't load the style model (${e.message}).`;
    }
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const t = e.target;
    const tab = t.closest("[data-tab]");
    if (tab) { S.tab = tab.dataset.tab; S.brand = null; S.query = null; render(); window.scrollTo({ top: 0 }); return; }
    if (t.closest("[data-cat]")) { S.category = t.closest("[data-cat]").dataset.cat; render(); return; }
    if (t.closest("[data-clearbrand]")) { S.brand = null; render(); return; }
    if (t.closest("#qClear")) { S.query = null; render(); return; }
    const bc = t.closest("[data-brand]");
    if (bc) { S.brand = S.brand === bc.dataset.brand ? null : bc.dataset.brand; S.category = "all"; render(); if (S.brand) $("#controls").scrollIntoView({ behavior: "smooth" }); return; }
    const act = t.closest("[data-act]");
    if (act) {
      const id = act.closest(".card").dataset.id, p = P(), it = S.byId[id];
      const wasLiked = p.liked.includes(id);
      p.liked = p.liked.filter((x) => x !== id); p.disliked = p.disliked.filter((x) => x !== id);
      if (act.dataset.act === "like" && !wasLiked) {
        p.liked.unshift(id);
        p.saved[id] = { price: it.price_gbp, date: today(), outOfSize: !!(it.letter_sized && !(it.letter_sizes || []).some((s) => p.sizes.includes(s))) };
        if (it.live) { p.extra ||= {}; p.extra[id] = { item: it, vec: (S.liveVec || {})[id] }; }
        toast("Saved — more like this");
      } else delete p.saved[id];
      if (act.dataset.act === "pass") { p.disliked.push(id); toast("Got it — less like this"); }
      recompute(); saveStore(); render(); return;
    }
    if (t.closest("#steerToggle")) { S.steerOpen = !S.steerOpen; t.closest(".steer").classList.toggle("open", S.steerOpen); return; }
    const nd = t.closest("[data-nudge]");
    if (nd) {
      const id = nd.dataset.nudge, opp = { darker: "lighter", lighter: "darker", smarter: "casual", casual: "smarter", slimmer: "wider", wider: "slimmer", plainer: "bolder", bolder: "plainer" }[id];
      if (opp && S.steer.nudges[opp]) delete S.steer.nudges[opp];
      S.steer.nudges[id] = Math.min(3, (S.steer.nudges[id] || 0) + 1);
      recompute(); render(); toast(`${nd.textContent.replace(/ ×\d| ·/g, "")} — re-ranked`); return;
    }
    const us = t.closest("[data-unsteer]"); if (us) { S.steer.words.splice(+us.dataset.unsteer, 1); recompute(); render(); return; }
    if (t.closest("#steerReset")) { S.steer = { nudges: {}, words: [] }; recompute(); render(); return; }
    if (t.closest("#steerKeep")) {
      const p = P(); p.nudges ||= {}; p.steerWords ||= [];
      for (const [id, n] of Object.entries(S.steer.nudges)) p.nudges[id] = Math.min(3, (p.nudges[id] || 0) + n);
      p.steerWords.push(...S.steer.words);
      S.steer = { nudges: {}, words: [] }; recompute(); saveStore(); render(); toast("Saved to your taste"); return;
    }
    if (t.closest("[data-open=tune]")) { openEditor(P(), false, 1); return; }
    if (t.closest("#whoBtn")) { openWelcome(); return; }
    if (t.id === "welcome" && P()) { $("#welcome").hidden = true; return; } // click outside closes it
    const person = t.closest("[data-person]");
    if (person) {
      const p = allPeople().find((x) => x.id === person.dataset.person);
      $("#welcome").hidden = true;
      if (!p.setupDone) { openEditor(p, true); return; }
      $("#intro").innerHTML = `<h1>Loading…</h1>`;
      useProfile(p).then(() => { render(); window.scrollTo({ top: 0 }); }); return;
    }
    const del = t.closest("[data-delperson]");
    if (del) {
      const id = del.dataset.delperson, p = S.profiles[id];
      if (del.dataset.confirm !== "1") { del.dataset.confirm = "1"; del.textContent = p.builtin ? "Reset? Likes will be lost" : "Remove? Tap again"; return; }
      delete S.profiles[id];
      if (S.current && S.current.id === id) S.current = null;
      saveStore(); openWelcome(); return;
    }
    if (t.closest("#newProfile")) { const np = newProfile(""); ensureShard(np.department); openEditor(np, true); return; }

    // editor
    if (t.closest("#edClose")) { $("#editor").hidden = true; if (!P()) openWelcome(); return; }
    if (t.closest("#edSave")) { saveEditor(); return; }
    if (t.closest("#edBack")) { ED.step = Math.max(0, ED.step - 1); renderEditor(); return; }
    if (t.closest("#edNext")) {
      if (ED.step === 0 && !ED.draft.name.trim()) { $("#fName").focus(); $("#fName").classList.add("err"); return; }
      if (ED.step === 0 && !ED.draft.sizes.length) ED.draft.sizes = ["M"];
      if (ED.step === STEPS.length - 1) saveEditor(); else { ED.step++; renderEditor(); }
      $("#edBody").scrollTop = 0; return;
    }
    const st = t.closest("[data-step]"); if (st && !st.disabled) { ED.step = +st.dataset.step; renderEditor(); return; }
    const dept = t.closest("[data-dept]");
    if (dept) { ED.draft.department = dept.dataset.dept; renderEditor(); ensureShard(ED.draft.department).then(() => { if (!$("#editor").hidden) renderEditor(); }); return; }
    const tr = t.closest("[data-tier]");
    if (tr) {
      const v = tr.dataset.tier, all = Object.keys(TIERS), cur = ED.draft.tiers.length ? ED.draft.tiers : all;
      let next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      if (!next.length) next = [v];
      ED.draft.tiers = next.length === all.length ? [] : next; renderEditor(); return;
    }
    const sz = t.closest("[data-size]");
    if (sz) { const s = sz.dataset.size, a = ED.draft.sizes; ED.draft.sizes = a.includes(s) ? a.filter((x) => x !== s) : [...a, s]; renderEditor(); return; }
    const wb = t.closest("[data-waist], [data-shoe]");
    if (wb) {
      const k = wb.dataset.waist ? "waist" : "shoe", n = +(wb.dataset.waist || wb.dataset.shoe), a = ED.draft[k] || [];
      ED.draft[k] = a.includes(n) ? a.filter((x) => x !== n) : [...a, n]; renderEditor(); return;
    }
    const sp = t.closest("[data-spark]");
    if (sp) { const id = sp.dataset.spark, a = ED.draft.surpriseVibes; ED.draft.surpriseVibes = a.includes(id) ? a.filter((x) => x !== id) : [...a, id]; renderEditor(); return; }
    const vb = t.closest("[data-vibe]");
    if (vb) {
      const id = vb.dataset.vibe, d = ED.draft;
      if (d.vibes.includes(id)) { d.vibes = d.vibes.filter((x) => x !== id); d.avoidVibes.push(id); }
      else if (d.avoidVibes.includes(id)) d.avoidVibes = d.avoidVibes.filter((x) => x !== id);
      else d.vibes.push(id);
      renderEditor(); return;
    }
    const pb = t.closest("[data-pickbrand]");
    if (pb) { const b = pb.dataset.pickbrand, a = ED.draft.brands; ED.draft.brands = a.includes(b) ? a.filter((x) => x !== b) : [...a, b]; pb.classList.toggle("on"); return; }
    const dn = t.closest("[data-delnudge]"); if (dn) { delete ED.draft.nudges[dn.dataset.delnudge]; renderEditor(); return; }
    const dsw = t.closest("[data-delsteer]"); if (dsw) { ED.draft.steerWords.splice(+dsw.dataset.delsteer, 1); renderEditor(); return; }
    if (t.closest("#fAddLove")) { addWord("love"); return; }
    if (t.closest("#fAddAvoid")) { addWord("avoid"); return; }
    const dw = t.closest("[data-delword]"); if (dw) { ED.draft.words.splice(+dw.dataset.delword, 1); renderEditor(); return; }
    const da = t.closest("[data-delavoid]"); if (da) { ED.draft.avoidWords.splice(+da.dataset.delavoid, 1); renderEditor(); return; }
    const pk = t.closest("[data-pick]");
    if (pk) { const id = pk.dataset.pick, d = ED.draft; d.liked = d.liked.includes(id) ? d.liked.filter((x) => x !== id) : [id, ...d.liked]; pk.classList.toggle("on"); return; }
    if (t.closest("#fMore")) { fillPicks(); return; }
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.id === "steerForm") {
      e.preventDefault(); const text = $("#steerText").value.trim(); if (!text) return;
      try { const vec = await encodeText(text, $("#qStatus")); S.steer.words.push({ label: text, vec }); recompute(); render(); toast("Re-ranked with your note"); }
      catch (err) { $("#qStatus").textContent = S.model === "fake" ? "Notes work on the live site." : `Couldn't load the style model (${err.message}).`; }
      return;
    }
    if (e.target.id === "searchForm") { e.preventDefault(); const q = $("#q").value.trim(); if (q) runSearch(q); else { S.query = null; render(); } }
  });
  document.addEventListener("change", (e) => { if (e.target.id === "fPhotos" && e.target.files.length) addPhotos(e.target.files); });
  document.addEventListener("input", (e) => {
    if (e.target.id === "fName") { ED.draft.name = e.target.value; e.target.classList.remove("err"); }
    if (e.target.id === "fMin" || e.target.id === "fMax") syncEdPrice();
    if (e.target.id === "priceMin" || e.target.id === "priceMax") {
      const p = P(), a = +$("#priceMin").value, b = +$("#priceMax").value;
      p.price.min = Math.min(a, b); p.price.max = Math.max(a, b, p.price.min + 10);
      renderPrice(); clearTimeout(S.pt); S.pt = setTimeout(() => { saveStore(); render(); }, 150);
    }
    if (e.target.id === "surprise") { S.surprise = e.target.value / 100; clearTimeout(S.st); S.st = setTimeout(render, 80); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "fWord") { e.preventDefault(); addWord("love"); }
    if (e.key === "Enter" && e.target.matches(".vibe")) e.target.click();
    if (e.key === "Escape" && !$("#editor").hidden) $("#edClose").click();
  });

  // ---------- boot ----------
  (async function boot() {
    try {
      const [vibes, brands, index, pbuf] = await Promise.all([
        ...["vibes.json", "brands.json", "profiles/index.json"].map(getJSON), getBin("projection.bin")]);
      S.proj = new Float32Array(pbuf); S.k = S.proj.length / 512;
      S.vibes = vibes.map((v) => ({ ...v, vec: pv(v.vec) })); for (const v of S.vibes) S.vibeById[v.id] = v;
      for (const b of brands) S.brandInfo[b.name] = b;
      S.brands = brands;
      S.brandStats = await getJSON("brand_stats.json").catch(() => ({}));
      S.refiners = (await getJSON("refiners.json").catch(() => [])).map((r) => ({ ...r, vec: pv(r.vec) }));
      for (const r of S.refiners) S.refinerById[r.id] = r;
      S.live = await getJSON("live.json").catch(() => null);
      S.builtins = await Promise.all(index.map((id) => getJSON(`profiles/${id}.json`)));
      loadStore();
      const last = S.lastId && S.profiles[S.lastId];
      if (last && last.setupDone) { await useProfile(last); render(); } else openWelcome();
    } catch (err) {
      console.error(err);
      $("#intro").innerHTML = `<h1>No data yet</h1><p>The daily collector hasn't run yet (${esc(err.message)}).</p>`;
    }
  })();
})();
