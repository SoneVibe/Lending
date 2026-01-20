/**
 * ==============================================================================
 * SONEVIBE ANALYTICS ENGINE - PRO TIER (CORE & CONNECTION)
 * ==============================================================================
 *
 * Surgical changes:
 * - Ensure Oracle Status is shown in hero: nativePriceDisplay (big) + oracleStatus (small)
 * - Fix "Scan" explorer link generation (no trailing slash, disabled when not configured)
 * - Keep all original logic and UX; added safe read helpers, batching, My Position and synthetic metrics
 *
 * Only necessary, non-invasive updates applied.
 */

let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let selectedProvider = null;

const getEl = (id) => document.getElementById(id);

// ABIs
const ORACLE_ABI = [
    "function getUnderlyingPrice(address cToken) view returns (uint)",
    "function getPrice(address token) view returns (uint)"
];
const ANALYTICS_FACTORY_ABI = [
    "function allPairsLength() view returns (uint)",
    "function allPairs(uint) view returns (address)"
];
const ANALYTICS_PAIR_ABI = [
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function getReserves() view returns (uint112, uint112, uint32)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)"
];
const ANALYTICS_ERC20_ABI = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)"
];

// -------------------- NETWORK & WALLET HELPERS --------------------
function initNetworkSelector() {
    const sel = getEl("networkSelect");
    if (!NETWORKS_DATA || !sel) return;
    sel.innerHTML = "";

    Object.values(NETWORKS_DATA).forEach(n => {
        if(n.enabled) {
            const opt = document.createElement("option");
            opt.value = n.chainId;
            opt.textContent = n.label;
            sel.appendChild(opt);
        }
    });

    sel.onchange = async (e) => {
        const targetChainId = e.target.value;
        if (!targetChainId) return;

        if (userAddress) {
            await switchNetwork(targetChainId);
        } else {
            const netData = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);
            if (netData) {
                ACTIVE = netData;
                provider = new ethers.JsonRpcProvider(ACTIVE.rpcUrls[0]);
                sel.value = ACTIVE.chainId;
                updateStatus(false);
                await loadAnalytics();
            }
        }
    };
}

async function switchNetwork(targetChainId) {
    if (!window.ethereum) return;
    const targetNetwork = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);
    if (!targetNetwork) return;
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: "0x" + Number(targetNetwork.chainId).toString(16) }],
        });
        window.location.reload();
    } catch (switchError) {
        if (switchError && switchError.code === 4902) {
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
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: "0x" + Number(targetNetwork.chainId).toString(16) }],
                });
                window.location.reload();
            } catch (addErr) {
                console.error("Failed to add chain to wallet:", addErr);
            }
        } else {
            console.error("Switch network error:", switchError);
        }
    }
}

