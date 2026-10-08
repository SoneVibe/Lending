let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let selectedProvider = null;

const getEl = (id) => document.getElementById(id);

// --- UI HELPERS PRO ---
const updateStatus = (connected) => {
  const dot = getEl('statusDot');
  const txt = getEl('connStatus');
  const btn = getEl('btnConnect');
  
  if(connected && userAddress) {
    dot.style.color = "var(--success)";
    txt.textContent = "Online";
    btn.textContent = userAddress.substring(0,6) + "..." + userAddress.substring(38);
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-connected');
    
    const arrow = document.createElement("span");
    arrow.textContent = "▼";
    arrow.style.fontSize = "0.7em";
    arrow.style.marginLeft = "6px";
    if (btn.lastChild && btn.lastChild.tagName === 'SPAN') btn.removeChild(btn.lastChild);
    btn.appendChild(arrow);
    
    getEl('dropdownAddress').textContent = userAddress.substring(0,8) + "..." + userAddress.substring(38);
  } else {
    dot.style.color = "var(--danger)";
    txt.textContent = "Disconnected";
    btn.textContent = "Connect Wallet";
    btn.className = "btn-primary";
    btn.style.background = "";
  }
};

document.addEventListener("DOMContentLoaded", initVaultApp);

async function initVaultApp() {
    try {
        NETWORKS_DATA = await window.loadNetworks();
        initNetworkSelector();
        // Fallback default
        ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == "1868" && n.enabled);
        const sel = getEl("networkSelect");
        if (sel && ACTIVE) sel.value = ACTIVE.chainId;
        if(window.checkAutoConnect) await window.checkAutoConnect(connectWallet);
        if (!userAddress) await updateVibeVault();
        startAutoRefresh();
    } catch(e) { console.error("Init Error", e); }
}

function initNetworkSelector() {
    const sel = getEl("networkSelect");
    if (!NETWORKS_DATA || !sel) return;
    sel.innerHTML = "";
    Object.values(NETWORKS_DATA).forEach(n => {
        if(n.enabled) {
            const opt = document.createElement("option");
            opt.value = n.chainId; opt.textContent = n.label;
            sel.appendChild(opt);
        }
    });
    sel.onchange = async (e) => {
        const targetChainId = e.target.value;
        if(userAddress) await switchNetwork(targetChainId);
        else { ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId); await updateVibeVault(); }
    };
}

// --- WALLET MODAL ---
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
            btn.innerHTML = `<div class="wallet-info"><img src="${w.icon}" alt="${w.name}" style="width:32px; height:32px; object-fit:contain;"><span>${w.name}</span></div>${isInstalled ? '<span style="color:var(--success); font-size:1.2rem;">›</span>' : '<span class="wallet-badge">Install</span>'}`;
            btn.onclick = async () => {
                if(!isInstalled) { window.open(w.installUrl, '_blank'); return; }
                selectedProvider = w.getProvider();
                closeWalletModal();
                await connectWallet();
            };
            list.appendChild(btn);
        });
    }
    modal.classList.add('open');
}
window.closeWalletModal = () => { getEl('walletModal').classList.remove('open'); };
window.onclick = (e) => {
    const modal = getEl('walletModal');
    if (e.target === modal) closeWalletModal();
    const accountDropdown = getEl("accountDropdown");
    if (accountDropdown && accountDropdown.classList.contains('show') && !e.target.closest('#btnConnect')) {
         accountDropdown.classList.remove('show');
    }
};

// --- CONNECT / DISCONNECT ---
const btnConnect = getEl("btnConnect");
const accountDropdown = getEl("accountDropdown");

btnConnect.onclick = (e) => {
    e.stopPropagation();
    if(userAddress) { if (accountDropdown) accountDropdown.classList.toggle("show"); }
    else { openWalletModal(); }
};

getEl("btnCopyAddress").onclick = () => { navigator.clipboard.writeText(userAddress); alert("Copied!"); };
getEl("btnViewExplorer").onclick = () => { if(ACTIVE) window.open(explorerUrl(userAddress), '_blank'); };
getEl("btnDisconnect").onclick = () => {
    if(window.SessionManager) window.SessionManager.clear();
    userAddress = null; signer = null; selectedProvider = null;
    updateStatus(false);
    accountDropdown.classList.remove("show");
    updateVibeVault();
};

