/**
 * analytics-pro.js — SoneVibe Analytics Pro (propuesta)
 *
 * Archivo NUEVO e independiente. No modifica analytics.js.
 * Reutiliza lo que ya existe en el sitio: config.js (loadNetworks, SessionManager,
 * checkAutoConnect), wallet-config.js (WALLET_CONFIG), networks.json y token-list.json.
 *
 * Qué calcula (todo on-chain, sin backend):
 *  - Volumen real 24h / 7d leyendo eventos Swap de cada par (UniswapV2).
 *  - Fees para LPs y APR de fees (base 7d y 24h) + APY con compounding diario.
 *  - Precios: oráculo SoneVibe -> stablecoins -> derivados de reservas de pares.
 *  - Si el RPC no permite leer logs, cae a modo "Estimado" (mismo modelo que analytics.js).
 */
(() => {
  'use strict';

  const CFG = {
    // VibePair.swap: balance * 10000 - amountIn * 25  => fee 0.25% (router usa 9975/10000)
    SWAP_FEE: 0.0025,
    // VibePair._mintFee usa (rootK * 5 + rootKLast): con feeTo activo el protocolo recibe 1/6.
    LP_FEE_SHARE: 5 / 6,
    WINDOW_DAYS: 7,
    LOG_CHUNK: 10000,
    MIN_LOG_CHUNK: 500,
    CONCURRENCY: 4,
    CACHE_TTL_MS: 5 * 60 * 1000,
    AUTO_REFRESH_MS: 5 * 60 * 1000,
    LOW_TVL_USD: 100,
    MINIMUM_LIQUIDITY: 100000n,
    STABLES: ['usdc', 'usdt', 'usdsc', 'svusd', 'dai', 'usds', 'busd'],
  };

  const ZERO = '0x0000000000000000000000000000000000000000';
  const SWAP_TOPIC = ethers.id('Swap(address,uint256,uint256,uint256,uint256,address)');

  const ABI = {
    factory: ['function allPairsLength() view returns (uint)', 'function allPairs(uint) view returns (address)'],
    pair: [
      'function token0() view returns (address)',
      'function token1() view returns (address)',
      'function getReserves() view returns (uint112, uint112, uint32)',
      'function totalSupply() view returns (uint256)',
      'function balanceOf(address) view returns (uint256)',
    ],
    erc20: ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'],
    oracle: ['function getUnderlyingPrice(address) view returns (uint)'],
    master: ['function oracle() view returns (address)'],
  };

  const S = {
    networks: null,
    active: null,
    rpc: null,
    user: null,
    walletProvider: null,
    tokenList: {},
    tokenMeta: {},
    pools: [],
    daily: [],
    dailyTx: [],
    totals: null,
    mode: 'real',
    updatedAt: 0,
    loading: false,
    sort: { key: 'tvl', dir: -1 },
    filter: '',
    onlyMine: false,
    aprBasis: '7d',
    calc: null,
  };

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- utils
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtUsd(n, compact = true) {
    if (!isFinite(n) || n === null) return '—';
    if (n === 0) return '$0';
    if (n > 0 && n < 0.01) return '<$0.01';
    if (compact && Math.abs(n) >= 1e4) {
      return '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
    }
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtNum(n, d = 2) {
    if (!isFinite(n)) return '—';
    if (n === 0) return '0';
    if (Math.abs(n) < 0.0001) return '<0.0001';
    if (Math.abs(n) >= 1e6) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
    return n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : d });
  }

  function fmtPct(n) {
    if (!isFinite(n) || n === null) return '—';
    const p = n * 100;
    if (p === 0) return '0.00%';
    if (p > 0 && p < 0.01) return '<0.01%';
    if (p >= 10000) return '>10,000%';
    return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  }

  const aprToApy = (apr, periods = 365) => (isFinite(apr) && apr > 0 ? Math.pow(1 + apr / periods, periods) - 1 : 0);

  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

  function explorerBase() {
    const u = S.active?.blockExplorerUrls?.[0];
    return u ? u.replace(/\/$/, '') : '';
  }

  async function pool(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    });
    await Promise.all(workers);
    return out;
  }

  const isStable = (sym) => {
    const s = (sym || '').toLowerCase();
    return CFG.STABLES.some((x) => s === x || s.startsWith(x));
  };

  function toast(msg, type = 'info') {
    const box = $('svToast');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `sv-toast ${type}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3000);
  }

  // ---------------------------------------------------------------- cache
  const cacheKey = () => `SV_ANALYTICS_PRO_${S.active?.chainId}`;

  function saveCache() {
    try {
      localStorage.setItem(cacheKey(), JSON.stringify({
        updatedAt: S.updatedAt, mode: S.mode, pools: S.pools, daily: S.daily, dailyTx: S.dailyTx, totals: S.totals,
      }));
    } catch (e) { /* storage lleno o bloqueado */ }
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(cacheKey());
      if (!raw) return false;
      const c = JSON.parse(raw);
      Object.assign(S, { updatedAt: c.updatedAt, mode: c.mode, pools: c.pools || [], daily: c.daily || [], dailyTx: c.dailyTx || [], totals: c.totals });
      return true;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- tokens
  async function loadTokenList() {
    try {
      const res = await fetch('./token-list.json');
      if (!res.ok) return;
      const json = await res.json();
      (json.tokens || []).forEach((t) => {
        if (t.chainId && t.address) S.tokenList[`${Number(t.chainId)}:${t.address.toLowerCase()}`] = t;
      });
    } catch (e) { /* opcional */ }
  }

  async function tokenMeta(addr) {
    const key = `${S.active.chainId}:${addr.toLowerCase()}`;
    if (S.tokenMeta[key]) return S.tokenMeta[key];
    const listed = S.tokenList[`${Number(S.active.chainId)}:${addr.toLowerCase()}`];
    const c = new ethers.Contract(addr, ABI.erc20, S.rpc);
    let [symbol, decimals] = await Promise.all([c.symbol().catch(() => ''), c.decimals().catch(() => null)]);
    if (!symbol && listed) symbol = listed.symbol;
    if (decimals === null) decimals = listed?.decimals ?? 18;
    const meta = {
      symbol: String(symbol || 'UNK').slice(0, 16),
      decimals: Number(decimals),
      logo: listed?.logoURI || `icons/${String(symbol || 'token').toLowerCase()}.svg`,
    };
    S.tokenMeta[key] = meta;
    return meta;
  }

  // ---------------------------------------------------------------- chain helpers
  async function resolveOracle() {
    let addr = S.active.oracle || null;
    if (!addr && S.active.master) {
      addr = await new ethers.Contract(S.active.master, ABI.master, S.rpc).oracle().catch(() => null);
    }
    return addr && addr !== ZERO ? new ethers.Contract(addr, ABI.oracle, S.rpc) : null;
  }

  async function oraclePrice(oracle, addr) {
    if (!oracle) return 0;
    try {
      const p = await oracle.getUnderlyingPrice(addr);
      return p > 0n ? parseFloat(ethers.formatUnits(p, 18)) : 0;
    } catch (e) { return 0; }
  }

  async function secondsPerBlock(latest) {
    const span = 10000;
    try {
      const [a, b] = await Promise.all([S.rpc.getBlock(latest), S.rpc.getBlock(Math.max(1, latest - span))]);
      const spb = (a.timestamp - b.timestamp) / (a.number - b.number);
      if (spb > 0 && spb < 120) return spb;
    } catch (e) { /* fallback */ }
    const bpy = Number(S.active.blocksPerYear || 0);
    return bpy > 0 ? (365 * 86400) / bpy : 2;
  }

  async function fetchSwapLogs(addresses, fromBlock, toBlock, onProgress) {
    let chunk = CFG.LOG_CHUNK;
    const ranges = [];
    for (let f = fromBlock; f <= toBlock; f += chunk) ranges.push([f, Math.min(toBlock, f + chunk - 1)]);
    let done = 0;

    const getRange = async ([from, to]) => {
      try {
        const logs = await S.rpc.getLogs({ address: addresses, topics: [SWAP_TOPIC], fromBlock: from, toBlock: to });
        return logs;
      } catch (e) {
        const size = to - from + 1;
        if (size <= CFG.MIN_LOG_CHUNK) throw e;
        const mid = from + Math.floor(size / 2);
        const [l, r] = await Promise.all([getRange([from, mid - 1]), getRange([mid, to])]);
        return l.concat(r);
      }
    };

    const results = await pool(ranges, CFG.CONCURRENCY, async (r) => {
      const logs = await getRange(r);
      done++;
      onProgress && onProgress(done / ranges.length);
      return logs;
    });
    return results.flat();
  }

  // ---------------------------------------------------------------- engine
  async function loadAll({ silent = false } = {}) {
    if (!S.active || !S.active.factory) return;
    if (S.loading) { S.reloadQueued = true; return; }
    S.loading = true;
    S.reloadQueued = false;
    const chainId = S.active.chainId;
    setSync('Syncing…', 'warning');
    if (!silent) setProgress(0.02, 'Reading pairs');

    try {
      S.rpc = new ethers.JsonRpcProvider(S.active.rpcUrls[0], undefined, { staticNetwork: true, batchMaxCount: 20 });
      const factory = new ethers.Contract(S.active.factory, ABI.factory, S.rpc);
      const [len, oracle, latest] = await Promise.all([
        factory.allPairsLength().then(Number),
        resolveOracle(),
        S.rpc.getBlockNumber(),
      ]);

      const idx = Array.from({ length: len }, (_, i) => i);
      const addrs = (await pool(idx, 8, (i) => factory.allPairs(i).catch(() => null))).filter(Boolean);
      setProgress(0.12, `Loading ${addrs.length} pairs`);

      const raw = (await pool(addrs, 6, async (address) => {
        try {
          const c = new ethers.Contract(address, ABI.pair, S.rpc);
          const [t0, t1, res, ts, bal] = await Promise.all([
            c.token0(), c.token1(), c.getReserves(), c.totalSupply().catch(() => 0n),
            S.user ? c.balanceOf(S.user).catch(() => 0n) : Promise.resolve(0n),
          ]);
          const [m0, m1] = await Promise.all([tokenMeta(t0), tokenMeta(t1)]);
          return {
            address, t0: { address: t0, ...m0 }, t1: { address: t1, ...m1 },
            r0: parseFloat(ethers.formatUnits(res[0], m0.decimals)),
            r1: parseFloat(ethers.formatUnits(res[1], m1.decimals)),
            totalSupply: ts, userLp: bal,
          };
        } catch (e) {
          console.warn('[analytics-pro] pair failed', address, e);
          return null;
        }
      })).filter(Boolean);
      setProgress(0.3, 'Pricing tokens');

      const prices = await resolvePrices(raw, oracle);

      raw.forEach((p) => {
        p.t0.price = prices[p.t0.address.toLowerCase()] || 0;
        p.t1.price = prices[p.t1.address.toLowerCase()] || 0;
        p.tvl = p.t0.price && p.t1.price ? p.r0 * p.t0.price + p.r1 * p.t1.price
          : p.t0.price ? p.r0 * p.t0.price * 2
          : p.t1.price ? p.r1 * p.t1.price * 2 : 0;
        p.myShare = lpShare(p.userLp, p.totalSupply);
        p.myUsd = p.tvl * p.myShare;
      });

      const spb = await secondsPerBlock(latest);
      const blocksPerDay = Math.round(86400 / spb);
      const fromBlock = Math.max(0, latest - blocksPerDay * CFG.WINDOW_DAYS);

      let logs = null;
      if (raw.length) {
        try {
          setProgress(0.35, 'Reading swap history (7d)');
          logs = await fetchSwapLogs(raw.map((p) => p.address), fromBlock, latest, (f) => setProgress(0.35 + f * 0.5, `Reading swap history ${Math.round(f * 100)}%`));
        } catch (e) {
          console.warn('[analytics-pro] getLogs unavailable, falling back to estimates', e);
        }
      }
      S.mode = logs ? 'real' : 'estimated';

      const byPair = Object.fromEntries(raw.map((p) => [p.address.toLowerCase(), p]));
      raw.forEach((p) => Object.assign(p, { vol24h: 0, vol7d: 0, tx24h: 0, tx7d: 0, daily: new Array(CFG.WINDOW_DAYS).fill(0) }));
      const daily = new Array(CFG.WINDOW_DAYS).fill(0);
      const dailyTx = new Array(CFG.WINDOW_DAYS).fill(0);

      if (logs) {
        const iface = new ethers.Interface(['event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)']);
        for (const log of logs) {
          const p = byPair[log.address.toLowerCase()];
          if (!p) continue;
          let ev;
          try { ev = iface.parseLog(log); } catch (e) { continue; }
          const a0 = parseFloat(ethers.formatUnits(ev.args.amount0In + ev.args.amount0Out, p.t0.decimals));
          const a1 = parseFloat(ethers.formatUnits(ev.args.amount1In + ev.args.amount1Out, p.t1.decimals));
          const v0 = a0 * p.t0.price, v1 = a1 * p.t1.price;
          const usd = v0 && v1 ? (v0 + v1) / 2 : v0 || v1;
          const age = latest - log.blockNumber;
          const day = Math.min(CFG.WINDOW_DAYS - 1, Math.floor(age / blocksPerDay));
          p.vol7d += usd; p.tx7d++;
          p.daily[CFG.WINDOW_DAYS - 1 - day] += usd;
          daily[CFG.WINDOW_DAYS - 1 - day] += usd;
          dailyTx[CFG.WINDOW_DAYS - 1 - day]++;
          if (age < blocksPerDay) { p.vol24h += usd; p.tx24h++; }
        }
      } else {
        raw.forEach((p) => {
          const est = syntheticMetrics(p.tvl, p.address);
          p.vol24h = est.vol; p.vol7d = est.vol * 7; p.tx24h = est.tx; p.tx7d = est.tx * 7;
          p.daily = new Array(CFG.WINDOW_DAYS).fill(est.vol);
          p.daily.forEach((v, i) => { daily[i] += v; dailyTx[i] += est.tx; });
        });
      }

      const lpFee = CFG.SWAP_FEE * CFG.LP_FEE_SHARE;
      raw.forEach((p) => {
        p.fees24h = p.vol24h * lpFee;
        p.fees7d = p.vol7d * lpFee;
        p.apr24h = p.tvl > 0 ? (p.fees24h * 365) / p.tvl : 0;
        p.apr7d = p.tvl > 0 ? ((p.fees7d / CFG.WINDOW_DAYS) * 365) / p.tvl : 0;
        p.apy24h = aprToApy(p.apr24h);
        p.apy7d = aprToApy(p.apr7d);
        p.lowTvl = p.tvl < CFG.LOW_TVL_USD;
        p.totalSupply = p.totalSupply.toString();
        p.userLp = p.userLp.toString();
      });

      if (S.active.chainId !== chainId) return;

      S.pools = raw;
      S.daily = daily;
      S.dailyTx = dailyTx;
      S.totals = computeTotals(raw);
      S.updatedAt = Date.now();
      saveCache();
      renderAll();
      setProgress(1);
      setSync(S.mode === 'real' ? 'Live · on-chain' : 'Estimated', S.mode === 'real' ? 'success' : 'warning');
    } catch (e) {
      console.error('[analytics-pro] load failed', e);
      setProgress(1);
      setSync('RPC error', 'danger');
      if (!S.pools.length) renderError('We could not reach the network RPC. Check your connection or switch network and try again.');
      else toast('Refresh failed — showing last known data', 'error');
    } finally {
      S.loading = false;
      if (S.reloadQueued) loadAll({ silent: true });
    }
  }

  function lpShare(userLp, totalSupply) {
    try {
      const ub = BigInt(userLp || 0), ts = BigInt(totalSupply || 0);
      if (ub === 0n || ts === 0n) return 0;
      const adj = ts > CFG.MINIMUM_LIQUIDITY ? ts - CFG.MINIMUM_LIQUIDITY : ts;
      return Math.min(1, Number((ub * 1000000n) / adj) / 1e6);
    } catch (e) { return 0; }
  }

  async function resolvePrices(pairs, oracle) {
    const prices = {};
    const tokens = {};
    pairs.forEach((p) => { tokens[p.t0.address.toLowerCase()] = p.t0; tokens[p.t1.address.toLowerCase()] = p.t1; });

    await pool(Object.keys(tokens), 6, async (addr) => {
      const px = await oraclePrice(oracle, addr);
      if (px > 0) prices[addr] = px;
      else if (isStable(tokens[addr].symbol)) prices[addr] = 1;
    });

    // Tokens sin oráculo (p.ej. WETH devuelve 0): precio implícito del par más profundo contra un token con precio.
    for (let pass = 0; pass < 4; pass++) {
      const candidates = {};
      pairs.forEach((p) => {
        const a0 = p.t0.address.toLowerCase(), a1 = p.t1.address.toLowerCase();
        if (prices[a0] && !prices[a1] && p.r1 > 0) {
          const depth = p.r0 * prices[a0];
          if (!candidates[a1] || depth > candidates[a1].depth) candidates[a1] = { depth, price: depth / p.r1 };
        } else if (prices[a1] && !prices[a0] && p.r0 > 0) {
          const depth = p.r1 * prices[a1];
          if (!candidates[a0] || depth > candidates[a0].depth) candidates[a0] = { depth, price: depth / p.r0 };
        }
      });
      const found = Object.entries(candidates);
      if (!found.length) break;
      found.forEach(([a, c]) => { if (c.depth > 1) prices[a] = c.price; });
    }
    return prices;
  }

  // Mismo modelo que analytics.js, usado sólo si el RPC no entrega logs.
  function syntheticMetrics(tvl, address) {
    if (!tvl || tvl <= 0) return { vol: 0, tx: 0 };
    const BASE_VOL = 0.016, BASE_TX = 35 / 250;
    const seed = address.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const v = 0.8 + (seed % 40) / 100;
    const tx = tvl < 5000 ? tvl * BASE_TX * v : (5000 * BASE_TX + (tvl - 5000) * BASE_TX * 0.15) * v;
    return { vol: tvl * BASE_VOL * v, tx: Math.max(0, Math.floor(tx)) };
  }

  function computeTotals(pools) {
    const tvl = pools.reduce((a, p) => a + p.tvl, 0);
    const vol24h = pools.reduce((a, p) => a + p.vol24h, 0);
    const vol7d = pools.reduce((a, p) => a + p.vol7d, 0);
    const fees24h = pools.reduce((a, p) => a + p.fees24h, 0);
    const tx24h = pools.reduce((a, p) => a + p.tx24h, 0);
    const myLiq = pools.reduce((a, p) => a + p.myUsd, 0);
    const myDaily = pools.reduce((a, p) => a + (p.myUsd * p.apr7d) / 365, 0);
    const avgApr = tvl > 0 ? pools.reduce((a, p) => a + p.apr7d * p.tvl, 0) / tvl : 0;
    return { tvl, vol24h, vol7d, fees24h, tx24h, myLiq, myDaily, avgApr };
  }

  // ---------------------------------------------------------------- render
  function setSync(text, tone) {
    const dot = $('statusDot'), txt = $('connStatus');
    if (dot) dot.style.color = `var(--${tone})`;
    if (txt) txt.textContent = text;
  }

  function setProgress(f, label) {
    const bar = $('svProgress');
    if (!bar) return;
    bar.style.width = `${Math.round(f * 100)}%`;
    bar.parentElement.classList.toggle('done', f >= 1);
    const l = $('svProgressLabel');
    if (l) l.textContent = f >= 1 ? '' : label || '';
  }

  function renderAll() {
    renderHero();
    renderChart();
    renderPools();
    renderMeta();
  }

  function renderMeta() {
    const badge = $('svModeBadge');
    if (badge) {
      badge.className = `sv-badge ${S.mode === 'real' ? 'real' : 'est'}`;
      badge.innerHTML = S.mode === 'real'
        ? '<span class="sv-pulse"></span> On-chain data'
        : '⚠ Estimated (RPC has no log access)';
    }
    const up = $('svUpdated');
    if (up && S.updatedAt) {
      const d = new Date(S.updatedAt);
      up.textContent = `Updated ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    const fee = $('svFeeInfo');
    if (fee) fee.textContent = `Swap fee ${(CFG.SWAP_FEE * 100).toFixed(2)}% · LPs earn ${(CFG.SWAP_FEE * CFG.LP_FEE_SHARE * 100).toFixed(4)}%`;
  }

  function renderHero() {
    const t = S.totals;
    if (!t) return;
    const volChange = t.vol7d > 0 ? t.vol24h / (t.vol7d / 7) - 1 : 0;
    const set = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
    set('hTvl', fmtUsd(t.tvl));
    set('hTvlSub', `${S.pools.length} pairs · ${S.pools.filter((p) => p.vol7d > 0).length} active this week`);
    set('hVol', fmtUsd(t.vol24h));
    set('hVolSub', t.vol7d > 0
      ? `<span class="${volChange >= 0 ? 'up' : 'down'}">${volChange >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(volChange))}</span> vs 7d avg · ${t.tx24h} swaps`
      : `${t.tx24h} swaps`);
    set('hFees', fmtUsd(t.fees24h));
    set('hFeesSub', `7d: ${fmtUsd(S.pools.reduce((a, p) => a + p.fees7d, 0))} to LPs`);
    set('hApr', fmtPct(t.avgApr));
    set('hAprSub', `APY ${fmtPct(aprToApy(t.avgApr))} · TVL-weighted`);
    set('hMine', S.user ? fmtUsd(t.myLiq, false) : '<button class="sv-link" data-action="connect">Connect wallet</button>');
    set('hMineSub', S.user ? `≈ ${fmtUsd(t.myDaily, false)}/day in fees` : 'See your positions & earnings');
  }

  function renderChart() {
    const el = $('svChart');
    if (!el) return;
    const data = S.daily || [];
    const txs = S.dailyTx || [];
    const total = data.reduce((a, v) => a + v, 0);
    const totalEl = $('svChartTotal');
    if (totalEl) totalEl.textContent = data.length ? fmtUsd(total, false) : '—';
    const max = Math.max(...data, 0);
    if (!data.length || max === 0) {
      el.innerHTML = '<div class="sv-empty-sm">No swaps in the last 7 days.</div>';
      return;
    }
    const W = 700, H = 150, TOP = 32, gap = 14, bw = (W - gap * (data.length - 1)) / data.length;
    const labels = data.map((_, i) => {
      const d = new Date(Date.now() - (data.length - 1 - i) * 86400000);
      return i === data.length - 1 ? 'Last 24h' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
    });
    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${TOP + H + 32}" role="img" aria-label="Daily volume in USD, last 7 days">
        <defs><linearGradient id="svBar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#00e0ff"/><stop offset="100%" stop-color="#a855f7" stop-opacity="0.6"/>
        </linearGradient></defs>
        ${data.map((v, i) => {
          const h = Math.max(3, (v / max) * H);
          const x = i * (bw + gap);
          const y = TOP + H - h;
          const today = i === data.length - 1;
          return `<g class="sv-bar${today ? ' today' : ''}">
            <title>${labels[i]}: ${fmtUsd(v, false)} · ${txs[i] ?? 0} swaps</title>
            <text class="sv-bar-val" x="${x + bw / 2}" y="${y - 9}" text-anchor="middle">${fmtUsd(v)}</text>
            <rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="6" fill="url(#svBar)"/>
            <text x="${x + bw / 2}" y="${TOP + H + 24}" text-anchor="middle">${labels[i]}</text></g>`;
        }).join('')}
      </svg>`;
  }

  function aprOf(p) { return S.aprBasis === '24h' ? p.apr24h : p.apr7d; }
  function apyOf(p) { return S.aprBasis === '24h' ? p.apy24h : p.apy7d; }

  function sortedPools() {
    const f = S.filter.trim().toLowerCase();
    const k = S.sort.key;
    const val = (p) => (k === 'apr' ? aprOf(p) : k === 'pair' ? `${p.t0.symbol}/${p.t1.symbol}` : p[k] ?? 0);
    return S.pools
      .filter((p) => !f || `${p.t0.symbol} ${p.t1.symbol} ${p.address}`.toLowerCase().includes(f))
      .filter((p) => !S.onlyMine || p.myUsd > 0.01)
      .sort((a, b) => {
        const va = val(a), vb = val(b);
        return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * S.sort.dir;
      });
  }

  function tokenImg(t) {
    return `<img src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='icons/token.svg'">`;
  }

  function spark(values) {
    const max = Math.max(...values, 0);
    if (!max) return '<span class="sv-muted">—</span>';
    const W = 64, H = 20;
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - (v / max) * (H - 2) - 1}`).join(' ');
    return `<svg class="sv-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="#00e0ff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  function renderPools() {
    const body = $('svPoolsBody');
    if (!body) return;
    document.querySelectorAll('#svPoolsTable th[data-sort]').forEach((th) => {
      th.classList.toggle('sorted', th.dataset.sort === S.sort.key);
      th.dataset.dir = S.sort.dir > 0 ? 'asc' : 'desc';
    });

    const rows = sortedPools();
    if (!S.pools.length) {
      body.innerHTML = `<tr><td colspan="8" class="sv-empty">No liquidity pairs on ${esc(S.active?.label || 'this network')} yet.</td></tr>`;
      return;
    }
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="8" class="sv-empty">${S.onlyMine ? 'You have no liquidity positions on this network.' : 'No pairs match your search.'}</td></tr>`;
      return;
    }
    const scan = explorerBase();
    body.innerHTML = rows.map((p) => {
      const i = S.pools.indexOf(p);
      const apr = aprOf(p), apy = apyOf(p);
      const tip = `Fee APR (7d avg): ${fmtPct(p.apr7d)}&#10;Fee APR (24h): ${fmtPct(p.apr24h)}&#10;APY (daily compound): ${fmtPct(apy)}&#10;LP fees 7d: ${fmtUsd(p.fees7d, false)}`;
      const mine = !S.user ? '<span class="sv-muted">—</span>'
        : p.myUsd > 0.01 ? `<div class="sv-strong">${fmtUsd(p.myUsd, false)}</div><div class="sv-sub up">${fmtPct(p.myShare)} · ${fmtUsd((p.myUsd * apr) / 365, false)}/day</div>`
        : '<span class="sv-muted">No position</span>';
      return `
      <tr>
        <td data-label="Pair">
          <div class="sv-pair">
            <div class="double-icon-container">${tokenImg(p.t0)}${tokenImg(p.t1)}</div>
            <div>
              <div class="sv-strong">${esc(p.t0.symbol)} / ${esc(p.t1.symbol)} <span class="sv-chip">${(CFG.SWAP_FEE * 100).toFixed(2)}%</span></div>
              <div class="sv-sub">${short(p.address)}${p.lowTvl ? ' · <span class="sv-warn">Low liquidity</span>' : ''}</div>
            </div>
          </div>
        </td>
        <td data-label="TVL"><div class="sv-strong">${fmtUsd(p.tvl)}</div><div class="sv-sub">${fmtNum(p.r0)} ${esc(p.t0.symbol)} · ${fmtNum(p.r1)} ${esc(p.t1.symbol)}</div></td>
        <td data-label="Volume 24h"><div class="sv-strong">${fmtUsd(p.vol24h)}</div><div class="sv-sub">${p.tx24h} swaps</div></td>
        <td data-label="Volume 7d"><div class="sv-flex">${fmtUsd(p.vol7d)} ${spark(p.daily)}</div></td>
        <td data-label="Fees 24h" class="sv-col-fees">${fmtUsd(p.fees24h)}</td>
        <td data-label="APR / APY" title="${tip}">
          <button class="sv-apr" data-action="calc" data-i="${i}" aria-label="Open ROI calculator">
            <span class="sv-apr-val">${p.tvl > 0 ? fmtPct(apr) : '—'}</span>
            <span class="sv-calc-ico" aria-hidden="true">⊞</span>
          </button>
          <div class="sv-sub">APY ${p.tvl > 0 ? fmtPct(apy) : '—'}</div>
        </td>
        <td data-label="My position">${mine}</td>
        <td data-label="" class="sv-actions">
          <a class="btn-primary btn-xs" href="pools.html?pair=${esc(p.address)}">Add</a>
          <a class="btn-ghost btn-xs" href="swap.html?inputCurrency=${esc(p.t0.address)}&outputCurrency=${esc(p.t1.address)}">Trade</a>
          ${scan ? `<a class="btn-ghost btn-xs" target="_blank" rel="noopener" href="${esc(scan)}/address/${esc(p.address)}" aria-label="View on explorer">↗</a>` : ''}
        </td>
      </tr>`;
    }).join('');
  }

  function renderSkeleton() {
    const row = '<tr class="sv-skel">' + '<td><span></span></td>'.repeat(8) + '</tr>';
    const body = $('svPoolsBody');
    if (body) body.innerHTML = row.repeat(5);
    ['hTvl', 'hVol', 'hFees', 'hApr'].forEach((id) => { const el = $(id); if (el) el.innerHTML = '<span class="sv-skel-line"></span>'; });
  }

  function renderError(msg) {
    const body = $('svPoolsBody');
    if (body) body.innerHTML = `<tr><td colspan="8" class="sv-empty sv-error">${esc(msg)}<br><button class="btn-ghost btn-xs" data-action="refresh">Try again</button></td></tr>`;
  }

  // ---------------------------------------------------------------- ROI calculator
  function openCalc(target) {
    S.calc = { ...target, amount: 1000, days: 365, compound: true };
    $('calcTitle').textContent = target.title;
    $('calcAmount').value = 1000;
    $('calcCompound').checked = true;
    document.querySelectorAll('#calcDays button').forEach((b) => b.classList.toggle('on', Number(b.dataset.days) === 365));
    updateCalc();
    $('calcModal').classList.add('open');
    setTimeout(() => $('calcAmount').focus(), 50);
  }

  function updateCalc() {
    const c = S.calc;
    if (!c) return;
    c.amount = Math.max(0, parseFloat($('calcAmount').value) || 0);
    c.compound = $('calcCompound').checked;
    const growth = c.compound ? Math.pow(1 + c.apr / 365, c.days) - 1 : (c.apr * c.days) / 365;
    const earned = c.amount * growth;
    $('calcEarn').textContent = fmtUsd(earned, false);
    $('calcRoi').textContent = `ROI ${fmtPct(growth)} in ${c.days === 365 ? '1 year' : c.days + (c.days === 1 ? ' day' : ' days')} · ${c.compound ? 'compounded daily' : 'simple (no reinvest)'}`;
    $('calcRates').innerHTML = `APR <b>${fmtPct(c.apr)}</b> · APY <b>${fmtPct(aprToApy(c.apr))}</b>`;
    $('calcNote').textContent = `Based on LP fees from the last ${c.basis === '24h' ? '24 hours' : '7 days'}. Excludes impermanent loss and price changes of the pooled tokens. Past volume does not guarantee future returns.`;
  }

  // ---------------------------------------------------------------- wallet
  function openWalletModal() {
    const list = $('walletList');
    list.innerHTML = '';
    (window.WALLET_CONFIG || []).forEach((w) => {
      const installed = !!w.check();
      const btn = document.createElement('button');
      btn.className = 'wallet-btn';
      btn.innerHTML = `<div class="wallet-info"><img src="${esc(w.icon)}" alt="" style="width:32px;height:32px;object-fit:contain"><span style="margin-left:8px;font-weight:600">${esc(w.name)}</span></div>${installed ? '<span style="color:var(--success);font-size:1.2rem">›</span>' : '<span class="wallet-badge">Install</span>'}`;
      btn.onclick = async () => {
        if (!installed) { window.open(w.installUrl, '_blank'); return; }
        S.walletProvider = w.getProvider();
        closeModal('walletModal');
        await connectWallet();
      };
      list.appendChild(btn);
    });
    if (!list.children.length) list.innerHTML = '<div class="sv-muted" style="padding:12px">No wallet detected. Install MetaMask or a compatible EVM wallet.</div>';
    $('walletModal').classList.add('open');
  }

  function closeModal(id) { $(id)?.classList.remove('open'); }

  async function connectWallet() {
    const eth = S.walletProvider || window.ethereum;
    if (!eth) { openWalletModal(); return; }
    try {
      const bp = new ethers.BrowserProvider(eth);
      await bp.send('eth_requestAccounts', []);
      S.user = await (await bp.getSigner()).getAddress();
      window.SessionManager?.save();
      const chainId = (await bp.getNetwork()).chainId.toString();
      const net = Object.values(S.networks).find((n) => n.chainId === chainId && n.enabled);
      if (net && net.chainId !== S.active?.chainId) selectNetwork(net.chainId, false);
      renderWallet();
      eth.on?.('accountsChanged', () => window.location.reload());
      eth.on?.('chainChanged', () => window.location.reload());
      toast('Wallet connected', 'success');
      await loadAll({ silent: true });
    } catch (e) {
      console.error('[analytics-pro] connect failed', e);
      toast(e?.code === 4001 ? 'Connection rejected' : 'Could not connect wallet', 'error');
    }
  }

  function renderWallet() {
    const btn = $('btnConnect');
    if (!btn) return;
    if (S.user) {
      btn.className = 'btn-connected';
      btn.innerHTML = `${short(S.user)} <span style="font-size:0.7em;margin-left:6px">▼</span>`;
      $('dropdownAddress').textContent = short(S.user);
    } else {
      btn.className = 'btn-primary';
      btn.textContent = 'Connect Wallet';
    }
  }

  // ---------------------------------------------------------------- network
  function initNetworkSelect() {
    const sel = $('networkSelect');
    sel.innerHTML = '';
    Object.values(S.networks).filter((n) => n.enabled).forEach((n) => {
      const o = document.createElement('option');
      o.value = n.chainId; o.textContent = n.label;
      sel.appendChild(o);
    });
    sel.onchange = () => selectNetwork(sel.value, true);
  }

  function selectNetwork(chainId, reload) {
    const net = Object.values(S.networks).find((n) => n.chainId == chainId && n.enabled);
    if (!net) return;
    S.active = net;
    $('networkSelect').value = net.chainId;
    try { localStorage.setItem('SV_ANALYTICS_PRO_CHAIN', net.chainId); } catch (e) { /* ignore */ }
    const url = new URL(window.location.href);
    url.searchParams.set('chain', net.chainId);
    history.replaceState(null, '', url);
    if (!reload) return;
    S.pools = []; S.daily = []; S.dailyTx = []; S.totals = null;
    if (loadCache()) renderAll(); else renderSkeleton();
    loadAll();
  }

  async function detectInitialChain() {
    const q = new URLSearchParams(location.search).get('chain');
    if (q && Object.values(S.networks).some((n) => n.chainId == q && n.enabled)) return q;
    if (window.ethereum) {
      try {
        const hex = await window.ethereum.request({ method: 'eth_chainId' });
        const n = Object.values(S.networks).find((x) => parseInt(x.chainId) === parseInt(hex, 16) && x.enabled);
        if (n) return n.chainId;
      } catch (e) { /* ignore */ }
    }
    const saved = localStorage.getItem('SV_ANALYTICS_PRO_CHAIN');
    if (saved && Object.values(S.networks).some((n) => n.chainId == saved && n.enabled)) return saved;
    return Object.values(S.networks).find((n) => n.enabled)?.chainId;
  }

  // ---------------------------------------------------------------- events
  function bindUI() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      const dd = $('accountDropdown');
      if (dd?.classList.contains('show') && !e.target.closest('#btnConnect')) dd.classList.remove('show');
      if (e.target.classList?.contains('modal-overlay')) e.target.classList.remove('open');
      if (!t) return;
      const a = t.dataset.action;
      if (a === 'connect') openWalletModal();
      if (a === 'refresh') { renderSkeleton(); loadAll(); }
      if (a === 'close') closeModal(t.dataset.target);
      if (a === 'calc') {
        const p = S.pools[Number(t.dataset.i)];
        if (p && p.tvl > 0) openCalc({ title: `${p.t0.symbol} / ${p.t1.symbol} LP`, apr: aprOf(p), basis: S.aprBasis });
      }
    });

    $('btnConnect').onclick = (e) => {
      e.stopPropagation();
      if (S.user) $('accountDropdown').classList.toggle('show');
      else openWalletModal();
    };
    $('btnCopyAddress').onclick = () => { if (S.user) { navigator.clipboard.writeText(S.user); toast('Address copied'); } };
    $('btnViewExplorer').onclick = () => { const b = explorerBase(); if (b && S.user) window.open(`${b}/address/${S.user}`, '_blank'); };
    $('btnDisconnect').onclick = () => { window.SessionManager?.clear(); window.location.reload(); };

    document.querySelectorAll('#svPoolsTable th[data-sort]').forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.sort;
        S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (k === 'pair' ? 1 : -1) };
        renderPools();
      };
    });

    let timer;
    $('svSearch').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { S.filter = e.target.value; renderPools(); }, 120); };
    $('svOnlyMine').onchange = (e) => {
      if (e.target.checked && !S.user) { e.target.checked = false; openWalletModal(); return; }
      S.onlyMine = e.target.checked; renderPools();
    };
    document.querySelectorAll('#svBasis button').forEach((b) => {
      b.onclick = () => {
        S.aprBasis = b.dataset.basis;
        document.querySelectorAll('#svBasis button').forEach((x) => x.classList.toggle('on', x === b));
        renderPools();
      };
    });

    $('calcAmount').oninput = updateCalc;
    $('calcCompound').onchange = updateCalc;
    document.querySelectorAll('#calcDays button').forEach((b) => {
      b.onclick = () => {
        S.calc.days = Number(b.dataset.days);
        document.querySelectorAll('#calcDays button').forEach((x) => x.classList.toggle('on', x === b));
        updateCalc();
      };
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach((m) => m.classList.remove('open'));
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); $('svSearch').focus(); }
    });
  }

  // ---------------------------------------------------------------- boot
  document.addEventListener('DOMContentLoaded', async () => {
    bindUI();
    try {
      S.networks = await window.loadNetworks();
    } catch (e) {
      renderError('Network configuration (networks.json) could not be loaded.');
      setSync('Config error', 'danger');
      return;
    }
    await loadTokenList();
    initNetworkSelect();
    selectNetwork(await detectInitialChain(), false);

    if (loadCache()) {
      renderAll();
      if (Date.now() - S.updatedAt < CFG.CACHE_TTL_MS) setSync('Cached · refreshing', 'warning');
    } else {
      renderSkeleton();
    }

    if (window.SessionManager?.isActive() && window.checkAutoConnect) {
      await window.checkAutoConnect(connectWallet);
    }
    if (!S.user) loadAll();

    setInterval(() => { if (!document.hidden) loadAll({ silent: true }); }, CFG.AUTO_REFRESH_MS);
  });
})();
