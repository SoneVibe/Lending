/* SoneVibe Portal — UI controller. Needs portal-config.js, portal-xcm.js, ethers v6 and the @polkadot bundles. */
(function () {
  'use strict';

  const cfg = window.SV_PORTAL;
  const $ = (id) => document.getElementById(id);
  const HIST_KEY = 'SV_PORTAL_HISTORY';
  const SUB_KEY = 'SV_PORTAL_SUB';
  const DOT_ED = 100000000n;
  const DOT_FEE_RESERVE = 200000000n;
  const EVM_GAS_RESERVE = 100000000n;
  const ASTR_FEE_FALLBACK = 10n ** 18n;

  const libsOk = !!(window.polkadotApi && window.polkadotUtil && window.polkadotUtilCrypto && window.ethers);
  const E = libsOk ? window.SVXcm.create({ util: window.polkadotUtil, crypto: window.polkadotUtilCrypto }, cfg) : null;
  const xcmIface = libsOk ? new ethers.Interface(E.XCM_ABI) : null;
  const evmRead = libsOk ? new ethers.JsonRpcProvider(cfg.chains.hubevm.rpc, Number(cfg.chains.hubevm.chainId), { staticNetwork: true }) : null;

  const S = {
    from: 'assethub', to: 'hubevm', asset: 'DOT', amount: '', recipient: '', recipientTouched: false,
    sub: { accounts: [], address: null, mapped: null, source: null },
    evm: { address: null },
    apis: {}, apiP: {}, apiState: { assethub: 'idle', astar: 'idle' },
    bal: {}, balLoading: false,
    rcpt: null, rcptErr: '',
    quote: { state: 'idle' }, quoteSeq: 0,
    busy: false
  };

  /* ---------------- formatting ---------------- */
  function fmt(v, dec, maxFrac = 6) {
    if (v === null || v === undefined) return '—';
    const neg = v < 0n; if (neg) v = -v;
    const base = 10n ** BigInt(dec);
    const whole = v / base; let frac = (v % base).toString().padStart(dec, '0').slice(0, maxFrac).replace(/0+$/, '');
    if (whole === 0n && !frac && v > 0n) return (neg ? '-' : '') + '<0.' + '0'.repeat(Math.max(0, maxFrac - 1)) + '1';
    return (neg ? '-' : '') + whole.toLocaleString('en-US') + (frac ? '.' + frac : '');
  }
  function plain(v, dec) {
    const base = 10n ** BigInt(dec);
    const frac = (v % base).toString().padStart(dec, '0').replace(/0+$/, '');
    return (v / base).toString() + (frac ? '.' + frac : '');
  }
  function parse(str, dec) {
    const s = (str || '').trim().replace(',', '.');
    if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
    const [w, f = ''] = s.split('.');
    if (f.length > dec) return null;
    return BigInt(w || '0') * 10n ** BigInt(dec) + BigInt((f + '0'.repeat(dec)).slice(0, dec) || '0');
  }
  const short = (a, n = 6) => (a && a.length > 2 * n + 3 ? a.slice(0, n) + '…' + a.slice(-4) : a || '');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed — select and copy manually'); }
  }

  /* ---------------- icons ---------------- */
  const IC = window.SV_ICONS || { tokens: {}, chains: {}, wallets: {} };
  const CHAIN_SVG = { assethub: 'polkadot', hubevm: 'polkadot', soneium: 'soneium' };
  const CHAIN_IMG = { astar: 'icons/astr.svg', astarevm: 'icons/astr.svg', ethereum: 'icons/eth.svg' };
  function chainIcon(id, sm) {
    const c = cfg.chains[id];
    const tag = c.kind === 'evm' ? '<span class="tag">EVM</span>' : '';
    const inner = IC.chains[CHAIN_SVG[id]] || (CHAIN_IMG[id] ? `<img src="${CHAIN_IMG[id]}" alt="">` : `<b>${esc(c.short.slice(0, 2).toUpperCase())}</b>`);
    return `<span class="ci${sm ? ' sm' : ''}"><span class="ci-in" style="background:${c.color}">${inner}</span>${tag}</span>`;
  }
  function assetIcon(key, sm) {
    const a = cfg.assets[key];
    const svg = IC.tokens[key.replace(/\.e$/, '')];
    const inner = svg || (a.icon ? `<img src="${a.icon}" alt="">` : `<b>${esc(a.symbol.replace(/^[a-z]/, '').slice(0, 2).toUpperCase())}</b>`);
    const bg = svg ? 'transparent' : a.icon ? a.color : `linear-gradient(135deg, ${a.color}, #1b1f36)`;
    const badge = a.origin === 'ethereum' && !sm ? '<span class="tag img" title="Bridged from Ethereum"><img src="icons/eth.svg" alt=""></span>' : '';
    return `<span class="ci${sm ? ' sm' : ''}"><span class="ci-in" style="background:${bg}">${inner}</span>${badge}</span>`;
  }
  const SVG = {
    copy: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    ext: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    swap: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h13l-3-3M17 17H4l3 3"/></svg>',
    power: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'
  };
  function avatar(addr, px = 30) {
    const h = window.polkadotUtilCrypto.blake2AsU8a(String(addr).toLowerCase(), 64);
    const a = Math.round((h[0] / 255) * 360), b = (a + 60 + Math.round((h[1] / 255) * 120)) % 360;
    return `<span class="av" style="width:${px}px;height:${px}px;background:radial-gradient(circle at 30% 25%, hsl(${b} 90% 70%), transparent 55%),linear-gradient(135deg, hsl(${a} 75% 55%), hsl(${b} 70% 38%))"></span>`;
  }
  const safeImg = (src) => (/^(data:image\/|https:\/\/|icons\/)/.test(src || '') ? src : '');
  function walletIcon(w, px) {
    const img = safeImg(w.img);
    const inner = img ? `<img src="${esc(img)}" alt="">` : IC.wallets[w.icon] || IC.wallets.generic || '';
    return `<span class="wi" style="width:${px}px;height:${px}px">${inner}</span>`;
  }

  /* ---------------- chain connections ---------------- */
  function setApiState(id, st) {
    S.apiState[id] = st;
    const el = id === 'assethub' ? $('stAH') : $('stAstar');
    el.className = 'pt-status ' + (st === 'ready' ? 'ok' : st === 'connecting' ? 'wait' : st === 'error' ? 'bad' : '');
    el.title = st;
  }

  function getApi(id) {
    if (S.apis[id]) return Promise.resolve(S.apis[id]);
    if (S.apiP[id]) return S.apiP[id];
    setApiState(id, 'connecting');
    S.apiP[id] = (async () => {
      const { ApiPromise, WsProvider } = window.polkadotApi;
      const provider = new WsProvider(cfg.chains[id].ws, 2500);
      const api = new ApiPromise({ provider, noInitWarn: true });
      let timer;
      await Promise.race([
        api.isReady,
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), 25000); })
      ]).catch((e) => { setApiState(id, 'error'); throw e; }).finally(() => clearTimeout(timer));
      S.apis[id] = api;
      setApiState(id, 'ready');
      provider.on('disconnected', () => setApiState(id, 'connecting'));
      provider.on('connected', () => S.apis[id] && setApiState(id, 'ready'));
      return api;
    })();
    S.apiP[id].catch(() => { S.apiP[id] = null; setTimeout(() => getApi(id).then(render, () => {}), 8000); });
    return S.apiP[id];
  }

  const needsAstar = (from, to) => [from, to].some((c) => c === 'astar' || c === 'astarevm');

  async function apisFor(from, to) {
    const apis = { assethub: await getApi('assethub') };
    if (needsAstar(from, to)) apis.astar = await getApi('astar');
    return apis;
  }

  async function checkEvmRpc() {
    try { await evmRead.getBlockNumber(); $('stEvm').className = 'pt-status ok'; }
    catch { $('stEvm').className = 'pt-status bad'; }
  }

  /* ---------------- routes ---------------- */
  function hasAsset(chain, key) {
    const a = cfg.assets[key];
    if (chain === 'astarevm') return !!(a.on.astar && (a.astarEvmErc20 || a.on.astar.type === 'native'));
    return !!a.on[chain];
  }

  function laneInfo(from, to) {
    const route = cfg.routes.find((r) => r.from === from && r.to === to);
    if (route) return { kind: 'native', route, list: E ? E.assetsFor(from, to) : [] };
    const partners = cfg.partners.filter((p) => p.from === from && p.to === to);
    if (partners.length) {
      const list = [...new Set(partners.flatMap((p) => p.assets))].filter((k) => cfg.assets[k]);
      return { kind: 'partner', partners, list };
    }
    let list = Object.keys(cfg.assets).filter((k) => hasAsset(from, k));
    if (!list.length) list = [...new Set(cfg.partners.filter((p) => p.from === from).flatMap((p) => p.assets))];
    return { kind: 'none', list };
  }

  function partnerFor(from, to, asset) {
    return cfg.partners.find((p) => p.from === from && p.to === to && p.assets.includes(asset));
  }

  function blockedReason(to, asset) {
    const b = cfg.blocked.find((x) => x.asset === asset && x.to.includes(to));
    return b ? b.reason : '';
  }

  function currentLane() {
    const lane = laneInfo(S.from, S.to);
    if (lane.kind === 'native' && !lane.list.includes(S.asset)) return { ...lane, kind: 'none', reason: blockedReason(S.to, S.asset) };
    if (lane.kind === 'partner') {
      const p = partnerFor(S.from, S.to, S.asset);
      if (!p) return { ...lane, kind: 'none', reason: blockedReason(S.to, S.asset) };
      return { ...lane, partner: p };
    }
    if (lane.kind === 'none') return { ...lane, reason: blockedReason(S.to, S.asset) };
    return lane;
  }

  function ensureAsset() {
    const lane = laneInfo(S.from, S.to);
    if (!lane.list.includes(S.asset) && !blockedReason(S.to, S.asset)) {
      const pref = ['DOT', 'USDT', 'USDC', 'ETH', 'ASTR'].find((k) => lane.list.includes(k));
      S.asset = pref || lane.list[0] || S.asset;
    }
  }

  /* ---------------- accounts ---------------- */
  const srcIsEvm = () => cfg.chains[S.from].kind === 'evm';
  function sourceAddress() { return srcIsEvm() ? S.evm.address : S.sub.address; }

  /* ---------------- wallets ---------------- */
  const SUB_SRC_KEY = 'SV_PORTAL_SUB_SRC';
  const EVM_KEY = 'SV_PORTAL_EVM';
  const SUB_WALLETS = {
    talisman: { name: 'Talisman', icon: 'talisman', url: 'https://talisman.xyz/download' },
    'subwallet-js': { name: 'SubWallet', icon: 'subwallet', url: 'https://www.subwallet.app/download.html' },
    'polkadot-js': { name: 'Polkadot.js', icon: 'polkadotjs', url: 'https://polkadot.js.org/extension/' },
    nova: { name: 'Nova Wallet', icon: 'nova', url: 'https://novawallet.io/' }
  };
  const isNova = () => !!(window.walletExtension && window.walletExtension.isNovaWallet);
  function subMeta(source) {
    if (source === 'polkadot-js' && isNova()) return SUB_WALLETS.nova;
    return SUB_WALLETS[source] || { name: source ? source.replace(/[-_]js$/, '').replace(/^\w/, (c) => c.toUpperCase()) : 'Polkadot wallet', icon: 'generic' };
  }

  function subChoices() {
    const inj = window.injectedWeb3 || {};
    const list = Object.keys(inj).map((k) => ({ id: k, ...subMeta(k), installed: true }));
    ['talisman', 'subwallet-js', 'polkadot-js'].forEach((k) => { if (!inj[k]) list.push({ id: k, ...SUB_WALLETS[k], installed: false }); });
    if (!isNova()) list.push({ id: 'nova', ...SUB_WALLETS.nova, installed: false, mobile: true });
    return list;
  }

  function chooseSub() {
    closeMenu();
    const items = subChoices().map((w) => ({
      value: w.id, search: w.name,
      html: `${walletIcon(w, 36)}<div class="n"><b>${esc(w.name)}</b><span>${w.installed ? 'Detected in this browser' : w.mobile ? 'Mobile — open this page in the Nova browser' : 'Not installed'}</span></div><div class="v">${w.installed ? '<span class="pt-tag ok">Connect</span>' : '<span class="pt-sub">Install ↗</span>'}</div>`
    }));
    openModal('Connect a Polkadot wallet', items, (v) => {
      const w = subChoices().find((x) => x.id === v);
      if (!w) return;
      if (!w.installed) window.open(w.url, '_blank', 'noopener'); else connectSub(false, v);
    }, '', 'For Asset Hub and Astar. Your keys never leave your wallet.');
  }

  async function connectSub(silent, source) {
    const ext = window.polkadotExtensionDapp;
    if (!ext) { if (!silent) toast('Wallet library failed to load'); return; }
    source = source || localStorage.getItem(SUB_SRC_KEY) || '';
    setBtnBusy('btnSub', !silent);
    try {
      const exts = await ext.web3Enable('SoneVibe Portal');
      const e = exts.find((x) => x.name === source) || (!source ? exts[0] : null);
      if (!e) {
        if (!silent) toast(exts.length ? `${subMeta(source).name} did not authorize this site. Open it and approve SoneVibe Portal.` : 'No Polkadot wallet found. Install Talisman, SubWallet or Nova Wallet.');
        return;
      }
      const accs = (await ext.web3Accounts({ extensions: [e.name] })).filter((a) => a.type !== 'ethereum');
      if (!accs.length) { if (!silent) toast(`${subMeta(e.name).name} has no Polkadot accounts shared with this site.`); return; }
      if (S.sub.unsub) { try { S.sub.unsub(); } catch { /* ignore */ } }
      S.sub.accounts = accs; S.sub.source = e.name;
      localStorage.setItem(SUB_SRC_KEY, e.name);
      const saved = localStorage.getItem(SUB_KEY);
      const pick = accs.find((a) => a.address === saved) || accs[0];
      if (!silent) toast(`${subMeta(e.name).name} connected`);
      await selectSub(pick.address);
      try {
        S.sub.unsub = await ext.web3AccountsSubscribe((list) => {
          const l = list.filter((a) => a.type !== 'ethereum');
          if (!S.sub.source) return;
          S.sub.accounts = l;
          if (l.length && !l.some((a) => a.address === S.sub.address)) selectSub(l[0].address);
          else { renderAccounts(); refreshMenu(); }
        }, { extensions: [e.name] });
      } catch { /* optional */ }
    } finally { setBtnBusy('btnSub', false); }
  }

  async function selectSub(address) {
    S.sub.address = address; S.sub.mapped = null;
    localStorage.setItem(SUB_KEY, address);
    if (!S.recipientTouched) S.recipient = '';
    render(); refreshMenu(); loadBalances();
    try {
      const ah = await getApi('assethub');
      S.sub.mapped = await E.isMapped(ah, E.toAccountId(address));
    } catch { S.sub.mapped = null; }
    render(); refreshMenu();
  }

  function clearBal(chains) { Object.keys(S.bal).forEach((k) => { if (chains.includes(k.split(':')[0])) delete S.bal[k]; }); }

  function disconnectSub() {
    if (S.sub.unsub) { try { S.sub.unsub(); } catch { /* ignore */ } }
    const name = subMeta(S.sub.source).name;
    S.sub = { accounts: [], address: null, mapped: null, source: null };
    localStorage.removeItem(SUB_SRC_KEY); localStorage.removeItem(SUB_KEY);
    clearBal(['assethub', 'astar']);
    if (!S.recipientTouched) S.recipient = '';
    closeMenu(); render(); scheduleQuote();
    toast(`${name} disconnected`);
  }

  /* EVM wallets are discovered with EIP-6963 so every installed wallet shows with its own name and logo. */
  const EVM_PROVIDERS = new Map();
  window.addEventListener('eip6963:announceProvider', (e) => {
    const d = e.detail;
    if (d && d.info && d.provider) EVM_PROVIDERS.set(d.info.rdns || d.info.uuid, d);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  function evmChoices() {
    const list = [...EVM_PROVIDERS.values()].map((d) => ({ id: d.info.rdns || d.info.uuid, name: d.info.name, img: d.info.icon, provider: d.provider, installed: true }));
    if (!list.length && window.ethereum) {
      const mm = !!window.ethereum.isMetaMask;
      list.push({ id: 'injected', name: mm ? 'MetaMask' : 'Browser wallet', img: mm ? 'icons/metamask.svg' : '', provider: window.ethereum, installed: true });
    }
    if (!list.some((w) => /metamask/i.test(w.id + w.name))) list.push({ id: 'io.metamask', name: 'MetaMask', img: 'icons/metamask.svg', installed: false, url: 'https://metamask.io/download/' });
    if (!list.some((w) => /talisman/i.test(w.id + w.name))) list.push({ id: 'xyz.talisman', name: 'Talisman', icon: 'talisman', installed: false, url: 'https://talisman.xyz/download' });
    return list;
  }

  function chooseEvm() {
    closeMenu();
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      const items = evmChoices().map((w) => ({
        value: w.id, search: w.name,
        html: `${walletIcon(w, 36)}<div class="n"><b>${esc(w.name)}</b><span>${w.installed ? 'Detected in this browser' : 'Not installed'}</span></div><div class="v">${w.installed ? '<span class="pt-tag ok">Connect</span>' : '<span class="pt-sub">Install ↗</span>'}</div>`
      }));
      openModal('Connect an EVM wallet', items, (v) => {
        const w = evmChoices().find((x) => x.id === v);
        if (!w) return;
        if (!w.installed) window.open(w.url, '_blank', 'noopener'); else connectEvm(false, v);
      }, '', 'For Polkadot Hub EVM and Astar EVM.');
    }, 60);
  }

  const boundProviders = new WeakSet();
  async function connectEvm(silent, id) {
    const saved = localStorage.getItem(EVM_KEY);
    if (silent && saved === 'off') return;
    id = id || (saved !== 'off' ? saved : '') || '';
    const choices = evmChoices().filter((w) => w.installed);
    const w = choices.find((x) => x.id === id) || (silent && !id ? choices[0] : null) || (!silent && !id ? choices[0] : null);
    if (!w) { if (!silent) toast('No EVM wallet found. Install MetaMask, Talisman or SubWallet.'); return; }
    const eth = w.provider;
    setBtnBusy('btnEvm', !silent);
    try {
      const accs = await eth.request({ method: silent ? 'eth_accounts' : 'eth_requestAccounts' });
      if (!accs || !accs.length) return;
      S.evm = { address: ethers.getAddress(accs[0]), provider: eth, wallet: { id: w.id, name: w.name, img: w.img, icon: w.icon }, chainId: null };
      localStorage.setItem(EVM_KEY, w.id);
      if (!S.recipientTouched) S.recipient = '';
      if (!silent) toast(`${w.name} connected`);
      render(); loadBalances();
      try { S.evm.chainId = await eth.request({ method: 'eth_chainId' }); } catch { /* ignore */ }
      renderWalletButtons(); refreshMenu();
      if (!boundProviders.has(eth) && eth.on) {
        boundProviders.add(eth);
        eth.on('accountsChanged', (a) => {
          if (S.evm.provider !== eth) return;
          if (!a || !a[0]) { disconnectEvm(true); return; }
          S.evm.address = ethers.getAddress(a[0]); clearBal(['hubevm']);
          if (!S.recipientTouched) S.recipient = '';
          render(); refreshMenu(); loadBalances();
        });
        eth.on('chainChanged', (c) => { if (S.evm.provider !== eth) return; S.evm.chainId = c; renderWalletButtons(); refreshMenu(); });
      }
    } catch (e) { if (!silent) toast(e.code === 4001 ? 'Connection rejected in your wallet' : 'Could not connect wallet'); }
    finally { setBtnBusy('btnEvm', false); }
  }

  async function disconnectEvm(fromWallet) {
    const eth = S.evm.provider; const name = (S.evm.wallet && S.evm.wallet.name) || 'Wallet';
    if (eth && !fromWallet) { try { await eth.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }); } catch { /* not supported everywhere */ } }
    S.evm = { address: null };
    localStorage.setItem(EVM_KEY, 'off');
    clearBal(['hubevm']);
    if (!S.recipientTouched) S.recipient = '';
    closeMenu(); render(); scheduleQuote();
    toast(`${name} disconnected`);
  }

  const onHub = () => (S.evm.chainId || '').toLowerCase() === cfg.chains.hubevm.addChain.chainId;

  async function ensureHubChain() {
    const eth = S.evm.provider;
    if (!eth) throw new Error('Connect an EVM wallet first');
    const want = cfg.chains.hubevm.addChain.chainId;
    const cur = await eth.request({ method: 'eth_chainId' });
    if (cur.toLowerCase() === want) return;
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
    } catch (e) {
      if (e.code === 4902 || /Unrecognized|not been added/i.test(e.message || '')) {
        await eth.request({ method: 'wallet_addEthereumChain', params: [cfg.chains.hubevm.addChain] });
      } else throw e;
    }
    S.evm.chainId = want;
  }

  function setBtnBusy(id, on) {
    const b = $(id); if (!b) return;
    b.classList.toggle('busy', !!on);
    if (on) b.innerHTML = '<span class="spin"></span><span class="lbl">Connecting…</span>';
    else renderWalletButtons();
  }

  /* ---------------- wallet menu ---------------- */
  let menuKind = null;
  function openMenu(kind) {
    if (menuKind === kind) return closeMenu();
    menuKind = kind;
    refreshMenu();
    $('wmBackdrop').classList.add('open');
    $('walletMenu').classList.add('open');
    $(kind === 'sub' ? 'btnSub' : 'btnEvm').setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    if (!menuKind) return;
    $(menuKind === 'sub' ? 'btnSub' : 'btnEvm').setAttribute('aria-expanded', 'false');
    menuKind = null;
    $('walletMenu').classList.remove('open'); $('wmBackdrop').classList.remove('open');
  }
  function placeMenu() {
    const m = $('walletMenu'); const b = $(menuKind === 'sub' ? 'btnSub' : 'btnEvm').getBoundingClientRect();
    m.style.top = Math.round(b.bottom + 10) + 'px';
    m.style.right = Math.max(10, Math.round(window.innerWidth - b.right)) + 'px';
  }
  function balRow(label, key, chain) {
    const v = S.bal[chain + ':' + key]; const a = cfg.assets[key];
    return `<div class="wm-bal"><span>${assetIcon(key, true)}${esc(label)}</span><b>${v === undefined ? '<span class="sk"></span>' : v === null ? '—' : fmt(v, a.decimals, 4) + ' ' + esc(a.symbol)}</b></div>`;
  }
  function refreshMenu() {
    if (!menuKind) return;
    const m = $('walletMenu');
    if (menuKind === 'sub') {
      if (!S.sub.address) return closeMenu();
      const meta = subMeta(S.sub.source);
      const ss = E.ss58(E.toAccountId(S.sub.address), 0);
      const accts = S.sub.accounts.map((acc) => {
        const sel = acc.address === S.sub.address;
        const a0 = E.ss58(E.toAccountId(acc.address), 0);
        return `<button class="wm-acct${sel ? ' sel' : ''}" data-wm-acct="${esc(acc.address)}" role="menuitemradio" aria-checked="${sel}">${avatar(a0)}<div><b>${esc(acc.meta.name || 'Account')}</b><span>${esc(short(a0, 8))}</span></div>${sel ? `<i class="wm-check">${SVG.check}</i>` : ''}</button>`;
      }).join('');
      const mapTag = S.sub.mapped === null ? '' : S.sub.mapped ? '<span class="pt-tag ok">EVM mapped</span>' : '<span class="pt-tag warn">EVM not mapped</span>';
      m.innerHTML = `<div class="wm-head">${walletIcon(meta, 38)}<div><b>${esc(meta.name)}</b><span><i class="live"></i>Connected · Polkadot</span></div><button class="pt-x" data-wm="close" aria-label="Close">×</button></div>
        <div class="wm-label">${S.sub.accounts.length > 1 ? `Accounts · ${S.sub.accounts.length}` : 'Account'} ${mapTag}</div>
        <div class="wm-accts" role="menu">${accts}</div>
        <div class="wm-bals">${balRow('Asset Hub', 'DOT', 'assethub')}${balRow('Asset Hub', 'USDT', 'assethub')}${S.bal['astar:ASTR'] !== undefined ? balRow('Astar', 'ASTR', 'astar') : ''}</div>
        <div class="wm-actions">
          <button data-wm="copy" data-v="${esc(ss)}">${SVG.copy}Copy address</button>
          <a href="${cfg.chains.assethub.explorerAcct}${esc(ss)}" target="_blank" rel="noopener">${SVG.ext}Subscan</a>
          <button data-wm="switch-sub">${SVG.swap}Change wallet</button>
          <button data-wm="disconnect-sub" class="danger">${SVG.power}Disconnect</button>
        </div>`;
    } else {
      if (!S.evm.address) return closeMenu();
      const w = S.evm.wallet || { name: 'Wallet' };
      const net = S.evm.chainId === null || S.evm.chainId === undefined ? '' : onHub()
        ? '<span><i class="live"></i>Connected · Polkadot Hub</span>'
        : '<span><i class="live warn"></i>Connected · other network</span>';
      m.innerHTML = `<div class="wm-head">${walletIcon(w, 38)}<div><b>${esc(w.name)}</b>${net || '<span><i class="live"></i>Connected</span>'}</div><button class="pt-x" data-wm="close" aria-label="Close">×</button></div>
        <div class="wm-acct sel static">${avatar(S.evm.address.toLowerCase())}<div><b>${esc(short(S.evm.address, 6))}</b><span>EVM address</span></div></div>
        ${S.evm.chainId && !onHub() ? `<button class="wm-switch" data-wm="switch-net">${chainIcon('hubevm', true)} Switch to Polkadot Hub</button>` : ''}
        <div class="wm-bals">${balRow('Hub EVM', 'DOT', 'hubevm')}${balRow('Hub EVM', 'USDT', 'hubevm')}</div>
        <div class="wm-actions">
          <button data-wm="copy" data-v="${esc(S.evm.address)}">${SVG.copy}Copy address</button>
          <a href="${cfg.chains.hubevm.explorerAcct}${esc(S.evm.address)}" target="_blank" rel="noopener">${SVG.ext}Blockscout</a>
          <button data-wm="switch-evm">${SVG.swap}Change wallet</button>
          <button data-wm="disconnect-evm" class="danger">${SVG.power}Disconnect</button>
        </div>`;
    }
    placeMenu();
  }

  /** Account on `chain` whose balance we show for the connected user. */
  function userAccountOn(chain) {
    if (chain === 'hubevm' || chain === 'astarevm') return S.evm.address;
    return S.sub.address;
  }

  /* ---------------- balances ---------------- */
  const erc20 = (addr) => new ethers.Contract(addr, E.ERC20_ABI, evmRead);

  async function readBalance(chain, key, who) {
    const a = cfg.assets[key];
    if (chain === 'hubevm') {
      const t = a.on.hubevm; if (!t) return null;
      if (t.type === 'native') return (await evmRead.getBalance(who)) / E.DOT_EVM_RATIO;
      return await erc20(t.address).balanceOf(who);
    }
    if (chain === 'assethub') {
      const ah = await getApi('assethub'); const t = a.on.assethub; if (!t) return null;
      if (t.type === 'native') {
        const d = (await ah.query.system.account(who)).data;
        const free = d.free.toBigInt(); const frozen = d.frozen ? d.frozen.toBigInt() : 0n;
        const keep = frozen > DOT_ED ? frozen : DOT_ED;
        return free > keep ? free - keep : 0n;
      }
      const r = t.type === 'assets' ? await ah.query.assets.account(t.id, who) : await ah.query.foreignAssets.account(t.location, who);
      return r.isSome ? r.unwrap().balance.toBigInt() : 0n;
    }
    if (chain === 'astar' || chain === 'astarevm') {
      const as = await getApi('astar'); const t = a.on.astar; if (!t) return null;
      const acct = chain === 'astarevm' ? E.astarEvmAccount(who) : who;
      if (t.type === 'native') {
        const d = (await as.query.system.account(acct)).data;
        const free = d.free.toBigInt(); const frozen = d.frozen ? d.frozen.toBigInt() : 0n;
        const keep = frozen > 1000000n ? frozen : 1000000n;
        return free > keep ? free - keep : 0n;
      }
      const r = await as.query.assets.account(t.id, acct);
      return r.isSome ? r.unwrap().balance.toBigInt() : 0n;
    }
    return null;
  }

  /** Raw balance of the resolved destination account, used to detect delivery. */
  async function destRaw(to, key, rcptId) {
    const a = cfg.assets[key];
    if (to === 'assethub' || to === 'hubevm') {
      const ah = await getApi('assethub'); const t = a.on.assethub;
      if (t.type === 'native') return (await ah.query.system.account(rcptId)).data.free.toBigInt();
      const r = t.type === 'assets' ? await ah.query.assets.account(t.id, rcptId) : await ah.query.foreignAssets.account(t.location, rcptId);
      return r.isSome ? r.unwrap().balance.toBigInt() : 0n;
    }
    const as = await getApi('astar'); const t = a.on.astar;
    if (t.type === 'native') return (await as.query.system.account(rcptId)).data.free.toBigInt();
    const r = await as.query.assets.account(t.id, rcptId);
    return r.isSome ? r.unwrap().balance.toBigInt() : 0n;
  }

  const BAL_COLS = [['assethub', 'Asset Hub'], ['hubevm', 'Hub EVM'], ['astar', 'Astar']];

  async function loadBalances() {
    if (!E) return;
    const seq = (loadBalances._seq = (loadBalances._seq || 0) + 1);
    S.balLoading = true; renderBalances();
    const jobs = [];
    for (const [chain] of BAL_COLS) {
      const who = userAccountOn(chain); if (!who) continue;
      for (const key of Object.keys(cfg.assets)) {
        if (!hasAsset(chain, key)) continue;
        jobs.push(readBalance(chain, key, chain === 'hubevm' ? who : E.toAccountId(who))
          .then((v) => { S.bal[chain + ':' + key] = v; })
          .catch(() => { S.bal[chain + ':' + key] = undefined; }));
      }
    }
    await Promise.all(jobs);
    if (seq !== loadBalances._seq) return;
    S.balLoading = false; render();
  }

  function sourceBalance() {
    if (!sourceAddress()) return null;
    const v = S.bal[S.from + ':' + S.asset];
    return v === undefined ? null : v;
  }

  function maxSendable() {
    const b = sourceBalance(); if (b === null) return null;
    let m = b;
    if (S.asset === 'DOT' && S.from === 'assethub') m = b - DOT_FEE_RESERVE;
    if (S.asset === 'DOT' && S.from === 'hubevm') m = b - EVM_GAS_RESERVE;
    return m > 0n ? m : 0n;
  }

  /* ---------------- recipient ---------------- */
  function defaultRecipient() {
    const to = S.to;
    if (to === 'hubevm') {
      if (S.evm.address) return S.evm.address;
      if (S.sub.address && S.sub.mapped) return ethers.getAddress(E.h160OfAccount(S.sub.address));
      return '';
    }
    if (to === 'astarevm') return S.evm.address || '';
    if (to === 'assethub' && S.sub.address) return E.ss58(E.toAccountId(S.sub.address), 0);
    if (to === 'astar' && S.sub.address) return E.ss58(E.toAccountId(S.sub.address), 5);
    return '';
  }

  /* ---------------- quote ---------------- */
  let quoteTimer;
  function scheduleQuote() { clearTimeout(quoteTimer); quoteTimer = setTimeout(quote, 350); }

  async function quote() {
    const seq = ++S.quoteSeq;
    const lane = currentLane();
    const a = cfg.assets[S.asset];
    const amt = parse(S.amount, a.decimals);
    S.rcpt = null; S.rcptErr = '';
    if (lane.kind !== 'native') { S.quote = { state: 'idle' }; return render(); }
    S.quote = { state: 'loading' }; renderSummary(); renderCta();
    try {
      const apis = await apisFor(S.from, S.to);
      if (seq !== S.quoteSeq) return;
      if (S.recipient.trim()) {
        try { S.rcpt = await E.resolveRecipient(apis, S.to, S.recipient); } catch (e) { S.rcptErr = e.message; }
      }
      const q = { state: 'ok', destFee: await E.destinationFee(apis, S.from, S.to, S.asset) };
      if (S.rcpt) {
        q.rcptBal = await destRaw(S.to, S.asset, S.rcpt.id).catch(() => null);
        if (!a.sufficient && (S.to === 'assethub' || S.to === 'hubevm')) {
          q.rcptDot = (await apis.assethub.query.system.account(S.rcpt.id)).data.free.toBigInt();
        }
      }
      const sender = sourceAddress();
      if (amt && amt > 0n && S.rcpt && sender) {
        const plan = await E.build({ apis, iface: xcmIface, from: S.from, to: S.to, assetKey: S.asset, amount: amt, recipientId: S.rcpt.id });
        q.plan = plan;
        if (plan.kind === 'substrate') {
          const info = await plan.tx.paymentInfo(sender);
          const c = cfg.chains[plan.chain];
          q.srcFee = { v: info.partialFee.toBigInt(), dec: c.nativeDecimals, sym: c.nativeSymbol };
        } else {
          try {
            const [gas, fd] = await Promise.all([evmRead.estimateGas({ from: sender, to: plan.to, data: plan.data, value: plan.value }), evmRead.getFeeData()]);
            q.gas = gas;
            q.srcFee = { v: gas * (fd.gasPrice || fd.maxFeePerGas || 0n), dec: 18, sym: 'DOT' };
          } catch (e) {
            q.simError = (e.shortMessage || e.message || '').replace(/^execution reverted:?\s*/i, '');
          }
        }
      }
      if (seq !== S.quoteSeq) return;
      S.quote = q;
    } catch (e) {
      if (seq !== S.quoteSeq) return;
      S.quote = { state: 'error', error: e.message === 'timeout' ? 'Network is slow to respond. Retrying…' : e.message };
    }
    render();
  }

  /* ---------------- render ---------------- */
  function render() {
    renderChains(); renderAsset(); renderRecipient(); renderSummary(); renderAlerts(); renderCta(); renderAccounts(); renderBalances(); renderWalletButtons(); syncUrl();
  }

  function renderWalletButtons() {
    const bs = $('btnSub'), be = $('btnEvm');
    if (!bs.classList.contains('busy')) {
      bs.classList.toggle('on', !!S.sub.address);
      bs.innerHTML = S.sub.address
        ? `${walletIcon(subMeta(S.sub.source), 20)}<span class="lbl">${esc(short(E.ss58(E.toAccountId(S.sub.address), 0), 5))}</span><i class="st"></i><span class="chev">${SVG.chev}</span>`
        : `<span class="wi" style="width:20px;height:20px">${IC.chains.polkadot || ''}</span><span class="lbl">Polkadot wallet</span>`;
    }
    if (!be.classList.contains('busy')) {
      be.classList.toggle('on', !!S.evm.address);
      const warn = S.evm.address && S.evm.chainId && !onHub();
      be.innerHTML = S.evm.address
        ? `${walletIcon(S.evm.wallet || {}, 20)}<span class="lbl">${esc(short(S.evm.address, 5))}</span><i class="st${warn ? ' warn' : ''}" title="${warn ? 'Other network' : 'Polkadot Hub'}"></i><span class="chev">${SVG.chev}</span>`
        : `${walletIcon({ img: 'icons/metamask.svg' }, 20)}<span class="lbl">EVM wallet</span>`;
    }
  }

  function renderChains() {
    const row = (id) => `${chainIcon(id)}<span>${esc(cfg.chains[id].name)}</span><span class="chev">▾</span>`;
    $('fromBtn').querySelector('.row').innerHTML = row(S.from);
    $('toBtn').querySelector('.row').innerHTML = row(S.to);
    const lane = currentLane();
    const b = $('routeBadge');
    if (lane.kind === 'native') b.innerHTML = `<span class="pt-route">● ${esc(lane.route.label)}</span>`;
    else if (lane.kind === 'partner') b.innerHTML = `<span class="pt-route partner">↗ via ${esc(lane.partner.name)}</span>`;
    else b.innerHTML = '<span class="pt-route blocked">Not available</span>';
  }

  function renderAsset() {
    const a = cfg.assets[S.asset];
    $('assetBtn').innerHTML = `${assetIcon(S.asset, true)}${esc(a.symbol)} <span style="opacity:.5;font-size:.8rem">▾</span>`;
    const lane = currentLane();
    const bal = sourceBalance();
    const bl = $('balLine');
    if (lane.kind === 'partner' || cfg.chains[S.from].kind === 'external') bl.textContent = `On ${cfg.chains[S.from].short}`;
    else if (!sourceAddress()) bl.textContent = 'Connect wallet to see balance';
    else if (bal === null) bl.innerHTML = 'Balance: <span class="sk"></span>';
    else bl.textContent = `Balance: ${fmt(bal, a.decimals)} ${a.symbol}`;
    const canMax = lane.kind === 'native' && bal !== null;
    $('quick').querySelectorAll('button').forEach((x) => { x.disabled = !canMax; });
    $('quick').style.display = lane.kind === 'native' ? '' : 'none';
  }

  function renderRecipient() {
    const lane = currentLane();
    $('recipBox').style.display = lane.kind === 'native' ? '' : 'none';
    const to = cfg.chains[S.to];
    $('recipLabel').textContent = `Recipient on ${to.short}`;
    const inp = $('recipient');
    const evmDest = to.kind === 'evm';
    inp.placeholder = evmDest ? '0x… EVM address' : `${to.short} address (SS58)`;
    if (!S.recipientTouched) {
      const d = defaultRecipient();
      if (d !== S.recipient) { S.recipient = d; scheduleQuote(); }
    }
    if (document.activeElement !== inp) inp.value = S.recipient;
    const mine = defaultRecipient();
    $('useMine').style.visibility = mine && mine !== S.recipient ? 'visible' : 'hidden';

    const h = $('recipHint');
    if (!S.recipient.trim()) {
      let msg = evmDest ? 'Connect an EVM wallet or paste a 0x address.' : 'Connect a Polkadot wallet or paste an address.';
      if (S.to === 'hubevm' && S.sub.address && !S.evm.address && S.sub.mapped === false) msg = 'Your Polkadot account is not mapped yet — paste a MetaMask address, or map your account in "Your accounts".';
      h.className = 'pt-hint'; h.textContent = msg;
    } else if (S.rcptErr) { h.className = 'pt-hint bad'; h.textContent = S.rcptErr; }
    else if (S.rcpt) {
      h.className = 'pt-hint ok';
      const mineTag = S.recipient === mine ? ' · your account' : '';
      h.textContent = '✓ ' + (S.rcpt.note || 'Valid address') + mineTag;
    } else { h.className = 'pt-hint'; h.textContent = S.quote.state === 'loading' ? 'Checking address…' : ''; }
  }

  function renderSummary() {
    const el = $('summary');
    const lane = currentLane();
    const a = cfg.assets[S.asset];
    if (lane.kind === 'partner') {
      const p = lane.partner;
      el.innerHTML = `<div class="pt-summary">
        <div class="r"><span>Bridge</span><b>${esc(p.name)}</b></div>
        <div class="r"><span>Estimated time</span><b>${esc(p.eta)}</b></div>
        ${p.via ? `<div class="r"><span>Route</span><b>${esc(cfg.chains[S.from].short)} → ${esc(cfg.chains[p.via].short)} → ${esc(cfg.chains[S.to].short)}</b></div>` : ''}
      </div>`;
      return;
    }
    if (lane.kind !== 'native') { el.innerHTML = ''; return; }
    const amt = parse(S.amount, a.decimals);
    const q = S.quote;
    const loading = q.state === 'loading';
    const destFee = q.destFee;
    let receive = '—';
    if (amt && amt > 0n) {
      if (destFee === null || destFee === undefined) receive = loading ? '<span class="sk"></span>' : `≈ ${fmt(amt, a.decimals)} ${esc(a.symbol)}`;
      else receive = `${destFee > 0n ? '≈ ' : ''}${fmt(amt > destFee ? amt - destFee : 0n, a.decimals)} ${esc(a.symbol)}`;
    }
    const src = q.srcFee ? `${fmt(q.srcFee.v, q.srcFee.dec, 6)} ${q.srcFee.sym}` : loading ? '<span class="sk"></span>' : sourceAddress() ? (amt ? '—' : 'Enter amount') : 'Connect wallet';
    const dst = destFee === undefined ? (loading ? '<span class="sk"></span>' : '—') : destFee === null ? 'Paid from amount' : destFee === 0n ? 'None' : `${fmt(destFee, a.decimals, 8)} ${esc(a.symbol)}`;
    el.innerHTML = `<div class="pt-summary">
      <div class="r big"><span>You receive</span><b>${receive}</b></div>
      <div class="r"><span>Network fee (${esc(cfg.chains[S.from].short)})</span><b>${src}</b></div>
      <div class="r"><span>Destination fee</span><b>${dst}</b></div>
      <div class="r"><span>Estimated time</span><b>${esc(lane.route.eta)}</b></div>
    </div>`;
  }

  function alert(kind, html) { return `<div class="pt-alert ${kind}"><span>${kind === 'bad' ? '⛔' : kind === 'warn' ? '⚠️' : 'ℹ️'}</span><div>${html}</div></div>`; }

  function blockers() {
    const lane = currentLane(); const a = cfg.assets[S.asset]; const q = S.quote;
    const out = [];
    if (lane.kind !== 'native') return out;
    const amt = parse(S.amount, a.decimals);
    if (amt && q.state === 'ok') {
      const net = q.destFee ? amt - q.destFee : amt;
      const min = BigInt(a.minBalance || '0');
      if (q.rcptBal === 0n && net < min && !(S.to === 'astar' || S.to === 'astarevm')) out.push(`Minimum for a new account is <b>${fmt(min, a.decimals)} ${esc(a.symbol)}</b>. Send more, or send to an address that already holds ${esc(a.symbol)}.`);
      if (q.destFee && amt <= q.destFee) out.push(`Amount must be larger than the destination fee (${fmt(q.destFee, a.decimals, 8)} ${esc(a.symbol)}).`);
      if (q.rcptDot === 0n) out.push(`${esc(a.symbol)} is not a "sufficient" asset on Asset Hub: the recipient needs at least <b>0.01 DOT</b> first. Send some DOT to the same address, then retry.`);
      if (q.simError) out.push(`The transfer would fail on-chain: ${esc(q.simError)}`);
    }
    return out;
  }

  function renderAlerts() {
    const lane = currentLane(); const a = cfg.assets[S.asset];
    let html = '';
    if (lane.kind === 'none') {
      const reason = lane.reason || `There is no route for ${esc(a.symbol)} from ${esc(cfg.chains[S.from].name)} to ${esc(cfg.chains[S.to].name)} yet.`;
      html += alert('bad', reason + suggest());
    }
    if (lane.kind === 'partner') html += alert('info', `${esc(lane.partner.note)} The bridge opens in a new tab.`);
    if (lane.kind === 'native') {
      blockers().forEach((b) => { html += alert('bad', b); });
      const q = S.quote;
      if (q.state === 'error') html += alert('warn', esc(q.error));
      if (S.from === 'hubevm' && S.asset !== 'DOT' && S.evm.address && S.bal['hubevm:DOT'] === 0n) html += alert('warn', 'You need a little DOT on Hub EVM to pay gas.');
      const astrNeed = q.srcFee && q.srcFee.sym === 'ASTR' ? q.srcFee.v : ASTR_FEE_FALLBACK;
      if (S.from === 'astar' && S.sub.address && S.bal['astar:ASTR'] !== undefined && S.bal['astar:ASTR'] < astrNeed) html += alert('warn', `You need about ${fmt(astrNeed, 18, 2)} ASTR on Astar to pay the transaction fee.`);
      if (S.from === 'assethub' && S.asset !== 'DOT' && S.sub.address && S.bal['assethub:DOT'] === 0n) html += alert('warn', 'You need a little DOT on Asset Hub to pay the fee.');
      if (S.to === 'hubevm' && S.rcpt && !S.rcpt.note.startsWith('Mapped') && S.sub.address && S.recipient.toLowerCase() === (E.h160OfAccount(S.sub.address) || '').toLowerCase() && !S.sub.mapped) {
        html += alert('bad', 'This 0x address belongs to your Polkadot account, which is not mapped. Funds would land in a fallback account you cannot use from MetaMask. Map your account first.');
      }
      if (S.to === 'astarevm') html += alert('info', `Arrives as an ERC20 on Astar EVM. Add token <code>${esc(short(a.astarEvmErc20 || '', 10))}</code> to MetaMask to see it. <button class="pt-link" data-copy="${esc(a.astarEvmErc20 || '')}">Copy address</button>`);
      if (S.to === 'hubevm' && a.on.hubevm && a.on.hubevm.type === 'erc20') html += alert('info', `On Hub EVM ${esc(a.symbol)} is the ERC20 precompile <code>${esc(short(a.on.hubevm.address, 10))}</code>. <button class="pt-link" data-copy="${esc(a.on.hubevm.address)}">Copy</button> · <button class="pt-link" data-watch="${esc(S.asset)}">Add to wallet</button>`);
    }
    $('alerts').innerHTML = html;
  }

  function suggest() {
    if (S.asset === 'ASTR' && (S.to === 'assethub' || S.to === 'hubevm')) return ' <button class="pt-link" data-load="astar,soneium,ASTR">Bridge ASTR to Soneium instead →</button>';
    if (cfg.chains[S.from].kind === 'external' || cfg.chains[S.to].kind === 'external') return ' Soneium and Polkadot connect through Ethereum: Soneium ⇄ Ethereum (canonical bridge), then Ethereum ⇄ Asset Hub (Snowbridge).';
    return '';
  }

  function renderCta() {
    const btn = $('cta'); const lane = currentLane(); const a = cfg.assets[S.asset];
    btn.className = 'pt-cta'; btn.dataset.action = '';
    const set = (html, enabled, action) => { btn.innerHTML = html; btn.disabled = !enabled; btn.dataset.action = action || ''; };
    if (S.busy) return set('<span class="spin"></span> Transfer in progress…', false);
    if (!E) return set('Libraries failed to load — refresh the page', false);
    if (lane.kind === 'partner') { btn.classList.add('partner'); return set(`Continue on ${esc(lane.partner.name)} ↗`, true, 'partner'); }
    if (lane.kind !== 'native') return set('Route not available', false);
    if (!sourceAddress()) return set(srcIsEvm() ? 'Connect EVM wallet' : 'Connect Polkadot wallet', true, srcIsEvm() ? 'connect-evm' : 'connect-sub');
    const need = needsAstar(S.from, S.to) ? ['assethub', 'astar'] : ['assethub'];
    const notReady = need.find((c) => S.apiState[c] !== 'ready');
    if (notReady) return set(`<span class="spin"></span> Connecting to ${esc(cfg.chains[notReady].short)}…`, false);
    const amt = parse(S.amount, a.decimals);
    if (!S.amount.trim()) return set('Enter an amount', false);
    if (amt === null || amt === 0n) return set('Enter a valid amount', false);
    const bal = sourceBalance();
    if (bal !== null && amt > bal) return set(`Insufficient ${esc(a.symbol)}`, false);
    if (!S.recipient.trim()) return set('Enter a recipient', false);
    if (S.rcptErr) return set('Invalid recipient', false);
    if (S.quote.state === 'loading' || !S.rcpt) return set('<span class="spin"></span> Preparing…', false);
    if (blockers().length) return set('Review the warning above', false);
    if (!S.quote.plan) return set('Preparing…', false);
    return set(`Transfer ${fmt(amt, a.decimals)} ${esc(a.symbol)} to ${esc(cfg.chains[S.to].short)}`, true, 'send');
  }

  function renderAccounts() {
    const el = $('acct');
    if (!E) { el.innerHTML = '<div class="pt-empty"><b>Could not load Polkadot libraries</b>Check your connection and refresh.</div>'; return; }
    let html = '';
    if (S.sub.address) {
      const id = E.toAccountId(S.sub.address);
      const h = ethers.getAddress(E.h160OfAccount(id));
      const opts = S.sub.accounts.map((acc) => `<option value="${esc(acc.address)}"${acc.address === S.sub.address ? ' selected' : ''}>${esc(acc.meta.name || 'Account')} · ${esc(short(E.ss58(E.toAccountId(acc.address), 0), 5))} (${esc(acc.meta.source)})</option>`).join('');
      const mapTag = S.sub.mapped === null ? '<span class="sk"></span>' : S.sub.mapped ? '<span class="pt-tag ok">Mapped</span>' : '<span class="pt-tag warn">Not mapped</span>';
      html += `<div class="pt-box">
        <div class="pt-box-h">${walletIcon(subMeta(S.sub.source), 22)} ${esc(subMeta(S.sub.source).name)} <span class="pt-sub">${mapTag}</span></div>
        ${S.sub.accounts.length > 1 ? `<select class="pt-select" id="subSel" aria-label="Polkadot account">${opts}</select>` : ''}
        <div class="pt-addr"><label>Asset Hub</label><span>${esc(E.ss58(id, 0))}</span><button class="pt-copy" data-copy="${esc(E.ss58(id, 0))}" aria-label="Copy">⧉</button></div>
        <div class="pt-addr"><label>Astar</label><span>${esc(E.ss58(id, 5))}</span><button class="pt-copy" data-copy="${esc(E.ss58(id, 5))}" aria-label="Copy">⧉</button></div>
        <div class="pt-addr"><label>Hub EVM (0x)</label><span>${esc(h)}</span><button class="pt-copy" data-copy="${esc(h)}" aria-label="Copy">⧉</button></div>
        ${S.sub.mapped === false ? `<div class="pt-hint" style="margin-top:10px">Map once to use this account in EVM dApps (refundable deposit). Not needed to receive funds on a MetaMask address.</div><div style="margin-top:8px"><button class="pt-small-btn accent" id="mapBtn">Map account</button></div>` : ''}
      </div>`;
    } else {
      html += `<div class="pt-box"><div class="pt-box-h">${chainIcon('assethub', true)} Polkadot account</div>
        <div class="pt-hint" style="margin:0 0 10px">For Asset Hub and Astar. Talisman, SubWallet, Nova or Polkadot.js.</div>
        <button class="pt-small-btn accent" data-act="connect-sub">Connect Polkadot wallet</button></div>`;
    }
    if (S.evm.address) {
      html += `<div class="pt-box">
        <div class="pt-box-h">${walletIcon(S.evm.wallet || {}, 22)} ${esc((S.evm.wallet && S.evm.wallet.name) || 'EVM wallet')} <span class="pt-sub">${onHub() ? '<span class="pt-tag ok">Polkadot Hub</span>' : S.evm.chainId ? '<span class="pt-tag warn">Other network</span>' : ''}</span></div>
        <div class="pt-addr"><label>Address</label><span>${esc(S.evm.address)}</span><button class="pt-copy" data-copy="${esc(S.evm.address)}" aria-label="Copy">⧉</button></div>
        <div class="pt-addr"><label>Deposit (SS58)</label><span id="evmDeposit"><span class="sk"></span></span><button class="pt-copy" id="evmDepositCopy" aria-label="Copy">⧉</button></div>
        <div class="pt-hint">Send DOT or USDt from an exchange or any Polkadot wallet to this Asset Hub address — it shows up in MetaMask on Polkadot Hub.</div>
      </div>`;
    } else {
      html += `<div class="pt-box"><div class="pt-box-h">${chainIcon('hubevm', true)} EVM account</div>
        <div class="pt-hint" style="margin:0 0 10px">For Polkadot Hub EVM and Astar EVM. MetaMask, Talisman or SubWallet.</div>
        <button class="pt-small-btn accent" data-act="connect-evm">Connect EVM wallet</button></div>`;
    }
    el.innerHTML = html;
    if (S.evm.address) fillEvmDeposit();
  }

  async function fillEvmDeposit() {
    try {
      const ah = await getApi('assethub');
      const acc = await E.hubAccountOf(ah, S.evm.address);
      const addr = E.ss58(acc.id, 0);
      const el = $('evmDeposit'); if (!el) return;
      el.textContent = addr;
      $('evmDepositCopy').onclick = () => copy(addr);
    } catch { const el = $('evmDeposit'); if (el) el.textContent = 'Unavailable'; }
  }

  function renderBalances() {
    const el = $('balances');
    if (!S.sub.address && !S.evm.address) {
      el.innerHTML = '<div class="pt-empty"><b>No wallet connected</b>Connect a Polkadot or EVM wallet to see DOT, USDt, USDC and ASTR on every chain in one table.</div>';
      return;
    }
    const keys = Object.keys(cfg.assets).filter((k) => {
      const core = cfg.assets[k].group === 'core';
      return core || BAL_COLS.some(([c]) => (S.bal[c + ':' + k] || 0n) > 0n);
    });
    const head = BAL_COLS.map(([c, n]) => `<th>${esc(n)}</th>`).join('');
    const rows = keys.map((k) => {
      const a = cfg.assets[k];
      const cells = BAL_COLS.map(([c]) => {
        if (!hasAsset(c, k)) return '<td class="z">—</td>';
        if (!userAccountOn(c)) return '<td class="z" title="Connect wallet">·</td>';
        const v = S.bal[c + ':' + k];
        if (v === undefined) return `<td>${S.balLoading ? '<span class="sk"></span>' : '<span class="z">?</span>'}</td>`;
        if (v === null) return '<td class="z">—</td>';
        return `<td class="${v === 0n ? 'z' : ''}">${fmt(v, a.decimals, 4)}</td>`;
      }).join('');
      return `<tr><td><span class="a">${assetIcon(k, true)}${esc(a.symbol)}</span></td>${cells}</tr>`;
    }).join('');
    el.innerHTML = `<div class="pt-bal-wrap"><table class="pt-bal"><thead><tr><th>Asset</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="pt-hint">Asset Hub and Astar use your Polkadot account; Hub EVM uses your EVM account. Foreign assets appear when you hold them.</div>`;
  }

  /* ---------------- history ---------------- */
  function hist() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; } }
  function saveHist(list) { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 25))); renderHistory(); }
  function upsertHist(entry) { const l = hist().filter((x) => x.id !== entry.id); l.unshift(entry); saveHist(l); }

  function renderHistory() {
    const l = hist(); const el = $('history');
    if (!l.length) { el.innerHTML = '<div class="pt-empty"><b>No transfers yet</b>Transfers you make here are listed on this device.</div>'; return; }
    el.innerHTML = l.slice(0, 6).map((h) => {
      const a = cfg.assets[h.asset] || { symbol: h.asset, decimals: 0 };
      const st = h.status === 'delivered' ? '<span class="pt-tag ok">Delivered</span>' : h.status === 'failed' ? '<span class="pt-tag warn" style="color:#ffb3ba;border-color:rgba(255,93,108,.35)">Failed</span>' : '<span class="pt-tag warn">Pending</span>';
      const c = cfg.chains[h.from];
      const link = h.hash && c.explorerTx ? `<a href="${c.explorerTx}${h.hash}" target="_blank" rel="noopener">View ↗</a>` : '';
      return `<div class="pt-hrow">${cfg.assets[h.asset] ? assetIcon(h.asset, true) : ''}<div><b>${esc(h.amount)} ${esc(a.symbol)}</b> · ${esc(cfg.chains[h.from].short)} → ${esc(cfg.chains[h.to].short)}<div class="t">${new Date(h.ts).toLocaleString()}</div></div><div style="text-align:right">${st}<div>${link}</div></div></div>`;
    }).join('');
  }

  /* ---------------- send ---------------- */
  function progress(steps, after) {
    $('progress').innerHTML = `<div class="pt-progress"><div class="pt-steps">${steps.map((s, i) => `<div class="pt-step ${s.state || ''}"><span class="b">${s.state === 'done' ? '✓' : s.state === 'fail' ? '!' : s.state === 'active' ? '<span class="spin" style="width:12px;height:12px"></span>' : i + 1}</span><div><b>${s.title}</b>${s.sub ? `<p>${s.sub}</p>` : ''}</div></div>`).join('')}</div>${after ? `<div class="pt-after">${after}</div>` : ''}</div>`;
  }

  function decodeDispatchError(api, err) {
    if (err.isModule) {
      try { const m = api.registry.findMetaError(err.asModule); return `${m.section}.${m.name}: ${m.docs.join(' ')}`; } catch { /* ignore */ }
    }
    return err.toString();
  }

  async function send() {
    const a = cfg.assets[S.asset];
    const amt = parse(S.amount, a.decimals);
    const plan = S.quote.plan; const rcpt = S.rcpt;
    if (!plan || !rcpt || !amt) return;
    const from = S.from, to = S.to, assetKey = S.asset;
    const src = cfg.chains[from], dst = cfg.chains[to];
    const entry = { id: Date.now().toString(36), ts: Date.now(), from, to, asset: assetKey, amount: plain(amt, a.decimals), recipient: S.recipient, status: 'pending' };
    const steps = [
      { title: 'Sign in your wallet', sub: srcIsEvm() ? 'Confirm in MetaMask on Polkadot Hub.' : 'Confirm in your Polkadot wallet.', state: 'active' },
      { title: `Confirmed on ${esc(src.short)}` },
      { title: `Received on ${esc(dst.short)}`, sub: `${esc(short(rcpt.display, 8))}` }
    ];
    S.busy = true; renderCta(); progress(steps);
    let before = null;
    try { before = await destRaw(to, assetKey, rcpt.id); } catch { /* delivery check becomes best-effort */ }
    try {
      let hash;
      if (plan.kind === 'substrate') {
        const api = S.apis[plan.chain];
        const injector = await window.polkadotExtensionDapp.web3FromSource(S.sub.source);
        hash = await new Promise((resolve, reject) => {
          let unsub;
          plan.tx.signAndSend(S.sub.address, { signer: injector.signer }, (res) => {
            if (res.status.isReady || res.status.isBroadcast) { steps[0].state = 'done'; steps[1].state = 'active'; steps[1].sub = 'Waiting for the block…'; progress(steps); }
            if (res.dispatchError) { unsub && unsub(); reject(new Error(decodeDispatchError(api, res.dispatchError))); return; }
            if (res.status.isInBlock || res.status.isFinalized) { unsub && unsub(); resolve(res.txHash.toHex()); }
          }).then((u) => { unsub = u; }).catch(reject);
        });
      } else {
        await ensureHubChain();
        const signer = await new ethers.BrowserProvider(S.evm.provider).getSigner();
        const req = { to: plan.to, data: plan.data, value: plan.value };
        if (S.quote.gas) req.gasLimit = (S.quote.gas * 15n) / 10n;
        const tx = await signer.sendTransaction(req);
        steps[0].state = 'done'; steps[1].state = 'active'; steps[1].sub = 'Waiting for the block…'; progress(steps);
        const rc = await tx.wait();
        if (!rc || rc.status !== 1) throw new Error('Transaction reverted');
        hash = tx.hash;
      }
      entry.hash = hash; upsertHist(entry);
      steps[0].state = 'done'; steps[1].state = 'done';
      steps[1].sub = src.explorerTx ? `<a href="${src.explorerTx}${hash}" target="_blank" rel="noopener">View transaction ↗</a>` : '';
      steps[2].state = 'active'; steps[2].sub = (to === 'hubevm' || (from === 'hubevm' && to === 'assethub')) ? 'Same chain — should be instant.' : 'XCM message in flight (usually 20–40 s)…';
      progress(steps);

      const got = await watchDelivery(to, assetKey, rcpt.id, before);
      if (got !== null) {
        steps[2].state = 'done'; steps[2].sub = `+${fmt(got, a.decimals)} ${esc(a.symbol)} at ${esc(short(rcpt.display, 8))}`;
        entry.status = 'delivered'; entry.received = plain(got, a.decimals);
      } else {
        steps[2].state = ''; steps[2].sub = 'Still in flight. It will arrive on its own — check the explorer later.';
      }
      upsertHist(entry);
      progress(steps, afterActions(to, assetKey, got, rcpt));
      S.amount = ''; $('amount').value = '';
      toast(got !== null ? 'Transfer delivered' : 'Transfer sent');
    } catch (e) {
      const msg = e.code === 4001 || e.code === 'ACTION_REJECTED' || /reject|cancel/i.test(e.message || '') ? 'You rejected the request.' : esc(e.shortMessage || e.message || String(e));
      const i = steps.findIndex((s) => s.state === 'active');
      steps[i < 0 ? 0 : i].state = 'fail'; steps[i < 0 ? 0 : i].sub = msg;
      progress(steps);
      if (entry.hash) { entry.status = 'failed'; upsertHist(entry); }
    } finally {
      S.busy = false; loadBalances(); scheduleQuote();
    }
  }

  async function watchDelivery(to, key, rcptId, before) {
    if (before === null) return null;
    const until = Date.now() + 180000;
    while (Date.now() < until) {
      try {
        const now = await destRaw(to, key, rcptId);
        if (now > before) return now - before;
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 4000));
    }
    return null;
  }

  function afterActions(to, key, got, rcpt) {
    const out = [];
    const mine = S.evm.address && rcpt.display.toLowerCase() === S.evm.address.toLowerCase();
    if (to === 'hubevm' && mine && got && key === 'USDT' && cfg.assets.USDT.sonevibe) out.push(`<button class="pt-small-btn accent" data-wrap="USDT" data-amt="${got}">Wrap to SoneVibe USDT for the DEX</button>`);
    if (to === 'hubevm' && mine && got && key === 'DOT') out.push(`<button class="pt-small-btn accent" data-wrap="DOT" data-amt="${got}">Wrap to WDOT for the DEX</button>`);
    if (to === 'hubevm') out.push('<a class="pt-small-btn" href="swap.html">Open Swap</a>');
    out.push('<button class="pt-small-btn" data-act="new">New transfer</button>');
    return out.join('');
  }

  const WDOT = '0xaf905e66038EcE89e03D843B35a11D262053B630';
  async function wrapForDex(key, amount, btn) {
    btn.disabled = true; const label = btn.textContent;
    try {
      await ensureHubChain();
      const signer = await new ethers.BrowserProvider(S.evm.provider).getSigner();
      const me = await signer.getAddress();
      if (key === 'DOT') {
        btn.innerHTML = '<span class="spin"></span> Wrapping…';
        const w = new ethers.Contract(WDOT, E.WETH_ABI, signer);
        await (await w.deposit({ value: BigInt(amount) * E.DOT_EVM_RATIO })).wait();
      } else {
        const wrapper = cfg.assets.USDT.sonevibe.wrapper;
        const token = new ethers.Contract(cfg.assets.USDT.on.hubevm.address, E.ERC20_ABI, signer);
        if ((await token.allowance(me, wrapper)) < BigInt(amount)) {
          btn.innerHTML = '<span class="spin"></span> Approve…';
          await (await token.approve(wrapper, BigInt(amount))).wait();
        }
        btn.innerHTML = '<span class="spin"></span> Wrapping…';
        await (await new ethers.Contract(wrapper, E.WRAPPER_ABI, signer).depositFor(me, BigInt(amount))).wait();
      }
      btn.textContent = '✓ Ready to trade on SoneVibe'; toast('Wrapped');
    } catch (e) {
      btn.disabled = false; btn.textContent = label;
      toast(e.code === 'ACTION_REJECTED' ? 'Rejected' : 'Wrap failed: ' + (e.shortMessage || e.message));
    }
  }

  async function watchAsset(key) {
    const a = cfg.assets[key];
    try {
      await ensureHubChain();
      await S.evm.provider.request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address: a.on.hubevm.address, symbol: a.symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 11), decimals: a.decimals } } });
    } catch { toast('Your wallet did not add the token'); }
  }

  async function mapAccount(btn) {
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Mapping…';
    try {
      const ah = await getApi('assethub');
      const injector = await window.polkadotExtensionDapp.web3FromSource(S.sub.source);
      await new Promise((resolve, reject) => {
        ah.tx.revive.mapAccount().signAndSend(S.sub.address, { signer: injector.signer }, (res) => {
          if (res.dispatchError) reject(new Error(decodeDispatchError(ah, res.dispatchError)));
          else if (res.status.isInBlock) resolve();
        }).catch(reject);
      });
      S.sub.mapped = true; toast('Account mapped'); render();
    } catch (e) { btn.disabled = false; btn.textContent = 'Map account'; toast(/reject|cancel/i.test(e.message) ? 'Rejected' : e.message); }
  }

  /* ---------------- modal ---------------- */
  let modalPick = null, modalItems = [];
  function openModal(title, items, onPick, placeholder, subtitle) {
    modalItems = items; modalPick = onPick;
    $('modalTitle').textContent = title;
    $('modalSub').textContent = subtitle || ''; $('modalSub').style.display = subtitle ? '' : 'none';
    $('modalSearch').value = ''; $('modalSearch').placeholder = placeholder || 'Search';
    $('modalSearch').style.display = items.length > 8 ? '' : 'none';
    drawModal('');
    $('modal').classList.add('open');
    setTimeout(() => (items.length > 8 ? $('modalSearch') : $('modalX')).focus(), 30);
  }
  function drawModal(q) {
    const f = q.trim().toLowerCase();
    let last = null; let html = '';
    modalItems.filter((it) => !f || it.search.toLowerCase().includes(f)).forEach((it) => {
      if (it.group && it.group !== last) { html += `<div class="pt-grp">${esc(it.group)}</div>`; last = it.group; }
      html += `<button class="pt-li${it.sel ? ' sel' : ''}" data-v="${esc(it.value)}"${it.disabled ? ' disabled' : ''}>${it.html}</button>`;
    });
    $('modalList').innerHTML = html || '<div class="pt-empty">Nothing found</div>';
  }
  function closeModal() { $('modal').classList.remove('open'); }

  function chainItems(side) {
    const other = side === 'from' ? S.to : S.from;
    return Object.values(cfg.chains)
      .filter((c) => !(side === 'from' && c.destinationOnly))
      .map((c) => {
        const lane = side === 'from' ? laneInfo(c.id, other) : laneInfo(other, c.id);
        const tag = c.id === other ? '' : lane.kind === 'native' ? '<span style="color:#6ee7a3">Native</span>' : lane.kind === 'partner' ? '<span style="color:#d0a8ff">Partner</span>' : '<span style="color:#666c8a">—</span>';
        return {
          value: c.id, group: c.eco, search: c.name + ' ' + c.eco, sel: c.id === (side === 'from' ? S.from : S.to),
          html: `${chainIcon(c.id)}<div class="n"><b>${esc(c.name)}</b><span>${esc(c.blurb)}</span></div><div class="v">${tag}</div>`
        };
      });
  }

  function assetItems() {
    const lane = laneInfo(S.from, S.to);
    let keys = lane.list.slice();
    if (cfg.chains[S.from].kind !== 'external') keys = [...new Set([...keys, ...Object.keys(cfg.assets).filter((k) => hasAsset(S.from, k))])];
    const order = (k) => (lane.list.includes(k) ? 0 : 1);
    const balOf = (k) => S.bal[S.from + ':' + k] || 0n;
    keys.sort((x, y) => order(x) - order(y) || (balOf(y) > 0n) - (balOf(x) > 0n));
    return keys.map((k) => {
      const a = cfg.assets[k]; const ok = lane.list.includes(k);
      const v = S.bal[S.from + ':' + k];
      const bal = sourceAddress() && v !== undefined && v !== null ? fmt(v, a.decimals, 4) : '';
      return {
        value: k, group: ok ? (lane.kind === 'partner' ? 'Via partner bridge' : 'Available on this route') : 'Not on this route',
        search: a.symbol + ' ' + a.name, sel: k === S.asset,
        html: `${assetIcon(k)}<div class="n"><b>${esc(a.symbol)}</b><span>${esc(a.name)}</span></div><div class="v">${bal}${!ok ? '<span style="color:#666c8a">unavailable</span>' : ''}</div>`
      };
    });
  }

  function setChains(from, to) {
    if (from === to) return;
    if (to !== S.to) { S.recipientTouched = false; S.recipient = ''; }
    S.from = from; S.to = to;
    ensureAsset(); $('progress').innerHTML = '';
    if (needsAstar(from, to)) getApi('astar').then(() => { loadBalances(); scheduleQuote(); }, () => {});
    render(); scheduleQuote();
  }

  /* ---------------- route map ---------------- */
  function renderMatrix() {
    const ids = Object.keys(cfg.chains);
    const head = '<tr><th>From ↓ / To →</th>' + ids.map((id) => `<th>${chainIcon(id, true)}${esc(cfg.chains[id].short)}</th>`).join('') + '</tr>';
    const rows = ids.filter((id) => !cfg.chains[id].destinationOnly).map((f) => {
      const cells = ids.map((t) => {
        if (f === t) return '<td class="none">·</td>';
        const lane = laneInfo(f, t);
        if (lane.kind === 'native') return `<td><button class="cell native" data-load="${f},${t}"><b>XCM</b><span>${lane.list.length} asset${lane.list.length > 1 ? 's' : ''}</span></button></td>`;
        if (lane.kind === 'partner') return `<td><button class="cell partner" data-load="${f},${t}"><b>${esc(lane.partners[0].name.split(' ·')[0])}</b><span>${esc(lane.partners[0].eta)}</span></button></td>`;
        return '<td class="none">—</td>';
      }).join('');
      return `<tr><td><span style="display:inline-flex;align-items:center;gap:8px">${chainIcon(f, true)}<b>${esc(cfg.chains[f].short)}</b></span></td>${cells}</tr>`;
    }).join('');
    $('matrix').innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
    $('orbit').innerHTML = ['Polkadot', 'Astar', 'Soneium', 'Ethereum'].map((eco) => {
      const c = Object.values(cfg.chains).find((x) => x.eco === eco);
      return `<span class="pt-pill">${chainIcon(c.id, true)}${eco}</span>`;
    }).join('');
  }

  /* ---------------- url ---------------- */
  function syncUrl() {
    const p = new URLSearchParams(location.search);
    p.set('from', S.from); p.set('to', S.to); p.set('asset', S.asset);
    history.replaceState(null, '', location.pathname + '?' + p.toString() + location.hash);
  }
  function readUrl() {
    const p = new URLSearchParams(location.search);
    const f = p.get('from'), t = p.get('to'), a = p.get('asset');
    if (f && cfg.chains[f] && !cfg.chains[f].destinationOnly) S.from = f;
    if (t && cfg.chains[t] && t !== S.from) S.to = t;
    if (a && cfg.assets[a]) S.asset = a;
    ensureAsset();
  }

  /* ---------------- events ---------------- */
  function bind() {
    $('fromBtn').onclick = () => openModal('Send from', chainItems('from'), (v) => setChains(v, v === S.to ? S.from : S.to));
    $('toBtn').onclick = () => openModal('Send to', chainItems('to'), (v) => {
      if (v === S.from) { if (cfg.chains[S.to].destinationOnly) return toast('Astar EVM can only receive'); setChains(S.to, S.from); } else setChains(S.from, v);
    });
    $('flip').onclick = () => {
      if (cfg.chains[S.to].destinationOnly) return toast(`${cfg.chains[S.to].name} can receive only. Sending from it needs Astar's EVM withdrawal flow.`);
      setChains(S.to, S.from);
    };
    $('assetBtn').onclick = () => openModal('Select asset', assetItems(), (v) => { S.asset = v; S.amount = ''; $('amount').value = ''; $('progress').innerHTML = ''; render(); scheduleQuote(); }, 'Search DOT, USDt, ETH…');
    $('amount').addEventListener('input', (e) => {
      const dec = cfg.assets[S.asset].decimals;
      let v = e.target.value.replace(',', '.').replace(/[^\d.]/g, '');
      const parts = v.split('.'); if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
      if (parts[1] && parts[1].length > dec) v = parts[0] + '.' + parts[1].slice(0, dec);
      e.target.value = v; S.amount = v; renderSummary(); renderCta(); scheduleQuote();
    });
    $('quick').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const m = maxSendable(); if (m === null) return;
      if (m === 0n) { toast(`No ${cfg.assets[S.asset].symbol} to send on ${cfg.chains[S.from].short}`); return; }
      const v = (m * BigInt(b.dataset.p)) / 100n;
      S.amount = plain(v, cfg.assets[S.asset].decimals); $('amount').value = S.amount; render(); scheduleQuote();
    });
    $('recipient').addEventListener('input', (e) => { S.recipient = e.target.value.trim(); S.recipientTouched = true; S.rcpt = null; S.rcptErr = ''; renderRecipient(); renderCta(); scheduleQuote(); });
    $('useMine').onclick = () => { S.recipientTouched = false; S.recipient = defaultRecipient(); $('recipient').value = S.recipient; render(); scheduleQuote(); };
    $('cta').onclick = () => {
      const act = $('cta').dataset.action;
      if (act === 'partner') window.open(currentLane().partner.url, '_blank', 'noopener');
      else if (act === 'connect-sub') chooseSub();
      else if (act === 'connect-evm') chooseEvm();
      else if (act === 'send') send();
    };
    $('btnSub').onclick = () => (S.sub.address ? openMenu('sub') : chooseSub());
    $('btnEvm').onclick = () => (S.evm.address ? openMenu('evm') : chooseEvm());
    $('wmBackdrop').onclick = closeMenu;
    window.addEventListener('resize', () => menuKind && placeMenu());
    $('walletMenu').addEventListener('click', async (e) => {
      const acc = e.target.closest('[data-wm-acct]');
      if (acc) { if (acc.dataset.wmAcct !== S.sub.address) { await selectSub(acc.dataset.wmAcct); toast('Account switched'); } return; }
      const b = e.target.closest('[data-wm]'); if (!b) return;
      const a = b.dataset.wm;
      if (a === 'close') closeMenu();
      else if (a === 'copy') copy(b.dataset.v);
      else if (a === 'switch-sub') chooseSub();
      else if (a === 'switch-evm') chooseEvm();
      else if (a === 'disconnect-sub') disconnectSub();
      else if (a === 'disconnect-evm') disconnectEvm();
      else if (a === 'switch-net') { try { await ensureHubChain(); renderWalletButtons(); refreshMenu(); } catch (err) { toast(err.code === 4001 ? 'Rejected in your wallet' : 'Could not switch network'); } }
    });
    $('refresh').onclick = () => loadBalances();
    $('clearHist').onclick = () => saveHist([]);
    $('modalX').onclick = closeModal;
    $('modal').addEventListener('click', (e) => {
      if (e.target === $('modal')) return closeModal();
      const li = e.target.closest('.pt-li'); if (!li || li.disabled) return;
      closeModal(); modalPick && modalPick(li.dataset.v);
    });
    $('modalSearch').addEventListener('input', (e) => drawModal(e.target.value));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeMenu(); } });

    document.addEventListener('click', (e) => {
      const c = e.target.closest('[data-copy]'); if (c) { copy(c.dataset.copy); return; }
      const w = e.target.closest('[data-wrap]'); if (w) { wrapForDex(w.dataset.wrap, w.dataset.amt, w); return; }
      const wa = e.target.closest('[data-watch]'); if (wa) { watchAsset(wa.dataset.watch); return; }
      const l = e.target.closest('[data-load]');
      if (l) {
        const [f, t, a] = l.dataset.load.split(',');
        if (a) S.asset = a;
        setChains(f, t);
        document.getElementById('transfer').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act) {
        const v = act.dataset.act;
        if (v === 'connect-sub') chooseSub();
        if (v === 'connect-evm') chooseEvm();
        if (v === 'new') { $('progress').innerHTML = ''; render(); }
      }
      if (e.target.id === 'mapBtn') mapAccount(e.target);
    });
    document.addEventListener('change', (e) => { if (e.target.id === 'subSel') selectSub(e.target.value); });
  }

  /* ---------------- boot ---------------- */
  function boot() {
    $('year').textContent = new Date().getFullYear();
    renderHistory();
    if (!libsOk) {
      $('cta').textContent = 'Libraries failed to load — refresh the page';
      renderAccounts();
      return;
    }
    readUrl();
    bind();
    renderMatrix();
    render();
    checkEvmRpc();
    getApi('assethub').then(() => { render(); loadBalances(); scheduleQuote(); }, () => render());
    if (needsAstar(S.from, S.to)) getApi('astar').then(() => { render(); scheduleQuote(); }, () => {});
    if (localStorage.getItem(SUB_SRC_KEY) || localStorage.getItem(SUB_KEY)) setTimeout(() => connectSub(true), 300);
    setTimeout(() => connectEvm(true), 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
