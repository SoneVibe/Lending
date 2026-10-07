/**
 * ==============================================================================
 * VIBE POOLS LOGIC - PRO TIER ARCHITECTURE (PATCHED)
 * ==============================================================================
 * - Shows ALL cTokens from networks.json in selector (always).
 * - Adds token import by address with preview + confirm (stored per chainId).
 * - Does NOT block adding liquidity for any selection (per your request).
 */

let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let selectedProvider = null;

// Pool Specific State
let tokenList = [];
let isAddMode = true;
let currentPairAddress = null;
let currentReserves = { rA: 0n, rB: 0n };
let currentLpBalance = 0n;
let currentTotalSupply = 0n;

// Slippage
let currentSlippage = 0.5;

// Add-liquidity state: the field the user typed is exact; the other side is derived from reserves.
let poolIndependent = 'A';
let currentWETH = null;
let rawBalA = null;
let rawBalB = null;
let busy = false;
let balSeq = 0;
let readProvider = null;
let readProviderChain = null;
let poolRefreshTimer = null;

const PAIR_ABI = [
  "function getReserves() view returns (uint112, uint112, uint32)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

const getEl = (id) => document.getElementById(id);

// Wallet provider when connected, otherwise a read-only RPC so the pool is visible before connecting.
function getReader() {
  if (provider && signer) return provider;
  if (!ACTIVE || !ACTIVE.rpcUrls || !ACTIVE.rpcUrls.length) return null;
  if (!readProvider || readProviderChain !== ACTIVE.chainId) {
    readProvider = new ethers.JsonRpcProvider(ACTIVE.rpcUrls[0], undefined, { staticNetwork: true });
    readProviderChain = ACTIVE.chainId;
  }
  return readProvider;
}

const trimZeros = (s) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);

function cleanAmount(v) {
  let s = String(v || '').replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const i = s.indexOf('.');
  if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
  if (s.startsWith('.')) s = '0' + s;
  return s;
}

function toWei(str, decimals) {
  const s = cleanAmount(str);
  if (!s) return null;
  const [i, f = ''] = s.split('.');
  try { return ethers.parseUnits(f ? `${i || '0'}.${f.slice(0, decimals)}` : (i || '0'), decimals); }
  catch { return null; }
}

// Display only (6 significant decimals); transactions always use the exact amounts from desiredAmounts().
function fmtDisplay(wei, decimals) {
  const s = ethers.formatUnits(wei, decimals);
  const [i, f = ''] = s.split('.');
  if (i !== '0') return trimZeros(`${i}.${f.slice(0, 6)}`);
  const lead = (f.match(/^0*/) || [''])[0].length;
  return trimZeros(`0.${f.slice(0, lead + 6)}`);
}

function pairTokens() {
  const a = getEl('tokenA'), b = getEl('tokenB');
  return [a ? tokenList[a.value] : null, b ? tokenList[b.value] : null];
}

const hasReserves = () => !!currentPairAddress && currentReserves.rA > 0n && currentReserves.rB > 0n;

function syncDependent() {
  if (!hasReserves()) return;
  const [tA, tB] = pairTokens();
  if (!tA || !tB) return;
  const fromA = poolIndependent === 'A';
  const src = getEl(fromA ? 'amountA' : 'amountB');
  const dst = getEl(fromA ? 'amountB' : 'amountA');
  if (!src || !dst) return;
  const wei = toWei(src.value, fromA ? tA.decimals : tB.decimals);
  if (!wei) { dst.value = ''; return; }
  const out = fromA ? (wei * currentReserves.rB) / currentReserves.rA : (wei * currentReserves.rA) / currentReserves.rB;
  dst.value = out > 0n ? fmtDisplay(out, fromA ? tB.decimals : tA.decimals) : '';
}

// Uniswap V2 quote() on the latest reserves, so the router takes the amountADesired/amountBOptimal branch.
function desiredAmounts() {
  const [tA, tB] = pairTokens();
  if (!tA || !tB) return null;
  let a = toWei(getEl('amountA')?.value, tA.decimals);
  let b = toWei(getEl('amountB')?.value, tB.decimals);
  if (hasReserves()) {
    if (poolIndependent === 'A') { if (!a) return null; b = (a * currentReserves.rB) / currentReserves.rA; }
    else { if (!b) return null; a = (b * currentReserves.rA) / currentReserves.rB; }
  }
  if (!a || !b) return null;
  return { tA, tB, a, b };
}

function sameToken(tA, tB) {
  if (!tA || !tB) return false;
  if (tA === tB) return true;
  const addr = (t) => (t.isNative ? (currentWETH || 'native') : t.address || '').toLowerCase();
  return addr(tA) === addr(tB);
}

// While typing an add amount, show the share of the pool after the deposit (mint = min(a·S/rA, b·S/rB)).
function refreshShare() {
  const el = getEl('sharePool');
  if (!el) return;
  const d = isAddMode ? desiredAmounts() : null;
  if (!currentPairAddress) { el.textContent = d ? '100%' : '--%'; return; }
  let lp = currentLpBalance, ts = currentTotalSupply;
  if (d && hasReserves() && ts > 0n) {
    const la = (d.a * ts) / currentReserves.rA, lb = (d.b * ts) / currentReserves.rB;
    const minted = la < lb ? la : lb;
    lp += minted; ts += minted;
  } else if (d && !hasReserves()) {
    el.textContent = '100%';
    return;
  }
  const pct = ts > 0n ? Number((lp * 1000000n) / ts) / 10000 : 0;
  el.textContent = pct > 0 && pct < 0.01 ? '<0.01%' : pct.toFixed(2) + '%';
}

