/**
 * docs.js — SoneVibe Docs (propuesta)
 * Rellena la documentación con datos en vivo: redes (networks.json), parámetros del lending,
 * stability module, mercado NFT (market-config.js), contratos y roles de administración.
 * También maneja el índice lateral (scrollspy, búsqueda, menú móvil) y los botones de copiar.
 */
(() => {
  'use strict';

  const FLAGSHIP = '1868';
  const ORDER = ['1868', '56', '592', '420420419', '1946', '420420417'];
  const NAMES = { '1868': 'Soneium', '56': 'BNB Chain', '592': 'Astar', '420420419': 'Polkadot Hub', '1946': 'Soneium Minato', '420420417': 'Polkadot Hub Testnet' };
  const TESTNETS = new Set(['1946', '420420417']);
  const ZERO = '0x0000000000000000000000000000000000000000';

  const ABI = {
    master: ['function oracle() view returns (address)', 'function admin() view returns (address)', 'function closeFactorMantissa() view returns (uint)', 'function liquidationIncentiveMantissa() view returns (uint)', 'function pauseGuardian() view returns (address)'],
    cToken: ['function totalSupply() view returns (uint256)', 'function totalBorrows() view returns (uint256)', 'function exchangeRateStored() view returns (uint256)', 'function reserveFactorMantissa() view returns (uint256)', 'function peekRates() view returns (uint256, uint256)'],
    oracle: ['function getUnderlyingPrice(address) view returns (uint)'],
    psm: ['function feeIn() view returns (uint)', 'function feeOut() view returns (uint)', 'function reserveCap() view returns (uint)', 'function svusd() view returns (address)', 'function reserveAsset() view returns (address)', 'function admin() view returns (address)'],
    erc20: ['function totalSupply() view returns (uint)', 'function decimals() view returns (uint8)', 'function owner() view returns (address)'],
    factory: ['function feeTo() view returns (address)', 'function feeToSetter() view returns (address)'],
    market: ['function feeBasisPoints() view returns (uint)', 'function owner() view returns (address)', 'function treasury() view returns (address)'],
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '') && a !== ZERO;
  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const safe = (p) => p.catch(() => null);
  const pct = (n, d = 2) => `${(n * 100).toFixed(d).replace(/\.?0+$/, '')}%`;

  function fmtUsd(n) {
    if (!isFinite(n)) return '—';
    if (n === 0) return '$0';
    if (n < 0.01) return '<$0.01';
    if (n >= 1e4) return '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const fmtNum = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

  function setLive(key, text) {
    document.querySelectorAll(`[data-live="${key}"]`).forEach((el) => { el.innerHTML = text; el.classList.remove('loading'); });
  }

  function explorerLink(net, a, label) {
    const base = (net?.blockExplorerUrls?.[0] || '').replace(/\/$/, '');
    return `<span class="dc-addr"><a href="${esc(base)}/address/${esc(a)}" target="_blank" rel="noopener"><span class="full">${esc(label || a)}</span><span class="short">${esc(label || short(a))}</span> ↗</a><button type="button" class="dc-copy" data-copy="${esc(a)}" aria-label="Copy address">Copy</button></span>`;
  }

  const provider = (net) => new ethers.JsonRpcProvider(net.rpcUrls[0], undefined, { staticNetwork: true, batchMaxCount: 20 });

  // ---------- redes ----------
  function productsOf(id, net) {
    const out = [];
    if (isAddr(net.factory)) out.push('DEX');
    if (isAddr(net.master) && id !== '420420419' && id !== '56') out.push('Lending');
    if (isAddr(net.stabilityModule) && isAddr(net.master) && id !== '56') out.push('SVUSD');
    if (isAddr(net.masterChef)) out.push('Farms');
    if (window.getMarketConfig && MARKET_CFG[id]) out.push('NFTs');
    return out;
  }
  const MARKET_CFG = {};

  function renderNetworks(nets) {
    const rows = ORDER.filter((id) => nets[id]).map((id) => {
      const n = nets[id];
      const status = TESTNETS.has(id) ? '<span class="tag test">Testnet</span>' : id === FLAGSHIP ? '<span class="tag ok">Mainnet · home</span>' : '<span class="tag ok">Mainnet</span>';
      const ex = (n.blockExplorerUrls?.[0] || '').replace(/\/$/, '');
      return `<tr><td><b>${esc(NAMES[id] || n.label)}</b></td><td class="num">${esc(id)}</td><td>${status}</td><td>${esc(productsOf(id, n).join(' · ') || '—')}</td><td>${ex ? `<a href="${esc(ex)}" target="_blank" rel="noopener">${esc(new URL(ex).host)} ↗</a>` : '—'}</td></tr>`;
    });
    $('netTable').tBodies[0].innerHTML = rows.join('');
  }

  // ---------- contratos ----------
  const extra = {};

  function contractRows(id, net) {
    const rows = [];
    const add = (name, a) => { if (isAddr(a)) rows.push([name, a]); };
    add('DEX Factory', net.factory);
    add('DEX Router', net.router);
    const quote = net.swapTokens?.quote;
    if (quote?.symbol === 'LIGHT') add('LIGHT token', quote.address);
    if (isAddr(net.master) && id !== '56' && id !== '420420419') {
      add('Lending Comptroller', net.master);
      add('Price oracle', extra[id]?.oracle);
      (net.cTokens || []).forEach((m) => add(`Market ${m.symbol || 'c' + m.underlyingSymbol} (${m.underlyingSymbol})`, m.address));
      add('SVUSD Stability Module', net.stabilityModule);
      add('SVUSD token', extra[id]?.svusd);
    }
    add('MasterChef (farms)', net.masterChef);
    (net.sousChefs || []).forEach((s) => add(`Staking pool · ${s.name}`, s.contract));
    (net.farms || []).forEach((f) => add(`Farm LP · ${f.lpSymbol}`, f.lpToken));
    const mk = MARKET_CFG[id];
    if (mk) {
      add('NFT Marketplace', mk.marketplaceAddress);
      add(`NFT payment token (${mk.paymentToken?.symbol})`, mk.paymentToken?.address);
      (mk.collections || []).forEach((c) => add(`Collection · ${c.name.replace(/\s*!.*!\s*/, '')}`, c.address));
    }
    add('Protocol treasury (feeTo)', extra[id]?.feeTo);
    return rows;
  }

  let ctActive = FLAGSHIP;
  function renderContracts(nets) {
    const ids = ORDER.filter((id) => nets[id]);
    if (!ids.includes(ctActive)) ctActive = ids[0];
    $('ctTabs').innerHTML = ids.map((id) => `<button type="button" role="tab" data-chain="${id}" aria-selected="${id === ctActive}">${esc(NAMES[id] || nets[id].label)}</button>`).join('');
    const net = nets[ctActive];
    const rows = contractRows(ctActive, net);
    $('ctTable').tBodies[0].innerHTML = rows.length
      ? rows.map(([name, a]) => `<tr><td>${esc(name)}</td><td>${explorerLink(net, a)}</td></tr>`).join('')
      : '<tr><td colspan="2" class="muted">No contracts configured on this network.</td></tr>';
  }

  // ---------- NFT ----------
  function renderNft(nets, fees) {
    const ids = ORDER.filter((id) => MARKET_CFG[id]);
    $('nftTable').tBodies[0].innerHTML = ids.map((id) => {
      const m = MARKET_CFG[id];
      const cols = (m.collections || []).map((c) => esc(c.name.replace(/\s*!on Maintenance mode!\s*/i, ' (maintenance)'))).join('<br>');
      const fee = fees[id] != null ? pct(fees[id] / 10000) : '<span class="lv loading"></span>';
      return `<tr><td><b>${esc(NAMES[id] || m.label)}</b>${TESTNETS.has(id) ? ' <span class="tag test">Testnet</span>' : ''}</td><td>${esc(m.paymentToken?.symbol || '—')}</td><td class="num">${fee}</td><td>${cols || '—'}</td><td class="muted">${m.indexerType === 'SUBQUERY' ? 'SubQuery' : 'The Graph'}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">No markets configured.</td></tr>';
  }

  // ---------- lectura en vivo ----------
  async function loadSoneium(net) {
    const rpc = provider(net);
    const master = new ethers.Contract(net.master, ABI.master, rpc);
    const psm = isAddr(net.stabilityModule) ? new ethers.Contract(net.stabilityModule, ABI.psm, rpc) : null;
    const factory = new ethers.Contract(net.factory, ABI.factory, rpc);
    const light = net.swapTokens?.quote?.symbol === 'LIGHT' ? new ethers.Contract(net.swapTokens.quote.address, ABI.erc20, rpc) : null;

    const [oracleAddr, admin, cf, li, guardian, feeTo, feeToSetter, feeIn, feeOut, cap, svusdAddr, reserveAsset, psmAdmin, lightSupply, lightOwner] = await Promise.all([
      safe(master.oracle()), safe(master.admin()), safe(master.closeFactorMantissa()), safe(master.liquidationIncentiveMantissa()), safe(master.pauseGuardian()),
      safe(factory.feeTo()), safe(factory.feeToSetter()),
      psm ? safe(psm.feeIn()) : null, psm ? safe(psm.feeOut()) : null, psm ? safe(psm.reserveCap()) : null, psm ? safe(psm.svusd()) : null, psm ? safe(psm.reserveAsset()) : null, psm ? safe(psm.admin()) : null,
      light ? safe(light.totalSupply()) : null, light ? safe(light.owner()) : null,
    ]);
    extra[FLAGSHIP] = { oracle: oracleAddr, svusd: svusdAddr, feeTo };

    if (cf != null) setLive('closeFactor', pct(parseFloat(ethers.formatUnits(cf, 18))));
    if (li != null) setLive('liqIncentive', pct(parseFloat(ethers.formatUnits(li, 18)) - 1));
    if (isAddr(oracleAddr)) setLive('oracle', `<code>${short(oracleAddr)}</code>`);
    if (feeIn != null) setLive('psmFeeIn', pct(Number(feeIn) / 10000));
    if (feeOut != null) setLive('psmFeeOut', pct(Number(feeOut) / 10000));
    if (cap != null && isAddr(reserveAsset)) {
      const dec = await safe(new ethers.Contract(reserveAsset, ABI.erc20, rpc).decimals());
      setLive('psmCap', `${fmtNum(parseFloat(ethers.formatUnits(cap, Number(dec ?? 6))))} USDC`);
    }
    if (isAddr(svusdAddr)) {
      const s = await safe(new ethers.Contract(svusdAddr, ABI.erc20, rpc).totalSupply());
      if (s != null) setLive('svusdSupply', `${fmtNum(parseFloat(ethers.formatUnits(s, 18)))} SVUSD`);
    }
    if (lightSupply != null) setLive('lightSupply', `${fmtNum(parseFloat(ethers.formatUnits(lightSupply, 18)))} LIGHT`);

    // Mercados de lending (misma convención que markets.js)
    const oracle = isAddr(oracleAddr) ? new ethers.Contract(oracleAddr, ABI.oracle, rpc) : null;
    const bpy = Number(net.blocksPerYear) || 15768000;
    const stable = (s) => /^(usdc|usdt|usdsc|svusd|dai)/i.test(s || '');
    const markets = await Promise.all((net.cTokens || []).map(async (m) => {
      const c = new ethers.Contract(m.address, ABI.cToken, rpc);
      const [ts, tb, er, rf, rates, px] = await Promise.all([safe(c.totalSupply()), safe(c.totalBorrows()), safe(c.exchangeRateStored()), safe(c.reserveFactorMantissa()), safe(c.peekRates()), oracle ? safe(oracle.getUnderlyingPrice(m.address)) : null]);
      const price = px && px > 0n ? parseFloat(ethers.formatUnits(px, 18)) : stable(m.underlyingSymbol) ? 1 : 0;
      const suppliedTok = ts != null && er != null ? parseFloat(ethers.formatUnits(ts * er, 36)) : NaN;
      const borrowedTok = tb != null ? parseFloat(ethers.formatUnits(tb, Number(m.underlyingDecimals ?? 18))) : NaN;
      const util = suppliedTok > 0 ? borrowedTok / suppliedTok : 0;
      const borrowApr = rates ? parseFloat(ethers.formatUnits(rates[0], 18)) * bpy : NaN;
      const supplyApr = rates ? parseFloat(ethers.formatUnits(rates[1], 18)) * bpy : NaN;
      return { m, price, suppliedTok, borrowedTok, util, borrowApr, supplyApr, rf };
    }));
    const rf = markets.find((x) => x.rf != null)?.rf;
    if (rf != null) setLive('reserveFactor', pct(parseFloat(ethers.formatUnits(rf, 18))));
    $('lendTable').tBodies[0].innerHTML = markets.map((x) => `
      <tr>
        <td><b>${esc(x.m.underlyingSymbol)}</b></td>
        <td class="num">${fmtNum(x.suppliedTok)} <span class="muted">${x.price ? fmtUsd(x.suppliedTok * x.price) : ''}</span></td>
        <td class="num">${fmtNum(x.borrowedTok)} <span class="muted">${x.price ? fmtUsd(x.borrowedTok * x.price) : ''}</span></td>
        <td class="num">${isFinite(x.util) ? pct(x.util) : '—'}</td>
        <td class="num">${isFinite(x.supplyApr) ? pct(x.supplyApr) : '—'}</td>
        <td class="num">${isFinite(x.borrowApr) ? pct(x.borrowApr) : '—'}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No markets.</td></tr>';

    // Marketplace
    const mk = MARKET_CFG[FLAGSHIP];
    const market = mk && isAddr(mk.marketplaceAddress) ? new ethers.Contract(mk.marketplaceAddress, ABI.market, rpc) : null;
    const [nftFee, mkOwner] = market ? await Promise.all([safe(market.feeBasisPoints()), safe(market.owner())]) : [null, null];

    const roles = [
      { role: 'Lending admin (Comptroller)', addr: admin, can: 'List markets, set collateral factors, close factor, liquidation incentive, oracle and interest-rate models; pause actions.' },
      { role: 'Pause guardian', addr: guardian, can: 'Pause mint, borrow, transfer or liquidation.', emptyText: 'Not set — only the admin can pause' },
      { role: 'DEX fee setter (Factory)', addr: feeToSetter, can: 'Choose the treasury address for the 1/6 protocol fee, open or close pair creation, and use the factory\'s emergency rescue functions on pair balances.' },
      { role: 'SVUSD Stability Module admin', addr: psmAdmin, can: 'Change mint/redeem fees and the USDC reserve cap.' },
      { role: 'LIGHT token owner', addr: lightOwner, can: 'Mint LIGHT up to the 1B max supply. Will be transferred to the MasterChef when farms launch.' },
      { role: 'NFT Marketplace owner', addr: mkOwner, can: 'Set the market fee and treasury, pause the market, upgrade the implementation (UUPS proxy).' },
    ];
    return { rpc, roles, nftFee, feeToSetter };
  }

  async function renderAdmin(nets, soneium) {
    const lines = [];
    const kinds = {};
    // EIP-7702: una EOA delegada tiene código 0xef0100 + dirección, pero sigue controlada por una sola clave.
    const classify = (code) => (code == null ? null : code === '0x' ? 'eoa' : code.toLowerCase().startsWith('0xef0100') ? 'eoa7702' : 'contract');
    const kindOf = async (rpc, a) => {
      if (!isAddr(a)) return null;
      if (kinds[a] !== undefined) return kinds[a];
      return (kinds[a] = classify(await safe(rpc.getCode(a))));
    };
    const typeTag = (k) => (k === 'eoa' ? '<span class="tag eoa">Wallet (EOA)</span>'
      : k === 'eoa7702' ? '<span class="tag eoa" title="EOA with an EIP-7702 smart-account delegation; still controlled by one key">Wallet (EOA · 7702)</span>'
      : k === 'contract' ? '<span class="tag ctr">Contract</span>' : '<span class="muted">—</span>');

    if (soneium) {
      const net = nets[FLAGSHIP];
      for (const r of soneium.roles) {
        const k = await kindOf(soneium.rpc, r.addr);
        const who = isAddr(r.addr) ? explorerLink(net, r.addr, short(r.addr)) : `<span class="muted">${esc(r.emptyText || '—')}</span>`;
        lines.push(`<tr><td><b>${esc(r.role)}</b><br><span class="muted">Soneium</span></td><td>${who}</td><td>${isAddr(r.addr) ? typeTag(k) : ''}</td><td>${esc(r.can)}</td></tr>`);
      }
    }
    // DEX en otras redes: mismo rol de feeToSetter
    const others = await Promise.all(ORDER.filter((id) => id !== FLAGSHIP && !TESTNETS.has(id) && nets[id] && isAddr(nets[id].factory)).map(async (id) => {
      const net = nets[id];
      try {
        const rpc = provider(net);
        const f = new ethers.Contract(net.factory, ABI.factory, rpc);
        const [setter, feeTo] = await Promise.all([safe(f.feeToSetter()), safe(f.feeTo())]);
        extra[id] = { ...(extra[id] || {}), feeTo };
        if (!isAddr(setter)) return '';
        const k = classify(await safe(rpc.getCode(setter)));
        kinds[`${id}:${setter}`] = k;
        const same = soneium && setter.toLowerCase() === (soneium.feeToSetter || '').toLowerCase();
        return `<tr><td><b>DEX fee setter (Factory)</b><br><span class="muted">${esc(NAMES[id])}</span></td><td>${explorerLink(net, setter, short(setter))}</td><td>${typeTag(k)}</td><td>Same powers as on Soneium${same ? ' · same address' : ''}.</td></tr>`;
      } catch (e) { return ''; }
    }));
    lines.push(...others.filter(Boolean));
    $('adminTable').tBodies[0].innerHTML = lines.join('') || '<tr><td colspan="4" class="muted">Could not read admin roles right now.</td></tr>';

    const eoa = Object.values(kinds).some((k) => k === 'eoa' || k === 'eoa7702');
    if (eoa && !$('adminNote')) {
      $('adminTable').closest('.dc-table-wrap').insertAdjacentHTML('afterend',
        '<div class="dc-note warn" id="adminNote">Some admin roles are held by a single wallet (EOA), with no timelock, so changes take effect immediately. This table is read from the contracts and updates automatically if roles move to a multisig or timelock.</div>');
    }
  }

  // ---------- índice: scrollspy, búsqueda, menú móvil ----------
  function initToc() {
    const links = [...document.querySelectorAll('#toc a')];
    const byId = Object.fromEntries(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const sections = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
    const setActive = (id) => links.forEach((a) => a.classList.toggle('on', a === byId[id]));
    const onScroll = () => {
      let current = sections[0]?.id;
      for (const s of sections) if (s.getBoundingClientRect().top < 140) current = s.id;
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) current = sections[sections.length - 1].id;
      setActive(current);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const search = $('tocSearch');
    const text = Object.fromEntries(sections.map((s) => [s.id, s.textContent.toLowerCase()]));
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      links.forEach((a) => {
        const id = a.getAttribute('href').slice(1);
        const hit = !q || a.textContent.toLowerCase().includes(q) || text[id].includes(q);
        a.hidden = !hit;
        if (hit) shown++;
      });
      document.querySelectorAll('.dc-toc-group').forEach((g) => { g.hidden = !!q; });
      $('tocEmpty').hidden = shown > 0;
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = links.find((a) => !a.hidden); if (first) { first.click(); search.blur(); } }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== search && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); openToc(true); search.focus(); }
      if (e.key === 'Escape') openToc(false);
    });

    const toggle = $('tocToggle');
    const openToc = (open) => {
      if (window.innerWidth > 960) return;
      document.body.classList.toggle('toc-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Close ✕' : 'Contents ☰';
    };
    toggle.addEventListener('click', () => openToc(!document.body.classList.contains('toc-open')));
    links.forEach((a) => a.addEventListener('click', () => openToc(false)));
  }

  function initCopy() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-copy]');
      if (!b) return;
      navigator.clipboard.writeText(b.dataset.copy);
      b.textContent = 'Copied';
      setTimeout(() => { b.textContent = 'Copy'; }, 1400);
    });
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('#ctTabs [data-chain]');
      if (!tab) return;
      ctActive = tab.dataset.chain;
      renderContracts(state.nets);
    });
  }

  const state = { nets: {} };

  document.addEventListener('DOMContentLoaded', async () => {
    $('year').textContent = new Date().getFullYear();
    initToc();
    initCopy();
    try {
      const all = await window.loadNetworks();
      Object.values(all).forEach((n) => { if (n.enabled && ORDER.includes(n.chainId)) state.nets[n.chainId] = n; });
      if (window.getMarketConfig) {
        ORDER.forEach((id) => {
          const warn = console.warn; console.warn = () => {};
          try { const m = window.getMarketConfig(id); if (m) MARKET_CFG[id] = m; } finally { console.warn = warn; }
        });
      }
      renderNetworks(state.nets);
      renderContracts(state.nets);
      renderNft(state.nets, {});

      const son = state.nets[FLAGSHIP];
      const soneium = son ? await loadSoneium(son).catch((e) => { console.warn('[docs] soneium', e); return null; }) : null;

      const fees = {};
      if (soneium?.nftFee != null) fees[FLAGSHIP] = Number(soneium.nftFee);
      await Promise.all(Object.keys(MARKET_CFG).filter((id) => id !== FLAGSHIP && state.nets[id]).map(async (id) => {
        const f = await safe(new ethers.Contract(MARKET_CFG[id].marketplaceAddress, ABI.market, provider(state.nets[id])).feeBasisPoints());
        if (f != null) fees[id] = Number(f);
      }));
      renderNft(state.nets, fees);
      const feeVals = [...new Set(Object.entries(fees).filter(([id]) => !TESTNETS.has(id)).map(([, v]) => v))];
      if (feeVals.length) setLive('nftFee', feeVals.map((v) => pct(v / 10000)).join(' / '));

      await renderAdmin(state.nets, soneium);
      renderContracts(state.nets);
      $('docUpdated').textContent = `Read from chain at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (e) {
      console.error('[docs] live data failed', e);
      $('docUpdated').textContent = 'Live values unavailable right now';
    }
    document.querySelectorAll('.lv.loading').forEach((el) => { el.classList.remove('loading'); el.textContent = '—'; });
  });
})();
