/**
 * landing.js v2 — SoneVibe landing multi-chain (propuesta)
 * Soneium es la red principal (DEX + lending + SVUSD + NFTs). Además lee en vivo el DEX
 * de BNB Chain, Astar y Polkadot Hub para mostrar TVL total y el desglose por red.
 * Reutiliza config.js (loadNetworks), networks.json y token-list.json. No modifica nada existente.
 */
(() => {
  'use strict';

  const FLAGSHIP = '1868';
  // Solo mainnets. `logs` = cómo contar volumen: RPC con eth_getLogs, bloques por consulta, días y paralelismo.
  // bsc-dataseed no permite getLogs y publicnode solo sirve los últimos ~10 000 bloques sin token;
  // 48.club acepta rangos de 5 000 bloques en histórico (24 h de BNB ≈ 38 consultas, ~45 s).
  const CHAINS = {
    '1868': { name: 'Soneium', color: '#00e0ff', icon: 'icons/weth.svg', products: ['DEX', 'Lending', 'SVUSD', 'NFTs'], logs: { chunk: 10000, days: 7, concurrency: 4 } },
    '56': { name: 'BNB Chain', color: '#f3ba2f', icon: 'icons/bnb.png', products: ['DEX'], stables: ['usd1'], logs: { rpc: 'https://rpc-bsc.48.club', chunk: 5000, days: 1, concurrency: 12 } },
    '592': { name: 'Astar', color: '#8b5cf6', icon: 'icons/astr.svg', products: ['DEX', 'Lending', 'NFTs'] },
    '420420419': { name: 'Polkadot Hub', color: '#e6007a', icon: 'icons/polkadot.svg', products: ['DEX'] },
  };
  // Orden explícito: las claves numéricas de un objeto JS se ordenan de menor a mayor.
  const ORDER = ['1868', '56', '592', '420420419'];
  const CFG = {
    SWAP_FEE: 0.0025,
    LP_FEE_SHARE: 5 / 6,
    CONCURRENCY: 4,
    SIDE_CHAIN_TIMEOUT: 30000,
    STABLES: ['usdc', 'usdt', 'usdsc', 'svusd', 'dai', 'usds'],
    CACHE_KEY: 'SV_LANDING_V2',
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
  const SWAP_IFACE = new ethers.Interface(['event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)']);

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');
  const chainOf = (id) => CHAINS[id] || { name: id, color: '#64748b', products: [] };

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
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  function setStat(id, value, sub) {
    const el = $(id);
    if (!el) return;
    el.querySelector('.v').textContent = value;
    if (sub !== undefined) el.querySelector('.s').textContent = sub;
    el.classList.remove('loading');
  }

  // ---------- estado ----------
  const state = { nets: {}, results: {}, lending: null, pending: new Set() };

  function saveCache() {
    try {
      const chains = {};
      for (const [id, r] of Object.entries(state.results)) {
        chains[id] = { ...r, pairs: r.pairs.filter((p) => p.tvl > 0).sort((a, b) => b.tvl - a.tvl).slice(0, 5) };
      }
      localStorage.setItem(CFG.CACHE_KEY, JSON.stringify({ ts: Date.now(), chains, lending: state.lending }));
    } catch (e) { /* cuota llena o modo privado */ }
  }

  function paintFromCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG.CACHE_KEY) || 'null');
      if (!c || !c.chains || Date.now() - c.ts > 24 * 3600e3) return;
      Object.assign(state.results, c.chains);
      state.lending = c.lending || null;
      render();
    } catch (e) { /* sin caché */ }
  }

  // ---------- lectura on-chain de un DEX ----------
  async function scanChain(net, tokenList) {
    const meta = chainOf(net.chainId);
    const rpc = new ethers.JsonRpcProvider(net.rpcUrls[0], undefined, { staticNetwork: true, batchMaxCount: 20 });
    const stables = [...CFG.STABLES, ...(meta.stables || [])];
    const isStable = (s) => stables.some((x) => (s || '').toLowerCase().startsWith(x));

    const metaCache = {};
    const tokenMeta = async (addr) => {
      const k = addr.toLowerCase();
      if (metaCache[k]) return metaCache[k];
      const listed = tokenList[`${net.chainId}:${k}`];
      const c = new ethers.Contract(addr, ABI.erc20, rpc);
      const [sym, dec] = listed ? [listed.symbol, listed.decimals] : await Promise.all([c.symbol().catch(() => 'UNK'), c.decimals().catch(() => 18)]);
      return (metaCache[k] = { address: addr, symbol: String(sym).slice(0, 12), decimals: Number(dec), logo: listed?.logoURI || `icons/${String(sym).toLowerCase()}.svg` });
    };

    let oracle = null;
    if (isAddr(net.master)) {
      const oa = await new ethers.Contract(net.master, ABI.master, rpc).oracle().catch(() => null);
      if (oa && oa !== ZERO) oracle = new ethers.Contract(oa, ABI.oracle, rpc);
    }
    const oraclePrice = async (a) => {
      if (!oracle) return 0;
      try { const p = await oracle.getUnderlyingPrice(a); return p > 0n ? parseFloat(ethers.formatUnits(p, 18)) : 0; } catch (e) { return 0; }
    };

    const factory = new ethers.Contract(net.factory, ABI.factory, rpc);
    const [len, latest] = await Promise.all([factory.allPairsLength().then(Number), rpc.getBlockNumber()]);
    if (net.chainId === FLAGSHIP) $('liveBlock').textContent = `#${latest.toLocaleString('en-US')}`;
    const addrs = (await pool([...Array(len).keys()], 8, (i) => factory.allPairs(i).catch(() => null))).filter(Boolean);

    const pairs = (await pool(addrs, 6, async (address) => {
      try {
        const c = new ethers.Contract(address, ABI.pair, rpc);
        const [a0, a1, r] = await Promise.all([c.token0(), c.token1(), c.getReserves()]);
        const [t0, t1] = await Promise.all([tokenMeta(a0), tokenMeta(a1)]);
        return { address, t0, t1, r0: parseFloat(ethers.formatUnits(r[0], t0.decimals)), r1: parseFloat(ethers.formatUnits(r[1], t1.decimals)) };
      } catch (e) { return null; }
    })).filter(Boolean);

    // Precios: oráculo del lending si existe, stables a $1 y el resto derivado de las reservas.
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
      Object.assign(p, { chainId: net.chainId, p0, p1, tvl: p0 && p1 ? p.r0 * p0 + p.r1 * p1 : p0 ? p.r0 * p0 * 2 : p1 ? p.r1 * p1 * 2 : 0, vol24h: 0, vol7d: 0, tx7d: 0, apr: 0 });
    });

    const prev = state.results[net.chainId];
    const result = { chainId: net.chainId, tvl: pairs.reduce((a, p) => a + p.tvl, 0), pairs, pairCount: pairs.length, vol24h: 0, vol7d: 0, txs: 0, logDays: 0, logsOk: false, logsPending: !!(meta.logs && pairs.length), ts: Date.now() };
    // Mientras se escanean los eventos, conserva el volumen de la caché para no mostrar $0.
    if (prev && prev.logsOk && result.logsPending) {
      Object.assign(result, { vol24h: prev.vol24h, vol7d: prev.vol7d, txs: prev.txs, logDays: prev.logDays, activePools: prev.activePools, logsOk: true });
      const old = Object.fromEntries((prev.pairs || []).map((p) => [p.address.toLowerCase(), p]));
      pairs.forEach((p) => { const o = old[p.address.toLowerCase()]; if (o) Object.assign(p, { vol24h: o.vol24h, vol7d: o.vol7d, tx7d: o.tx7d, apr: o.apr }); });
    }
    state.results[net.chainId] = result;
    render();

    // Volumen desde eventos Swap
    if (meta.logs && pairs.length) {
      const logRpc = meta.logs.rpc ? new ethers.JsonRpcProvider(meta.logs.rpc, undefined, { staticNetwork: true }) : rpc;
      const bpd = Math.round((Number(net.blocksPerYear) || 15768000) / 365);
      const from = latest - bpd * meta.logs.days;
      const ranges = [];
      for (let f = from; f <= latest; f += meta.logs.chunk) ranges.push([f, Math.min(latest, f + meta.logs.chunk - 1)]);
      const byAddr = Object.fromEntries(pairs.map((p) => [p.address.toLowerCase(), p]));
      let failed = 0;
      const logs = (await pool(ranges, meta.logs.concurrency || CFG.CONCURRENCY, async ([a, b]) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try { return await logRpc.getLogs({ address: pairs.map((p) => p.address), topics: [SWAP_TOPIC], fromBlock: a, toBlock: b }); }
          catch (e) { await new Promise((r) => setTimeout(r, 400)); }
        }
        failed++;
        return [];
      })).flat();
      pairs.forEach((p) => { p.vol24h = 0; p.vol7d = 0; p.tx7d = 0; });
      for (const log of logs) {
        const p = byAddr[log.address.toLowerCase()];
        if (!p) continue;
        const ev = SWAP_IFACE.parseLog(log);
        const v0 = parseFloat(ethers.formatUnits(ev.args.amount0In + ev.args.amount0Out, p.t0.decimals)) * p.p0;
        const v1 = parseFloat(ethers.formatUnits(ev.args.amount1In + ev.args.amount1Out, p.t1.decimals)) * p.p1;
        const usd = v0 && v1 ? (v0 + v1) / 2 : v0 || v1;
        p.vol7d += usd; p.tx7d++;
        if (latest - log.blockNumber < bpd) p.vol24h += usd;
      }
      const lpFee = CFG.SWAP_FEE * CFG.LP_FEE_SHARE;
      pairs.forEach((p) => { p.apr = p.tvl > 0 ? ((p.vol7d * lpFee) / meta.logs.days * 365) / p.tvl : 0; });
      Object.assign(result, {
        logsPending: false,
        logsOk: failed <= ranges.length * 0.1,
        logDays: meta.logs.days,
        vol24h: pairs.reduce((a, p) => a + p.vol24h, 0),
        vol7d: meta.logs.days >= 7 ? pairs.reduce((a, p) => a + p.vol7d, 0) : 0,
        txs: logs.length,
        activePools: pairs.filter((p) => p.tx7d > 0).length,
      });
    }

    if (net.chainId === FLAGSHIP) await scanLending(net, rpc, oraclePrice, isStable);
    result.ts = Date.now();
    render();
    saveCache();
    return result;
  }

  // Lending: misma convención que markets.js (cToken × exchangeRate normalizado a 18 decimales)
  async function scanLending(net, rpc, oraclePrice, isStable) {
    const markets = await pool(net.cTokens || [], 4, async (m) => {
      try {
        const c = new ethers.Contract(m.address, ABI.cToken, rpc);
        const [ts, tb, er] = await Promise.all([c.totalSupply(), c.totalBorrows(), c.exchangeRateStored()]);
        const price = (await oraclePrice(m.address)) || (isStable(m.underlyingSymbol) ? 1 : 0);
        return { supplied: parseFloat(ethers.formatUnits(ts * er, 36)) * price, borrowed: parseFloat(ethers.formatUnits(tb, Number(m.underlyingDecimals ?? 18))) * price };
      } catch (e) { return null; }
    });
    const ok = markets.filter(Boolean);
    state.lending = { supplied: ok.reduce((a, m) => a + m.supplied, 0), borrowed: ok.reduce((a, m) => a + m.borrowed, 0), markets: ok.length };
  }

  // ---------- render ----------
  function orderedChains() {
    return ORDER
      .filter((id) => state.nets[id] || state.results[id])
      .sort((a, b) => (a === FLAGSHIP ? -1 : b === FLAGSHIP ? 1 : (state.results[b]?.tvl || 0) - (state.results[a]?.tvl || 0)));
  }

  function render() {
    const ids = orderedChains();
    const res = ids.map((id) => state.results[id]).filter(Boolean);
    const flag = state.results[FLAGSHIP];
    const allDone = state.pending.size === 0;

    if (res.length) {
      const tvl = res.reduce((a, r) => a + r.tvl, 0);
      const parts = res.filter((r) => r.tvl >= 1).slice(0, 2).map((r) => `${chainOf(r.chainId).name} ${fmtUsd(r.tvl)}`);
      setStat('stTvl', fmtUsd(tvl), parts.join(' · ') || `${res.length} networks`);
      const pairs = res.reduce((a, r) => a + r.pairCount, 0);
      setStat('stPairs', fmtInt(pairs), `On ${res.filter((r) => r.pairCount).length} networks`);
    }

    const withVol = res.filter((r) => r.logsOk);
    const scanning = res.filter((r) => r.logsPending && !r.logsOk);
    if (withVol.length) {
      const v = withVol.reduce((a, r) => a + r.vol24h, 0);
      const parts = [...withVol.map((r) => `${chainOf(r.chainId).name} ${fmtUsd(r.vol24h)}`), ...scanning.map((r) => `${chainOf(r.chainId).name} loading…`)];
      setStat('stVol', fmtUsd(v), parts.join(' · '));
    } else if (allDone && res.length && !scanning.length) {
      setStat('stVol', '—', 'RPC busy, see Analytics');
    }

    if (flag && flag.logDays >= 7) {
      setStat('stSwaps', fmtInt(flag.txs), `Across ${flag.activePools || 0} active Soneium pools`);
    } else if (flag && allDone) {
      setStat('stSwaps', '—', 'RPC busy, see Analytics');
    }

    if (state.lending) setStat('stLend', fmtUsd(state.lending.supplied), `${state.lending.markets} Soneium markets · ${fmtUsd(state.lending.borrowed)} borrowed`);

    renderNetworkCards(ids);
    renderTopPools(res);
    if (allDone && res.length) $('liveUpdated').textContent = `Updated ${new Date(Math.max(...res.map((r) => r.ts || 0))).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  function renderNetworkCards(ids) {
    const grid = $('chainGrid');
    const bar = $('tvlBar');
    if (!grid) return;
    const total = ids.reduce((a, id) => a + (state.results[id]?.tvl || 0), 0);

    if (bar) {
      bar.innerHTML = total > 0 ? ids.filter((id) => state.results[id]?.tvl > 0).map((id) => {
        const r = state.results[id];
        const share = r.tvl / total;
        return `<span style="flex:${Math.max(share, 0.015)};background:${chainOf(id).color}" title="${esc(chainOf(id).name)} ${fmtUsd(r.tvl)} (${(share * 100).toFixed(1)}%)"></span>`;
      }).join('') : '<span class="lp-bar-empty"></span>';
      $('tvlLegend').innerHTML = ids.filter((id) => state.results[id]).map((id) => {
        const r = state.results[id];
        return `<span><i style="background:${chainOf(id).color}"></i>${esc(chainOf(id).name)} <b>${total > 0 ? ((r.tvl / total) * 100).toFixed(1) : '0'}%</b></span>`;
      }).join('');
    }

    grid.innerHTML = ids.map((id) => {
      const c = chainOf(id);
      const r = state.results[id];
      const loading = !r && state.pending.has(id);
      const failed = !r && !state.pending.has(id);
      const top = r ? [...r.pairs].filter((p) => p.tvl > 0).sort((a, b) => b.tvl - a.tvl)[0] : null;
      const vol = !r ? '' : r.logsOk ? fmtUsd(r.vol24h) : r.logsPending ? '…' : c.logs ? '—' : 'n/a';
      const cell = (k, v) => `<div><span class="lp-k">${k}</span><b class="${loading ? 'lp-mini-skel' : ''}">${v}</b></div>`;
      const dash = failed ? '—' : '';
      const stats = [
        cell('DEX liquidity', r ? fmtUsd(r.tvl) : dash),
        cell('Pairs', r ? fmtInt(r.pairCount) : dash),
        cell('Volume 24h', vol || dash),
      ];
      if (id === FLAGSHIP) {
        const best = r ? Math.max(0, ...r.pairs.filter((p) => p.tvl >= 1).map((p) => p.apr || 0)) : 0;
        stats.push(
          cell('Swaps · 7d', r && r.logDays >= 7 ? fmtInt(r.txs) : r ? '…' : dash),
          cell('Lending supplied', state.lending ? fmtUsd(state.lending.supplied) : r ? '…' : dash),
          cell('Best fee APR', r && r.logDays >= 7 ? fmtPct(best) : r ? '…' : dash),
        );
      }
      return `
        <article class="lp-chain${id === FLAGSHIP ? ' flagship' : ''}" style="--c:${c.color}">
          <div class="lp-chain-head">
            <span class="lp-chain-ic"><img src="${esc(c.icon)}" alt="" onerror="this.remove()"></span>
            <div><h3>${esc(c.name)}</h3><span class="lp-chain-tag">${id === FLAGSHIP ? 'Flagship · full SoneVibe suite' : esc(c.products.join(' · '))}</span></div>
            ${id === FLAGSHIP ? `<div class="lp-chain-products">${c.products.map((p) => `<span>${esc(p)}</span>`).join('')}</div><span class="lp-home">Home chain</span>` : ''}
          </div>
          <div class="lp-chain-stats">${stats.join('')}</div>
          <p class="lp-chain-top">${top ? `Deepest pool: <b>${esc(top.t0.symbol)} / ${esc(top.t1.symbol)}</b> · ${fmtUsd(top.tvl)}` : loading ? 'Reading pools…' : failed ? 'Network RPC unavailable right now.' : 'No pools with liquidity yet.'}</p>
        </article>`;
    }).join('');
  }

  function renderTopPools(res) {
    const el = $('topPools');
    if (!el || !res.length) return;
    const all = res.flatMap((r) => r.pairs).filter((p) => p.tvl > 0);
    // Soneium primero: 3 pools de Soneium + los 2 mayores del resto de redes.
    const flagTop = all.filter((p) => p.chainId === FLAGSHIP).sort((a, b) => b.tvl - a.tvl).slice(0, 3);
    const otherTop = all.filter((p) => p.chainId !== FLAGSHIP).sort((a, b) => b.tvl - a.tvl).slice(0, 2);
    const top = [...flagTop, ...otherTop];
    if (!top.length) { if (state.pending.size === 0) el.innerHTML = '<div class="lp-empty">No pools with liquidity yet.</div>'; return; }
    const img = (t) => `<img src="${esc(t.logo)}" alt="" onerror="this.onerror=null;this.src='icons/token.svg'">`;
    el.innerHTML = top.map((p) => {
      const c = chainOf(p.chainId);
      const r = state.results[p.chainId];
      const days = r && (r.logsOk || r.logsPending) ? c.logs?.days || 0 : 0;
      const wait = r && r.logsPending && !r.logsOk;
      return `
      <a class="lp-pool" href="pools.html?pair=${esc(p.address)}">
        <div class="lp-pool-pair"><span class="lp-icons">${img(p.t0)}${img(p.t1)}</span><div><b>${esc(p.t0.symbol)} / ${esc(p.t1.symbol)}</b><span class="lp-net" style="--c:${c.color}">${esc(c.name)}</span></div></div>
        <div><span class="lp-k">TVL</span>${fmtUsd(p.tvl)}</div>
        <div><span class="lp-k">Volume ${days >= 7 ? '7d' : '24h'}</span>${wait ? '…' : days ? fmtUsd(days >= 7 ? p.vol7d : p.vol24h) : '—'}</div>
        <div class="lp-apr"><span class="lp-k">Fee APR${days && days < 7 ? ' (24h)' : ''}</span>${wait ? '…' : days ? fmtPct(p.apr) : '—'}</div>
      </a>`;
    }).join('');
  }

  function renderContracts() {
    const tabs = $('contractTabs');
    const list = $('contracts');
    if (!tabs || !list) return;
    const ids = ORDER.filter((id) => state.nets[id]);
    let active = ids.includes(FLAGSHIP) ? FLAGSHIP : ids[0];
    const draw = () => {
      const net = state.nets[active];
      const base = (net.blockExplorerUrls?.[0] || '').replace(/\/$/, '');
      const hasLending = isAddr(net.master);
      const rows = [
        ['DEX Factory', net.factory], ['DEX Router', net.router],
        ...(hasLending ? [['Lending Comptroller', net.master], ['SVUSD Stability Module', net.stabilityModule], ...(net.cTokens || []).map((m) => [`Market ${m.underlyingSymbol}`, m.address])] : []),
        ...(net.swapTokens?.quote?.symbol === 'LIGHT' ? [['LIGHT token', net.swapTokens.quote.address]] : []),
      ].filter(([, a]) => isAddr(a));
      tabs.innerHTML = ids.map((id) => `<button type="button" role="tab" aria-selected="${id === active}" data-chain="${id}">${esc(chainOf(id).name)}</button>`).join('');
      list.innerHTML = rows.map(([name, a]) => `
        <div class="lp-contract">
          <span>${esc(name)}</span>
          <span class="lp-addr">
            <a href="${esc(base)}/address/${esc(a)}" target="_blank" rel="noopener">${short(a)} ↗</a>
            <button type="button" data-copy="${esc(a)}" aria-label="Copy address">Copy</button>
          </span>
        </div>`).join('');
    };
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-chain]');
      if (!b) return;
      active = b.dataset.chain;
      draw();
    });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-copy]');
      if (!b) return;
      navigator.clipboard.writeText(b.dataset.copy);
      b.textContent = 'Copied';
      setTimeout(() => { b.textContent = 'Copy'; }, 1400);
    });
    draw();
  }

  function renderNetworkChips(networks) {
    const el = $('netChips');
    if (!el) return;
    const live = new Set(Object.values(networks).filter((n) => n.enabled).map((n) => n.chainId));
    el.innerHTML = ORDER.filter((id) => live.has(id)).map((id) =>
      `<span class="lp-chip${id === FLAGSHIP ? ' on' : ''}" style="--c:${chainOf(id).color}"><i></i>${esc(chainOf(id).name)}</span>`).join('');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('year').textContent = new Date().getFullYear();
    paintFromCache();
    try {
      const networks = await window.loadNetworks();
      Object.values(networks).forEach((n) => { if (n.enabled && CHAINS[n.chainId] && isAddr(n.factory)) state.nets[n.chainId] = n; });
      renderNetworkChips(networks);
      renderContracts();

      const tokenList = {};
      try {
        const tl = await (await fetch('./token-list.json')).json();
        (tl.tokens || []).forEach((t) => { tokenList[`${t.chainId}:${t.address.toLowerCase()}`] = t; });
      } catch (e) { /* opcional */ }

      Object.keys(state.nets).forEach((id) => state.pending.add(id));
      render();
      await Promise.all(Object.values(state.nets).map(async (net) => {
        try {
          const job = scanChain(net, tokenList);
          await (net.chainId === FLAGSHIP ? job : withTimeout(job, CFG.SIDE_CHAIN_TIMEOUT));
        } catch (e) {
          if (e.message !== 'timeout') console.warn(`[landing] ${net.label} failed`, e);
        } finally {
          state.pending.delete(net.chainId);
          render();
        }
      }));
      saveCache();
    } catch (e) {
      console.error('[landing] live data failed', e);
      $('liveUpdated').textContent = 'Live data unavailable — open Analytics';
      document.querySelectorAll('.lp-stat.loading').forEach((s) => { s.classList.remove('loading'); s.querySelector('.v').textContent = '—'; });
    }
  });
})();