function refreshMainButton() {
  refreshShare();
  const btn = getEl('btnMainAction');
  if (!btn || busy) return;
  const set = (text, disabled = false) => { btn.textContent = text; btn.disabled = disabled; };
  btn.classList.toggle('is-danger', !isAddMode && !!signer);
  if (!signer) return set('Connect Wallet');
  const [tA, tB] = pairTokens();
  if (!tA || !tB) return set('Select tokens', true);
  if (sameToken(tA, tB)) return set('Select two different tokens', true);
  if (!isAddMode) {
    if (!currentPairAddress || currentLpBalance === 0n) return set('No liquidity to remove', true);
    if (Number(getEl('removeRange')?.value || 0) === 0) return set('Select an amount', true);
    return set('Remove liquidity');
  }
  const d = desiredAmounts();
  if (!d) return set('Enter an amount', true);
  if (rawBalA !== null && d.a > rawBalA) return set(`Insufficient ${tA.symbol} balance`, true);
  if (rawBalB !== null && d.b > rawBalB) return set(`Insufficient ${tB.symbol} balance`, true);
  return set(hasReserves() ? 'Add liquidity' : 'Create pool & add liquidity');
}

function txUrl(hash) {
  const base = ACTIVE && ACTIVE.blockExplorerUrls && ACTIVE.blockExplorerUrls[0];
  return base && hash ? `${base.replace(/\/$/, '')}/tx/${hash}` : null;
}

function showStatus(text, tone = 'warning', href = null) {
  const s = getEl('txStatus');
  if (!s) return;
  s.style.display = 'block';
  s.style.color = `var(--${tone})`;
  s.textContent = text;
  if (href) {
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'View on explorer ↗';
    s.append(' · ', a);
  }
}

function friendlyError(e) {
  const msg = String((e && (e.reason || e.shortMessage || (e.info && e.info.error && e.info.error.message) || e.message)) || '');
  if ((e && (e.code === 'ACTION_REJECTED' || e.code === 4001)) || /user (rejected|denied)/i.test(msg)) return 'Transaction rejected in wallet';
  if (/INSUFFICIENT_[AB]_AMOUNT/.test(msg)) return 'The pool price moved beyond your slippage tolerance. Try again or raise slippage.';
  if (/EXPIRED/.test(msg)) return 'Transaction expired. Please try again.';
  if (/insufficient funds/i.test(msg)) return `Not enough ${(ACTIVE && ACTIVE.nativeCurrency && ACTIVE.nativeCurrency.symbol) || 'native token'} to pay for gas`;
  if (/INSUFFICIENT_LIQUIDITY_MINTED/.test(msg)) return 'Amount too small to mint LP tokens';
  if (/INSUFFICIENT_LIQUIDITY_BURNED/.test(msg)) return 'Amount too small to remove';
  if (/TRANSFER_FROM_FAILED|exceeds (balance|allowance)/i.test(msg)) return 'Token transfer failed. Check your balance and approval.';
  return e && e.reason ? `Transaction failed: ${e.reason}` : 'Transaction failed';
}

// Re-reads the selected pair right before a transaction so amounts match on-chain reserves.
async function refreshReserves() {
  if (!currentPairAddress) return;
  const [tA] = pairTokens();
  if (!tA) return;
  const pair = new ethers.Contract(currentPairAddress, PAIR_ABI, getReader());
  const [res, ts, t0, bal] = await Promise.all([
    pair.getReserves(), pair.totalSupply(), pair.token0(),
    userAddress ? pair.balanceOf(userAddress) : Promise.resolve(0n)
  ]);
  const addrA = (tA.isNative ? currentWETH : tA.address) || '';
  const isA0 = t0.toLowerCase() === addrA.toLowerCase();
  currentReserves = { rA: isA0 ? res[0] : res[1], rB: isA0 ? res[1] : res[0] };
  currentTotalSupply = ts;
  currentLpBalance = bal;
}

async function setMax(side) {
  const [tA, tB] = pairTokens();
  const t = side === 'A' ? tA : tB;
  let bal = side === 'A' ? rawBalA : rawBalB;
  if (!t || bal === null) return;
  if (t.isNative) {
    try {
      const fd = await getReader().getFeeData();
      const gp = fd.gasPrice ?? fd.maxFeePerGas ?? 0n;
      const reserve = gp * 400000n * 2n;
      bal = bal > reserve ? bal - reserve : 0n;
    } catch { /* keep full balance */ }
  }
  poolIndependent = side;
  getEl(side === 'A' ? 'amountA' : 'amountB').value = trimZeros(ethers.formatUnits(bal, t.decimals));
  syncDependent();
  refreshMainButton();
}

// pools.html?pair=0x... (links from Home and Analytics) preselects that pair's tokens.
async function pairFromUrl() {
  const q = new URLSearchParams(window.location.search).get('pair');
  if (!q || !ethers.isAddress(q) || !ACTIVE || !ACTIVE.router) return null;
  try {
    const rd = getReader();
    const pair = new ethers.Contract(q, PAIR_ABI, rd);
    const [t0, t1, weth] = await Promise.all([
      pair.token0(), pair.token1(),
      new ethers.Contract(ACTIVE.router, window.POOL_ROUTER_ABI, rd).WETH()
    ]);
    const find = (addr) => {
      if (addr.toLowerCase() === weth.toLowerCase()) {
        const n = tokenList.findIndex((t) => t.isNative);
        if (n >= 0) return n;
      }
      return tokenList.findIndex((t) => t.listType !== 'ctoken' && (t.address || '').toLowerCase() === addr.toLowerCase());
    };
    const a = find(t0), b = find(t1);
    return a >= 0 && b >= 0 && a !== b ? [a, b] : null;
  } catch { return null; }
}

// -------------------- IMPORT TOKEN: PRO --------------------
const ERC20_META_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

let importDraft = null; // { address, symbol, name, decimals }

