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

const getEl = (id) => document.getElementById(id);

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

    if (btnAction) {
      btnAction.textContent = isAddMode ? "Add Liquidity" : "Remove Liquidity";
      btnAction.disabled = false;
    }
  } else {
    dot.style.color = "var(--danger)";
    txt.textContent = "Disconnected";

    btn.textContent = "Connect Wallet";
    btn.classList.remove('btn-connected');
    btn.classList.add('btn-primary');
    if (btn.lastChild && btn.lastChild.tagName === 'SPAN') btn.removeChild(btn.lastChild);

    if (btnAction) btnAction.textContent = "Connect Wallet";
  }
};

window.setPoolMode = (mode) => {
  isAddMode = (mode === 'add');

  const tabAdd = getEl('tabAdd');
  const tabRemove = getEl('tabRemove');
  const panelAdd = getEl('panelAdd');
  const panelRemove = getEl('panelRemove');

  if (tabAdd) tabAdd.classList.toggle('active', isAddMode);
  if (tabRemove) tabRemove.classList.toggle('active', !isAddMode);
  if (panelAdd) panelAdd.style.display = isAddMode ? 'block' : 'none';
  if (panelRemove) panelRemove.style.display = isAddMode ? 'none' : 'block';

  const btn = getEl('btnMainAction');
  if (btn) {
    if (signer) {
      btn.textContent = isAddMode ? "Add Liquidity" : "Approve & Remove";
      btn.style.background = isAddMode ? "" : "var(--danger)";
      btn.style.borderColor = isAddMode ? "" : "var(--danger)";
    } else {
      btn.textContent = "Connect Wallet";
    }
  }

  updateBalances();
};

window.setRemove = (percent) => {
  getEl('removeRange').value = percent;
  handleRemoveInput();
};