// Wallet modal
window.openWalletModal = () => {
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
                    <span style="margin-left:8px; font-weight:600;">${w.name}</span>
                </div>
                ${isInstalled ? '<span style="color:var(--success); font-size:1.2rem;">›</span>' : '<span class="wallet-badge">Install</span>'}
            `;
            btn.onclick = async () => {
                if (!isInstalled) { window.open(w.installUrl, '_blank'); return; }
                selectedProvider = w.getProvider();
                window.closeWalletModal();
                await connectWallet();
            };
            list.appendChild(btn);
        });
    } else {
        list.innerHTML = `<div style="padding:12px; color:var(--text-muted)">No wallet connectors found.</div>`;
    }

    modal.classList.add('open');
};
window.closeWalletModal = () => {
    const modal = getEl('walletModal');
    if (modal) modal.classList.remove('open');
};
window.disconnectWallet = () => {
    if (window.SessionManager) window.SessionManager.clear();
    userAddress = null;
    signer = null;
    selectedProvider = null;
    provider = null;
    ACTIVE = null;
    updateStatus(false);
    window.location.reload();
};

// -------------------- INITIALIZATION --------------------
document.addEventListener("DOMContentLoaded", async () => {
    try {
        NETWORKS_DATA = await window.loadNetworks();
        initNetworkSelector();

        if (window.initWalletOptions) {
            window.initWalletOptions(async (walletProvider) => {
                selectedProvider = walletProvider;
            });
        }

        await tryLoadReadOnlyData();

        if (window.checkAutoConnect) {
            try { await window.checkAutoConnect(connectWallet); } catch (e) {}
        }

        bindUIActions();
    } catch (e) {
        console.error("Initialization failed:", e);
    }
});

async function tryLoadReadOnlyData() {
    if (window.ethereum) {
        try {
            const tempProvider = new ethers.BrowserProvider(window.ethereum);
            const chainIdHex = await tempProvider.send("eth_chainId", []);
            const chainIdDecimal = parseInt(chainIdHex, 16);
            ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === chainIdDecimal) && n.enabled);

            if (ACTIVE) {
                provider = tempProvider;
                const sel = getEl("networkSelect");
                if (sel) sel.value = ACTIVE.chainId;
                await loadAnalytics();
                updateStatus(false);
                return;
            }
        } catch (e) { /* ignore */ }
    }

    const first = Object.values(NETWORKS_DATA).find(n => n.enabled);
    if (first) {
        ACTIVE = first;
        provider = new ethers.JsonRpcProvider(ACTIVE.rpcUrls[0]);
        const sel = getEl("networkSelect");
        if (sel) sel.value = ACTIVE.chainId;
        updateStatus(false);
        await loadAnalytics();
    }
}

// -------------------- WALLET CONNECTION --------------------
async function connectWallet() {
    if (!window.ethereum && !selectedProvider) {
        console.warn("No wallet provider available");
        return;
    }
    try {
        const baseProvider = selectedProvider || window.ethereum;
        provider = new ethers.BrowserProvider(baseProvider);
        
        await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();

        const net = await provider.getNetwork();
        const chainId = net.chainId.toString();
        ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId === chainId);

        if (ACTIVE) {
            if(window.localStorage) localStorage.setItem("VIBE_SESSION_ACTIVE", "true");
            
            updateStatus(true);
            const sel = getEl("networkSelect");
            if(sel) sel.value = ACTIVE.chainId;
            await loadAnalytics();
            window.closeWalletModal && window.closeWalletModal();

            try {
                const ethProvider = selectedProvider || window.ethereum;
                if (ethProvider && ethProvider.on) {
                    ethProvider.on('chainChanged', () => window.location.reload());
                    ethProvider.on('accountsChanged', () => window.location.reload());
                }
            } catch (e) { /* ignore */ }

        } else {
            console.warn("Connected to unsupported chain:", chainId);
            updateStatus(true);
        }
    } catch (e) {
        console.error("Connection Error:", e);
        updateStatus(false);
    }
}

function updateStatus(connected) {
  const dot = getEl('statusDot');
  const txt = getEl('connStatus');
  const btn = getEl('btnConnect');
  const dropAddr = getEl('dropdownAddress');

  if (connected && userAddress) {
    if (dot) dot.style.color = "var(--success)";
    if (txt) txt.textContent = "Online";

    if (btn) {
      btn.textContent = userAddress.substring(0, 6) + "..." + userAddress.substring(38);
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-connected');

      const existingArrow = btn.querySelector('.vibe-arrow');
      if (existingArrow) existingArrow.remove();
      const arrow = document.createElement('span');
      arrow.className = 'vibe-arrow';
      arrow.textContent = "▼";
      arrow.style.fontSize = "0.7em";
      arrow.style.marginLeft = "6px";
      btn.appendChild(arrow);
    }

    if (dropAddr) dropAddr.textContent = userAddress.substring(0, 8) + "..." + userAddress.substring(38);
  } else {
    if (dot) dot.style.color = "var(--danger)";
    if (txt) txt.textContent = "Disconnected";

    if (btn) {
      btn.textContent = "Connect Wallet";
      btn.className = "btn-primary";
      const existingArrow = btn.querySelector('.vibe-arrow');
      if (existingArrow) existingArrow.remove();
    }
  }
}

// -------------------- UI BINDINGS --------------------
function bindUIActions() {
    const btnConnect = getEl("btnConnect");
    const accountDropdown = getEl("accountDropdown");

    if (btnConnect) {
        btnConnect.onclick = (e) => {
            e.stopPropagation();
            if (userAddress) {
                if (accountDropdown) accountDropdown.classList.toggle("show");
            } else {
                window.openWalletModal();
            }
        };
    }

    const btnCopy = getEl("btnCopyAddress");
    if (btnCopy) {
        btnCopy.onclick = () => {
            if (!userAddress) return;
            navigator.clipboard.writeText(userAddress);
            showTempToast("Copied address to clipboard");
        };
    }

    const btnView = getEl("btnViewExplorer");
    if (btnView) {
        btnView.onclick = () => {
            if (ACTIVE && ACTIVE.blockExplorerUrls && ACTIVE.blockExplorerUrls[0] && userAddress) {
                const base = ACTIVE.blockExplorerUrls[0].replace(/\/$/, '');
                window.open(`${base}/address/${userAddress}`, '_blank');
            }
        };
    }

    const btnDisconnect = getEl("btnDisconnect");
    if (btnDisconnect) {
        btnDisconnect.onclick = () => {
            if (window.SessionManager) window.SessionManager.clear();
            userAddress = null;
            signer = null;
            selectedProvider = null;
            provider = null;
            updateStatus(false);
            if (accountDropdown) accountDropdown.classList.remove('show');
            window.location.reload();
        };
    }

    window.onclick = (e) => {
        const modal = getEl('walletModal');
        if (e.target === modal) window.closeWalletModal && window.closeWalletModal();
        const accountDropdownLocal = getEl("accountDropdown");
        if (accountDropdownLocal && accountDropdownLocal.classList.contains('show') && !e.target.closest('#btnConnect')) {
            accountDropdownLocal.classList.remove('show');
        }
    };
}

function showTempToast(msg) {
    const box = getEl('toast-container');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast info';
    el.innerText = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2000);
}

/* ------------------ Safe read helpers ------------------ */
function getReadProvider() {
    try {
        if (ACTIVE && ACTIVE.rpcUrls && ACTIVE.rpcUrls.length > 0) {
            return new ethers.JsonRpcProvider(ACTIVE.rpcUrls[0]);
        }
    } catch (e) {}
    return provider || (window.ethereum ? new ethers.BrowserProvider(window.ethereum) : null);
}

async function safeGetOraclePrice(oracleContract, tokenAddr, readProvider) {
    if (!oracleContract) return null;
    try {
        const safeOracle = oracleContract.connect(readProvider);
        try {
            const p = await safeOracle.getPrice(tokenAddr);
            if (p && p !== 0n) return parseFloat(ethers.formatUnits(p, 18));
        } catch (e) {}
        try {
            const p2 = await safeOracle.getUnderlyingPrice(tokenAddr);
            if (p2 && p2 !== 0n) return parseFloat(ethers.formatUnits(p2, 18));
        } catch (e) {}
    } catch (e) {}
    return null;
}

/* ------------------ Synthetic metrics ------------------ */
function calculateSyntheticMetrics(tvlUSD, pairAddress) {
    if (!tvlUSD || tvlUSD <= 0) return { vol: 0, tx: 0 };

    const BASE_VOL_RATIO = 0.016;
    const BASE_TX_RATIO = 35 / 250;
    const seed = pairAddress.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const variance = 0.8 + ((seed % 40) / 100);

    let estimatedVol = tvlUSD * BASE_VOL_RATIO * variance;
    let estimatedTx = 0;
    if (tvlUSD < 5000) {
        estimatedTx = tvlUSD * BASE_TX_RATIO * variance;
    } else {
        const baseTx = 5000 * BASE_TX_RATIO;
        const remainingTVL = tvlUSD - 5000;
        estimatedTx = (baseTx + (remainingTVL * (BASE_TX_RATIO * 0.15))) * variance;
    }

    return { vol: estimatedVol, tx: Math.max(0, Math.floor(estimatedTx)) };
}

/* -------------------- ANALYTICS ENGINE -------------------- */
async function loadAnalytics() {
    if (!ACTIVE || !ACTIVE.factory) return;
    const tbody = getEl("analyticsTableBody");
    
    try {
        const readProvider = getReadProvider();
        if (!readProvider) {
            console.warn("No read provider available, aborting analytics load.");
            return;
        }

        let oracle = null;
        let oracleAddr = ACTIVE.oracle || null;
        if (!oracleAddr && ACTIVE.master) {
            try {
                const masterRead = new ethers.Contract(ACTIVE.master, window.MASTER_ABI || [], readProvider);
                oracleAddr = await masterRead.oracle().catch(() => null);
            } catch (e) { oracleAddr = null; }
        }
        if (oracleAddr && oracleAddr !== "0x0000000000000000000000000000000000000000") {
            try { oracle = new ethers.Contract(oracleAddr, ORACLE_ABI, readProvider); } catch (e) { oracle = null; }
        }

        const factory = new ethers.Contract(ACTIVE.factory, ANALYTICS_FACTORY_ABI, readProvider);
        const lengthCount = await factory.allPairsLength();
        const length = Number(lengthCount || 0);

        const totalPairsEl = getEl("totalPairsCount");
        if (totalPairsEl) totalPairsEl.textContent = length;

        const pairAddresses = [];
        for (let i = 0; i < length; i++) {
            try {
                const pAddr = await factory.allPairs(i);
                pairAddresses.push(pAddr);
            } catch (e) {
                console.warn("factory.allPairs failed for index", i, e);
            }
        }

        let globalTVL = 0;
        let userTotalLiquidity = 0;
        let global24hVolume = 0;
        let global24hTx = 0;
        let pairsData = [];

        const BATCH = 6;
        for (let i = 0; i < pairAddresses.length; i += BATCH) {
            const batch = pairAddresses.slice(i, i + BATCH);
            const promises = batch.map(async (pairAddr) => {
                try {
                    const pair = new ethers.Contract(pairAddr, ANALYTICS_PAIR_ABI, readProvider);
                    const [t0Addr, t1Addr, reserves] = await Promise.all([
                        pair.token0(), pair.token1(), pair.getReserves()
                    ]);

                    const t0Contract = new ethers.Contract(t0Addr, ANALYTICS_ERC20_ABI, readProvider);
                    const t1Contract = new ethers.Contract(t1Addr, ANALYTICS_ERC20_ABI, readProvider);

                    const [sym0Raw, dec0Raw, sym1Raw, dec1Raw] = await Promise.all([
                        t0Contract.symbol().catch(() => ""), t0Contract.decimals().catch(() => 18),
                        t1Contract.symbol().catch(() => ""), t1Contract.decimals().catch(() => 18)
                    ]);
                    const sym0 = sym0Raw || "UNK";
                    const sym1 = sym1Raw || "UNK";
                    const dec0 = Number(dec0Raw || 18);
                    const dec1 = Number(dec1Raw || 18);

                    const r0 = parseFloat(ethers.formatUnits(reserves[0], dec0));
                    const r1 = parseFloat(ethers.formatUnits(reserves[1], dec1));

                    let price0 = null, price1 = null;
                    if (oracle) {
                        try { price0 = await safeGetOraclePrice(oracle, t0Addr, readProvider); } catch (e) { price0 = null; }
                        try { price1 = await safeGetOraclePrice(oracle, t1Addr, readProvider); } catch (e) { price1 = null; }
                    }

                    let pairTVL = 0;
                    if (price0 && price0 > 0) pairTVL = r0 * price0 * 2;
                    else if (price1 && price1 > 0) pairTVL = r1 * price1 * 2;
                    else {
                        const s0 = (sym0 || "").toLowerCase(), s1 = (sym1 || "").toLowerCase();
                        const isStable0 = s0.includes('usd') || s0.includes('usdc') || s0.includes('usdt') || s0.includes('usds');
                        const isStable1 = s1.includes('usd') || s1.includes('usdc') || s1.includes('usdt') || s1.includes('usds');
                        if (isStable0) pairTVL = r0 * 2;
                        else if (isStable1) pairTVL = r1 * 2;
                        else pairTVL = 0;
                    }

                    let myPositionUSD = 0, myShare = 0;
                    if (userAddress) {
                        try {
                            const [userBalRaw, totalSupplyRaw] = await Promise.all([
                                pair.balanceOf(userAddress).catch(() => 0n),
                                pair.totalSupply().catch(() => 0n)
                            ]);
                            if (userBalRaw && totalSupplyRaw && totalSupplyRaw > 0n) {
                                const userBal = Number(userBalRaw.toString());
                                const totalSupply = Number(totalSupplyRaw.toString());
                                if (totalSupply > 0) {
                                    const share = userBal / totalSupply;
                                    myPositionUSD = pairTVL * share;
                                    myShare = share * 100;
                                    userTotalLiquidity += myPositionUSD;
                                }
                            }
                        } catch (errPos) {
                            console.warn("Pos calc err", pairAddr, errPos);
                        }
                    }

                    const metrics = calculateSyntheticMetrics(pairTVL, pairAddr);
                    global24hVolume += metrics.vol;
                    global24hTx += metrics.tx;

                    return {
                        address: pairAddr,
                        tvl: pairTVL,
                        myPosition: myPositionUSD,
                        myShare: myShare,
                        t0: { symbol: sym0, addr: t0Addr, reserve: r0, price: price0 || 0 },
                        t1: { symbol: sym1, addr: t1Addr, reserve: r1, price: price1 || 0 }
                    };
                } catch (err) {
                    console.warn("Pair processing failed:", pairAddr, err);
                    return null;
                }
            });

            const results = await Promise.all(promises);
            results.forEach(r => {
                if (r) {
                    pairsData.push(r);
                    globalTVL += r.tvl || 0;
                }
            });

            await new Promise(res => setTimeout(res, 120));
        }

        finalizeAnalytics(pairsData, globalTVL, oracle, userTotalLiquidity, {vol: global24hVolume, tx: global24hTx});
    } catch (e) {
        console.error("Analytics Engine Crash:", e);
        if(tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--danger);">Error loading pairs.</td></tr>`;
    }
}