function importStorageKey() {
  const cid = ACTIVE?.chainId ?? "unknown";
  return `VIBE_POOLS_IMPORTED_${cid}`;
}

function loadImported() {
  try {
    const raw = localStorage.getItem(importStorageKey());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveImported(entry) {
  const addr = (entry?.address || "").toLowerCase();
  if (!addr) return;

  const list = loadImported();
  if (!list.find(x => (x.address || "").toLowerCase() === addr)) {
    list.push(entry);
    localStorage.setItem(importStorageKey(), JSON.stringify(list));
  }
}

function openImportModal() {
  const m = getEl("importModal");
  if (m) m.classList.add("open");
}

function closeImportModal() {
  const m = getEl("importModal");
  if (m) m.classList.remove("open");
  importDraft = null;
}

function setImportError(msg) {
  const el = getEl("importError");
  if (!el) return;
  if (!msg) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "block";
  el.textContent = msg;
}

function setImportWarning(show) {
  const el = getEl("importWarning");
  if (!el) return;
  el.style.display = show ? "block" : "none";
}

function setPreviewLoading(loading) {
  const btn = getEl("btnConfirmImport");
  if (btn) btn.disabled = loading;
}

async function buildImportDraft(address) {
  if (!provider) throw new Error("Provider not ready");
  if (!ethers.isAddress(address)) throw new Error("Invalid address");

  // Default warning ON; we disable it if metadata loads fine
  setImportWarning(true);

  const c = new ethers.Contract(address, ERC20_META_ABI, provider);

  // Some non-ERC20 addresses will revert here. That's fine (you asked ANY address; preview blocks if not readable)
  const [name, symbol, decimals] = await Promise.all([
    c.name(),
    c.symbol(),
    c.decimals()
  ]);

  setImportWarning(false);

  return {
    address,
    name: String(name),
    symbol: String(symbol),
    decimals: Number(decimals),
    icon: "icons/token.svg",
    listType: "import"
  };
}

function renderImportPreview(draft) {
  const addrEl = getEl("importAddrPreview");
  const symEl = getEl("importSymbolPreview");
  const nameEl = getEl("importNamePreview");
  const decEl = getEl("importDecimalsPreview");
  const icoEl = getEl("importIconPreview");

  if (addrEl) addrEl.textContent = draft?.address ?? "--";
  if (symEl) symEl.textContent = draft?.symbol ?? "--";
  if (nameEl) nameEl.textContent = draft?.name ?? "--";
  if (decEl) decEl.textContent = draft?.decimals?.toString?.() ?? "--";
  if (icoEl) icoEl.src = draft?.icon || "icons/token.svg";
}

function wireImportUI() {
  const btnOpen = getEl("btnOpenImport");
  const input = getEl("importAddressInput");
  const btnClose = getEl("btnCloseImport");
  const btnCancel = getEl("btnCancelImport");
  const btnConfirm = getEl("btnConfirmImport");

  if (btnClose) btnClose.onclick = closeImportModal;
  if (btnCancel) btnCancel.onclick = closeImportModal;

  if (btnOpen && input) {
    btnOpen.onclick = async () => {
      const addr = (input.value || "").trim();
      setImportError("");
      renderImportPreview(null);
      setPreviewLoading(true);

      try {
        if (!provider) throw new Error("Connect wallet first (provider required)");
        if (!ACTIVE) throw new Error("Network not ready");

        openImportModal();
        const draft = await buildImportDraft(addr);
        importDraft = draft;
        renderImportPreview(draft);
      } catch (e) {
        console.error(e);
        openImportModal();
        setImportError(e?.reason || e?.shortMessage || e?.message || "Import failed");
        // Keep warning visible when error happens
        setImportWarning(true);
      } finally {
        setPreviewLoading(false);
      }
    };
  }

  if (btnConfirm) {
    btnConfirm.onclick = async () => {
      try {
        if (!importDraft) throw new Error("No token loaded");
        // Save & refresh list
        saveImported(importDraft);
        closeImportModal();

        // Rebuild token list so it appears immediately
        await initPoolsInterface();

        // clear input
        const input2 = getEl("importAddressInput");
        if (input2) input2.value = "";
      } catch (e) {
        console.error(e);
        setImportError(e?.message || "Confirm failed");
      }
    };
  }

  // Close when clicking overlay
  window.addEventListener("click", (e) => {
    const m = getEl("importModal");
    if (m && e.target === m) closeImportModal();
  });
}

// -------------------- UI HELPERS --------------------
const updateStatus = (connected) => {
  const dot = getEl('statusDot');
  const txt = getEl('connStatus');
  const btn = getEl('btnConnect');
  const btnAction = getEl('btnMainAction');

  if (connected && userAddress) {
    dot.style.color = "var(--success)";
    txt.textContent = "Online";

    btn.textContent = userAddress.substring(0, 6) + "..." + userAddress.substring(38);
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-connected');

    if (!btn.querySelector('span')) {
      const arrow = document.createElement("span");
      arrow.textContent = "▼";
      arrow.style.fontSize = "0.7em";
      arrow.style.marginLeft = "6px";
      btn.appendChild(arrow);
    }

    getEl('dropdownAddress').textContent = userAddress.substring(0, 8) + "..." + userAddress.substring(38);

    refreshMainButton();
  } else {
    dot.style.color = "var(--danger)";
    txt.textContent = "Disconnected";

    btn.textContent = "Connect Wallet";
    btn.classList.remove('btn-connected');
    btn.classList.add('btn-primary');
    if (btn.lastChild && btn.lastChild.tagName === 'SPAN') btn.removeChild(btn.lastChild);

    refreshMainButton();
  }
};

window.setPoolMode = (mode) => {
  isAddMode = (mode === 'add');

  const tabAdd = getEl('tabAdd');
  const tabRemove = getEl('tabRemove');
  const panelAdd = getEl('panelAdd');
  const panelRemove = getEl('panelRemove');

  if (tabAdd) { tabAdd.classList.toggle('active', isAddMode); tabAdd.setAttribute('aria-selected', String(isAddMode)); }
  if (tabRemove) { tabRemove.classList.toggle('active', !isAddMode); tabRemove.setAttribute('aria-selected', String(!isAddMode)); }
  if (panelAdd) panelAdd.style.display = isAddMode ? 'block' : 'none';
  if (panelRemove) panelRemove.style.display = isAddMode ? 'none' : 'block';

  refreshMainButton();
  updateBalances();
};

window.setRemove = (percent) => {
  getEl('removeRange').value = percent;
  handleRemoveInput();
};

window.setSlippage = (val, fromCustom = false) => {
  const v = Number(val);
  if (!isFinite(v) || v <= 0 || v > 50) return;
  currentSlippage = v;
  const disp = getEl('slippageDisplay');
  if (disp) disp.textContent = v + "%";

  document.querySelectorAll('.pl-slip-btn').forEach((b) => b.classList.toggle('is-active', !fromCustom && Number(b.dataset.slip) === v));
  const custom = getEl('slippageCustom');
  if (custom) {
    if (!fromCustom) custom.value = '';
    custom.parentElement.classList.toggle('is-active', fromCustom);
  }
  const warn = getEl('slippageWarn');
  if (warn) {
    const m = v < 0.1 ? 'Very low slippage: the transaction may fail if the pool price moves.'
      : v > 5 ? 'High slippage: you may add liquidity at a worse price.' : '';
    warn.textContent = m;
    warn.hidden = !m;
  }
};

// -------------------- INIT APP --------------------
document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  try {
    // Use swap config if available (injects swapTokenList)
    NETWORKS_DATA = window.loadSwapConfig ? await window.loadSwapConfig() : await window.loadNetworks();

    initNetworkSelector();

    // Default pick
    ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == "1868" && n.enabled);

    // Wire import UI early (modal does connect checks)
    wireImportUI();

    if (window.checkAutoConnect) {
      await window.checkAutoConnect(connectWallet);
    }
    if (!signer) await initPoolsInterface();
  } catch (e) { console.error("Init Error", e); }
}