// --- CORE CONNECT ---
async function connectWallet() {
  const ethProvider = selectedProvider || window.ethereum;
  if (!ethProvider) { alert("Please install MetaMask"); return; }
  getEl("btnConnect").textContent = "Connecting...";
  
  try {
    provider = new ethers.BrowserProvider(ethProvider);
    if(!NETWORKS_DATA) NETWORKS_DATA = await window.loadNetworks();
    
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    
    if(window.SessionManager) window.SessionManager.save();
    
    const chainIdHex = await provider.send("eth_chainId", []);
    const chainIdDecimal = parseInt(chainIdHex, 16);
    
    ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === chainIdDecimal) && n.enabled);
    const sel = getEl("networkSelect");

    if(!ACTIVE) {
        let targetId = sel ? sel.value : null;
        if(!targetId) {
             const def = Object.values(NETWORKS_DATA).find(n => n.enabled);
             if(def) targetId = def.chainId;
        }
        if(targetId) { await switchNetwork(targetId); return; }
        else { alert("Unsupported Network."); updateStatus(false); return; }
    }
    
    if(sel && ACTIVE) sel.value = ACTIVE.chainId;
    updateStatus(true);
    await updateVibeVault();
    
    if(ethProvider.on && !ethProvider.__vibeVaultListeners) {
        ethProvider.__vibeVaultListeners = true;
        ethProvider.on('chainChanged', () => window.location.reload());
        ethProvider.on('accountsChanged', () => window.location.reload());
    }
  } catch (e) { console.error("Connection Error:", e); updateStatus(false); }
}

async function switchNetwork(targetChainId) {
    const targetNetwork = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);
    if (!targetNetwork) return;
    try {
        await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: "0x" + Number(targetNetwork.chainId).toString(16) }] });
    } catch (switchError) {
        if (switchError.code === 4902) {
            try { await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: "0x" + Number(targetNetwork.chainId).toString(16), chainName: targetNetwork.label, rpcUrls: targetNetwork.rpcUrls, blockExplorerUrls: targetNetwork.blockExplorerUrls, nativeCurrency: targetNetwork.nativeCurrency }] });
            } catch (e) {}
        }
    }
}

// --- VAULT LOGIC ---
// Rewards live in the network's Master (comptroller); VIBE is minted by its vibeTokenExternal().
const btnClaim = getEl("btnVaultClaimVibe");
const statusEl = getEl("vaultVibeStatus");
const E36 = 10n ** 36n;
const VAULT_MASTER_ABI = [...window.REWARDS_ABI, "function oracle() view returns (address)"];
const VAULT_TOKEN_ABI = [...window.MIN_ERC20_ABI, "function name() view returns (string)", "function symbol() view returns (string)", "function totalSupply() view returns (uint256)"];
const VAULT_ORACLE_ABI = window.ORACLE_ABI;
const REFRESH_MS = 30000;
const readProviders = {};
let vaultData = null;
let loadSeq = 0;
let claiming = false;

const safe = (p, fallback) => Promise.resolve(p).catch(() => fallback);
const toNum = (v, dec = 18) => Number(ethers.formatUnits(v || 0n, dec));
const shortAddr = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "—";
const explorerUrl = (addr) => {
    const base = ACTIVE && ACTIVE.blockExplorerUrls && ACTIVE.blockExplorerUrls[0];
    return base ? base.replace(/\/+$/, "") + "/address/" + addr : "#";
};

function fmt(n, maxFrac = 2) {
    if (!isFinite(n) || n === 0) return "0";
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (abs >= 1e4) return (n / 1e3).toFixed(2) + "K";
    if (abs < 0.0001) return "<0.0001";
    return n.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
}
const fmtUSD = (n) => (!isFinite(n) || n <= 0) ? "—" : "$" + fmt(n, 2);
const fmtPct = (n) => (!isFinite(n) || n <= 0) ? null : (n >= 1e4 ? fmt(n, 0) : n.toFixed(2)) + "%";

