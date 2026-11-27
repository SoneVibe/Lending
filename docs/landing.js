/**
 * landing.js v3 — SoneVibe home page.
 * BNB Chain is the main network; Arbitrum One also runs the DEX.
 * Every number is read from public RPC endpoints in the visitor's browser.
 * Reuses config.js (loadNetworks), networks.json and token-list.json.
 */
(() => {
  'use strict';

  const FLAGSHIP = '56';
  const ORDER = ['56', '42161'];

  // `rpcs` are tried after the ones in networks.json. `logs` lists the endpoints that serve
  // eth_getLogs, in order: the first one that answers is used, the next ones are fallbacks.
  // bsc-dataseed refuses eth_getLogs, so swap history needs its own endpoints on BNB Chain.
  const CHAINS = {
    '56': {
      name: 'BNB Chain', color: '#f3ba2f', icon: 'icons/bnb.png', stables: ['usd1'],
      rpcs: ['https://bsc-dataseed.bnbchain.org', 'https://bsc-rpc.publicnode.com'],
      logs: [
        { url: 'https://bsc-mainnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3', chunk: 49000 },
        { url: 'https://bsc-rpc.publicnode.com', chunk: 9000 },
        { url: 'https://bsc.api.pocket.network', chunk: 4500 },
      ],
    },
    '42161': {
      name: 'Arbitrum One', color: '#28a0f0', icon: 'icons/arbitrum.png',
      rpcs: ['https://arbitrum-one.publicnode.com'],
      logs: [{ url: 'https://arb1.arbitrum.io/rpc', chunk: 400000 }],
    },
  };

  const CFG = {
    SWAP_FEE: 0.0025,
    LP_FEE_SHARE: 5 / 6,
    STABLES: ['usdc', 'usdt', 'usdsc', 'dai', 'usds', 'fdusd'],
    CACHE_KEY: 'SV_LANDING_V3',
    CACHE_MAX_AGE: 24 * 3600e3,
    READ_TIMEOUT: 7000,
    LOG_TIMEOUT: 6000,
    LOG_BUDGET: 25000,
    LOG_CONCURRENCY: 4,
    MIN_LOG_CHUNK: 2000,
    BLOCK_SAMPLE: 20000,
    REFRESH_MS: 120000,
    MIN_POOL_TVL: 1,
  };

  const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
  const SWAP_TOPIC = ethers.id('Swap(address,uint256,uint256,uint256,uint256,address)');
  const I = {
    multicall: new ethers.Interface(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])']),
    factory: new ethers.Interface(['function allPairsLength() view returns (uint256)', 'function allPairs(uint256) view returns (address)']),
    pair: new ethers.Interface(['function token0() view returns (address)', 'function token1() view returns (address)', 'function getReserves() view returns (uint112, uint112, uint32)']),
    erc20: new ethers.Interface(['function symbol() view returns (string)', 'function decimals() view returns (uint8)']),
  };
  const coder = ethers.AbiCoder.defaultAbiCoder();

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');
  const chainOf = (id) => CHAINS[id] || { name: `Chain ${id}`, color: '#64748b', icon: 'icons/token.svg', rpcs: [], logs: [] };
  const hex = (n) => '0x' + n.toString(16);

  function fmtUsd(n) {
    if (!isFinite(n)) return '—';
    if (n === 0) return '$0';
    if (n < 0.01) return '<$0.01';
    if (n >= 1e4) return '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtNum(n) {
    if (!isFinite(n) || n <= 0) return '—';
    if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
    return n.toLocaleString('en-US', { maximumSignificantDigits: 4 });
  }
  const fmtInt = (n) => (isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
  const fmtPct = (n) => (!isFinite(n) ? '—' : n * 100 >= 10000 ? '>10,000%' : (n * 100).toFixed(2) + '%');
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  async function pool(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
    }));
    return out;
  }

  // ---------- JSON-RPC transport: every request has a timeout, every chain has fallbacks ----------
  async function rpcCall(url, method, params, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message || 'RPC error');
      if (json.result === undefined || json.result === null) throw new Error('Empty RPC result');
      return json.result;
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? `timeout after ${ms} ms` : e.message);
    } finally {
      clearTimeout(timer);
    }
  }

  // Reads go to the endpoint that answered first; if it fails later, the others are tried in turn.
  function makeReader(urls) {
    let order = [...urls];
    const call = async (method, params) => {
      let last;
      for (const url of order) {
        try {
          const result = await rpcCall(url, method, params, CFG.READ_TIMEOUT);
          if (order[0] !== url) order = [url, ...order.filter((u) => u !== url)];
          return result;
        } catch (e) { last = e; }
      }
      throw last || new Error('No RPC endpoint configured');
    };
    const head = async () => {
      const winner = await Promise.any(order.map((url) =>
        rpcCall(url, 'eth_blockNumber', [], CFG.READ_TIMEOUT).then((r) => ({ url, block: parseInt(r, 16) }))));
      order = [winner.url, ...order.filter((u) => u !== winner.url)];
      return winner.block;
    };
    return { call, head };
  }

  // One eth_call for many reads. A failed inner call comes back as null.
  async function multicall(reader, calls) {
    if (!calls.length) return [];
    const data = I.multicall.encodeFunctionData('aggregate3', [calls.map((c) => ({
      target: c.target, allowFailure: true, callData: c.iface.encodeFunctionData(c.fn, c.args || []),
    }))]);
    const raw = await reader.call('eth_call', [{ to: MULTICALL3, data }, 'latest']);
    const [results] = I.multicall.decodeFunctionResult('aggregate3', raw);
    return results.map((r, i) => {
      if (!r.success || r.returnData === '0x') return null;
      try { return calls[i].iface.decodeFunctionResult(calls[i].fn, r.returnData); } catch (e) { return null; }
    });
  }

  // Swap logs from block `from` to the head. A range the endpoint rejects is split in half and
  // retried; if an endpoint keeps failing, the next one in the list takes over from scratch.
  // The newest range ends at the "latest" tag instead of a block number: endpoints sit a few
  // blocks apart, and asking one for a block it has not seen yet is an error.
  async function fetchSwapLogs(sources, addresses, from, to) {
    const deadline = Date.now() + CFG.LOG_BUDGET;
    let last;
    for (const src of sources) {
      const getRange = async (a, b, open) => {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error('log budget exhausted');
        try {
          return await rpcCall(src.url, 'eth_getLogs', [{ address: addresses, topics: [SWAP_TOPIC], fromBlock: hex(a), toBlock: open ? 'latest' : hex(b) }], Math.min(CFG.LOG_TIMEOUT, left));
        } catch (e) {
          if (b - a < CFG.MIN_LOG_CHUNK || /timeout|HTTP 4|HTTP 5|Failed to fetch|NetworkError|budget/i.test(e.message)) throw e;
          const mid = Math.floor((a + b) / 2);
          const halves = await Promise.all([getRange(a, mid, false), getRange(mid + 1, b, open)]);
          return halves.flat();
        }
      };
      const ranges = [];
      for (let a = from; a <= to; a += src.chunk) ranges.push([a, Math.min(to, a + src.chunk - 1)]);
      try {
        // Newest range first: a dead endpoint fails here before the rest is queued.
        const newest = ranges.pop();
        const tail = await getRange(newest[0], newest[1], true);
        const rest = await pool(ranges, CFG.LOG_CONCURRENCY, ([a, b]) => getRange(a, b, false));
        return [...rest.flat(), ...tail];
      } catch (e) {
        last = e;
        console.warn(`[landing] swap history from ${new URL(src.url).host} failed: ${e.message}`);
        if (Date.now() >= deadline) break;
      }
    }
    throw last || new Error('No log endpoint configured');
  }

  // ---------- state ----------
  const state = { nets: {}, results: {}, pending: new Set(), failed: new Set(), tokenList: {}, booted: false };

  function saveCache() {
    try {
      const chains = {};
      for (const [id, r] of Object.entries(state.results)) {
        chains[id] = { ...r, logsPending: false, pairs: [...r.pairs].sort((a, b) => b.tvl - a.tvl).slice(0, 8) };
      }
      localStorage.setItem(CFG.CACHE_KEY, JSON.stringify({ ts: Date.now(), chains }));
    } catch (e) { /* storage full or private mode */ }
  }

  function paintFromCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG.CACHE_KEY) || 'null');
      if (!c || !c.chains) return;
      for (const [id, r] of Object.entries(c.chains)) {
        if (!r || !Array.isArray(r.pairs) || Date.now() - r.ts > CFG.CACHE_MAX_AGE) continue;
        // A read that ended without swap history is shown as loading again, not as a failure.
        state.results[id] = { ...r, cached: true, logsPending: !!r.logsTried && !r.logsOk };
      }
      if (Object.keys(state.results).length) render();
    } catch (e) { /* no usable cache */ }
  }

  // ---------- on-chain read of one DEX ----------
  async function scanChain(net) {
    const id = net.chainId;
    const meta = chainOf(id);
    const urls = [...new Set([...(net.rpcUrls || []), ...(meta.rpcs || [])].map((u) => u.replace(/\/$/, '')))];
    const reader = makeReader(urls);
    const stables = [...CFG.STABLES, ...(meta.stables || [])];
    const isStable = (s) => stables.some((x) => (s || '').toLowerCase().startsWith(x));

    const latest = await reader.head();

    // Pair list: the length plus the first 16 slots in one call; out-of-range slots revert and are dropped.
    const FIRST = 16;
    const firstBatch = await multicall(reader, [
      { target: net.factory, iface: I.factory, fn: 'allPairsLength' },
      ...Array.from({ length: FIRST }, (_, i) => ({ target: net.factory, iface: I.factory, fn: 'allPairs', args: [i] })),
    ]);
    if (!firstBatch[0]) throw new Error('factory.allPairsLength() failed');
    const len = Number(firstBatch[0][0]);
    const addrs = firstBatch.slice(1, 1 + Math.min(len, FIRST)).map((r) => r && r[0]).filter(Boolean);
    for (let start = FIRST; start < len; start += 100) {
      const more = await multicall(reader, Array.from({ length: Math.min(100, len - start) }, (_, i) => ({ target: net.factory, iface: I.factory, fn: 'allPairs', args: [start + i] })));
      more.forEach((r) => { if (r) addrs.push(r[0]); });
    }

    const pairReads = await multicall(reader, addrs.flatMap((a) => [
      { target: a, iface: I.pair, fn: 'token0' },
      { target: a, iface: I.pair, fn: 'token1' },
      { target: a, iface: I.pair, fn: 'getReserves' },
    ]));
    const rawPairs = addrs.map((address, i) => {
      const [t0, t1, res] = pairReads.slice(i * 3, i * 3 + 3);
      return t0 && t1 && res ? { address, a0: t0[0], a1: t1[0], r0: res[0], r1: res[1] } : null;
    }).filter(Boolean);

    // Token metadata: token-list.json first, the chain for anything not listed.
    const tokens = {};
    const unknown = [];
    rawPairs.forEach((p) => [p.a0, p.a1].forEach((a) => {
      const k = a.toLowerCase();
      if (tokens[k]) return;
      const listed = state.tokenList[`${id}:${k}`];
      tokens[k] = listed
        ? { address: a, symbol: String(listed.symbol).slice(0, 12), decimals: Number(listed.decimals), logo: listed.logoURI || 'icons/token.svg' }
        : (unknown.push(a), { address: a, symbol: 'UNK', decimals: 18, logo: 'icons/token.svg' });
    }));
    if (unknown.length) {
      const metaReads = await multicall(reader, unknown.flatMap((a) => [
        { target: a, iface: I.erc20, fn: 'symbol' },
        { target: a, iface: I.erc20, fn: 'decimals' },
      ])).catch(() => []);
      unknown.forEach((a, i) => {
        const t = tokens[a.toLowerCase()];
        const [sym, dec] = [metaReads[i * 2], metaReads[i * 2 + 1]];
        if (sym) t.symbol = String(sym[0]).slice(0, 12);
        if (dec) t.decimals = Number(dec[0]);
      });
    }

    const pairs = rawPairs.map((p) => {
      const t0 = tokens[p.a0.toLowerCase()], t1 = tokens[p.a1.toLowerCase()];
      return { address: p.address, chainId: id, t0, t1, r0: parseFloat(ethers.formatUnits(p.r0, t0.decimals)), r1: parseFloat(ethers.formatUnits(p.r1, t1.decimals)) };
    });

    // Prices: stablecoins at $1, everything else derived from pool reserves.
    const prices = {};
    Object.entries(tokens).forEach(([k, t]) => { if (isStable(t.symbol)) prices[k] = 1; });
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
      const stable0 = isStable(p.t0.symbol), stable1 = isStable(p.t1.symbol);
      // Quote the pool in its stablecoin when it has one: "1 ETH = 1,650 USDT".
      const quoteIs0 = stable0 && !stable1;
      Object.assign(p, {
        p0, p1,
        tvl: p0 && p1 ? p.r0 * p0 + p.r1 * p1 : p0 ? p.r0 * p0 * 2 : p1 ? p.r1 * p1 * 2 : 0,
        base: quoteIs0 ? p.t1.symbol : p.t0.symbol,
        quote: quoteIs0 ? p.t0.symbol : p.t1.symbol,
        price: quoteIs0 ? (p.r1 > 0 ? p.r0 / p.r1 : 0) : (p.r0 > 0 ? p.r1 / p.r0 : 0),
        icons: quoteIs0 ? [p.t1.logo, p.t0.logo] : [p.t0.logo, p.t1.logo],
        vol24h: 0, tx24h: 0, apr: 0,
      });
    });

    const hasLogs = !!(meta.logs && meta.logs.length && pairs.length);
    const prev = state.results[id];
    const result = {
      chainId: id, latest, ts: Date.now(), pairs, pairCount: pairs.length,
      tvl: pairs.reduce((a, p) => a + p.tvl, 0),
      vol24h: 0, txs: 0, activePools: 0, logsOk: false, logsPending: hasLogs, logsTried: hasLogs,
    };
    // While swap history is being read, keep the previous figures instead of dropping to zero.
    if (prev && prev.logsOk && hasLogs) {
      Object.assign(result, { vol24h: prev.vol24h, txs: prev.txs, activePools: prev.activePools, logsOk: true });
      const old = Object.fromEntries((prev.pairs || []).map((p) => [p.address.toLowerCase(), p]));
      pairs.forEach((p) => { const o = old[p.address.toLowerCase()]; if (o) Object.assign(p, { vol24h: o.vol24h, tx24h: o.tx24h, apr: p.tvl >= CFG.MIN_POOL_TVL ? o.apr : 0 }); });
    }
    state.results[id] = result;
    render();

    if (hasLogs) {
      try {
        // Blocks in the last 24 h, measured from two block timestamps (block time changes with hard forks).
        let blocksPerDay = Math.round((Number(net.blocksPerYear) || 31536000) / 365);
        try {
          const [now, past] = await Promise.all([
            reader.call('eth_getBlockByNumber', [hex(latest), false]),
            reader.call('eth_getBlockByNumber', [hex(latest - CFG.BLOCK_SAMPLE), false]),
          ]);
          const secs = parseInt(now.timestamp, 16) - parseInt(past.timestamp, 16);
          if (secs > 0) blocksPerDay = Math.round((86400 * CFG.BLOCK_SAMPLE) / secs);
        } catch (e) { /* keep the configured estimate */ }

        const logs = await fetchSwapLogs(meta.logs, pairs.map((p) => p.address), Math.max(0, latest - blocksPerDay), latest);
        const byAddr = Object.fromEntries(pairs.map((p) => [p.address.toLowerCase(), p]));
        pairs.forEach((p) => { p.vol24h = 0; p.tx24h = 0; });
        for (const log of logs) {
          const p = byAddr[String(log.address).toLowerCase()];
          if (!p) continue;
          const [in0, in1, out0, out1] = coder.decode(['uint256', 'uint256', 'uint256', 'uint256'], log.data);
          const v0 = parseFloat(ethers.formatUnits(in0 + out0, p.t0.decimals)) * p.p0;
          const v1 = parseFloat(ethers.formatUnits(in1 + out1, p.t1.decimals)) * p.p1;
          p.vol24h += v0 && v1 ? (v0 + v1) / 2 : v0 || v1;
          p.tx24h++;
        }
        const lpFee = CFG.SWAP_FEE * CFG.LP_FEE_SHARE;
        pairs.forEach((p) => { p.apr = p.tvl >= CFG.MIN_POOL_TVL ? (p.vol24h * lpFee * 365) / p.tvl : 0; });
        Object.assign(result, {
          logsOk: true, logsPending: false,
          vol24h: pairs.reduce((a, p) => a + p.vol24h, 0),
          txs: logs.length,
          activePools: pairs.filter((p) => p.tx24h > 0).length,
        });
      } catch (e) {
        console.warn(`[landing] ${meta.name}: swap history unavailable`, e);
        pairs.forEach((p) => { p.vol24h = 0; p.tx24h = 0; p.apr = 0; });
        Object.assign(result, { logsOk: false, logsPending: false, vol24h: 0, txs: 0, activePools: 0 });
      }
    }

    result.ts = Date.now();
    return result;
  }

  // ---------- render ----------
  const orderedChains = () => ORDER.filter((id) => state.nets[id] || state.results[id]);
  const pairIcons = (p) => (p.icons || [p.t0.logo, p.t1.logo]).map((src) => `<img src="${esc(src)}" alt="" width="32" height="32" onerror="this.onerror=null;this.src='icons/token.svg'">`).join('');
  // null = still loading, '—' = read failed.
  const volCell = (r, value) => (!r ? null : r.logsOk ? value : r.logsPending ? null : '—');

  function setStat(id, value, sub) {
    const el = $(id);
    if (!el) return;
    el.classList.toggle('loading', value === null);
    el.querySelector('.v').textContent = value === null ? '—' : value;
    el.querySelector('.s').textContent = sub || '';
  }

  function render() {
    const ids = orderedChains();
    const res = ids.map((id) => state.results[id]).filter(Boolean);
    const busy = state.pending.size > 0;
    const flag = state.results[FLAGSHIP];

    // Totals wait for the main network: a headline figure never shows a sum that is missing it
    // without saying so.
    const flagLoading = !flag && (state.pending.has(FLAGSHIP) || !state.booted);
    const down = state.booted ? ids.filter((id) => !state.results[id] && !state.pending.has(id)).map((id) => chainOf(id).name) : [];
    const downNote = down.length ? ` · ${down.join(', ')} unavailable` : '';
    const stats = ['stTvl', 'stVol', 'stSwaps', 'stPairs'];

    if (flagLoading) {
      stats.forEach((s) => setStat(s, null));
    } else if (!res.length) {
      stats.forEach((s) => setStat(s, '—', 'Networks unavailable right now'));
    } else {
      const tvl = res.reduce((a, r) => a + r.tvl, 0);
      setStat('stTvl', fmtUsd(tvl), res.filter((r) => r.tvl >= 0.01).map((r) => `${chainOf(r.chainId).name} ${fmtUsd(r.tvl)}`).join(' · ') + downNote);
      const withPairs = res.filter((r) => r.pairCount).length;
      setStat('stPairs', fmtInt(res.reduce((a, r) => a + r.pairCount, 0)), `On ${withPairs} network${withPairs === 1 ? '' : 's'}${downNote}`);

      const ok = res.filter((r) => r.logsOk);
      const noHistory = [...res.filter((r) => r.logsTried && !r.logsOk && !r.logsPending).map((r) => chainOf(r.chainId).name), ...down];
      const historyNote = noHistory.length ? ` · ${noHistory.join(', ')} unavailable` : '';
      if (flag && flag.logsOk) {
        setStat('stVol', fmtUsd(ok.reduce((a, r) => a + r.vol24h, 0)), ok.map((r) => `${chainOf(r.chainId).name} ${fmtUsd(r.vol24h)}`).join(' · ') + historyNote);
        const swaps = ok.reduce((a, r) => a + r.txs, 0);
        const active = ok.reduce((a, r) => a + (r.activePools || 0), 0);
        setStat('stSwaps', fmtInt(swaps), (swaps ? `In ${active} pool${active === 1 ? '' : 's'}` : 'No swaps in the last 24 hours') + historyNote);
      } else if (flag && flag.logsPending) {
        setStat('stVol', null); setStat('stSwaps', null);
      } else {
        const why = `${chainOf(FLAGSHIP).name} swap history unavailable right now`;
        setStat('stVol', '—', why); setStat('stSwaps', '—', why);
      }
    }

    if (flag && flag.latest && $('liveBlock')) $('liveBlock').textContent = `Block ${flag.latest.toLocaleString('en-US')}`;
    renderHeroPool(flag, busy);
    renderNetworkCards(ids);
    renderTopPools(res, busy);

    const status = $('liveUpdated');
    if (status) {
      const newest = Math.max(0, ...res.map((r) => r.ts || 0));
      if (busy) status.textContent = res.length ? `Updating… last read ${fmtTime(newest)}` : 'Reading the chain…';
      else if (!state.booted) status.textContent = 'Reading the chain…';
      else if (!res.length) status.textContent = 'Live data is unavailable right now. Reload in a minute.';
      else if (state.failed.size) {
        const names = [...state.failed].map((id) => chainOf(id).name).join(', ');
        const stale = [...state.failed].some((id) => state.results[id]);
        status.textContent = `Updated ${fmtTime(newest)} · ${names} unreachable${stale ? ', showing the last read' : ''}`;
      }
      else status.textContent = `Updated ${fmtTime(newest)}`;
    }
  }

  function renderHeroPool(flag, busy) {
    const el = $('heroPool');
    if (!el) return;
    if (!flag) {
      if (state.booted && !state.pending.has(FLAGSHIP)) el.innerHTML = '<div class="lp-empty">BNB Chain could not be read right now. Reload in a minute, or open the app.</div>';
      return;
    }
    const top = [...flag.pairs].filter((p) => p.tvl > 0).sort((a, b) => b.tvl - a.tvl)[0];
    if (!top) { el.innerHTML = '<div class="lp-empty">No pools with liquidity yet.</div>'; return; }
    const c = chainOf(FLAGSHIP);
    const kv = (k, v, cls) => `<div><dt>${k}</dt><dd class="${v === null ? 'lp-mini-skel' : cls || ''}">${v === null ? '&nbsp;' : v}</dd></div>`;
    el.innerHTML = `
      <div class="lp-pc-head">
        <span class="lp-icons lg">${pairIcons(top)}</span>
        <div>
          <b>${esc(top.base)} / ${esc(top.quote)}</b>
          <span class="lp-net" style="--c:${c.color}">${esc(c.name)} · deepest pool</span>
        </div>
        <span class="lp-fee">0.25% fee</span>
      </div>
      <div class="lp-pc-price">
        <span class="lp-k">Pool price</span>
        <strong>${fmtNum(top.price)} <small>${esc(top.quote)}</small></strong>
        <span class="lp-pc-sub">per 1 ${esc(top.base)}</span>
      </div>
      <dl class="lp-pc-grid">
        ${kv('Liquidity', fmtUsd(top.tvl))}
        ${kv('Volume 24h', volCell(flag, fmtUsd(top.vol24h)))}
        ${kv('Swaps 24h', volCell(flag, fmtInt(top.tx24h)))}
        ${kv('Fee APR 24h', volCell(flag, fmtPct(top.apr)), 'accent')}
      </dl>
      <div class="lp-pc-actions">
        <a class="lp-btn primary" href="swap.html">Swap</a>
        <a class="lp-btn ghost" href="pools.html?chain=${esc(FLAGSHIP)}&pair=${esc(top.address)}">Add liquidity</a>
      </div>`;
  }

  function renderNetworkCards(ids) {
    const grid = $('chainGrid');
    if (!grid || !ids.length) return;
    const total = ids.reduce((a, id) => a + (state.results[id]?.tvl || 0), 0);
    grid.innerHTML = ids.map((id) => {
      const c = chainOf(id);
      const r = state.results[id];
      const loading = !r && state.pending.has(id);
      const down = !r && !loading;
      const net = state.nets[id];
      const explorer = (net?.blockExplorerUrls?.[0] || '').replace(/\/$/, '');
      const top = r ? [...r.pairs].filter((p) => p.tvl > 0).sort((a, b) => b.tvl - a.tvl)[0] : null;
      const cell = (k, v) => `<div><dt>${k}</dt><dd class="${v === null ? 'lp-mini-skel' : ''}">${v === null ? '&nbsp;' : v}</dd></div>`;
      const val = (v) => (r ? v : down ? '—' : null);
      const complete = ids.every((x) => state.results[x]);
      const share = r && complete && total > 0 ? `${((r.tvl / total) * 100).toFixed(1)}% of liquidity` : '';
      return `
        <article class="lp-chain${id === FLAGSHIP ? ' flagship' : ''}" style="--c:${c.color}">
          <div class="lp-chain-head">
            <span class="lp-chain-ic"><img src="${esc(c.icon)}" alt="" width="24" height="24" onerror="this.remove()"></span>
            <div><h3>${esc(c.name)}</h3><span class="lp-chain-tag">${id === FLAGSHIP ? 'Main network' : 'DEX'}${share ? ` · ${share}` : ''}</span></div>
            ${id === FLAGSHIP ? '<span class="lp-home">Main</span>' : ''}
          </div>
          <dl class="lp-chain-stats">
            ${cell('Liquidity', val(r && fmtUsd(r.tvl)))}
            ${cell('Pairs', val(r && fmtInt(r.pairCount)))}
            ${cell('Volume 24h', down ? '—' : volCell(r, r && fmtUsd(r.vol24h)))}
            ${cell('Swaps 24h', down ? '—' : volCell(r, r && fmtInt(r.txs)))}
          </dl>
          <p class="lp-chain-top">${top ? `Deepest pool: <b>${esc(top.base)} / ${esc(top.quote)}</b> · ${fmtUsd(top.tvl)}` : loading ? 'Reading pools…' : down ? 'This network could not be read right now.' : 'No pools with liquidity yet.'}</p>
          ${net && isAddr(net.factory) && explorer ? `<a class="lp-chain-link" href="${esc(explorer)}/address/${esc(net.factory)}" target="_blank" rel="noopener">Factory ${short(net.factory)} ↗</a>` : ''}
        </article>`;
    }).join('');
  }

  function renderTopPools(res, busy) {
    const el = $('topPools');
    if (!el) return;
    if (!res.length) {
      if (!busy && state.booted) el.innerHTML = '<div class="lp-empty">Pools could not be read right now. Reload in a minute.</div>';
      return;
    }
    const all = res.flatMap((r) => r.pairs).filter((p) => p.tvl > 0);
    const top = [
      ...all.filter((p) => p.chainId === FLAGSHIP).sort((a, b) => b.tvl - a.tvl).slice(0, 4),
      ...all.filter((p) => p.chainId !== FLAGSHIP).sort((a, b) => b.tvl - a.tvl).slice(0, 2),
    ];
    if (!top.length) { el.innerHTML = '<div class="lp-empty">No pools with liquidity yet.</div>'; return; }
    const cell = (label, v, cls) => `<div class="lp-cell ${cls || ''}" data-label="${label}">${v === null ? '<span class="lp-mini-skel">&nbsp;</span>' : v}</div>`;
    el.innerHTML = `
      <div class="lp-pool lp-pool-head" aria-hidden="true">
        <div>Pool</div><div>Price</div><div>Liquidity</div><div>Volume 24h</div><div>Fee APR 24h</div><div></div>
      </div>` + top.map((p) => {
      const c = chainOf(p.chainId);
      const r = state.results[p.chainId];
      return `
      <a class="lp-pool" href="pools.html?chain=${esc(p.chainId)}&pair=${esc(p.address)}">
        <div class="lp-pool-pair"><span class="lp-icons">${pairIcons(p)}</span><div><b>${esc(p.base)} / ${esc(p.quote)}</b><span class="lp-net" style="--c:${c.color}">${esc(c.name)}</span></div></div>
        ${cell('Price', `${fmtNum(p.price)} <small>${esc(p.quote)}</small>`)}
        ${cell('Liquidity', fmtUsd(p.tvl))}
        ${cell('Volume 24h', volCell(r, fmtUsd(p.vol24h)))}
        ${cell('Fee APR 24h', volCell(r, fmtPct(p.apr)), 'accent')}
        <div class="lp-pool-go" aria-hidden="true">→</div>
      </a>`;
    }).join('');
  }

  function renderContracts() {
    const tabs = $('contractTabs');
    const list = $('contracts');
    if (!tabs || !list) return;
    const ids = ORDER.filter((id) => state.nets[id]);
    if (!ids.length) return;
    let active = ids.includes(FLAGSHIP) ? FLAGSHIP : ids[0];
    const draw = () => {
      const net = state.nets[active];
      const base = (net.blockExplorerUrls?.[0] || '').replace(/\/$/, '');
      const rows = [['DEX Factory', net.factory], ['DEX Router', net.router], ['Wrapped native token', net.swapTokens?.base?.underlyingAddress]].filter(([, a]) => isAddr(a));
      tabs.innerHTML = ids.map((id) => `<button type="button" role="tab" aria-selected="${id === active}" data-chain="${id}">${esc(chainOf(id).name)}</button>`).join('');
      list.innerHTML = rows.map(([name, a]) => `
        <div class="lp-contract">
          <span>${esc(name)}</span>
          <span class="lp-addr">
            <a href="${esc(base)}/address/${esc(a)}" target="_blank" rel="noopener" title="${esc(a)}">${short(a)} ↗</a>
            <button type="button" data-copy="${esc(a)}" aria-label="Copy ${esc(name)} address">Copy</button>
          </span>
        </div>`).join('');
    };
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-chain]');
      if (!b) return;
      active = b.dataset.chain;
      draw();
    });
    list.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-copy]');
      if (!b) return;
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; }
      catch (err) { b.textContent = 'Press Ctrl+C'; }
      setTimeout(() => { b.textContent = 'Copy'; }, 1400);
    });
    draw();
  }

  // ---------- boot ----------
  let running = false;
  async function refresh() {
    if (running) return;
    running = true;
    const nets = Object.values(state.nets);
    nets.forEach((n) => state.pending.add(n.chainId));
    render();
    await Promise.all(nets.map(async (net) => {
      try {
        await scanChain(net);
        state.failed.delete(net.chainId);
      } catch (e) {
        console.warn(`[landing] ${chainOf(net.chainId).name} could not be read`, e);
        state.failed.add(net.chainId);
      } finally {
        state.pending.delete(net.chainId);
        state.booted = true;
        render();
      }
    }));
    state.booted = true;
    running = false;
    render();
    saveCache();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if ($('year')) $('year').textContent = new Date().getFullYear();
    paintFromCache();
    try {
      const [networks, tokens] = await Promise.all([
        window.loadNetworks(),
        fetch('./token-list.json').then((r) => (r.ok ? r.json() : { tokens: [] })).catch(() => ({ tokens: [] })),
      ]);
      Object.values(networks).forEach((n) => { if (n.enabled && CHAINS[n.chainId] && isAddr(n.factory)) state.nets[n.chainId] = n; });
      (tokens.tokens || []).forEach((t) => { state.tokenList[`${t.chainId}:${String(t.address).toLowerCase()}`] = t; });
      renderContracts();
    } catch (e) {
      console.error('[landing] networks.json could not be loaded', e);
      state.booted = true;
      render();
      return;
    }
    await refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, CFG.REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      const newest = Math.max(0, ...Object.values(state.results).map((r) => r.ts || 0));
      if (!document.hidden && Date.now() - newest > CFG.REFRESH_MS) refresh();
    });
  });
})();