function initNetworkSelector() {
  const sel = getEl("networkSelect");
  if (!NETWORKS_DATA || !sel) return;

  sel.innerHTML = "";
  Object.values(NETWORKS_DATA).forEach(n => {
    if (n.enabled) {
      const opt = document.createElement("option");
      opt.value = n.chainId;
      opt.textContent = n.label;
      sel.appendChild(opt);
    }
  });

  if (ACTIVE) sel.value = ACTIVE.chainId;

  sel.onchange = async (e) => {
    const targetChainId = e.target.value;
    if (userAddress) await switchNetwork(targetChainId);
    else ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);

    // Refresh token list because import storage is per chain
    await initPoolsInterface();
  };
}

// -------------------- WALLET --------------------
function openWalletModal() {
  const modal = getEl('walletModal');
  const list = getEl('walletList');
  if (!modal || !list) return;

  list.innerHTML = '';

  if (window.WALLET_CONFIG) {
    window.WALLET_CONFIG.forEach(w => {
      const isInstalled = w.check();
      const btn = document.createElement('div');
      btn.className = 'wallet-btn';
      btn.innerHTML = `
        <div class="wallet-info">
          <img src="${w.icon}" alt="${w.name}" style="width:32px; height:32px; object-fit:contain;">
          <span>${w.name}</span>
        </div>
        ${isInstalled ? '<span style="color:var(--success); font-size:1.2rem;">›</span>' : '<span class="wallet-badge">Install</span>'}
      `;

      btn.onclick = async () => {
        if (!isInstalled) { window.open(w.installUrl, '_blank'); return; }
        selectedProvider = w.getProvider();
        closeWalletModal();
        await connectWallet();
      };

      list.appendChild(btn);
    });
  }
  modal.classList.add('open');
}

window.closeWalletModal = () => {
  const modal = getEl('walletModal');
  if (modal) modal.classList.remove('open');
};

window.onclick = (e) => {
  const modal = getEl('walletModal');
  if (e.target === modal) closeWalletModal();
  const accountDropdown = getEl("accountDropdown");
  if (accountDropdown && accountDropdown.classList.contains('show') && !e.target.closest('#btnConnect')) {
    accountDropdown.classList.remove('show');
  }
};

const btnConnect = getEl("btnConnect");
const accountDropdown = getEl("accountDropdown");

if (btnConnect) {
  btnConnect.onclick = (e) => {
    e.stopPropagation();
    if (userAddress) {
      if (accountDropdown) accountDropdown.classList.toggle("show");
    } else {
      openWalletModal();
    }
  };
}

if (getEl("btnCopyAddress")) getEl("btnCopyAddress").onclick = () => { navigator.clipboard.writeText(userAddress); alert("Copied!"); };
if (getEl("btnViewExplorer")) getEl("btnViewExplorer").onclick = () => { if (ACTIVE) window.open(ACTIVE.blockExplorerUrls[0] + "/address/" + userAddress, '_blank'); };
if (getEl("btnDisconnect")) getEl("btnDisconnect").onclick = () => {
  if (window.SessionManager) window.SessionManager.clear();
  userAddress = null; signer = null; selectedProvider = null;
  updateStatus(false);
  if (accountDropdown) accountDropdown.classList.remove("show");
  window.location.reload();
};