function getReadProvider() {
    const url = ACTIVE && ACTIVE.rpcUrls && ACTIVE.rpcUrls[0];
    if (!url) return provider;
    // Public RPCs cap JSON-RPC batch size (Soneium: 20), so keep batches small.
    if (!readProviders[ACTIVE.chainId]) {
        readProviders[ACTIVE.chainId] = new ethers.JsonRpcProvider(url, Number(ACTIVE.chainId), { staticNetwork: true, batchMaxCount: 10 });
    }
    return readProviders[ACTIVE.chainId];
}

async function loadMarket(m, master, oracle, reader, block, user) {
    const c = new ethers.Contract(m.address, window.C_TOKEN_ABI, reader);
    const dec = m.underlyingDecimals || 18;
    const [sSpeed, bSpeed, sIdx, bIdx, lastBlock, ts, exch, tb, priceRaw, bal, bor, uS, uB] = await Promise.all([
        safe(master.vibeSupplySpeed(m.address), 0n),
        safe(master.vibeBorrowSpeed(m.address), 0n),
        safe(master.vibeSupplyIndex(m.address), 0n),
        safe(master.vibeBorrowIndex(m.address), 0n),
        safe(master.lastRewardBlock(m.address), 0n),
        safe(c.totalSupply(), 0n),
        safe(c.exchangeRateStored(), 0n),
        safe(c.totalBorrows(), 0n),
        oracle ? safe(oracle.getUnderlyingPrice(m.address), 0n) : 0n,
        user ? safe(c.balanceOf(user), 0n) : 0n,
        user ? safe(c.borrowBalance(user), 0n) : 0n,
        user ? safe(master.userSupplyIndex(user, m.address), 0n) : 0n,
        user ? safe(master.userBorrowIndex(user, m.address), 0n) : 0n,
    ]);

    const blocksPerYear = ACTIVE.blocksPerYear || 15768000;
    const blocksPerDay = blocksPerYear / 365;
    // Exchange rate is normalized to 18 decimals (V_cERC20), so cTokens * rate / 1e36 = underlying units.
    const supplyUnderlying = toNum(ts * exch, 36);
    const borrowUnderlying = toNum(tb, dec);
    const price = toNum(priceRaw, 18);
    const supplyPerYear = toNum(sSpeed) * blocksPerYear;
    const borrowPerYear = toNum(bSpeed) * blocksPerYear;
    // Same token-denominated formula as dashboard-main.js to keep numbers in sync across the site.
    const supplyApr = supplyUnderlying > 0.1 ? (supplyPerYear / supplyUnderlying) * 100 : 0;
    const borrowApr = borrowUnderlying > 0.1 ? (borrowPerYear / borrowUnderlying) * 100 : 0;

    // Mirror Master._updateMarketRewardIndices + _distributeUser* to estimate unsettled rewards.
    const delta = lastBlock > 0n && BigInt(block) > lastBlock ? BigInt(block) - lastBlock : 0n;
    const sIdxNow = sIdx + (sIdx > 0n && ts > 0n && sSpeed > 0n ? (sSpeed * delta * E36) / ts : 0n);
    const bIdxNow = bIdx + (bIdx > 0n && tb > 0n && bSpeed > 0n ? (bSpeed * delta * E36) / tb : 0n);
    const pendingSupply = uS > 0n && sIdxNow > uS ? (bal * (sIdxNow - uS)) / E36 : 0n;
    const pendingBorrow = uB > 0n && bIdxNow > uB ? (bor * (bIdxNow - uB)) / E36 : 0n;

    const userSupply = toNum(bal * exch, 36);
    const userBorrow = toNum(bor, dec);
    const userSupplyDay = ts > 0n ? toNum(sSpeed) * blocksPerDay * (Number(bal) / Number(ts)) : 0;
    const userBorrowDay = tb > 0n ? toNum(bSpeed) * blocksPerDay * Math.min(1, Number(bor) / Number(tb)) : 0;

    return {
        m, price, supplyUnderlying, borrowUnderlying, supplyApr, borrowApr,
        supplyDay: toNum(sSpeed) * blocksPerDay, borrowDay: toNum(bSpeed) * blocksPerDay,
        rewarded: sSpeed > 0n || bSpeed > 0n,
        pending: pendingSupply + pendingBorrow,
        userSupply, userBorrow, userSupplyDay, userBorrowDay,
    };
}

