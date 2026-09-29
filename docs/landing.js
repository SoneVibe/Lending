/**
 * landing.js — SoneVibe landing (propuesta)
 * Archivo NUEVO. Lee datos reales on-chain para la portada (sin placeholders):
 * TVL del DEX, volumen 24h, swaps de 7 días, pares, top pools con APR, lending y contratos.
 * Reutiliza config.js (loadNetworks), networks.json y token-list.json.
 */
(() => {
  'use strict';

  const CFG = {
    CHAIN_ID: '1868',
    SWAP_FEE: 0.0025,
    LP_FEE_SHARE: 5 / 6,
    LOG_CHUNK: 10000,
    CONCURRENCY: 4,
    STABLES: ['usdc', 'usdt', 'usdsc', 'svusd', 'dai', 'usds'],
  };
  const ZERO = '0x0000000000000000000000000000000000000000';
  const SWAP_TOPIC = ethers.id('Swap(address,uint256,uint256,uint256,uint256,address)');
  const ABI = {
    factory: ['function allPairsLength() view returns (uint)', 'function allPairs(uint) view returns (address)'],
    pair: ['function token0() view returns (address)', 'function token1() view returns (address)', 'function getReserves() view returns (uint112, uint112, uint32)'],
    erc20: ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'],
    oracle: ['function getUnderlyingPrice(address) view returns (uint)'],
    master: ['function oracle() view returns (address)'],
    cToken: ['function totalSupply() view returns (uint256)', 'function totalBorrows() view returns (uint256)', 'function exchangeRateStored() view returns (uint256)'],
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const isStable = (s) => CFG.STABLES.some((x) => (s || '').toLowerCase().startsWith(x));

  function fmtUsd(n) {
    if (!isFinite(n)) return '—';
    if (n === 0) return '$0';
    if (n < 0.01) return '<$0.01';
    if (n >= 1e4) return '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const fmtInt = (n) => (isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
  const fmtPct = (n) => (!isFinite(n) ? '—' : n * 100 >= 10000 ? '>10,000%' : (n * 100).toFixed(2) + '%');

  async function pool(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
    }));
    return out;
  }

  function setStat(id, value, sub) {
    const el = $(id);
    if (!el) return;
    el.querySelector('.v').textContent = value;
    if (sub !== undefined) el.querySelector('.s').textContent = sub;
    el.classList.remove('loading');
  }

  // Muestra al instante lo que la página Analytics dejó en caché, si existe.
  function paintFromAnalyticsCache() {
    try {
      const c = JSON.parse(localStorage.getItem(`SV_ANALYTICS_PRO_${CFG.CHAIN_ID}`) || 'null');
      if (!c || !c.totals) return;
      setStat('stTvl', fmtUsd(c.totals.tvl));
      setStat('stVol', fmtUsd(c.totals.vol24h));
      setStat('stSwaps', fmtInt((c.pools || []).reduce((a, p) => a + (p.tx7d || 0), 0)));
      setStat('stPairs', fmtInt((c.pools || []).length));
    } catch (e) { /* sin caché */ }
  }

  async function load(net) {
    const rpc = new ethers.JsonRpcProvider(net.rpcUrls[0], undefined, { staticNetwork: true, batchMaxCount: 20 });
    const tokenList = {};
    try {
      const tl = await (await fetch('./token-list.json')).json();
      (tl.tokens || []).forEach((t) => { if (String(t.chainId) === net.chainId) tokenList[t.address.toLowerCase()] = t; });
    } catch (e) { /* opcional */ }

    const metaCache = {};
    const meta = async (addr) => {
      const k = addr.toLowerCase();
      if (metaCache[k]) return metaCache[k];
      const listed = tokenList[k];
      const c = new ethers.Contract(addr, ABI.erc20, rpc);
      const [sym, dec] = listed ? [listed.symbol, listed.decimals] : await Promise.all([c.symbol().catch(() => 'UNK'), c.decimals().catch(() => 18)]);
      return (metaCache[k] = { address: addr, symbol: String(sym).slice(0, 12), decimals: Number(dec), logo: listed?.logoURI || `icons/${String(sym).toLowerCase()}.svg` });
    };

    let oracle = null;
    if (net.master) {
      const oa = await new ethers.Contract(net.master, ABI.master, rpc).oracle().catch(() => null);
      if (oa && oa !== ZERO) oracle = new ethers.Contract(oa, ABI.oracle, rpc);
    }
    const oraclePrice = async (a) => {
      if (!oracle) return 0;
      try { const p = await oracle.getUnderlyingPrice(a); return p > 0n ? parseFloat(ethers.formatUnits(p, 18)) : 0; } catch (e) { return 0; }
    };

    const factory = new ethers.Contract(net.factory, ABI.factory, rpc);
    const [len, latest] = await Promise.all([factory.allPairsLength().then(Number), rpc.getBlockNumber()]);
    $('liveBlock').textContent = `#${latest.toLocaleString('en-US')}`;
    const addrs = (await pool([...Array(len).keys()], 8, (i) => factory.allPairs(i).catch(() => null))).filter(Boolean);

    const pairs = (await pool(addrs, 6, async (address) => {
      try {
        const c = new ethers.Contract(address, ABI.pair, rpc);
        const [a0, a1, r] = await Promise.all([c.token0(), c.token1(), c.getReserves()]);
        const [t0, t1] = await Promise.all([meta(a0), meta(a1)]);
        return { address, t0, t1, r0: parseFloat(ethers.formatUnits(r[0], t0.decimals)), r1: parseFloat(ethers.formatUnits(r[1], t1.decimals)) };
      } catch (e) { return null; }
    })).filter(Boolean);

    const prices = {};
    const tokens = {};
    pairs.forEach((p) => { tokens[p.t0.address.toLowerCase()] = p.t0; tokens[p.t1.address.toLowerCase()] = p.t1; });
    await pool(Object.keys(tokens), 6, async (a) => {
      const px = await oraclePrice(a);
      if (px > 0) prices[a] = px; else if (isStable(tokens[a].symbol)) prices[a] = 1;
    });
    for (let pass = 0; pass < 4; pass++) {
      let found = false;
      pairs.forEach((p) => {
        const a0 = p.t0.address.toLowerCase(), a1 = p.t1.address.toLowerCase();
        if (prices[a0] && !prices[a1] && p.r1 > 0 && p.r0 * prices[a0] > 1) { prices[a1] = (p.r0 * prices[a0]) / p.r1; found = true; }
        else if (prices[a1] && !prices[a0] && p.r0 > 0 && p.r1 * prices[a1] > 1) { prices[a0] = (p.r1 * prices[a1]) / p.r0; found = true; }
      });
      if (!found) break;
    }
    pairs.forEach((p) => {
      const p0 = prices[p.t0.address.toLowerCase()] || 0, p1 = prices[p.t1.address.toLowerCase()] || 0;
      Object.assign(p, { p0, p1, tvl: p0 && p1 ? p.r0 * p0 + p.r1 * p1 : p0 ? p.r0 * p0 * 2 : p1 ? p.r1 * p1 * 2 : 0, vol24h: 0, vol7d: 0, tx7d: 0 });
    });

    const tvl = pairs.reduce((a, p) => a + p.tvl, 0);
    setStat('stTvl', fmtUsd(tvl), `${pairs.length} pools on ${net.label}`);
    setStat('stPairs', fmtInt(pairs.length), 'Live trading pairs');

    // 7 días de eventos Swap (Soneium ~2 s/bloque => 43 200 bloques/día)
    const bpd = Math.round((Number(net.blocksPerYear) || 15768000) / 365);
    const from = latest - bpd * 7;
    const ranges = [];
    for (let f = from; f <= latest; f += CFG.LOG_CHUNK) ranges.push([f, Math.min(latest, f + CFG.LOG_CHUNK - 1)]);
    const byAddr = Object.fromEntries(pairs.map((p) => [p.address.toLowerCase(), p]));
    const iface = new ethers.Interface(['event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)']);
    let logsOk = true;
    const logs = (await pool(ranges, CFG.CONCURRENCY, async ([a, b]) => {
      try { return await rpc.getLogs({ address: pairs.map((p) => p.address), topics: [SWAP_TOPIC], fromBlock: a, toBlock: b }); }
      catch (e) { logsOk = false; return []; }
    })).flat();
    const traders = new Set();
    for (const log of logs) {
      const p = byAddr[log.address.toLowerCase()];
      if (!p) continue;
      const ev = iface.parseLog(log);
      const v0 = parseFloat(ethers.formatUnits(ev.args.amount0In + ev.args.amount0Out, p.t0.decimals)) * p.p0;
      const v1 = parseFloat(ethers.formatUnits(ev.args.amount1In + ev.args.amount1Out, p.t1.decimals)) * p.p1;
      const usd = v0 && v1 ? (v0 + v1) / 2 : v0 || v1;
      p.vol7d += usd; p.tx7d++;
      if (latest - log.blockNumber < bpd) p.vol24h += usd;
      traders.add(ev.args.to.toLowerCase());
    }
    const lpFee = CFG.SWAP_FEE * CFG.LP_FEE_SHARE;
    pairs.forEach((p) => { p.apr = p.tvl > 0 ? ((p.vol7d * lpFee) / 7 * 365) / p.tvl : 0; });

    if (logsOk) {
      setStat('stVol', fmtUsd(pairs.reduce((a, p) => a + p.vol24h, 0)), `7d: ${fmtUsd(pairs.reduce((a, p) => a + p.vol7d, 0))}`);
      setStat('stSwaps', fmtInt(logs.length), `Across ${pairs.filter((p) => p.tx7d > 0).length} active pools`);
    } else {
      setStat('stVol', '—', 'RPC busy, see Analytics');
      setStat('stSwaps', '—', 'RPC busy, see Analytics');
    }
    renderTopPools(pairs);

    // Lending: misma convención que markets.js (cToken × exchangeRate normalizado a 18 decimales)
    const markets = await pool(net.cTokens || [], 4, async (m) => {
      try {
        const c = new ethers.Contract(m.address, ABI.cToken, rpc);
        const [ts, tb, er] = await Promise.all([c.totalSupply(), c.totalBorrows(), c.exchangeRateStored()]);
        const price = (await oraclePrice(m.address)) || (isStable(m.underlyingSymbol) ? 1 : 0);
        return { supplied: parseFloat(ethers.formatUnits(ts * er, 36)) * price, borrowed: parseFloat(ethers.formatUnits(tb, Number(m.underlyingDecimals ?? 18))) * price };
      } catch (e) { return null; }
    });
    const ok = markets.filter(Boolean);
    const supplied = ok.reduce((a, m) => a + m.supplied, 0);
    const borrowed = ok.reduce((a, m) => a + m.borrowed, 0);
    setStat('stLend', fmtUsd(supplied), `${ok.length} markets · ${fmtUsd(borrowed)} borrowed`);

    $('liveUpdated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  function renderTopPools(pairs) {
    const el = $('topPools');
    if (!el) return;
    const top = [...pairs].filter((p) => p.tvl > 0).sort((a, b) => b.tvl - a.tvl).slice(0, 3);
    if (!top.length) { el.innerHTML = '<div class="lp-empty">No pools with liquidity yet.</div>'; return; }
    const img = (t) => `<img src="${esc(t.logo)}" alt="" onerror="this.onerror=null;this.src='icons/token.svg'">`;
    el.innerHTML = top.map((p) => `
      <a class="lp-pool" href="pools.html?pair=${esc(p.address)}">
        <div class="lp-pool-pair"><span class="lp-icons">${img(p.t0)}${img(p.t1)}</span><b>${esc(p.t0.symbol)} / ${esc(p.t1.symbol)}</b></div>
        <div><span class="lp-k">TVL</span>${fmtUsd(p.tvl)}</div>
        <div><span class="lp-k">Vol 7d</span>${fmtUsd(p.vol7d)}</div>
        <div class="lp-apr"><span class="lp-k">Fee APR</span>${fmtPct(p.apr)}</div>
      </a>`).join('');
  }

  function renderNetworks(networks) {
    const el = $('networks');
    if (!el) return;
    el.innerHTML = Object.values(networks).filter((n) => n.enabled).map((n) =>
      `<span class="lp-chip${n.chainId === CFG.CHAIN_ID ? ' on' : ''}">${n.chainId === CFG.CHAIN_ID ? '<i></i>' : ''}${esc(n.label)}</span>`).join('');
  }

  function renderContracts(net) {
    const el = $('contracts');
    if (!el) return;
    const base = (net.blockExplorerUrls?.[0] || '').replace(/\/$/, '');
    const rows = [
      ['DEX Factory', net.factory], ['DEX Router', net.router], ['Lending Comptroller', net.master], ['SVUSD Stability Module', net.stabilityModule],
      ...(net.cTokens || []).map((m) => [`Market ${m.underlyingSymbol}`, m.address]),
    ].filter(([, a]) => a && /^0x[0-9a-fA-F]{40}$/.test(a));
    el.innerHTML = rows.map(([name, a]) => `
      <div class="lp-contract">
        <span>${esc(name)}</span>
        <span class="lp-addr">
          <a href="${esc(base)}/address/${esc(a)}" target="_blank" rel="noopener">${short(a)} ↗</a>
          <button type="button" data-copy="${esc(a)}" aria-label="Copy address">Copy</button>
        </span>
      </div>`).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-copy]');
      if (!b) return;
      navigator.clipboard.writeText(b.dataset.copy);
      b.textContent = 'Copied';
      setTimeout(() => { b.textContent = 'Copy'; }, 1400);
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    paintFromAnalyticsCache();
    $('year').textContent = new Date().getFullYear();
    try {
      const networks = await window.loadNetworks();
      renderNetworks(networks);
      const net = Object.values(networks).find((n) => n.chainId === CFG.CHAIN_ID && n.enabled) || Object.values(networks).find((n) => n.enabled && n.factory);
      renderContracts(net);
      await load(net);
    } catch (e) {
      console.error('[landing] live data failed', e);
      $('liveUpdated').textContent = 'Live data unavailable — open Analytics';
      document.querySelectorAll('.lp-stat.loading').forEach((s) => { s.classList.remove('loading'); s.querySelector('.v').textContent = '—'; });
    }
  });
})();