async function connectWallet() {
  const ethProvider = selectedProvider || window.ethereum;
  if (!ethProvider) { alert("Please install a compatible Wallet."); return; }

  getEl("btnConnect").textContent = "Connecting...";

  try {
    provider = new ethers.BrowserProvider(ethProvider);
    if (!NETWORKS_DATA) NETWORKS_DATA = await window.loadNetworks();

    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    if (window.SessionManager) window.SessionManager.save();

    const chainIdHex = await provider.send("eth_chainId", []);
    const chainIdDecimal = parseInt(chainIdHex, 16);
    ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === chainIdDecimal) && n.enabled);

    const sel = getEl("networkSelect");
    if (!ACTIVE) {
      let targetId = sel ? sel.value : null;
      if (!targetId) {
        const def = Object.values(NETWORKS_DATA).find(n => n.enabled);
        if (def) targetId = def.chainId;
      }
      if (targetId) {
        await switchNetwork(targetId);
        return;
      } else {
        alert("Unsupported Network.");
        updateStatus(false);
        return;
      }
    }

    if (sel && ACTIVE) sel.value = ACTIVE.chainId;
    updateStatus(true);

    await initPoolsInterface();

    if (ethProvider.on) {
      ethProvider.on('chainChanged', () => window.location.reload());
      ethProvider.on('accountsChanged', () => window.location.reload());
    }
  } catch (e) {
    console.error(e);
    updateStatus(false);
  }
}

async function switchNetwork(targetChainId) {
  const targetNetwork = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);
  if (!targetNetwork) return;

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: "0x" + Number(targetNetwork.chainId).toString(16) }],
    });
  } catch (switchError) {
    if (switchError.code === 4902) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: "0x" + Number(targetNetwork.chainId).toString(16),
            chainName: targetNetwork.label,
            rpcUrls: targetNetwork.rpcUrls,
            blockExplorerUrls: targetNetwork.blockExplorerUrls,
            nativeCurrency: targetNetwork.nativeCurrency
          }],
        });
      } catch (addError) { console.error("Add chain failed", addError); }
    } else { console.error("Switch failed", switchError); }
  }
}

// -------------------- TOKEN LIST BUILD (ALL cTokens visible) --------------------
async function initPoolsInterface() {
  if (!ACTIVE) return;

  const uniqueTokens = new Map();

  // Native
  if (ACTIVE.nativeCurrency) {
    uniqueTokens.set("native", {
      listType: "native",
      symbol: ACTIVE.nativeCurrency.symbol,
      name: ACTIVE.nativeCurrency.name,
      address: "NATIVE",
      decimals: ACTIVE.nativeCurrency.decimals ?? 18,
      isNative: true,
      icon: (ACTIVE.swapTokens && ACTIVE.swapTokens.base && ACTIVE.swapTokens.base.icon) || "icons/token.svg"
    });
  }

  // Official swap list (if present)
  const swapTokenList = Array.isArray(ACTIVE.swapTokenList) ? ACTIVE.swapTokenList : [];
  swapTokenList.forEach(t => {
    const addr = (t.address || "").toLowerCase();
    if (!addr) return;
    uniqueTokens.set(`token:${addr}`, {
      listType: "token",
      symbol: t.symbol,
      name: t.name || t.symbol,
      address: t.address,
      decimals: Number(t.decimals ?? 18),
      isNative: false,
      icon: t.logoURI || "icons/token.svg"
    });
  });

  // Imported (per chainId)
  loadImported().forEach(t => {
    const addr = (t.address || "").toLowerCase();
    if (!addr) return;
    uniqueTokens.set(`import:${addr}`, {
      listType: "import",
      symbol: t.symbol || "UNKNOWN",
      name: t.name || t.symbol || "Imported Token",
      address: t.address,
      decimals: Number(t.decimals ?? 18),
      isNative: false,
      icon: t.icon || "icons/token.svg",
      source: "import"
    });
  });

  // Underlyings from cTokens (optional)
  if (Array.isArray(ACTIVE.cTokens)) {
    ACTIVE.cTokens.forEach(t => {
      const uAddr = (t.underlying || "").toLowerCase();
      if (!uAddr) return;
      if (!uniqueTokens.has(`token:${uAddr}`) && !uniqueTokens.has(`import:${uAddr}`)) {
        const sym = t.underlyingSymbol || t.symbol.replace(/^c/, "");
        uniqueTokens.set(`token:${uAddr}`, {
          listType: "token",
          symbol: sym,
          name: sym,
          address: t.underlying,
          decimals: Number(t.underlyingDecimals ?? 18),
          isNative: false,
          icon: t.icon || "icons/token.svg",
          source: "cTokenUnderlying"
        });
      }
    });
  }

  // ALL cTokens as separate entries (never dedupe with tokens)
  if (Array.isArray(ACTIVE.cTokens)) {
    ACTIVE.cTokens.forEach(t => {
      const cAddr = (t.address || "").toLowerCase();
      if (!cAddr) return;

      uniqueTokens.set(`ctoken:${cAddr}`, {
        listType: "ctoken",
        symbol: t.symbol,
        name: t.symbol,
        address: t.address,
        decimals: Number(t.decimals ?? 8),
        isNative: false,
        icon: t.icon || "icons/token.svg",
        underlyingAddress: t.underlying,
        underlyingSymbol: t.underlyingSymbol,
        underlyingDecimals: t.underlyingDecimals
      });
    });
  }

  tokenList = Array.from(uniqueTokens.values());

  tokenList.sort((a, b) => {
    const rank = (x) => {
      if (x.listType === "native") return 0;
      if (x.listType === "token") return 1;
      if (x.listType === "import") return 2;
      return 3; // ctoken last
    };
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return (a.symbol || "").localeCompare(b.symbol || "");
  });

  const fromUrl = await pairFromUrl();
  fillSelector('tokenA', fromUrl ? fromUrl[0] : 0);
  fillSelector('tokenB', fromUrl ? fromUrl[1] : (tokenList.length > 1 ? 1 : 0));

  const selA = getEl('tokenA');
  const selB = getEl('tokenB');
  if (selA) selA.onchange = updateBalances;
  if (selB) selB.onchange = updateBalances;

  const btnMain = getEl('btnMainAction');
  if (btnMain) btnMain.onclick = handleMainAction;

  const removeRange = getEl('removeRange');
  if (removeRange) removeRange.oninput = handleRemoveInput;

  // The typed field stays exact; the other side follows the pool ratio (exact BigInt quote).
  const onAmount = (side) => (e) => {
    const el = e.target;
    const c = cleanAmount(el.value);
    if (c !== el.value) el.value = c;
    poolIndependent = side;
    if (!el.value) { if (hasReserves()) getEl(side === 'A' ? 'amountB' : 'amountA').value = ''; }
    else syncDependent();
    refreshMainButton();
  };
  const inputA = getEl('amountA');
  const inputB = getEl('amountB');
  if (inputA) inputA.oninput = onAmount('A');
  if (inputB) inputB.oninput = onAmount('B');

  const maxA = getEl('plMaxA'), maxB = getEl('plMaxB');
  if (maxA) maxA.onclick = () => setMax('A');
  if (maxB) maxB.onclick = () => setMax('B');

  const custom = getEl('slippageCustom');
  if (custom) {
    custom.oninput = () => {
      const c = cleanAmount(custom.value);
      if (c !== custom.value) custom.value = c;
      if (Number(c) > 0) setSlippage(Number(c), true);
    };
    custom.onblur = () => {
      if (Number(custom.value) > 0) return;
      setSlippage([0.1, 0.5, 1, 5].includes(currentSlippage) ? currentSlippage : 0.5);
    };
  }

  if (!poolRefreshTimer) {
    poolRefreshTimer = setInterval(() => {
      if (!busy && document.visibilityState === 'visible') updateBalances();
    }, 20000);
  }

  await updateBalances();
}

