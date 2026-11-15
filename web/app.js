/* FashionPlace web app — no build step, no framework.
 * Ranking happens here in the browser: every product photo and every taste description
 * is a vector on the same "style map" (made by collector/embed.py). Likes/dislikes nudge
 * your taste vector, so the feed sharpens as you use it. */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const state = {
    tab: "foryou", category: "all", underIdeal: false, surprise: 0.4,
    items: [], vecs: [], profile: null, fb: { liked: [], disliked: [] },
  };

  // ---------- storage (per profile, may be unavailable) ----------
  const key = () => `fp:feedback:${state.profile.id}`;
  function loadFeedback() {
    try { state.fb = JSON.parse(localStorage.getItem(key())) || { liked: [], disliked: [] }; }
    catch { state.fb = { liked: [], disliked: [] }; }
  }
  function saveFeedback() { try { localStorage.setItem(key(), JSON.stringify(state.fb)); } catch {} }

  // ---------- vector maths ----------
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const norm = (a) => { const n = Math.hypot(...a) || 1; return a.map((x) => x / n); };
  const add = (a, b, w = 1) => a.map((x, i) => x + w * b[i]);
  const mean = (rows) => rows.length ? rows.reduce((acc, r) => add(acc, r), new Array(rows[0].length).fill(0)).map((x) => x / rows.length) : null;

  function decodeVectors(v) {
    const bin = atob(v.data), q = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) q[i] = (bin.charCodeAt(i) << 24) >> 24;
    const rows = {};
    v.ids.forEach((id, r) => {
      const row = Array.from(q.subarray(r * v.dim, (r + 1) * v.dim), (x) => (x / 127) * v.scale);
      rows[id] = norm(row);
    });
    return rows;
  }

  // ---------- data ----------
  async function getJSON(path) {
    if (window.FP_DATA && window.FP_DATA[path]) return window.FP_DATA[path];
    const r = await fetch(`data/${path}`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }

  async function loadProfile(id) {
    state.profile = await getJSON(`profiles/${id}.json`);
    loadFeedback();
    $("#underIdealLabel").textContent = `Under £${state.profile.budget.ideal_max_gbp}`;
  }

  // ---------- scoring ----------
  function tasteVector() {
    const p = state.profile;
    let t = p.taste.slice();
    const liked = mean(state.fb.liked.map((id) => state.vecs[id]).filter(Boolean));
    const disliked = mean(state.fb.disliked.map((id) => state.vecs[id]).filter(Boolean));
    if (liked) t = add(t, liked, Math.min(1.2, 0.35 * state.fb.liked.length));
    if (disliked) t = add(t, disliked, -Math.min(0.8, 0.25 * state.fb.disliked.length));
    return norm(t);
  }

  function eligible(it) {
    const p = state.profile;
    if (it.department !== "unisex" && it.department !== p.department) return false;
    if (!it.in_stock || it.size_m_available === false) return false;
    if (it.category === "underwear") return false; // basics, gift cards etc. — not what the feed is for
    if (it.price_gbp > p.budget.hard_max_gbp) return false;
    if (state.underIdeal && it.price_gbp > p.budget.ideal_max_gbp) return false;
    if (state.category !== "all" && it.category !== state.category) return false;
    return !!state.vecs[it.id];
  }

  function score(it, taste) {
    const p = state.profile, v = state.vecs[it.id];
    let s = dot(v, taste) - 0.35 * dot(v, p.avoid);
    const { ideal_max_gbp: ideal, hard_max_gbp: hard } = p.budget;
    if (it.price_gbp > ideal) s -= 0.04 * (it.price_gbp - ideal) / (hard - ideal); // £200–300 must earn its place
    return s;
  }

  function reason(it, taste, mode) {
    const v = state.vecs[it.id];
    // nearest thing you've liked
    let best = null, bestSim = 0.82;
    for (const id of state.fb.liked) {
      const lv = state.vecs[id]; if (!lv || id === it.id) continue;
      const s = dot(v, lv); if (s > bestSim) { bestSim = s; best = id; }
    }
    if (best) {
      const liked = state.items.find((x) => x.id === best);
      if (liked) return `Close to the ${liked.title.split(" - ")[0]} you liked`;
    }
    const facets = state.profile.facets.map((f) => [f.label, dot(v, f.vec)]).sort((a, b) => b[1] - a[1]);
    const top = facets[0][0].replace(/^(a|an) /, "");
    if (mode === "explore" && dot(v, state.profile.surprise) > dot(v, taste) * 0.9) return `Your ${shorten(top)}, with a bolder twist`;
    return `Matches: ${shorten(top)}`;
  }
  const shorten = (s) => s.split(",")[0].replace(/ menswear| men's/g, "").slice(0, 60);

  // pick in score order but don't let one brand take over the page
  function diversify(ranked, perBrandRun = 2) {
    const out = [], pool = ranked.slice();
    while (pool.length) {
      const recent = out.slice(-6).map((x) => x.it.brand);
      let idx = pool.findIndex((x) => recent.filter((b) => b === x.it.brand).length < perBrandRun);
      if (idx < 0) idx = 0;
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  function build() {
    const taste = tasteVector(), p = state.profile;
    const seen = new Set([...state.fb.liked, ...state.fb.disliked]);
    const base = state.items.filter(eligible).map((it) => ({ it, s: score(it, taste) }));

    if (state.tab === "saved") {
      return state.fb.liked.map((id) => state.items.find((x) => x.id === id)).filter(Boolean)
        .map((it) => ({ it, s: 0, why: "Saved" }));
    }
    if (state.tab === "deals") {
      const ranked = base.filter((x) => x.it.deal && x.it.deal.verdict && x.it.deal.verdict !== "always_on_sale")
        .sort((a, b) => b.s - a.s);
      const cutoff = quantile(base.map((x) => x.s), 0.35); // only deals that are actually your taste
      return ranked.filter((x) => x.s >= cutoff).map((x) => ({ ...x, why: reason(x.it, taste, "deals") }));
    }
    if (state.tab === "explore") {
      const k = state.surprise;
      const floor = quantile(base.map((x) => x.s), 0.55 - 0.35 * k); // stay near your taste, loosen as k grows
      // the 12 closest matches already live in For You — Explore starts just beyond them
      const top = new Set(base.slice().sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.it.id));
      const ranked = base.filter((x) => x.s >= floor && !seen.has(x.it.id) && !top.has(x.it.id)).map((x) => {
        const v = state.vecs[x.it.id];
        const novelty = x.it.favourite_brand ? 0 : 0.06;          // brands you don't know yet
        const twist = dot(v, p.surprise);                           // colour / texture / vintage character
        return { ...x, e: (1 - k) * x.s + k * twist + novelty };
      }).sort((a, b) => b.e - a.e);
      return diversify(ranked, 1).map((x) => ({ ...x, why: reason(x.it, taste, "explore") }));
    }
    const ranked = base.filter((x) => !state.fb.disliked.includes(x.it.id)).sort((a, b) => b.s - a.s);
    return diversify(ranked).map((x) => ({ ...x, why: reason(x.it, taste, "foryou") }));
  }

  function quantile(arr, q) {
    if (!arr.length) return -Infinity;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.max(0, Math.min(s.length - 1, Math.floor(q * s.length)))];
  }

  // ---------- render ----------
  const INTROS = {
    foryou: ["For You", "Every brand, one feed, ranked by your taste. Like or pass and it learns."],
    explore: ["Explore", "Close to your taste, one step outside it — mostly from labels you haven't met yet."],
    deals: ["Deals", "Discounts on pieces that are actually you. We check the price history, so fake 'sales' don't make it here."],
    saved: ["Saved", "Everything you've liked."],
  };
  const money = (n) => `£${Math.round(n)}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tint = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 22% 82%)`; };

  function badges(it) {
    const b = [], d = it.deal || {};
    if (d.verdict === "real_drop") b.push(`<span class="badge deal">Price drop −${d.discount_pct}%</span>`);
    else if (d.verdict === "on_sale_unverified") b.push(`<span class="badge deal">Sale −${d.discount_pct}%</span>`);
    if (d.verdict === "always_on_sale" && state.tab === "deals") b.push(`<span class="badge warn">Always 'on sale'</span>`);
    if (d.is_lowest_price && d.tracked_days >= 14 && d.verdict) b.push(`<span class="badge">Lowest we've seen</span>`);
    if (!it.favourite_brand && state.tab === "explore") b.push(`<span class="badge new">New brand to you</span>`);
    return b.join("");
  }

  function card({ it, why }) {
    const liked = state.fb.liked.includes(it.id);
    const ph = `<div class="ph" style="background:${tint(it.title)}">${esc(it.title.split(" - ")[0])}</div>`;
    return `<article class="card" data-id="${esc(it.id)}">
      <div class="photo">
        ${ph}
        ${it.image ? `<img src="${esc(it.image)}" alt="${esc(it.title)}" loading="lazy" onerror="this.remove()">` : ""}
        <div class="badges">${badges(it)}</div>
        <div class="actions ${liked ? "keep" : ""}">
          <button data-act="pass" title="Not for me">✕</button>
          <button data-act="like" class="${liked ? "liked" : ""}" title="Love it">♥</button>
        </div>
      </div>
      <div class="meta">
        <div class="b">${esc(it.brand)}</div>
        <div class="t"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></div>
        <div class="price">${money(it.price_gbp)}${it.compare_at_gbp ? `<s>${money(it.compare_at_gbp)}</s>` : ""}</div>
        ${why && why !== "Saved" ? `<div class="why">${esc(why)}</div>` : ""}
      </div>
    </article>`;
  }

  function renderChips() {
    const cats = ["all", ...new Set(state.items.filter((i) => i.department !== "women").map((i) => i.category))]
      .filter((c) => c !== "other" && c !== "underwear");
    $("#chips").innerHTML = cats.map((c) =>
      `<button class="chip ${c === state.category ? "on" : ""}" data-cat="${c}">${c === "tshirts" ? "T-shirts" : c}</button>`).join("");
  }

  function render() {
    const [h, p] = INTROS[state.tab];
    $("#intro").innerHTML = `<h1>${h}</h1><p>${p}</p>`;
    $("#surpriseWrap").hidden = state.tab !== "explore";
    $("#controls").hidden = state.tab === "saved";
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
    $("#savedCount").textContent = state.fb.liked.length || "";
    renderChips();
    const list = build().slice(0, 120);
    $("#grid").innerHTML = list.map(card).join("");
    $("#empty").hidden = list.length > 0;
    $("#empty").textContent = state.tab === "saved" ? "Nothing saved yet — tap ♥ on anything you love." : "Nothing here with these filters.";
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) { state.tab = tab.dataset.tab; render(); window.scrollTo({ top: 0 }); return; }
    const chip = e.target.closest("[data-cat]");
    if (chip) { state.category = chip.dataset.cat; render(); return; }
    const act = e.target.closest("[data-act]");
    if (act) {
      const id = act.closest(".card").dataset.id, fb = state.fb;
      fb.liked = fb.liked.filter((x) => x !== id); fb.disliked = fb.disliked.filter((x) => x !== id);
      if (act.dataset.act === "like" && !act.classList.contains("liked")) fb.liked.unshift(id);
      if (act.dataset.act === "pass") fb.disliked.push(id);
      saveFeedback(); render();
    }
  });
  $("#underIdeal").addEventListener("change", (e) => { state.underIdeal = e.target.checked; render(); });
  let t; $("#surprise").addEventListener("input", (e) => {
    state.surprise = e.target.value / 100; clearTimeout(t); t = setTimeout(render, 80);
  });
  $("#profilePick").addEventListener("change", async (e) => { await loadProfile(e.target.value); render(); });

  // ---------- boot ----------
  (async function boot() {
    try {
      const [items, vectors, profiles] = await Promise.all([getJSON("items.json"), getJSON("vectors.json"), getJSON("profiles/index.json")]);
      state.items = items.items;
      state.vecs = decodeVectors(vectors);
      $("#profilePick").innerHTML = profiles.map((p) => `<option value="${p}">${p[0].toUpperCase() + p.slice(1)}</option>`).join("");
      await loadProfile(profiles[0]);
      const brands = new Set(state.items.map((i) => i.brand)).size;
      $("#foot").textContent = `${state.items.length} pieces from ${brands} brands · updated ${items.updated}` +
        (vectors.model === "fake" ? " · demo data" : "");
      render();
    } catch (err) {
      $("#intro").innerHTML = `<h1>No data yet</h1><p>The daily collector hasn't run yet (${esc(err.message)}).</p>`;
    }
  })();
})();
