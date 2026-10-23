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

  function save() { if (s) store.set(SAVE, s); }
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

  // ---------- Market ----------
  function marketHtml() {
    const used = T.cargoUsed(s), cap = T.cargoCap(s), V = T.VEHICLES[s.vehicle];
    let h = `<div class="card"><h3>🎒 ${V.name} <span class="muted num" style="margin-left:auto">${used}/${cap}</span></h3>
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
      <div class="trade"><button class="btn cyan" id="gBuy">Buy</button><button class="btn primary" id="gSell">Sell</button></div>`);
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
      status = `Stock ${b.stock} · sells about ${T.unitsPerDay(tier.cap, b.good)} a day · rent ${money(tier.rent)}/day`;
      const mult = b.mult || T.RETAIL;
      status += `<br>Shelf price ${price2(T.shelfPrice(s, b))} (${Math.round(mult * 100)}% of wholesale) · ${Math.round(T.willingShare(mult) * 100)}% of shoppers will pay it`;
      if (b.rating) status += `<br><span class="stars">${starStr(b.rating)}</span> ${b.rating.toFixed(1)} from shoppers`;
      const fr = T.freshness(s, b);
      if (fr && (fr.reduced || fr.expiring)) status += `<br>🗓️ ${fr.reduced} near their sell-by date (half price)${fr.expiring ? ` · <b class="down">${fr.expiring} go off tonight</b>` : ''}`;
      else if (fr) status += `<br>🗓️ Keeps ${fr.life} days, oldest sells first`;
      const rv = T.rival(s, b);
      if (rv) status += `<br>🏪 ${esc(rv.name)} over the road sells at ${price2(T.price(s, b.district, b.good) * rv.mult)}${rv.sale ? ' <b class="down">(SALE!)</b>' : ''}`;
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
      ${here && b.kind === 'stall' && T.shopDayAvailable(s, b) ? `<button class="btn primary shopgo" data-act="shop:${b.id}">🏪 Open shop and serve today</button>` : ''}
      ${here && b.kind === 'stall' && b.servedDay === s.day ? '<p class="muted" style="margin-top:8px">You ran this shop today. Come back tomorrow.</p>' : ''}
      <div class="btns">
        ${b.kind === 'stall' ? `<button class="btn" data-act="price:${b.id}">💲 Set price</button>` : ''}
        ${b.kind === 'stall' ? `<button class="btn" data-act="supgs:${b.id}">🛠️ Shop upgrades${b.upgrades ? ` (${Object.keys(b.upgrades).length})` : ''}</button>` : ''}
        ${b.kind === 'stall' ? `<button class="btn" data-act="staff:${b.id}">👥 Staff (${T.staffOf(b).length}/${T.STAFF_SLOTS[b.tier]})</button>` : ''}
        ${b.kind === 'stall' ? `<button class="btn" data-act="supply:${b.id}">📦 Order stock</button>` : ''}
        ${b.kind === 'stall' ? `<button class="btn" data-act="arrange:${b.id}">🧱 Arrange shop</button>` : ''}
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
    let h = `<div class="card"><h3>➕ Open a business in ${esc(T.D[s.district].name)}</h3>
      <p>A <b>stall</b> sells goods to shoppers every day at your shelf price, or open it and serve the shoppers yourself. A <b>workshop</b> makes goods for 40% of their usual price. Pair them on the same product in one district and the workshop keeps the stall stocked.</p>
      <div class="btns"><button class="btn primary" data-act="open:stall">🏪 Stall · ${money(T.STALLS[0].cost)}</button><button class="btn primary" data-act="open:factory">🏭 Workshop · ${money(T.FACTORIES[0].cost)}</button></div>
      <p class="warn">Workshops pay for what they make every day: keep cash on hand or they stop.</p></div>
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
    const staff = T.staffOf(b), slots = T.STAFF_SLOTS[b.tier], cands = T.candidates(s, b);
    const mood = (m) => (m >= 60 ? '😊' : m >= 30 ? '😐' : '😫');
    openSheet(`<h2>👥 Staff<button class="close" data-close>✕</button></h2>
      <p class="muted">${staff.length} of ${slots} jobs filled at your ${esc(T.STALLS[b.tier].name.toLowerCase())}. Wages are paid every day. Busy days wear people out: a $50 bonus cheers them up, and staff who are fed up may quit.</p>
      ${staff.map((m, i) => `<div class="row"><span class="ic">${T.SKILLS[m.skill].icon}</span><span class="nm"><b>${esc(m.name)}</b>
        <small>${T.SKILLS[m.skill].name} · ${money(m.wage)}/day · ${mood(m.morale)} morale ${m.morale}</small></span>
        <span class="px"><button class="btn" data-bonus="${i}">🎁 $50</button> <button class="btn danger" data-fire="${i}">Let go</button></span></div>`).join('') || '<p class="muted">Nobody works here yet: you serve on your own.</p>'}
      <p class="section-title">Looking for work today</p>
      <div class="pick">${cands.map((c, i) => `<button class="row" data-hire="${i}"${staff.length >= slots || staff.some((m) => m.name === c.name) ? ' disabled' : ''}>
        <span class="ic">${T.SKILLS[c.skill].icon}</span><span class="nm"><b>${esc(c.name)}</b><small>${T.SKILLS[c.skill].name}: ${esc(T.SKILLS[c.skill].desc)}</small></span>
        <span class="px"><b>${money(c.wage)}/day</b></span></button>`).join('')}</div>
      ${staff.length >= slots && b.tier < 2 ? '<p class="warn">Upgrade the stall to make room for more staff.</p>' : ''}`);
    for (const el of document.querySelectorAll('[data-hire]')) el.onclick = () => { if (result(T.hire(s, b.id, +el.dataset.hire), 'Welcome to the team!')) openStaff(b); };
    for (const el of document.querySelectorAll('[data-bonus]')) el.onclick = () => { if (result(T.giveBonus(s, b.id, +el.dataset.bonus), 'Bonus paid 🎁')) openStaff(b); };
    for (const el of document.querySelectorAll('[data-fire]')) el.onclick = () => { if (result(T.fireStaff(s, b.id, +el.dataset.fire), 'Let go')) openStaff(b); };
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
        <p>${esc(sp.desc)}</p><div class="btns">${room ? qtys.map((q) => `<button class="btn" data-sup="${k}:${q}">${q} · ${money(q * price * sp.cost)}</button>`).join('') : '<span class="muted">No room right now.</span>'}</div></div>`).join('')}`);
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
      <div class="decor">${[['auto', '🪄 Auto', 'Sharp, and smoother if your phone needs it'], ['high', '✨ Sharp', 'Full detail'], ['low', '⚡ Smooth', 'Faster on older phones']].map(([id, name, desc]) =>
        `<button class="dec${NeonShop.getGfx() === id ? ' on' : ''}" data-gfx="${id}"><b>${name}</b><small>${NeonShop.getGfx() === id ? '✓ In use' : desc}</small></button>`).join('')}</div>
      ${Object.keys(A.DECOR).map((cat) => `<p class="section-title">${A.DECOR_NAMES[cat]}</p><div class="decor">${A.DECOR[cat].map((it) => {
        const own = A.owns(d, cat, it.id), on = d[cat] === it.id;
        return `<button class="dec${on ? ' on' : ''}" data-dec="${cat}:${it.id}">${swatch(cat, it)}<b>${it.name}</b><small>${on ? '✓ In use' : own ? 'Owned' : `🪙 ${it.cost}`}</small></button>`;
      }).join('')}</div>`).join('')}`);
    for (const el of document.querySelectorAll('[data-view]')) el.onclick = () => { NeonShop.setView(el.dataset.view); openDecor(); toast(el.dataset.view === '3d' ? '🧊 3D shop: opens next time you run a shop' : '🖼️ Classic shop view'); };
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
    else if (act === 'supply') openSupplies(b);
    else if (act === 'arrange') openArrange(b);
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
    if (!window.NeonShop) return;
    const view = $('shopView'), G = T.G[b.good];
    view.classList.remove('hidden');
    document.body.classList.add('noscroll');
    $('shopTitle').textContent = `${G.icon} ${T.STALLS[b.tier].name} · ${T.D[b.district].name}`;
    let takings = 0, lastKey = '';
    const hud = (run) => {
      if (run) takings = run.revenue;
      const si = NeonShop.stockInfo();
      const acts = NeonShop.actions(), goal = NeonShop.goal();
      const key = [NeonShop.clock(), Math.round(takings), b.stock, si && si.shelves, b.mult, NeonShop.frontWaiting(), run && run.till2, NeonShop.pendingReturn(), run && run.zoom.z > 1.01,
        NeonShop.walking(), NeonShop.canWalk(), acts.map((a) => a.id + a.label).join(), goal && goal.prog + goal.done + goal.failed].join('|');
      if (key === lastKey) return;
      lastKey = key;
      $('shopClock').textContent = NeonShop.clock();
      $('shopTake').textContent = money(takings);
      $('shopStock').textContent = si ? `${si.shelves} · ${b.stock - si.shelves}` : b.stock;
      $('shopPrice').innerHTML = priceLine(b);
      $('shopServe').classList.toggle('ready', NeonShop.frontWaiting());
      $('shopTill').classList.toggle('on', !!(run && run.till2));
      $('shopReturn').classList.toggle('hidden', !NeonShop.pendingReturn());
      $('shopZoom').classList.toggle('hidden', !(run && run.zoom.z > 1.01));
      // out on the floor: what you can do here, and the button back to the till
      const walking = NeonShop.walking();
      $('shopWalk').textContent = walking ? '🛎️ Till' : '🚶 Walk';
      $('shopWalk').classList.toggle('on', walking);
      $('shopWalk').disabled = !NeonShop.canWalk();
      $('shopServe').classList.toggle('away', walking);
      $('shopActs').classList.toggle('hidden', !acts.length);
      $('shopActs').innerHTML = acts.map((a) => `<button class="btn" data-do="${a.id}">${esc(a.label)}</button>`).join('');
      if (goal) {
        $('shopGoal').textContent = `${goal.done ? '✅' : goal.failed ? '❌' : '🎯'} ${goal.text} · ${goal.prog}`;
        $('shopGoal').className = `goalpill${goal.done ? ' done' : goal.failed ? ' failed' : ''}`;
      }
      $('cash').textContent = compact(s.cash);
    };
    const res = NeonShop.open(s, b.id, {
      canvas: $('shopCanvas'), canvas3d: $('shop3d'),
      onTick: hud,
      onEnd: (sum) => {
        view.classList.add('hidden');
        document.body.classList.remove('noscroll');
        save(); render();
        shopSummary(b, sum);
      },
    });
    if (!res.ok) { view.classList.add('hidden'); document.body.classList.remove('noscroll'); toast(res.msg); return; }
    save();
    hud();
  }

  function shopSummary(b, m) {
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
        ${m.staff && m.staff.length ? `<span>Staff</span><span>${m.staff.map((x) => `${esc(x.name)} ${x.served}`).join(' · ')}</span>` : ''}
        <span>Walked out</span><span>${lost}</span></div>
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

  // arrange the shop: drag the islands and floor props, choose the line on each shelving unit
  function openArrange(b) {
    const P = NeonShop.plan, names = P.lineNames(b), UNIT_NAMES = ['Left wall shelves', 'Right wall shelves', 'Left island', 'Right island'];
    let lay = JSON.parse(JSON.stringify(b.layout || {})), pick = null;
    const trend = P.trend(s, b);
    openSheet(`<h2>🧱 Arrange your shop<button class="close" data-close>✕</button></h2>
      <p class="muted">Drag the islands and things on the floor. Tap a shelf to choose which line goes on it.</p>
      <canvas class="plan" id="planCv" aria-label="Your shop from above"></canvas>
      <div id="planInfo"></div>
      <p class="muted">${names.length > 1 ? `You sell ${names.map((n, i) => `<b style="color:${P.colors[i]}">${esc(n)}</b>`).join(', ')}. 🔥 Trending today: <b>${esc(names[trend])}</b>. ` : ''}Islands near the door get more impulse buys, but more shoplifters. 🧺 Baskets by the door make shoppers buy a bit more, and 🍬 sweets by the till sell at the counter.</p>
      <div class="btns"><button class="btn" id="planReset">↺ Reset</button><button class="btn primary" id="planSave">Save layout</button></div>`);
    const cv = $('planCv');
    const draw = () => drawPlanCanvas(cv, P.shapes(b, lay), { pick });
    const info = () => {
      if (!pick) { $('planInfo').innerHTML = ''; return; }
      if (pick.type === 'prop') { $('planInfo').innerHTML = `<p class="muted">${P.PROP_KINDS[P.shapes(b, lay).props[pick.i].kind]}: drag it anywhere on the floor.</p>`; return; }
      const cur = P.unitLines(Object.assign({}, b, { layout: lay }))[pick.i];
      $('planInfo').innerHTML = `<p class="section-title">${UNIT_NAMES[pick.i]}${pick.i < 2 ? '' : ' (drag to move)'}</p>
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
    $('planSave').onclick = () => { b.layout = lay; save(); closeSheet(); toast('🧱 Layout saved: you\'ll see it next time you open the shop'); };
    draw();
  }
  $('shopServe').addEventListener('click', () => NeonShop.serve());
  {
    const cv = $('shopCanvas'), pts = new Map();
    let mode = null, start = null, last = null, pinch = 0;
    const at = (e) => { const rc = cv.getBoundingClientRect(); return [e.clientX - rc.left, e.clientY - rc.top]; };
    const gap = () => { const [a, b] = [...pts.values()]; return [Math.hypot(a[0] - b[0], a[1] - b[1]), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    cv.addEventListener('pointerdown', (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      pts.set(e.pointerId, at(e));
      if (pts.size === 2) { if (mode === 'drag') NeonShop.pointerUp(); mode = 'pinch'; pinch = gap()[0]; return; }
      start = last = at(e);
      mode = NeonShop.pointerDown(...start) === 'drag' ? 'drag' : 'press';
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = at(e); pts.set(e.pointerId, p);
      if (mode === 'pinch' && pts.size === 2) { const [d, mx, my] = gap(); if (pinch) NeonShop.zoomBy(d / pinch, mx, my); pinch = d; return; }
      if (mode === 'drag') { NeonShop.pointerMove(...p); return; }
      if (mode === 'press' && Math.hypot(p[0] - start[0], p[1] - start[1]) > 10) mode = 'pan';
      if (mode === 'pan') NeonShop.panBy(p[0] - last[0], p[1] - last[1]);
      last = p;
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      if (mode === 'drag') { if (NeonShop.pointerUp() === 'stocked') toast('📦 Shelf stocked by hand!'); }
      else if (mode === 'press') NeonShop.tap(...start);
      if (!pts.size) mode = null; else if (mode === 'pinch') mode = 'done';
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }
  $('shopZoom').onclick = () => NeonShop.resetZoom();
  $('shopWalk').onclick = () => {
    const res = NeonShop.toggleWalk();
    if (res === 'nocover') toast('🧾 Open Till 2 or hire a cashier first, so someone serves while you walk the floor.');
    else if (res === 'walking') toast('🚶 Tap the floor to walk. Tap a shopper to go to them.');
  };
  $('shopActs').addEventListener('click', (e) => { const el = e.target.closest('[data-do]'); if (el) NeonShop.act(el.dataset.do); });
  for (const el of document.querySelectorAll('[data-ret]')) el.onclick = () => NeonShop.resolveReturn(el.dataset.ret);
  $('shopTill').onclick = () => { const on = NeonShop.toggleTill2(); toast(on ? '🧾 The clerk opens till 2' : 'Till 2 closed: the clerk is back on the shop floor'); };
  $('shopUp').onclick = () => { const r = NeonShop.current(); if (r) nudgePrice(r.b, 0.05); };
  $('shopDown').onclick = () => { const r = NeonShop.current(); if (r) nudgePrice(r.b, -0.05); };
  $('shopRefill').onclick = () => { const r = NeonShop.current(); if (r) openSupplies(r.b); };
  $('shopClose').onclick = () => NeonShop.closeEarly();

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
        <p class="section-title">Borrow</p><div class="btns">${amounts('borrow')}</div></div>`;
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
      <div class="card"><h3>Where your money is</h3><div class="kv">${breakdown().map(([k, v]) => `<span>${k}</span><span class="${v < 0 ? 'down' : ''}">${money(v)}</span>`).join('')}</div></div>`;
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
  function closeSheet() { $('sheet').classList.add('hidden'); }
  $('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

  // ---------- days & travel ----------
  function openTravel() {
    openSheet(`<h2>🗺️ Where to?<button class="close" data-close>✕</button></h2>
      <p class="muted">Travelling takes the rest of the day.</p>
      ${T.DISTRICTS.map((d) => {
        const wants = T.GOODS.filter((g) => d.mods[g.id] >= 1.2).map((g) => g.icon).join(' ');
        const cheap = T.GOODS.filter((g) => d.mods[g.id] <= 0.8).map((g) => g.icon).join(' ');
        const mine = s.businesses.filter((b) => b.district === d.id).length;
        return `<button class="district${d.id === s.district ? ' here' : ''}" data-go="${d.id}"><span class="ic">${d.icon}</span>
          <span><b>${d.name}${d.id === s.district ? ' (you are here)' : ''}</b><small>${d.blurb}</small>
          <small>${cheap ? `Cheap: ${cheap}` : ''}${cheap && wants ? ' · ' : ''}${wants ? `Pays well: ${wants}` : ''}${mine ? ` · 🏪 ${mine} yours` : ''}</small></span></button>`;
      }).join('')}`);
    for (const b of document.querySelectorAll('[data-go]')) b.onclick = () => (b.dataset.go === s.district ? endDay(null) : endDay(b.dataset.go));
  }

  function endDay(dest) {
    if (s.finished) { showSeasonEnd(); return; }
    const rep = T.endDay(s, dest);
    save();
    render();
    const d = rep.nw - rep.nw0;
    const lines = rep.lines.length ? `<p class="section-title">Your businesses</p><div class="news">${rep.lines.map((l) => `<div><span>${l.icon}</span><span>${esc(l.text)}</span></div>`).join('')}</div>` : '';
    const news = s.news.length ? `<p class="section-title">News</p><div class="news">${s.news.map((n) => `<div><span>${n.icon}</span><span>${esc(n.text)}</span></div>`).join('')}</div>` : '<p class="muted">A quiet day in Neon City.</p>';
    openSheet(`<h2>☀️ Day ${Math.min(s.day, T.SEASON_DAYS)}${dest ? ` · ${T.D[s.district].icon} ${T.D[s.district].name}` : ''}</h2>
      <div><span class="big-num">${compact(rep.nw)}</span> <b class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${money(Math.abs(d))}</b></div>
      ${news}${lines}
      <div class="kv">${rep.sales ? `<span>Stall sales</span><span class="up">+${money(rep.sales)}</span>` : ''}${rep.production ? `<span>Production</span><span class="down">-${money(rep.production)}</span>` : ''}
        ${rep.upkeep ? `<span>Rent & upkeep</span><span class="down">-${money(rep.upkeep)}</span>` : ''}<span>Living costs</span><span class="down">-${money(rep.living)}</span>
        ${rep.interest ? `<span>Loan interest</span><span class="down">-${money(rep.interest)}</span>` : ''}${rep.earned ? `<span>Savings interest</span><span class="up">+${money(rep.earned)}</span>` : ''}</div>
      <button class="btn primary" data-close>${s.finished ? 'See final results' : 'Continue'}</button>`);
    if (s.finished) for (const b of $('sheetBody').querySelectorAll('[data-close]')) b.onclick = showSeasonEnd;
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
  showTitle();

  if (location.hash === '#test') window.tycoonTest = { state: () => s, T, endDay, encodeChallenge, shop: window.NeonShop };
})();