function fillSelector(id, defaultIdx) {
  const sel = getEl(id);
  if (!sel) return;

  sel.innerHTML = "";
  tokenList.forEach((t, i) => {
    const opt = document.createElement("option");
    opt.value = i;

    let tag = "";
    if (t.listType === "native") tag = " (Native)";
    else if (t.listType === "ctoken") tag = " (cToken)";
    else if (t.listType === "import") tag = " (Imported)";

    opt.textContent = `${t.symbol}${tag}`;
    if (i === defaultIdx) opt.selected = true;
    sel.appendChild(opt);
  });
}

// -------------------- BALANCES + PAIR DETECTION --------------------
async function updateBalances() {
  if (!ACTIVE) return;
  if (!tokenList || tokenList.length === 0) return;
  const rd = getReader();
  if (!rd) return;

  const elTokenA = getEl('tokenA');
  const elTokenB = getEl('tokenB');
  if (!elTokenA || !elTokenB) return;

  const tA = tokenList[elTokenA.value];
  const tB = tokenList[elTokenB.value];
  if (!tA || !tB) return;
  const seq = ++balSeq;

  const lblInputA = getEl('lblInputA'); if (lblInputA) lblInputA.textContent = tA.symbol;
  const lblInputB = getEl('lblInputB'); if (lblInputB) lblInputB.textContent = tB.symbol;
  const iconA = getEl('plIconA'); if (iconA) iconA.src = tA.icon || 'icons/token.svg';
  const iconB = getEl('plIconB'); if (iconB) iconB.src = tB.icon || 'icons/token.svg';

  ['lblRateA', 'lblRateB', 'lblRateA2', 'lblRateB2', 'lblRemA', 'lblRemB'].forEach(id => {
    const el = getEl(id);
    if (!el) return;
    if (id.includes('A')) el.textContent = tA.symbol;
    else el.textContent = tB.symbol;
  });

  const getBal = async (t) => {
    try {
      if (t.isNative) return await provider.getBalance(userAddress);
      const c = new ethers.Contract(t.address, window.MIN_ERC20_ABI, provider);
      return await c.balanceOf(userAddress);
    } catch { return null; }
  };

  let bA = null, bB = null;
  if (signer && userAddress) [bA, bB] = await Promise.all([getBal(tA), getBal(tB)]);
  if (seq !== balSeq) return;
  rawBalA = bA; rawBalB = bB;
  const showBal = (id, wei, t) => { const el = getEl(id); if (el) el.textContent = wei === null ? (signer ? '0.00' : '—') : fmtDisplay(wei, t.decimals); };
  showBal('balA', bA, tA);
  showBal('balB', bB, tB);
  const maxA = getEl('plMaxA'); if (maxA) maxA.hidden = !(bA && bA > 0n);
  const maxB = getEl('plMaxB'); if (maxB) maxB.hidden = !(bB && bB > 0n);

  // Pair detection will only work if router is configured
  if (!ACTIVE.router) { refreshMainButton(); return; }

  let pairAddress = null, reserves = { rA: 0n, rB: 0n }, ts = 0n, lp = 0n, weth = null;

  try {
    const router = new ethers.Contract(ACTIVE.router, window.POOL_ROUTER_ABI, rd);
    const [factoryAddr, WETH] = await Promise.all([router.factory(), router.WETH()]);
    weth = WETH;

    const factoryABI = ["function getPair(address, address) view returns (address)"];
    const factory = new ethers.Contract(factoryAddr, factoryABI, rd);

    const addrA = tA.isNative ? WETH : tA.address;
    const addrB = tB.isNative ? WETH : tB.address;

    const pairAddr = addrA.toLowerCase() === addrB.toLowerCase() ? null : await factory.getPair(addrA, addrB);

    if (pairAddr && pairAddr !== "0x0000000000000000000000000000000000000000") {
      pairAddress = pairAddr;
      const pair = new ethers.Contract(pairAddr, PAIR_ABI, rd);

      const [res, supply, bal, token0] = await Promise.all([
        pair.getReserves(),
        pair.totalSupply(),
        userAddress ? pair.balanceOf(userAddress) : Promise.resolve(0n),
        pair.token0()
      ]);

      ts = supply;
      lp = bal;
      const isToken0A = (token0.toLowerCase() === addrA.toLowerCase());
      reserves = { rA: isToken0A ? res[0] : res[1], rB: isToken0A ? res[1] : res[0] };
    }
  } catch (e) {
    console.error("Pair detect error:", e);
  }
  if (seq !== balSeq) return;

  currentWETH = weth;
  currentPairAddress = pairAddress;
  currentReserves = reserves;
  currentTotalSupply = ts;
  currentLpBalance = lp;

  const elRateA = getEl('rateA');
  const elRateB = getEl('rateB');
  const elShare = getEl('sharePool');
  const elUserLp = getEl('userLpBalance');
  const pooledRow = getEl('plPooledRow');
  const note = getEl('plPairNote');

  const rA_float = parseFloat(ethers.formatUnits(reserves.rA, tA.decimals));
  const rB_float = parseFloat(ethers.formatUnits(reserves.rB, tB.decimals));
  const formatRate = (val) => {
    if (!isFinite(val) || val === 0) return "0";
    if (val < 0.0001) return val.toPrecision(4);
    if (val >= 1e6) return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return val.toLocaleString('en-US', { maximumFractionDigits: val >= 1000 ? 2 : 6 });
  };

  if (rA_float > 0 && rB_float > 0) {
    if (elRateA) elRateA.textContent = formatRate(rB_float / rA_float);
    if (elRateB) elRateB.textContent = formatRate(rA_float / rB_float);
  } else {
    if (elRateA) elRateA.textContent = "--";
    if (elRateB) elRateB.textContent = "--";
  }

  if (elUserLp) elUserLp.textContent = fmtDisplay(lp, 18);
  if (elShare && !pairAddress) elShare.textContent = "--%";
  if (pooledRow) {
    pooledRow.hidden = !(lp > 0n && ts > 0n);
    if (!pooledRow.hidden) {
      getEl('plPooled').textContent = `${fmtDisplay((lp * reserves.rA) / ts, tA.decimals)} ${tA.symbol} + ${fmtDisplay((lp * reserves.rB) / ts, tB.decimals)} ${tB.symbol}`;
    }
  }
  if (note) {
    const same = sameToken(tA, tB);
    const isNew = !same && (!pairAddress || reserves.rA === 0n || reserves.rB === 0n);
    note.classList.toggle('is-new', isNew && isAddMode);
    note.textContent = same ? 'Choose two different tokens.'
      : isNew ? (isAddMode ? 'This pool has no liquidity yet. You are the first provider: the ratio you deposit sets the starting price.' : 'This pool has no liquidity yet.')
      : `Pool reserves: ${fmtDisplay(reserves.rA, tA.decimals)} ${tA.symbol} · ${fmtDisplay(reserves.rB, tB.decimals)} ${tB.symbol}`;
  }

  syncDependent();
  if (!isAddMode) handleRemoveInput();
  refreshMainButton();
}

