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
  function effectMod(s, d, g) {
    let m = 1;
    for (const e of s.effects) if (e.good === g && (!e.district || e.district === d)) m *= e.mult;
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
  function shopDayAvailable(s, b) { return b && b.kind === 'stall' && b.district === s.district && b.servedDay !== s.day && !s.finished; }
  function startShopDay(s, id) {
    const b = s.businesses.find((x) => x.id === id);
    if (!shopDayAvailable(s, b)) return { ok: false, msg: b && b.servedDay === s.day ? 'You already ran this shop today.' : 'You need to be at this shop.' };
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
    const revenue = round2(qty * shelfPrice(s, b));
    b.stock -= qty;
    s.cash = round2(s.cash + revenue);
    b.last.sold += qty; b.last.revenue = round2(b.last.revenue + revenue);
    return { ok: true, qty, revenue };
  }
  // top up the shelves from your cargo and any workshop in this district making the same good
  function shelfRoom(b) { return Math.max(0, unitsPerDay(STALLS[b.tier].cap, b.good) * 3 - b.stock); }
  function refillShelves(s, id) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b) return { ok: false, msg: 'Not found.' };
    let moved = 0;
    for (const f of s.businesses) {
      if (f.kind !== 'factory' || f.district !== b.district || f.good !== b.good) continue;
      const m = Math.min(f.stock, shelfRoom(b)); f.stock -= m; b.stock += m; moved += m;
    }
    const fromCargo = Math.min(s.cargo[b.good] || 0, shelfRoom(b));
    if (fromCargo) { s.cargo[b.good] -= fromCargo; if (!s.cargo[b.good]) delete s.cargo[b.good]; b.stock += fromCargo; moved += fromCargo; }
    return moved ? { ok: true, moved } : { ok: false, msg: `No ${G[b.good].name} in your cargo or workshop.` };
  }

  // ---------- businesses ----------
  const tiers = (b) => (b.kind === 'stall' ? STALLS : FACTORIES);

  function openBusiness(s, kind, good) {
    const t = (kind === 'stall' ? STALLS : FACTORIES)[0];
    if (s.finished) return { ok: false, msg: 'The season is over.' };
    if (s.cash < t.cost) return { ok: false, msg: `You need $${t.cost.toLocaleString()}.` };
    s.cash = round2(s.cash - t.cost);
    const b = { id: s.nextId++, kind, tier: 0, district: s.district, good, stock: 0, invested: t.cost, last: null };
    s.businesses.push(b);
    return { ok: true, b };
  }

  function upgradeBusiness(s, id) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b) return { ok: false, msg: 'Not found.' };
    const next = tiers(b)[b.tier + 1];
    if (!next) return { ok: false, msg: 'Already the biggest.' };
    const cost = next.cost - tiers(b)[b.tier].cost * 0.5; // trade in the old one at half price
    if (s.cash < cost) return { ok: false, msg: `You need $${Math.round(cost).toLocaleString()}.` };
    s.cash = round2(s.cash - cost);
    b.tier++;
    b.invested += cost;
    return { ok: true, cost };
  }
  const upgradeCost = (b) => { const next = tiers(b)[b.tier + 1]; return next ? Math.round(next.cost - tiers(b)[b.tier].cost * 0.5) : null; };

  function sellBusiness(s, id) {
    const i = s.businesses.findIndex((x) => x.id === id);
    if (i < 0) return { ok: false, msg: 'Not found.' };
    const b = s.businesses[i];
    const got = Math.round(b.invested * RESALE + b.stock * G[b.good].base * PRODUCE_COST);
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
    b.stock += q;
    return { ok: true, q };
  }
  function collect(s, id, q) {
    const b = s.businesses.find((x) => x.id === id);
    if (!b || b.district !== s.district) return { ok: false, msg: 'You need to be there.' };
    q = Math.min(Math.floor(q), b.stock, cargoCap(s) - cargoUsed(s));
    if (q <= 0) return { ok: false, msg: b.stock ? 'Not enough cargo space.' : 'Nothing to collect.' };
    b.stock -= q;
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
    for (const b of s.businesses) nw += b.invested * RESALE + b.stock * G[b.good].base * (b.kind === 'stall' ? 0.9 : PRODUCE_COST);
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
    const rep = { sales: 0, production: 0, upkeep: 0, lines: [] };
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
        const room = Math.max(0, unitsPerDay(STALLS[st.tier].cap, st.good) * 3 - st.stock);
        const move = Math.min(room, b.stock);
        b.stock -= move; st.stock += move;
      }
      b.last = { made, cost: Math.round(made * unitCost + t.upkeep) };
      rep.lines.push({ icon: G[b.good].icon, text: `${t.name} at ${D[b.district].name} made ${made} ${G[b.good].name}${made < want ? ' (short of cash)' : ''}.` });
    }
    for (const b of s.businesses.filter((x) => x.kind === 'stall')) {
      const t = STALLS[b.tier];
      const luck = rb(); // always drawn, so the business dice stay in step
      if (b.servedDay === s.day) {
        // you ran it yourself today: sales already happened at the counter
        s.cash = round2(s.cash - t.rent);
        rep.sales += b.last.revenue; rep.upkeep += t.rent;
        rep.lines.push({ icon: G[b.good].icon, text: `You ran the ${t.name.toLowerCase()} at ${D[b.district].name} yourself: ${b.last.sold} sold for $${Math.round(b.last.revenue).toLocaleString()}.` });
        continue;
      }
      const mult = b.mult || RETAIL;
      const demand = Math.floor(unitsPerDay(t.cap, b.good) * (0.55 + 0.6 * luck) * effectMod(s, b.district, b.good) * priceDemand(mult));
      const sold = Math.min(b.stock, demand);
      const revenue = round2(sold * price(s, b.district, b.good) * mult);
      b.stock -= sold;
      s.cash = round2(s.cash + revenue - t.rent);
      rep.sales += revenue; rep.upkeep += t.rent;
      b.last = { sold, revenue: Math.round(revenue), demand };
      rep.lines.push({ icon: G[b.good].icon, text: `${t.name} at ${D[b.district].name} sold ${sold} ${G[b.good].name} for $${Math.round(revenue).toLocaleString()}${b.stock === 0 && demand > sold ? ' (sold out!)' : ''}.` });
    }

    // living costs and interest
    s.cash = round2(s.cash - LIVING_COST);
    const interest = round2(s.debt * LOAN_RATE), earned = round2(s.bank * DEPOSIT_RATE);
    s.debt = round2(s.debt + interest); s.bank = round2(s.bank + earned);
    if (s.cash < 0) { s.debt = round2(s.debt - s.cash); s.cash = 0; news.push({ icon: '🏦', text: 'You ran out of cash, so the bank covered your bills and added it to your loan.' }); }

    s.day++;
    if (travelTo && D[travelTo]) s.district = travelTo;
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
    willingShare, priceDemand, shopperLimit, shelfPrice, setShelfPrice, shopDayAvailable, startShopDay, shopSale, shelfRoom, refillShelves, effectMod, LOAN_RATE, DEPOSIT_RATE,
    G, D, seeded, newSeed, newGame, price, buyPrice, sellPrice, quote, maxBuy, buy, sell, cargoUsed, cargoCap,
    openBusiness, upgradeBusiness, upgradeCost, sellBusiness, setProduct, restock, collect, unitsPerDay, storageCap,
    buyVehicle, bankMove, maxDebt, trade, maxShares, netWorth, rankFor, coinsFor, endDay,
  };
  root.NeonTycoon = api;
})(typeof window !== 'undefined' ? window : globalThis);