window.setSlippage = (val) => {
  currentSlippage = val;
  getEl('slippageDisplay').textContent = val + "%";

  const buttons = document.querySelectorAll('.pool-info .btn-ghost');
  buttons.forEach(b => {
    if (b.textContent.includes(val.toString())) {
      b.style.border = val >= 5 ? '1px solid var(--warning)' : '1px solid var(--success)';
    } else {
      b.style.border = '1px solid transparent';
    }
  });
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
    if (signer) await initPoolsInterface();
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
      icon: "icons/token.svg"
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

  fillSelector('tokenA', 0);
  fillSelector('tokenB', tokenList.length > 1 ? 1 : 0);

  const selA = getEl('tokenA');
  const selB = getEl('tokenB');
  if (selA) selA.onchange = updateBalances;
  if (selB) selB.onchange = updateBalances;

  const btnMain = getEl('btnMainAction');
  if (btnMain) btnMain.onclick = handleMainAction;

  const removeRange = getEl('removeRange');
  if (removeRange) removeRange.oninput = handleRemoveInput;

  // Auto calc inputs only when pair detection works (same as your existing logic)
  const inputA = getEl('amountA');
  const inputB = getEl('amountB');

  if (inputA) {
    inputA.oninput = (e) => {
      if (!currentPairAddress || currentReserves.rA === 0n || currentReserves.rB === 0n) return;
      const valA = e.target.value;
      if (!valA) { getEl('amountB').value = ""; return; }

      const tA = tokenList[getEl('tokenA').value];
      const tB = tokenList[getEl('tokenB').value];

      try {
        const rA = parseFloat(ethers.formatUnits(currentReserves.rA, tA.decimals));
        const rB = parseFloat(ethers.formatUnits(currentReserves.rB, tB.decimals));
        const price = rB / rA;
        const valB = parseFloat(valA) * price;
        getEl('amountB').value = parseFloat(valB.toFixed(tB.decimals > 6 ? 6 : tB.decimals));
      } catch {}
    };
  }

  if (inputB) {
    inputB.oninput = (e) => {
      if (!currentPairAddress || currentReserves.rA === 0n || currentReserves.rB === 0n) return;
      const valB = e.target.value;
      if (!valB) { getEl('amountA').value = ""; return; }

      const tA = tokenList[getEl('tokenA').value];
      const tB = tokenList[getEl('tokenB').value];

      try {
        const rA = parseFloat(ethers.formatUnits(currentReserves.rA, tA.decimals));
        const rB = parseFloat(ethers.formatUnits(currentReserves.rB, tB.decimals));
        const price = rA / rB;
        const valA = parseFloat(valB) * price;
        getEl('amountA').value = parseFloat(valA.toFixed(tA.decimals > 6 ? 6 : tA.decimals));
      } catch {}
    };
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
  if (!signer || !ACTIVE) return;
  if (!tokenList || tokenList.length === 0) return;

  const elTokenA = getEl('tokenA');
  const elTokenB = getEl('tokenB');
  if (!elTokenA || !elTokenB) return;

  const tA = tokenList[elTokenA.value];
  const tB = tokenList[elTokenB.value];
  if (!tA || !tB) return;

  const lblInputA = getEl('lblInputA'); if (lblInputA) lblInputA.textContent = tA.symbol;
  const lblInputB = getEl('lblInputB'); if (lblInputB) lblInputB.textContent = tB.symbol;

  ['lblRateA', 'lblRateB', 'lblRateA2', 'lblRateB2', 'lblRemA', 'lblRemB'].forEach(id => {
    const el = getEl(id);
    if (!el) return;
    if (id.includes('A')) el.textContent = tA.symbol;
    else el.textContent = tB.symbol;
  });

  const getBal = async (t) => {
    try {
      if (t.isNative) {
        const b = await provider.getBalance(userAddress);
        return parseFloat(ethers.formatEther(b)).toFixed(4);
      } else {
        const c = new ethers.Contract(t.address, window.MIN_ERC20_ABI, provider);
        const b = await c.balanceOf(userAddress);
        return parseFloat(ethers.formatUnits(b, t.decimals)).toFixed(4);
      }
    } catch { return "0.00"; }
  };

  const balA = getEl('balA'); if (balA) balA.textContent = await getBal(tA);
  const balB = getEl('balB'); if (balB) balB.textContent = await getBal(tB);

  // Pair detection will only work if router is configured
  if (!ACTIVE.router) return;

  currentPairAddress = null;
  currentLpBalance = 0n;
  currentReserves = { rA: 0n, rB: 0n };

  try {
    const router = new ethers.Contract(ACTIVE.router, window.POOL_ROUTER_ABI, provider);
    const factoryAddr = await router.factory();

    const factoryABI = ["function getPair(address, address) view returns (address)"];
    const factory = new ethers.Contract(factoryAddr, factoryABI, provider);

    const WETH = await router.WETH();
    const addrA = tA.isNative ? WETH : tA.address;
    const addrB = tB.isNative ? WETH : tB.address;

    const pairAddr = await factory.getPair(addrA, addrB);

    if (pairAddr && pairAddr !== "0x0000000000000000000000000000000000000000") {
      currentPairAddress = pairAddr;

      const pairABI = [
        "function getReserves() view returns (uint112, uint112, uint32)",
        "function totalSupply() view returns (uint256)",
        "function balanceOf(address) view returns (uint256)",
        "function token0() view returns (address)"
      ];
      const pair = new ethers.Contract(pairAddr, pairABI, provider);

      const [reserves, ts, bal, token0] = await Promise.all([
        pair.getReserves(),
        pair.totalSupply(),
        pair.balanceOf(userAddress),
        pair.token0()
      ]);

      currentTotalSupply = ts;
      currentLpBalance = bal;

      const isToken0A = (token0.toLowerCase() === addrA.toLowerCase());
      currentReserves.rA = isToken0A ? reserves[0] : reserves[1];
      currentReserves.rB = isToken0A ? reserves[1] : reserves[0];

      const rA_float = parseFloat(ethers.formatUnits(currentReserves.rA, tA.decimals));
      const rB_float = parseFloat(ethers.formatUnits(currentReserves.rB, tB.decimals));

      const formatRate = (val) => {
        if (val === 0) return "0";
        if (val < 0.0001) return val.toFixed(8).replace(/\.?0+$/, "");
        return val.toFixed(4);
      };

      const elRateA = getEl('rateA');
      const elRateB = getEl('rateB');

      if (rA_float > 0 && rB_float > 0) {
        const priceAperB = rB_float / rA_float;
        const priceBperA = rA_float / rB_float;
        if (elRateA) elRateA.textContent = formatRate(priceAperB);
        if (elRateB) elRateB.textContent = formatRate(priceBperA);
      } else {
        if (elRateA) elRateA.textContent = "--";
        if (elRateB) elRateB.textContent = "--";
      }

      const elUserLp = getEl('userLpBalance');
      if (elUserLp) elUserLp.textContent = parseFloat(ethers.formatEther(bal)).toFixed(4);

      const userShare = Number(bal) * 100 / Number(ts);
      const elShare = getEl('sharePool');
      if (elShare) elShare.textContent = (userShare < 0.01 && userShare > 0) ? "<0.01%" : userShare.toFixed(2) + "%";
    }
  } catch (e) {
    console.error("Pair detect error:", e);
  }

  if (!isAddMode) handleRemoveInput();
}

// -------------------- REMOVE ESTIMATION --------------------
function handleRemoveInput() {
  const elRange = getEl('removeRange');
  if (!elRange) return;

  const percent = elRange.value;
  const elDisplay = getEl('removePercentDisplay');
  if (elDisplay) elDisplay.textContent = percent + "%";

  const elEstA = getEl('estRemoveA');
  const elEstB = getEl('estRemoveB');

  if (!currentPairAddress || currentLpBalance === 0n || percent == 0) {
    if (elEstA) elEstA.textContent = "0.00";
    if (elEstB) elEstB.textContent = "0.00";
    return;
  }

  const tA = tokenList[getEl('tokenA').value];
  const tB = tokenList[getEl('tokenB').value];

  const factor = (Number(currentLpBalance) * (percent / 100)) / Number(currentTotalSupply);
  const estA = factor * Number(currentReserves.rA);
  const estB = factor * Number(currentReserves.rB);

  const fmtA = estA / Math.pow(10, tA.decimals);
  const fmtB = estB / Math.pow(10, tB.decimals);

  if (elEstA) elEstA.textContent = fmtA.toFixed(4);
  if (elEstB) elEstB.textContent = fmtB.toFixed(4);
}

// -------------------- ACTION ROUTER --------------------
async function handleMainAction() {
  if (!signer) { openWalletModal(); return; }
  if (isAddMode) await handleAddLiquidity();
  else await handleRemoveLiquidity();
}

// -------------------- ADD LIQUIDITY --------------------
async function handleAddLiquidity() {
  const status = getEl('txStatus');
  const btn = getEl('btnMainAction');

  const tA = tokenList[getEl('tokenA').value];
  const tB = tokenList[getEl('tokenB').value];
  const valA = getEl('amountA').value;
  const valB = getEl('amountB').value;

  if (!valA || !valB) { alert("Enter amounts"); return; }
  if (!ACTIVE.router) { alert("Router not configured for this network"); return; }

  btn.disabled = true;
  status.style.display = 'block';
  status.textContent = 'Calculating Slippage...';
  status.style.color = 'var(--warning)';

  try {
    const routerAddr = ACTIVE.router;
    const router = new ethers.Contract(routerAddr, window.POOL_ROUTER_ABI, signer);
    const deadline = Math.floor(Date.now() / 1000) + 1200;

    if (!tA.isNative) await checkAndApprove(tA, routerAddr, valA, status);
    if (!tB.isNative) await checkAndApprove(tB, routerAddr, valB, status);

    const amountA_Desired = ethers.parseUnits(valA, tA.decimals);
    const amountB_Desired = ethers.parseUnits(valB, tB.decimals);

    const slippageBps = BigInt(Math.floor(currentSlippage * 100));
    const BPS_MAX = 10000n;

    const hasLiquidity = currentReserves.rA > 0n && currentReserves.rB > 0n;

    let amountAMin = 0n;
    let amountBMin = 0n;

    if (hasLiquidity) {
      amountAMin = (amountA_Desired * (BPS_MAX - slippageBps)) / BPS_MAX;
      amountBMin = (amountB_Desired * (BPS_MAX - slippageBps)) / BPS_MAX;
    }

    status.textContent = "Confirming Transaction...";

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

    status.textContent = "Pending Confirmation...";
    await tx.wait();

    status.textContent = "Success! Liquidity Added 💧";
    status.style.color = "var(--success)";

    getEl('amountA').value = "";
    getEl('amountB').value = "";
    updateBalances();
  } catch (e) {
    console.error(e);
    status.textContent = "Transaction Failed / Rejected";
    status.style.color = "var(--danger)";
  } finally {
    btn.disabled = false;
  }
}

// -------------------- REMOVE LIQUIDITY --------------------
async function handleRemoveLiquidity() {
  const status = getEl('txStatus');
  const btn = getEl('btnMainAction');
  const percent = getEl('removeRange').value;

  if (!currentPairAddress || percent == 0) { alert("No liquidity to remove"); return; }
  if (!ACTIVE.router) { alert("Router not configured for this network"); return; }

  btn.disabled = true;
  status.style.display = 'block';
  status.textContent = 'Calculating Exit Amounts...';
  status.style.color = 'var(--danger)';

  try {
    const routerAddr = ACTIVE.router;
    const router = new ethers.Contract(routerAddr, window.POOL_ROUTER_ABI, signer);
    const deadline = Math.floor(Date.now() / 1000) + 1200;

    const tA = tokenList[getEl('tokenA').value];
    const tB = tokenList[getEl('tokenB').value];

    const liquidityAmount = (currentLpBalance * BigInt(percent)) / 100n;

    const expectedA = (liquidityAmount * currentReserves.rA) / currentTotalSupply;
    const expectedB = (liquidityAmount * currentReserves.rB) / currentTotalSupply;

    const slippageBps = BigInt(Math.floor(currentSlippage * 100));
    const BPS_MAX = 10000n;

    const amountAMin = (expectedA * (BPS_MAX - slippageBps)) / BPS_MAX;
    const amountBMin = (expectedB * (BPS_MAX - slippageBps)) / BPS_MAX;

    status.textContent = "Checking Allowance...";
    const pair = new ethers.Contract(currentPairAddress, window.MIN_ERC20_ABI, signer);
    const allow = await pair.allowance(userAddress, routerAddr);

    if (allow < liquidityAmount) {
      status.textContent = "Approving LP Token...";
      const txApp = await pair.approve(routerAddr, ethers.MaxUint256);
      await txApp.wait();
    }

    status.textContent = "Removing Liquidity...";

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

    await tx.wait();

    status.textContent = "Removed Successfully!";
    status.style.color = "var(--success)";

    getEl('removeRange').value = 0;
    handleRemoveInput();
    updateBalances();
  } catch (e) {
    console.error(e);
    status.textContent = "Remove Failed";
    status.style.color = "var(--danger)";
  } finally {
    btn.disabled = false;
  }
}

// -------------------- APPROVE --------------------
async function checkAndApprove(tokenObj, spender, amountStr, statusEl) {
  const tokenContract = new ethers.Contract(tokenObj.address, window.MIN_ERC20_ABI, signer);
  const amountWei = ethers.parseUnits(amountStr, tokenObj.decimals);
  const allowance = await tokenContract.allowance(userAddress, spender);
  if (allowance < amountWei) {
    statusEl.textContent = `Approving ${tokenObj.symbol}...`;
    const tx = await tokenContract.approve(spender, ethers.MaxUint256);
    await tx.wait();
  }
}