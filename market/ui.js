'use strict';

// Neon Tycoon screens: tabs, slide-up sheets, charts, saving and friend challenges.
(() => {
  const T = window.NeonTycoon;
  const $ = (id) => document.getElementById(id);
  const SAVE = 'neonTycoon.save';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
  const compact = (n) => {
    const a = Math.abs(n), sign = n < 0 ? '-' : '';
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
    if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(1)}k`;
    return money(n);
  };
  const price2 = (n) => (n >= 100 ? money(n) : '$' + n.toFixed(2));
  const COLORS = { you: '#1098b5', friend: '#d8742c' };

  let s = null;          // game state
  let tab = 'market';
  let pendingChallenge = null;
  const playerName = () => store.get('neonDash.name', '') || 'You';
  const youLabel = () => (playerName() === 'You' ? 'You' : `${playerName()} (you)`);
  const playerLook = () => Object.assign({ outfit: 'classic', skin: 2, hair: 'short', hairColor: 0 }, store.get('neonDash.look', {}));

  let visiting = null; // a friend's shop you're looking round: nothing is saved
  function save() { if (s && !visiting) store.set(SAVE, s); }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.add('hidden'), 2400);
  }
  const result = (r, okMsg) => { if (!r.ok) toast(r.msg); else if (okMsg) toast(okMsg); save(); render(); return r.ok; };

  // ---------- charts ----------
  function sizeCanvas(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }
  function spark(cv, data, color = COLORS.you) {
    const { ctx, w, h } = sizeCanvas(cv);
    if (data.length < 2) return;
    const lo = Math.min(...data), hi = Math.max(...data), span = hi - lo || 1;
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    data.forEach((v, i) => { const x = (i / (data.length - 1)) * (w - 4) + 2, y = h - 3 - ((v - lo) / span) * (h - 6); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
  // Line chart with a crosshair + tooltip. series: [{ data, color, label }], xs: x labels per index.
  function lineChart(cv, series, xs, fmt) {
    const draw = (hover) => {
      const { ctx, w, h } = sizeCanvas(cv);
      const pad = { l: 8, r: 52, t: 12, b: 20 };
      const all = series.flatMap((sr) => sr.data.filter((v) => v !== null));
      if (!all.length) return;
      let lo = Math.min(...all), hi = Math.max(...all);
      if (lo === hi) { lo -= 1; hi += 1; }
      const n = Math.max(...series.map((sr) => sr.data.length));
      const X = (i) => pad.l + (n > 1 ? (i / (n - 1)) * (w - pad.l - pad.r) : 0);
      const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
      // recessive grid: 3 lines with values on the right
      ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
      for (let k = 0; k <= 2; k++) {
        const v = lo + ((hi - lo) * k) / 2, y = Y(v);
        ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText(fmt(v), w - pad.r + 6, y);
      }
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fillText(xs[0], pad.l, h - 5);
      ctx.textAlign = 'right'; ctx.fillText(xs[n - 1], w - pad.r, h - 5); ctx.textAlign = 'left';
      for (const sr of series) {
        ctx.strokeStyle = sr.color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
        ctx.beginPath();
        let started = false;
        sr.data.forEach((v, i) => { if (v === null) return; started ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); started = true; });
        ctx.stroke();
        // direct label at the line end when there is more than one series
        if (series.length > 1) {
          let last = sr.data.length - 1; while (last > 0 && sr.data[last] === null) last--;
          ctx.fillStyle = '#fff'; ctx.font = '700 11px system-ui, sans-serif';
          ctx.fillText(sr.label, Math.min(X(last) + 4, w - pad.r - 30), Y(sr.data[last]) - 6);
        }
      }
      if (hover !== null) {
        const i = hover, x = X(i);
        ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
        const lines = [xs[i]];
        for (const sr of series) {
          const v = sr.data[i]; if (v === null || v === undefined) continue;
          ctx.fillStyle = sr.color; ctx.strokeStyle = '#12052a'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, Y(v), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          lines.push(`${series.length > 1 ? sr.label + ': ' : ''}${fmt(v)}`);
        }
        ctx.font = '700 12px system-ui, sans-serif';
        const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16, th = lines.length * 16 + 8;
        const tx = Math.min(Math.max(x - tw / 2, 2), w - tw - 2);
        ctx.fillStyle = 'rgba(11,2,33,.92)'; ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1;
        ctx.fillRect(tx, 2, tw, th); ctx.strokeRect(tx, 2, tw, th);
        ctx.fillStyle = '#fff';
        lines.forEach((l, k) => ctx.fillText(l, tx + 8, 18 + k * 16));
      }
      cv._geom = { X, n, pad, w };
    };
    const at = (e) => {
      const g = cv._geom; if (!g) return null;
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left;
      return Math.max(0, Math.min(g.n - 1, Math.round(((x - g.pad.l) / (g.w - g.pad.l - g.pad.r)) * (g.n - 1))));
    };
    cv.onpointermove = (e) => draw(at(e));
    cv.onpointerdown = (e) => draw(at(e));
    cv.onpointerleave = () => draw(null);
    draw(null);
  }
  const dayLabels = (count, endDay) => Array.from({ length: count }, (_, i) => `Day ${endDay - count + 1 + i}`);

  // ---------- top bar & tabs ----------
  function ghostAt(day) {
    const c = s.challenge;
    if (!c) return null;
    // curve holds net worth every 10 days from day 1 (index 0); interpolate between points
    const f = (day - 1) / 10, i = Math.floor(f);
    if (i >= c.curve.length - 1) return c.curve[c.curve.length - 1];
    return c.curve[i] + (c.curve[i + 1] - c.curve[i]) * (f - i);
  }

  function renderTop() {
    const nw = T.netWorth(s);
    $('day').textContent = `${Math.min(s.day, T.SEASON_DAYS)}/${T.SEASON_DAYS}`;
    $('nw').textContent = compact(nw);
    $('cash').textContent = compact(s.cash);
    const g = ghostAt(s.day);
    if (g === null) $('vsGhost').textContent = '';
    else {
      const d = nw - g;
      $('vsGhost').innerHTML = `${d >= 0 ? '<span class="up">▲</span>' : '<span class="down">▼</span>'} ${compact(Math.abs(d))} vs ${esc(s.challenge.name)}`;
    }
    const D = T.D[s.district];
    $('where').textContent = `📍 ${D.icon} ${D.name}`;
  }

  function render() {
    if (!s) return;
    renderTop();
    for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
    const p = $('panel');
    p.innerHTML = { market: marketHtml, business: businessHtml, exchange: exchangeHtml, bank: bankHtml, stats: statsHtml }[tab]();
    // draw any sparklines / charts the tab placed
    for (const cv of p.querySelectorAll('canvas.spark')) {
      const [kind, id] = cv.dataset.spark.split(':');
      const data = kind === 'g' ? s.hist.prices[s.district][id].slice(-14) : s.hist.stocks[id].slice(-14);
      spark(cv, data);
    }
    if (tab === 'stats') drawNetWorthChart($('nwChart'));
    $('endDayBtn').textContent = s.finished ? 'See results ▸' : 'End day ▸';
  }

  const change = (arr) => {
    if (arr.length < 2) return '<small class="muted">new</small>';
    const a = arr[arr.length - 2], b = arr[arr.length - 1], pct = ((b - a) / a) * 100;
    if (Math.abs(pct) < 0.05) return '<small class="muted">● 0.0%</small>';
    return pct > 0 ? `<small class="up">▲ ${pct.toFixed(1)}%</small>` : `<small class="down">▼ ${Math.abs(pct).toFixed(1)}%</small>`;
  };

  // today's weather and holiday, and tomorrow's forecast (with what it does to demand)
  function forecastHtml() {
    const eff = (id) => Object.entries(T.WEATHER_GOODS[id]).map(([g, m]) => `${T.G[g].icon}${m > 1 ? '▲' : '▼'}${Math.round(Math.abs(m - 1) * 100)}%`).join(' ');
    const today = T.weather(s), next = T.forecast(s).id, hol = T.holiday(s.day), hol2 = T.holiday(s.day + 1), sea = T.season(s.day);
    return `<div class="forecast"><div><b>${T.WEATHER[today].icon} Today</b><span>${T.WEATHER[today].name} ${eff(today)}${hol ? ` · ${hol.icon} ${esc(hol.name)}` : ` · ${sea.icon} ${sea.name}`}</span></div>
      <div><b>${T.WEATHER[next].icon} Tomorrow</b><span>${T.WEATHER[next].name} ${eff(next)}${hol2 && hol2 !== hol ? ` · ${hol2.icon} ${esc(hol2.name)} starts` : ''}</span></div></div>`;
  }

  // ---------- your brand: a name, two colours and a logo, on your own-label packs ----------
  function openBrand() {
    const cur = s.brand || { name: (playerName() === 'You' ? 'NEON' : playerName()).toUpperCase().slice(0, 10), a: '#ff2a6d', b: '#ffd23f', logo: '⚡' }, d = Object.assign({}, cur);
    const SW = ['#ff2a6d', '#ffd23f', '#05d9e8', '#9b5de5', '#22c55e', '#ff7a00', '#0b0221', '#ffffff', '#3b82f6', '#e11d48'], LOGOS = ['⚡', '🔥', '⭐', '💎', '🌙', '🍀', '👑', '🎯', '🦄', '🐉'];
    openSheet(`<h2>🏷️ ${s.brand ? 'Your brand' : 'Launch your brand'}<button class="close" data-close>✕</button></h2>
      <p class="muted">Own-label packs cost ${Math.round((1 - T.LABEL_COST) * 100)}% less to buy in and show your design on the shelves. The brand's name grows with good days at your own-label shops.${s.brand ? ` Brand standing: <b>${Math.round(s.brand.rep)}/100</b>.` : ` Launching costs ${money(T.BRAND_COST)}.`}</p>
      <canvas id="brandPrev" class="brandprev" aria-label="Your pack design"></canvas>
      <p class="section-title">Name</p><input id="brandName" class="brandname" maxlength="12" value="${esc(d.name)}">
      <p class="section-title">Main colour</p><div class="swatches" id="swA">${SW.map((c) => `<button data-c="${c}" style="background:${c}"></button>`).join('')}</div>
      <p class="section-title">Second colour</p><div class="swatches" id="swB">${SW.map((c) => `<button data-c="${c}" style="background:${c}"></button>`).join('')}</div>
      <p class="section-title">Logo</p><div class="linechips" id="swL">${LOGOS.map((l) => `<button data-l="${l}">${l}</button>`).join('')}</div>
      <div class="btns"><button class="btn primary" id="brandGo">${s.brand ? 'Save design' : `🚀 Launch · ${money(T.BRAND_COST)}`}</button></div>`);
    const prev = () => {
      for (const el of document.querySelectorAll('#swA button')) el.classList.toggle('on', el.dataset.c === d.a);
      for (const el of document.querySelectorAll('#swB button')) el.classList.toggle('on', el.dataset.c === d.b);
      for (const el of document.querySelectorAll('#swL button')) el.classList.toggle('on', el.dataset.l === d.logo);
      const cv = $('brandPrev'), dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      window.NeonShopArt.setBrand(d);
      const goods = ['drinks', 'noodles', 'coffee', 'sneakers', 'holo'];
      goods.forEach((gd, i) => window.NeonShopArt.pack(g, gd, W * (0.12 + i * 0.19), H * 0.88, H * 0.5, i % 3, dpr));
      window.NeonShopArt.setBrand(null);
    };
    $('brandName').oninput = () => { d.name = $('brandName').value.toUpperCase().slice(0, 12) || 'NEON'; prev(); };
    $('swA').onclick = (e) => { const el = e.target.closest('[data-c]'); if (el) { d.a = el.dataset.c; prev(); } };
    $('swB').onclick = (e) => { const el = e.target.closest('[data-c]'); if (el) { d.b = el.dataset.c; prev(); } };
    $('swL').onclick = (e) => { const el = e.target.closest('[data-l]'); if (el) { d.logo = el.dataset.l; prev(); } };
    $('brandGo').onclick = () => { if (result(T.makeBrand(s, d), s.brand ? '🏷️ Design saved' : `🚀 ${d.name} launched! Turn on own label in 🏗️ Grow`)) closeSheet(); };
    prev();
  }

  // ---------- logistics: trucks on routes between your warehouses, workshops and shops ----------
  function openLogistics() {
    const stops = Object.keys(s.warehouses || {}).map((d) => `wh:${d}`).concat(s.businesses.map((b) => `biz:${b.id}`));
    const routes = s.routes || [], free = (s.trucks || 0) - routes.length;
    openSheet(`<h2>🚚 Logistics<button class="close" data-close>✕</button></h2>
      <p class="muted">Trucks move goods on their own: from a workshop or warehouse to a warehouse or shop, every few days. Each truck costs ${money(T.TRUCK.cost)} and ${money(T.TRUCK.daily)}/day in fuel and a driver, and carries up to ${T.TRUCK.cap}.</p>
      <p>🚚 ${s.trucks || 0} truck${s.trucks === 1 ? '' : 's'} · ${routes.length} on a route</p>
      ${routes.map((r) => `<div class="row"><span class="ic">${T.G[r.good].icon}</span><span class="nm"><b>${r.qty} ${T.G[r.good].name} every ${r.every === 1 ? 'day' : `${r.every} days`}</b><small>${esc(T.stopName(s, r.from))} → ${esc(T.stopName(s, r.to))}${r.last ? ` · last run: ${esc(r.last)}` : ''}</small></span><span class="px"><button class="btn danger" data-droute="${r.id}">Stop</button></span></div>`).join('') || '<p class="muted">No routes yet.</p>'}
      <div class="btns"><button class="btn" id="buyTruck">🚚 Buy a truck · ${money(T.TRUCK.cost)}</button></div>
      ${free > 0 && stops.length > 1 ? `<p class="section-title">New route</p>
        <div class="routeform"><label>From<select id="rFrom">${stops.map((k) => `<option value="${k}">${esc(T.stopName(s, k))}</option>`).join('')}</select></label>
        <label>To<select id="rTo">${stops.map((k, i) => `<option value="${k}"${i === 1 ? ' selected' : ''}>${esc(T.stopName(s, k))}</option>`).join('')}</select></label>
        <label>Goods<select id="rGood">${T.GOODS.map((g) => `<option value="${g.id}">${g.icon} ${g.name}</option>`).join('')}</select></label>
        <label>How many<input id="rQty" type="number" min="1" max="${T.TRUCK.cap}" value="100"></label>
        <label>Every<select id="rEvery">${[1, 2, 3, 5, 7].map((n) => `<option value="${n}">${n === 1 ? 'day' : `${n} days`}</option>`).join('')}</select></label></div>
        <div class="btns"><button class="btn primary" id="addRoute">➕ Start the route</button></div>` : free > 0 ? '<p class="muted">You need at least two places (warehouses, workshops or shops) for a route.</p>' : ''}`);
    $('buyTruck').onclick = () => { if (result(T.buyTruck(s), '🚚 A new truck!')) openLogistics(); };
    for (const el of document.querySelectorAll('[data-droute]')) el.onclick = () => { T.dropRoute(s, +el.dataset.droute); save(); openLogistics(); };
    if ($('addRoute')) {
      const fit = () => { const st = T.stopOf(s, $('rFrom').value); if (st && st.b) $('rGood').value = st.b.good; };
      $('rFrom').onchange = fit; fit();
      $('addRoute').onclick = () => { if (result(T.addRoute(s, $('rFrom').value, $('rTo').value, $('rGood').value, +$('rQty').value, +$('rEvery').value), '🚚 Route started: it runs overnight')) openLogistics(); };
    }
  }

  // ---------- the chain dashboard: every shop at once ----------
  function openDashboard() {
    const stalls = s.businesses.filter((b) => b.kind === 'stall');
    const row = (b) => {
      const hold = T.holdOf(b), low = b.stock < hold * 0.3, G = T.G[b.good];
      return `<tr class="${low ? 'low' : ''}"><td>${G.icon} ${T.STALLS[b.tier].name}<br><small>${T.D[b.district].icon} ${esc(T.D[b.district].name)}</small></td>
        <td class="num">${b.stock}/${hold}${low ? ' ⚠️' : ''}</td><td class="num">${Math.round((b.mult || T.RETAIL) * 100)}%<br><span class="mini2"><button data-dp="${b.id}:-1">−</button><button data-dp="${b.id}:1">+</button></span></td>
        <td class="num">${b.last ? money(b.last.revenue) : '–'}<br><small>${b.last ? `${b.last.sold} sold` : ''}</small></td><td class="num">${b.rating ? `${b.rating.toFixed(1)}★` : '–'}</td></tr>`;
    };
    const lows = stalls.filter((b) => b.stock < T.holdOf(b) * 0.3);
    openSheet(`<h2>📊 Chain dashboard<button class="close" data-close>✕</button></h2>
      <p class="muted">All ${stalls.length} shop${stalls.length === 1 ? '' : 's'} at a glance. ⚠️ means under 30% stocked.</p>
      <div class="dashwrap"><table class="dash"><thead><tr><th>Shop</th><th>Stock</th><th>Price</th><th>Last day</th><th>★</th></tr></thead><tbody>${stalls.map(row).join('')}</tbody></table></div>
      <p class="section-title">All shops at once</p>
      <div class="btns"><button class="btn" data-dall="-1">All prices −5%</button><button class="btn" data-dall="1">All prices +5%</button><button class="btn" data-dall="0">Reset to ${Math.round(T.RETAIL * 100)}%</button></div>
      <div class="btns">${lows.length ? `<button class="btn primary" data-dorder="express">⚡ Restock ${lows.length} low shop${lows.length > 1 ? 's' : ''} (fast)</button><button class="btn" data-dorder="budget">🐢 Restock them (cheap)</button>` : '<span class="muted">No shops are low on stock.</span>'}</div>`);
    for (const el of document.querySelectorAll('[data-dp]')) el.onclick = () => { const [id, d] = el.dataset.dp.split(':').map(Number), b = s.businesses.find((x) => x.id === id); T.setShelfPrice(s, id, Math.round(((b.mult || T.RETAIL) + d * 0.05) * 20) / 20); save(); openDashboard(); };
    for (const el of document.querySelectorAll('[data-dall]')) el.onclick = () => { const d = +el.dataset.dall; for (const b of stalls) T.setShelfPrice(s, b.id, d ? Math.round(((b.mult || T.RETAIL) + d * 0.05) * 20) / 20 : T.RETAIL); save(); render(); openDashboard(); };
    for (const el of document.querySelectorAll('[data-dorder]')) el.onclick = () => {
      let got = 0, cost = 0;
      for (const b of lows) { const r = T.orderStock(s, b.id, el.dataset.dorder, Math.ceil(T.holdOf(b) * 0.7 - b.stock)); if (r.ok) { got += r.got; cost += r.cost; } }
      save(); render(); toast(got ? `📦 Ordered ${got} items for ${money(cost)}` : 'Not enough cash for the orders'); openDashboard();
    };
  }

  // ---------- the warehouse in this district ----------
  function warehouseHtml() {
    const w = T.whOf(s), D = T.D[s.district];
    if (!w) return `<button class="row" data-act="whbuy"><span class="ic">🏬</span><span class="nm"><b>Rent storage space in ${esc(D.name)}</b><small>Keep up to ${T.WAREHOUSES[0].cap} goods here (no cargo space needed) and keep your shops in ${esc(D.name)} topped up every morning</small></span><span class="px"><b>${money(T.WAREHOUSES[0].cost)}</b></span></button>`;
    const t = T.WAREHOUSES[w.tier], used = T.whUsed(w), up = T.whUpgradeCost(w);
    const goods = Object.entries(w.goods).filter(([, q]) => q > 0);
    return `<div class="card"><h3>🏬 ${t.name} · ${esc(D.name)}<span class="muted num" style="margin-left:auto">${used}/${t.cap}</span></h3>
      <div class="bar"><i style="width:${Math.min(100, (used / t.cap) * 100)}%"></i></div>
      <p class="muted" style="margin-top:6px">Upkeep ${money(t.upkeep)}/day. ${w.auto ? 'Tops up your shops here every morning.' : 'Auto top-up is off.'} Buy straight into it from the 🛒 Market.</p>
      ${goods.length ? `<div class="whgoods">${goods.map(([g, q]) => `<div><span>${T.G[g].icon} ${T.G[g].name}</span><b class="num">${q}</b><button class="btn mini" data-act="whtake:${g}">To cargo</button></div>`).join('')}</div>` : '<p class="muted">Empty.</p>'}
      <div class="btns">${Object.keys(s.cargo).filter((g) => s.cargo[g] > 0).map((g) => `<button class="btn" data-act="whput:${g}">Store ${T.G[g].icon} ${s.cargo[g]}</button>`).join('')}
        <button class="btn${w.auto ? ' on' : ''}" data-act="whauto">🔁 Auto top-up: ${w.auto ? 'on' : 'off'}</button>
        ${up ? `<button class="btn primary" data-act="whup">Upgrade to ${T.WAREHOUSES[w.tier + 1].name} · ${money(up)}</button>` : ''}
        <button class="btn danger" data-act="whsell">Sell</button></div></div>`;
  }

  // ---------- grow a shop: expansions, owning the building, a side counter ----------
  function openGrow(b) {
    const e = T.expOf(b), G2 = b.side && T.G[b.side.good], price = T.buildingPrice(b);
    openSheet(`<h2>🏗️ Grow your ${esc(T.STALLS[b.tier].name.toLowerCase())}<button class="close" data-close>✕</button></h2>
      <p class="section-title">Make it bigger</p>
      <div class="pick">${Object.entries(T.EXPANSIONS).map(([k, x]) => { const c = T.expandCost(b, k); return `<button class="row" data-exp="${k}"${c === null ? ' disabled' : ''}><span class="ic">${x.icon}</span><span class="nm"><b>${x.name} ${'●'.repeat(e[k])}${'○'.repeat(x.costs.length - e[k])}</b><small>${esc(x.desc)}</small></span><span class="px"><b>${c === null ? '✓ Max' : money(c)}</b></span></button>`; }).join('')}</div>
      <p class="muted">Stockroom holds ${T.holdOf(b)} · ${T.staffSlots(b)} staff · ${e.floor ? `${e.floor} extra island${e.floor > 1 ? 's' : ''}` : 'no extra islands yet'}.</p>
      <p class="section-title">🏠 The building</p>
      ${b.owned ? `<div class="card"><p>You own it: worth about <b>${money(T.propertyValue(s, b))}</b>, no rent to pay.${b.owned.mortgage ? ` Mortgage: ${money(b.owned.mortgage.daily)}/day for ${b.owned.mortgage.left} more days (${money(T.mortgageLeft(b))} left).` : ' No mortgage.'}</p>
          ${b.tier >= 1 ? `<div class="btns"><button class="btn${b.sublet ? ' on' : ''}" id="growSublet">🛏️ Let the flat upstairs: ${b.sublet ? `on (+${money(T.subletIncome(b))}/day)` : 'off'}</button></div>` : '<p class="muted">Upgrade to a shop to let the flat upstairs.</p>'}</div>`
        : `<p class="muted">Rent is ${money(T.rentOf(b))}/day and goes up at lease reviews. Buy the building for ${money(price)}: no rent, it gains value, and you can let the flat upstairs.</p>
          <div class="btns"><button class="btn primary" id="growBuy"${s.cash < price ? ' disabled' : ''}>Buy it · ${money(price)}</button><button class="btn" id="growMortgage"${s.cash < price * T.MORTGAGE.down ? ' disabled' : ''}>Mortgage · ${money(price * T.MORTGAGE.down)} down, then ${money((price * (1 - T.MORTGAGE.down) * (1 + T.MORTGAGE.interest)) / T.MORTGAGE.days)}/day for ${T.MORTGAGE.days} days</button></div>`}
      <p class="section-title">🕘 Opening hours</p>
      <div class="decor">${Object.entries(T.HOURS).map(([k, h]) => `<button class="dec${(b.hours || 'day') === k ? ' on' : ''}" data-hours="${k}"><b>${h.icon} ${h.name}</b><small>${k === 'day' ? 'The usual day' : `+${Math.round((h.demand - 1) * 100)}% trade and 🦉 night owls · ${money(h.cost)}/day night crew · more break-ins`}</small></button>`).join('')}</div>
      <p class="section-title">🏷️ Own label</p>
      ${s.brand ? `<div class="btns"><button class="btn${b.ownLabel ? ' on' : ''}" id="growLabel">${esc(s.brand.logo)} Sell ${esc(s.brand.name)} ${esc(T.G[b.good].name)}: ${b.ownLabel ? 'on' : 'off'}</button></div><p class="muted">Your brand costs ${Math.round((1 - T.LABEL_COST) * 100)}% less to buy in. Shoppers trust it more as your brand's name grows (${Math.round(s.brand.rep)}/100).</p>`
        : '<p class="muted">Launch your own brand (🏷️ on the Business tab) to sell own-label products here.</p>'}
      <p class="section-title">🥡 Side counter: a second product</p>
      ${b.tier < 1 ? '<p class="muted">Upgrade to a shop to add a side counter by the till.</p>'
        : b.side ? `<div class="card"><p>Selling <b>${G2.icon} ${G2.name}</b> at ${price2(T.sidePrice(s, b))} · ${b.side.stock}/${T.sideCap(b)} on the counter. Shoppers add one at the till, and it sells on days you don't run the shop too.</p>
          <div class="btns">${b.district === s.district && s.cargo[b.side.good] ? `<button class="btn cyan" data-side="cargo">From cargo (${s.cargo[b.side.good]})</button>` : ''}${T.whOf(s, b.district) && T.whOf(s, b.district).goods[b.side.good] ? `<button class="btn cyan" data-side="wh">From warehouse (${T.whOf(s, b.district).goods[b.side.good]})</button>` : ''}<button class="btn" data-side="express">⚡ Order (${money(T.price(s, b.district, b.side.good) * T.SUPPLIERS.express.cost)} each)</button>${b.side.stock ? '' : '<button class="btn" id="sideChange">Change product</button>'}</div></div>`
        : `<p class="muted">Sell a second product from a counter by the till: shoppers add one as they pay. ${money(T.SIDE_COST)}.</p><div class="btns"><button class="btn primary" id="sideOpen"${s.cash < T.SIDE_COST ? ' disabled' : ''}>🥡 Add a side counter</button></div>`}`);
    for (const el of document.querySelectorAll('[data-hours]')) el.onclick = () => { T.setHours(s, b.id, el.dataset.hours); save(); openGrow(b); render(); };
    if ($('growLabel')) $('growLabel').onclick = () => { T.setOwnLabel(s, b.id, !b.ownLabel); save(); openGrow(b); render(); };
    for (const el of document.querySelectorAll('[data-exp]')) el.onclick = () => { if (result(T.expandShop(s, b.id, el.dataset.exp), `${T.EXPANSIONS[el.dataset.exp].icon} ${T.EXPANSIONS[el.dataset.exp].name} done!`)) { save(); openGrow(b); } };
    if ($('growBuy')) $('growBuy').onclick = () => { if (result(T.buyBuilding(s, b.id, false), '🏠 It\'s yours! No more rent')) { save(); openGrow(b); } };
    if ($('growMortgage')) $('growMortgage').onclick = () => { if (result(T.buyBuilding(s, b.id, true), '🏠 Bought with a mortgage')) { save(); openGrow(b); } };
    if ($('growSublet')) $('growSublet').onclick = () => { T.setSublet(s, b.id, !b.sublet); save(); openGrow(b); };
    const pickSide = () => openProductPicker('🥡 What will the side counter sell?', (g) => { if (result(T.openSide(s, b.id, g), `🥡 Side counter: ${T.G[g].name}`)) { save(); openGrow(b); } }, 'stall');
    if ($('sideOpen')) $('sideOpen').onclick = pickSide;
    if ($('sideChange')) $('sideChange').onclick = pickSide;
    for (const el of document.querySelectorAll('[data-side]')) el.onclick = () => { const r = T.stockSide(s, b.id, el.dataset.side); if (result(r, `🥡 ${r.q} on the side counter`)) { save(); openGrow(b); } };
  }

  // ---------- marketing: campaigns for a shop, and your NeonGram ----------
  function openMarketing(b) {
    const live = T.adsOf(s, b);
    openSheet(`<h2>📣 Marketing<button class="close" data-close>✕</button></h2>
      <p class="muted">Bring more shoppers to your ${esc(T.STALLS[b.tier].name.toLowerCase())} at ${esc(T.D[b.district].name)}. When a campaign ends, the news tells you how many extra sales it brought.</p>
      <div class="pick">${Object.entries(T.CAMPAIGNS).map(([k, c]) => { const on = live.find((a) => a.id === k); return `<button class="row" data-ad="${k}"${on ? ' disabled' : ''}><span class="ic">${c.icon}</span><span class="nm"><b>${c.name}</b><small>${esc(c.desc)}${on ? ` · running until day ${on.until}` : ''}</small></span><span class="px"><b>${on ? '✓ On' : money(T.campaignCost(b, k))}</b></span></button>`; }).join('')}</div>
      <p class="section-title">📸 NeonGram</p>
      <p>You have <b>${(s.followers || 0).toLocaleString()}</b> followers: ${Math.round((T.followerMod(s) - 1) * 100)}% more shoppers at every shop. Post a photo from 📷 photo mode in your shop (once a day per shop) to gain more; better-rated, nicely decorated shops get more likes.</p>`);
    for (const el of document.querySelectorAll('[data-ad]')) el.onclick = () => { if (result(T.runCampaign(s, b.id, el.dataset.ad), `${T.CAMPAIGNS[el.dataset.ad].icon} ${T.CAMPAIGNS[el.dataset.ad].name} running!`)) { save(); openMarketing(b); } };
  }

  // ---------- getting started: a checklist for a new season ----------
  function startHtml() {
    if (s.coachDone || s.day > 15) return '';
    const stall = s.businesses.find((b) => b.kind === 'stall');
    const steps = [
      [Object.keys(s.cargo).length > 0 || s.businesses.length > 0, 'Buy some goods: tap one in 🛒 Market'],
      [!!stall, 'Open a stall in 🏪 Business'],
      [s.businesses.some((b) => b.kind === 'stall' && (b.stock > 0 || (b.history && b.history.length))), 'Stock it: Restock from cargo'],
      [s.businesses.some((b) => b.history && b.history.length), 'Open shop and serve your first shoppers'],
      [s.day > 1, 'End the day and read the report'],
    ];
    if (steps.every(([d]) => d)) { s.coachDone = true; save(); setTimeout(() => toast('🎉 You\'ve got the basics. Now build an empire!'), 300); return ''; }
    const next = steps.findIndex(([d]) => !d);
    return `<div class="card start"><h3>🚀 Getting started<button class="btn mini" data-act="coachoff">Hide</button></h3>
      <ol>${steps.map(([d, t], i) => `<li class="${d ? 'done' : i === next ? 'now' : ''}">${d ? '✅' : i === next ? '👉' : '⬜'} ${t}</li>`).join('')}</ol></div>`;
  }

  // one-time tips when something new turns up
  function tipHtml() {
    const tips = [];
    const stalls = s.businesses.filter((b) => b.kind === 'stall');
    if (stalls.some((b) => T.rival(s, b))) tips.push(['rival', '🏪 A rival has opened over the road from your stall. Shoppers compare prices: 🤝 price match them, or a 💳 loyalty scheme (🛠️ Shop upgrades) keeps your regulars.']);
    if (stalls.length >= 2 && !stalls.some((b) => b.manager)) tips.push(['manager', '🧑‍💼 Running more than one shop? Hire a manager (👥 Staff) to reorder stock on the days you\'re not there.']);
    if (T.holiday(s.day)) tips.push(['holiday', `${T.holiday(s.day).icon} Holidays bring bigger crowds and change what sells. Check the forecast strip above for tomorrow's weather too.`]);
    const seen = store.get('neonTycoon.tips', {}), t = tips.find(([k]) => !seen[k]);
    return t ? `<div class="card hintcard"><p>💡 ${t[1]}</p><button class="btn mini" data-act="tipok:${t[0]}">Got it</button></div>` : '';
  }

  // ---------- Market ----------
  function marketHtml() {
    const used = T.cargoUsed(s), cap = T.cargoCap(s), V = T.VEHICLES[s.vehicle];
    let h = startHtml() + forecastHtml() + `<div class="card"><h3>🎒 ${V.name} <span class="muted num" style="margin-left:auto">${used}/${cap}</span></h3>
      <div class="bar"><i style="width:${Math.min(100, (used / cap) * 100)}%"></i></div>
      ${T.VEHICLES[s.vehicle + 1] ? `<div class="btns"><button class="btn" data-act="vehicle">Bigger ride: ${T.VEHICLES[s.vehicle + 1].name} (${T.VEHICLES[s.vehicle + 1].cap})</button></div>` : ''}</div>
      <p class="section-title">Prices in ${esc(T.D[s.district].name)} · tap to trade</p>`;
    for (const g of T.GOODS) {
      const hist = s.hist.prices[s.district][g.id], have = s.cargo[g.id] || 0;
      h += `<button class="row" data-act="good:${g.id}"><span class="ic">${g.icon}</span>
        <span class="nm"><b>${g.name}${have ? `<span class="badge">${have}</span>` : ''}</b><small>buy ${price2(T.buyPrice(s, s.district, g.id))} · sell ${price2(T.sellPrice(s, s.district, g.id))}</small></span>
        <canvas class="spark" data-spark="g:${g.id}" aria-hidden="true"></canvas>
        <span class="px"><b>${price2(T.price(s, s.district, g.id))}</b>${change(hist)}</span></button>`;
    }
    return h;
  }

  function qtyControl(id, max) {
    return `<div class="qty"><button class="btn" data-q="-10">−10</button><button class="btn" data-q="-1">−1</button>
      <input id="${id}" type="number" inputmode="numeric" min="0" value="${Math.min(max, 1)}"><button class="btn" data-q="1">+1</button><button class="btn" data-q="10">+10</button></div>`;
  }
  function bindQty(id, onChange) {
    const input = $(id);
    for (const b of input.parentElement.querySelectorAll('[data-q]')) {
      b.addEventListener('click', () => { input.value = Math.max(0, (parseInt(input.value, 10) || 0) + parseInt(b.dataset.q, 10)); onChange(); });
    }
    input.addEventListener('input', onChange);
    return () => Math.max(0, parseInt(input.value, 10) || 0);
  }

  function openGood(g) {
    const G = T.G[g];
    const others = T.DISTRICTS.map((d) => ({ d, p: s.hist.prices[d.id][g][s.hist.prices[d.id][g].length - (d.id === s.district ? 1 : 2)] ?? s.hist.prices[d.id][g].at(-1) }))
      .sort((a, b) => a.p - b.p);
    const hist = s.hist.prices[s.district][g];
    openSheet(`<h2>${G.icon} ${G.name}<button class="close" data-close>✕</button></h2>
      <p class="muted">In ${esc(T.D[s.district].name)}: buy ${price2(T.buyPrice(s, s.district, g))} · sell ${price2(T.sellPrice(s, s.district, g))} · you have <b>${s.cargo[g] || 0}</b></p>
      <canvas class="chart" id="gChart" aria-label="${G.name} price, last ${hist.length} days"></canvas>
      <p class="section-title">Yesterday's prices around the city</p>
      <div class="places">${others.map((o) => `<div class="${o.d.id === s.district ? 'here' : ''}"><span>${o.d.icon} ${o.d.name}${o.d.id === s.district ? ' (today)' : ''}</span><b class="num">${price2(o.p)}</b></div>`).join('')}</div>
      ${qtyControl('gQty', T.maxBuy(s, g))}
      <div class="btns"><button class="btn" id="gMaxBuy">Max buy (${T.maxBuy(s, g)})</button><button class="btn" id="gMaxSell">Sell all (${s.cargo[g] || 0})</button></div>
      <div class="trade"><button class="btn cyan" id="gBuy">Buy</button><button class="btn primary" id="gSell">Sell</button></div>
      ${T.whOf(s) ? `<div class="btns"><button class="btn" id="gWh">🏬 Buy into your warehouse (room for ${T.whRoom(T.whOf(s))})</button></div>` : ''}`);
    lineChart($('gChart'), [{ data: hist, color: COLORS.you, label: G.name }], dayLabels(hist.length, s.day), price2);
    const update = () => {
      const q = qty();
      $('gBuy').textContent = `Buy ${q} · ${money(T.quote(s, g, q, 'buy'))}`;
      $('gSell').textContent = `Sell ${Math.min(q, s.cargo[g] || 0)} · ${money(T.quote(s, g, Math.min(q, s.cargo[g] || 0), 'sell'))}`;
    };
    const qty = bindQty('gQty', update);
    $('gMaxBuy').onclick = () => { $('gQty').value = T.maxBuy(s, g); update(); };
    $('gMaxSell').onclick = () => { $('gQty').value = s.cargo[g] || 0; update(); };
    $('gBuy').onclick = () => { const q = qty(), r = T.buy(s, g, q); if (result(r, `Bought ${q} ${G.name} for ${money(r.cost || 0)}`)) openGood(g); };
    $('gSell').onclick = () => { const q = Math.min(qty(), s.cargo[g] || 0), r = T.sell(s, g, q); if (result(r, `Sold ${q} ${G.name} for ${money(r.got || 0)}`)) openGood(g); };
    if ($('gWh')) $('gWh').onclick = () => { const q = Math.min(qty() || T.maxBuyToWarehouse(s, g), T.maxBuyToWarehouse(s, g)), r = T.buyToWarehouse(s, g, q); if (result(r, `🏬 ${r.q || 0} ${G.name} into the warehouse for ${money(r.cost || 0)}`)) openGood(g); };
    update();
  }

  function openVehicle() {
    const next = T.VEHICLES[s.vehicle + 1];
    const cost = next.cost - T.VEHICLES[s.vehicle].cost * 0.5;
    openSheet(`<h2>🛵 Bigger ride<button class="close" data-close>✕</button></h2>
      <p>Trade your ${T.VEHICLES[s.vehicle].name} (${T.VEHICLES[s.vehicle].cap} slots) for a <b>${next.name}</b> with <b>${next.cap}</b> slots.</p>
      <p class="muted">Costs ${money(cost)} after trading in your old one.</p>
      <button class="btn primary" id="vBuy">Buy for ${money(cost)}</button>`);
    $('vBuy').onclick = () => { if (result(T.buyVehicle(s), `You now ride a ${next.name}!`)) closeSheet(); };
  }

  // ---------- Business ----------
  function bizLine(b) {
    const G = T.G[b.good], here = b.district === s.district;
    const tier = (b.kind === 'stall' ? T.STALLS : T.FACTORIES)[b.tier];
    let status;
    if (b.kind === 'stall') {
      status = `Stock ${b.stock}/${T.holdOf(b)} · sells about ${T.unitsPerDay(tier.cap, b.good)} a day · ${b.owned ? `🏠 you own it${b.owned.mortgage ? ` (mortgage ${money(b.owned.mortgage.daily)}/day)` : ''}` : `rent ${money(T.rentOf(b))}/day${b.leaseUntil ? ` (review day ${b.leaseUntil})` : ''}`}${b.contract ? ` · 📜 contract: ${b.contract.qty} every 2 days to day ${b.contract.until}` : ''}`;
      const mult = b.mult || T.RETAIL;
      status += `<br>Shelf price ${price2(T.shelfPrice(s, b))} (${Math.round(mult * 100)}% of wholesale) · ${Math.round(T.willingShare(mult) * 100)}% of shoppers will pay it`;
      if (b.rating) status += `<br><span class="stars">${starStr(b.rating)}</span> ${b.rating.toFixed(1)} from shoppers`;
      const fr = T.freshness(s, b);
      if (fr && (fr.reduced || fr.expiring)) status += `<br>🗓️ ${fr.reduced} near their sell-by date (half price)${fr.expiring ? ` · <b class="down">${fr.expiring} go off tonight</b>` : ''}`;
      else if (fr) status += `<br>🗓️ Keeps ${fr.life} days, oldest sells first`;
      const rv = T.rival(s, b);
      if (rv) status += `<br>🏪 ${esc(rv.name)} over the road sells at ${price2(T.price(s, b.district, b.good) * rv.mult)}${rv.sale ? ` <b class="down">(${rv.copied ? 'copying your promos: ' : ''}SALE!)</b>` : ''}${rv.fight >= 0.6 ? ' · 🥊 fighting you on price' : rv.fight >= 0.3 ? ' · 👀 watching your prices' : ''}${b.priceMatch ? ' · 🤝 you match their price' : ''}`;
      if (b.hours && b.hours !== 'day') status += `<br>${T.hoursOf(b).icon} ${T.hoursOf(b).name}: ${Math.round((T.hoursOf(b).demand - 1) * 100)}% more trade, ${money(T.hoursOf(b).cost)}/day night crew`;
      if (b.ownLabel && s.brand) status += `<br>🏷️ Own label: ${esc(s.brand.logo)} ${esc(s.brand.name)} (buys in ${Math.round((1 - T.LABEL_COST) * 100)}% cheaper · brand ${Math.round(s.brand.rep)}/100)`;
      if (b.closedDay === s.day) status += '<br><b class="down">🔧 Closed today for repairs</b>';
      if (b.side) status += `<br>🥡 Side counter: ${T.G[b.side.good].icon} ${b.side.stock} ${T.G[b.side.good].name}`;
      if (T.adsOf(s, b).length) status += `<br>📣 ${T.adsOf(s, b).map((a) => `${T.CAMPAIGNS[a.id].icon} ${T.CAMPAIGNS[a.id].name} to day ${a.until}`).join(' · ')}`;
      if (b.manager) { const ms = T.MANAGER_STYLES[b.manager.style]; status += `<br>${ms.icon} Manager ${esc(b.manager.name)} (level ${b.manager.level} ${ms.name}) runs it on days you don't${b.manager.last ? `: ${esc(b.manager.last)}` : ''}`; }
      const frs = friendReviews(b);
      if (frs.length) status += `<br>💌 Friends rate it <span class="stars">${starStr(frs.reduce((a, r) => a + r.stars, 0) / frs.length)}</span>: ${frs.slice(-2).map((r) => `${esc(r.from)}${r.text ? ` (“${esc(r.text)}”)` : ''}`).join(', ')}`;
      if (b.regulars && b.regulars.length) status += `<br>💳 ${b.regulars.length} regular${b.regulars.length > 1 ? 's' : ''} with stamp cards`;
      if (b.last && b.last.live) status += `<br>${b.servedDay === s.day ? 'Today' : 'Last time'} you served it yourself: sold ${b.last.sold} for ${money(b.last.revenue)}`;
      else if (b.last) status += `<br>Yesterday: sold ${b.last.sold} for ${money(b.last.revenue)}${b.stock === 0 ? ' · <b class="down">out of stock</b>' : ''}`;
    } else {
      status = `Makes ${T.unitsPerDay(tier.out, b.good)} a day at ${price2(G.base * T.PRODUCE_COST)} each · upkeep ${money(tier.upkeep)}/day · storage ${b.stock}/${T.storageCap(b)}`;
      if (b.last) status += `<br>Yesterday: made ${b.last.made} (cost ${money(b.last.cost)})`;
    }
    const up = T.upgradeCost(b);
    const nextName = (b.kind === 'stall' ? T.STALLS : T.FACTORIES)[b.tier + 1]?.name;
    return `<div class="card"><h3>${b.kind === 'stall' ? '🏪' : '🏭'} ${tier.name} · ${G.icon} ${G.name}<span class="muted" style="margin-left:auto;font-size:12px">${T.D[b.district].icon} ${T.D[b.district].name}</span></h3>
      <p>${status}</p>
      ${b.kind === 'stall' && b.rep ? `<p class="muted" style="margin-top:6px">💬 Word on the street</p><div class="repchips">${repChips(T.repOf(b))}</div>` : ''}
      ${b.kind === 'stall' && b.requests && b.requests.length ? `<p class="muted" style="margin-top:6px">📝 Orders: ${b.requests.map((q) => `${esc(q.name)} ${q.qty}× ${esc(NeonShop.plan.lineNames(b)[q.line] || '')} by day ${q.due}`).join(' · ')}. Run the shop that day so they can collect.</p>` : ''}
      ${here && b.kind === 'stall' && T.shopDayAvailable(s, b) ? `<button class="btn primary shopgo" data-act="shop:${b.id}">🏪 Open shop and serve today</button>` : ''}
      ${here && b.kind === 'stall' && b.servedDay === s.day ? '<p class="muted" style="margin-top:8px">You ran this shop today. Come back tomorrow.</p>' : ''}
      <div class="btns">
        ${b.kind === 'stall' ? `<button class="btn" data-act="price:${b.id}">💲 Set price</button>` : ''}
        ${b.kind === 'stall' ? `<button class="btn" data-act="supgs:${b.id}">🛠️ Shop upgrades${b.upgrades ? ` (${Object.keys(b.upgrades).length})` : ''}</button>` : ''}
        ${b.kind === 'stall' ? `<button class="btn" data-act="staff:${b.id}">👥 Staff (${T.staffOf(b).length}/${T.staffSlots(b)})${b.manager ? ' + 🧑‍💼' : ''}</button>` : ''}
        ${b.kind === 'stall' && T.rival(s, b) ? `<button class="btn${b.priceMatch ? ' on' : ''}" data-act="match:${b.id}">🤝 Price match: ${b.priceMatch ? 'on' : 'off'}</button>` : ''}
        ${b.kind === 'stall' ? `<button class="btn" data-act="supply:${b.id}">📦 Order stock</button>` : ''}
        ${b.kind === 'stall' ? `<button class="btn" data-act="arrange:${b.id}">🧱 Arrange shop</button>` : ''}
        ${b.kind === 'stall' && b.history && b.history.length ? `<button class="btn" data-act="report:${b.id}">📊 Report</button>` : ''}
        ${b.kind === 'stall' ? `<button class="btn" data-act="grow:${b.id}">🏗️ Grow${b.owned ? ' · 🏠' : ''}</button>` : ''}
        ${b.kind === 'stall' ? `<button class="btn" data-act="ads:${b.id}">📣 Marketing${T.adsOf(s, b).length ? ` (${T.adsOf(s, b).length} on)` : ''}</button>` : ''}
        ${b.kind === 'stall' ? `<button class="btn" data-act="shareshop:${b.id}">🔗 Share shop</button>` : ''}
        ${here && b.kind === 'stall' ? `<button class="btn cyan" data-act="restock:${b.id}">Restock from cargo (${s.cargo[b.good] || 0})</button>` : ''}
        ${here && b.stock > 0 ? `<button class="btn" data-act="collect:${b.id}">Load into cargo</button>` : ''}
        ${up ? `<button class="btn primary" data-act="upgrade:${b.id}">Upgrade to ${nextName} · ${money(up)}</button>` : ''}
        <button class="btn" data-act="product:${b.id}">Change product</button>
        <button class="btn danger" data-act="sellbiz:${b.id}">Sell</button>
      </div>
      ${!here && b.kind === 'stall' && b.stock === 0 && !s.businesses.some((f) => f.kind === 'factory' && f.district === b.district && f.good === b.good) ? `<p class="warn">Travel to ${T.D[b.district].name} to restock it, or build a workshop there making ${G.name}.</p>` : ''}
    </div>`;
  }

  function businessHtml() {
    const here = s.businesses.filter((b) => b.district === s.district), away = s.businesses.filter((b) => b.district !== s.district);
    let h = startHtml() + tipHtml() + forecastHtml() + `<div class="card"><h3>➕ Open a business in ${esc(T.D[s.district].name)}</h3>
      <p>A <b>stall</b> sells goods to shoppers every day at your shelf price, or open it and serve the shoppers yourself. A <b>workshop</b> makes goods for 40% of their usual price. Pair them on the same product in one district and the workshop keeps the stall stocked.</p>
      <div class="btns"><button class="btn primary" data-act="open:stall">🏪 Stall · ${money(T.STALLS[0].cost)}</button><button class="btn primary" data-act="open:factory">🏭 Workshop · ${money(T.FACTORIES[0].cost)}</button></div>
      <p class="warn">Workshops pay for what they make every day: keep cash on hand or they stop.</p></div>
      ${s.businesses.some((b) => b.kind === 'stall') ? `<div class="btns tight"><button class="btn" data-act="dashboard">📊 Chain dashboard</button><button class="btn" data-act="logistics">🚚 Logistics${(s.routes || []).length ? ` (${s.routes.length})` : ''}</button><button class="btn" data-act="brand">🏷️ ${s.brand ? `${esc(s.brand.logo)} ${esc(s.brand.name)}` : 'Your brand'}</button></div>` : ''}
      ${warehouseHtml()}
      <button class="row" data-act="decor"><span class="ic">🎨</span><span class="nm"><b>Decorate your shops</b><small>Floors, paint, signs, plants, music and uniforms, paid with arcade coins</small></span><span class="px"><b>🪙 ${store.get('neonDash.wallet', 0)}</b></span></button>`;
    if (here.length) h += `<p class="section-title">Here in ${esc(T.D[s.district].name)}</p>` + here.map(bizLine).join('');
    if (away.length) h += `<p class="section-title">Elsewhere</p>` + away.map(bizLine).join('');
    if (!s.businesses.length) h += '<p class="muted" style="text-align:center;padding:10px">You don\'t own any businesses yet.</p>';
    return h;
  }

  function openProductPicker(title, onPick, kind) {
    const tier = kind === 'stall' ? T.STALLS[0] : T.FACTORIES[0];
    openSheet(`<h2>${title}<button class="close" data-close>✕</button></h2>
      <div class="pick">${T.GOODS.map((g) => {
        const units = T.unitsPerDay(kind === 'stall' ? tier.cap : tier.out, g.id);
        const info = kind === 'stall' ? `sells about ${units}/day here at ~${price2(T.price(s, s.district, g.id) * T.RETAIL)}`
          : `makes ${units}/day at ${price2(g.base * T.PRODUCE_COST)} each (sells here for ~${price2(T.price(s, s.district, g.id))})`;
        return `<button class="row" data-pick="${g.id}"><span class="ic">${g.icon}</span><span class="nm"><b>${g.name}</b><small>${info}</small></span></button>`;
      }).join('')}</div>`);
    for (const b of document.querySelectorAll('[data-pick]')) b.onclick = () => onPick(b.dataset.pick);
  }

  const starStr = (n) => { const k = Math.round(n); return '★'.repeat(k) + '☆'.repeat(5 - k); };

  // shop upgrades, paid from your Tycoon cash
  function openUpgrades(b) {
    const ups = b.upgrades || {};
    openSheet(`<h2>🛠️ Shop upgrades<button class="close" data-close>✕</button></h2>
      <p class="muted">For your ${esc(T.STALLS[b.tier].name.toLowerCase())} at ${esc(T.D[b.district].name)}. Paid from your cash; they add to what the business is worth.</p>
      <div class="pick">${Object.entries(T.SHOP_UPGRADES).map(([k, u]) => `<button class="row" data-upg="${k}"${ups[k] ? ' disabled' : ''}><span class="ic">${u.icon}</span>
        <span class="nm"><b>${u.name}</b><small>${esc(u.desc)}</small></span><span class="px"><b>${ups[k] ? '✓ Installed' : money(u.cost)}</b></span></button>`).join('')}</div>`);
    for (const el of document.querySelectorAll('[data-upg]')) el.onclick = () => { if (result(T.buyShopUpgrade(s, b.id, el.dataset.upg), `${T.SHOP_UPGRADES[el.dataset.upg].name} installed!`)) openUpgrades(b); };
  }

  // hiring staff: skills, wages, morale
  function openStaff(b) {
    const staff = T.staffOf(b), slots = T.staffSlots(b), cands = T.candidates(s, b);
    const mood = (m) => (m >= 60 ? '😊' : m >= 30 ? '😐' : '😫');
    openSheet(`<h2>👥 Staff<button class="close" data-close>✕</button></h2>
      <p class="muted">${staff.length} of ${slots} jobs filled at your ${esc(T.STALLS[b.tier].name.toLowerCase())}. Wages are paid every day. Busy days wear people out: a $50 bonus cheers them up, and staff who are fed up may quit.</p>
      ${staff.map((m, i) => { const tr = T.TRAITS[T.traitOf(m)], lv = T.staffLevel(m), others = s.businesses.filter((x) => x.kind === 'stall' && x !== b && !x.manager); return `<div class="card staffcard"><div class="row"><span class="ic">${T.SKILLS[m.skill].icon}</span><span class="nm"><b>${esc(m.name)} · level ${lv}${m.sup ? ' · ⭐ Supervisor' : ''}</b>
        <small>${T.SKILLS[m.skill].name} · ${tr.icon} ${tr.name}: ${esc(tr.desc)} · ${money(m.wage)}/day · ${mood(m.morale)} morale ${m.morale}${lv < 5 ? ` · ${40 - ((m.xp || 0) % 40)} XP to level ${lv + 1}` : ''}</small></span></div>
        ${m.ask ? `<div class="returnrow"><span>💬 Wants a $${m.ask}/day raise</span><button class="btn" data-raise="${i}:1">✅ Yes</button><button class="btn danger" data-raise="${i}:0">✋ No</button></div>` : ''}
        ${m.strike === s.day + 1 || m.strike === s.day ? '<p class="warn">🪧 On strike: morale is too low. A bonus or a raise helps.</p>' : ''}
        <div class="btns"><button class="btn" data-bonus="${i}">🎁 $50</button>${!m.sup && lv >= 2 ? `<button class="btn" data-sup="${i}">⭐ Make supervisor (+$15/day)</button>` : ''}${lv >= 3 && others.length ? `<select class="btn" data-promo-to="${i}"><option value="">🧑‍💼 Make manager of…</option>${others.map((x) => `<option value="${x.id}">${T.G[x.good].icon} ${T.STALLS[x.tier].name} · ${T.D[x.district].name}</option>`).join('')}</select>` : ''}<button class="btn danger" data-fire="${i}">Let go</button></div></div>`; }).join('') || '<p class="muted">Nobody works here yet: you serve on your own.</p>'}
      <p class="section-title">Looking for work today</p>
      <div class="pick">${cands.map((c, i) => `<button class="row" data-hire="${i}"${staff.length >= slots || staff.some((m) => m.name === c.name) ? ' disabled' : ''}>
        <span class="ic">${T.SKILLS[c.skill].icon}</span><span class="nm"><b>${esc(c.name)}</b><small>${T.SKILLS[c.skill].name}: ${esc(T.SKILLS[c.skill].desc)}</small></span>
        <span class="px"><b>${money(c.wage)}/day</b></span></button>`).join('')}</div>
      ${staff.length >= slots ? `<p class="warn">Full up. ${T.expandCost(b, 'staff') !== null ? '🏗️ Grow → Staff room makes space for one more' : ''}${b.tier < 2 ? `${T.expandCost(b, 'staff') !== null ? ', or upgrade' : 'Upgrade for more room'}` : ''}.</p>` : ''}
      ${managerHtml(b)}`);
    if ($('mgTrain')) $('mgTrain').onclick = () => { if (result(T.trainManager(s, b.id), `🎓 ${b.manager && b.manager.name} is now level ${b.manager && b.manager.level}`)) { save(); openStaff(b); } };
    if ($('mgFire')) $('mgFire').onclick = () => { if (result(T.fireManager(s, b.id), 'Manager let go')) { save(); openStaff(b); } };
    for (const el of document.querySelectorAll('[data-mgr]')) el.onclick = () => { if (result(T.hireManager(s, b.id, +el.dataset.mgr), '🧑‍💼 Your new manager starts tomorrow')) { save(); openStaff(b); } };
    for (const el of document.querySelectorAll('[data-hire]')) el.onclick = () => { if (result(T.hire(s, b.id, +el.dataset.hire), 'Welcome to the team!')) openStaff(b); };
    for (const el of document.querySelectorAll('[data-bonus]')) el.onclick = () => { if (result(T.giveBonus(s, b.id, +el.dataset.bonus), 'Bonus paid 🎁')) openStaff(b); };
    for (const el of document.querySelectorAll('[data-fire]')) el.onclick = () => { if (result(T.fireStaff(s, b.id, +el.dataset.fire), 'Let go')) openStaff(b); };
    for (const el of document.querySelectorAll('[data-raise]')) el.onclick = () => { const [i, y] = el.dataset.raise.split(':'); if (result(T.answerRaise(s, b.id, +i, y === '1'), y === '1' ? '💸 Raise agreed: they\'re delighted' : 'Raise turned down')) openStaff(b); };
    for (const el of document.querySelectorAll('[data-sup]')) el.onclick = () => { if (result(T.setSupervisor(s, b.id, +el.dataset.sup), '⭐ New supervisor: the whole team works a bit faster')) openStaff(b); };
    for (const el of document.querySelectorAll('[data-promo-to]')) el.onchange = () => { if (!el.value) return; if (result(T.promoteToManager(s, b.id, +el.dataset.promoTo, +el.value), '🧑‍💼 Promoted to manager!')) openStaff(b); };
  }

  // a manager runs the shop on the days you don't serve it yourself
  function managerHtml(b) {
    const mg = b.manager;
    if (mg) {
      const ms = T.MANAGER_STYLES[mg.style];
      return `<p class="section-title">🧑‍💼 Manager</p><div class="row"><span class="ic">${ms.icon}</span><span class="nm"><b>${esc(mg.name)} · level ${mg.level} ${ms.name}</b>
        <small>${esc(ms.desc)} ${money(T.managerWage(mg))}/day · ${mg.days || 0} days here${mg.level < T.MANAGER_MAX ? ` · next level in ${mg.level * 8 - mg.xp} days` : ' · top level'}${mg.last ? `<br>Last report: ${esc(mg.last)}` : ''}</small></span></div>
        <div class="btns">${mg.level < T.MANAGER_MAX ? `<button class="btn" id="mgTrain">🎓 Train now · ${money(T.trainCost(mg))}</button>` : ''}<button class="btn danger" id="mgFire">Let go</button></div>`;
    }
    return `<p class="section-title">🧑‍💼 Hire a manager</p><p class="muted">On days you don't serve here yourself, a manager reorders stock when it runs low and sells a little more. They get better with experience (or training), but each has their own style, and their own mistakes.</p>
      <div class="pick">${T.managerCandidates(s, b).map((c, i) => { const ms = T.MANAGER_STYLES[c.style]; return `<button class="row" data-mgr="${i}"><span class="ic">${ms.icon}</span><span class="nm"><b>${esc(c.name)} · level ${c.level} ${ms.name}</b><small>${esc(ms.desc)}</small></span><span class="px"><b>${money(T.managerWage(c))}/day</b></span></button>`; }).join('')}</div>`;
  }

  // getting stock: your own cargo or workshop, or a supplier (cheap and slow, or quick and dear)
  function openSupplies(b) {
    const G = T.G[b.good], room = T.orderRoom(b), price = T.price(s, b.district, b.good), live = NeonShop.active();
    const own = (b.district === s.district ? s.cargo[b.good] || 0 : 0) + s.businesses.filter((f) => f.kind === 'factory' && f.district === b.district && f.good === b.good).reduce((a, f) => a + f.stock, 0);
    const qtys = [...new Set([0.25, 0.5, 1].map((f) => Math.max(1, Math.floor(room * f))))];
    openSheet(`<h2>📦 Get more ${esc(G.name)}<button class="close" data-close>✕</button></h2>
      <p class="muted">Room for ${room} more. Wholesale here is ${price2(price)}.</p>
      <button class="row" id="supOwn"${own && room ? '' : ' disabled'}><span class="ic">🎒</span><span class="nm"><b>From your cargo and workshop</b><small>Free · ${own} available${live ? ' · here in a few seconds' : ''}</small></span></button>
      ${Object.entries(T.SUPPLIERS).map(([k, sp]) => `<div class="card"><h3>${sp.icon} ${sp.name}<span class="muted" style="margin-left:auto;font-size:12px">${price2(price * sp.cost)} each</span></h3>
        <p>${esc(sp.desc)}</p><div class="btns">${room ? qtys.map((q) => `<button class="btn" data-sup="${k}:${q}">${q} · ${money(q * price * sp.cost)}</button>`).join('') : '<span class="muted">No room right now.</span>'}</div></div>`).join('')}
      <div class="card"><h3>📜 Supplier contract<span class="muted" style="margin-left:auto;font-size:12px">${price2(price * T.CONTRACT.disc)} each, locked</span></h3>
        ${b.contract ? `<p>Delivering <b>${b.contract.qty}</b> every 2 days at ${price2(b.contract.each)} each, until day ${b.contract.until}. Paid on delivery.</p><button class="btn danger" id="conCancel">Cancel ($${T.CONTRACT.cancel} fee)</button>`
          : `<p>${T.CONTRACT.days} days of deliveries every 2 days at 10% under today's wholesale price, whatever the market does. Paid on delivery.</p><div class="btns">${[0.5, 1, 1.5].map((f) => Math.max(1, Math.round(T.unitsPerDay(T.STALLS[b.tier].cap, b.good) * f))).map((q) => `<button class="btn" data-con="${q}">${q} per delivery</button>`).join('')}</div>`}</div>`);
    for (const el of document.querySelectorAll('[data-con]')) el.onclick = () => { if (result(T.signContract(s, b.id, +el.dataset.con), '📜 Contract signed')) { save(); openSupplies(b); } };
    if ($('conCancel')) $('conCancel').onclick = () => { if (result(T.cancelContract(s, b.id), 'Contract cancelled')) { save(); openSupplies(b); } };
    $('supOwn').onclick = () => {
      const r = live ? NeonShop.refill() : T.refillShelves(s, b.id);
      closeSheet(); save(); if (!live) render();
      toast(r.ok ? `🚚 ${r.moved} ${G.name} on the way` : r.msg);
    };
    for (const el of document.querySelectorAll('[data-sup]')) el.onclick = () => {
      const [k, q] = el.dataset.sup.split(':'), sp = T.SUPPLIERS[k];
      const r = live ? NeonShop.order(k, +q) : T.orderStock(s, b.id, k, +q);
      closeSheet(); save(); if (!live) render();
      if (!r.ok) { toast(r.msg); return; }
      toast(`${sp.icon} ${r.got < r.qty ? `Only ${r.got} of ${r.qty} turned up` : `${r.got} ordered`} · ${money(r.cost)}${live ? ` · arriving in ~${Math.round(r.delay)}s` : ''}`);
    };
  }

  // shop decoration, paid with arcade coins; one style for all your shops
  function openDecor() {
    const A = window.NeonShopArt, d = A.loadDecor(), coins = store.get('neonDash.wallet', 0);
    const swatch = (cat, it) => {
      if (cat === 'plants') return `<i class="sw emo">${it.id === 'none' ? '🚫' : it.id === 'jungle' ? '🌴' : '🪴'}</i>`;
      if (cat === 'music') return `<i class="sw emo">${it.id === 'off' ? '🔇' : '🎵'}</i>`;
      if (cat === 'pet') return `<i class="sw emo">${{ none: '🚫', cat: '🐱', dog: '🐶', parrot: '🦜' }[it.id]}</i>`;
      const c = cat === 'floor' ? `linear-gradient(135deg, ${it.a} 50%, ${it.line || it.b} 50%)` : cat === 'walls' ? it.wall
        : cat === 'sign' ? (it.rainbow ? 'linear-gradient(90deg,#ff2a6d,#ffd23f,#4ade80,#05d9e8,#9b5de5)' : it.color) : it.color;
      return `<i class="sw" style="background:${c}"></i>`;
    };
    openSheet(`<h2>🎨 Decorate your shops<button class="close" data-close>✕</button></h2>
      <p class="muted">You have 🪙 ${coins}. Earn coins in Neon Dash or by finishing a season. Your style is used in every shop you run.</p>
      <p class="section-title">🧊 Shop view</p>
      <div class="decor">${[['3d', '🧊 3D', NeonShop.has3D() ? 'A real 3D shop you can zoom into' : 'Not supported on this device'], ['2d', '🖼️ Classic', 'The drawn shop, lightest on battery']].map(([id, name, desc]) =>
        `<button class="dec${NeonShop.getView() === id ? ' on' : ''}" data-view="${id}"${id === '3d' && !NeonShop.has3D() ? ' disabled' : ''}><b>${name}</b><small>${NeonShop.getView() === id ? '✓ In use' : desc}</small></button>`).join('')}</div>
      <p class="section-title">⚙️ Graphics</p>
      <div class="decor">${[['auto', '🪄 Auto', 'Shadows, reflections and glow when your phone keeps up'], ['high', '✨ Sharp', 'Everything on: shadows, reflections, glowing neon'], ['low', '⚡ Smooth', 'Simple lighting: fastest, for older phones']].map(([id, name, desc]) =>
        `<button class="dec${NeonShop.getGfx() === id ? ' on' : ''}" data-gfx="${id}"><b>${name}</b><small>${NeonShop.getGfx() === id ? '✓ In use' : desc}</small></button>`).join('')}</div>
      <div class="decor"><button class="dec${NeonShop.getSaver() ? ' on' : ''}" id="saverBtn"><b>🔋 Battery saver</b><small>${NeonShop.getSaver() ? '✓ On: 30 frames a second' : `30 frames a second for longer play. Always on with ⚡ Smooth${NeonShop.lowBattery() ? '; on now, your battery is low' : ', and when your battery is low'}.`}</small></button></div>
      ${Object.keys(A.DECOR).map((cat) => `<p class="section-title">${A.DECOR_NAMES[cat]}</p><div class="decor">${A.DECOR[cat].map((it) => {
        const own = A.owns(d, cat, it.id), on = d[cat] === it.id;
        return `<button class="dec${on ? ' on' : ''}" data-dec="${cat}:${it.id}">${swatch(cat, it)}<b>${it.name}</b><small>${on ? '✓ In use' : own ? 'Owned' : `🪙 ${it.cost}`}</small></button>`;
      }).join('')}</div>`).join('')}`);
    for (const el of document.querySelectorAll('[data-view]')) el.onclick = () => { NeonShop.setView(el.dataset.view); openDecor(); toast(el.dataset.view === '3d' ? '🧊 3D shop: opens next time you run a shop' : '🖼️ Classic shop view'); };
    if ($('saverBtn')) $('saverBtn').onclick = () => { NeonShop.setSaver(!NeonShop.getSaver()); openDecor(); toast(NeonShop.getSaver() ? '🔋 Battery saver on: 30 frames a second' : '🔋 Battery saver off'); };
    for (const el of document.querySelectorAll('[data-gfx]')) el.onclick = () => { NeonShop.setGfx(el.dataset.gfx); openDecor(); toast('Graphics: ' + el.textContent.trim().split('\n')[0]); };
    for (const el of document.querySelectorAll('[data-dec]')) el.onclick = () => {
      const [cat, id] = el.dataset.dec.split(':'), item = A.DECOR[cat].find((x) => x.id === id), d2 = A.loadDecor();
      if (!A.owns(d2, cat, id)) {
        const c = store.get('neonDash.wallet', 0);
        if (c < item.cost) { toast(`You need 🪙 ${item.cost}. Earn coins in Neon Dash or by finishing a season.`); return; }
        store.set('neonDash.wallet', c - item.cost);
        d2.owned.push(`${cat}:${id}`);
      }
      d2[cat] = id; A.saveDecor(d2);
      openDecor(); render(); toast(`${item.name} ✓`);
    };
  }

  function bizAction(act, id) {
    const b = s.businesses.find((x) => x.id === id);
    if (act === 'restock') result(T.restock(s, id, s.cargo[b.good] || 0), `Stocked the ${(T.STALLS[b.tier]).name.toLowerCase()}`);
    else if (act === 'collect') result(T.collect(s, id, b.stock), 'Loaded into your cargo');
    else if (act === 'shop') openShop(b);
    else if (act === 'price') openPrice(b);
    else if (act === 'supgs') openUpgrades(b);
    else if (act === 'staff') openStaff(b);
    else if (act === 'match') { T.setPriceMatch(s, id, !b.priceMatch); save(); render(); toast(b.priceMatch ? `🤝 You'll match ${T.rival(s, b).name}'s price for anyone who asks` : 'Price match off'); }
    else if (act === 'supply') openSupplies(b);
    else if (act === 'arrange') openArrange(b);
    else if (act === 'report') openReport(b);
    else if (act === 'shareshop') shareShop(b);
    else if (act === 'grow') openGrow(b);
    else if (act === 'ads') openMarketing(b);
    else if (act === 'upgrade') result(T.upgradeBusiness(s, id), 'Upgraded!');
    else if (act === 'product') openProductPicker('Change product', (g) => { if (result(T.setProduct(s, id, g), `Now ${b.kind === 'stall' ? 'selling' : 'making'} ${T.G[g].name}`)) closeSheet(); }, b.kind);
    else if (act === 'sellbiz') {
      openSheet(`<h2>Sell this business?<button class="close" data-close>✕</button></h2>
        <p>You get back ${Math.round(T.RESALE * 100)}% of what you put in, plus its stock: about <b>${money(b.invested * T.RESALE + b.stock * T.G[b.good].base * T.PRODUCE_COST)}</b>.</p>
        <button class="btn danger" id="confirmSell">Sell it</button>`);
      $('confirmSell').onclick = () => { if (result(T.sellBusiness(s, id), 'Sold')) closeSheet(); };
    }
  }

  // ---------- shelf price ----------
  const priceLine = (b) => {
    const mult = b.mult || T.RETAIL;
    return `<b class="num">${price2(T.shelfPrice(s, b))}</b> <small class="muted">${Math.round(mult * 100)}% of wholesale · ${Math.round(T.willingShare(mult) * 100)}% will pay</small>`;
  };
  // the shop's price, or one line's price (as a share of it)
  let priceFor = 'all';
  const shopPriceLine = (b) => {
    if (priceFor === 'all') return priceLine(b);
    const lm = NeonShop.linePrice(b, priceFor), mult = (b.mult || T.RETAIL) * lm, name = NeonShop.plan.lineNames(b)[priceFor];
    return `<b class="num">${price2(T.shelfPrice(s, b) * lm)}</b> <small class="muted">${esc(name)}: ${lm === 1 ? 'same as the shop' : `${lm < 1 ? '' : '+'}${Math.round((lm - 1) * 100)}%`} · ${Math.round(T.willingShare(mult) * 100)}% will pay</small>`;
  };
  const nudgePrice = (b, d) => T.setShelfPrice(s, b.id, Math.round(((b.mult || T.RETAIL) + d) * 20) / 20);
  function openPrice(b) {
    const G = T.G[b.good];
    openSheet(`<h2>💲 ${G.icon} ${G.name} price<button class="close" data-close>✕</button></h2>
      <p>Wholesale here is ${price2(T.price(s, b.district, b.good))}. A higher price earns more on each sale, but fewer shoppers will pay it.</p>
      <div class="pricer"><button class="btn" id="pDown">−</button><div id="pNow"></div><button class="btn" id="pUp">+</button></div>
      <button class="btn" id="pReset">Reset to ${Math.round(T.RETAIL * 100)}%</button>
      <button class="btn primary" data-close>Done</button>`);
    const show = () => { $('pNow').innerHTML = priceLine(b); save(); render(); };
    $('pDown').onclick = () => { nudgePrice(b, -0.05); show(); };
    $('pUp').onclick = () => { nudgePrice(b, 0.05); show(); };
    $('pReset').onclick = () => { T.setShelfPrice(s, b.id, T.RETAIL); show(); };
    show();
  }

  // ---------- hands-on shop day ----------
  function openShop(b) {
    priceFor = 'all';
    if (!window.NeonShop) return;
    const view = $('shopView'), G = T.G[b.good];
    view.classList.remove('hidden');
    document.body.classList.add('noscroll');
    $('shopTitle').textContent = `${G.icon} ${T.STALLS[b.tier].name} · ${T.D[b.district].name}`;
    let takings = 0, lastKey = '';
    coach = !visiting && !store.get('neonTycoon.coached', false) && (location.hash !== '#test' || store.get('neonTycoon.coachTest', false)) ? { i: 0 } : null;
    const hud = (run) => {
      coachTick(run);
      if (run) takings = run.revenue;
      const si = NeonShop.stockInfo();
      const acts = NeonShop.actions(), goal = NeonShop.goal();
      const key = [NeonShop.clock(), Math.round(takings), b.stock, si && si.shelves, b.mult, priceFor, JSON.stringify(b.linePrice), NeonShop.frontWaiting(), run && run.till2, NeonShop.pendingReturn(), run && run.zoom.z > 1.01,
        NeonShop.walking(), NeonShop.canWalk(), NeonShop.isFirstPerson(), JSON.stringify(NeonShop.request()), JSON.stringify(NeonShop.night()), acts.map((a) => a.id + a.label).join(), goal && goal.prog + goal.done + goal.failed, JSON.stringify(NeonShop.eventInfo()), JSON.stringify(NeonShop.online())].join('|');
      if (key === lastKey) return;
      lastKey = key;
      $('shopClock').textContent = NeonShop.clock();
      $('shopTake').textContent = money(takings);
      $('shopStock').textContent = si ? `${si.shelves} · ${b.stock - si.shelves}` : b.stock;
      $('shopPrice').innerHTML = shopPriceLine(b);
      const names = NeonShop.plan.lineNames(b);
      $('lineChips').classList.toggle('hidden', names.length < 2);
      $('lineChips').innerHTML = [['all', 'All lines']].concat(names.map((n, i) => [i, `${n}${NeonShop.linePrice(b, i) < 0.999 ? ' 🏷️' : ''}`])).map(([k, n]) => `<button data-pfor="${k}" class="${String(priceFor) === String(k) ? 'on' : ''}">${esc(n)}</button>`).join('');
      $('shopServe').classList.toggle('ready', NeonShop.frontWaiting());
      $('shopTill').classList.toggle('on', !!(run && run.till2));
      $('shopReturn').classList.toggle('hidden', !NeonShop.pendingReturn());
      const rq = NeonShop.request();
      $('shopRequest').classList.toggle('hidden', !rq);
      if (rq) $('reqText').textContent = `📝 ${rq.name}: ${rq.qty}× ${rq.line} by day ${rq.due}? (+30%)`;
      $('shopZoom').classList.toggle('hidden', !(run && run.zoom.z > 1.01));
      $('shopZoom').textContent = run && run.r3d ? '🎯' : '🔍 1×';
      $('shopTeam').classList.toggle('hidden', !(run && run.staff.length));
      const fpOk = NeonShop.walking() && NeonShop.is3D(), fpOn = NeonShop.isFirstPerson();
      $('shopFP').classList.toggle('hidden', !fpOk); $('shopFP').classList.toggle('on', fpOn);
      $('fpStick').classList.toggle('hidden', !fpOn);
      const onl = NeonShop.online();
      $('shopOnline').classList.toggle('hidden', !onl);
      if (onl) { $('shopOnline').textContent = `📱 ${onl.length}`; $('shopOnline').classList.toggle('ping', onl.length > 0); }
      if (onlineOpen && $('onlineList')) { // redraw the list only when it changes (buttons stay put); tick the countdowns
        const sig = (onl || []).map((o) => `${o.id}${o.stock}${o.late}`).join();
        if (sig !== onlineSig) { onlineSig = sig; $('onlineList').innerHTML = onlineRows(); }
        else for (const o of onl || []) { const el = document.querySelector(`[data-left="${o.id}"]`); if (el) el.textContent = o.late ? '⏰ Late: they\'ll get 30% back' : `Deliver in ${o.left}s`; }
      }
      view.classList.toggle('is3d', NeonShop.is3D());
      // out on the floor: what you can do here, and the button back to the till
      const walking = NeonShop.walking(), night = NeonShop.night();
      $('shopNight').classList.toggle('hidden', !(night && night.offer));
      $('shopWalk').textContent = night && night.active ? '🏠 Done' : walking ? '🛎️ Till' : '🚶 Walk';
      $('shopWalk').classList.toggle('on', walking);
      $('shopWalk').disabled = !(night && night.active) && !NeonShop.canWalk();
      $('shopServe').classList.toggle('away', walking);
      $('shopActs').classList.toggle('hidden', !acts.length);
      $('shopActs').innerHTML = acts.map((a) => `<button class="btn" data-do="${a.id}">${esc(a.label)}</button>`).join('');
      const ev = NeonShop.eventInfo();
      $('shopEvent').classList.toggle('hidden', !ev);
      if (ev) { $('shopEvent').textContent = ev.text; $('shopEvent').className = `eventpill${ev.done ? (ev.ok ? ' done' : ' failed') : ''}${ev.tap ? ' tap' : ''}`; }
      if (goal) {
        $('shopGoal').textContent = `${goal.done ? '✅' : goal.failed ? '❌' : goal.night ? '🧹' : '🎯'} ${goal.text} · ${goal.prog}`;
        $('shopGoal').className = `goalpill${goal.done ? ' done' : goal.failed ? ' failed' : ''}`;
      }
      $('cash').textContent = compact(s.cash);
    };
    const res = NeonShop.open(s, b.id, {
      canvas: $('shopCanvas'), canvas3d: $('shop3d'),
      onTick: hud,
      onEnd: (sum) => {
        if (coach) coachEnd();
        if (visiting) { view.classList.add('hidden'); view.classList.remove('photo'); document.body.classList.remove('noscroll'); if (visiting.challenge) { achCount({ served: sum.served }); challengeOver(sum); } else visitEnd(sum); return; }
        view.classList.add('hidden'); view.classList.remove('photo');
        document.body.classList.remove('noscroll');
        save(); render();
        shopSummary(b, sum);
      },
    });
    if (!res.ok) { view.classList.add('hidden'); document.body.classList.remove('noscroll'); toast(res.msg); return; }
    save();
    hud();
    // first time in 3D: how to look round; first time in a megastore: where the annex is
    const once = (k, msg) => { if (!store.get(k, false)) { store.set(k, true); setTimeout(() => toast(msg), 1800); } };
    if (NeonShop.is3D()) once('neonTycoon.hint360', '👆 Drag to turn the shop all the way round · two fingers slide · pinch to zoom');
    if (NeonShop.is3D() && b.tier >= 2) once('neonTycoon.hintAnnex', '🏬 Your annex is through the arch on the right, with stairs up to Level 2');
  }

  // who came today (office workers, students, families, seniors) and how each got on
  const GROUP_INFO = { worker: ['💼', 'Office workers'], student: ['🎒', 'Students'], family: ['👪', 'Families'], senior: ['🧓', 'Seniors'] };
  function groupsHtml(m) {
    const g = m.groups || {}, keys = Object.keys(GROUP_INFO).filter((k) => g[k] && g[k].came);
    if (!keys.length) return '';
    return `<span>Who came${m.weekend ? ' (weekend)' : ''}</span><span>${keys.map((k) => `${GROUP_INFO[k][0]} ${g[k].served}/${g[k].came}`).join(' · ')}</span>`;
  }
  function groupTips(m) {
    const g = m.groups || {}, out = [];
    const worst = Object.keys(GROUP_INFO).filter((k) => g[k] && g[k].came >= 3).sort((a, b) => g[b].lost / g[b].came - g[a].lost / g[a].came)[0];
    if (worst && g[worst].lost / g[worst].came > 0.35) {
      const why = { worker: 'they\'re in a hurry: open Till 2 for the morning rush', student: 'they watch their money: a sale or a 2-for-1 sign helps', family: 'they buy a lot but tire of queues: keep the shelves full', senior: 'they like help: answer raised hands and chat' }[worst];
      out.push(`${GROUP_INFO[worst][0]} ${g[worst].lost} of ${g[worst].came} ${GROUP_INFO[worst][1].toLowerCase()} walked out: ${why}.`);
    }
    return out;
  }

  // ---------- your first shop day: a coach walks you through it (once; you can skip it) ----------
  let coach = null;
  const COACH = [
    { text: '👋 Welcome to your shop! Shoppers walk in off the street, take what they want off the shelves and queue at your till.' },
    { text: '🛎️ Someone\'s at the till: tap SERVE to ring them up.', wait: '⏳ Wait for a shopper to reach the till…', target: ['shopServe'], until: (r) => r.served > 0 },
    { text: '💲 − and + change your price. Higher earns more on each sale, but more shoppers walk out. The line under it says how many will pay.', target: ['.pricer'] },
    { text: '📦 Shelves running low? Restock brings goods from your cargo or a supplier. Boxes come in the back door and your clerk shelves them.', target: ['shopRefill'] },
    { text: '👆 Tap a shopper to see who they are and what they want. Tap 👀 shoplifters before they reach the door, and 🙋 raised hands to help.' },
    { text: '🧾 Busy? Open Till 2. Once someone else is on a till, 🚶 Walk lets you out onto the shop floor. Drag to turn the shop, pinch to zoom.', target: ['shopTill', 'shopWalk'] },
    { text: '🎯 Every day has a goal, up top. At closing time you get a report with tips. That\'s it: good luck!', target: ['shopGoal'], last: true },
  ];
  let coachSig = '';
  function coachTick(r) {
    const box = $('shopCoach'), st = coach && r && COACH[coach.i];
    if (st && st.until && st.until(r)) { coach.i++; coachTick(r); return; }
    const waiting = !!(st && st.until && !NeonShop.frontWaiting()), sig = st ? `${coach.i}|${waiting}` : '';
    if (sig === coachSig) return; // only touch the page when the step changes
    coachSig = sig;
    for (const el of document.querySelectorAll('.coachme')) el.classList.remove('coachme');
    if (!st) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    $('coachText').textContent = waiting ? st.wait : st.text;
    $('coachNext').classList.toggle('hidden', !!st.until);
    $('coachNext').textContent = st.last ? 'Got it ✓' : 'Next ▸';
    $('coachSkip').classList.toggle('hidden', !!st.last);
    if (!waiting) for (const t of st.target || []) { const el = t[0] === '.' ? document.querySelector(`#shopView ${t}`) : $(t); if (el) el.classList.add('coachme'); }
  }
  const coachEnd = () => { coach = null; store.set('neonTycoon.coached', true); coachTick(null); };
  $('coachNext').onclick = () => { if (!coach) return; if (COACH[coach.i].last) coachEnd(); else { coach.i++; coachTick(NeonShop.current()); } };
  $('coachSkip').onclick = coachEnd;

  function shopSummary(b, m) {
    achCount({ served: m.served, caught: m.caught || 0, five: m.stars >= 5 ? 1 : 0, streak: (m.goal && m.goal.met && m.goal.streak) || 0, online: m.online || 0,
      inspect: m.eventResult && m.eventResult.ok && m.event === 'inspector' ? 1 : 0, celeb: m.eventResult && m.eventResult.ok && m.event === 'celebrity' ? 1 : 0, critic: m.critic && m.critic.stars >= 4 ? 1 : 0 });
    const lost = m.lostPrice + m.lostWait + m.lostStock, wx = T.WEATHER[m.weather] || T.WEATHER.sunny;
    const tips = [];
    if (m.lostStock) tips.push(`📦 ${m.lostStock} left because the shelves were empty. Bring more stock, or build a workshop here making ${T.G[b.good].name}.`);
    if (m.lostPrice > m.served / 2 && m.lostPrice) tips.push(`😒 ${m.lostPrice} thought your price was too high. Try a lower price.`);
    else if (!m.lostPrice && m.served > 4) tips.push('😍 Nobody balked at your price. You could charge a bit more.');
    if (m.lostWait) tips.push(`😠 ${m.lostWait} got tired of waiting. Serve faster, or upgrade: bigger shops come with helpers.`);
    if (m.haul) tips.push('📱 An influencer filmed a haul video here: expect more shoppers tomorrow!');
    if (m.holiday) tips.push(`${m.holiday.icon} It's ${m.holiday.name}: some goods are in demand.`);
    if (m.event === 'power') tips.push('⚡ There was a power cut today: card payments and the self-checkout were down.');
    if (m.staff && m.staff.some((x) => x.morale < 30)) tips.push('😫 Some of your staff are worn out. A bonus or a quieter day helps, or they may quit.');
    if (m.ordersLost && m.ordersLost.length) tips.push(`💔 ${m.ordersLost.join(', ')} stopped coming: their order wasn't ready in time.`);
    for (const t of groupTips(m)) tips.push(t);
    if (m.slips) tips.push(`😬 ${m.slips} shopper${m.slips > 1 ? 's' : ''} slipped on the wet floor by the door. Mop the doorway (🚶 Walk) or stand the ⚠️ wet-floor sign by the door in 🧱 Arrange shop.`);
    if (m.eventResult) tips.push(m.eventResult.text);
    if (m.critic) tips.push(`📰 The critic wrote: ${m.critic.words}${m.critic.stars >= 3.5 ? ' Expect a few more shoppers tomorrow.' : ' Fewer shoppers may come tomorrow.'}`);
    if (m.splashed) tips.push(`💦 ${m.splashed} shopper${m.splashed > 1 ? 's' : ''} walked through the flood.`);
    if (m.online || m.onlineLost) tips.push(`📱 ${m.online} online order${m.online === 1 ? '' : 's'} delivered${m.onlineLost ? `, ${m.onlineLost} cancelled for being too slow` : ''}.`);
    if (m.side) tips.push(`🥡 The side counter sold ${m.side} at the till.`);
    if (m.furnTake) tips.push(`🥫 Your vending and arcade machines took ${money(m.furnTake)} today.`);
    if (m.levelUps && m.levelUps.length) tips.push(`🎓 ${m.levelUps.join(', ')}: they work faster now.`);
    if (m.staff && m.staff.some((x) => x.strike)) tips.push(`🪧 ${m.staff.filter((x) => x.strike).map((x) => x.name).join(', ')} went on strike. Bonuses and raises keep morale up.`);
    if (m.toRival) tips.push(`🏪 ${m.toRival} walked over the road to ${m.rivalName} for a cheaper price. Turn on 🤝 price match on the shop card, or price under them.`);
    if (m.matched) tips.push(`🤝 You matched ${m.rivalName}'s price for ${m.matched} shopper${m.matched > 1 ? 's' : ''} who'd have gone over the road.`);
    if (m.stolen) tips.push(`🚨 ${m.stolen} went out the door unpaid. Tap shoplifters (👀) before they reach the door, or fit security gates.`);
    const g = m.goal;
    if (g && g.met) store.set('neonDash.wallet', store.get('neonDash.wallet', 0) + g.reward);
    openSheet(`<h2>🌙 Closing time</h2>
      <p class="big-num">${money(m.revenue + (m.extras || 0))}</p>
      ${g ? `<div class="goalline${g.met ? '' : ' miss'}">${g.met ? `✅ Goal done: ${esc(g.text)} · +${g.reward} 🪙${g.streak > 1 ? ` · 🔥 ${g.streak}-day streak` : ''}` : `❌ Goal missed: ${esc(g.text)}. Your streak starts again.`}</div>` : ''}
      <div class="kv"><span>Weather</span><span>${wx.icon} ${wx.name}</span><span>Shoppers who came in</span><span>${m.entrants}</span><span>Served</span><span>${m.served}</span>
        <span>${T.G[b.good].icon} sold</span><span>${m.sold} · ${money(m.revenue)}</span>
        ${m.lines && m.lines.length > 1 ? `<span>By line</span><span>${m.lines.map((n, i) => `${i === m.trend ? '🔥' : ''}${esc(n)} ${m.lineSold[i]}`).join(' · ')}</span>` : ''}
        ${m.extras ? `<span>Tips, drinks, coffee${m.returns || m.rewards ? ', refunds and stamp-card freebies' : ''}</span><span>${money(m.extras)}</span>` : ''}
        ${m.helped ? `<span>Shoppers you helped</span><span>${m.helped}</span>` : ''}
        ${m.caught || m.stolen ? `<span>Shoplifters</span><span>${m.caught} caught · ${m.stolen} stolen</span>` : ''}
        ${m.reducedSold ? `<span>Sold at half price (near their date)</span><span>${m.reducedSold}</span>` : ''}
        ${m.returns ? `<span>Returns sorted</span><span>${m.good} happy · ${m.bad} refused</span>` : ''}
        ${m.newRegulars || m.regulars ? `<span>Regulars</span><span>${m.regulars}${m.newRegulars ? ` (+${m.newRegulars} new)` : ''}</span>` : ''}
        ${m.knocked ? `<span>Knocked off the shelves</span><span>${m.knocked}</span>` : ''}
        ${m.orders ? `<span>Orders collected</span><span>📝 ${m.orders}</span>` : ''}
        ${m.nightTotal ? `<span>Night shift</span><span>🧹 ${m.nightDone}/${m.nightTotal} jobs${m.tidy >= 0.8 ? ' · spotless ✨' : ''}</span>` : ''}
        ${m.openOrders && m.openOrders.length ? `<span>Orders to come</span><span>${m.openOrders.map((q) => `${esc(q.name)} ${q.qty}× ${esc(q.lineName)} · day ${q.due}`).join('<br>')}</span>` : ''}
        ${m.staff && m.staff.length ? `<span>Staff</span><span>${m.staff.map((x) => `${esc(x.name)} ${x.served}`).join(' · ')}</span>` : ''}
        ${groupsHtml(m)}
        <span>Walked out</span><span>${lost}</span></div>
      ${m.rep ? `<p class="section-title">💬 Word on the street</p><div class="repchips">${repChips(m.rep, m.repBefore)}</div><p class="muted">What shoppers tell their friends: it changes how many come, how patient they are, and what they'll pay.</p>` : ''}
      ${m.reviews && m.reviews.length ? `<p class="section-title">Today's reviews · <span class="stars">${starStr(m.stars)}</span></p>
        <div class="news">${m.reviews.map((rv) => `<div><span class="stars">${starStr(rv.stars)}</span><span>${esc(rv.text)}</span></div>`).join('')}</div>
        <p class="muted">Shop rating: ${m.rating.toFixed(1)} ★. A better rating brings more shoppers, even on days you don't run it.</p>` : ''}
      ${tips.length ? `<div class="news">${tips.map((x) => `<div><span>${x.slice(0, 2)}</span><span>${esc(x.slice(2).trim())}</span></div>`).join('')}</div>` : ''}
      ${m.heat ? '<p class="section-title">🔥 Where shoppers spent their time</p><canvas class="plan" id="heatCv" aria-label="Heat map of the shop floor"></canvas><p class="muted">Hot spots are busy. Cold corners could use a shelf or a display: try 🧱 Arrange shop.</p>' : ''}
      <p class="muted">Rent is paid when the day ends. Automatic sales are skipped at this shop today.</p>
      <button class="btn primary" data-close>Done</button>`);
    if (m.heat && $('heatCv')) drawPlanCanvas($('heatCv'), m.plan, { heat: m.heat });
  }

  // a plan of the shop from above, sharp on the screen
  function drawPlanCanvas(cv, shapes, opts) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    NeonShop.plan.draw(ctx, W, H, shapes, opts);
  }

  // word of mouth, in words: 💲 prices, 📦 stock, ⏱️ queue, 😊 service
  const REP_LABEL = { price: '💲 Prices', stock: '📦 Stock', queue: '⏱️ Queue', service: '😊 Service' };
  const repWord = (v) => (v >= 70 ? 'great' : v >= 56 ? 'good' : v >= 44 ? 'okay' : v >= 30 ? 'poor' : 'awful');
  const repChips = (rp, before) => T.REP_KEYS.map((k) => {
    const d = before ? rp[k] - before[k] : 0;
    return `<span class="repchip ${rp[k] >= 56 ? 'good' : rp[k] < 44 ? 'bad' : ''}">${REP_LABEL[k]}: ${repWord(rp[k])}${d >= 2 ? ' ▲' : d <= -2 ? ' ▼' : ''}</span>`;
  }).join('');

  // ---------- the weekly report: the last seven days you ran this shop ----------
  // chart colours for the lines: the game's cyan, pink and gold, stepped down to read on the dark card (validated)
  const LINE_INK = ['#0096a6', '#f0306e', '#b88a00'], HOUR_INK = '#7c6cf0';
  function openReport(b) {
    const days = (b.history || []).slice(-7), names = days.length ? days[days.length - 1].lines : [];
    const sum = (f) => days.reduce((a, d) => a + f(d), 0);
    const met = days.filter((d) => d.goal).length, last = days[days.length - 1] || {};
    const sold = (d) => d.lineSold.reduce((a, x) => a + x, 0);
    const tiles = [['🛍️ Sold', sum(sold).toLocaleString()], ['💰 Takings', money(sum((d) => d.revenue))],
      ['🚨 Stolen', `${sum((d) => d.stolen)} <small>· ${sum((d) => d.caught)} caught</small>`], ['🎯 Goals', `${met}/${days.length}${last.streak > 1 ? ` <small>· 🔥 ${last.streak}</small>` : ''}`]];
    // sold per day, stacked by line (2px gaps between segments and bars); 🧱 where you changed the layout
    const W = 320, H = 170, padL = 28, padB = 30, padT = 14, cw = (W - padL - 6) / Math.max(1, days.length), bw = Math.min(30, cw - 6);
    const max = Math.max(1, ...days.map((d) => d.lineSold.reduce((a, x) => a + x, 0)));
    const nice = Math.ceil(max / 10) * 10, y = (v) => H - padB - ((H - padB - padT) * v) / nice;
    let bars = '';
    days.forEach((d, i) => {
      const cx = padL + cw * i + cw / 2; let acc = 0;
      d.lineSold.forEach((n, l) => {
        if (!n) return;
        const y0 = y(acc), y1 = y(acc + n), top = acc + n === d.lineSold.reduce((a, x) => a + x, 0);
        bars += `<path d="${roundTop(cx - bw / 2, y1 + (acc ? 0 : 0), bw, y0 - y1 - (acc ? 2 : 0), top ? 4 : 0)}" fill="${LINE_INK[l]}"/>`;
        acc += n;
      });
      bars += `<text x="${cx}" y="${H - padB + 13}" class="ax" text-anchor="middle">Day ${d.day}</text>`;
      if (i && d.layout !== days[i - 1].layout) bars += `<text x="${cx}" y="${H - 4}" text-anchor="middle" font-size="11">🧱</text>`;
      bars += `<rect x="${cx - cw / 2}" y="${padT}" width="${cw}" height="${H - padB - padT}" fill="transparent" data-tip="${i}"/>`;
    });
    const grid = [0, nice / 2, nice].map((v) => `<line x1="${padL}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL - 4}" y="${y(v) + 3}" class="ax" text-anchor="end">${v}</text>`).join('');
    // busiest hours: everything sold, by the hour, across these days
    const hours = Array.from({ length: 12 }, (_, h) => sum((d) => (d.hours ? d.hours[h] : 0))), hmax = Math.max(1, ...hours), best = hours.indexOf(hmax);
    const H2 = 120, hw = (W - padL - 6) / 12, y2 = (v) => H2 - 22 - ((H2 - 22 - 16) * v) / hmax;
    const hbars = hours.map((v, h) => `<path d="${roundTop(padL + hw * h + 1, y2(v), hw - 2, H2 - 22 - y2(v), v ? 3 : 0)}" fill="${HOUR_INK}" opacity="${h === best ? 1 : 0.55}"><title>${9 + h}:00–${10 + h}:00 · ${v} sold</title></path>`
      + (h % 3 === 0 ? `<text x="${padL + hw * h + hw / 2}" y="${H2 - 8}" class="ax" text-anchor="middle">${9 + h}:00</text>` : '')).join('')
      + `<text x="${padL + hw * best + hw / 2}" y="${y2(hmax) - 4}" class="lbl" text-anchor="middle">${hmax}</text>`;
    openSheet(`<h2>📊 ${esc(T.G[b.good].name)} · last ${days.length} shop day${days.length === 1 ? '' : 's'}<button class="close" data-close>✕</button></h2>
      <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><small>${k}</small><b>${v}</b></div>`).join('')}</div>
      <p class="section-title">Sold by line, each day you ran the shop</p>
      <div class="legend">${names.map((n, l) => `<span><i style="background:${LINE_INK[l]}"></i>${esc(n)}</span>`).join('')}<span class="muted">🧱 layout changed</span></div>
      <div class="chartbox"><svg viewBox="0 0 ${W} ${H}" class="rchart" role="img" aria-label="Units sold per day by product line">${grid}${bars}</svg><div class="tip hidden" id="repTip"></div></div>
      <p class="section-title">Busiest hours <span class="muted">· peak ${9 + best}:00–${10 + best}:00</span></p>
      <div class="chartbox"><svg viewBox="0 0 ${W} ${H2}" class="rchart" role="img" aria-label="Units sold by hour of the day">${hbars}</svg></div>
      <details class="tablev"><summary>Show as a table</summary><table><tr><th>Day</th>${names.map((n) => `<th>${esc(n)}</th>`).join('')}<th>Takings</th><th>Stolen</th><th>Goal</th></tr>
        ${days.map((d) => `<tr><td>${d.day}</td>${d.lineSold.map((n) => `<td>${n}</td>`).join('')}<td>${money(d.revenue)}</td><td>${d.stolen}</td><td>${d.goal ? '✅' : '❌'}</td></tr>`).join('')}</table></details>
      <p class="muted">Only days you ran the shop yourself are counted.</p>`);
    // tap or hover a day for its numbers
    const tip = $('repTip');
    for (const el of document.querySelectorAll('[data-tip]')) {
      const show = () => {
        const d = days[+el.dataset.tip], tot = d.lineSold.reduce((a, x) => a + x, 0);
        tip.innerHTML = `<b>Day ${d.day}</b> · ${tot} sold${d.lineSold.map((n, l) => `<div><i style="background:${LINE_INK[l]}"></i>${esc(d.lines[l])}<span>${n}</span></div>`).join('')}<div class="muted">${money(d.revenue)} · ${d.stolen} stolen</div>`;
        const box = el.getBoundingClientRect(), host = tip.parentElement.getBoundingClientRect();
        tip.style.left = `${Math.min(host.width - 150, Math.max(0, box.left - host.left + box.width / 2 - 75))}px`; tip.classList.remove('hidden');
      };
      el.addEventListener('pointerenter', show); el.addEventListener('click', show);
    }
    tip.parentElement.addEventListener('pointerleave', () => tip.classList.add('hidden'));
  }
  // a bar with rounded top corners only (its base sits on the axis)
  function roundTop(x, y, w, h, r) {
    if (h <= 0) return '';
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  // arrange the shop: drag the islands and floor props, choose the line on each shelving unit
  function openArrange(b) {
    const P = NeonShop.plan, names = P.lineNames(b), unitName = (i) => (P.shapes(b, lay).units.find((u) => u.i === i) || {}).name || 'Shelves';
    let lay = JSON.parse(JSON.stringify(b.layout || {})), pick = null;
    const trend = P.trend(s, b);
    openSheet(`<h2>🧱 Arrange your shop<button class="close" data-close>✕</button></h2>
      <p class="muted">Drag the islands and things on the floor. Tap a shelf to choose which line goes on it.</p>
      <canvas class="plan" id="planCv" aria-label="Your shop from above"></canvas>
      <div id="planInfo"></div>
      <p class="muted">${names.length > 1 ? `You sell ${names.map((n, i) => `<b style="color:${P.colors[i]}">${esc(n)}</b>`).join(', ')}. 🔥 Trending today: <b>${esc(names[trend])}</b>. ` : ''}Islands near the door get more impulse buys, but more shoplifters. 🧺 Baskets by the door make shoppers buy a bit more, and 🍬 sweets by the till sell at the counter.</p>
      <p class="section-title">🛒 Promotions</p><div id="promoBuy" class="decor"></div>
      <p class="section-title">🪑 Furniture</p><div id="furnBuy" class="decor"></div>
      <div class="btns"><button class="btn" id="planReset">↺ Reset</button><button class="btn primary" id="planSave">Save layout</button></div>`);
    const cv = $('planCv');
    // promotions: buy one (it's placed on the plan), then drag it and choose its line
    const promoList = () => {
      $('promoBuy').innerHTML = Object.entries(P.PROMOS).map(([id, pm]) => {
        const own = b.promos && b.promos[id];
        return `<button class="dec${own ? ' on' : ''}" data-promo="${id}"${own ? '' : s.cash < pm.cost ? ' disabled' : ''}><b>${pm.name}</b><small>${own ? '✓ Placed: drag it on the plan' : `${money(pm.cost)} · ${esc(pm.desc)}`}</small></button>`;
      }).join('');
      for (const el of document.querySelectorAll('[data-promo]')) el.onclick = () => {
        const id = el.dataset.promo, pm = P.PROMOS[id];
        if (b.promos && b.promos[id]) { pick = { type: 'promo', id }; draw(); info(); return; }
        if (s.cash < pm.cost) { toast(`You need ${money(pm.cost)}`); return; }
        s.cash -= pm.cost; b.promos = Object.assign({}, b.promos, { [id]: true }); save(); render();
        pick = { type: 'promo', id }; promoList(); draw(); info(); toast(`${pm.name} bought: drag it where you want it`);
      };
    };
    // furniture: buy it once, then drag it on the plan and turn it
    const furnList = () => {
      $('furnBuy').innerHTML = Object.entries(P.FURNITURE).map(([id, f]) => {
        const own = b.furniture && b.furniture[id];
        return `<button class="dec${own ? ' on' : ''}" data-furn="${id}"${own ? '' : s.cash < f.cost ? ' disabled' : ''}><b>${f.name}</b><small>${own ? '✓ Placed: drag or turn it' : `${money(f.cost)} · ${esc(f.desc)}`}</small></button>`;
      }).join('');
      for (const el of document.querySelectorAll('[data-furn]')) el.onclick = () => {
        const id = el.dataset.furn, f = P.FURNITURE[id];
        if (!(b.furniture && b.furniture[id])) {
          if (s.cash < f.cost) { toast(`You need ${money(f.cost)}`); return; }
          s.cash -= f.cost; b.furniture = Object.assign({}, b.furniture, { [id]: true }); save(); render();
          toast(`${f.name} bought: drag it where you want it`);
        }
        pick = { type: 'furn', id }; furnList(); draw(); info();
      };
    };
    const draw = () => drawPlanCanvas(cv, P.shapes(b, lay), { pick });
    const info = () => {
      if (!pick) { $('planInfo').innerHTML = ''; return; }
      if (pick.type === 'promo') {
        const pm = P.PROMOS[pick.id], cur = (lay.promos && lay.promos[pick.id] && lay.promos[pick.id].line) || 0;
        $('planInfo').innerHTML = `<p class="section-title">${pm.name} (drag to move)</p><p class="muted">${esc(pm.desc)}</p>
          <div class="linechips">${names.map((n, i) => `<button data-pline="${i}" class="${i === cur ? 'on' : ''}" style="border-color:${P.colors[i]};${i === cur ? `background:${P.colors[i]}33` : ''}">${esc(n)}</button>`).join('')}</div>`;
        for (const el of document.querySelectorAll('[data-pline]')) el.onclick = () => {
          lay.promos = lay.promos || {}; lay.promos[pick.id] = Object.assign({}, lay.promos[pick.id], { line: +el.dataset.pline }); draw(); info();
        };
        return;
      }
      if (pick.type === 'furn') {
        const f = P.FURNITURE[pick.id];
        $('planInfo').innerHTML = `<p class="section-title">${f.name} (drag to move)</p><p class="muted">${esc(f.desc)}</p><div class="btns"><button class="btn" id="furnTurn">⟳ Turn</button></div>`;
        $('furnTurn').onclick = () => { lay.furn = lay.furn || {}; const cur = lay.furn[pick.id] || {}; lay.furn[pick.id] = Object.assign({}, cur, { rot: ((cur.rot || 0) + 1) % 4 }); draw(); };
        return;
      }
      if (pick.type === 'prop') { $('planInfo').innerHTML = `<p class="muted">${P.PROP_KINDS[P.shapes(b, lay).props[pick.i].kind]}: drag it anywhere on the floor.</p>`; return; }
      const cur = P.unitLines(Object.assign({}, b, { layout: lay }))[pick.i];
      $('planInfo').innerHTML = `<p class="section-title">${unitName(pick.i)}${pick.i === 2 || pick.i === 3 ? ' (drag to move)' : ''}</p>
        <div class="linechips">${names.map((n, i) => `<button data-line="${i}" class="${i === cur ? 'on' : ''}" style="border-color:${P.colors[i]};${i === cur ? `background:${P.colors[i]}33` : ''}">${esc(n)}${i === trend ? ' 🔥' : ''}</button>`).join('')}</div>`;
      for (const el of document.querySelectorAll('[data-line]')) el.onclick = () => {
        lay.lines = P.unitLines(Object.assign({}, b, { layout: lay })); lay.lines[pick.i] = +el.dataset.line; draw(); info();
      };
    };
    let down = null;
    const at = (e) => { const rc = cv.getBoundingClientRect(); return [e.clientX - rc.left, e.clientY - rc.top]; };
    cv.addEventListener('pointerdown', (e) => { try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ } const [x, y] = at(e); pick = P.hit(cv.clientWidth, cv.clientHeight, P.shapes(b, lay), x, y); down = pick; draw(); info(); });
    cv.addEventListener('pointermove', (e) => { if (!down) return; const [x, y] = at(e); lay = P.move(b, lay, down, cv.clientWidth, cv.clientHeight, x, y); draw(); });
    const up = () => { down = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    $('planReset').onclick = () => { lay = {}; pick = null; draw(); info(); };
    promoList(); furnList();
    $('planSave').onclick = () => { b.layout = lay; save(); closeSheet(); toast('🧱 Layout saved: you\'ll see it next time you open the shop'); };
    draw();
  }
  $('shopServe').addEventListener('click', () => NeonShop.serve());
  {
    const cv = $('shopCanvas'), pts = new Map();
    let mode = null, start = null, last = null, pinch = 0, mid = null;
    const at = (e) => { const rc = cv.getBoundingClientRect(); return [e.clientX - rc.left, e.clientY - rc.top]; };
    const gap = () => { const [a, b] = [...pts.values()]; return [Math.hypot(a[0] - b[0], a[1] - b[1]), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    cv.addEventListener('pointerdown', (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      pts.set(e.pointerId, at(e));
      if (pts.size === 2) { if (mode === 'drag') NeonShop.pointerUp(); mode = 'pinch'; pinch = gap()[0]; mid = null; return; }
      start = last = at(e);
      mode = NeonShop.pointerDown(...start) === 'drag' ? 'drag' : 'press';
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = at(e); pts.set(e.pointerId, p);
      if (mode === 'pinch' && pts.size === 2) {
        const [d, mx, my] = gap();
        if (pinch) NeonShop.zoomBy(d / pinch, mx, my);
        if (mid && NeonShop.is3D()) NeonShop.panBy(mx - mid[0], my - mid[1]); // two fingers slide the 3D view
        pinch = d; mid = [mx, my]; return;
      }
      if (mode === 'drag') { NeonShop.pointerMove(...p); return; }
      if (mode === 'press' && Math.hypot(p[0] - start[0], p[1] - start[1]) > 10) mode = 'pan';
      if (mode === 'pan') NeonShop.orbit(p[0] - last[0], p[1] - last[1]);
      last = p;
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      if (mode === 'drag') { if (NeonShop.pointerUp() === 'stocked') toast('📦 Shelf stocked by hand!'); }
      else if (mode === 'press') { if (NeonShop.tap(...start) === 'team') openTeam(); }
      if (!pts.size) mode = null; else if (mode === 'pinch') mode = 'done';
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }
  $('shopZoom').onclick = () => NeonShop.resetZoom();
  $('shopTeam').onclick = () => openTeam();
  // first person: see the shop through your own eyes; the joystick walks, dragging the view turns your head
  $('shopFP').onclick = () => { const on = NeonShop.firstPerson(!NeonShop.isFirstPerson()); if (on) toast('👁️ First person: the stick walks, drag to look around'); };
  {
    const st = $('fpStick'), knob = st.querySelector('i');
    let id = null;
    const move = (e) => {
      const rc = st.getBoundingClientRect(), R = rc.width / 2;
      let dx = (e.clientX - rc.left - R) / R, dy = (e.clientY - rc.top - R) / R; const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      knob.style.transform = `translate(${dx * R * 0.55}px, ${dy * R * 0.55}px)`;
      NeonShop.fpStick(Math.abs(dx) < 0.15 ? 0 : dx, Math.abs(dy) < 0.15 ? 0 : dy);
    };
    const end = () => { id = null; knob.style.transform = ''; NeonShop.fpStick(0, 0); };
    st.addEventListener('pointerdown', (e) => { id = e.pointerId; try { st.setPointerCapture(id); } catch { /* ignore */ } move(e); e.stopPropagation(); });
    st.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
  }
  // online orders: pack one and a rider takes it
  let onlineOpen = false, onlineSig = '';
  const onlineRows = () => { const l = NeonShop.online() || []; return l.length ? l.map((o) => `<div class="row"><span class="ic">📦</span><span class="nm"><b>${esc(o.name)}: ${o.qty}× ${esc(o.line)}</b><small><span data-left="${o.id}">${o.late ? '⏰ Late: they\'ll get 30% back' : `Deliver in ${o.left}s`}</span>${o.stock ? '' : ' · not enough in stock'}</small></span><span class="px"><button class="btn primary" data-pack="${o.id}"${o.stock ? '' : ' disabled'}>Pack & send 🛵</button></span></div>`).join('') : '<p class="muted">No orders waiting. They ping in on the tablet through the day.</p>'; };
  $('shopOnline').onclick = () => {
    onlineOpen = true; onlineSig = (NeonShop.online() || []).map((o) => `${o.id}${o.stock}${o.late}`).join();
    openSheet(`<h2>📱 Online orders<button class="close" data-close>✕</button></h2><p class="muted">Pack an order from your stock and a rider takes it out. The platform keeps 15%; you get a $3 delivery fee. Too slow and they cancel. Put someone on 📱 Online orders (👥) to pack for you.</p><div id="onlineList">${onlineRows()}</div>`);
  };
  $('sheetBody').addEventListener('click', (e) => {
    const el = e.target.closest('[data-pack]'); if (!el) return;
    const r = NeonShop.packOrder(+el.dataset.pack, 'you');
    toast(r.ok ? `🛵 On its way${r.late ? ' (late)' : ''}!` : r.msg);
    if ($('onlineList')) $('onlineList').innerHTML = onlineRows();
  });
  // photo mode: hide the buttons, turn the shop to the angle you like, save the picture
  $('shopPhoto').onclick = () => { $('shopView').classList.add('photo'); toast(NeonShop.is3D() ? '📷 Drag to turn, pinch to zoom, then 📸' : '📷 Pinch to zoom, then 📸'); };
  $('photoDone').onclick = () => $('shopView').classList.remove('photo');
  // post this view to NeonGram: more followers, a few more shoppers at every shop
  $('photoPost').onclick = () => {
    const r = NeonShop.current(); if (!r) return;
    if (visiting) { toast('📤 Post from your own shop to gain followers'); return; }
    const dec = window.NeonShopArt.decor(), quality = Math.min(1, ((r.b.rating || 3) - 2) / 3 * 0.6 + ((r.furn || []).length + (dec.floor.cost ? 1 : 0) + (dec.sign.cost ? 1 : 0)) * 0.08 + (NeonShop.snapshot() ? 0.1 : 0));
    const res = T.postPhoto(s, r.b.id, quality);
    if (!res.ok) { toast(res.msg); return; }
    save(); toast(`📤 Posted to NeonGram: +${res.gain} followers (${res.followers.toLocaleString()})`);
  };
  $('photoSnap').onclick = async () => {
    const url = NeonShop.snapshot(); if (!url) return;
    const r = NeonShop.current(), name = `neon-shop-day-${r ? r.s.day : ''}.jpg`;
    try { // share it on a phone, or download it
      const blob = await (await fetch(url)).blob(), file = new File([blob], name, { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'My Neon Tycoon shop' }); return; }
    } catch { /* fall back to a download */ }
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    toast('📸 Saved!');
  };
  // your team in the shop: energy, mood, and a job for each (it updates while it's open)
  let teamTimer = 0;
  function openTeam() {
    const col = (v) => (v > 50 ? '#4ade80' : v > 25 ? '#ffd23f' : '#ff6b6b');
    openSheet(`<h2>👥 Your team<button class="close" data-close>✕</button></h2>
      <p class="muted">Give each helper a job. 🧾 serves at the till, 📦 restocks the shelves from the stockroom, 🚪 guards the door (stops most shoplifters), ☕ rests until full of energy.</p>
      <div id="teamList">${NeonShop.team().map((m) => `<div class="card teamcard"><h3>${m.icon} ${esc(m.name)}${m.sup ? ' ⭐' : ''} <small class="muted">Lv ${m.level} · ${m.trait.icon} ${esc(m.trait.name)} · served <span data-served="${m.i}">${m.served}</span>${m.strike ? ' · 🪧 on strike' : ''}</small></h3>
        <div class="bars"><span>⚡ Energy</span><i class="bar"><b data-energy="${m.i}"></b></i><span>😊 Mood</span><i class="bar"><b data-morale="${m.i}"></b></i></div>
        <div class="linechips">${Object.entries(NeonShop.JOBS).filter(([id]) => id !== 'online' || (NeonShop.current() && NeonShop.current().up.online)).map(([id, label]) => `<button data-job="${m.i}:${id}">${label}</button>`).join('')}</div>
        <p class="warn hidden" data-tired="${m.i}">Worn out: slow, and fumbling packs. A break helps.</p></div>`).join('')}</div>`);
    // refresh the bars and the chosen job in place, so a tap never lands on a button that's being redrawn
    const update = () => {
      if (!NeonShop.active() || $('sheet').classList.contains('hidden') || !$('teamList')) { clearInterval(teamTimer); return; }
      for (const m of NeonShop.team()) {
        const e = document.querySelector(`[data-energy="${m.i}"]`), mo = document.querySelector(`[data-morale="${m.i}"]`);
        e.style.width = `${m.energy}%`; e.style.background = col(m.energy); mo.style.width = `${m.morale}%`; mo.style.background = col(m.morale);
        document.querySelector(`[data-served="${m.i}"]`).textContent = m.served;
        document.querySelector(`[data-tired="${m.i}"]`).classList.toggle('hidden', m.energy >= 30);
        for (const b of document.querySelectorAll(`[data-job^="${m.i}:"]`)) b.classList.toggle('on', b.dataset.job.split(':')[1] === m.job);
      }
    };
    for (const el of document.querySelectorAll('[data-job]')) el.onclick = () => { const [i, job] = el.dataset.job.split(':'); NeonShop.setJob(+i, job); update(); };
    update(); clearInterval(teamTimer); teamTimer = setInterval(update, 700);
  }
  $('shopWalk').onclick = () => {
    const night = NeonShop.night();
    if (night && night.active) { NeonShop.endNight(); return; }
    const res = NeonShop.toggleWalk();
    if (res === 'nocover') toast('🧾 Open Till 2 or hire a cashier first, so someone serves while you walk the floor.');
    else if (res === 'walking') toast('🚶 Tap the floor to walk. Tap a shopper to go to them.');
  };
  $('shopActs').addEventListener('click', (e) => { const el = e.target.closest('[data-do]'); if (el) NeonShop.act(el.dataset.do); });
  for (const el of document.querySelectorAll('[data-night]')) el.onclick = () => { if (NeonShop.nightShift(el.dataset.night === 'yes') && el.dataset.night === 'yes') toast('🧹 Mop the scuffs, face the shelves, pick up packs, empty the bin. Tap the floor to walk.'); };
  for (const el of document.querySelectorAll('[data-req]')) el.onclick = () => { if (NeonShop.answerRequest(el.dataset.req === 'yes')) toast(el.dataset.req === 'yes' ? '📝 Order taken: have it on the shelves when they come in' : 'Order turned down'); };
  for (const el of document.querySelectorAll('[data-ret]')) el.onclick = () => NeonShop.resolveReturn(el.dataset.ret);
  $('shopTill').onclick = () => { const on = NeonShop.toggleTill2(); toast(on ? '🧾 The clerk opens till 2' : 'Till 2 closed: the clerk is back on the shop floor'); };
  $('shopUp').onclick = () => { const r = NeonShop.current(); if (r) { if (priceFor === 'all') nudgePrice(r.b, 0.05); else NeonShop.nudgeLine(priceFor, 0.05); } };
  $('shopDown').onclick = () => { const r = NeonShop.current(); if (r) { if (priceFor === 'all') nudgePrice(r.b, -0.05); else NeonShop.nudgeLine(priceFor, -0.05); } };
  $('lineChips').addEventListener('click', (e) => { const el = e.target.closest('[data-pfor]'); if (el) priceFor = el.dataset.pfor === 'all' ? 'all' : +el.dataset.pfor; });
  $('shopRefill').onclick = () => { const r = NeonShop.current(); if (r) openSupplies(r.b); };
  $('shopClose').onclick = () => NeonShop.closeEarly();
  $('shopEvent').onclick = () => { if (NeonShop.callPlumber()) toast('📞 Plumber called: $80, here in a few seconds'); };

  // ---------- Exchange ----------
  function exchangeHtml() {
    let total = 0;
    for (const k of T.STOCKS) total += s.shares[k.id] * s.stocks[k.id];
    let h = `<div class="card"><h3>📈 Neon Exchange</h3><p>Shares in Neon City companies. They drift on their own and jump on the news: food news moves Pixel Foods, chip news moves ChipWorks. 1% fee per trade.</p>
      <p style="margin-top:6px">Your shares are worth <b>${money(total)}</b>.</p></div>`;
    for (const k of T.STOCKS) {
      const own = s.shares[k.id];
      h += `<button class="row" data-act="stock:${k.id}"><span class="ic">${k.icon}</span>
        <span class="nm"><b>${k.name}${own ? `<span class="badge">${own}</span>` : ''}</b><small>${k.id}${own ? ` · yours ${money(own * s.stocks[k.id])}` : ''}</small></span>
        <canvas class="spark" data-spark="k:${k.id}" aria-hidden="true"></canvas>
        <span class="px"><b>${price2(s.stocks[k.id])}</b>${change(s.hist.stocks[k.id])}</span></button>`;
    }
    return h;
  }

  function openStock(sym) {
    const k = T.STOCKS.find((x) => x.id === sym), hist = s.hist.stocks[sym];
    openSheet(`<h2>${k.icon} ${k.name}<button class="close" data-close>✕</button></h2>
      <p class="muted">${sym} · ${price2(s.stocks[sym])} a share · you own <b>${s.shares[sym]}</b> (${money(s.shares[sym] * s.stocks[sym])})</p>
      <canvas class="chart" id="kChart" aria-label="${k.name} share price, last ${hist.length} days"></canvas>
      ${qtyControl('kQty', T.maxShares(s, sym))}
      <div class="btns"><button class="btn" id="kMax">Max buy (${T.maxShares(s, sym)})</button><button class="btn" id="kAll">Sell all (${s.shares[sym]})</button></div>
      <div class="trade"><button class="btn cyan" id="kBuy">Buy</button><button class="btn primary" id="kSell">Sell</button></div>`);
    lineChart($('kChart'), [{ data: hist, color: COLORS.you, label: k.name }], dayLabels(hist.length, s.day), price2);
    const update = () => {
      const q = qty();
      $('kBuy').textContent = `Buy ${q} · ${money(q * s.stocks[sym] * 1.01)}`;
      $('kSell').textContent = `Sell ${Math.min(q, s.shares[sym])} · ${money(Math.min(q, s.shares[sym]) * s.stocks[sym] * 0.99)}`;
    };
    const qty = bindQty('kQty', update);
    $('kMax').onclick = () => { $('kQty').value = T.maxShares(s, sym); update(); };
    $('kAll').onclick = () => { $('kQty').value = s.shares[sym]; update(); };
    $('kBuy').onclick = () => { const q = qty(); if (result(T.trade(s, sym, q), `Bought ${q} ${sym}`)) openStock(sym); };
    $('kSell').onclick = () => { const q = Math.min(qty(), s.shares[sym]); if (result(T.trade(s, sym, -q), `Sold ${q} ${sym}`)) openStock(sym); };
    update();
  }

  // ---------- Bank ----------
  function bankHtml() {
    const room = Math.max(0, T.maxDebt(s) - s.debt);
    const amounts = (kind) => [100, 1000, 10000].map((a) => `<button class="btn" data-act="bank:${kind}:${a}">${compact(a)}</button>`).join('') + `<button class="btn" data-act="bank:${kind}:all">All</button>`;
    return `<div class="card"><h3>💵 Cash on hand <span class="num" style="margin-left:auto">${money(s.cash)}</span></h3>
        <p>Pickpockets sometimes take a cut of big cash piles. The bank is safe.</p></div>
      <div class="card"><h3>🏦 Savings <span class="num" style="margin-left:auto">${money(s.bank)}</span></h3>
        <p>Earns ${(T.DEPOSIT_RATE * 100).toFixed(1)}% a day.</p>
        <p class="section-title">Deposit</p><div class="btns">${amounts('deposit')}</div>
        <p class="section-title">Withdraw</p><div class="btns">${amounts('withdraw')}</div></div>
      <div class="card"><h3>📄 Loan <span class="num down" style="margin-left:auto">${money(s.debt)}</span></h3>
        <p>Costs ${(T.LOAN_RATE * 100).toFixed(1)}% a day (${money(s.debt * T.LOAN_RATE)} today). You can borrow ${money(room)} more.</p>
        <p class="section-title">Repay</p><div class="btns">${amounts('repay')}</div>
        <p class="section-title">Borrow</p><div class="btns">${amounts('borrow')}</div></div>
      <div class="card"><h3>🛡️ Insurance <span class="num" style="margin-left:auto">${money(T.policyCost(s))}/day</span></h3>
        <p class="muted">Rare but costly: fires, break-ins (more likely if you're open late), floods (more on wet days) and broken equipment. Each policy is charged per shop; you pay the first $${T.EXCESS} of a claim.</p>
        <div class="decor">${Object.entries(T.POLICIES).map(([k, p]) => `<button class="dec${(s.insurance || {})[k] ? ' on' : ''}" data-act="policy:${k}"><b>${p.icon} ${p.name}</b><small>${(s.insurance || {})[k] ? '✓ Covered' : `${money(p.daily)}/day per shop`} · ${esc(p.desc)}</small></button>`).join('')}</div></div>
      ${flowHtml()}`;
  }
  // the cash flow: money in and out over the last week, and the tax coming up
  function flowHtml() {
    const days = (s.flow || []).slice(-7);
    if (!days.length) return '<div class="card"><h3>📒 Cash flow</h3><p class="muted">After your first day you\'ll see money in and out here.</p></div>';
    const rows = [['Sales', 'sales', 1], ['Rent', 'rent', -1], ['Wages', 'wages', -1], ['Workshops', 'production', -1], ['Stock bought', 'stock', -1], ['Upgrades & fees', 'other', -1], ['Living costs', 'living', -1], ['Loan interest', 'interest', -1], ['Tax', 'tax', -1]];
    const tot = (k) => days.reduce((a, d) => a + (d[k] || 0), 0);
    const net = rows.reduce((a, [, k, sg]) => a + sg * tot(k), 0), nextTax = 7 - (s.day - 1) % 7;
    return `<div class="card"><h3>📒 Cash flow <span class="muted" style="margin-left:auto;font-size:12px">last ${days.length} day${days.length === 1 ? '' : 's'}</span></h3>
      <div class="kv">${rows.filter(([, k]) => tot(k)).map(([n, k, sg]) => `<span>${n}</span><span class="num ${sg > 0 ? 'up' : 'down'}">${sg > 0 ? '+' : '−'}${money(tot(k))}</span>`).join('')}
        <span><b>Net</b></span><span class="num ${net >= 0 ? 'up' : 'down'}"><b>${net >= 0 ? '+' : '−'}${money(Math.abs(net))}</b></span></div>
      <p class="muted">🧾 Business tax: ${Math.round(T.TAX_RATE * 100)}% of each week's profit, due in ${nextTax} day${nextTax === 1 ? '' : 's'}${s.week > 0 ? ` (about ${money(s.week * T.TAX_RATE)} so far)` : ''}. 📜 Shop rents are reviewed every ${T.LEASE_DAYS} days.</p></div>`;
  }
  function bankAction(kind, amt) {
    const all = { deposit: s.cash, withdraw: s.bank, repay: Math.min(s.debt, s.cash), borrow: Math.max(0, T.maxDebt(s) - s.debt) }[kind];
    const n = amt === 'all' ? all : Math.min(parseInt(amt, 10), all || parseInt(amt, 10));
    result(T.bankMove(s, kind, n), { deposit: 'Deposited', withdraw: 'Withdrawn', repay: 'Repaid', borrow: 'Borrowed' }[kind] + ' ' + money(n));
  }

  // ---------- Stats ----------
  function breakdown() {
    let cargo = 0, biz = 0, shares = 0;
    for (const [g, q] of Object.entries(s.cargo)) cargo += q * T.DISTRICTS.reduce((a, d) => a + T.price(s, d.id, g), 0) / T.DISTRICTS.length * 0.9;
    for (const b of s.businesses) biz += b.invested * T.RESALE + b.stock * T.G[b.good].base * (b.kind === 'stall' ? 0.9 : T.PRODUCE_COST);
    for (const k of T.STOCKS) shares += s.shares[k.id] * s.stocks[k.id];
    return [['Cash', s.cash], ['Savings', s.bank], ['Cargo', cargo], ['Businesses', biz], ['Shares', shares], ['Ride', T.VEHICLES[s.vehicle].cost * 0.5], ['Loan', -s.debt]];
  }
  function statsHtml() {
    const nw = T.netWorth(s), rank = T.rankFor(nw);
    const next = T.RANKS.find(([min]) => min > nw);
    const legend = s.challenge ? `<div class="legend"><span><i style="background:${COLORS.you}"></i>${esc(youLabel())}</span><span><i style="background:${COLORS.friend}"></i>${esc(s.challenge.name)}</span></div>` : '';
    return `<div class="card"><h3>🏆 ${rank}</h3>
        <p>Net worth <b>${money(nw)}</b>${next ? ` · ${money(next[0] - nw)} to <b>${next[1]}</b>` : ' · top rank!'}</p>
        ${next ? `<div class="bar"><i style="width:${Math.max(2, Math.min(100, (nw / next[0]) * 100))}%;background:var(--gold)"></i></div>` : ''}</div>
      <div class="card"><h3>Net worth this season</h3>${legend}<canvas class="chart" id="nwChart" aria-label="Net worth by day"></canvas></div>
      <div class="card"><h3>Where your money is</h3><div class="kv">${breakdown().map(([k, v]) => `<span>${k}</span><span class="${v < 0 ? 'down' : ''}">${money(v)}</span>`).join('')}</div></div>
      ${trophiesHtml()}
      <div class="btns"><button class="btn" data-act="settings">⚙️ Settings</button><button class="btn" data-act="challenges">🏆 Challenge days</button><button class="btn" data-act="weekly">🗓️ Weekly</button><button class="btn" data-act="guide">📖 Guide</button></div>`;
  }
  function drawNetWorthChart(cv, days = s.hist.nw.length) {
    const mine = s.hist.nw.slice(0, days);
    const series = [{ data: mine, color: COLORS.you, label: 'You' }];
    if (s.challenge) {
      const n = Math.max(mine.length, Math.min(T.SEASON_DAYS, (s.challenge.curve.length - 1) * 10 + 1));
      series.push({ data: Array.from({ length: n }, (_, i) => ghostAt(i + 1)), color: COLORS.friend, label: s.challenge.name });
    }
    // point i is the start of day i+1; the point after day 120 is the end of the season
    lineChart(cv, series, Array.from({ length: Math.max(...series.map((x) => x.data.length)) }, (_, i) => (i >= T.SEASON_DAYS ? 'End' : `Day ${i + 1}`)), compact);
  }

  // ---------- sheets ----------
  function openSheet(html) {
    $('sheetBody').innerHTML = html;
    $('sheet').classList.remove('hidden');
    for (const b of $('sheetBody').querySelectorAll('[data-close]')) b.onclick = closeSheet;
  }
  function closeSheet() { $('sheet').classList.add('hidden'); onlineOpen = false; }
  $('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

  // ---------- days & travel ----------
  function openTravel() {
    openSheet(`<h2>🗺️ Where to?<button class="close" data-close>✕</button></h2>
      <canvas class="citymap" id="cityMap" aria-label="Map of Neon City: tap a district to go there"></canvas>
      <p class="muted">Travelling takes the rest of the day. Tap a district on the map, or pick one below.</p>
      ${T.DISTRICTS.map((d) => {
        const wants = T.GOODS.filter((g) => d.mods[g.id] >= 1.2).map((g) => g.icon).join(' ');
        const cheap = T.GOODS.filter((g) => d.mods[g.id] <= 0.8).map((g) => g.icon).join(' ');
        const mine = s.businesses.filter((b) => b.district === d.id).length;
        return `<button class="district${d.id === s.district ? ' here' : ''}" data-go="${d.id}"><span class="ic">${d.icon}</span>
          <span><b>${d.name}${d.id === s.district ? ' (you are here)' : ''}</b><small>${d.blurb}</small>
          <small>${cheap ? `Cheap: ${cheap}` : ''}${cheap && wants ? ' · ' : ''}${wants ? `Pays well: ${wants}` : ''}${mine ? ` · 🏪 ${mine} yours` : ''}</small></span></button>`;
      }).join('')}`);
    for (const b of document.querySelectorAll('[data-go]')) b.onclick = () => (b.dataset.go === s.district ? endDay(null) : endDay(b.dataset.go));
    const cv = $('cityMap');
    drawCityMap(cv);
    cv.onclick = (e) => {
      const rc = cv.getBoundingClientRect(), x = (e.clientX - rc.left) / rc.width, y = (e.clientY - rc.top) / rc.height;
      const near = T.DISTRICTS.map((d) => [d, Math.hypot(MAP_AT[d.id][0] - x, (MAP_AT[d.id][1] - y) * 0.7)]).sort((a, b) => a[1] - b[1])[0];
      if (near && near[1] < 0.14) { const btn = document.querySelector(`[data-go="${near[0].id}"]`); if (btn) btn.scrollIntoView({ block: 'nearest' }); btn && btn.classList.add('flash'); setTimeout(() => btn && btn.click(), 250); }
    };
  }

  function endDay(dest) {
    if (s.finished) { showSeasonEnd(); return; }
    const rep = T.endDay(s, dest);
    save();
    if (s.news.some((n) => n.text.includes('paid off the mortgage'))) achCount({ paidoff: 1 }); else achCheck();
    render();
    const d = rep.nw - rep.nw0;
    const lines = rep.lines.length ? `<p class="section-title">Your businesses</p><div class="news">${rep.lines.map((l) => `<div><span>${l.icon}</span><span>${esc(l.text)}</span></div>`).join('')}</div>` : '';
    const news = s.news.length ? `<p class="section-title">News</p><div class="news">${s.news.map((n) => `<div><span>${n.icon}</span><span>${esc(n.text)}</span></div>`).join('')}</div>` : '<p class="muted">A quiet day in Neon City.</p>';
    openSheet(`<h2>☀️ Day ${Math.min(s.day, T.SEASON_DAYS)}${dest ? ` · ${T.D[s.district].icon} ${T.D[s.district].name}` : ''}</h2>
      <div><span class="big-num">${compact(rep.nw)}</span> <b class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${money(Math.abs(d))}</b></div>
      ${news}${lines}
      ${s.finished ? '' : forecastHtml()}
      <div class="kv">${rep.sales ? `<span>Stall sales</span><span class="up">+${money(rep.sales)}</span>` : ''}${rep.production ? `<span>Production</span><span class="down">-${money(rep.production)}</span>` : ''}
        ${rep.upkeep ? `<span>Rent & upkeep</span><span class="down">-${money(rep.upkeep)}</span>` : ''}<span>Living costs</span><span class="down">-${money(rep.living)}</span>
        ${rep.interest ? `<span>Loan interest</span><span class="down">-${money(rep.interest)}</span>` : ''}${rep.earned ? `<span>Savings interest</span><span class="up">+${money(rep.earned)}</span>` : ''}</div>
      <button class="btn primary" data-close>${s.finished ? 'See final results' : 'Continue'}</button>`);
    if (s.finished) for (const b of $('sheetBody').querySelectorAll('[data-close]')) b.onclick = showSeasonEnd;
  }

  // ---------- visit a friend's shop: a link carries its layout, decor and stock, and opens a copy to walk round ----------
  const b64 = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = (str) => decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/'))));
  function encodeShop(b) {
    const d = window.NeonShopArt.loadDecor(), dec = {};
    for (const k of Object.keys(window.NeonShopArt.DECOR)) dec[k] = d[k];
    return b64(JSON.stringify({ v: 1, n: playerName() === 'You' ? '' : playerName(), g: b.good, t: b.tier, d: b.district, L: b.layout || {}, P: b.promos || {}, F: b.furniture || {}, lp: b.linePrice || null, u: b.upgrades || {}, r: b.rating || 0, m: b.mult || T.RETAIL, dec, st: T.staffOf(b).map((m) => [m.name, m.skill, m.look || 0]) }));
  }
  function decodeShop(code) {
    const v = JSON.parse(unb64(code));
    if (!v || v.v !== 1 || !T.G[v.g] || !T.D[v.d] || !T.STALLS[v.t]) throw new Error('bad shop');
    return v;
  }
  async function shareShop(b) {
    const url = `${location.origin}${location.pathname}?visit=${encodeShop(b)}`;
    const text = `🏪 Come and look round my ${T.STALLS[b.tier].name.toLowerCase()} in Neon Tycoon!`;
    try { if (navigator.share) { await navigator.share({ title: 'My Neon Tycoon shop', text, url }); return; } } catch { /* fall back to copying */ }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast('🔗 Link copied: send it to a friend'); } catch { openSheet(`<h2>🔗 Share your shop<button class="close" data-close>✕</button></h2><p>Send this link to a friend:</p><textarea class="sharebox" readonly>${esc(url)}</textarea>`); }
  }
  let pendingVisit = null;
  // a copy of their shop in a throwaway season: serve, walk round, take photos; nothing is saved
  function openVisit(v) {
    const vs = T.newGame(T.newSeed(), { name: v.n });
    vs.district = v.d; vs.cash = 1e6; vs.debt = 0; vs.day = 9;
    T.openBusiness(vs, 'stall', v.g);
    const b = vs.businesses[0];
    Object.assign(b, { tier: v.t, layout: v.L, promos: v.P, furniture: v.F, upgrades: v.u, rating: v.r || undefined, mult: v.m });
    if (v.lp) b.linePrice = v.lp;
    b.stock = T.unitsPerDay(T.STALLS[b.tier].cap, b.good) * 2;
    b.staff = (v.st || []).slice(0, T.STAFF_SLOTS[b.tier] + 2).map(([name, skill, look]) => ({ name, skill: T.SKILLS[skill] ? skill : 'cashier', wage: 0, morale: 80, look }));
    visiting = { name: v.n || 'A friend', v };
    window.NeonShopArt.setOverride(v.dec);
    s = vs;
    openShop(b);
    $('shopTitle').textContent = `👀 ${visiting.name}'s ${T.STALLS[b.tier].name.toLowerCase()}`;
  }
  function visitEnd(m) {
    const who = visiting.name, v = visiting.v;
    visiting = null; window.NeonShopArt.setOverride(null); s = null;
    showTitle();
    openSheet(`<h2>👋 Thanks for visiting!</h2><p>You looked round <b>${esc(who)}</b>'s shop and served ${m.served} shopper${m.served === 1 ? '' : 's'} for ${money(m.revenue + (m.extras || 0))}. Nothing from the visit is saved.</p>
      <p class="muted">Want your own? Start a season, open a stall and share it back with 🔗 Share shop.</p><div class="btns"><button class="btn primary" id="visitRate">💌 Rate their shop</button><button class="btn" data-close>Done</button></div>`);
    $('visitRate').onclick = () => openRate(v, m);
  }
  // a challenge day is over: back to where you were (your season, or the title)
  let challengeFromGame = false, savedGame = null;
  function challengeOver(m) {
    const c = visiting.challenge;
    visiting = null; s = savedGame; savedGame = null;
    if (s) { $('title').classList.add('hidden'); $('game').classList.remove('hidden'); render(); } else showTitle();
    challengeEnd(c, m);
  }

  // ---------- achievements: badges for milestones (kept across seasons), each with arcade coins ----------
  const ACH = [
    { id: 'first', icon: '🛎️', name: 'First customer', desc: 'Serve your first shopper.', coins: 10, test: (c) => c.served >= 1 },
    { id: 'serve100', icon: '💯', name: 'Regular trade', desc: 'Serve 100 shoppers yourself.', coins: 40, test: (c) => c.served >= 100 },
    { id: 'serve1000', icon: '🏅', name: 'Till legend', desc: 'Serve 1,000 shoppers yourself.', coins: 150, test: (c) => c.served >= 1000 },
    { id: 'shop', icon: '🏪', name: 'Moving up', desc: 'Upgrade a stall to a shop.', coins: 30, test: (c, s) => s && s.businesses.some((b) => b.kind === 'stall' && b.tier >= 1) },
    { id: 'mega', icon: '🏬', name: 'Megastore', desc: 'Own a megastore.', coins: 100, test: (c, s) => s && s.businesses.some((b) => b.kind === 'stall' && b.tier >= 2) },
    { id: 'empire', icon: '🗺️', name: 'Empire', desc: 'Run five businesses at once.', coins: 80, test: (c, s) => s && s.businesses.length >= 5 },
    { id: 'owner', icon: '🏠', name: 'Landlord', desc: 'Own the building your shop is in.', coins: 50, test: (c, s) => s && s.businesses.some((b) => b.owned) },
    { id: 'paidoff', icon: '🔑', name: 'Mortgage free', desc: 'Pay off a mortgage.', coins: 80, test: (c) => c.paidoff >= 1 },
    { id: 'wh', icon: '📦', name: 'Stockpile', desc: 'Rent storage space.', coins: 20, test: (c, s) => s && Object.keys(s.warehouses || {}).length > 0 },
    { id: 'dc', icon: '🚚', name: 'Distribution', desc: 'Grow a warehouse into a distribution centre.', coins: 120, test: (c, s) => s && Object.values(s.warehouses || {}).some((w) => w.tier >= 2) },
    { id: 'bigger', icon: '🧱', name: 'Knock through', desc: 'Expand a shop\'s floor to the max.', coins: 60, test: (c, s) => s && s.businesses.some((b) => T.expOf(b).floor >= 2) },
    { id: 'regulars', icon: '💳', name: 'Loyal crowd', desc: 'Have 10 regulars at one shop.', coins: 50, test: (c, s) => s && s.businesses.some((b) => (b.regulars || []).length >= 10) },
    { id: 'thief10', icon: '👮', name: 'Shop guard', desc: 'Catch 10 shoplifters.', coins: 50, test: (c) => c.caught >= 10 },
    { id: 'five', icon: '⭐', name: 'Five stars', desc: 'Earn a 5★ day.', coins: 40, test: (c) => c.five >= 1 },
    { id: 'streak', icon: '🔥', name: 'On a roll', desc: 'Meet the daily goal 5 days running.', coins: 60, test: (c) => c.streak >= 5 },
    { id: 'clean', icon: '📋', name: 'Spotless', desc: 'Pass a health inspection.', coins: 40, test: (c) => c.inspect >= 1 },
    { id: 'celeb', icon: '📸', name: 'Star struck', desc: 'Keep a celebrity happy.', coins: 40, test: (c) => c.celeb >= 1 },
    { id: 'critic', icon: '📰', name: 'Rave review', desc: 'Get 4★ or more from the food critic.', coins: 60, test: (c) => c.critic >= 1 },
    { id: 'online', icon: '🛵', name: 'Delivered', desc: 'Send out 25 online orders.', coins: 60, test: (c) => c.online >= 25 },
    { id: 'gram', icon: '📲', name: 'Influencer', desc: 'Reach 1,000 NeonGram followers.', coins: 60, test: (c, s) => s && (s.followers || 0) >= 1000 },
    { id: 'manager', icon: '🎓', name: 'Top manager', desc: 'Train a manager to level 5.', coins: 70, test: (c, s) => s && s.businesses.some((b) => b.manager && b.manager.level >= 5) },
    { id: 'rich', icon: '💰', name: 'Shop Owner', desc: 'Reach a $60k net worth.', coins: 50, test: (c, s) => s && T.netWorth(s) >= 60000 },
    { id: 'tycoon', icon: '👑', name: 'Neon Tycoon', desc: 'Reach a $600k net worth.', coins: 200, test: (c, s) => s && T.netWorth(s) >= 600000 },
    { id: 'season', icon: '🏁', name: 'Full season', desc: 'Finish a 120-day season.', coins: 50, test: (c, s) => s && s.finished },
    { id: 'challenge3', icon: '🏆', name: 'Challenger', desc: 'Get 3★ on any challenge day.', coins: 50, test: (c) => c.ch3 >= 1 },
  ];
  const achData = () => Object.assign({ got: {}, c: {} }, store.get('neonTycoon.ach', {}));
  // count things up (from a shop day, or a challenge), then see what's newly unlocked
  function achCount(add) {
    const d = achData();
    for (const [k, v] of Object.entries(add || {})) d.c[k] = k === 'streak' ? Math.max(d.c[k] || 0, v) : (d.c[k] || 0) + v;
    store.set('neonTycoon.ach', d);
    achCheck();
  }
  function achCheck() {
    const d = achData(), fresh = ACH.filter((a) => !d.got[a.id] && a.test(Object.assign({ served: 0 }, d.c), s && !visiting ? s : null));
    if (!fresh.length) return;
    let coins = 0;
    for (const a of fresh) { d.got[a.id] = Date.now(); coins += a.coins; }
    store.set('neonTycoon.ach', d);
    store.set('neonDash.wallet', store.get('neonDash.wallet', 0) + coins);
    fresh.forEach((a, i) => setTimeout(() => toast(`🏆 ${a.icon} ${a.name}! +${a.coins} 🪙`), 600 + i * 1800));
  }
  const achCountGot = () => Object.keys(achData().got).length;
  function trophiesHtml() {
    const d = achData(), n = Object.keys(d.got).length;
    return `<div class="card"><h3>🏆 Trophy room<span class="muted" style="margin-left:auto;font-size:12px">${n}/${ACH.length}</span></h3>
      <p class="muted">Kept across seasons. Each one pays arcade coins, and your trophies stand on a shelf in your shop.</p>
      <div class="trophies">${ACH.map((a) => `<div class="${d.got[a.id] ? 'got' : ''}" title="${esc(a.desc)}"><span>${d.got[a.id] ? a.icon : '🔒'}</span><b>${esc(a.name)}</b><small>${esc(a.desc)} · ${a.coins} 🪙</small></div>`).join('')}</div></div>`;
  }

  // ---------- the city map, in the Travel sheet ----------
  const MAP_AT = { downtown: [0.5, 0.48], docks: [0.16, 0.78], tech: [0.84, 0.24], night: [0.18, 0.22], arena: [0.82, 0.78] };
  function drawCityMap(cv) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0d0420'; g.fillRect(0, 0, W, H);
    // the river along the docks, and the roads between districts
    g.strokeStyle = 'rgba(5,217,232,.25)'; g.lineWidth = 18; g.beginPath(); g.moveTo(0, H * 0.95); g.bezierCurveTo(W * 0.3, H * 0.9, W * 0.5, H * 1.05, W, H * 0.97); g.stroke();
    const P = (id) => [MAP_AT[id][0] * W, MAP_AT[id][1] * H];
    g.lineCap = 'round';
    for (const [a, c] of [['downtown', 'docks'], ['downtown', 'tech'], ['downtown', 'night'], ['downtown', 'arena'], ['night', 'tech'], ['docks', 'arena'], ['night', 'docks'], ['tech', 'arena']]) {
      g.strokeStyle = '#2a1a4a'; g.lineWidth = 7; g.beginPath(); g.moveTo(...P(a)); g.lineTo(...P(c)); g.stroke();
      g.strokeStyle = 'rgba(255,210,63,.35)'; g.lineWidth = 1; g.setLineDash([4, 6]); g.beginPath(); g.moveTo(...P(a)); g.lineTo(...P(c)); g.stroke(); g.setLineDash([]);
    }
    for (const rt of s.routes || []) { // your truck routes
      const a = T.stopOf(s, rt.from), z = T.stopOf(s, rt.to); if (!a || !z) continue;
      const [x0, y0] = P(a.district), [x1, y1] = P(z.district);
      g.strokeStyle = 'rgba(5,217,232,.8)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1 === x0 && y1 === y0 ? x0 + 30 : x1, y1 === y0 && x1 === x0 ? y0 - 20 : y1); g.stroke();
      g.font = '16px system-ui'; g.textAlign = 'center'; g.fillText('🚚', (x0 + x1) / 2 + (x1 === x0 ? 18 : 0), (y0 + y1) / 2 - (y1 === y0 && x1 === x0 ? 14 : 4));
    }
    for (const d of T.DISTRICTS) {
      const [x, y] = P(d.id), mine = s.businesses.filter((b) => b.district === d.id), here = d.id === s.district;
      const invested = mine.reduce((a, b) => a + b.invested, 0) + ((s.warehouses || {})[d.id] ? s.warehouses[d.id].invested : 0);
      const glow = Math.min(1, invested / 30000), r0 = 26 + glow * 10;
      // a little skyline: busier where you've invested
      const gr = g.createRadialGradient(x, y, 4, x, y, r0 * 1.6); gr.addColorStop(0, here ? 'rgba(255,210,63,.45)' : `rgba(155,93,229,${0.2 + glow * 0.4})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r0 * 1.6, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 5 + Math.round(glow * 4); i++) { const bw = 6, bh = 8 + ((i * 37 + d.id.length * 11) % 18) + glow * 10, bx = x - 26 + i * 6.5; g.fillStyle = here ? '#3a2a6a' : '#241446'; g.fillRect(bx, y + 6 - bh, bw, bh); g.fillStyle = 'rgba(255,240,180,.7)'; for (let k = 0; k < bh / 5 - 1; k++) if ((i + k) % 3) g.fillRect(bx + 2, y + 2 - k * 5, 2, 2); }
      g.font = '700 22px system-ui'; g.textAlign = 'center'; g.fillText(d.icon, x, y - 14);
      g.fillStyle = here ? '#ffd23f' : '#fff'; g.font = '800 11px system-ui'; g.fillText(d.name, x, y + 20);
      const icons = mine.map((b) => (b.kind === 'stall' ? '🏪' : '🏭')).concat((s.warehouses || {})[d.id] ? ['🏬'] : []).join('');
      if (icons) { g.font = '12px system-ui'; g.fillText(icons, x, y + 35); }
      if (mine.some((b) => b.kind === 'stall' && T.rival(s, b))) { g.font = '11px system-ui'; g.fillStyle = '#ff9fbf'; g.fillText('🥊 rival', x, y + 48); }
      if (here) { g.strokeStyle = '#ffd23f'; g.lineWidth = 2; g.beginPath(); g.arc(x, y - 6, 30, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#ffd23f'; g.font = '800 10px system-ui'; g.fillText('YOU ARE HERE', x, y - 40); }
    }
    g.textAlign = 'start';
  }

  // ---------- challenge days: a set-up shop day with a goal, scored in stars ----------
  const CHALLENGES = [
    { id: 'rush', icon: '🎄', name: 'Holiday rush', desc: 'Christmas in a megastore with one helper. Serve as many as you can.', good: 'holo', tier: 2, day: 110, staff: 1, stars: [15, 25, 35], score: (m) => m.served, unit: 'served' },
    { id: 'war', icon: '🥊', name: 'Price war', desc: 'The rival is slashing prices. Win shoppers back with your price and service.', good: 'sneakers', tier: 1, day: 30, fight: 1, stars: [8, 14, 20], score: (m) => m.served, unit: 'served' },
    { id: 'rescue', icon: '🚑', name: 'Rescue mission', desc: 'A run-down stall nobody likes. Turn it around in one day.', good: 'noodles', tier: 0, day: 20, rescue: true, stars: [3, 3.5, 4.5], score: (m) => m.stars || 0, unit: '★ day' },
    { id: 'inspect', icon: '📋', name: 'Inspection day', desc: 'The inspector is coming and the shop is a mess. Clean up (🚶 Walk) and keep serving.', good: 'coffee', tier: 1, day: 40, event: 'inspector', mess: true, staff: 1, stars: [1, 2, 3], score: (m) => (m.eventResult && m.eventResult.ok ? 1 + (m.served >= 10) + (m.served >= 18) : 0), unit: 'stars' },
    { id: 'snow', icon: '❄️', name: 'Snow day', desc: 'A blizzard and a coffee shop. Make the most of it.', good: 'coffee', tier: 1, day: 100, weather: 'snow', stars: [600, 1100, 1700], score: (m) => Math.round(m.revenue + (m.extras || 0)), unit: '$ taken' },
    { id: 'star', icon: '⭐', name: 'Star visit', desc: 'A celebrity is coming, with fans. Keep them happy and keep up.', good: 'sneakers', tier: 1, day: 50, event: 'celebrity', staff: 1, stars: [1, 2, 3], score: (m) => (m.eventResult && m.eventResult.ok ? 1 + (m.served >= 15) + (m.served >= 25) : 0), unit: 'stars' },
    { id: 'deliver', icon: '🛵', name: 'Delivery rush', desc: 'The online orders won\'t stop. Pack and send while you serve.', good: 'noodles', tier: 1, day: 60, online: true, stars: [3, 6, 9], score: (m) => m.online, unit: 'delivered' },
  ];
  const chBest = () => store.get('neonTycoon.challenges', {});
  function openChallenges() {
    const best = chBest();
    openSheet(`<h2>🏆 Challenge days<button class="close" data-close>✕</button></h2>
      <p class="muted">A one-day shop with a twist. Score up to three stars; each new star pays 🪙 30. Nothing here touches your season.</p>
      <div class="pick">${CHALLENGES.map((c) => `<button class="row" data-ch="${c.id}"><span class="ic">${c.icon}</span><span class="nm"><b>${c.name} ${'★'.repeat(best[c.id] || 0)}${'☆'.repeat(3 - (best[c.id] || 0))}</b><small>${esc(c.desc)} ★ ${c.stars.join(' / ')} ${c.unit}</small></span></button>`).join('')}</div>`);
    for (const el of document.querySelectorAll('[data-ch]')) el.onclick = () => { closeSheet(); startChallenge(CHALLENGES.find((c) => c.id === el.dataset.ch)); };
  }
  function startChallenge(c) {
    const vs = T.newGame(T.newSeed(), { name: 'challenge' });
    vs.day = c.day; vs.cash = 1e6; vs.debt = 0;
    T.openBusiness(vs, 'stall', c.good);
    const b = vs.businesses[0];
    b.tier = c.tier; b.stock = T.unitsPerDay(T.STALLS[b.tier].cap, b.good) * 2;
    b.staff = Array.from({ length: c.staff ?? T.STAFF_SLOTS[b.tier] }, (_, i) => ({ name: T.NAMES[(i * 7 + 3) % T.NAMES.length], skill: 'cashier', wage: 0, morale: 80 }));
    if (c.fight) b.rv = { fight: c.fight, poached: 0 };
    if (c.rescue) { b.rep = { price: 25, stock: 20, queue: 22, service: 25 }; b.rating = 1.5; b.wear = { scuffs: Array.from({ length: 14 }, () => [0.15 + Math.random() * 0.7, 0.35 + Math.random() * 0.4, 0.3]), smudges: [[0, 0.3, 0.6], [1, 0.6, 0.5], [0, 0.7, 0.4]] }; }
    if (c.mess) b.wear = { scuffs: Array.from({ length: 12 }, () => [0.15 + Math.random() * 0.7, 0.35 + Math.random() * 0.4, 0.3]), smudges: Array.from({ length: 7 }, (_, i) => [i % 2, Math.random(), 0.5]) };
    if (c.online) b.upgrades = { online: true };
    vs.forceWeather = c.weather || null; vs.forceEvent = c.event || null;
    savedGame = visiting ? savedGame : s;
    visiting = { name: c.name, challenge: c };
    s = vs;
    openShop(b);
    $('shopTitle').textContent = `${c.icon} ${c.name}`;
    const r = NeonShop.current();
    if (r && c.online) r.onlineRush = true;
    if (r && c.mess) for (let i = 0; i < 4; i++) r.floor.push({ x: 0.3 + i * 0.12, y: 0.5 + (i % 2) * 0.1, n: 1, rot: i, line: 0 });
    toast(`${c.icon} ${c.name}: ★ ${c.stars.join(' / ')} ${c.unit}`);
  }
  function challengeEnd(c, m) {
    const sc = c.score(m), stars = c.stars.filter((t) => sc >= t).length, best = chBest(), was = best[c.id] || 0;
    const wk = weeklyRun && c === weekly(); weeklyRun = false;
    const wkBest = wk && weeklyScore(sc);
    if (stars > was) { best[c.id] = stars; store.set('neonTycoon.challenges', best); store.set('neonDash.wallet', store.get('neonDash.wallet', 0) + (stars - was) * 30); }
    if (stars >= 3) achCount({ ch3: 1 });
    openSheet(`<h2>${c.icon} ${c.name}</h2>
      <p class="big-num">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</p>
      <p>You scored <b>${typeof sc === 'number' && sc % 1 ? sc.toFixed(1) : sc}</b> ${c.unit} (★ ${c.stars.join(' / ')}).${stars > was ? ` New best: +${(stars - was) * 30} 🪙!` : ''}</p>
      ${m.eventResult ? `<p>${esc(m.eventResult.text)}</p>` : ''}
      ${wk ? `<p>🗓️ Weekly tournament: ${wkBest ? '<b class="up">a new best for this week!</b>' : `your best this week is ${weekData().best}.`}</p>` : ''}
      <div class="btns"><button class="btn primary" id="chAgain">Try again</button>${wk ? '<button class="btn" id="chWeek">🗓️ Leaderboard</button>' : '<button class="btn" id="chList">All challenges</button>'}<button class="btn" data-close>Done</button></div>`);
    $('chAgain').onclick = () => { closeSheet(); if (wk) weeklyRun = true; startChallenge(c); };
    if ($('chWeek')) $('chWeek').onclick = openWeekly;
    if ($('chList')) $('chList').onclick = openChallenges;
  }

  // ---------- this week's tournament: everyone gets the same challenge day each week ----------
  const weekNo = () => Math.floor((Date.now() / 86400000 + 3) / 7); // weeks start on a Monday
  const weekly = () => CHALLENGES[weekNo() % CHALLENGES.length];
  const weekData = () => { const d = store.get('neonTycoon.weekly', {}); return d.week === weekNo() ? d : { week: weekNo(), best: null, friends: [] }; };
  function openWeekly() {
    const c = weekly(), d = weekData(), board = (d.best !== null ? [{ name: `${youLabel()}`, score: d.best, me: true }] : []).concat(d.friends).sort((a, b) => b.score - a.score);
    const left = 7 - ((Math.floor(Date.now() / 86400000) + 3) % 7);
    openSheet(`<h2>🗓️ This week's tournament<button class="close" data-close>✕</button></h2>
      <div class="card"><h3>${c.icon} ${c.name}</h3><p>${esc(c.desc)}</p><p class="muted">★ ${c.stars.join(' / ')} ${c.unit} · a new challenge in ${left} day${left === 1 ? '' : 's'}</p></div>
      <p class="section-title">Leaderboard (you and friends who shared)</p>
      ${board.length ? `<div class="kv">${board.map((x, i) => `<span>${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${esc(x.name)}${x.me ? '' : ''}</span><span class="${x.me ? 'up' : ''}">${x.score} ${c.unit}</span>`).join('')}</div>` : '<p class="muted">No scores yet this week.</p>'}
      <div class="btns"><button class="btn primary" id="wkPlay">▶ Play</button>${d.best !== null ? '<button class="btn" id="wkShare">📣 Share my score</button>' : ''}</div>`);
    $('wkPlay').onclick = () => { closeSheet(); weeklyRun = true; startChallenge(c); };
    if ($('wkShare')) $('wkShare').onclick = async () => {
      const url = `${location.origin}${location.pathname}?wk=${b64(JSON.stringify({ w: d.week, s: d.best, n: playerName() === 'You' ? 'A friend' : playerName() }))}`, text = `🗓️ I scored ${d.best} ${c.unit} on this week's Neon Tycoon challenge (${c.name}). Can you beat it?`;
      try { if (navigator.share) { await navigator.share({ title: 'Neon Tycoon weekly', text, url }); return; } } catch { /* fall back */ }
      try { await navigator.clipboard.writeText(`${text} ${url}`); toast('📣 Link copied'); } catch { openSheet(`<h2>📣 Share<button class="close" data-close>✕</button></h2><textarea class="sharebox" readonly>${esc(url)}</textarea>`); }
    };
  }
  let weeklyRun = false;
  function weeklyScore(sc) {
    const d = weekData();
    if (d.best === null || sc > d.best) { d.best = sc; store.set('neonTycoon.weekly', d); return true; }
    return false;
  }

  // ---------- 📖 the guide: every system in a few lines ----------
  const GUIDE = [
    ['🛒 Trading', 'Buy goods where they\'re cheap and sell where they\'re dear. Big trades move the price. 🗺️ Travel takes the rest of the day; the map shows where your shops, warehouses and rivals are.'],
    ['🏪 Shops and workshops', 'Stalls sell every day at your price. Open one yourself to serve shoppers by hand. Workshops make goods for 40% of their price and stock your stalls in the same district.'],
    ['💲 Prices', 'The price line says how many shoppers will pay it. Each line can have its own price. The rival over the road is cheaper or dearer: match them (🤝) or win on service.'],
    ['📦 Stock', 'Order from a supplier (fast and dear, or cheap and slow), sign a 📜 contract for a locked price, or rent 🏬 storage that tops your shops up every morning. 🚚 Trucks move goods on a schedule. Food and drink go off: oldest sells first, at half price near its date.'],
    ['👥 Staff', 'Helpers serve, restock, guard the door or pack online orders. They gain levels, have personalities, ask for raises and may strike if morale is low. A ⭐ supervisor speeds up the team; level 3 staff can be made managers.'],
    ['🧑‍💼 Managers', 'A manager reorders stock on days you don\'t run a shop. Each style makes its own mistakes; they level up with experience or training.'],
    ['🏗️ Growing', 'Bigger stockroom, more floor (new islands), a staff room, a side counter for a second product, opening hours (late or 24 hours), own the building, and launch your own 🏷️ brand for cheaper own-label stock.'],
    ['📣 Getting shoppers', 'Word of mouth, star ratings, the weather and holidays, flyers, billboards and radio, NeonGram followers from photo-mode posts, furniture and a shop pet all bring more people in.'],
    ['💰 Money', 'Rent is reviewed every 30 days; 10% tax on each week\'s profit; the loan costs 0.5% a day. 🛡️ Insurance covers fires, break-ins, floods and repairs. 📒 Cash flow is on the Bank tab; 📊 Chain dashboard shows every shop.'],
    ['🎯 Each shop day', 'A daily goal (coins and a streak), sometimes an event (inspector, celebrity, burst pipe, critic), online orders, returns and shoplifters. The closing report and the heat map show how it went.'],
    ['🏆 Beyond the season', 'Challenge days and a weekly tournament, 25 achievements and a trophy shelf, friend visits and reviews, and a season challenge link with the same market.'],
  ];
  function openGuide() {
    openSheet(`<h2>📖 Guide<button class="close" data-close>✕</button></h2>${GUIDE.map(([t, b], i) => `<details class="guide"${i ? '' : ' open'}><summary>${t}</summary><p>${b}</p></details>`).join('')}`);
  }

  // ---------- reviews from friends who visited your shop ----------
  function openRate(v, m) {
    let stars = 4, chips = new Set();
    const NICE = ['Great layout', 'Lovely decor', 'Fast tills', 'Good prices', 'Love the furniture', 'Needs more stock'];
    const draw = () => {
      $('rateStars').innerHTML = [1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" class="${n <= stars ? 'on' : ''}">★</button>`).join('');
      $('rateChips').innerHTML = NICE.map((t) => `<button data-chip="${esc(t)}" class="${chips.has(t) ? 'on' : ''}">${esc(t)}</button>`).join('');
    };
    openSheet(`<h2>💌 Rate ${esc(v.n || 'their')} shop<button class="close" data-close>✕</button></h2>
      <p class="muted">You served ${m.served} shopper${m.served === 1 ? '' : 's'} there. Send a review back and it shows on their shop card.</p>
      <div id="rateStars" class="ratestars"></div><div id="rateChips" class="linechips"></div>
      <div class="btns"><button class="btn primary" id="rateSend">💌 Send review</button></div>`);
    $('rateStars').onclick = (e) => { const el = e.target.closest('[data-star]'); if (el) { stars = +el.dataset.star; draw(); } };
    $('rateChips').onclick = (e) => { const el = e.target.closest('[data-chip]'); if (el) { const t = el.dataset.chip; if (chips.has(t)) chips.delete(t); else if (chips.size < 3) chips.add(t); draw(); } };
    $('rateSend').onclick = async () => {
      const code = b64(JSON.stringify({ v: 1, from: playerName() === 'You' ? 'A friend' : playerName(), g: v.g, d: v.d, stars, text: [...chips].join(' · '), day: Date.now() }));
      const url = `${location.origin}${location.pathname}?review=${code}`, text = `💌 I rated your Neon Tycoon shop ${'★'.repeat(stars)}!`;
      try { if (navigator.share) { await navigator.share({ title: 'My review of your shop', text, url }); closeSheet(); return; } } catch { /* fall back */ }
      try { await navigator.clipboard.writeText(`${text} ${url}`); toast('💌 Review link copied: send it back to them'); closeSheet(); } catch { openSheet(`<h2>💌 Your review<button class="close" data-close>✕</button></h2><p>Send this link back to them:</p><textarea class="sharebox" readonly>${esc(url)}</textarea>`); }
    };
    draw();
  }
  const friendReviews = (b) => store.get('neonTycoon.friendReviews', []).filter((r) => r.g === b.good && r.d === b.district);

  // ---------- settings ----------
  const SET_KEY = 'neonTycoon.settings';
  const settings = () => Object.assign({ text: 'normal', cb: false, lefty: false, buzz: true, music: true }, store.get(SET_KEY, {}));
  const realVibrate = navigator.vibrate ? navigator.vibrate.bind(navigator) : null;
  function applySettings() {
    const st = settings(), cl = document.documentElement.classList;
    cl.toggle('text-large', st.text === 'large'); cl.toggle('text-larger', st.text === 'larger');
    cl.toggle('cb', st.cb); cl.toggle('lefty', st.lefty);
    if (realVibrate) navigator.vibrate = st.buzz ? realVibrate : () => false;
    if (window.NeonShop && NeonShop.setOptions) NeonShop.setOptions({ cb: st.cb, music: st.music });
  }
  function openSettings() {
    const st = settings(), muted = store.get('neonDash.muted', false);
    const opt = (key, val, label) => `<button class="dec${st[key] === val ? ' on' : ''}" data-set="${key}:${val}"><b>${label}</b></button>`;
    openSheet(`<h2>⚙️ Settings<button class="close" data-close>✕</button></h2>
      <p class="section-title">Text size</p><div class="decor">${opt('text', 'normal', 'Normal')}${opt('text', 'large', 'Large')}${opt('text', 'larger', 'Larger')}</div>
      <p class="section-title">Seeing and playing</p><div class="decor">
        <button class="dec${st.cb ? ' on' : ''}" data-tog="cb"><b>🎨 Colour-blind friendly</b><small>Blue, orange and yellow lines; ▲▼ marks stand out</small></button>
        <button class="dec${st.lefty ? ' on' : ''}" data-tog="lefty"><b>🤚 Left-handed</b><small>SERVE on the left of the shop buttons</small></button>
        <button class="dec${st.buzz ? ' on' : ''}" data-tog="buzz"><b>📳 Vibration</b><small>${st.buzz ? 'On' : 'Off'}</small></button></div>
      <p class="section-title">Sound</p><div class="decor">
        <button class="dec${!muted ? ' on' : ''}" id="setSound"><b>🔊 Sound effects</b><small>${muted ? 'Off' : 'On'}</small></button>
        <button class="dec${st.music ? ' on' : ''}" data-tog="music"><b>🎵 Shop music</b><small>${st.music ? 'On: changes with the time of day and holidays' : 'Off'}</small></button></div>
      <p class="section-title">Help</p><div class="btns"><button class="btn" id="setCoach">🎓 Replay the tutorial</button>${s && !visiting ? '<button class="btn" id="setMap">🗺️ City map</button>' : ''}</div>`);
    const saveSet = (patch) => { store.set(SET_KEY, Object.assign(settings(), patch)); applySettings(); openSettings(); };
    for (const el of document.querySelectorAll('[data-set]')) el.onclick = () => { const [k, v] = el.dataset.set.split(':'); saveSet({ [k]: v }); };
    for (const el of document.querySelectorAll('[data-tog]')) el.onclick = () => saveSet({ [el.dataset.tog]: !settings()[el.dataset.tog] });
    $('setSound').onclick = () => { store.set('neonDash.muted', !store.get('neonDash.muted', false)); openSettings(); };
    $('setCoach').onclick = () => { store.del('neonTycoon.coached'); store.del('neonTycoon.tips'); if (s && !visiting) { s.coachDone = false; s.day = Math.min(s.day, 15); save(); render(); } toast('🎓 The tips and the coach will show again'); closeSheet(); };
    if ($('setMap')) $('setMap').onclick = openTravel;
  }

  // ---------- season end, coins, challenges ----------
  function encodeChallenge() {
    const nw = s.hist.nw;
    const curve = [];
    for (let i = 0; i < nw.length; i += 10) curve.push(Math.round(nw[i]));
    if ((nw.length - 1) % 10) curve.push(Math.round(nw[nw.length - 1]));
    const lk = playerLook();
    const data = { v: 1, s: s.seed, n: playerName().slice(0, 12), l: [lk.outfit, lk.skin, lk.hair, lk.hairColor], w: T.netWorth(s), c: curve };
    return btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeChallenge(code) {
    const d = JSON.parse(decodeURIComponent(escape(atob(code.replace(/-/g, '+').replace(/_/g, '/')))));
    if (d.v !== 1 || !Number.isFinite(d.s) || !Array.isArray(d.c) || !d.c.every(Number.isFinite)) throw new Error('bad');
    return { seed: d.s >>> 0, name: String(d.n || 'A friend').slice(0, 12), look: { outfit: d.l?.[0], skin: d.l?.[1], hair: d.l?.[2], hairColor: d.l?.[3] }, nw: d.w, curve: d.c };
  }

  function showSeasonEnd() {
    const nw = T.netWorth(s), coins = T.coinsFor(nw);
    if (!s.rewarded) {
      s.rewarded = true;
      store.set('neonDash.wallet', store.get('neonDash.wallet', 0) + coins);
      save();
    }
    achCheck();
    const vs = s.challenge ? (nw >= s.challenge.nw
      ? `<p class="up"><b>🏆 You beat ${esc(s.challenge.name)} by ${money(nw - s.challenge.nw)}!</b></p>`
      : `<p class="down"><b>${esc(s.challenge.name)} wins by ${money(s.challenge.nw - nw)}.</b></p>`) : '';
    openSheet(`<h2>🏁 Season over</h2>
      <p class="muted">Final net worth</p><div class="big-num">${money(nw)}</div>
      <p>Rank: <b>${T.rankFor(nw)}</b></p>${vs}
      ${s.challenge ? `<div class="legend"><span><i style="background:${COLORS.you}"></i>You</span><span><i style="background:${COLORS.friend}"></i>${esc(s.challenge.name)}</span></div>` : ''}
      <canvas class="chart" id="endChart" aria-label="Net worth by day"></canvas>
      <p>+${coins} 🪙 added to your arcade wallet (now ${store.get('neonDash.wallet', 0).toLocaleString()}).</p>
      <button class="btn primary" id="shareBtn">👻 Challenge a friend with this market</button>
      <button class="btn" id="againBtn">New season</button>
      <a class="btn" href="../" style="text-align:center;text-decoration:none">Back to all games</a>`);
    drawNetWorthChart($('endChart'));
    $('shareBtn').onclick = shareChallenge;
    $('againBtn').onclick = () => { closeSheet(); store.del(SAVE); s = null; showTitle(); };
  }

  async function shareChallenge() {
    const url = `${location.origin}${location.pathname}?c=${encodeChallenge()}`;
    const text = `💰 I made ${money(T.netWorth(s))} in Neon Tycoon. Same market, same news: can you beat me?`;
    if (navigator.share) { try { await navigator.share({ title: 'Neon Tycoon challenge', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Challenge link copied!'); } catch { window.prompt('Copy this link for your friend:', url); }
  }

  // ---------- title ----------
  function showTitle() {
    $('game').classList.add('hidden');
    $('title').classList.remove('hidden');
    const saved = store.get(SAVE, null);
    s = null;
    $('continueBtn').classList.toggle('hidden', !(saved && !saved.finished && saved.v === 1));
    if (saved) $('contDay').textContent = saved.day;
    $('visitBtn').classList.toggle('hidden', !pendingVisit);
    if (pendingVisit) $('visitBtn').textContent = `🏪 VISIT ${(pendingVisit.n || 'A FRIEND').toUpperCase()}'S SHOP`;
    const box = $('challengeBox');
    box.classList.toggle('hidden', !pendingChallenge);
    if (pendingChallenge) {
      box.innerHTML = `👻 <b>${esc(pendingChallenge.name)}</b> finished a season with <b>${money(pendingChallenge.nw)}</b>. Same market, same news: can you beat it?`;
      $('newBtn').textContent = `ACCEPT ${pendingChallenge.name.toUpperCase()}'S CHALLENGE`;
    } else $('newBtn').textContent = 'NEW SEASON';
  }
  function startGame(state) {
    s = state;
    tab = 'market';
    $('title').classList.add('hidden');
    $('game').classList.remove('hidden');
    save();
    render();
    if (s.day === 1 && !s.report) openSheet(`<h2>👋 Welcome, ${esc(playerName())}</h2><div class="news">${s.news.map((n) => `<div><span>${n.icon}</span><span>${esc(n.text)}</span></div>`).join('')}</div>
      <p>Tip: check <b>🗺️ Travel</b> to see which districts sell cheap and which pay well.</p><button class="btn primary" data-close>Let's go</button>`);
  }
  $('continueBtn').onclick = () => startGame(store.get(SAVE, null));
  $('newBtn').onclick = () => {
    const saved = store.get(SAVE, null);
    const go = () => {
      const ch = pendingChallenge;
      pendingChallenge = null;
      startGame(T.newGame(ch ? ch.seed : T.newSeed(), { name: playerName(), challenge: ch }));
    };
    if (saved && !saved.finished) {
      openSheet(`<h2>Start over?<button class="close" data-close>✕</button></h2><p>Your current season (day ${saved.day}) will be lost.</p><button class="btn danger" id="yesNew">Start a new season</button>`);
      $('yesNew').onclick = () => { closeSheet(); go(); };
    } else go();
  };

  // ---------- events ----------
  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => { tab = b.dataset.tab; render(); window.scrollTo(0, 0); });
  $('travelBtn').onclick = () => (s.finished ? showSeasonEnd() : openTravel());
  $('endDayBtn').onclick = () => endDay(null);
  $('panel').addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const [act, a, b] = el.dataset.act.split(':');
    if (act === 'good') openGood(a);
    else if (act === 'vehicle') openVehicle();
    else if (act === 'stock') openStock(a);
    else if (act === 'bank') bankAction(a, b);
    else if (act === 'open' && s.cash < (a === 'stall' ? T.STALLS : T.FACTORIES)[0].cost) toast(`You need ${money((a === 'stall' ? T.STALLS : T.FACTORIES)[0].cost)} cash. Try a loan in the 🏦 Bank tab.`);
    else if (act === 'open') openProductPicker(a === 'stall' ? '🏪 What will the stall sell?' : '🏭 What will the workshop make?', (g) => { if (result(T.openBusiness(s, a, g), 'Open for business!')) { closeSheet(); } }, a);
    else if (act === 'decor') openDecor();
    else if (act === 'whbuy') { if (result(T.buyWarehouse(s), '🏬 Your storage space is ready')) render(); }
    else if (act === 'whup') result(T.upgradeWarehouse(s), '🏬 Bigger storage!');
    else if (act === 'whauto') { T.whOf(s).auto = !T.whOf(s).auto; save(); render(); }
    else if (act === 'whput') result(T.whMove(s, a, s.cargo[a] || 0), `🏬 Stored in the warehouse`);
    else if (act === 'whtake') result(T.whMove(s, a, -(T.whOf(s).goods[a] || 0)), '🎒 Into your cargo');
    else if (act === 'whsell') { openSheet(`<h2>Sell the warehouse?<button class="close" data-close>✕</button></h2><p>You get back ${Math.round(T.RESALE * 100)}% of what you put in, plus the goods inside at today's prices.</p><button class="btn danger" id="whSellYes">Sell it</button>`); $('whSellYes').onclick = () => { if (result(T.sellWarehouse(s), 'Warehouse sold')) closeSheet(); }; }
    else if (act === 'settings') openSettings();
    else if (act === 'weekly') { weeklyRun = true; openWeekly(); }
    else if (act === 'guide') openGuide();
    else if (act === 'challenges') { if (s && !s.finished) { save(); } challengeFromGame = true; openChallenges(); }
    else if (act === 'policy') { T.setPolicy(s, a, !(s.insurance || {})[a]); save(); render(); toast((s.insurance || {})[a] ? `🛡️ ${T.POLICIES[a].name} cover on` : `${T.POLICIES[a].name} cover off`); }
    else if (act === 'brand') openBrand();
    else if (act === 'logistics') openLogistics();
    else if (act === 'dashboard') openDashboard();
    else if (act === 'coachoff') { s.coachDone = true; save(); render(); }
    else if (act === 'tipok') { store.set('neonTycoon.tips', Object.assign(store.get('neonTycoon.tips', {}), { [a]: true })); render(); }
    else bizAction(act, parseInt(a, 10));
  });
  window.addEventListener('resize', () => { if (s && tab === 'stats') render(); });

  // avatar on the title
  (() => {
    const cv = $('tAvatar'), ctx = cv.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = 72 * dpr; cv.height = 90 * dpr;
    const lk = playerLook(), of = window.NeonLooks && NeonLooks.byId(NeonLooks.OUTFITS, lk.outfit);
    const t0 = performance.now();
    const frame = (now) => {
      if (!$('title').classList.contains('hidden') && of) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, 72, 90);
        NeonLooks.drawRunner(ctx, 36, 87, 40, { phase: (now - t0) / 140, stride: 0.35 }, of, (now - t0) / 1000, lk);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  })();

  // a challenge link (?c=...)
  const code = new URLSearchParams(location.search).get('c');
  if (code) {
    history.replaceState(null, '', location.pathname);
    try { pendingChallenge = decodeChallenge(code); } catch { toast('That challenge link looks broken.'); }
  }
  const vcode = new URLSearchParams(location.search).get('visit');
  if (vcode) {
    history.replaceState(null, '', location.pathname + location.hash);
    try { pendingVisit = decodeShop(vcode); } catch { toast('That shop link looks broken.'); }
  }
  $('visitBtn').onclick = () => { if (pendingVisit) openVisit(pendingVisit); };
  $('chBtn').onclick = openChallenges;
  $('wkBtn').onclick = openWeekly; $('wkBtn').textContent = `🗓️ This week: ${weekly().icon} ${weekly().name}`;
  $('guideBtn').onclick = openGuide;
  const wcode = new URLSearchParams(location.search).get('wk');
  if (wcode) {
    history.replaceState(null, '', location.pathname + location.hash);
    try {
      const w = JSON.parse(unb64(wcode)), d = weekData();
      if (w.w === weekNo() && Number.isFinite(w.s)) { d.friends = d.friends.filter((x) => x.name !== w.n).concat([{ name: String(w.n).slice(0, 24), score: w.s }]).slice(-20); store.set('neonTycoon.weekly', d); setTimeout(() => { toast(`🗓️ ${String(w.n).slice(0, 24)} scored ${w.s} on this week's challenge`); }, 800); }
      else toast('That tournament score is from another week.');
    } catch { toast('That tournament link looks broken.'); }
  }
  $('setBtn').onclick = openSettings;
  const rcode = new URLSearchParams(location.search).get('review');
  if (rcode) {
    history.replaceState(null, '', location.pathname + location.hash);
    try {
      const rv = JSON.parse(unb64(rcode));
      if (rv && rv.v === 1 && T.G[rv.g] && T.D[rv.d] && rv.stars >= 1 && rv.stars <= 5) {
        const list = store.get('neonTycoon.friendReviews', []);
        if (!list.some((x) => x.day === rv.day && x.from === rv.from)) store.set('neonTycoon.friendReviews', list.concat([{ from: String(rv.from).slice(0, 24), g: rv.g, d: rv.d, stars: rv.stars, text: String(rv.text || '').slice(0, 120), day: rv.day }]).slice(-30));
        setTimeout(() => toast(`💌 ${String(rv.from).slice(0, 24)} rated your ${T.G[rv.g].name} shop ${'★'.repeat(rv.stars)}`), 800);
      }
    } catch { toast('That review link looks broken.'); }
  }
  applySettings();
  showTitle();

  if (location.hash === '#test') window.tycoonTest = { state: () => s, T, endDay, encodeChallenge, encodeShop, achData, startChallenge: (id) => startChallenge(CHALLENGES.find((c) => c.id === id)), b64, shop: window.NeonShop };
})();