async function loadVaultData(reader, rewardsAddr) {
    const user = userAddress || null;
    const master = new ethers.Contract(rewardsAddr, VAULT_MASTER_ABI, reader);
    const [block, tokenAddr, oracleAddr, claimable] = await Promise.all([
        reader.getBlockNumber(),
        safe(master.vibeTokenExternal(), ethers.ZeroAddress),
        safe(master.oracle(), ethers.ZeroAddress),
        user ? master.vibeAccrued(user) : 0n,
    ]);
    const oracle = oracleAddr !== ethers.ZeroAddress ? new ethers.Contract(oracleAddr, VAULT_ORACLE_ABI, reader) : null;

    let token = null;
    if (tokenAddr && tokenAddr !== ethers.ZeroAddress) {
        const t = new ethers.Contract(tokenAddr, VAULT_TOKEN_ABI, reader);
        const [name, symbol, decimals, totalSupply, balance] = await Promise.all([
            safe(t.name(), "Vibe Governance Token"), safe(t.symbol(), "VIBE"), safe(t.decimals(), 18n),
            safe(t.totalSupply(), 0n), user ? safe(t.balanceOf(user), 0n) : 0n,
        ]);
        token = { address: tokenAddr, name, symbol, decimals: Number(decimals), totalSupply, balance };
    }

    const markets = await Promise.all((ACTIVE.cTokens || []).map(m => loadMarket(m, master, oracle, reader, block, user)));
    return { rewardsAddr, block, token, claimable, markets, user };
}

async function updateVibeVault() {
    if (!ACTIVE) return;
    const seq = ++loadSeq;
    const rewardsAddr = window.getRewardsAddress ? window.getRewardsAddress(ACTIVE) : ACTIVE.master;
    getEl("vvNetName").textContent = ACTIVE.label;

    if (!rewardsAddr || !(ACTIVE.cTokens || []).length) {
        vaultData = null;
        renderUnavailable("No VIBE rewards program on " + ACTIVE.label + " yet.");
        return;
    }

    let data;
    try {
        data = await loadVaultData(getReadProvider(), rewardsAddr);
    } catch (e) {
        // Public RPC down or rate-limited: fall back to the connected wallet's provider.
        if (provider && userAddress) {
            try { data = await loadVaultData(provider, rewardsAddr); } catch (e2) { console.error("Vault Error:", e2); }
        } else console.error("Vault Error:", e);
    }
    if (seq !== loadSeq) return;
    if (!data) { renderUnavailable("Could not load vault data. Retrying shortly…", true); return; }
    vaultData = data;
    renderVault(data);
}

function renderUnavailable(msg, isError) {
    ["kpiDaily", "kpiTvl", "kpiMarkets", "kpiSupply"].forEach(id => getEl(id).textContent = "—");
    getEl("vvMarketsBody").innerHTML = `<tr><td colspan="7"><div class="vv-empty">${msg}</div></td></tr>`;
    getEl("vvUpdated").textContent = isError ? "Offline" : "—";
    getEl("vvLiveDot").classList.remove("on");
    renderUser(null);
}