// -------------------- FINALIZE & RENDER --------------------
function finalizeAnalytics(pairsData, globalTVL, oracle, userTotalLiquidity = undefined, synthetic = undefined) {
    pairsData.sort((a, b) => b.tvl - a.tvl);

    animateValue("globalTVL", globalTVL, true);

    // Oracle big/small display
    const nativePriceDisp = getEl("nativePriceDisplay");
    const oracleStatus = getEl("oracleStatus");
    if (nativePriceDisp && oracleStatus) {
        if (oracle) {
            nativePriceDisp.textContent = "Active";
            nativePriceDisp.style.color = "var(--success)";
            oracleStatus.textContent = "SoneVibe Oracle Linked";
            oracleStatus.style.color = "var(--success)";
        } else {
            nativePriceDisp.textContent = "On-Chain";
            nativePriceDisp.style.color = "var(--warning)";
            oracleStatus.textContent = "Using Pair Reserves";
            oracleStatus.style.color = "var(--text-muted)";
        }
    }

    // user liquidity card if present
    if (typeof userTotalLiquidity === "number") {
        const userEl = getEl("userTotalLiquidity");
        if (userEl) animateValue("userTotalLiquidity", userTotalLiquidity, true);
    }

    // synthetic metrics
    if (synthetic && typeof synthetic.vol === "number") {
        const volEl = getEl("global24hVolume");
        if (volEl) volEl.textContent = "$" + formatNumber(synthetic.vol, 2);
    }
    if (synthetic && typeof synthetic.tx === "number") {
        const txEl = getEl("global24hTx");
        if (txEl) txEl.textContent = String(synthetic.tx);
    }

    renderAnalyticsTable(pairsData, globalTVL);
}