// -------------------- REMOVE ESTIMATION --------------------
function handleRemoveInput() {
  const elRange = getEl('removeRange');
  if (!elRange) return;

  const percent = Number(elRange.value);
  const elDisplay = getEl('removePercentDisplay');
  if (elDisplay) elDisplay.textContent = percent + "%";

  const elEstA = getEl('estRemoveA');
  const elEstB = getEl('estRemoveB');
  const [tA, tB] = pairTokens();

  if (!tA || !tB || !currentPairAddress || currentLpBalance === 0n || currentTotalSupply === 0n || percent === 0) {
    if (elEstA) elEstA.textContent = "0.00";
    if (elEstB) elEstB.textContent = "0.00";
    refreshMainButton();
    return;
  }

  const liquidity = (currentLpBalance * BigInt(percent)) / 100n;
  if (elEstA) elEstA.textContent = fmtDisplay((liquidity * currentReserves.rA) / currentTotalSupply, tA.decimals);
  if (elEstB) elEstB.textContent = fmtDisplay((liquidity * currentReserves.rB) / currentTotalSupply, tB.decimals);
  refreshMainButton();
}

// -------------------- ACTION ROUTER --------------------
async function handleMainAction() {
  if (!signer) { openWalletModal(); return; }
  if (isAddMode) await handleAddLiquidity();
  else await handleRemoveLiquidity();
}