function renderVault(d) {
    const sym = d.token ? d.token.symbol : "VIBE";
    const dec = d.token ? d.token.decimals : 18;
    document.querySelectorAll("[data-vv-symbol]").forEach(el => el.textContent = sym);
    getEl("vvTokenSymbol").textContent = sym;
    if (d.token) getEl("vvTokenName").textContent = d.token.name;

    // Token + contract links
    const tAddr = d.token ? d.token.address : null;
    getEl("vvTokenAddrShort").textContent = shortAddr(tAddr);
    getEl("vvTokenExplorer").href = tAddr ? explorerUrl(tAddr) : "#";
    getEl("vvTokenLink").textContent = shortAddr(tAddr);
    getEl("vvTokenLink").href = tAddr ? explorerUrl(tAddr) : "#";
    getEl("vvMasterLink").textContent = shortAddr(d.rewardsAddr);
    getEl("vvMasterLink").href = explorerUrl(d.rewardsAddr);
    getEl("vvBlock").textContent = "#" + Number(d.block).toLocaleString("en-US");

    // KPIs
    const rewarded = d.markets.filter(x => x.rewarded);
    const daily = rewarded.reduce((s, x) => s + x.supplyDay + x.borrowDay, 0);
    const tvl = rewarded.reduce((s, x) => s + x.supplyUnderlying * x.price, 0);
    getEl("kpiDaily").textContent = fmt(daily, 2) + " " + sym;
    getEl("kpiTvl").textContent = fmtUSD(tvl);
    getEl("kpiMarkets").textContent = rewarded.length;
    getEl("kpiMarketsSub").textContent = "of " + d.markets.length + " listed";
    getEl("kpiSupply").textContent = d.token ? fmt(toNum(d.token.totalSupply, dec), 2) : "—";

    renderMarkets(d.markets, sym);
    renderUser(d);

    getEl("vvUpdated").textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    getEl("vvLiveDot").classList.add("on");
}

function aprPill(v) {
    const p = fmtPct(v);
    return p ? `<span class="vv-apr"><img src="icons/vibe.svg" alt="">+${p}</span>` : `<span class="vv-apr off">—</span>`;
}

function renderMarkets(markets, sym) {
    const rows = [...markets].sort((a, b) => (b.rewarded - a.rewarded) || ((b.supplyDay + b.borrowDay) - (a.supplyDay + a.borrowDay)));
    getEl("vvMarketsBody").innerHTML = rows.map(x => {
        const u = x.m.underlyingSymbol || x.m.symbol;
        const icon = x.m.icon || "icons/vibe.svg";
        return `<tr class="${x.rewarded ? "" : "vv-off-row"}">
          <td><div class="vv-asset"><img src="${icon}" alt="" onerror="this.src='icons/vibe.svg'"><div><b>${u}</b><small>${x.m.symbol}</small></div></div></td>
          <td class="r"><span class="vv-amt">${fmt(x.supplyUnderlying, 2)} ${u}</span><span class="vv-usd">${fmtUSD(x.supplyUnderlying * x.price)}</span></td>
          <td class="r">${aprPill(x.supplyApr)}</td>
          <td class="r"><span class="vv-amt">${fmt(x.borrowUnderlying, 2)} ${u}</span><span class="vv-usd">${fmtUSD(x.borrowUnderlying * x.price)}</span></td>
          <td class="r">${aprPill(x.borrowApr)}</td>
          <td class="r"><span class="vv-amt">${x.rewarded ? fmt(x.supplyDay + x.borrowDay, 2) : "—"}</span><span class="vv-usd">${x.rewarded ? sym : "No incentives"}</span></td>
          <td class="r"><a class="vv-btn-sm" href="dashboard.html" aria-label="Supply or borrow ${u} to earn">Earn →</a></td>
        </tr>`;
    }).join("") || `<tr><td colspan="7"><div class="vv-empty">No markets configured on this network.</div></td></tr>`;
}

