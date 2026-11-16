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
    builtins: [], model: "", brandStats: {}, generic: [], bias: {}, shards: {}, refiners: [], refinerById: {},
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
    try { const s = JSON.parse(localStorage.getItem(STORE)) || {}; S.profiles = s.profiles || {}; S.lastId = s.current; Object.values(S.profiles).forEach(upgrade); }
    catch { S.profiles = {}; }
    try { // carry over likes from the first version of the app
      const old = JSON.parse(localStorage.getItem("fp:feedback:qizhe"));
      if (old && !S.profiles.qizhe) S.pendingOldFeedback = old;
    } catch {}
  }
  // profiles saved by older versions of the app may miss newer fields
  function upgrade(p) {
    // profiles saved before notes could be internal: hide the built-in starting notes
    const b = p.builtin && S.builtins && S.builtins.find((x) => x.id === p.id);
    if (b) {
      const sys = new Set([...(b.facets || []).map((f) => f.label), "loud logos, fast fashion, shiny sportswear"]);
      for (const w of [...(p.words || []), ...(p.avoidWords || [])]) if (sys.has(w.label)) w.hidden = true;
    }
    const d = { tiers: [], waist: [], shoe: [], nudges: {}, steerWords: [], saved: {}, extra: {}, avoidVibes: [], surpriseVibes: ["bold-colour", "texture", "vintage"],
      brands: [], words: [], avoidWords: [], liked: [], disliked: [], vibes: [], sizes: ["M"], price: { min: 0, max: 300 }, department: "men" };
    for (const [k, v] of Object.entries(d)) if (p[k] === undefined || p[k] === null) p[k] = JSON.parse(JSON.stringify(v));
    return p;
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
  async function getText(path) {
    if (window.FP_DATA && typeof window.FP_DATA[path] === "string") return window.FP_DATA[path];
    const r = await fetch(`data/${path}`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.text();
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
    meta.ids.forEach((id, r) => {
      const v = (S.vecs[id] = norm(Array.from(q.subarray(r * k, (r + 1) * k), (x) => (x / 127) * meta.scale)));
      // how close this photo sits to *any* caption (text-heavy banners score high on everything)
      if (S.generic.length) S.bias[id] = S.generic.reduce((a, g) => a + dot(v, g), 0) / S.generic.length;
    });
  }
  const JUNK = /spacer|custom order|flat fee|gift ?wrap|\bgwp\b|e-?gift|gift card|gift box|shipping|deposit|insurance|alteration|diffuser|lotion|hand cream|body wash|glow box|eau de|parfum|perfume|\bedp\b|\bedt\b|\b\d+ ?ml\b|candle|incense|\bsoap\b|\bvinyl\b|swatch|shirt fabric|giclee|gicl[ée]e|\bgsm\b|art print|poster|\bvol\.? ?\d|hardcover|paperback|\bbook\b|tribute to|magazine|pillow talk/i;
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
  // The catalogue comes in parts: "<dept>-core" (a varied slice of every brand) loads first; "<dept>-<category>"
  // (every piece of one kind) loads when someone opens that category or searches for it.
  function loadPart(name) {
    return (S.loaded[name] ||= (async () => {
      const [items, meta, buf] = await Promise.all([getJSON(`items-${name}.json`), getJSON(`meta-${name}.json`), getBin(`vectors-${name}.bin`)]);
      S.model = meta.model; S.updated = items.updated;
      for (const it of items.items) {
        const had = S.byId[it.id];
        if (!had) { S.byId[it.id] = it; S.items.push(it); }   // unisex pieces appear in both departments: keep one
        else if (had.live) { S.byId[it.id] = it; S.items[S.items.indexOf(had)] = it; }
      }
      decodeVectors(meta, buf);
      rebuildBrands();
    })());
  }
  const deptsOf = (dept) => (dept === "any" ? ["men", "women"] : [dept]);
  function ensureShard(dept) { return Promise.all(deptsOf(dept).map((d) => loadPart(`${d}-core`))); }
  function ensureCat(dept, cat) {
    return Promise.all(deptsOf(dept).filter((d) => S.shards[d] && S.shards[d][cat]).map((d) => loadPart(`${d}-${cat}`)));
  }
  function rebuildBrands() {
    const groups = {};
    for (const it of S.items) if (S.vecs[it.id] && it.category !== "underwear") (groups[it.brand] ||= []).push(S.vecs[it.id]);
    S.brandCentroid = {}; S.brandCount = {};
    for (const [b, rows] of Object.entries(groups)) { S.brandCentroid[b] = norm(mean(rows)); S.brandCount[b] = rows.length; }
    S.globalCentroid = norm(mean(Object.values(S.brandCentroid)));
    S.summaryCache = {};
    // labels found inside multi-brand shops (Nike at Kith, Lemaire at Dover Street Market…) become brands too
    const known = new Set(S.brands.map((b) => b.name));
    const extra = {};
    for (const it of S.items) {
      if (known.has(it.brand) || !S.brandCentroid[it.brand] || S.brandCount[it.brand] < 6) continue;
      const e = (extra[it.brand] ||= { name: it.brand, source: "via", tier: it.tier, departments: [], blurb: "", via: new Set() });
      if (it.department !== "unisex" && !e.departments.includes(it.department)) e.departments.push(it.department);
      if (it.retailer) e.via.add(it.retailer);
    }
    for (const e of Object.values(extra)) {
      if (!e.departments.length) e.departments = ["men", "women"];
      e.blurb = e.via.size ? `Sold here via ${[...e.via].slice(0, 3).join(", ")}.` : "";
      delete e.via; S.brands.push(e); S.brandInfo[e.name] = e;
    }
    const n = Object.keys(groups).length;
    const total = Object.values(S.shards).reduce((a, cats) => a + Object.entries(cats).filter(([c]) => c !== "core").reduce((x, [, v]) => x + v, 0), 0);
    $("#foot").textContent = `${(total || S.items.length).toLocaleString()} pieces · updated ${S.updated}` + (S.model === "fake" ? " · demo data" : "");
  }

  // ---------- profiles ----------
  function profileFromBuiltin(b) {
    return {
      id: b.id, name: b.name, builtin: true, department: b.department || "men",
      sizes: b.sizes || ["M"],
      price: { min: (b.budget && b.budget.min_gbp) || 0, max: (b.budget && b.budget.hard_max_gbp) || 300 },
      vibes: b.vibes || [], avoidVibes: [], surpriseVibes: b.surprise_vibes || [],
      brands: b.brands || [], tiers: b.tiers || [],
      words: (b.facets || []).map((f) => ({ label: f.label, vec: f.vec, hidden: true })),
      avoidWords: b.avoid ? [{ label: "loud logos, fast fashion, shiny sportswear", vec: b.avoid, hidden: true }] : [],
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
  // Built-in profiles (e.g. the owner's) are private: they only appear on a device that already
  // uses them, or after opening the site once with their link (…/FashionPlace/#qizhe).
  function allPeople() {
    return Object.values(S.profiles);
  }
  function unlockFromLink() {
    const id = decodeURIComponent((location.hash || "").slice(1));
    const b = id && S.builtins.find((x) => x.id === id);
    if (!b) return null;
    history.replaceState(null, "", location.pathname + location.search);
    if (!S.profiles[b.id]) { S.profiles[b.id] = upgrade(profileFromBuiltin(b)); saveStore(); }
    return S.profiles[b.id];
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
  // the department styles are read for: the profile being edited, else the one in use
  const vibeDept = () => { const e = document.getElementById("editor"); return (e && !e.hidden && ED.draft ? ED.draft.department : S.current && S.current.department) || "any"; };
  const vibeFits = (v, dept) => !v.for || v.for === "any" || dept === "any" || v.for === dept;
  const vibeVecs = (ids) => ids.map((id) => S.vibeById[id]).filter((v) => v && vibeFits(v, vibeDept())).map((v) => v.vec);
  function tasteFrom(p, { withFeedback = true } = {}) {
    const liked = withFeedback ? mean(p.liked.map((id) => S.vecs[id])) : null;
    const disliked = withFeedback ? mean(p.disliked.map((id) => S.vecs[id])) : null;
    const t = blend([
      [mean(vibeVecs(p.vibes)), 1.0],
      [mean(p.words.filter((w) => !w.thumb).map((w) => pv(w.vec))), 1.0],
      // photos: photo-to-photo similarity is much stronger than words-to-photo, so a photo is
      // turned down when there's anything else to go on, or it pulls the whole feed to one thing
      [mean(p.words.filter((w) => w.thumb).map((w) => pv(w.vec))), p.vibes.length || p.words.some((w) => !w.thumb) || p.liked.length ? 0.35 : 1.0],
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
    S.wordFacets = p.words.filter((w) => !w.thumb && !w.hidden).map((w) => parseQuery(w.en || w.label).facets.filter((f) => f.key === "cat" || f.key === "colour" || f.key === "material")).filter((fs) => fs.length);
    S.steerVec = steerVector(p);
    S.taste = tasteFrom(p);
    S.avoid = blend([[mean(vibeVecs(p.avoidVibes)), 1], [mean(p.avoidWords.map((w) => pv(w.vec))), 1]]);
    S.twist = blend([[mean(vibeVecs(p.surpriseVibes.length ? p.surpriseVibes : ["bold-colour", "texture", "vintage"])), 1]]);
  }
  function leans(taste) {
    const sims = S.vibes.filter((v) => vibeFits(v, vibeDept())).map((v) => [v.label, dot(taste, v.vec)]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const ex = sims.map(([, s]) => Math.exp(s * 30)), tot = ex.reduce((a, b) => a + b, 0);
    return sims.map(([l], i) => [l, Math.round((100 * ex[i]) / tot)]).filter(([, pc]) => pc >= 8).slice(0, 3);
  }

  // ---------- filtering & scoring ----------
  function fits(it, p, { ignoreCategory = false, ignorePrice = false } = {}) {
    if (p.department !== "any" && it.department !== "unisex" && it.department !== p.department) return false;
    if (!it.in_stock || it.category === "underwear" || it.category === "lifestyle" || !(it.price_gbp > 0) || JUNK.test(it.title)) return false;
    if (p.tiers && p.tiers.length && !it.live) { const tier = it.tier || (S.brandInfo[it.brand] || {}).tier; if (tier && !p.tiers.includes(tier)) return false; }
    if (it.letter_sized && p.sizes.length && !(it.letter_sizes || []).some((s) => p.sizes.includes(s))) return false;
    if (p.waist && p.waist.length && it.waist_sizes && it.waist_sizes.length && !it.waist_sizes.some((w) => p.waist.includes(w))) return false;
    if (p.shoe && p.shoe.length && it.shoe_sizes && it.shoe_sizes.length && !it.shoe_sizes.some((w) => p.shoe.includes(w) || p.shoe.includes(w - 0.5))) return false;
    if (!ignorePrice && (it.price_gbp < p.price.min || (p.price.max < 1000 && it.price_gbp > p.price.max))) return false;
    if (!ignoreCategory && S.category !== "all" && it.category !== S.category) return false;
    if (S.brand && it.brand !== S.brand) return false;
    return !!S.vecs[it.id];
  }
  // typed taste words that name a garment, colour or fabric ("dark wool trousers") also count literally,
  // because the photo model alone is loose about fabric and formality
  const WORD_FACET_W = 0.04;
  function wordFacetBonus(it) {
    if (!S.wordFacets || !S.wordFacets.length) return 0;
    let sum = 0;
    for (const fs of S.wordFacets) sum += fs.filter((f) => facetOk(it, f)).length / fs.length;
    return WORD_FACET_W * sum / S.wordFacets.length;
  }
  const score = (it) => { const v = S.vecs[it.id]; return dot(v, S.taste) - (S.avoid ? 0.35 * dot(v, S.avoid) : 0) - 0.7 * (S.bias[it.id] || 0) + wordFacetBonus(it); };
  // Typed searches: closeness to the words, minus how close the photo is to *every* sentence, then
  // a second pass that also leans towards the best first-pass matches (keeps the results coherent).
  function semantic(pool, qvec, text = "") {
    let q = pv(qvec);
    // fashion terms the photo model doesn't know well ('quiet luxury', 'old money') borrow the matching
    // vibe's richer description
    const t = text.toLowerCase();
    const vibe = S.vibes.find((v) => v.label.toLowerCase().split(" & ").some((w) => w.length > 5 && t.includes(w))) ||
      S.vibes.map((v) => [v, dot(v.vec, q)]).filter(([, s]) => s > 0.9).sort((a, c) => c[1] - a[1]).map(([v]) => v)[0];
    if (vibe) q = norm(q.map((x, j) => x + 1.5 * vibe.vec[j]));
    // brands carry a look: a piece from a label whose whole range fits the words gets a lift
    const bs = {}; for (const [bname, c] of Object.entries(S.brandCentroid)) bs[bname] = dot(c, q);
    const bAvg = Object.values(bs).reduce((a, c) => a + c, 0) / (Object.keys(bs).length || 1);
    const b = (it) => (S.bias[it.id] || 0) - 0.7 * ((bs[it.brand] ?? bAvg) - bAvg);
    const first = pool.map((x) => ({ ...x, m: dot(S.vecs[x.it.id], q) - b(x.it) })).sort((a, c) => c.m - a.m);
    // the best matches sharpen the query — taken across garment types, so one type can't hijack a mood
    const perCat = {}, lead = [];
    for (const x of first.slice(0, 300)) { if ((perCat[x.it.category] || 0) >= 8) continue; perCat[x.it.category] = (perCat[x.it.category] || 0) + 1; lead.push(x); if (lead.length >= 25) break; }
    const top = (lead.length >= 15 ? lead : first.slice(0, 25)).map((x) => S.vecs[x.it.id]);
    if (top.length < 5) return first;
    const cen = norm(mean(top)), q2 = norm(q.map((x, j) => x + 0.6 * cen[j]));
    return first.slice(0, 4000).map((x) => ({ ...x, m: dot(S.vecs[x.it.id], q2) - b(x.it) })).sort((a, c) => c.m - a.m);
  }
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
    // photo-to-photo similarity runs much higher than words-to-photo, so photos are scaled down to compare fairly
    const all = [
      ...p.vibes.map((id) => S.vibeById[id]).filter((x) => x && vibeFits(x, p.department)).map((x) => [x.label, x.vec, 0.75]),
      ...p.words.filter((w) => !w.hidden).map((w) => [w.thumb ? "your photos" : w.label, pv(w.vec), w.thumb ? 0.45 : 1]),
    ].map(([l, vec, k]) => [l, k * dot(v, vec)]).sort((a, b) => b[1] - a[1]);
    const cands = all.filter(([l]) => facetFits(l, it.category));
    const top = shorten((cands[0] || all[0] || ["your taste"])[0]);
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

  // the same piece listed twice (one listing per colour, or by two shops) shows once
  const pieceKey = (it) => `${it.brand}|${it.title}`.toLowerCase().replace(/[^a-z0-9|]+/g, " ").trim();
  function dedupe(list) {
    const seen = new Set();
    return list.filter((x) => { const k = pieceKey(x.it); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  // no brand more than perBrandRun times in any 6 in a row; optionally no garment type more than perCatRun times in any 6
  function diversify(ranked, perBrandRun = 2, perCatRun = 0) {
    const out = [], pool = dedupe(ranked.slice(0, 900)).slice(0, 600);
    while (pool.length) {
      const recent = out.slice(-6).map((x) => x.it);
      const ok = (x) => recent.filter((r) => r.brand === x.it.brand).length < perBrandRun
        && (!perCatRun || recent.filter((r) => r.category === x.it.category).length < perCatRun);
      let idx = pool.slice(0, 400).findIndex(ok);
      if (idx < 0) idx = pool.findIndex((x) => recent.filter((r) => r.brand === x.it.brand).length < perBrandRun);
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
      return p.liked.map((id) => S.byId[id] || (p.saved[id] && p.saved[id].item)).filter(Boolean).map((it) => {
        const st = savedStatus(it, p);
        return { it, status: st, advice: advice(it, p), why: p.saved[it.id] ? `Saved ${p.saved[it.id].date} at ${money(p.saved[it.id].price)}` : "" };
      }).sort((a, b) => (b.status && b.status.cls === "deal") - (a.status && a.status.cls === "deal"));
    }
    let base = steerPool(S.items.filter((it) => fits(it, p)).map((it) => ({ it, s: score(it) })));
    const seen = new Set([...p.liked, ...p.disliked]);

    if (S.query) { // a specific request: hard filters for what was named, then meaning + your taste
      const q = S.query.parsed || (S.query.parsed = parseQuery(S.query.text));
      const off = S.query.off || (S.query.off = new Set());
      // an explicit price or department in the request beats the profile's defaults
      const usePrice = q.facets.some((f) => f.key === "price" && !off.has("price")), useDept = q.facets.some((f) => f.key === "dept" && !off.has("dept"));
      if (usePrice || useDept) {
        const p2 = { ...p, price: usePrice ? { min: 0, max: 1e9 } : p.price, department: useDept ? "any" : p.department };
        base = steerPool(S.items.filter((it) => fits(it, p2)).map((it) => ({ it, s: score(it) })));
      }
      const kw = S.query.kw;
      if (kw && kw.ids.size && !kw.missing && !off.has("kw")) { // exact model/name match: search those pieces only
        const p3 = { ...p, price: { min: 0, max: 1e9 }, department: "any", tiers: [] };
        base = steerPool(S.items.filter((it) => kw.ids.has(it.id) && fits(it, p3)).map((it) => ({ it, s: score(it) })));
      }
      const res = matchQuery(base, q, off);
      S.query.dropped = res.dropped;
      base = semantic(res.list, S.query.vec, S.query.semText || S.query.text);
      const zq = zs(base.map((x) => x.m));
      const ranked = base.map((x, i) => ({ ...x, q: zq[i] + 0.3 * x.s }))
        .sort((a, b) => b.q - a.q).slice(0, 240);
      return diversify(ranked, 2).map((x) => ({ ...x, why: reason(x.it, "search") }));
    }
    if (S.tab === "deals") {
      const cutoff = quantile(base.map((x) => x.s), 0.35);
      return dedupe(base.filter((x) => x.it.deal && x.it.deal.verdict && x.it.deal.verdict !== "always_on_sale" && x.s >= cutoff)
        .sort((a, b) => b.s - a.s)).map((x) => ({ ...x, why: reason(x.it, "deals"), advice: advice(x.it, p) }));
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
      return (S.brand ? dedupe(pool) : diversify(pool, 1, S.category === "all" ? 3 : 0)).map((x) => ({ ...x, why: reason(x.it, "explore") }));
    }
    const ranked = base.filter((x) => !p.disliked.includes(x.it.id)).sort((a, b) => b.s - a.s);
    return (S.brand ? dedupe(ranked) : diversify(ranked, 2, S.category === "all" ? 3 : 0)).map((x) => ({ ...x, why: reason(x.it, "foryou") }));
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
      <form class="search" id="searchForm"><input id="q" placeholder="Search anything — “black wool trousers for work under £150” or a feeling" value="${S.query ? esc(S.query.display || S.query.text) : ""}" maxlength="140">${S.query ? `<button type="button" class="ghost sm" id="qClear">Clear</button>` : ""}</form>
      ${S.query ? facetChips(S.query.parsed || parseQuery(S.query.text), S.query.dropped || [], S.query.off || new Set(), S.query.kw) : ""}
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
    for (const d of deptsOf(p.department)) for (const [c, n] of Object.entries(S.shards[d] || {})) if (c !== "core") counts[c] = (counts[c] || 0) + n;
    if (!Object.keys(counts).length) for (const i of S.items) if (fits(i, p, { ignoreCategory: true })) counts[i.category] = (counts[i.category] || 0) + 1;
    const cats = ["all", ...Object.entries(counts).filter(([c, n]) => n >= 60 && c !== "other" && c !== "underwear").sort((a, b) => b[1] - a[1]).map(([c]) => c)];
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
    const [h, sub] = S.query ? ["Search", "What you asked for first, then ranked by your taste."] : INTROS[S.tab];
    $("#intro").innerHTML = `<h1>${h}</h1><p>${sub}</p>`;
    $("#surpriseWrap").hidden = S.tab !== "explore" || !!S.query;
    $("#controls").hidden = S.tab === "saved";
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", !S.query && b.dataset.tab === S.tab));
    $("#savedCount").textContent = P().liked.length || "";
    const full = build(), list = full.slice(0, 120);
    renderTastebar(); renderBrandsRow(); renderChips(); renderPrice(); renderLive(); renderEditRow();
    if (S.query) $("#intro p").textContent = full.length ? `${full.length >= 240 ? "240+" : full.length} pieces · what you asked for first, then ranked by your taste.` : "Nothing matches that in our brands yet — try removing a filter above.";
    $("#grid").innerHTML = list.map(card).join("");
    $("#empty").hidden = list.length > 0;
    $("#empty").textContent = S.tab === "saved" ? "Nothing saved yet — tap ♥ on anything you love." : "Nothing here — try widening the price range or sizes.";
  }

  // ---------- landing: what a first-time visitor sees ----------
  let LAND = null;
  function showLanding(on) {
    document.body.classList.toggle("on-landing", on);
    $("#landing").hidden = !on;
    if (on) window.scrollTo({ top: 0 });
  }
  function lcard(it) {
    const d = it.deal || {};
    const badge = d.verdict === "real_drop" ? `<span class="badge deal">Price drop −${d.discount_pct}%</span>`
      : d.verdict === "on_sale_unverified" ? `<span class="badge deal">Sale −${d.discount_pct}%</span>` : "";
    return `<a class="lcard" href="${esc(it.url)}" target="_blank" rel="noopener">
      <div class="photo"><div class="ph" style="background:${tint(it.title)}">${esc(shortTitle(it.title))}</div>
        ${it.image ? `<img src="${esc(it.image)}" alt="${esc(it.title)}" loading="lazy" onerror="this.remove()">` : ""}<div class="badges">${badge}</div></div>
      <div class="meta"><div class="b">${esc(it.brand)}</div><div class="t">${esc(it.title)}</div>
      <div class="price">${money(it.price_gbp)}${it.compare_at_gbp ? `<s>${money(it.compare_at_gbp)}</s>` : ""}</div></div></a>`;
  }
  async function openLanding() {
    showLanding(true);
    if (!LAND) LAND = await getJSON("landing.json").catch(() => null);
    if (!LAND) return;
    $("#lCount").textContent = `${Math.floor(LAND.brands / 10) * 10}+`;
    $("#lNames").textContent = `${LAND.names.slice(0, 8).join(" · ")} · and ${LAND.brands - 8} more`;
    $("#lq").focus({ preventScroll: true });
    if (!S.landingQuery) { $("#lResHead").innerHTML = `<p class="l-eyebrow">Today in the feed</p>`; $("#lGrid").innerHTML = LAND.picks.map(lcard).join(""); }
  }
  // ---------- understanding a specific request: "black wool trousers for work under £150" ----------
  const Q_CATS = [
    [/\b(trousers?|pants|chinos?|slacks)\b/, "trousers", null, "Trousers"], [/\bjeans?\b/, "denim", null, "Jeans"],
    [/\b(scarf|scarves)\b/, "accessories", /scarf|scarves/, "Scarves"], [/\b(beanie|hat|cap)s?\b/, "accessories", /beanie|hat\b|cap\b/, "Hats"],
    [/\bgloves?\b/, "accessories", /glove/, "Gloves"], [/\bbelts?\b/, "accessories", /belt/, "Belts"],
    [/\bpolos?\b/, null, /polo/, "Polos"], [/\b(backpacks?|rucksacks?)\b/, "bags", /backpack|rucksack/, "Backpacks"],
    [/\bcardigans?\b/, "knitwear", /cardigan/, "Cardigans"], [/\b(jumpers?|sweaters?|knits?|knitwear)\b/, "knitwear", null, "Knitwear"],
    [/\b(coats?|overcoats?|parkas?|trench)\b/, "outerwear", /coat|parka|trench/, "Coats"], [/\bjackets?\b/, "outerwear", null, "Jackets"],
    [/\bblazers?\b/, "tailoring", /blazer|jacket/, "Blazers"], [/\bsuits?\b/, "tailoring", null, "Suits"],
    [/\b(t-?shirts?|tees?)\b/, "tshirts", null, "T-shirts"],
    [/\bshirts?\b/, "shirts", null, "Shirts"], [/\b(hoodies?|sweatshirts?|joggers?)\b/, "sweats", null, "Sweats"],
    [/\bdress(es)?\b/, "dresses", null, "Dresses"], [/\bskirts?\b/, "skirts", null, "Skirts"], [/\b(tops?|blouses?|camis?)\b/, "tops", null, "Tops"],
    [/\bboots?\b/, "shoes", /boot/, "Boots"], [/\bloafers?\b/, "shoes", /loafer/, "Loafers"],
    [/\b(trainers?|sneakers?|running shoes?|runners?)\b/, "shoes", null, "Trainers"], [/\b(shoes?|footwear)\b/, "shoes", null, "Shoes"],
    [/\b(bags?|totes?|backpacks?|handbags?)\b/, "bags", null, "Bags"], [/\bshorts\b/, "shorts", null, "Shorts"],
    [/\b(leggings?|sports? bras?|activewear|gym)\b/, "activewear", null, "Activewear"],
  ];
  const Q_COLOURS = { black: ["black"], white: ["white"], cream: ["cream", "ivory", "ecru", "off-white", "off white", "oatmeal"],
    grey: ["grey", "gray", "charcoal"], navy: ["navy"], blue: ["blue"], green: ["green"], olive: ["olive", "khaki"],
    brown: ["brown", "chocolate", "tobacco"], beige: ["beige", "camel", "tan", "sand"], red: ["red"], burgundy: ["burgundy", "wine", "bordeaux", "oxblood"],
    pink: ["pink"], purple: ["purple", "lilac"], yellow: ["yellow", "mustard"], orange: ["orange", "rust"] };
  const COLOUR_OK = { blue: ["blue", "navy"], navy: ["navy", "blue"], cream: ["cream", "white", "beige"], white: ["white", "cream"],
    brown: ["brown", "beige"], beige: ["beige", "brown", "cream"], burgundy: ["burgundy", "red"], olive: ["olive", "green"], green: ["green", "olive"] };
  const Q_MATERIALS = { wool: ["wool", "merino", "lambswool", "cashmere", "mohair", "alpaca", "tweed", "flannel"], cashmere: ["cashmere"], merino: ["merino"],
    cotton: ["cotton"], linen: ["linen"], silk: ["silk", "satin"], leather: ["leather"], suede: ["suede"], denim: ["denim"],
    corduroy: ["corduroy", "cord"], cord: ["corduroy", "cord"], mohair: ["mohair"], tweed: ["tweed"], velvet: ["velvet"], fleece: ["fleece"], satin: ["satin", "silk"] };
  function parseQuery(text) {
    const t = text.toLowerCase(), q = { text, facets: [] };
    for (const [re, cat, sub, label] of Q_CATS) if (re.test(t)) { q.facets.push({ key: "cat", cat, sub, label }); break; }
    for (const [c, words] of Object.entries(Q_COLOURS)) if (words.some((w) => new RegExp(`\\b${w}\\b`).test(t))) { q.facets.push({ key: "colour", colour: c, label: c[0].toUpperCase() + c.slice(1) }); break; }
    for (const [m, ok] of Object.entries(Q_MATERIALS)) if (new RegExp(`\\b${m}\\b`).test(t)) { q.facets.push({ key: "material", ok, label: m[0].toUpperCase() + m.slice(1) }); break; }
    let m;
    if ((m = t.match(/£?\s*(\d{2,4})\s*(?:-|–|to)\s*£?\s*(\d{2,4})/))) q.facets.push({ key: "price", min: +m[1], max: +m[2], label: `£${m[1]}–£${m[2]}` });
    else if ((m = t.match(/(?:under|below|less than|max|up to|cheaper than)\s*£?\s*(\d{2,4})/))) q.facets.push({ key: "price", min: 0, max: +m[1], label: `Under £${m[1]}` });
    else if ((m = t.match(/(?:over|above|more than|from)\s*£\s*(\d{2,4})/))) q.facets.push({ key: "price", min: +m[1], max: Infinity, label: `Over £${m[1]}` });
    if (/\b(women'?s|womens|women|womenswear|ladies|lady|woman|girls?|for her|feminine)\b/.test(t)) q.facets.push({ key: "dept", dept: "women", label: "Womenswear" });
    else if (/\b(men'?s|mens|men|menswear|gentlem[ae]n|gents?|guys?|man|for him|masculine)\b/.test(t)) q.facets.push({ key: "dept", dept: "men", label: "Menswear" });
    const b = brandInQuery(text); if (b) q.facets.push({ key: "brand", brand: b, label: b });
    q.outOfScope = /\b(costumes?|fancy dress|halloween|cosplay|onesie|wig|uniform|school uniform|workwear boots? steel)\b/.test(t);
    return q;
  }
  function facetOk(it, f) {
    const title = it.title.toLowerCase();
    switch (f.key) {
      case "cat": return (!f.cat || it.category === f.cat) && (!f.sub || f.sub.test(title) || f.sub.test((it.ptype || "").toLowerCase())
        || !!(S.query && S.query.kw && S.query.kw.ids.has(it.id)));  // 'Weejun' is a loafer even if the title doesn't say so
      case "colour": { const ok = COLOUR_OK[f.colour] || [f.colour]; return ok.includes(it.colour) || Q_COLOURS[f.colour].some((w) => title.includes(w)); }
      case "material": return f.ok.some((x) => (it.materials || []).includes(x) || title.includes(x));
      case "price": return it.price_gbp >= f.min && it.price_gbp <= f.max;
      case "dept": return it.department === f.dept || it.department === "unisex";
      case "brand": return it.brand === f.brand;
    }
    return true;
  }
  // Strict first; if nothing matches, loosen the least important part (material, then colour, then the exact garment)
  function matchQuery(pool, q, off = new Set()) {
    const active = q.facets.filter((f) => !off.has(f.key));
    const strict = pool.filter((x) => active.every((f) => facetOk(x.it, f)));
    if (strict.length || !active.length) return { list: strict, dropped: [] };
    const dropped = [];
    for (const k of ["material", "colour", "price", "cat"]) {
      const f = active.find((x) => x.key === k); if (!f) continue;
      dropped.push(f);
      const rest = active.filter((x) => !dropped.includes(x));
      const loose = pool.filter((x) => rest.every((g) => facetOk(x.it, g)));
      if (loose.length) return { list: loose, dropped };
    }
    return { list: [], dropped };
  }
  function facetChips(q, dropped, off, kw) {
    let scope = q.outOfScope ? `<span class="qnote">We search fashion brands, so costumes and fancy dress are rare here — these are the closest pieces to build the look from.</span>` : "";
    if (kw && kw.missing) scope += `<span class="qnote">We don't have “${esc(kw.tokens.join(" "))}” in our shops right now — here's the closest we have.</span>`;
    if (kw && kw.ids.size && !kw.missing) q = { ...q, facets: [...q.facets, { key: "kw", label: `“${kw.tokens.join(" ")}”` }] };
    if (!q.facets.length) return scope ? `<div class="qchips">${scope}</div>` : "";
    return `<div class="qchips"><span class="lbl">Looking for</span>${q.facets.map((f) => {
      const isOff = off.has(f.key), isDropped = dropped.some((d) => d.key === f.key);
      return `<button class="qchip ${isOff || isDropped ? "off" : ""}" data-qfacet="${f.key}" title="${isOff ? "Add back" : "Remove this filter"}">${esc(f.label)} ${isOff ? "+" : "✕"}</button>`;
    }).join("")}${dropped.length ? `<span class="qnote">No exact match — showing the closest without ${dropped.map((d) => esc(d.label.toLowerCase())).join(" or ")}.</span>` : ""}${scope}</div>`;
  }

  // ---------- exact words: model names like "Evo SL", "Weejun", "Cloudmonster" ----------
  let IDX = null;
  function loadIndex() {
    return (IDX ||= (async () => {
      const txt = await getText("search-index.txt");
      const nl = txt.indexOf("\n"), parts = txt.slice(0, nl).split("\t").slice(1);
      const part = [], ids = [], texts = [];
      for (const line of txt.slice(nl + 1).split("\n")) {
        const a = line.indexOf("\t"), b = line.indexOf("\t", a + 1);
        if (a < 0 || b < 0) continue;
        part.push(+line.slice(0, a)); ids.push(line.slice(a + 1, b)); texts.push(line.slice(b + 1));
      }
      return { parts, part, ids, texts };
    })());
  }
  const KW_STOP = new Set(("a an and or the for with in on of to my me i im i'm want need looking some something that this "
    + "very really nice good best new old cheap smart casual everyday work working office day night weekend winter summer spring "
    + "autumn fall men mens women womens woman man size uk eu pair style look outfit like under over below above than less more "
    + "from up price pound pounds gbp colour color material fabric made wear wearing modern classic classy").split(" "));
  const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Words left after the garment/colour/material/price/brand are understood. Rare ones (a model name)
  // must appear in the title; common ones ('running') are left to meaning-based matching.
  async function keywordPlan(text, q) {
    const t = text.toLowerCase();
    let toks = (t.match(/[a-z0-9][a-z0-9'+.-]*/g) || []).map((w) => w.replace(/[.'-]+$/, "")).filter((w) => w && !KW_STOP.has(w) && !/^£?\d{2,4}$/.test(w));
    const brand = q.facets.find((f) => f.key === "brand");
    const brandWords = brand ? brand.brand.toLowerCase().split(/\s+/) : [];
    toks = toks.filter((w) => !brandWords.includes(w) && !(brand && brand.brand.toLowerCase().includes(w)) && !Q_CATS.some(([re]) => re.test(w)) &&
      !Object.values(Q_COLOURS).flat().includes(w) && !Object.keys(Q_MATERIALS).includes(w) && w.length >= 2);
    if (!toks.length) return null;
    const idx = await loadIndex(), N = idx.texts.length;
    const res = toks.map((w) => ({ w, re: new RegExp(`(^|[^a-z0-9])${escRe(w)}([^a-z0-9]|$)`) }));
    for (const r of res) { let n = 0; for (const x of idx.texts) if (r.re.test(x)) n++; r.df = n; }
    const productLike = !!(brand || q.facets.some((f) => f.key === "cat"));
    const specific = res.filter((r) => r.df > 0 && r.df <= Math.max(40, N * 0.004));
    const unknown = productLike ? res.filter((r) => r.df === 0 && /\d|^[a-z]{2,}$/.test(r.w)) : [];
    if (!specific.length) return unknown.length ? { tokens: unknown.map((r) => r.w), ids: new Set(), parts: [], missing: true } : null;
    // a feeling ('modern city finance') isn't a product name: only use title words when they actually
    // pin down pieces, and never claim something is missing
    if (!productLike && (specific.length !== res.length || res.length > 3)) return null;
    const ids = new Set(), parts = new Set();
    idx.texts.forEach((x, i) => { if (specific.every((r) => r.re.test(x)) && (!brand || x.startsWith(brand.brand.toLowerCase()) || x.includes(brand.brand.toLowerCase()))) { ids.add(idx.ids[i]); parts.add(idx.parts[idx.part[i]]); } });
    if (!productLike && !ids.size) return null;
    const missing = ids.size === 0 || unknown.length > 0;
    return { tokens: (missing ? [...specific, ...unknown] : specific).map((r) => r.w), ids, parts: [...parts], missing };
  }
  async function loadKeywordParts(kw) { if (kw && kw.parts.length) await Promise.all(kw.parts.map((n) => loadPart(n))); }

  // "Nike running shoes" → only Nike pieces (when we have enough of them)
  function brandInQuery(text) {
    const t = ` ${text} `;
    let best = null;
    for (const b of Object.keys(S.brandCount || {})) {
      if (b.length < 2) continue;
      // short names ('On', 'COS') must be typed with their capitals, so 'shoes on sale' isn't a brand search
      const re = new RegExp(`[^A-Za-z0-9]${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^A-Za-z0-9]`, b.length <= 3 ? "" : "i");
      if (re.test(t) && (!best || b.length > best.length)) best = b;
    }
    return best && S.brandCount[best] >= 5 ? best : null;
  }

  // ---------- the stylist: an AI reads the request and plans the look; our own search finds each piece ----------
  const PLAN_CATS = new Set(["trousers", "denim", "knitwear", "shirts", "tshirts", "outerwear", "tailoring", "shoes", "bags", "accessories", "dresses", "skirts", "tops", "sweats", "activewear", "shorts"]);
  async function askStylist(text, dept) {
    if (!S.live || !S.live.search_url || S.model === "fake") return null;
    const r = await fetch(`${S.live.search_url}/plan`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, dept, lang: (window.I18N && I18N.lang) || "en" }), signal: AbortSignal.timeout(25000) });
    const d = await r.json();
    if (!r.ok || d.error || !Array.isArray(d.pieces)) throw new Error(d.error || `status ${r.status}`);
    d.pieces = d.pieces.filter((x) => x && (x.query || x.label)).slice(0, 6);
    return d;
  }
  // Chinese (or any CJK) words → the stylist's English rewrite: the photo model only reads English
  const hasCJK = (s) => /[\u3400-\u9fff\uf900-\ufaff]/.test(s);
  const CJK_ERR = "Chinese search needs our AI stylist, which can't be reached just now — try again in a moment, or search in English.";
  async function toEnglish(text, dept) {
    if (!hasCJK(text)) return { en: text, plan: null };
    const plan = await askStylist(text, dept).catch(() => null);
    const en = plan && (plan.search_en || plan.pieces.map((x) => x.query).filter(Boolean).join(", "));
    if (!en || hasCJK(en)) throw new Error("cjk");
    return { en, plan };
  }
  // the words of one planned piece → the same structured filters a typed search would get
  function pieceQuery(piece, dept) {
    const words = [piece.query || piece.label, piece.colour, piece.material, piece.max_price_gbp ? `under £${Math.round(piece.max_price_gbp)}` : ""].filter(Boolean).join(" ");
    const q = parseQuery(words);
    q.facets = q.facets.filter((f) => f.key !== "dept" && f.key !== "brand");
    const cat = PLAN_CATS.has(piece.category) ? piece.category : null;
    const fc = q.facets.find((f) => f.key === "cat");
    if (cat && (!fc || (fc.cat && fc.cat !== cat))) { q.facets = q.facets.filter((f) => f.key !== "cat"); q.facets.unshift({ key: "cat", cat, sub: null, label: cap(cat) }); }
    if (dept === "men" || dept === "women") q.facets.push({ key: "dept", dept, label: dept });
    return q;
  }
  async function mustWordIds(words) {
    const mw = (words || []).map((w) => String(w).toLowerCase().trim()).filter((w) => w.length >= 2).slice(0, 3);
    if (!mw.length) return null;
    const idx = await loadIndex(), res = mw.map((w) => new RegExp(`(^|[^a-z0-9])${escRe(w)}([^a-z0-9]|$)`));
    const ids = new Set(), parts = new Set();
    idx.texts.forEach((x, i) => { if (res.every((r) => r.test(x))) { ids.add(idx.ids[i]); parts.add(idx.parts[idx.part[i]]); } });
    await Promise.all([...parts].map((n) => loadPart(n)));
    return { words: mw, ids };
  }
  async function pieceVecs(texts, st) {
    if (!clipText && !S.testEncode) await encodeText(texts[0], st);
    return encodeTexts(texts.map((t) => `a photo of ${t}`));
  }
  // find pieces for every part of the plan; never the same piece twice, at most one per brand in a row
  async function fillPlan(plan, dept, st, perPiece = 4) {
    const d = plan.department === "men" || plan.department === "women" ? plan.department : dept;
    const cats = [...new Set(plan.pieces.map((x) => x.category).filter((c) => PLAN_CATS.has(c)))];
    await Promise.all([ensureShard(d === "men" || d === "women" ? d : "any"), ...cats.map((c) => ensureCat(d === "men" || d === "women" ? d : "any", c))]);
    const vecs = await pieceVecs(plan.pieces.map((x) => x.query || x.label), st);
    const used = new Set(), out = [];
    for (let i = 0; i < plan.pieces.length; i++) {
      const piece = plan.pieces[i], q = pieceQuery(piece, d), must = await mustWordIds(piece.must_words);
      const base = S.items.filter((it) => it.in_stock && it.image && S.vecs[it.id] && it.price_gbp >= 10 && !JUNK.test(it.title) && !used.has(it.id)
        && !["underwear", "other", "lifestyle"].includes(it.category) && (!must || !must.ids.size || must.ids.has(it.id))).map((it) => ({ it }));
      const res = matchQuery(base, q);
      const ranked = semantic(res.list, vecs[i], piece.query || piece.label);
      const brands = {}, items = [];
      for (const x of ranked) {
        if ((brands[x.it.brand] || 0) >= (must && must.ids.size ? perPiece : 1)) continue;
        brands[x.it.brand] = (brands[x.it.brand] || 0) + 1; items.push(x.it); used.add(x.it.id);
        if (items.length >= perPiece) break;
      }
      out.push({ piece, items, missing: !!(must && !must.ids.size), mustWords: must && must.words, dropped: res.dropped });
    }
    return out;
  }
  const STYLIST_STEPS = ["Our stylist is reading your words…", "Planning the look, piece by piece…", "Searching every brand for each piece…"];
  function stylistLoading(el) {
    let i = 0; el.innerHTML = `<div class="edit loading"><p class="l-eyebrow">The edit</p><p class="edit-said">${STYLIST_STEPS[0]}</p></div>`;
    const t = setInterval(() => { const p = el.querySelector(".edit.loading .edit-said"); if (!p) return clearInterval(t); i = Math.min(i + 1, STYLIST_STEPS.length - 1); p.textContent = STYLIST_STEPS[i]; }, 2200);
    return () => clearInterval(t);
  }
  function renderEdit(plan, rows, cardFn) {
    const shown = rows.filter((r) => r.items.length);
    if (!shown.length) return "";
    return `<div class="edit"><p class="l-eyebrow">The edit</p>
      ${plan.understood ? `<p class="edit-said">${esc(plan.understood)}</p>` : ""}
      ${shown.map((r) => `<div class="erow"><div class="erow-h"><h3>${esc(r.piece.label || cap(r.piece.query))}</h3>
        ${r.dropped && r.dropped.length ? `<span class="qnote">closest without ${r.dropped.map((x) => esc(x.label.toLowerCase())).join(" or ")}</span>` : ""}</div>
        <div class="egrid">${r.items.map(cardFn).join("")}</div></div>`).join("")}
      <p class="edit-foot">Planned by an AI stylist, found by our own search across every brand.</p></div>`;
  }

  // ---------- understanding a request: the stylist reads it first, then our own search runs ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // A garment, colour or fabric is only a hard filter when the shopper literally asked for it: our word
  // matcher and the stylist must both see it. Mood words ("European autumn") steer the search, never filter it.
  function namedQuery(plan, parsed) {
    const n = plan.named;
    if (!n || typeof n !== "object") return parsed;
    const has = { cat: n.garment, colour: n.colour, material: n.material };
    return { ...parsed, facets: parsed.facets.filter((f) => !(f.key in has) || has[f.key]) };
  }
  async function understand(text, dept, st) {
    const live = S.live && S.live.search_url && S.model !== "fake";
    const planP = live ? askStylist(text, dept).catch((e) => { console.warn("stylist", e); return null; }) : Promise.resolve(null);
    let plan = null, en = text;
    if (hasCJK(text)) {
      if (st) st.textContent = "Understanding your words…";
      plan = await planP;
      en = plan && (plan.search_en || plan.pieces.map((x) => x.query).filter(Boolean).join(", "));
      if (!en || hasCJK(en)) throw new Error("cjk");
    }
    if (S.noStylist) plan = null; // test switch: translate only, then search the old way
    const parsed0 = parseQuery(en);
    let kw = await keywordPlan(en, parsed0).catch(() => null);
    const exact0 = !!(kw && kw.ids.size && !kw.missing);
    // a brand or garment plus a model name we hold ("adidas samba") needs no thinking; anything else waits
    // briefly for the stylist — "old money" also appears in product names, but it's a style, not a product
    const productLike = parsed0.facets.some((f) => f.key === "brand" || f.key === "cat");
    if (!plan && live && !(exact0 && productLike) && !S.noStylist) {
      if (st) st.textContent = "Understanding your words…";
      plan = await Promise.race([planP, sleep(S.planWait || 5000).then(() => null)]);
    }
    let parsed = parsed0, texts = [], semText = en;
    if (plan && plan.kind !== "exact") {
      kw = null; // a feeling isn't a product name: never hunt for its words in titles, never call them missing
      parsed = namedQuery(plan, parsed0);
      // the stylist also reads who it's for ("French girl", "a job in finance, men")
      if ((plan.department === "men" || plan.department === "women") && !parsed.facets.some((f) => f.key === "dept"))
        parsed = { ...parsed, facets: [...parsed.facets, { key: "dept", dept: plan.department, label: plan.department === "men" ? "Menswear" : "Womenswear" }] };
      texts = [plan.mood, ...plan.pieces.map((x) => x.query)].filter((t) => t && !hasCJK(t));
      if (plan.mood && !hasCJK(plan.mood)) semText = `${en} ${plan.mood}`;
    } else if (plan && plan.kind === "exact" && !exact0) {
      const m = await mustWordIds(plan.pieces[0] && plan.pieces[0].must_words).catch(() => null);
      if (m && m.ids.size) kw = { tokens: m.words, ids: m.ids, parts: [], missing: false };
    }
    // the request itself, plus how the stylist pictures it (the overall mood, and each piece of the look)
    let vec = norm(await encodeQuery(en, st));
    if (texts.length) {
      // for a feeling, the stylist's picture leads: raw words like "walk" or "weekend" mislead a photo model
      const own = parsed.facets.some((f) => f.key === "cat") ? 1 : 0.5;
      vec = vec.map((x) => own * x);
      try {
        const vs = (await encodeTexts(texts.map((t) => `a photo of ${t}`))).map(norm);
        const mood = plan.mood && !hasCJK(plan.mood) ? vs[0] : null, pieces = mean(mood ? vs.slice(1) : vs);
        vec = vec.map((x, i) => x + (mood ? mood[i] : 0) + (pieces ? 0.8 * pieces[i] : 0));
      } catch (e) { console.warn("mood", e); }
    }
    await loadKeywordParts(kw);
    return { shown: text, en, plan, planP, parsed, kw, vec, semText, exact: !!(kw && kw.ids.size && !kw.missing) };
  }
  // the front page's ranking for an understood request (no profile): used by the page and by the test set
  async function rankOpen(u) {
    const q = u.parsed, kw = u.kw, exact = u.exact;
    const c0 = q.facets.find((f) => f.key === "cat" && f.cat), d0 = q.facets.find((f) => f.key === "dept");
    await Promise.all([ensureShard("any"), c0 ? ensureCat(d0 ? d0.dept : "any", c0.cat) : null]);
    const named = q.facets.some((f) => f.key === "cat");
    // a style ('classy, modern') means clothes first — bags, hats and scarves only when asked for
    const all = S.items.filter((it) => it.in_stock && it.image && S.vecs[it.id] && it.price_gbp >= 10 && !JUNK.test(it.title)
      && (!exact || kw.ids.has(it.id))
      && !["underwear", "other", "lifestyle"].includes(it.category) && (exact || named || !["accessories", "bags"].includes(it.category)))
      .map((it) => ({ it }));
    const res = matchQuery(all, q);
    const ranked = semantic(res.list, u.vec, u.semText), pool = ranked.slice(0, 400);
    const perCat = {}, perBrand = {}, top = [];
    for (const x of dedupe(ranked.slice(0, 4000))) { // look deep enough that one garment type can't fill the page // a mix: at most two per brand, three of one kind of garment
      if ((perCat[x.it.category] || 0) >= (named || exact ? 12 : 3) || (perBrand[x.it.brand] || 0) >= (exact ? 12 : 2)) continue;
      perCat[x.it.category] = (perCat[x.it.category] || 0) + 1; perBrand[x.it.brand] = (perBrand[x.it.brand] || 0) + 1; top.push(x.it);
      if (top.length >= 12) break;
    }
    return { top, pool, res, named, exact };
  }
  async function searchFor(text, dept = "any") { // test hook
    const u = await understand(text, dept, null), r = await rankOpen(u);
    return { en: u.en, kind: u.plan ? u.plan.kind : null, engine: u.plan ? u.plan.engine : null, mood: u.plan ? u.plan.mood : null,
      named: u.plan ? u.plan.named : null, facets: u.parsed.facets.map((f) => f.label), dropped: r.res.dropped.map((f) => f.label),
      missing: !!(u.kw && u.kw.missing), exact: u.exact, matches: r.pool.length,
      items: r.top.map((it) => ({ title: it.title, brand: it.brand, category: it.category, colour: it.colour || "", materials: it.materials || [], ptype: it.ptype || "", price: it.price_gbp, department: it.department })) };
  }
  async function landingSearch(text) {
    const st = $("#lStatus"), token = (S.landingToken = (S.landingToken || 0) + 1), shown = text;
    $("#lEdit").innerHTML = "";
    let u;
    try { st.textContent = "Searching every brand…"; u = await understand(text, "any", st); }
    catch (e) {
      st.textContent = e.message === "cjk" ? CJK_ERR : S.model === "fake" ? "Search works on the live site." : `Couldn't search just now (${e.message}). Try again in a moment.`;
      return;
    }
    if (token !== S.landingToken) return;
    try {
      st.textContent = "Searching every brand…";
      const { top, pool, res, exact } = await rankOpen(u);
      if (token !== S.landingToken) return;
      const q = u.parsed, kw = u.kw, pf = q.facets.find((f) => f.key === "price"), max = pf ? pf.max : Infinity;
      const men = pool.slice(0, 40).filter((x) => x.it.department === "men").length, women = pool.slice(0, 40).filter((x) => x.it.department === "women").length;
      S.landingQuery = { text: shown, vec: u.vec, max, dept: men > women * 2 ? "men" : women > men * 2 ? "women" : "any" };
      st.textContent = "";
      $("#lResHead").innerHTML = `<h2>For “${esc(shown)}”</h2>${facetChips(q, res.dropped, new Set(), kw).replace(/data-qfacet="[^"]*"/g, "disabled")}
        <p class="l-sub">${!pool.length ? "Nothing in our brands matches that yet — try removing a word or two." : `${pool.length >= 400 ? "Hundreds of matches" : `${pool.length} match${pool.length === 1 ? "" : "es"}`} across ${new Set(pool.map((x) => x.it.brand)).size} brands. Save it and we'll keep finding more, in your size.`}</p>
        ${pool.length ? `<button class="l-cta" id="lSave">Make this my taste →</button>` : ""}`;
      $("#lGrid").innerHTML = top.map(lcard).join(""); $("#lGridHead").hidden = true;
      $("#lResHead").scrollIntoView({ behavior: "smooth", block: "start" });
      landingEdit(u.en, u.plan ? Promise.resolve(u.plan) : u.planP, token, { exact, dept: S.landingQuery.dept });
    } catch (e) {
      st.textContent = S.model === "fake" ? "Search works on the live site." : `Couldn't search just now (${e.message}). Try again in a moment.`;
    }
  }

  async function landingEdit(text, planP, token, { exact, dept }) {
    if (!S.live || !S.live.search_url || S.model === "fake") return;
    const el = $("#lEdit"), stop = stylistLoading(el);
    const plan = await planP; stop();
    if (token !== S.landingToken) return;
    if (!plan || !plan.pieces.length) { el.innerHTML = ""; return; }
    // a named model we already found exactly: the normal results are the answer
    if (plan.kind === "exact" && exact) { el.innerHTML = ""; return; }
    try {
      const rows = await fillPlan(plan, dept, null, plan.kind === "exact" || plan.pieces.length === 1 ? 8 : 4);
      if (token !== S.landingToken) return;
      el.innerHTML = renderEdit(plan, rows, lcard);
      if (el.innerHTML) $("#lGridHead").hidden = false;
    } catch (e) { console.warn("edit", e); el.innerHTML = ""; }
  }
  function startSetup(fromQuery) {
    const np = newProfile("");
    if (fromQuery && S.landingQuery) {
      const q = S.landingQuery;
      np.department = q.dept;
      np.words.push({ label: q.text, vec: q.vec.map((x) => Math.round(x * 1e5) / 1e5) });
      if (Number.isFinite(q.max)) np.price.max = Math.min(1000, q.max);
    }
    ensureShard(np.department);
    openEditor(np, true);
  }

  // ---------- who's shopping ----------
  function openWelcome() {
    $("#people").innerHTML = allPeople().map((p) => `<div class="prow"><button class="person" data-person="${esc(p.id)}">
        <span class="av" style="background:${tint(p.name)}">${esc((p.name || "?")[0])}</span>
        <span><b>${esc(p.name)}</b><small>${p.setupDone ? `${p.vibes.length} vibes · ${p.liked.length} ♥ · ${priceLabel(p.price)}` : "Not set up yet"}</small></span>
      </button>${S.profiles[p.id] ? `<button class="pdel" data-delperson="${esc(p.id)}" title="${p.builtin ? "Reset to the original taste" : "Remove this profile"}">${p.builtin ? "Reset" : "Remove"}</button>` : ""}</div>`).join("");
    if (!allPeople().length) $("#people").innerHTML = `<p class="sub">No profiles on this device yet. Setting one up takes a minute — it's saved here, on this device.</p>`;
    $("#welcome").hidden = false;
  }

  // ---------- taste editor (setup + tuning) ----------
  const TIERS = { "high-street": "High street", boutique: "Independent & boutique", premium: "Premium & designer", luxury: "Luxury" };
  const STEPS = ["Basics", "Vibes", "Words & photos", "Pick favourites"];
  const vibesFor = (dept) => S.vibes.filter((v) => vibeFits(v, dept));
  // the dozen most people in that department start from; "Both" gets the leaders of each
  function topVibes(dept) {
    const rank = (v) => dept === "any" ? Math.min(v.top.men || 99, v.top.women || 99) : v.top[dept] || 99;
    const lim = dept === "any" ? 7 : 12;
    return vibesFor(dept).filter((v) => rank(v) <= lim).sort((a, b) => rank(a) - rank(b));
  }
  const brandFitsDept = (b, dept) => dept === "any" || !b.departments || b.departments.includes(dept);
  const ED = { step: 0, draft: null, onboarding: false, shown: new Set() };

  function openEditor(p, onboarding, step = 0) {
    ED.moreVibes = false;
    ED.draft = upgrade(JSON.parse(JSON.stringify(p))); ED.onboarding = onboarding; ED.step = step; ED.shown = new Set();
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
        ${(() => {
          const tile = (v) => {
            const st = d.vibes.includes(v.id) ? "love" : d.avoidVibes.includes(v.id) ? "avoid" : "";
            return `<div class="vibe ${st}" data-vibe="${v.id}" role="button" tabindex="0"><b>${esc(v.label)}</b><small>${esc(v.desc)}</small>
            <span class="vstate">${st === "love" ? "♥ Love" : st === "avoid" ? "✕ Not me" : ""}</span>
            <button class="spark ${d.surpriseVibes.includes(v.id) ? "on" : ""}" data-spark="${v.id}" title="Surprise me with this">✦</button></div>`;
          };
          const all = vibesFor(d.department), top = topVibes(d.department), topIds = new Set(top.map((v) => v.id));
          const chosen = new Set([...d.vibes, ...d.avoidVibes]);
          const rest = all.filter((v) => !topIds.has(v.id));
          if (!top.length) return `<div class="vibes">${all.map(tile).join("")}</div>`;
          const open = ED.moreVibes || rest.some((v) => chosen.has(v.id));
          const groups = (S.vibeGroups.length ? S.vibeGroups : [""]).map((g) => [g, rest.filter((v) => (v.group || "") === g || !S.vibeGroups.length)]).filter(([, vs]) => vs.length);
          return `<p class="vhead">${d.department === "men" ? "Most chosen in menswear" : d.department === "women" ? "Most chosen in womenswear" : "Most chosen"}</p>
            <div class="vibes">${top.map(tile).join("")}</div>
            ${open ? groups.map(([g, vs]) => `<p class="vhead">${esc(g)}</p><div class="vibes">${vs.map(tile).join("")}</div>`).join("")
              : `<button class="ghost vmore" id="vMore">Show ${rest.length} more styles</button>`}`;
        })()}`;
    } else if (ED.step === 2) {
      const demo = S.model === "fake";
      body.innerHTML = `<h2>Describe it in your own words</h2>
        <p class="sub">Feelings work best — a place, a season, a person, a mood. e.g. <i>“Sunday in Copenhagen in October”</i>, <i>“what a well-dressed architect wears”</i>.${demo ? "<br><b>Word matching works on the live site, not in this demo.</b>" : ""}</p>
        <div class="addrow"><input id="fWord" placeholder="Describe a feeling or a look…" maxlength="140"><button class="solid" id="fAddLove">+ Love</button><button class="ghost" id="fAddAvoid">+ Avoid</button></div>
        <p class="status" id="fStatus"></p>
        <div class="words">${d.words.map((w, i) => w.thumb || w.hidden ? "" : `<span class="word">♥ ${esc(w.label)} <button data-delword="${i}" aria-label="Remove">✕</button></span>`).join("")}
        ${d.avoidWords.map((w, i) => w.hidden ? "" : `<span class="word avoid">✕ ${esc(w.label)} <button data-delavoid="${i}" aria-label="Remove">✕</button></span>`).join("")}</div>
        <h3>Outfit photos <small>screenshots, saved posts, your own outfits</small></h3>
        <label class="upload"><input type="file" id="fPhotos" accept="image/*" multiple hidden>＋ Add photos you love</label>
        <div class="thumbs">${d.words.filter((w) => w.thumb).map((w) => `<span class="thumb"><img src="${w.thumb}" alt=""><button data-delword="${d.words.indexOf(w)}" aria-label="Remove">✕</button></span>`).join("")}</div>
        ${Object.keys(d.nudges || {}).length || (d.steerWords || []).length ? `<h3>Saved nudges</h3><div class="words">
          ${Object.entries(d.nudges || {}).map(([id, n]) => `<span class="word">${esc((S.refinerById[id] || { label: id }).label)}${n > 1 ? ` ×${n}` : ""} <button data-delnudge="${id}" aria-label="Remove">✕</button></span>`).join("")}
          ${(d.steerWords || []).map((w, i) => `<span class="word">“${esc(w.label)}” <button data-delsteer="${i}" aria-label="Remove">✕</button></span>`).join("")}</div>` : ""}
        ${!d.words.some((w) => !w.hidden) && !d.avoidWords.some((w) => !w.hidden) ? `<p class="sub">Optional — skip if the vibes say it all.</p>` : ""}`;
    } else {
      body.innerHTML = `<h2>Pick your favourites</h2><p class="sub">Picked for you from what you've told us so far. Tap the ones you'd wear — every tap swaps the rest for closer matches. <button class="link" id="fMore">Show different ones</button></p><p class="status" id="pickStatus"></p><div class="pickgrid" id="pickGrid"></div>`;
      ED.grid = []; fillPicks();
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
    const sources = [...d.vibes.map((id) => S.vibeById[id]).filter(Boolean).map((v) => [v.label, v.vec]), ...d.words.filter((w) => !w.hidden).map((w) => [w.thumb ? "your photos" : `“${w.label}”`, pv(w.vec)])];
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
  // Best matches for the taste so far (vibes + words + photos + taps), with just enough variety:
  // no more than 2 per brand or 3 per kind of garment, and nothing near-identical to a piece already shown.
  function pickCandidates(d, n, exclude) {
    const prevB = S.brand, prevC = S.category; S.brand = null; S.category = "all";
    const t = tasteFrom(d);
    const pool = S.items.filter((it) => fits(it, d) && it.image && !exclude.has(it.id) && !["accessories", "bags", "other", "underwear", "lifestyle"].includes(it.category));
    S.brand = prevB; S.category = prevC;
    const ranked = pool.map((it) => ({ it, s: dot(S.vecs[it.id], t) - 0.7 * (S.bias[it.id] || 0) })).sort((a, b) => b.s - a.s).slice(0, 400);
    const keep = ED.grid.map((id) => S.byId[id]).filter(Boolean);
    const perBrand = {}, perCat = {}, out = [];
    for (const it of keep) { perBrand[it.brand] = (perBrand[it.brand] || 0) + 1; perCat[it.category] = (perCat[it.category] || 0) + 1; }
    for (const x of ranked) {
      if (out.length >= n) break;
      if ((perBrand[x.it.brand] || 0) >= 2 || (perCat[x.it.category] || 0) >= 3) continue;
      const v = S.vecs[x.it.id];
      if ([...keep, ...out].some((o) => dot(S.vecs[o.id], v) > 0.93)) continue; // near-duplicate
      out.push(x.it); perBrand[x.it.brand] = (perBrand[x.it.brand] || 0) + 1; perCat[x.it.category] = (perCat[x.it.category] || 0) + 1;
    }
    return out;
  }
  function fillPicks(keepLiked = false) {
    const d = ED.draft;
    ED.grid = keepLiked ? ED.grid.filter((id) => d.liked.includes(id)) : [];
    const fresh = pickCandidates(d, 12 - ED.grid.length, new Set([...ED.shown, ...ED.grid]));
    fresh.forEach((it) => ED.shown.add(it.id));
    ED.grid.push(...fresh.map((it) => it.id));
    $("#pickGrid").innerHTML = ED.grid.map((id) => S.byId[id]).filter(Boolean).map((it) => `<button class="pick ${d.liked.includes(it.id) ? "on" : ""}" data-pick="${esc(it.id)}" style="background:${tint(it.title)}">
      <img src="${esc(it.image)}" alt="${esc(it.title)}" loading="lazy" onerror="this.remove()"><span>${esc(it.brand)}</span></button>`).join("")
      || `<p class="sub">No pieces fit these sizes and prices — go back and widen them.</p>`;
  }
  function saveEditor() {
    const d = ED.draft; d.setupDone = true; d.name = d.name.trim() || "Me"; d.saved ||= {};
    for (const id of d.liked) if (!d.saved[id] && S.byId[id]) d.saved[id] = { price: S.byId[id].price_gbp, date: today(), item: { ...S.byId[id] } };
    const wasOnboarding = ED.onboarding;
    if (!S.current || S.current.id !== d.id) S.steer = { nudges: {}, words: [] }; // nudges belong to whoever made them
    S.profiles[d.id] = d; S.current = d;
    ensureShard(d.department).then(() => { recompute(); render(); });
    recompute(); saveStore();
    $("#whoName").textContent = d.name; $("#editor").hidden = true; $("#welcome").hidden = true; showLanding(false);
    if (wasOnboarding) S.tab = "foryou";
    render(); window.scrollTo({ top: 0 });
    toast(wasOnboarding ? `Welcome, ${d.name} — here's your feed` : "Taste updated");
  }

  // ---------- free text → style vector (CLIP text model, loaded on first use) ----------
  let clipText = null;
  async function encodeText(text, statusEl) {
    if (S.model === "fake") throw new Error("demo mode");
    if (S.testEncode) return (await S.testEncode([text]))[0];
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
    if (S.testEncodeImage) return S.testEncodeImage(file);
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
  async function encodeQuery(text, statusEl) { // two phrasings, averaged: steadier than one
    const v = await encodeText(text, statusEl);
    try { const [w] = await encodeTexts([`a photo of ${text}`]); return v.map((x, i) => x + w[i]); } catch { return v; }
  }
  async function addWord(kind) {
    const inp = $("#fWord"), text = inp.value.trim(), st = $("#fStatus"); if (!text) return;
    try {
      let en = text;
      if (hasCJK(text)) { st.textContent = "Understanding your words…"; try { ({ en } = await toEnglish(text, ED.draft.department)); } catch { st.textContent = CJK_ERR; return; } }
      const vec = await encodeText(en, st);
      (kind === "love" ? ED.draft.words : ED.draft.avoidWords).push({ label: text, en, vec: vec.map((x) => Math.round(x * 1e5) / 1e5) });
      renderEditor(); $("#fStatus").textContent = `Added “${text}”.`;
    } catch (e) {
      st.textContent = S.model === "fake" ? "Word matching works on the live site." : `Couldn't load the style model (${e.message}). Try again in a moment.`;
    }
  }
  // ---------- live search across every shop (needs the worker in worker/) ----------
  async function encodeTexts(texts) {
    if (S.testEncode) return S.testEncode(texts);
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

  function renderEditRow() {
    const el = $("#editRow"); if (!el) return;
    if (!S.query) { el.hidden = true; el.innerHTML = ""; S.edit = null; S.editToken = (S.editToken || 0) + 1; return; }
    if (!S.edit || S.edit.text !== S.query.text) return; // still loading, or nothing to show
    const html = renderEdit(S.edit.plan, S.edit.rows, (it) => card({ it, why: "Part of the look", status: savedStatus(it, P()) }));
    el.innerHTML = html; el.hidden = !html;
  }
  async function appEdit(text, exact, pre) {
    const el = $("#editRow"); if (!el) return;
    const token = (S.editToken = (S.editToken || 0) + 1);
    S.edit = null; el.hidden = true;
    if (!S.live || !S.live.search_url || S.model === "fake") return;
    el.hidden = false; const stop = stylistLoading(el);
    const plan = (await pre) || await askStylist(text, P().department).catch(() => null); stop();
    if (token !== S.editToken || !S.query || S.query.text !== text) return;
    if (!plan || !plan.pieces.length || (plan.kind === "exact" && exact)) { el.hidden = true; el.innerHTML = ""; return; }
    const pr = P().price; // your budget, unless the request named its own
    for (const x of plan.pieces) if (!x.max_price_gbp && pr && pr.max < 1000) x.max_price_gbp = pr.max;
    try {
      const rows = await fillPlan(plan, P().department, null, plan.kind === "exact" || plan.pieces.length === 1 ? 8 : 4);
      if (token !== S.editToken || !S.query || S.query.text !== text) return;
      S.edit = { text, plan, rows }; renderEditRow();
    } catch (e) { console.warn("edit", e); el.hidden = true; }
  }
  async function runSearch(text) {
    const st = $("#qStatus");
    try {
      const u = await understand(text, P().department, st);
      const dept = u.parsed.facets.find((f) => f.key === "dept"), cat = u.parsed.facets.find((f) => f.key === "cat" && f.cat);
      const useDept = dept && dept.dept !== P().department ? "any" : P().department;
      await Promise.all([useDept === "any" ? ensureShard("any") : null, cat ? ensureCat(useDept, cat.cat) : null]);
      S.query = { text: u.en, display: u.shown, vec: u.vec, kw: u.kw, parsed: u.parsed, semText: u.semText }; S.brand = null; render(); window.scrollTo({ top: 0 });
      liveSearch(u.en, u.vec);
      appEdit(u.en, u.exact, u.plan || u.planP);
    } catch (e) {
      st.textContent = e.message === "cjk" ? CJK_ERR : S.model === "fake" ? "Search by feeling works on the live site." : `Couldn't load the style model (${e.message}).`;
    }
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const t = e.target;
    const tab = t.closest("[data-tab]");
    if (tab) { S.tab = tab.dataset.tab; S.brand = null; S.query = null; render(); window.scrollTo({ top: 0 }); return; }
    if (t.closest("[data-cat]")) {
      S.category = t.closest("[data-cat]").dataset.cat; render();
      if (S.category !== "all") { $("#empty").hidden = false; $("#empty").textContent = "Loading every piece in this category…"; ensureCat(P().department, S.category).then(render); }
      return;
    }
    if (t.closest("[data-clearbrand]")) { S.brand = null; render(); return; }
    if (t.closest("#qClear")) { S.query = null; render(); return; }
    const qf = t.closest("[data-qfacet]");
    if (qf && S.query) { const k = qf.dataset.qfacet, off = S.query.off || (S.query.off = new Set()); off.has(k) ? off.delete(k) : off.add(k); render(); return; }
    const bc = t.closest("[data-brand]");
    if (bc) { S.brand = S.brand === bc.dataset.brand ? null : bc.dataset.brand; S.category = "all"; render(); if (S.brand) $("#controls").scrollIntoView({ behavior: "smooth" }); return; }
    const act = t.closest("[data-act]");
    if (act) {
      const id = act.closest(".card").dataset.id, p = P(), it = S.byId[id];
      const wasLiked = p.liked.includes(id);
      p.liked = p.liked.filter((x) => x !== id); p.disliked = p.disliked.filter((x) => x !== id);
      if (act.dataset.act === "like" && !wasLiked) {
        p.liked.unshift(id);
        p.saved[id] = { price: it.price_gbp, date: today(), outOfSize: !!(it.letter_sized && !(it.letter_sizes || []).some((s) => p.sizes.includes(s))),
          item: { ...it } }; // a copy, so Saved works even before that part of the catalogue is loaded
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
    if (t.closest("#whoBtn") || t.closest("#signIn")) { openWelcome(); return; }
    if (t.id === "welcome") { $("#welcome").hidden = true; return; } // click outside closes it
    if (t.closest("#homeBtn")) { openLanding(); return; }
    if (t.closest("#lStart")) { startSetup(false); return; }
    if (t.closest("#lSave")) { startSetup(true); return; }
    const tr0 = t.closest("[data-try]"); if (tr0) { $("#lq").value = tr0.dataset.try; landingSearch(tr0.dataset.try); return; }
    const person = t.closest("[data-person]");
    if (person) {
      const p = allPeople().find((x) => x.id === person.dataset.person);
      $("#welcome").hidden = true;
      if (!p.setupDone) { openEditor(p, true); return; }
      $("#intro").innerHTML = `<h1>Loading…</h1>`;
      showLanding(false);
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
    if (t.closest("#newProfile")) { $("#welcome").hidden = true; startSetup(false); return; }

    // editor
    if (t.closest("#edClose")) { $("#editor").hidden = true; if (!P()) openLanding(); return; }
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
    if (t.closest("#vMore")) { ED.moreVibes = true; renderEditor(); return; }
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
    if (pk) {
      const id = pk.dataset.pick, d = ED.draft, on = !d.liked.includes(id);
      d.liked = on ? [id, ...d.liked] : d.liked.filter((x) => x !== id);
      pk.classList.toggle("on", on);
      if (on) { // narrow down: swap the untapped pieces for closer matches
        clearTimeout(ED.pickT);
        ED.pickT = setTimeout(() => { fillPicks(true); const st = $("#pickStatus"); if (st) st.textContent = `Updated from your ${d.liked.length} pick${d.liked.length > 1 ? "s" : ""}.`; }, 700);
      }
      return;
    }
    if (t.closest("#fMore")) { fillPicks(true); return; }
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.id === "lSearch") { e.preventDefault(); const q = $("#lq").value.trim(); if (q) landingSearch(q); return; }
    if (e.target.id === "steerForm") {
      e.preventDefault(); const text = $("#steerText").value.trim(); if (!text) return;
      try { let en = text; if (hasCJK(text)) ({ en } = await toEnglish(text, P().department)); const vec = await encodeText(en, $("#qStatus")); S.steer.words.push({ label: text, vec }); recompute(); render(); toast("Re-ranked with your note"); }
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

  window.addEventListener("hashchange", async () => {
    const p = S.builtins.length && unlockFromLink();
    if (p) { $("#welcome").hidden = true; showLanding(false); await useProfile(p); render(); }
  });

  if (/[?&]debug=1/.test(location.search)) window.__fp = { S, parseQuery, matchQuery, render, pv, norm, mean, keywordPlan, loadKeywordParts, searchFor, understand, fillPlan, renderEdit, pieceQuery, landingSearch, runSearch }; // for automated tests

  // ---------- boot ----------
  (async function boot() {
    try {
      const [vibes, brands, index, pbuf] = await Promise.all([
        ...["vibes.json", "brands.json", "profiles/index.json"].map(getJSON), getBin("projection.bin")]);
      S.proj = new Float32Array(pbuf); S.k = S.proj.length / 512;
      // each style has a vector per department ("Old money" looks different in menswear and womenswear)
      const vlist = Array.isArray(vibes) ? vibes : vibes.vibes;
      S.vibeGroups = (!Array.isArray(vibes) && vibes.groups) || [];
      S.vibes = vlist.map((v) => {
        const vecs = {};
        if (v.vecs) for (const [d, x] of Object.entries(v.vecs)) vecs[d] = pv(x); else vecs.any = pv(v.vec);
        if (!vecs.any) vecs.any = norm(mean(Object.values(vecs)));
        const o = { ...v, vecs, top: v.top || {} };
        Object.defineProperty(o, "vec", { get() { return this.vecs[vibeDept()] || this.vecs.any; } });
        return o;
      });
      for (const v of S.vibes) S.vibeById[v.id] = v;
      S.generic = (await getJSON("generic.json").catch(() => [])).map(pv);
      S.shards = await getJSON("shards.json").catch(() => ({}));
      for (const b of brands) S.brandInfo[b.name] = b;
      S.brands = brands;
      S.brandStats = await getJSON("brand_stats.json").catch(() => ({}));
      S.refiners = (await getJSON("refiners.json").catch(() => [])).map((r) => ({ ...r, vec: pv(r.vec) }));
      for (const r of S.refiners) S.refinerById[r.id] = r;
      S.live = await getJSON("live.json").catch(() => null);
      S.builtins = await Promise.all(index.map((id) => getJSON(`profiles/${id}.json`)));
      loadStore();
      const unlocked = unlockFromLink();
      const last = unlocked || (S.lastId && S.profiles[S.lastId]);
      if (last && last.setupDone) { await useProfile(last); render(); } else openLanding();
    } catch (err) {
      console.error(err);
      $("#intro").innerHTML = `<h1>No data yet</h1><p>The daily collector hasn't run yet (${esc(err.message)}).</p>`;
    }
  })();
})();