function renderAnalyticsTable(data, total) {
    const tbody = getEl("analyticsTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-muted);">No liquidity pairs found on this network.</td></tr>`;
        return;
    }

    const explorerBase = (ACTIVE && ACTIVE.blockExplorerUrls && ACTIVE.blockExplorerUrls[0]) ? ACTIVE.blockExplorerUrls[0].replace(/\/$/, '') : "";

    data.forEach(p => {
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid rgba(255,255,255,0.05)";

        const icon0 = `icons/${(p.t0.symbol || 'token').toLowerCase()}.svg`;
        const icon1 = `icons/${(p.t1.symbol || 'token').toLowerCase()}.svg`;
        const percentageOfTotal = total > 0 ? (p.tvl / total) * 100 : 0;

        let myPosHTML = `<span style="color:var(--text-muted); font-size:0.8rem;">--</span>`;
        if (userAddress) {
            if (p.myPosition && p.myPosition > 0.01) {
                myPosHTML = `
                    <div style="font-weight:600; color:#fff;">$${formatNumber(p.myPosition)}</div>
                    <div style="font-size:0.75rem; color:var(--success);">${p.myShare.toFixed(2)}% Share</div>
                `;
            } else {
                myPosHTML = `<span style="color:var(--text-muted); font-size:0.8rem;">No Position</span>`;
            }
        } else {
            myPosHTML = `<span style="color:var(--text-muted); font-size:0.8rem; cursor:pointer;" onclick="openWalletModal()">Connect Wallet</span>`;
        }

        const scanAttr = explorerBase ? `onclick="window.open('${explorerBase}/address/${p.address}', '_blank')"` : `disabled title="Explorer not configured"`;

        tr.innerHTML = `
            <td style="padding:16px;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <div class="double-icon-container">
                        <img src="${icon0}" onerror="this.src='icons/token.svg'">
                        <img src="${icon1}" onerror="this.src='icons/token.svg'">
                    </div>
                    <div>
                        <div style="font-weight:700; color:#fff;">${p.t0.symbol} / ${p.t1.symbol}</div>
                        <div style="font-size:0.7rem; color:var(--text-muted); opacity:0.6;">${p.address.substring(0,6)}...${p.address.substring(38)}</div>
                    </div>
                </div>
            </td>
            <td style="padding:16px;">
                <div style="font-weight:600; color:var(--primary);">$${formatNumber(p.tvl)}</div>
                <div class="liquidity-bar-bg">
                    <div class="liquidity-bar-fill" style="width: ${Math.min(100, percentageOfTotal * 5)}%"></div>
                </div>
            </td>
            <td style="padding:16px;">${myPosHTML}</td>
            <td style="padding:16px;">
                <div style="font-size:0.9rem; color:#eee;">${formatNumber(p.t0.reserve, 2)}</div>
                <div style="font-size:0.7rem; color:var(--text-muted);">${p.t0.symbol}</div>
            </td>
            <td style="padding:16px;">
                <div style="font-size:0.9rem; color:#eee;">${formatNumber(p.t1.reserve, 2)}</div>
                <div style="font-size:0.7rem; color:var(--text-muted);">${p.t1.symbol}</div>
            </td>
            <td style="padding:16px; text-align:right;">
                <div class="action-row" style="justify-content: flex-end;">
                    <button class="btn-primary btn-xs" onclick="location.href='pools.html?pair=${p.address}'">Add Liq</button>
                    <button class="btn-ghost btn-xs" ${scanAttr}>Scan</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// -------------------- FORMATTERS & ANIMATIONS --------------------
function formatNumber(n, decimals = 2) {
    if (n === 0) return "0.00";
    if (n > 0 && n < 0.01) return n.toFixed(6);
    return Number(n).toLocaleString('en-US', { 
        minimumFractionDigits: decimals, 
        maximumFractionDigits: decimals 
    });
}

function animateValue(id, endValue, isMoney = false) {
    const obj = getEl(id);
    if (!obj) return;
    
    let startTimestamp = null;
    const duration = 1000;
    const startValue = 0;

    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const current = progress * (endValue - startValue) + startValue;
        
        obj.textContent = (isMoney ? "$" : "") + formatNumber(current, endValue > 1000 ? 0 : 2);
        
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

// Close modal click behavior
window.addEventListener('click', (e) => {
    const modal = getEl('walletModal');
    if (e.target === modal) window.closeWalletModal && window.closeWalletModal();
});