function renderUser(d) {
    const badge = getEl("vvUserBadge");
    const posEl = getEl("vvPositions");
    if (!userAddress || !d || !d.user) {
        badge.textContent = "Not connected"; badge.classList.remove("on");
        getEl("vaultVibeRewards").textContent = "0.00";
        ["vvAccruing", "vvUserDaily", "vaultVibeWallet"].forEach(id => getEl(id).textContent = "—");
        posEl.innerHTML = `<div class="vv-empty">Connect your wallet to see the positions earning VIBE.</div>`;
        btnClaim.disabled = !d && !!userAddress;
        btnClaim.textContent = userAddress ? "Unavailable" : "Connect wallet to claim";
        return;
    }
    const sym = d.token ? d.token.symbol : "VIBE";
    const claimable = toNum(d.claimable);
    const accruing = d.markets.reduce((s, x) => s + x.pending, 0n);
    const daily = d.markets.reduce((s, x) => s + x.userSupplyDay + x.userBorrowDay, 0);

    badge.textContent = "Earning"; badge.classList.add("on");
    getEl("vaultVibeRewards").textContent = claimable.toLocaleString("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 2 });
    getEl("vvAccruing").textContent = accruing > 0n ? "+" + fmt(toNum(accruing), 4) : "0";
    getEl("vvUserDaily").textContent = fmt(daily, 4);
    getEl("vaultVibeWallet").textContent = d.token ? fmt(toNum(d.token.balance, d.token.decimals), 2) : "—";

    if (!claiming) {
        btnClaim.disabled = claimable < 0.0001;
        btnClaim.textContent = btnClaim.disabled ? (accruing > 0n ? "Accruing — interact to settle" : "Nothing to claim yet") : `Claim ${fmt(claimable, 4)} ${sym}`;
    }

    const positions = d.markets.filter(x => x.userSupply > 0 || x.userBorrow > 0);
    posEl.innerHTML = positions.length ? positions.map(x => {
        const u = x.m.underlyingSymbol || x.m.symbol;
        return `<div class="vv-pos">
          <div class="vv-asset"><img src="${x.m.icon || "icons/vibe.svg"}" alt="" onerror="this.src='icons/vibe.svg'"><div><b>${u}</b><small>${fmtUSD((x.userSupply - x.userBorrow) * x.price) === "—" ? "" : "Net " + fmtUSD((x.userSupply - x.userBorrow) * x.price)}</small></div></div>
          <div><span class="vv-pos-k">Supplied</span><span class="vv-pos-v">${fmt(x.userSupply, 4)}</span><span class="vv-pos-v gold">+${fmt(x.userSupplyDay, 4)} ${sym}/d</span></div>
          <div><span class="vv-pos-k">Borrowed</span><span class="vv-pos-v">${fmt(x.userBorrow, 4)}</span><span class="vv-pos-v gold">+${fmt(x.userBorrowDay, 4)} ${sym}/d</span></div>
        </div>`;
    }).join("") : `<div class="vv-empty">No active positions. <a class="vv-link" href="dashboard.html">Supply or borrow</a> in a rewarded market to start earning ${sym}.</div>`;
}

function setStatus(msg, isErr) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("err", !!isErr);
}

btnClaim.onclick = async () => {
  if (!userAddress) { openWalletModal(); return; }
  const rewardsAddr = window.getRewardsAddress ? window.getRewardsAddress(ACTIVE) : null;
  if (!signer || !rewardsAddr) return;
  claiming = true;
  btnClaim.disabled = true;
  try {
    const vaultSigner = new ethers.Contract(rewardsAddr, window.REWARDS_ABI, signer);
    btnClaim.textContent = "Claiming..."; setStatus("Confirm in your wallet…");
    const tx = await vaultSigner.claimVIBE(userAddress);
    setStatus("Transaction sent. Waiting for confirmation…");
    await tx.wait();
    setStatus("Success! Rewards claimed.");
    setTimeout(() => setStatus(""), 6000);
  } catch(e) {
    setStatus("Error: " + (e.shortMessage || e.reason || "Failed"), true);
  } finally {
    claiming = false;
    await updateVibeVault();
  }
};

getEl("vvCopyToken").onclick = async () => {
    const a = vaultData && vaultData.token && vaultData.token.address;
    if (!a) return;
    await navigator.clipboard.writeText(a);
    const el = getEl("vvTokenAddrShort"); el.textContent = "Copied!";
    setTimeout(() => el.textContent = shortAddr(a), 1500);
};

getEl("vvAddToken").onclick = async () => {
    const t = vaultData && vaultData.token;
    const eth = selectedProvider || window.ethereum;
    if (!t || !eth) { if (!eth) alert("Please install a wallet"); return; }
    try {
        await eth.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: {
            address: t.address, symbol: t.symbol.slice(0, 11), decimals: t.decimals,
            image: new URL("icons/vibe.svg", location.href).href,
        } } });
    } catch (e) { console.warn("watchAsset:", e); }
};

function startAutoRefresh() {
    setInterval(() => {
        if (document.visibilityState === "visible" && !claiming) updateVibeVault();
    }, REFRESH_MS);
}