// -------------------- ADD LIQUIDITY --------------------
async function handleAddLiquidity() {
  const btn = getEl('btnMainAction');
  if (!ACTIVE.router) { showStatus("Router not configured for this network", 'danger'); return; }

  busy = true;
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  showStatus('Reading the latest pool price…');

  try {
    await refreshReserves();
    syncDependent();
    const d = desiredAmounts();
    if (!d) { showStatus('Enter an amount', 'danger'); return; }
    const { tA, tB, a: amountA_Desired, b: amountB_Desired } = d;
    if (rawBalA !== null && amountA_Desired > rawBalA) { showStatus(`Insufficient ${tA.symbol} balance`, 'danger'); return; }
    if (rawBalB !== null && amountB_Desired > rawBalB) { showStatus(`Insufficient ${tB.symbol} balance`, 'danger'); return; }

    const routerAddr = ACTIVE.router;
    const router = new ethers.Contract(routerAddr, window.POOL_ROUTER_ABI, signer);

    if (!tA.isNative) await checkAndApprove(tA, routerAddr, amountA_Desired, getEl('txStatus'));
    if (!tB.isNative) await checkAndApprove(tB, routerAddr, amountB_Desired, getEl('txStatus'));

    const deadline = Math.floor(Date.now() / 1000) + 1200;
    const slippageBps = BigInt(Math.round(currentSlippage * 100));
    const BPS_MAX = 10000n;

    const hasLiquidity = currentReserves.rA > 0n && currentReserves.rB > 0n;

    let amountAMin = 0n;
    let amountBMin = 0n;

    if (hasLiquidity) {
      amountAMin = (amountA_Desired * (BPS_MAX - slippageBps)) / BPS_MAX;
      amountBMin = (amountB_Desired * (BPS_MAX - slippageBps)) / BPS_MAX;
    }

    showStatus('Confirm the transaction in your wallet…');

    let tx;

    if (tA.isNative || tB.isNative) {
      const tokenObj = tA.isNative ? tB : tA;
      const amtTokenDesired = tA.isNative ? amountB_Desired : amountA_Desired;
      const amtTokenMin = tA.isNative ? amountBMin : amountAMin;
      const amtETHMin = tA.isNative ? amountAMin : amountBMin;
      const valETH = tA.isNative ? amountA_Desired : amountB_Desired;

      tx = await router.addLiquidityETH(
        tokenObj.address,
        amtTokenDesired,
        amtTokenMin,
        amtETHMin,
        userAddress,
        deadline,
        { value: valETH }
      );
    } else {
      tx = await router.addLiquidity(
        tA.address, tB.address,
        amountA_Desired,
        amountB_Desired,
        amountAMin,
        amountBMin,
        userAddress,
        deadline
      );
    }

    showStatus('Adding liquidity…', 'warning', txUrl(tx.hash));
    await tx.wait();

    showStatus(`Liquidity added: ${fmtDisplay(amountA_Desired, tA.decimals)} ${tA.symbol} + ${fmtDisplay(amountB_Desired, tB.decimals)} ${tB.symbol}`, 'success', txUrl(tx.hash));

    getEl('amountA').value = "";
    getEl('amountB').value = "";
  } catch (e) {
    console.error(e);
    showStatus(friendlyError(e), 'danger');
  } finally {
    busy = false;
    btn.disabled = false;
    await updateBalances();
  }
}

// -------------------- REMOVE LIQUIDITY --------------------
async function handleRemoveLiquidity() {
  const btn = getEl('btnMainAction');
  const percent = Number(getEl('removeRange').value);

  if (!currentPairAddress || percent === 0) { showStatus("No liquidity to remove", 'danger'); return; }
  if (!ACTIVE.router) { showStatus("Router not configured for this network", 'danger'); return; }

  busy = true;
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  showStatus('Calculating exit amounts…');

  try {
    const routerAddr = ACTIVE.router;
    const router = new ethers.Contract(routerAddr, window.POOL_ROUTER_ABI, signer);
    const deadline = Math.floor(Date.now() / 1000) + 1200;

    const [tA, tB] = pairTokens();

    await refreshReserves();
    if (currentLpBalance === 0n) { showStatus("No liquidity to remove", 'danger'); return; }
    const liquidityAmount = (currentLpBalance * BigInt(percent)) / 100n;

    const expectedA = (liquidityAmount * currentReserves.rA) / currentTotalSupply;
    const expectedB = (liquidityAmount * currentReserves.rB) / currentTotalSupply;

    const slippageBps = BigInt(Math.round(currentSlippage * 100));
    const BPS_MAX = 10000n;

    const amountAMin = (expectedA * (BPS_MAX - slippageBps)) / BPS_MAX;
    const amountBMin = (expectedB * (BPS_MAX - slippageBps)) / BPS_MAX;

    showStatus("Checking LP approval…");
    const pair = new ethers.Contract(currentPairAddress, window.MIN_ERC20_ABI, signer);
    const allow = await pair.allowance(userAddress, routerAddr);

    if (allow < liquidityAmount) {
      showStatus("Approve the LP token in your wallet…");
      const txApp = await pair.approve(routerAddr, ethers.MaxUint256);
      await txApp.wait();
    }

    showStatus("Confirm the transaction in your wallet…");

    let tx;
    if (tA.isNative || tB.isNative) {
      const tokenObj = tA.isNative ? tB : tA;
      const amtTokenMin = tA.isNative ? amountBMin : amountAMin;
      const amtETHMin = tA.isNative ? amountAMin : amountBMin;

      tx = await router.removeLiquidityETH(
        tokenObj.address,
        liquidityAmount,
        amtTokenMin,
        amtETHMin,
        userAddress,
        deadline
      );
    } else {
      tx = await router.removeLiquidity(
        tA.address, tB.address,
        liquidityAmount,
        amountAMin,
        amountBMin,
        userAddress,
        deadline
      );
    }

    showStatus('Removing liquidity…', 'warning', txUrl(tx.hash));
    await tx.wait();

    showStatus(`Removed: ${fmtDisplay(expectedA, tA.decimals)} ${tA.symbol} + ${fmtDisplay(expectedB, tB.decimals)} ${tB.symbol}`, 'success', txUrl(tx.hash));

    getEl('removeRange').value = 0;
  } catch (e) {
    console.error(e);
    showStatus(friendlyError(e), 'danger');
  } finally {
    busy = false;
    btn.disabled = false;
    await updateBalances();
    handleRemoveInput();
  }
}

// -------------------- APPROVE --------------------
async function checkAndApprove(tokenObj, spender, amount, statusEl) {
  const tokenContract = new ethers.Contract(tokenObj.address, window.MIN_ERC20_ABI, signer);
  const amountWei = typeof amount === 'bigint' ? amount : ethers.parseUnits(amount, tokenObj.decimals);
  const allowance = await tokenContract.allowance(userAddress, spender);
  if (allowance < amountWei) {
    statusEl.textContent = `Approve ${tokenObj.symbol} in your wallet…`;
    const tx = await tokenContract.approve(spender, ethers.MaxUint256);
    await tx.wait();
  }
}
