'use strict';

// Neon Tycoon simulation: game state and rules only, no screen code.
// Fairness for friend challenges: each day's market dice come from (seed, day), so the
// prices, news and stock moves play out the same for everyone on the same seed. A
// player's own trades only move their own prices, and their businesses roll on a
// separate stream.
(function (root) {
  const SEASON_DAYS = 120;
  const SPREAD = 0.03;      // buy at +3%, sell at -3%
  const IMPACT = 0.6;       // log-price move for trading `depth` units at once

  const GOODS = [
    { id: 'drinks', name: 'Energy Drinks', icon: '🥤', base: 8, vol: 0.05, depth: 300 },
    { id: 'noodles', name: 'Street Noodles', icon: '🍜', base: 15, vol: 0.04, depth: 250 },
    { id: 'coffee', name: 'Coffee Beans', icon: '☕', base: 35, vol: 0.06, depth: 160 },
    { id: 'vinyl', name: 'Vinyl Records', icon: '💿', base: 60, vol: 0.08, depth: 90 },
    { id: 'holo', name: 'Holo Toys', icon: '🧸', base: 90, vol: 0.09, depth: 70 },
    { id: 'sneakers', name: 'Sneakers', icon: '👟', base: 150, vol: 0.07, depth: 60 },
    { id: 'chips', name: 'Phone Chips', icon: '💾', base: 400, vol: 0.1, depth: 40 },
    { id: 'signs', name: 'Neon Signs', icon: '🪧', base: 900, vol: 0.08, depth: 20 },
  ];
  const G = Object.fromEntries(GOODS.map((g) => [g.id, g]));

  // Price multipliers: below 1 where a good is made or shipped in, above 1 where people want it.
  const DISTRICTS = [
    { id: 'downtown', name: 'Downtown', icon: '🏙️', blurb: 'Offices and shoppers with money to spend.',
      mods: { drinks: 1.1, noodles: 1.15, coffee: 1.25, vinyl: 1.0, holo: 1.1, sneakers: 1.25, chips: 1.0, signs: 1.2 } },
    { id: 'docks', name: 'The Docks', icon: '⚓', blurb: 'Ships unload here: cheap imports.',
      mods: { drinks: 0.8, noodles: 0.95, coffee: 0.7, vinyl: 0.9, holo: 0.75, sneakers: 0.8, chips: 0.85, signs: 1.0 } },
    { id: 'tech', name: 'Tech Park', icon: '🛰️', blurb: 'Chip fabs and sign makers. Hungry engineers.',
      mods: { drinks: 1.2, noodles: 1.1, coffee: 1.15, vinyl: 1.1, holo: 1.25, sneakers: 1.05, chips: 0.75, signs: 0.8 } },
    { id: 'night', name: 'Night Market', icon: '🏮', blurb: 'Street food and second-hand records.',
      mods: { drinks: 0.9, noodles: 0.7, coffee: 0.95, vinyl: 0.75, holo: 0.9, sneakers: 0.9, chips: 1.15, signs: 0.9 } },
    { id: 'arena', name: 'The Arena', icon: '🏟️', blurb: 'Crowds, concerts and big appetites.',
      mods: { drinks: 1.35, noodles: 1.3, coffee: 1.05, vinyl: 1.25, holo: 1.2, sneakers: 1.15, chips: 1.1, signs: 1.1 } },
  ];
  const D = Object.fromEntries(DISTRICTS.map((d) => [d.id, d]));

  // Fictional companies; `links` ties a stock to the goods it makes money on.
  const STOCKS = [
    { id: 'NEON', name: 'NeonCorp', icon: '🌆', start: 120, vol: 0.022, links: [] },
    { id: 'PIXF', name: 'Pixel Foods', icon: '🍱', start: 45, vol: 0.028, links: ['noodles', 'drinks', 'coffee'] },
    { id: 'CHIP', name: 'ChipWorks', icon: '🔌', start: 210, vol: 0.04, links: ['chips', 'signs'] },
    { id: 'ARCM', name: 'Arcadia Media', icon: '🎧', start: 30, vol: 0.035, links: ['vinyl', 'holo'] },
    { id: 'STEP', name: 'StepUp', icon: '🏃', start: 75, vol: 0.03, links: ['sneakers'] },
  ];

  // Business tiers. Capacity and output are in dollars of base value per day, so a
  // stall moves many drinks or a few neon signs.
  const STALLS = [
    { name: 'Stall', cost: 1500, cap: 400, rent: 15 },
    { name: 'Shop', cost: 6000, cap: 2000, rent: 60 },
    { name: 'Megastore', cost: 40000, cap: 9000, rent: 220 },
  ];
  const FACTORIES = [
    { name: 'Workshop', cost: 3000, out: 300, upkeep: 25 },
    { name: 'Factory', cost: 12000, out: 1500, upkeep: 90 },
    { name: 'Plant', cost: 70000, out: 6000, upkeep: 300 },
  ];
  const PRODUCE_COST = 0.4;   // making a unit costs 40% of its base price
  const RESALE = 0.7;         // a business is worth (and sells for) 70% of what you put in
  const RETAIL = 1.15;        // default shelf price: a markup over the wholesale price
  // Each shopper will pay up to a personal multiple of the wholesale price, spread around
  // WILLING (lognormal). The same rule drives automatic sales and the hands-on shop.
  const WILLING = 1.3, WILLING_SPREAD = 0.2;
  const PRICE_MIN = 0.7, PRICE_MAX = 2;
  const VEHICLES = [
    { name: 'Backpack', cap: 60, cost: 0 },
    { name: 'Scooter', cap: 120, cost: 2000 },
    { name: 'Van', cap: 400, cost: 9000 },
    { name: 'Truck', cap: 1500, cost: 40000 },
  ];
  const DEPOSIT_RATE = 0.001;  // per day
  const LOAN_RATE = 0.005;     // per day
  const LIVING_COST = 15;      // per day

  const RANKS = [
    [0, 'Broke Dreamer'], [5000, 'Street Hustler'], [20000, 'Market Runner'], [60000, 'Shop Owner'],
    [200000, 'Business Boss'], [600000, 'Neon Tycoon'], [2000000, 'City Legend'],
  ];

  // ---------- randomness ----------
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mixSeed = (seed, day, stream) => (Math.imul(seed ^ 0x9e3779b9, 2654435761) + Math.imul(day + 1, 40503) + stream * 7919) >>> 0;
  const dayRng = (s, stream) => seeded(mixSeed(s.seed, s.day, stream));
  const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
  const round2 = (x) => Math.round(x * 100) / 100;
  const newSeed = () => (Math.random() * 4294967296) >>> 0;

  // ---------- state ----------
  function newGame(seed = newSeed(), opts = {}) {
    const s = {
      v: 1, seed, day: 1, district: 'downtown', cash: 2000, bank: 0, debt: 2000,
      cargo: {}, vehicle: 0, global: {}, noise: {}, impact: {}, effects: [],
      stocks: {}, shares: {}, businesses: [], nextId: 1,
      hist: { prices: {}, stocks: {}, nw: [] }, news: [], report: null,
      finished: false, rewarded: false, name: opts.name || '', challenge: opts.challenge || null,
    };
    const r = seeded(mixSeed(seed, 0, 99));
    for (const g of GOODS) s.global[g.id] = Math.exp(0.15 * gauss(r));
    for (const d of DISTRICTS) {
      s.noise[d.id] = {}; s.impact[d.id] = {}; s.hist.prices[d.id] = {};
      for (const g of GOODS) { s.noise[d.id][g.id] = 0.06 * gauss(r); s.impact[d.id][g.id] = 0; s.hist.prices[d.id][g.id] = []; }
    }
    for (const k of STOCKS) { s.stocks[k.id] = round2(k.start * Math.exp(0.1 * gauss(r))); s.shares[k.id] = 0; s.hist.stocks[k.id] = [s.stocks[k.id]]; }
    for (const d of DISTRICTS) for (const g of GOODS) s.hist.prices[d.id][g.id].push(price(s, d.id, g.id));
    s.hist.nw.push(netWorth(s));
    s.news = [{ icon: '👋', text: 'Welcome to Neon City! You have $2,000 and a $2,000 loan. Buy low, sell high, then build stalls and factories.' }];
    return s;
  }

  // Effects from news events: a multiplier on one good, optionally only in one district.
  // ---------- seasons and holidays (fixed days, the same for everyone) ----------
  const SEASONS = [{ from: 1, id: 'spring', icon: '🌸', name: 'Spring' }, { from: 31, id: 'summer', icon: '☀️', name: 'Summer' },
    { from: 61, id: 'autumn', icon: '🍂', name: 'Autumn' }, { from: 91, id: 'winter', icon: '❄️', name: 'Winter' }];
  const HOLIDAYS = [
    { id: 'valentine', from: 12, to: 15, icon: '💘', name: "Valentine's Day", goods: { signs: 1.6, holo: 1.3 } },
    { id: 'lunar', from: 25, to: 28, icon: '🏮', name: 'Lunar New Year', goods: { noodles: 1.4, signs: 1.3, holo: 1.2 } },
    { id: 'summer', from: 45, to: 51, icon: '🏖️', name: 'Summer holidays', goods: { drinks: 1.35, sneakers: 1.2 } },
    { id: 'neonfest', from: 64, to: 67, icon: '🎆', name: 'Neon Fest', goods: { drinks: 1.3, vinyl: 1.4, signs: 1.3 } },
    { id: 'halloween', from: 78, to: 83, icon: '🎃', name: 'Halloween', goods: { holo: 1.4, noodles: 1.2, signs: 1.2 } },
    { id: 'school', from: 86, to: 90, icon: '🎒', name: 'Back to school', goods: { sneakers: 1.3, chips: 1.25, coffee: 1.15 } },
    { id: 'xmas', from: 108, to: 116, icon: '🎄', name: 'Neon Christmas', goods: { holo: 1.6, sneakers: 1.4, vinyl: 1.4, chips: 1.3 } },
  ];
  const season = (day) => SEASONS.filter((x) => day >= x.from).pop();
  const holiday = (day) => HOLIDAYS.find((h) => day >= h.from && day <= h.to) || null;

  function effectMod(s, d, g) {
    let m = 1;
    for (const e of s.effects) if (e.good === g && (!e.district || e.district === d)) m *= e.mult;
    const h = holiday(s.day);
    if (h && h.goods[g]) m *= h.goods[g];
    return m;
  }

  function price(s, d, g) {
    return round2(G[g].base * D[d].mods[g] * s.global[g] * effectMod(s, d, g) * Math.exp(s.noise[d][g] + s.impact[d][g]));
  }
  const buyPrice = (s, d, g) => round2(price(s, d, g) * (1 + SPREAD));
  const sellPrice = (s, d, g) => round2(price(s, d, g) * (1 - SPREAD));

  // Cost of buying / proceeds of selling q units here, including how the trade moves the price.
  function quote(s, g, q, side) {
    if (q <= 0) return 0;
    const shift = (IMPACT * q) / G[g].depth;
    const avg = side === 'buy' ? Math.exp(shift / 2) : Math.exp(-shift / 2);
    const unit = side === 'buy' ? buyPrice(s, s.district, g) : sellPrice(s, s.district, g);
    return Math.round(unit * avg * q * 100) / 100;
  }

  const cargoUsed = (s) => Object.values(s.cargo).reduce((a, b) => a + b, 0);
  const cargoCap = (s) => VEHICLES[s.vehicle].cap;

  function maxBuy(s, g) {
    let lo = 0, hi = Math.max(0, cargoCap(s) - cargoUsed(s));
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (quote(s, g, mid, 'buy') <= s.cash) lo = mid; else hi = mid - 1; }
    return lo;
  }

  function buy(s, g, q) {
    q = Math.floor(q);
    if (s.finished || q <= 0) return { ok: false, msg: 'Nothing to buy.' };
    if (cargoUsed(s) + q > cargoCap(s)) return { ok: false, msg: 'Not enough cargo space.' };
    const cost = quote(s, g, q, 'buy');
    if (cost > s.cash) return { ok: false, msg: 'Not enough cash.' };
    s.cash = round2(s.cash - cost);
    s.cargo[g] = (s.cargo[g] || 0) + q;
    s.impact[s.district][g] += (IMPACT * q) / G[g].depth;
    return { ok: true, cost };
  }

  function sell(s, g, q) {
    q = Math.min(Math.floor(q), s.cargo[g] || 0);
    if (s.finished || q <= 0) return { ok: false, msg: 'Nothing to sell.' };
    const got = quote(s, g, q, 'sell');
    s.cash = round2(s.cash + got);
    s.cargo[g] -= q;
    if (!s.cargo[g]) delete s.cargo[g];
    s.impact[s.district][g] -= (IMPACT * q) / G[g].depth;
    return { ok: true, got };
  }

  // ---------- shoppers & prices ----------
  function normCdf(x) { // Abramowitz-Stegun approximation
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp((-x * x) / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
  }
  // share of shoppers happy to pay `mult` x the wholesale price
  const willingShare = (mult) => normCdf(Math.log(WILLING / mult) / WILLING_SPREAD);
  // demand relative to the default shelf price (1 at RETAIL)
  const priceDemand = (mult) => willingShare(mult) / willingShare(RETAIL);
  // a random shopper's limit, for the hands-on shop
  const shopperLimit = (r = Math.random) => WILLING * Math.exp(WILLING_SPREAD * gauss(r));
  const shelfPrice = (s, b) => round2(price(s, b.district, b.good) * (b.mult || RETAIL));

  function setShelfPrice(s, id, mult) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || b.kind !== 'stall') return { ok: false, msg: 'Not found.' };
    b.mult = Math.round(Math.max(PRICE_MIN, Math.min(PRICE_MAX, mult)) * 100) / 100;
    return { ok: true };
  }

  // A day you run the shop yourself: sales happen live, and the automatic sales are skipped.
  function shopDayAvailable(s, b) { return b && b.kind === 'stall' && b.district === s.district && b.servedDay !== s.day && b.closedDay !== s.day && !s.finished; }
  function startShopDay(s, id) {
    const b = s.businesses.find((x) => x.id === id);
    if (!shopDayAvailable(s, b)) return { ok: false, msg: b && b.closedDay === s.day ? 'Closed today for repairs.' : b && b.servedDay === s.day ? 'You already ran this shop today.' : 'You need to be at this shop.' };
    b.servedDay = s.day;
    b.last = { sold: 0, revenue: 0, demand: 0, live: true };
    return { ok: true, b };
  }
  // one sale at the counter during a hands-on day
  function shopSale(s, id, qty) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b) return { ok: false };
    qty = Math.min(qty, b.stock);
    if (qty <= 0) return { ok: false, msg: 'Out of stock' };
    const red = takeStock(s, b, qty); // marked-down packs go at half price
    const revenue = round2((qty - red * 0.5) * shelfPrice(s, b));
    s.cash = round2(s.cash + revenue);
    b.last.sold += qty; b.last.revenue = round2(b.last.revenue + revenue);
    return { ok: true, qty, revenue, reduced: red };
  }
  // top up the shelves from your cargo and any workshop in this district making the same good
  function shelfRoom(b) { return Math.max(0, holdOf(b) - b.stock); }
  function refillShelves(s, id) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b) return { ok: false, msg: 'Not found.' };
    let moved = 0;
    for (const f of s.businesses) {
      if (f.kind !== 'factory' || f.district !== b.district || f.good !== b.good) continue;
      const m = Math.min(f.stock, shelfRoom(b)); f.stock -= m; addStock(s, b, m); moved += m;
    }
    const w = whOf(s, b.district), fromWh = w ? Math.min(w.goods[b.good] || 0, shelfRoom(b)) : 0; // the warehouse in this district
    if (fromWh) { w.goods[b.good] -= fromWh; if (!w.goods[b.good]) delete w.goods[b.good]; addStock(s, b, fromWh); moved += fromWh; }
    const fromCargo = Math.min(s.cargo[b.good] || 0, shelfRoom(b));
    if (fromCargo) { s.cargo[b.good] -= fromCargo; if (!s.cargo[b.good]) delete s.cargo[b.good]; addStock(s, b, fromCargo); moved += fromCargo; }
    return moved ? { ok: true, moved } : { ok: false, msg: `No ${G[b.good].name} in your cargo, workshop or warehouse.` };
  }

  // ---------- weather: the same for everyone on a seed, and hot during a heatwave ----------
  const WEATHER = {
    sunny: { icon: '☀️', name: 'Sunny', crowd: 1 },
    cloudy: { icon: '☁️', name: 'Cloudy', crowd: 0.97 },
    rain: { icon: '🌧️', name: 'Rainy', crowd: 0.82 },
    snow: { icon: '🌨️', name: 'Snowy', crowd: 0.8 },
    hot: { icon: '🥵', name: 'Hot', crowd: 1.05 },
  };
  function weather(s, day = s.day) {
    if (s.forceWeather && day === s.day) return s.forceWeather; // (a challenge day)
    if (s.effects.some((e) => e.good === 'drinks' && !e.district && e.mult >= 1.5 && e.until > day)) return 'hot';
    const x = seeded(mixSeed(s.seed, day, 99))();
    const winter = season(day).id === 'winter', summer = season(day).id === 'summer';
    return x < 0.22 ? (winter ? 'snow' : 'rain') : x < 0.45 ? 'cloudy' : x < (summer ? 0.84 : 0.9) ? 'sunny' : winter ? 'cloudy' : 'hot';
  }
  // what the weather does to what people buy: cold drinks on a hot day, hot noodles and coffee in the snow
  const WEATHER_GOODS = {
    sunny: { drinks: 1.08, sneakers: 1.05 }, cloudy: {}, hot: { drinks: 1.35, coffee: 0.85, noodles: 0.9 },
    rain: { coffee: 1.2, noodles: 1.2, vinyl: 1.1, sneakers: 0.85 }, snow: { coffee: 1.3, noodles: 1.3, drinks: 0.85, sneakers: 0.8, holo: 1.1 },
  };
  const weatherDemand = (s, g, day = s.day) => WEATHER_GOODS[weather(s, day)][g] || 1;
  // tomorrow's weather, as the forecast has it (a heatwave can still surprise you)
  const forecast = (s) => ({ id: weather(s, s.day + 1), demand: (g) => weatherDemand(s, g, s.day + 1) });
  // a stall's star rating (from the reviews on days you ran it) brings more or fewer shoppers
  const ratingMod = (b) => (b.rating ? 1 + (b.rating - 3.5) * 0.06 : 1);
  // word of mouth: what people say about a shop's prices, stock, queue and service (0 to 100, 50 = nothing much)
  const REP_KEYS = ['price', 'stock', 'queue', 'service'];
  const repOf = (b) => Object.assign({ price: 50, stock: 50, queue: 50, service: 50 }, b.rep);
  const repMod = (b) => { const r = repOf(b), avg = REP_KEYS.reduce((a, k) => a + r[k], 0) / REP_KEYS.length; return 1 + ((avg - 50) / 50) * 0.12; };

  // ---------- sell-by dates: food and drink go off ----------
  // Perishable stock is kept in dated batches. The oldest sells first, it's marked down to half
  // price in its last two days, and it's thrown out once past its date.
  const LIFE = { drinks: 12, noodles: 6, coffee: 15 };
  const REDUCED_DAYS = 2;
  function syncBatches(s, b) {
    if (b.kind !== 'stall' || !LIFE[b.good]) { delete b.batches; return null; }
    const sum = (b.batches || []).reduce((a, x) => a + x.q, 0);
    if (!b.batches || sum !== b.stock) b.batches = b.stock > 0 ? [{ q: b.stock, d: s.day }] : [];
    return b.batches;
  }
  const daysLeft = (s, b, x) => LIFE[b.good] - (s.day - x.d);
  function addStock(s, b, q) {
    const bt = syncBatches(s, b);
    b.stock += q;
    if (bt && q > 0) { const last = bt[bt.length - 1]; if (last && last.d === s.day) last.q += q; else bt.push({ q, d: s.day }); }
  }
  // take q units, oldest first; returns how many of them were marked down
  function takeStock(s, b, q) {
    const bt = syncBatches(s, b);
    b.stock -= q;
    if (!bt) return 0;
    let red = 0;
    while (q > 0 && bt.length) {
      const x = bt[0], n = Math.min(q, x.q);
      if (daysLeft(s, b, x) <= REDUCED_DAYS) red += n;
      x.q -= n; q -= n;
      if (!x.q) bt.shift();
    }
    return red;
  }
  function freshness(s, b) {
    const bt = syncBatches(s, b);
    if (!bt) return null;
    let reduced = 0, expiring = 0;
    for (const x of bt) { const dl = daysLeft(s, b, x); if (dl <= REDUCED_DAYS) reduced += x.q; if (dl <= 1) expiring += x.q; }
    return { reduced, expiring, life: LIFE[b.good] };
  }

  // ---------- staff you hire for a stall ----------
  const STAFF_SLOTS = [1, 2, 4];
  const SKILLS = {
    cashier: { icon: '⚡', name: 'Fast cashier', wage: 35, desc: 'Serves shoppers quickly.' },
    friendly: { icon: '😊', name: 'Friendly', wage: 30, desc: 'Shoppers wait longer; sells 3% more on normal days.' },
    stocker: { icon: '📦', name: 'Stocker', wage: 30, desc: 'Keeps shelves full: the clerk works faster.' },
  };
  const NAMES = ['Maya', 'Leo', 'Zara', 'Kai', 'Nina', 'Omar', 'Ivy', 'Jin', 'Rosa', 'Theo', 'Ama', 'Felix', 'Luna', 'Ravi', 'Sofia', 'Eli', 'Noor', 'Max', 'Yuki', 'Tariq'];
  function staffOf(b) {
    if (!b.staff) b.staff = Array.from({ length: b.kind === 'stall' ? [0, 1, 3][b.tier] : 0 }, (_, i) => ({ name: NAMES[(b.id * 7 + i * 5) % NAMES.length], skill: 'cashier', wage: 35, morale: 70 }));
    return b.staff;
  }
  // three people looking for work today (the same all day)
  function candidates(s, b) {
    const r = seeded(mixSeed(s.seed, s.day, 300 + b.id)), keys = Object.keys(SKILLS);
    return [0, 1, 2].map(() => { const skill = keys[Math.floor(r() * keys.length)]; return { name: NAMES[Math.floor(r() * NAMES.length)], skill, wage: SKILLS[skill].wage + Math.floor(r() * 3) * 5, look: Math.floor(r() * 1e6) }; });
  }
  function hire(s, id, i) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || b.kind !== 'stall') return { ok: false, msg: 'Not found.' };
    const staff = staffOf(b);
    if (staff.length >= staffSlots(b)) return { ok: false, msg: `Your ${STALLS[b.tier].name.toLowerCase()} has room for ${staffSlots(b)}. Expand it (🏗️) or upgrade for more staff.` };
    const c = candidates(s, b)[i];
    if (!c || staff.some((x) => x.name === c.name)) return { ok: false, msg: 'They already work for you.' };
    staff.push({ name: c.name, skill: c.skill, wage: c.wage, morale: 75, look: c.look });
    return { ok: true, c };
  }
  function fireStaff(s, id, i) { const b = s.businesses.find((x) => x.id === id); if (!b || !staffOf(b)[i]) return { ok: false, msg: 'Not found.' }; b.staff.splice(i, 1); return { ok: true }; }
  function giveBonus(s, id, i) {
    const b = s.businesses.find((x) => x.id === id), m = b && staffOf(b)[i];
    if (!m) return { ok: false, msg: 'Not found.' };
    if (s.cash < 50) return { ok: false, msg: 'A bonus costs $50.' };
    s.cash = round2(s.cash - 50); m.morale = Math.min(100, m.morale + 30);
    return { ok: true };
  }

  // ---------- a manager runs a shop on the days you don't: reorders stock, and sells a bit more ----------
  const MANAGER_STYLES = {
    steady: { icon: '🧑‍💼', name: 'Steady', desc: 'Keeps the shelves full from the fast supplier. Now and then forgets to order.', sell: 1, supplier: 'express' },
    seller: { icon: '💬', name: 'Upseller', desc: 'Sells more to every shopper, but tends to over-order.', sell: 1.08, supplier: 'express' },
    thrifty: { icon: '🪙', name: 'Penny-pincher', desc: 'Orders from the cheap supplier to save money; deliveries can come up short.', sell: 0.98, supplier: 'budget' },
  };
  const MANAGER_MAX = 5;
  const managerWage = (m) => 50 + 15 * m.level;
  const trainCost = (m) => 250 * m.level;
  function managerCandidates(s, b) {
    const r = seeded(mixSeed(s.seed, s.day, 500 + b.id)), keys = Object.keys(MANAGER_STYLES);
    return [0, 1].map(() => { const style = keys[Math.floor(r() * keys.length)], level = r() < 0.25 ? 2 : 1; return { name: NAMES[Math.floor(r() * NAMES.length)], style, level, look: Math.floor(r() * 1e6) }; });
  }
  function hireManager(s, id, i) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || b.kind !== 'stall') return { ok: false, msg: 'Not found.' };
    if (b.manager) return { ok: false, msg: `${b.manager.name} already manages this shop.` };
    const c = managerCandidates(s, b)[i];
    if (!c) return { ok: false, msg: 'Not found.' };
    b.manager = { name: c.name, style: c.style, level: c.level, xp: 0, look: c.look, days: 0 };
    return { ok: true, m: b.manager };
  }
  function fireManager(s, id) { const b = s.businesses.find((x) => x.id === id); if (!b || !b.manager) return { ok: false, msg: 'No manager.' }; b.manager = null; return { ok: true }; }
  function trainManager(s, id) {
    const b = s.businesses.find((x) => x.id === id), m = b && b.manager;
    if (!m) return { ok: false, msg: 'No manager.' };
    if (m.level >= MANAGER_MAX) return { ok: false, msg: `${m.name} is already at the top level.` };
    if (s.cash < trainCost(m)) return { ok: false, msg: `Training costs $${trainCost(m).toLocaleString()}.` };
    s.cash = round2(s.cash - trainCost(m)); spend(s, 'other', trainCost(m));
    m.level++; m.xp = 0;
    return { ok: true, m };
  }
  // the manager's morning: check the stock and reorder (their style decides how, and how it goes wrong)
  function managerOrder(s, b, rep) {
    const m = b.manager, st = MANAGER_STYLES[m.style], units = unitsPerDay(STALLS[b.tier].cap, b.good);
    const r = seeded(mixSeed(s.seed, s.day, 900 + b.id)), slip = r() < Math.max(0.03, 0.2 - 0.035 * m.level), lvl = `Lv ${m.level} ${st.name}`;
    const say = (text) => { m.last = text; rep.lines.push({ icon: st.icon, text: `${m.name} (${lvl}) at ${D[b.district].name}: ${text}` }); };
    if (b.stock >= units * 1.5) return say('plenty of stock, no order today.');
    if (slip && m.style === 'steady') return say('forgot to order stock today! 🤦');
    let q = Math.min(orderRoom(b), Math.ceil(units * 2.5 - b.stock));
    if (slip && m.style === 'seller') q = orderRoom(b); // fills the stockroom to the ceiling
    const sp = SUPPLIERS[st.supplier], each = round2(price(s, b.district, b.good) * sp.cost * labelCost(b));
    q = Math.min(q, Math.floor((s.cash - 200) / each));
    if (q <= 0) return say('wanted to order stock but there wasn\'t enough cash.');
    const got = slip && m.style === 'thrifty' ? Math.max(1, Math.floor(q * (0.55 + r() * 0.2))) : q;
    s.cash = round2(s.cash - got * each); spend(s, 'stock', got * each);
    addStock(s, b, got);
    say(`ordered ${got} ${G[b.good].name} from ${sp.name} for $${Math.round(got * each).toLocaleString()}${got < q ? ` (only ${got} of ${q} turned up)` : ''}${slip && m.style === 'seller' ? ' (a bit much!)' : ''}.`);
  }
  const managerMod = (b) => (b.manager ? MANAGER_STYLES[b.manager.style].sell * (1 + 0.025 * (b.manager.level - 1)) : 1);

  // ---------- a rival shop over the road (from day 8): its prices move, and it runs sales ----------
  const RIVALS = { downtown: 'MegaMart', docks: 'Dockside Deals', tech: 'ByteBuy', night: 'Night Owl', arena: 'Fan Zone' };
  // The rival remembers: undercut them for long and they fight back with lower prices and more
  // sales (b.rv.fight, 0 to 1); run promotions and they copy them. They also try to poach your regulars.
  function rival(s, b, day = s.day) {
    if (day < 8) return null;
    const r = seeded(mixSeed(s.seed, day, 200 + DISTRICTS.findIndex((d) => d.id === b.district) * 10 + GOODS.findIndex((g) => g.id === b.good)));
    const fight = (b.rv && b.rv.fight) || 0, copy = b.promos && Object.keys(b.promos).length ? 0.1 : 0;
    const roll = r(), sale = roll < 0.15 + copy + fight * 0.15, k = r();
    return { name: RIVALS[b.district] || 'MegaMart', mult: round2(sale ? 0.95 + k * 0.05 : 1.12 + k * 0.22 - fight * 0.16), sale, fight, copied: sale && roll >= 0.15 + fight * 0.15 };
  }
  // price match: shoppers who'd go over the road for a cheaper price pay the rival's price instead
  function rivalMod(s, b, mult) {
    const rv = rival(s, b);
    if (!rv) return 1;
    if (b.priceMatch && mult > rv.mult * 1.05) return 1;
    return mult > rv.mult * 1.05 ? 0.82 : mult < rv.mult * 0.95 ? 1.08 : 1;
  }
  // with price matching, what a sale really earns: about a third of shoppers ask for the match
  const MATCH_SHARE = 0.35;
  function matchedMult(s, b, mult) {
    const rv = rival(s, b);
    return rv && b.priceMatch && mult > rv.mult * 1.05 ? mult * (1 - MATCH_SHARE) + rv.mult * MATCH_SHARE : mult;
  }
  function setPriceMatch(s, id, on) { const b = s.businesses.find((x) => x.id === id); if (!b || b.kind !== 'stall') return { ok: false, msg: 'Not found.' }; b.priceMatch = !!on; return { ok: true }; }
  // overnight: how hard the rival fights back, and whether they win over one of your regulars
  function rivalNight(s, b, news) {
    const rv = rival(s, b);
    if (!rv) return;
    const st = b.rv = b.rv || { fight: 0, poached: 0 }, mult = b.mult || RETAIL, was = st.fight;
    st.fight = round2(clamp(st.fight + (mult < rv.mult * 0.97 ? 0.12 : -0.06), 0, 1));
    if (was < 0.6 && st.fight >= 0.6) news.push({ icon: '🥊', text: `${rv.name} is slashing prices at ${D[b.district].name} to win your shoppers back.` });
    if (was >= 0.3 && st.fight < 0.3) news.push({ icon: '🕊️', text: `${rv.name} at ${D[b.district].name} has stopped fighting you on price.` });
    const rr = seeded(mixSeed(s.seed, s.day, 800 + b.id));
    const chance = (mult > rv.mult * 1.05 && !b.priceMatch ? 0.12 : 0.03) + st.fight * 0.06;
    if (b.regulars && b.regulars.length && !(b.upgrades && b.upgrades.loyalty) && rr() < chance) {
      const lost = b.regulars.splice(Math.floor(rr() * b.regulars.length), 1)[0];
      st.poached++;
      news.push({ icon: '💔', text: `${lost.name}, one of your regulars at ${D[b.district].name}, now shops at ${rv.name}. A 💳 loyalty scheme keeps regulars with you.` });
    }
  }

  // ---------- ordering stock from a supplier ----------
  const SUPPLIERS = {
    budget: { icon: '🐢', name: 'Budget Bulk', cost: 0.85, delay: [18, 30], short: 0.25, desc: 'Cheap but slow, and sometimes short.' },
    express: { icon: '⚡', name: 'Neon Express', cost: 1.12, delay: [3, 6], short: 0, desc: 'Fast and always complete, but pricier.' },
  };
  function orderRoom(b) { return Math.max(0, holdOf(b) - b.stock); }
  function orderStock(s, id, key, qty) {
    const b = s.businesses.find((x) => x.id === id), sp = SUPPLIERS[key];
    if (!b || b.kind !== 'stall' || !sp) return { ok: false, msg: 'Not found.' };
    qty = Math.min(Math.floor(qty), orderRoom(b));
    if (qty <= 0) return { ok: false, msg: 'Your shelves and stockroom are full.' };
    const each = round2(price(s, b.district, b.good) * sp.cost * labelCost(b));
    if (s.cash < qty * each) return { ok: false, msg: `That costs $${Math.round(qty * each).toLocaleString()}.` };
    const got = Math.random() < sp.short ? Math.max(1, Math.floor(qty * (0.6 + Math.random() * 0.2))) : qty;
    s.cash = round2(s.cash - got * each); spend(s, 'stock', got * each);
    addStock(s, b, got);
    const [d0, d1] = sp.delay;
    return { ok: true, got, qty, cost: round2(got * each), each, delay: d0 + Math.random() * (d1 - d0) };
  }
  // ---------- supplier contracts: a locked price, with a delivery every two days ----------
  const CONTRACT = { days: 14, every: 2, disc: 0.9, cancel: 150 };
  function signContract(s, id, qty) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || b.kind !== 'stall') return { ok: false, msg: 'Not found.' };
    if (b.contract) return { ok: false, msg: 'This shop already has a contract.' };
    qty = Math.max(1, Math.min(Math.floor(qty), unitsPerDay(STALLS[b.tier].cap, b.good) * 2));
    b.contract = { qty, each: round2(price(s, b.district, b.good) * CONTRACT.disc * labelCost(b)), from: s.day, until: s.day + CONTRACT.days };
    return { ok: true, contract: b.contract };
  }
  function cancelContract(s, id) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || !b.contract) return { ok: false, msg: 'No contract.' };
    if (s.cash < CONTRACT.cancel) return { ok: false, msg: `Cancelling costs $${CONTRACT.cancel}.` };
    s.cash = round2(s.cash - CONTRACT.cancel); spend(s, 'other', CONTRACT.cancel);
    b.contract = null;
    return { ok: true };
  }
  // ---------- leases: a shop's rent is reviewed every 30 days (busy, well-liked shops cost more) ----------
  const LEASE_DAYS = 30, TAX_RATE = 0.1;
  const rentOf = (b) => (b.kind === 'stall' ? (b.owned ? 0 : Math.round((b.rent || STALLS[b.tier].rent) * (1 + 0.2 * expOf(b).floor))) : FACTORIES[b.tier].upkeep);
  function newLease(s, b) { b.rent = STALLS[b.tier].rent; b.leaseUntil = s.day + LEASE_DAYS; }
  // money out that isn't the day's running costs: stock bought, upgrades, fees (for the cash flow)
  function spend(s, kind, amount) { s.spent = s.spent || {}; s.spent[kind] = round2((s.spent[kind] || 0) + amount); }

  // a haul video from your shop brings a buzz of extra shoppers the next day
  const buzzMod = (s, b) => (b.buzz && b.buzz.day === s.day ? b.buzz.mult : 1);

  // ---------- shop upgrades, bought with cash, that change how the shop works ----------
  const SHOP_UPGRADES = {
    selfcheck: { icon: '🖥️', name: 'Self-checkout', cost: 2500, desc: 'Some shoppers scan and pay by themselves.' },
    coffee: { icon: '☕', name: 'Coffee corner', cost: 4000, desc: 'Draws 12% more shoppers, and some buy a coffee.' },
    fridge: { icon: '🧊', name: 'Cold drinks fridge', cost: 3000, desc: 'Shoppers grab cold drinks from the fridge, more on hot days.' },
    gates: { icon: '🚨', name: 'Security gates', cost: 2000, desc: 'Shoplifters are stopped at the door automatically.' },
    loyalty: { icon: '💳', name: 'Loyalty scheme', cost: 1800, desc: 'Regulars stay with you even when the rival is cheaper, and more shoppers sign up.' },
    online: { icon: '📱', name: 'Online shop', cost: 3000, desc: 'Delivery orders come in on a tablet: pack them and a rider takes them out. 8% more sales on days you\'re not there.' },
  };
  function buyShopUpgrade(s, id, key) {
    const b = s.businesses.find((x) => x.id === id), u = SHOP_UPGRADES[key];
    if (!b || b.kind !== 'stall' || !u) return { ok: false, msg: 'Not found.' };
    if (b.upgrades && b.upgrades[key]) return { ok: false, msg: 'Already installed.' };
    if (s.cash < u.cost) return { ok: false, msg: `You need $${u.cost.toLocaleString()} cash.` };
    s.cash = round2(s.cash - u.cost); spend(s, 'other', u.cost);
    b.invested += u.cost;
    b.upgrades = Object.assign({}, b.upgrades, { [key]: true });
    return { ok: true };
  }
  // money from the shop that isn't your own stock: cold drinks, coffee and tips
  function shopExtra(s, id, amount) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || !b.last) return { ok: false };
    s.cash = round2(s.cash + amount);
    b.last.extra = round2((b.last.extra || 0) + amount);
    return { ok: true };
  }
  // goods walked out of the door without paying
  function shopLoss(s, id, qty) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || !b.last) return { ok: false };
    qty = Math.min(qty, b.stock);
    takeStock(s, b, qty);
    b.last.stolen = (b.last.stolen || 0) + qty;
    return { ok: true, qty };
  }

  // ---------- make a shop bigger without moving: more stockroom, more floor, more staff ----------
  const EXPANSIONS = {
    stock: { icon: '📦', name: 'Bigger stockroom', costs: [1200, 3500], desc: 'Holds half as much stock again each time (orders, contracts, deliveries).' },
    floor: { icon: '🧱', name: 'More floor space', costs: [2500, 6500], desc: 'Knock through: a new shelf island and room for more shoppers. Rent goes up 20%.' },
    staff: { icon: '👥', name: 'Staff room', costs: [800, 2200], desc: 'Room for one more member of staff each time.' },
  };
  const expOf = (b) => Object.assign({ stock: 0, floor: 0, staff: 0 }, b.exp);
  const holdOf = (b) => Math.round(unitsPerDay(STALLS[b.tier].cap, b.good) * (3 + 1.5 * expOf(b).stock));
  const staffSlots = (b) => STAFF_SLOTS[b.tier] + expOf(b).staff;
  const expandCost = (b, key) => { const e = EXPANSIONS[key], lvl = expOf(b)[key]; return lvl < e.costs.length ? Math.round(e.costs[lvl] * (1 + b.tier * 1.5)) : null; };
  function expandShop(s, id, key) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || b.kind !== 'stall' || !EXPANSIONS[key]) return { ok: false, msg: 'Not found.' };
    const cost = expandCost(b, key);
    if (cost === null) return { ok: false, msg: 'Already as big as it gets.' };
    if (s.cash < cost) return { ok: false, msg: `You need $${cost.toLocaleString()}.` };
    s.cash = round2(s.cash - cost); spend(s, 'other', cost);
    b.invested += cost; b.exp = Object.assign(expOf(b), { [key]: expOf(b)[key] + 1 });
    return { ok: true, cost };
  }

  // ---------- own the building: no more rent (pay cash, or a mortgage over 60 days), and let the flat upstairs ----------
  const buildingPrice = (b) => Math.round(STALLS[b.tier].rent * 150 * (1 + 0.2 * expOf(b).floor));
  const MORTGAGE = { down: 0.25, days: 60, interest: 0.15 };
  function buyBuilding(s, id, mortgage) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || b.kind !== 'stall') return { ok: false, msg: 'Not found.' };
    if (b.owned) return { ok: false, msg: 'You already own it.' };
    const price = buildingPrice(b), pay = mortgage ? Math.round(price * MORTGAGE.down) : price;
    if (s.cash < pay) return { ok: false, msg: `You need $${pay.toLocaleString()}${mortgage ? ' for the deposit' : ''}.` };
    s.cash = round2(s.cash - pay); spend(s, 'other', pay);
    b.owned = { price, since: s.day, mortgage: mortgage ? { daily: round2((price - pay) * (1 + MORTGAGE.interest) / MORTGAGE.days), left: MORTGAGE.days } : null };
    b.leaseUntil = null;
    return { ok: true, pay };
  }
  // what the building is worth: a little more each day you own it
  const propertyValue = (s, b) => (b.owned ? Math.round(b.owned.price * (1 + Math.min(0.3, 0.002 * (s.day - b.owned.since)))) : 0);
  const mortgageLeft = (b) => (b.owned && b.owned.mortgage ? round2(b.owned.mortgage.daily * b.owned.mortgage.left) : 0);
  const subletIncome = (b) => (b.owned && b.sublet && b.tier >= 1 ? Math.round(STALLS[b.tier].rent * 0.45) : 0);
  function setSublet(s, id, on) { const b = s.businesses.find((x) => x.id === id); if (!b || !b.owned || b.tier < 1) return { ok: false, msg: 'Own a shop or megastore to let the flat upstairs.' }; b.sublet = !!on; return { ok: true }; }

  // ---------- marketing: flyers, a billboard or a radio ad bring more shoppers for a few days ----------
  const CAMPAIGNS = {
    flyers: { icon: '📄', name: 'Flyers', cost: 150, days: 3, boost: 0.1, desc: 'Hand out flyers on the street: +10% shoppers for 3 days.' },
    billboard: { icon: '🪧', name: 'Billboard', cost: 900, days: 7, boost: 0.18, desc: 'Your name across the road: +18% shoppers for a week.' },
    radio: { icon: '📻', name: 'Radio ad', cost: 2200, days: 5, boost: 0.3, desc: 'Heard across the city: +30% shoppers for 5 days.' },
  };
  const campaignCost = (b, id) => Math.round(CAMPAIGNS[id].cost * [1, 2.5, 6][b.tier]);
  const adsOf = (s, b) => (b.ads || []).filter((a) => a.until >= s.day);
  const adMod = (s, b) => 1 + Math.min(0.5, adsOf(s, b).reduce((a, x) => a + CAMPAIGNS[x.id].boost, 0));
  function runCampaign(s, id, key) {
    const b = s.businesses.find((x) => x.id === id), c = CAMPAIGNS[key];
    if (!b || b.kind !== 'stall' || !c) return { ok: false, msg: 'Not found.' };
    if (adsOf(s, b).some((a) => a.id === key)) return { ok: false, msg: `Your ${c.name.toLowerCase()} is still running.` };
    const cost = campaignCost(b, key);
    if (s.cash < cost) return { ok: false, msg: `That costs $${cost.toLocaleString()}.` };
    s.cash = round2(s.cash - cost); spend(s, 'other', cost);
    b.ads = adsOf(s, b).concat([{ id: key, from: s.day, until: s.day + c.days - 1, cost, extra: 0 }]);
    return { ok: true, cost };
  }
  // followers on NeonGram (from photos you post) bring a few more shoppers to every shop
  const followerMod = (s) => 1 + Math.min(0.15, (s.followers || 0) / 4000);
  function postPhoto(s, id, quality) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b) return { ok: false, msg: 'Not found.' };
    if (b.posted === s.day) return { ok: false, msg: 'You already posted this shop today.' };
    const gain = Math.round((20 + (b.rating || 3) * 12 + (quality || 0) * 30) * (1 + Math.min(1, (s.followers || 0) / 3000)) * (0.8 + Math.random() * 0.4));
    s.followers = (s.followers || 0) + gain; b.posted = s.day;
    return { ok: true, gain, followers: s.followers };
  }

  // ---------- a side counter: a shop or megastore sells a second product by the till ----------
  const SIDE_COST = 2500;
  const sideCap = (b) => unitsPerDay(STALLS[b.tier].cap * 0.3, b.side.good) * 3;
  function openSide(s, id, good) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || b.kind !== 'stall' || !G[good]) return { ok: false, msg: 'Not found.' };
    if (b.tier < 1) return { ok: false, msg: 'Upgrade to a shop for a side counter.' };
    if (good === b.good) return { ok: false, msg: 'Pick a different product from your shelves.' };
    if (b.side) { if (b.side.stock) return { ok: false, msg: 'Sell or take back the side counter stock first.' }; b.side.good = good; return { ok: true }; }
    if (s.cash < SIDE_COST) return { ok: false, msg: `A side counter costs $${SIDE_COST.toLocaleString()}.` };
    s.cash = round2(s.cash - SIDE_COST); spend(s, 'other', SIDE_COST); b.invested += SIDE_COST;
    b.side = { good, stock: 0 };
    return { ok: true };
  }
  const sideRoom = (b) => (b.side ? Math.max(0, sideCap(b) - b.side.stock) : 0);
  // stock it: from your cargo or the warehouse here, or the fast supplier
  function stockSide(s, id, from) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || !b.side) return { ok: false, msg: 'No side counter.' };
    const g = b.side.good, room = sideRoom(b);
    if (!room) return { ok: false, msg: 'The side counter is full.' };
    let q = 0;
    if (from === 'cargo') { if (b.district !== s.district) return { ok: false, msg: 'You need to be there.' }; q = Math.min(room, s.cargo[g] || 0); s.cargo[g] -= q; if (!s.cargo[g]) delete s.cargo[g]; }
    else if (from === 'wh') { const w = s.warehouses && s.warehouses[b.district]; q = Math.min(room, (w && w.goods[g]) || 0); if (q) { w.goods[g] -= q; if (!w.goods[g]) delete w.goods[g]; } }
    else { const each = round2(price(s, b.district, g) * SUPPLIERS.express.cost); q = Math.min(room, Math.floor(s.cash / each)); s.cash = round2(s.cash - q * each); spend(s, 'stock', q * each); }
    if (q <= 0) return { ok: false, msg: `No ${G[g].name} to put out.` };
    b.side.stock += q;
    return { ok: true, q };
  }
  const sidePrice = (s, b) => round2(price(s, b.district, b.side.good) * RETAIL * 1.05);
  // a side sale at the till (the hands-on shop)
  function sideSale(s, id, q) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || !b.side || !b.last) return { ok: false };
    q = Math.min(q, b.side.stock);
    if (q <= 0) return { ok: false };
    const rev = round2(q * sidePrice(s, b));
    b.side.stock -= q; s.cash = round2(s.cash + rev);
    b.last.extra = round2((b.last.extra || 0) + rev); b.last.side = (b.last.side || 0) + q;
    return { ok: true, q, rev };
  }

  // ---------- warehouses: store goods in a district and keep your shops there stocked ----------
  const WAREHOUSES = [
    { name: 'Storage unit', cost: 2500, cap: 300, upkeep: 10 },
    { name: 'Warehouse', cost: 9000, cap: 1200, upkeep: 35 },
    { name: 'Distribution centre', cost: 32000, cap: 5000, upkeep: 110 },
  ];
  const whOf = (s, d = s.district) => (s.warehouses && s.warehouses[d]) || null;
  const whUsed = (w) => Object.values(w.goods).reduce((a, x) => a + x, 0);
  const whRoom = (w) => WAREHOUSES[w.tier].cap - whUsed(w);
  function buyWarehouse(s) {
    if (whOf(s)) return { ok: false, msg: 'You already have one here.' };
    const t = WAREHOUSES[0];
    if (s.cash < t.cost) return { ok: false, msg: `You need $${t.cost.toLocaleString()}.` };
    s.cash = round2(s.cash - t.cost);
    s.warehouses = Object.assign({}, s.warehouses, { [s.district]: { tier: 0, goods: {}, invested: t.cost, auto: true } });
    return { ok: true };
  }
  function upgradeWarehouse(s, d = s.district) {
    const w = whOf(s, d), next = w && WAREHOUSES[w.tier + 1];
    if (!w) return { ok: false, msg: 'No warehouse here.' };
    if (!next) return { ok: false, msg: 'Already the biggest.' };
    const cost = Math.round(next.cost - WAREHOUSES[w.tier].cost * 0.5);
    if (s.cash < cost) return { ok: false, msg: `You need $${cost.toLocaleString()}.` };
    s.cash = round2(s.cash - cost); spend(s, 'other', cost);
    w.tier++; w.invested += cost;
    return { ok: true, cost };
  }
  const whUpgradeCost = (w) => (WAREHOUSES[w.tier + 1] ? Math.round(WAREHOUSES[w.tier + 1].cost - WAREHOUSES[w.tier].cost * 0.5) : null);
  // cargo to warehouse (q > 0) or back (q < 0), here
  function whMove(s, g, q) {
    const w = whOf(s);
    if (!w) return { ok: false, msg: 'No warehouse here.' };
    q = Math.trunc(q);
    if (q > 0) { q = Math.min(q, s.cargo[g] || 0, whRoom(w)); if (q <= 0) return { ok: false, msg: whRoom(w) ? `No ${G[g].name} in your cargo.` : 'The warehouse is full.' }; s.cargo[g] -= q; if (!s.cargo[g]) delete s.cargo[g]; w.goods[g] = (w.goods[g] || 0) + q; }
    else { q = Math.min(-q, w.goods[g] || 0, cargoCap(s) - cargoUsed(s)); if (q <= 0) return { ok: false, msg: w.goods[g] ? 'Not enough cargo space.' : 'None stored.' }; w.goods[g] -= q; if (!w.goods[g]) delete w.goods[g]; s.cargo[g] = (s.cargo[g] || 0) + q; }
    return { ok: true, q: Math.abs(q) };
  }
  // buy at today's price straight into the warehouse (no cargo space needed)
  function buyToWarehouse(s, g, q) {
    const w = whOf(s);
    if (!w) return { ok: false, msg: 'No warehouse here.' };
    q = Math.min(Math.floor(q), whRoom(w));
    if (q <= 0) return { ok: false, msg: 'The warehouse is full.' };
    const cost = quote(s, g, q, 'buy');
    if (cost > s.cash) return { ok: false, msg: 'Not enough cash.' };
    s.cash = round2(s.cash - cost); spend(s, 'stock', cost);
    w.goods[g] = (w.goods[g] || 0) + q;
    s.impact[s.district][g] += (IMPACT * q) / G[g].depth;
    return { ok: true, cost, q };
  }
  function maxBuyToWarehouse(s, g) {
    const w = whOf(s); if (!w) return 0;
    let lo = 0, hi = whRoom(w);
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (quote(s, g, mid, 'buy') <= s.cash) lo = mid; else hi = mid - 1; }
    return lo;
  }
  // top up shops (and side counters) in a district from its warehouse
  function whFeed(s, d, onlyId) {
    const w = whOf(s, d);
    if (!w) return 0;
    let moved = 0;
    for (const b of s.businesses) {
      if (b.kind !== 'stall' || b.district !== d || (onlyId && b.id !== onlyId)) continue;
      const m = Math.min(w.goods[b.good] || 0, shelfRoom(b));
      if (m > 0) { w.goods[b.good] -= m; if (!w.goods[b.good]) delete w.goods[b.good]; addStock(s, b, m); moved += m; }
      if (b.side) { const m2 = Math.min(w.goods[b.side.good] || 0, sideRoom(b)); if (m2 > 0) { w.goods[b.side.good] -= m2; if (!w.goods[b.side.good]) delete w.goods[b.side.good]; b.side.stock += m2; moved += m2; } }
    }
    return moved;
  }
  function sellWarehouse(s, d = s.district) {
    const w = whOf(s, d);
    if (!w) return { ok: false, msg: 'No warehouse here.' };
    const got = Math.round(w.invested * RESALE + Object.entries(w.goods).reduce((a, [g, q]) => a + q * price(s, d, g) * 0.9, 0));
    s.cash = round2(s.cash + got); delete s.warehouses[d];
    return { ok: true, got };
  }

  // ---------- your own brand: own-label products, cheaper to buy in, and a name that grows ----------
  const BRAND_COST = 3000, LABEL_COST = 0.85;
  const labelCost = (b) => (b.ownLabel ? LABEL_COST : 1);
  function makeBrand(s, d) {
    if (s.brand) { Object.assign(s.brand, { name: String(d.name || s.brand.name).slice(0, 14), a: d.a || s.brand.a, b: d.b || s.brand.b, logo: d.logo || s.brand.logo }); return { ok: true, brand: s.brand }; }
    if (s.cash < BRAND_COST) return { ok: false, msg: `Launching a brand costs $${BRAND_COST.toLocaleString()}.` };
    s.cash = round2(s.cash - BRAND_COST); spend(s, 'other', BRAND_COST);
    s.brand = { name: String(d.name || 'NEON').slice(0, 14), a: d.a || '#ff2a6d', b: d.b || '#ffd23f', logo: d.logo || '⚡', rep: 35 };
    return { ok: true, brand: s.brand };
  }
  function setOwnLabel(s, id, on) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || b.kind !== 'stall') return { ok: false, msg: 'Not found.' };
    if (on && !s.brand) return { ok: false, msg: 'Launch your brand first.' };
    b.ownLabel = !!on;
    return { ok: true };
  }
  // shoppers trust a brand they know: a little less than the big names at first, more once it's loved
  const brandMod = (s, b) => (b.ownLabel && s.brand ? 0.92 + s.brand.rep / 400 : 1);

  // ---------- logistics: trucks that move goods on a schedule ----------
  const TRUCK = { cost: 6000, cap: 400, daily: 45 };
  // a stop is a district's warehouse ('wh:docks'), a workshop (its id: 'biz:7') or a shop ('biz:3')
  function stopOf(s, key) {
    const [t, v] = key.split(':');
    if (t === 'wh') { const w = whOf(s, v); return w ? { kind: 'wh', w, district: v } : null; }
    const b = s.businesses.find((x) => x.id === +v); return b ? { kind: b.kind, b, district: b.district } : null;
  }
  const stopName = (s, key) => { const st = stopOf(s, key); if (!st) return 'gone'; return st.kind === 'wh' ? `${WAREHOUSES[st.w.tier].name} · ${D[st.district].name}` : `${G[st.b.good].icon} ${(st.kind === 'stall' ? STALLS : FACTORIES)[st.b.tier].name} · ${D[st.district].name}`; };
  function buyTruck(s) {
    if (s.cash < TRUCK.cost) return { ok: false, msg: `A truck costs $${TRUCK.cost.toLocaleString()}.` };
    s.cash = round2(s.cash - TRUCK.cost); spend(s, 'other', TRUCK.cost);
    s.trucks = (s.trucks || 0) + 1;
    return { ok: true };
  }
  function addRoute(s, from, to, good, qty, every) {
    const routes = s.routes || [];
    if (routes.length >= (s.trucks || 0)) return { ok: false, msg: 'Each route needs its own truck: buy another.' };
    if (!stopOf(s, from) || !stopOf(s, to) || from === to || !G[good]) return { ok: false, msg: 'Pick where it goes from and to.' };
    s.routes = routes.concat([{ id: (s.routeId = (s.routeId || 0) + 1), from, to, good, qty: clamp(Math.floor(qty), 1, TRUCK.cap), every: clamp(Math.floor(every), 1, 7), from0: s.day }]);
    return { ok: true };
  }
  function dropRoute(s, id) { s.routes = (s.routes || []).filter((r) => r.id !== id); return { ok: true }; }
  function runRoutes(s, rep) {
    for (const r of s.routes || []) {
      s.cash = round2(s.cash - TRUCK.daily); rep.upkeep += TRUCK.daily; rep.trucks = (rep.trucks || 0) + TRUCK.daily;
      if ((s.day - r.from0) % r.every) continue;
      const a = stopOf(s, r.from), z = stopOf(s, r.to);
      if (!a || !z) { r.last = 'a stop has gone'; continue; }
      const have = a.kind === 'wh' ? a.w.goods[r.good] || 0 : a.b.good === r.good ? a.b.stock : 0;
      const room = z.kind === 'wh' ? whRoom(z.w) : z.kind === 'stall' && z.b.good === r.good ? shelfRoom(z.b) : z.kind === 'stall' && z.b.side && z.b.side.good === r.good ? sideRoom(z.b) : 0;
      const q = Math.min(r.qty, have, room);
      r.last = q > 0 ? `moved ${q}` : have ? 'nowhere to put it' : 'nothing to pick up';
      if (q <= 0) continue;
      if (a.kind === 'wh') { a.w.goods[r.good] -= q; if (!a.w.goods[r.good]) delete a.w.goods[r.good]; } else if (a.kind === 'stall') takeStock(s, a.b, q); else a.b.stock -= q;
      if (z.kind === 'wh') z.w.goods[r.good] = (z.w.goods[r.good] || 0) + q; else if (z.b.good === r.good) addStock(s, z.b, q); else z.b.side.stock += q;
      rep.lines.push({ icon: '🚚', text: `Truck route: ${q} ${G[r.good].name} from ${stopName(s, r.from)} to ${stopName(s, r.to)}.` });
    }
  }

  // ---------- opening hours: open late or all night for more trade (and more wages and risk) ----------
  const HOURS = {
    day: { name: '9:00–21:00', icon: '☀️', demand: 1, cost: 0, theft: 0 },
    late: { name: '9:00–midnight', icon: '🌆', demand: 1.12, cost: 40, theft: 0.004 },
    allday: { name: 'Open 24 hours', icon: '🌙', demand: 1.25, cost: 95, theft: 0.012 },
  };
  const hoursOf = (b) => HOURS[b.hours] || HOURS.day;
  function setHours(s, id, h) { const b = s.businesses.find((x) => x.id === id); if (!b || b.kind !== 'stall' || !HOURS[h]) return { ok: false, msg: 'Not found.' }; b.hours = h; return { ok: true }; }

  // ---------- staff careers: experience, levels, a personality, raises (and strikes) ----------
  const TRAITS = {
    cheerful: { icon: '😄', name: 'Cheerful', desc: 'Shoppers wait a bit longer.' },
    speedy: { icon: '💨', name: 'Speedy', desc: 'Serves and stocks faster.' },
    perfectionist: { icon: '🎯', name: 'Perfectionist', desc: 'Never fumbles, a little slower.' },
    lazy: { icon: '😴', name: 'Laid-back', desc: 'Tires quickly, but rarely complains.' },
    chatty: { icon: '💬', name: 'Chatty', desc: 'Regulars love a chat: better word of mouth.' },
  };
  const traitOf = (m) => m.trait || (m.trait = Object.keys(TRAITS)[Math.abs(Math.floor(Math.sin((m.look || m.name.length) * 9.17) * 1e4)) % 5]);
  const staffLevel = (m) => 1 + Math.min(4, Math.floor((m.xp || 0) / 40));
  // after a shop day: experience from the shoppers they served
  function staffXp(s, id, list) {
    const b = s.businesses.find((x) => x.id === id), up = [];
    if (!b) return up;
    for (const [i, xp] of list) { const m = staffOf(b)[i]; if (!m) continue; const was = staffLevel(m); m.xp = (m.xp || 0) + xp; if (staffLevel(m) > was) up.push(`${m.name} reached level ${staffLevel(m)}`); }
    return up;
  }
  function answerRaise(s, id, i, yes) {
    const b = s.businesses.find((x) => x.id === id), m = b && staffOf(b)[i];
    if (!m || !m.ask) return { ok: false, msg: 'Nothing to answer.' };
    if (yes) { m.wage += m.ask; m.morale = Math.min(100, m.morale + 25); } else { m.morale = Math.max(0, m.morale - (traitOf(m) === 'lazy' ? 8 : 22)); }
    m.ask = 0;
    return { ok: true };
  }
  function setSupervisor(s, id, i) {
    const b = s.businesses.find((x) => x.id === id), m = b && staffOf(b)[i];
    if (!m) return { ok: false, msg: 'Not found.' };
    if (staffLevel(m) < 2) return { ok: false, msg: 'Supervisors need some experience (level 2).' };
    for (const x of staffOf(b)) if (x.sup && x !== m) { x.sup = false; x.wage -= 15; }
    if (!m.sup) { m.sup = true; m.wage += 15; m.morale = Math.min(100, m.morale + 20); }
    return { ok: true };
  }
  // move your best worker up to run another shop as its manager
  function promoteToManager(s, id, i, toId) {
    const b = s.businesses.find((x) => x.id === id), to = s.businesses.find((x) => x.id === toId), m = b && staffOf(b)[i];
    if (!m || !to || to.kind !== 'stall') return { ok: false, msg: 'Not found.' };
    if (to.manager) return { ok: false, msg: 'That shop already has a manager.' };
    if (staffLevel(m) < 3) return { ok: false, msg: 'Managers need experience (level 3).' };
    b.staff.splice(i, 1);
    to.manager = { name: m.name, style: traitOf(m) === 'chatty' || traitOf(m) === 'cheerful' ? 'seller' : traitOf(m) === 'perfectionist' ? 'steady' : 'thrifty', level: Math.min(MANAGER_MAX, staffLevel(m) - 1), xp: 0, look: m.look, days: 0 };
    return { ok: true, m: to.manager };
  }

  // ---------- insurance, and things that go wrong ----------
  const POLICIES = {
    fire: { icon: '🔥', name: 'Fire', daily: 6, desc: 'Covers fire damage and lost stock.' },
    theft: { icon: '🦹', name: 'Break-ins', daily: 4, desc: 'Covers stock and cash taken in a break-in.' },
    flood: { icon: '🌊', name: 'Flood', daily: 3, desc: 'Covers flood damage (more likely on wet days).' },
    kit: { icon: '🔧', name: 'Equipment', daily: 3, desc: 'Covers repairs when a fridge, till or self-checkout breaks.' },
  };
  const EXCESS = 100; // you pay the first $100 of any claim
  const policyCost = (s) => Object.keys(s.insurance || {}).filter((k) => s.insurance[k]).reduce((a, k) => a + POLICIES[k].daily, 0) * Math.max(1, s.businesses.filter((b) => b.kind === 'stall').length);
  function setPolicy(s, k, on) { if (!POLICIES[k]) return { ok: false, msg: 'Not found.' }; s.insurance = Object.assign({}, s.insurance, { [k]: !!on }); return { ok: true }; }
  // each shop's dice for a bad night (its own stream, so it never changes the market)
  function disasters(s, b, rep, news) {
    const r = seeded(mixSeed(s.seed, s.day, 1100 + b.id)), roll = r(), wet = ['rain', 'snow'].includes(weather(s)), ins = s.insurance || {};
    const where = `your ${STALLS[b.tier].name.toLowerCase()} at ${D[b.district].name}`;
    const claim = (k, loss, what) => {
      loss = Math.round(loss);
      if (ins[k]) { const paid = Math.max(0, loss - EXCESS); s.cash = round2(s.cash - Math.min(loss, EXCESS)); news.push({ icon: POLICIES[k].icon, text: `${what} at ${where}. Insurance paid $${paid.toLocaleString()} (you paid the $${Math.min(loss, EXCESS)} excess).` }); }
      else { s.cash = round2(s.cash - loss); news.push({ icon: POLICIES[k].icon, text: `${what} at ${where}: it cost you $${loss.toLocaleString()}. Insurance (🏦 Bank) would have covered it.` }); }
      rep.disaster = (rep.disaster || 0) + loss;
    };
    const stockValue = (q) => q * price(s, b.district, b.good);
    if (roll < 0.003) { const q = Math.floor(b.stock * 0.5); if (q) takeStock(s, b, q); claim('fire', stockValue(q) + STALLS[b.tier].cost * 0.15, `🔥 A fire broke out overnight: ${q} items lost and repairs needed`); b.closedDay = s.day + 1; }
    else if (roll < 0.003 + 0.006 + hoursOf(b).theft) { const q = Math.floor(b.stock * 0.2); if (q) takeStock(s, b, q); claim('theft', stockValue(q) + 150, `🦹 A break-in: ${q} items and the float taken`); }
    else if (roll < 0.009 + hoursOf(b).theft + (wet ? 0.012 : 0.003)) { const q = Math.floor(b.stock * 0.3); if (q) takeStock(s, b, q); claim('flood', stockValue(q) + 200, `🌊 The stockroom flooded: ${q} items ruined`); }
    else if (roll < 0.03 + hoursOf(b).theft && b.upgrades && Object.keys(b.upgrades).length) { claim('kit', 180 + r() * 220, '🔧 Some equipment broke down and needed a repair'); }
  }

  // ---------- businesses ----------
  const tiers = (b) => (b.kind === 'stall' ? STALLS : FACTORIES);

  function openBusiness(s, kind, good) {
    const t = (kind === 'stall' ? STALLS : FACTORIES)[0];
    if (s.finished) return { ok: false, msg: 'The season is over.' };
    if (s.cash < t.cost) return { ok: false, msg: `You need $${t.cost.toLocaleString()}.` };
    s.cash = round2(s.cash - t.cost);
    const b = { id: s.nextId++, kind, tier: 0, district: s.district, good, stock: 0, invested: t.cost, last: null };
    if (kind === 'stall') newLease(s, b);
    s.businesses.push(b);
    return { ok: true, b };
  }

  function upgradeBusiness(s, id) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b) return { ok: false, msg: 'Not found.' };
    const next = tiers(b)[b.tier + 1];
    if (!next) return { ok: false, msg: 'Already the biggest.' };
    const cost = upgradeCost(b); // trade in the old one at half price (and an owned building: its bigger price)
    if (s.cash < cost) return { ok: false, msg: `You need $${Math.round(cost).toLocaleString()}.` };
    s.cash = round2(s.cash - cost); spend(s, 'other', cost);
    if (b.owned) { b.tier++; b.owned.price = buildingPrice(b); b.tier--; }
    b.tier++;
    b.invested += cost;
    if (b.kind === 'stall' && !b.owned) newLease(s, b); // a bigger shop, a new lease
    return { ok: true, cost };
  }
  const upgradeCost = (b) => {
    const next = tiers(b)[b.tier + 1];
    if (!next) return null;
    const bump = b.owned ? buildingPrice(Object.assign({}, b, { tier: b.tier + 1 })) - buildingPrice(b) : 0;
    return Math.round(next.cost - tiers(b)[b.tier].cost * 0.5 + bump);
  };

  function sellBusiness(s, id) {
    const i = s.businesses.findIndex((x) => x.id === id);
    if (i < 0) return { ok: false, msg: 'Not found.' };
    const b = s.businesses[i];
    const got = Math.round(b.invested * RESALE + b.stock * G[b.good].base * PRODUCE_COST + propertyValue(s, b) - mortgageLeft(b) + (b.side ? b.side.stock * G[b.side.good].base * PRODUCE_COST : 0));
    s.cash = round2(s.cash + got);
    s.businesses.splice(i, 1);
    return { ok: true, got };
  }

  function setProduct(s, id, good) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b) return { ok: false, msg: 'Not found.' };
    if (b.good === good) return { ok: true };
    if (b.kind === 'stall' && b.stock > 0) return { ok: false, msg: 'Sell out or take back the stock first.' };
    if (b.kind === 'factory') b.stock = 0; // old output is scrapped
    b.good = good;
    return { ok: true };
  }

  // Move stock between your cargo and a business in this district.
  function restock(s, id, q) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || b.kind !== 'stall' || b.district !== s.district) return { ok: false, msg: 'You need to be at the stall.' };
    q = Math.min(Math.floor(q), s.cargo[b.good] || 0);
    if (q <= 0) return { ok: false, msg: `No ${G[b.good].name} in your cargo.` };
    s.cargo[b.good] -= q; if (!s.cargo[b.good]) delete s.cargo[b.good];
    addStock(s, b, q);
    return { ok: true, q };
  }
  function collect(s, id, q) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || b.district !== s.district) return { ok: false, msg: 'You need to be there.' };
    q = Math.min(Math.floor(q), b.stock, cargoCap(s) - cargoUsed(s));
    if (q <= 0) return { ok: false, msg: b.stock ? 'Not enough cargo space.' : 'Nothing to collect.' };
    if (b.kind === 'stall') takeStock(s, b, q); else b.stock -= q;
    s.cargo[b.good] = (s.cargo[b.good] || 0) + q;
    return { ok: true, q };
  }
  const unitsPerDay = (value, g) => Math.max(1, Math.floor(value / G[g].base));
  const storageCap = (b) => unitsPerDay(FACTORIES[b.tier].out, b.good) * 10;

  function buyVehicle(s) {
    const next = VEHICLES[s.vehicle + 1];
    if (!next) return { ok: false, msg: 'You already have the biggest.' };
    const cost = next.cost - VEHICLES[s.vehicle].cost * 0.5;
    if (s.cash < cost) return { ok: false, msg: `You need $${cost.toLocaleString()}.` };
    s.cash = round2(s.cash - cost);
    s.vehicle++;
    return { ok: true, cost };
  }

  // ---------- money ----------
  function bankMove(s, kind, amount) {
    amount = Math.floor(amount);
    if (amount <= 0) return { ok: false, msg: 'Pick an amount.' };
    if (kind === 'deposit') { if (amount > s.cash) return { ok: false, msg: 'Not enough cash.' }; s.cash -= amount; s.bank += amount; }
    else if (kind === 'withdraw') { if (amount > s.bank) return { ok: false, msg: 'Not enough in the bank.' }; s.bank -= amount; s.cash += amount; }
    else if (kind === 'borrow') { if (s.debt + amount > maxDebt(s)) return { ok: false, msg: `The bank will lend up to $${Math.floor(maxDebt(s)).toLocaleString()} in total.` }; s.debt += amount; s.cash += amount; }
    else if (kind === 'repay') { amount = Math.min(amount, s.debt); if (amount > s.cash) return { ok: false, msg: 'Not enough cash.' }; s.debt -= amount; s.cash -= amount; }
    s.cash = round2(s.cash); s.bank = round2(s.bank); s.debt = round2(s.debt);
    return { ok: true };
  }
  // total you can owe: half of everything you own (before debts), at least $5,000
  const maxDebt = (s) => Math.max(5000, (netWorth(s) + s.debt) * 0.5);

  function trade(s, sym, q) { // q > 0 buys, q < 0 sells; 1% fee
    q = Math.trunc(q);
    const p = s.stocks[sym];
    if (q > 0) {
      const cost = round2(p * q * 1.01);
      if (cost > s.cash) return { ok: false, msg: 'Not enough cash.' };
      s.cash = round2(s.cash - cost); s.shares[sym] += q;
      return { ok: true, cost };
    }
    q = Math.min(-q, s.shares[sym]);
    if (q <= 0) return { ok: false, msg: 'No shares to sell.' };
    const got = round2(p * q * 0.99);
    s.cash = round2(s.cash + got); s.shares[sym] -= q;
    return { ok: true, got };
  }
  const maxShares = (s, sym) => Math.floor(s.cash / (s.stocks[sym] * 1.01));

  // ---------- valuation ----------
  const avgPrice = (s, g) => DISTRICTS.reduce((a, d) => a + price(s, d.id, g), 0) / DISTRICTS.length;
  function netWorth(s) {
    let nw = s.cash + s.bank - s.debt;
    for (const [g, q] of Object.entries(s.cargo)) nw += q * avgPrice(s, g) * 0.9;
    for (const b of s.businesses) nw += b.invested * RESALE + b.stock * G[b.good].base * (b.kind === 'stall' ? 0.9 : PRODUCE_COST) + propertyValue(s, b) - mortgageLeft(b) + (b.side ? b.side.stock * G[b.side.good].base * 0.9 : 0);
    for (const [, w] of Object.entries(s.warehouses || {})) nw += w.invested * RESALE + Object.entries(w.goods).reduce((a, [g, q]) => a + q * G[g].base * 0.9, 0);
    nw += VEHICLES[s.vehicle].cost * 0.5;
    for (const k of STOCKS) nw += s.shares[k.id] * s.stocks[k.id];
    return Math.round(nw);
  }
  const rankFor = (nw) => RANKS.reduce((r, [min, name]) => (nw >= min ? name : r), RANKS[0][1]);
  // arcade coins for a finished season
  const coinsFor = (nw) => Math.max(10, Math.min(1500, Math.round(Math.sqrt(Math.max(0, nw)) * 0.8)));

  // ---------- news events ----------
  // Each day rolls exactly two event slots with a fixed number of dice, so every player on
  // the same seed sees the same news whatever they did.
  const EVENTS = [
    { w: 3, roll: (s, r, a, b) => { const g = GOODS[a % GOODS.length]; s.global[g.id] *= 1.7; return { icon: '📈', text: `Shortage! ${g.name} prices jump across the city.` }; } },
    { w: 3, roll: (s, r, a, b) => { const g = GOODS[a % GOODS.length]; s.global[g.id] *= 0.55; return { icon: '📉', text: `A cargo ship full of ${g.name} docks. Prices crash.` }; } },
    { w: 2, roll: (s, r, a, b) => {
      const d = DISTRICTS[b % DISTRICTS.length];
      for (const g of ['drinks', 'noodles', 'coffee']) s.effects.push({ good: g, district: d.id, mult: 1.45, until: s.day + 3 });
      return { icon: '🎉', text: `Festival at ${d.name}! Food and drinks sell for more there for 3 days.` };
    } },
    { w: 1, roll: (s) => { s.effects.push({ good: 'drinks', mult: 1.5, until: s.day + 4 }); return { icon: '☀️', text: 'Heatwave! Energy drinks are in demand for 4 days.' }; } },
    { w: 1, roll: (s) => { s.global.chips *= 1.4; s.stocks.CHIP = round2(s.stocks.CHIP * 1.12); return { icon: '🚀', text: 'A new phone launches: chip prices and ChipWorks shares rise.' }; } },
    { w: 1, roll: (s) => { s.effects.push({ good: 'sneakers', mult: 1.6, until: s.day + 5 }); s.stocks.STEP = round2(s.stocks.STEP * 1.08); return { icon: '👟', text: 'Limited sneaker drop! Sneakers sell high for 5 days.' }; } },
    { w: 1, roll: (s) => { for (const k of STOCKS) s.stocks[k.id] = round2(s.stocks[k.id] * 0.86); return { icon: '💥', text: 'The Neon Exchange tumbles: all shares fall 14%.' }; } },
    { w: 1, roll: (s) => { for (const k of STOCKS) s.stocks[k.id] = round2(s.stocks[k.id] * 1.1); return { icon: '🎊', text: 'Bull run! All shares rise 10%.' }; } },
    { w: 1, roll: (s, r, a, b) => {
      const d = DISTRICTS[b % DISTRICTS.length];
      for (const g of ['vinyl', 'holo']) s.effects.push({ good: g, district: d.id, mult: 1.5, until: s.day + 3 });
      return { icon: '🎤', text: `Big concert at ${d.name}: records and holo toys sell high there for 3 days.` };
    } },
    { w: 1, roll: (s) => {
      if (s.cash < 3000) return { icon: '🕶️', text: 'Pickpockets are about, but you had nothing worth taking.' };
      const lost = Math.min(5000, Math.round(s.cash * 0.08));
      s.cash = round2(s.cash - lost);
      return { icon: '🦹', text: `A pickpocket got you for $${lost.toLocaleString()}. Keep big cash in the bank!` };
    } },
  ];
  const EVENT_WEIGHT = EVENTS.reduce((a, e) => a + e.w, 0);

  // ---------- the day ends ----------
  function endDay(s, travelTo = null) {
    if (s.finished) return null;
    const nw0 = netWorth(s);
    const r = dayRng(s, 1); // market dice: identical for every player on this seed
    const news = [];

    // prices drift and pull back toward normal; your trades' impact fades
    for (const g of GOODS) s.global[g.id] = Math.exp(0.93 * Math.log(s.global[g.id]) + g.vol * gauss(r));
    for (const d of DISTRICTS) for (const g of GOODS) {
      s.noise[d.id][g.id] = 0.5 * s.noise[d.id][g.id] + 0.07 * gauss(r);
      s.impact[d.id][g.id] *= 0.7;
    }
    // shares follow their goods plus their own luck
    for (const k of STOCKS) {
      const link = k.links.length ? k.links.reduce((a, g) => a + Math.log(s.global[g]), 0) / k.links.length : 0;
      s.stocks[k.id] = round2(Math.max(1, s.stocks[k.id] * Math.exp(0.0006 + k.vol * gauss(r) + 0.04 * link)));
    }
    // two news slots
    for (let slot = 0; slot < 2; slot++) {
      const happen = r(), which = r() * EVENT_WEIGHT, a = Math.floor(r() * 1000), b = Math.floor(r() * 1000);
      if (happen > 0.32) continue;
      let acc = 0;
      for (const e of EVENTS) { acc += e.w; if (which < acc) { news.push(e.roll(s, r, a, b)); break; } }
    }
    s.effects = s.effects.filter((e) => e.until > s.day + 1);

    // businesses (their own dice, so they can't change the market for anyone)
    const rb = dayRng(s, 2);
    const rep = { sales: 0, production: 0, upkeep: 0, rent: 0, wages: 0, lines: [] };
    for (const b of s.businesses.filter((x) => x.kind === 'factory')) {
      const t = FACTORIES[b.tier];
      const want = Math.min(unitsPerDay(t.out, b.good), storageCap(b) - b.stock);
      const unitCost = G[b.good].base * PRODUCE_COST;
      const made = Math.max(0, Math.min(want, Math.floor((s.cash - t.upkeep) / unitCost)));
      s.cash = round2(s.cash - made * unitCost - t.upkeep);
      b.stock += made;
      rep.production += made * unitCost; rep.upkeep += t.upkeep;
      // feed your stalls in the same district that sell this good
      for (const st of s.businesses) {
        if (st.kind !== 'stall' || st.district !== b.district || st.good !== b.good) continue;
        const room = shelfRoom(st);
        const move = Math.min(room, b.stock);
        b.stock -= move; addStock(s, st, move);
      }
      b.last = { made, cost: Math.round(made * unitCost + t.upkeep) };
      rep.lines.push({ icon: G[b.good].icon, text: `${t.name} at ${D[b.district].name} made ${made} ${G[b.good].name}${made < want ? ' (short of cash)' : ''}.` });
    }
    // trucks on their routes, then insurance premiums
    runRoutes(s, rep);
    const prem = policyCost(s); if (prem) { s.cash = round2(s.cash - prem); rep.upkeep += prem; rep.insurance = prem; }
    // warehouses: their upkeep, and they top up your shops in their district before opening
    for (const [d, w] of Object.entries(s.warehouses || {})) {
      const up = WAREHOUSES[w.tier].upkeep;
      s.cash = round2(s.cash - up); rep.upkeep += up; rep.whUpkeep = (rep.whUpkeep || 0) + up;
      if (w.auto) { const m = whFeed(s, d); if (m) rep.lines.push({ icon: '🏬', text: `Your ${WAREHOUSES[w.tier].name.toLowerCase()} at ${D[d].name} sent ${m} items to your shops.` }); }
    }
    for (const b of s.businesses.filter((x) => x.kind === 'stall')) {
      const t = STALLS[b.tier];
      const luck = rb(); // always drawn, so the business dice stay in step
      if (b.servedDay === s.day) {
        // you ran it yourself today: sales already happened at the counter
        s.cash = round2(s.cash - rentOf(b));
        rep.sales += b.last.revenue + (b.last.extra || 0); rep.upkeep += rentOf(b); rep.rent += rentOf(b);
        rep.lines.push({ icon: G[b.good].icon, text: `You ran the ${t.name.toLowerCase()} at ${D[b.district].name} yourself: ${b.last.sold} sold for $${Math.round(b.last.revenue).toLocaleString()}${b.last.extra ? ` (${b.last.extra >= 0 ? '+' : '−'}$${Math.abs(Math.round(b.last.extra)).toLocaleString()} ${b.last.extra >= 0 ? 'extras' : 'in refunds and rewards'})` : ''}.` });
        continue;
      }
      const mult = b.mult || RETAIL;
      if (b.manager) managerOrder(s, b, rep);
      const demand = Math.floor(unitsPerDay(t.cap, b.good) * (0.55 + 0.6 * luck) * effectMod(s, b.district, b.good) * priceDemand(mult)
        * WEATHER[weather(s)].crowd * weatherDemand(s, b.good) * ratingMod(b) * repMod(b) * (b.upgrades && b.upgrades.coffee ? 1.12 : 1)
        * rivalMod(s, b, mult) * buzzMod(s, b) * managerMod(b) * (1 + 0.03 * staffOf(b).filter((m) => m.skill === 'friendly').length)
        * adMod(s, b) * followerMod(s) * (1 + 0.12 * expOf(b).floor) * (b.upgrades && b.upgrades.online ? 1.08 : 1) * hoursOf(b).demand * brandMod(s, b) * (b.closedDay === s.day ? 0 : 1));
      const sold = Math.min(b.stock, demand);
      for (const a of adsOf(s, b)) a.extra = (a.extra || 0) + Math.round(Math.min(sold, demand) * (1 - 1 / adMod(s, b)) * (CAMPAIGNS[a.id].boost / Math.max(0.01, adMod(s, b) - 1)));
      if (b.side && b.side.stock > 0) { // the side counter sells on its own too
        const q = Math.min(b.side.stock, Math.floor(unitsPerDay(t.cap * 0.25, b.side.good) * (0.5 + luck * 0.6)));
        const rv = round2(q * sidePrice(s, b)); b.side.stock -= q; s.cash = round2(s.cash + rv); rep.sales += rv;
        if (q) rep.lines.push({ icon: G[b.side.good].icon, text: `Side counter at ${D[b.district].name} sold ${q} ${G[b.side.good].name} for $${Math.round(rv).toLocaleString()}.` });
      }
      const red = takeStock(s, b, sold);
      const revenue = round2((sold - red * 0.5) * price(s, b.district, b.good) * matchedMult(s, b, mult));
      s.cash = round2(s.cash + revenue - rentOf(b));
      rep.sales += revenue; rep.upkeep += rentOf(b); rep.rent += rentOf(b);
      b.last = { sold, revenue: Math.round(revenue), demand };
      rep.lines.push({ icon: G[b.good].icon, text: `${t.name} at ${D[b.district].name} sold ${sold} ${G[b.good].name} for $${Math.round(revenue).toLocaleString()}${b.stock === 0 && demand > sold ? ' (sold out!)' : ''}.` });
    }

    // staff wages and morale; perishables past their date are thrown out
    for (const b of s.businesses.filter((x) => x.kind === 'stall')) {
      const staff = staffOf(b), mg = b.manager;
      const hc = hoursOf(b).cost; if (hc) { s.cash = round2(s.cash - hc); rep.upkeep += hc; rep.wages += hc; } // the night crew
      if (b.ownLabel && s.brand) s.brand.rep = clamp(s.brand.rep + ((b.rating || 3) - 3) * 0.5 + (b.last && b.last.sold ? 0.15 : -0.1), 0, 100); // your brand's name
      disasters(s, b, rep, news);
      if (mg) {
        const w = managerWage(mg);
        s.cash = round2(s.cash - w); rep.upkeep += w; rep.wages += w;
        mg.days = (mg.days || 0) + 1;
        if (b.servedDay !== s.day && mg.level < MANAGER_MAX && ++mg.xp >= mg.level * 8) { mg.level++; mg.xp = 0; news.push({ icon: '🎓', text: `${mg.name} is now a level ${mg.level} manager at ${D[b.district].name}.` }); }
      }
      if (staff.length) {
        const wages = staff.reduce((a, m) => a + m.wage, 0);
        s.cash = round2(s.cash - wages); rep.upkeep += wages; rep.wages += wages;
        const rq = seeded(mixSeed(s.seed, s.day, 400 + b.id));
        for (let i = staff.length - 1; i >= 0; i--) {
          const m = staff[i];
          if (b.servedDay !== s.day) m.morale = Math.min(100, m.morale + 4); // a quieter day
          // experienced staff ask for a raise now and then; turn them down too often and they may strike
          if (!m.ask && staffLevel(m) >= 2 && rq() < 0.04 + 0.02 * staffLevel(m)) { m.ask = 5 * staffLevel(m); news.push({ icon: '💬', text: `${m.name} at ${D[b.district].name} asks for a $${m.ask}/day raise (👥 Staff).` }); }
          m.strike = m.morale < 15 && traitOf(m) !== 'lazy' && rq() < 0.5 ? s.day + 1 : 0;
          if (m.strike) news.push({ icon: '🪧', text: `${m.name} at ${D[b.district].name} is on strike tomorrow: morale is too low.` });
          if (m.morale < 20 && rq() < 0.4) { staff.splice(i, 1); news.push({ icon: '😤', text: `${m.name} quit your ${STALLS[b.tier].name.toLowerCase()} at ${D[b.district].name}: overworked and fed up.` }); }
        }
      }
      const bt = syncBatches(s, b);
      if (bt) {
        let gone = 0;
        while (bt.length && daysLeft(s, b, bt[0]) <= 1) { gone += bt[0].q; bt.shift(); }
        if (gone) {
          b.stock -= gone;
          rep.lines.push({ icon: '🗑️', text: `${gone} ${G[b.good].name} at ${D[b.district].name} went past their sell-by date and were thrown out.` });
        }
      }
    }

    // supplier contracts deliver every other day at their locked price; leases come up for review
    for (const b of s.businesses.filter((x) => x.kind === 'stall')) {
      for (const a of b.ads || []) if (a.until === s.day) news.push({ icon: CAMPAIGNS[a.id].icon, text: `Your ${CAMPAIGNS[a.id].name.toLowerCase()} at ${D[b.district].name} has finished: about ${a.extra || 0} extra sales${a.shop ? ` and ${a.shop} extra shoppers on days you ran it` : ''} for $${a.cost.toLocaleString()}.` });
      if (b.ads) b.ads = b.ads.filter((a) => a.until > s.day);
      const c = b.contract;
      if (c && s.day >= c.until) { b.contract = null; news.push({ icon: '📜', text: `Your supplier contract at ${D[b.district].name} has ended. Sign a new one in 📦 Order stock.` }); }
      else if (c && (s.day - c.from) % CONTRACT.every === 0) {
        const q = Math.min(c.qty, orderRoom(b)), cost = round2(q * c.each);
        if (q > 0 && s.cash >= cost) { s.cash = round2(s.cash - cost); spend(s, 'stock', cost); addStock(s, b, q); rep.lines.push({ icon: '📜', text: `Contract delivery at ${D[b.district].name}: ${q} ${G[b.good].name} at $${c.each.toFixed(2)} each.` }); }
        else if (q > 0) news.push({ icon: '📜', text: `You couldn't pay for the contract delivery at ${D[b.district].name}.` });
      }
      rivalNight(s, b, news);
      if (b.owned) { // your own building: mortgage payments, and rent from the flat upstairs
        const m = b.owned.mortgage;
        if (m && m.left > 0) { s.cash = round2(s.cash - m.daily); rep.upkeep += m.daily; rep.mortgage = round2((rep.mortgage || 0) + m.daily); if (--m.left === 0) { b.owned.mortgage = null; news.push({ icon: '🏠', text: `You've paid off the mortgage on your ${STALLS[b.tier].name.toLowerCase()} at ${D[b.district].name}. It's all yours!` }); } }
        const si = subletIncome(b); if (si) { s.cash = round2(s.cash + si); rep.sales += si; rep.lines.push({ icon: '🏠', text: `Rent from the flat above your ${STALLS[b.tier].name.toLowerCase()} at ${D[b.district].name}: $${si}.` }); }
        continue;
      }
      if (!b.leaseUntil) newLease(s, b); // (shops from before leases)
      else if (s.day >= b.leaseUntil) {
        const rr = seeded(mixSeed(s.seed, s.day, 700 + b.id))(), was = rentOf(b);
        const f = clamp(1 + (repMod(b) - 1) * 0.8 + ((b.rating || 3.5) - 3.5) * 0.03 + (rr - 0.5) * 0.12, 0.85, 1.3);
        b.rent = Math.round(STALLS[b.tier].rent * f); b.leaseUntil = s.day + LEASE_DAYS;
        const pct = Math.round(((b.rent - was) / was) * 100);
        news.push({ icon: '📜', text: `Lease review at your ${STALLS[b.tier].name.toLowerCase()} in ${D[b.district].name}: rent is now $${b.rent}/day (${pct >= 0 ? '+' : ''}${pct}%).` });
      }
    }
    // living costs and interest
    s.cash = round2(s.cash - LIVING_COST);
    const interest = round2(s.debt * LOAN_RATE), earned = round2(s.bank * DEPOSIT_RATE);
    s.debt = round2(s.debt + interest); s.bank = round2(s.bank + earned);
    // the cash flow for the day, and the tax on the week's profit (10%, every seventh day)
    const sp = s.spent || {};
    const flow = { day: s.day, sales: round2(rep.sales), rent: round2(rep.rent), wages: round2(rep.wages), production: round2(rep.production + rep.upkeep - rep.rent - rep.wages),
      stock: round2(sp.stock || 0), other: round2(sp.other || 0), living: LIVING_COST, interest, tax: 0 };
    s.spent = {};
    s.week = (s.week || 0) + flow.sales - flow.rent - flow.wages - flow.production - flow.stock - flow.living - flow.interest;
    if (s.day % 7 === 0) {
      const tax = round2(Math.max(0, s.week) * TAX_RATE);
      if (tax > 0) { s.cash = round2(s.cash - tax); flow.tax = tax; news.push({ icon: '🧾', text: `Weekly business tax: $${Math.round(tax).toLocaleString()} (10% of this week's $${Math.round(s.week).toLocaleString()} profit).` }); }
      s.week = 0;
    }
    s.flow = (s.flow || []).concat([flow]).slice(-14);
    if (s.cash < 0) { s.debt = round2(s.debt - s.cash); s.cash = 0; news.push({ icon: '🏦', text: 'You ran out of cash, so the bank covered your bills and added it to your loan.' }); }

    s.day++;
    if (travelTo && D[travelTo]) s.district = travelTo;
    const hol = holiday(s.day);
    if (hol && hol.from === s.day) news.push({ icon: hol.icon, text: `${hol.name} starts! ${Object.keys(hol.goods).map((g) => G[g].name).join(', ')} sell for more for a few days.` });
    const sea = season(s.day);
    if (sea.from === s.day && s.day > 1) news.push({ icon: sea.icon, text: `${sea.name} has arrived in Neon City.` });
    for (const d of DISTRICTS) for (const g of GOODS) {
      const h = s.hist.prices[d.id][g.id];
      h.push(price(s, d.id, g.id));
      if (h.length > 30) h.shift();
    }
    for (const k of STOCKS) { const h = s.hist.stocks[k.id]; h.push(s.stocks[k.id]); if (h.length > 60) h.shift(); }
    const nw = netWorth(s);
    s.hist.nw.push(nw);
    s.news = news;
    s.report = { day: s.day, nw0, nw, interest, earned, living: LIVING_COST, ...rep };
    if (s.day > SEASON_DAYS) s.finished = true;
    return s.report;
  }

  const api = {
    SEASON_DAYS, GOODS, DISTRICTS, STOCKS, STALLS, FACTORIES, VEHICLES, RANKS, PRODUCE_COST, RETAIL, RESALE, PRICE_MIN, PRICE_MAX,
    willingShare, priceDemand, shopperLimit, WEATHER, weather, ratingMod, REP_KEYS, repOf, repMod, season, holiday, HOLIDAYS, LIFE, freshness, SKILLS, STAFF_SLOTS, NAMES, staffOf, candidates, hire, fireStaff, giveBonus,
    rival, rivalMod, matchedMult, MATCH_SHARE, setPriceMatch, WEATHER_GOODS, weatherDemand, forecast,
    BRAND_COST, LABEL_COST, makeBrand, setOwnLabel, brandMod, TRUCK, buyTruck, addRoute, dropRoute, stopName, stopOf, HOURS, hoursOf, setHours,
    TRAITS, traitOf, staffLevel, staffXp, answerRaise, setSupervisor, promoteToManager, POLICIES, EXCESS, policyCost, setPolicy,
    EXPANSIONS, expOf, holdOf, staffSlots, expandCost, expandShop, buildingPrice, MORTGAGE, buyBuilding, propertyValue, mortgageLeft, subletIncome, setSublet,
    CAMPAIGNS, campaignCost, adsOf, adMod, runCampaign, followerMod, postPhoto, SIDE_COST, sideCap, openSide, sideRoom, stockSide, sidePrice, sideSale,
    WAREHOUSES, whOf, whUsed, whRoom, buyWarehouse, upgradeWarehouse, whUpgradeCost, whMove, buyToWarehouse, maxBuyToWarehouse, whFeed, sellWarehouse,
    MANAGER_STYLES, MANAGER_MAX, managerWage, trainCost, managerCandidates, hireManager, fireManager, trainManager, managerMod, SUPPLIERS, orderStock, CONTRACT, signContract, cancelContract, rentOf, LEASE_DAYS, TAX_RATE, orderRoom, SHOP_UPGRADES, buyShopUpgrade, shopExtra, shopLoss, shelfPrice, setShelfPrice, shopDayAvailable, startShopDay, shopSale, shelfRoom, refillShelves, effectMod, LOAN_RATE, DEPOSIT_RATE,
    G, D, seeded, newSeed, newGame, price, buyPrice, sellPrice, quote, maxBuy, buy, sell, cargoUsed, cargoCap,
    openBusiness, upgradeBusiness, upgradeCost, sellBusiness, setProduct, restock, collect, unitsPerDay, storageCap,
    buyVehicle, bankMove, maxDebt, trade, maxShares, netWorth, rankFor, coinsFor, endDay,
  };
  root.NeonTycoon = api;
})(typeof window !== 'undefined' ? window : globalThis);
