/**
 * ==============================================================================
 * SONEVIBE ANALYTICS ENGINE - PRO TIER (CORE & CONNECTION)
 * ==============================================================================
 *
 * FIXED: Added missing network/wallet helpers used by the page so analytics.js
 * works like markets.js for connection & network switching. Only connection/
 * network helper code was added; rest of logic kept intact.
 *
 * IMPORTANT CHANGE:
 * - Removed automatic auto-connect on page load. The page will NOT call
 *   connectWallet() automatically anymore. The user must click "Connect Wallet"
 *   (same UX as swap.js / markets.js). This prevents the analytics engine from
 *   opening wallet popups on load.
 */

let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let selectedProvider = null; 

const getEl = (id) => document.getElementById(id);

// ABIs Críticos
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
    "function getReserves() view returns (uint112, uint112, uint32)"
];
const ANALYTICS_ERC20_ABI = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)"
];

// -------------------- NETWORK & WALLET HELPERS (ADDED) --------------------
/**
 * Populate the network select control and attach onchange behavior.
 * Mirrors the behavior in markets.js:
 * - If wallet connected, asks wallet to switch network.
 * - If no wallet, switches read-only provider to selected network.
 */
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
            // If user is connected, request wallet network switch (reloads to sync state)
            await switchNetwork(targetChainId);
        } else {
            // Read-only mode: change provider and reload analytics for that network
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

/**
 * Try to switch the connected wallet network (MetaMask / injected) to target.
 * Mirrors markets.js behaviour and reloads page on success.
 */
async function switchNetwork(targetChainId) {
    if (!window.ethereum) return;
    const targetNetwork = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);
    if (!targetNetwork) return;
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: "0x" + Number(targetNetwork.chainId).toString(16) }],
        });
        // After switching, reload to re-init the page state (same as markets.js)
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
                // After adding, try switching again then reload
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

/**
 * Wallet modal UI (open) - populates wallet options from window.WALLET_CONFIG.
 * This is used by analytics.html -> button that calls window.openWalletModal()
 */
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

/**
 * Close wallet modal
 */
window.closeWalletModal = () => {
    const modal = getEl('walletModal');
    if (modal) modal.classList.remove('open');
};

/**
 * Disconnect helper exposed to analytics.html (Disconnect menu item)
 * Mirrors markets.js behaviour: clear session and reload to reset state
 */
window.disconnectWallet = () => {
    if (window.SessionManager) window.SessionManager.clear();
    userAddress = null;
    signer = null;
    selectedProvider = null;
    provider = null;
    ACTIVE = null;
    updateStatus(false);
    // reload to reset page state (same UX as markets.js)
    window.location.reload();
};

// -------------------- INITIALIZATION --------------------

document.addEventListener("DOMContentLoaded", async () => {
    try {
        // 1. Cargar Redes
        NETWORKS_DATA = await window.loadNetworks();

        // Ensure network selector helper exists BEFORE usage
        initNetworkSelector();

        // 2. Inicializar Modal (Wallet-config.js)
        if (window.initWalletOptions) {
            window.initWalletOptions(async (walletProvider) => {
                selectedProvider = walletProvider;
                // do NOT auto-connect here; only store provider for user action
            });
        }

        // 3. Carga Read-Only inicial (sin wallet) - igual que markets.js
        await tryLoadReadOnlyData();

        // --- IMPORTANT: NO AUTO-CONNECT ---
        // We DO NOT call checkAutoConnect(connectWallet) here.
        // This ensures no popup / auto connection happens on page load.
        // User must click "Connect Wallet" to initiate wallet connection,
        // matching the UX behavior requested (same as swap.js button flow).

        // 4. Bind UI button handlers (same as markets.js)
        bindUIActions();

    } catch (e) {
        console.error("Initialization failed:", e);
    }
});

/**
 * Try to load read-only data if injected provider exists (mirrors markets.js)
 */
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

    // fallback to first enabled network
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
        // Usar el proveedor seleccionado o metamask por defecto
        const baseProvider = selectedProvider || window.ethereum;
        provider = new ethers.BrowserProvider(baseProvider);
        
        await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();

        const net = await provider.getNetwork();
        const chainId = net.chainId.toString();
        ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId === chainId);

        if (ACTIVE) {
            // Guardar sesión para que al recargar no se pierda (Como en Markets)
            if(window.localStorage) localStorage.setItem("VIBE_SESSION_ACTIVE", "true");
            
            updateStatus(true);
            const sel = getEl("networkSelect");
            if(sel) sel.value = ACTIVE.chainId;
            await loadAnalytics();
            window.closeWalletModal && window.closeWalletModal();

            // Add listeners to reload UI on chain/account change (same UX as markets.js)
            try {
                const ethProvider = selectedProvider || window.ethereum;
                if (ethProvider && ethProvider.on) {
                    ethProvider.on('chainChanged', () => window.location.reload());
                    ethProvider.on('accountsChanged', () => window.location.reload());
                }
            } catch (e) { /* ignore */ }

        } else {
            // If the connected chain isn't supported, keep connected but warn
            console.warn("Connected to unsupported chain:", chainId);
            updateStatus(true);
        }
    } catch (e) {
        console.error("Connection Error:", e);
        // best effort status update
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

      // remove any previous arrow then add one
      const existingArrow = btn.querySelector('.vibe-arrow');
      if (existingArrow) existingArrow.remove();
      const arrow = document.createElement('span');
      arrow.className = 'vibe-arrow';
      arrow.textContent = "▼";
      arrow.style.fontSize = "0.7em";
      arrow.style.marginLeft = "6px";
      btn.appendChild(arrow);
    }

    // Sólo actualizar dropdown cuando ESTÉ conectado (igual que swap.js)
    if (dropAddr) dropAddr.textContent = userAddress.substring(0, 8) + "..." + userAddress.substring(38);
  } else {
    // Cuando NO está conectado se comporta como swap: no sobreescribimos dropdownAddress,
    // sólo actualizamos el estado y el botón.
    if (dot) dot.style.color = "var(--danger)";
    if (txt) txt.textContent = "Disconnected";

    if (btn) {
      btn.textContent = "Connect Wallet";
      btn.className = "btn-primary";
      const existingArrow = btn.querySelector('.vibe-arrow');
      if (existingArrow) existingArrow.remove();
    }
    // NO tocamos dropAddr aquí (deja el valor que tenga en el HTML)
  }
}

// -------------------- UI BINDINGS (markets.js parity) --------------------
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
            // small visual feedback
            showTempToast("Copied address to clipboard");
        };
    }

    const btnView = getEl("btnViewExplorer");
    if (btnView) {
        btnView.onclick = () => {
            if (ACTIVE && ACTIVE.blockExplorerUrls && ACTIVE.blockExplorerUrls[0] && userAddress) {
                window.open(ACTIVE.blockExplorerUrls[0] + "/address/" + userAddress, '_blank');
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
            // Reload to clear state (same UX as markets.js)
            window.location.reload();
        };
    }

    // Close account dropdown on outside click
    window.onclick = (e) => {
        const modal = getEl('walletModal');
        if (e.target === modal) window.closeWalletModal && window.closeWalletModal();
        const accountDropdownLocal = getEl("accountDropdown");
        if (accountDropdownLocal && accountDropdownLocal.classList.contains('show') && !e.target.closest('#btnConnect')) {
            accountDropdownLocal.classList.remove('show');
        }
    };
}

// small helper for minimal user feedback
function showTempToast(msg) {
    const box = getEl('toast-container');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast info';
    el.innerText = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2000);
}

/* ------------------ NEW: Safe read helpers to avoid inpage RPC errors ------------------ */

/**
 * Return a read provider prioritizing the configured RPC URL (ACTIVE.rpcUrls[0]).
 * Falls back to the existing `provider` or the injected BrowserProvider if needed.
 */
function getReadProvider() {
    try {
        if (ACTIVE && ACTIVE.rpcUrls && ACTIVE.rpcUrls.length > 0) {
            return new ethers.JsonRpcProvider(ACTIVE.rpcUrls[0]);
        }
    } catch (e) {
        // ignore
    }
    // fallback to existing provider (which may be BrowserProvider) or null
    return provider || (window.ethereum ? new ethers.BrowserProvider(window.ethereum) : null);
}

/**
 * Safely try to get price from oracle contract. Returns number price (float) or null.
 * Uses the provided readProvider by connecting the oracle contract to it.
 */
async function safeGetOraclePrice(oracleContract, tokenAddr, readProvider) {
    if (!oracleContract) return null;
    try {
        const safeOracle = oracleContract.connect(readProvider);
        // try getPrice first, then getUnderlyingPrice
        try {
            const p = await safeOracle.getPrice(tokenAddr);
            if (p && p !== 0n) return parseFloat(ethers.formatUnits(p, 18));
        } catch (e) {
            // ignore and try fallback
        }
        try {
            const p2 = await safeOracle.getUnderlyingPrice(tokenAddr);
            if (p2 && p2 !== 0n) return parseFloat(ethers.formatUnits(p2, 18));
        } catch (e) {
            // ignore
        }
    } catch (e) {
        // ignore
    }
    return null;
}

// -------------------- ANALYTICS ENGINE (CORE LOGIC) --------------------

async function loadAnalytics() {
    if (!ACTIVE || !ACTIVE.factory) return;
    const tbody = getEl("analyticsTableBody");
    
    try {
        // Use readProvider (RPC public preferred) to avoid inpage provider RPC errors
        const readProvider = getReadProvider();
        if (!readProvider) {
            console.warn("No read provider available, aborting analytics load.");
            return;
        }

        // If ACTIVE.oracle defined use it, otherwise try reading master.oracle() using readProvider
        let oracle = null;
        let oracleAddr = ACTIVE.oracle || null;
        if (!oracleAddr && ACTIVE.master) {
            try {
                const masterRead = new ethers.Contract(ACTIVE.master, window.MASTER_ABI || [], readProvider);
                oracleAddr = await masterRead.oracle().catch(() => null);
            } catch (e) {
                oracleAddr = null;
            }
        }
        if (oracleAddr && oracleAddr !== "0x0000000000000000000000000000000000000000") {
            try {
                oracle = new ethers.Contract(oracleAddr, ORACLE_ABI, readProvider);
            } catch (e) {
                oracle = null;
            }
        }

        // factory using readProvider
        const factory = new ethers.Contract(ACTIVE.factory, ANALYTICS_FACTORY_ABI, readProvider);

        // 1. Obtener total de pares
        const lengthCount = await factory.allPairsLength();
        const length = Number(lengthCount || 0);

        const totalPairsEl = getEl("totalPairsCount");
        if (totalPairsEl) totalPairsEl.textContent = length;

        // 2. Scan de Direcciones (safe)
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
        let pairsData = [];

        // Process in batches to avoid RPC overload
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

                    // Try oracle prices safely
                    let price0 = null;
                    let price1 = null;
                    if (oracle) {
                        try { price0 = await safeGetOraclePrice(oracle, t0Addr, readProvider); } catch (e) { price0 = null; }
                        try { price1 = await safeGetOraclePrice(oracle, t1Addr, readProvider); } catch (e) { price1 = null; }
                    }

                    // TVL calculation with fallbacks
                    let pairTVL = 0;
                    if (price0 && price0 > 0) {
                        pairTVL = r0 * price0 * 2;
                    } else if (price1 && price1 > 0) {
                        pairTVL = r1 * price1 * 2;
                    } else {
                        const s0 = (sym0 || "").toString().toLowerCase();
                        const s1 = (sym1 || "").toString().toLowerCase();
                        const isStable0 = s0.includes('usd') || s0.includes('usdc') || s0.includes('usdt') || s0.includes('usds');
                        const isStable1 = s1.includes('usd') || s1.includes('usdc') || s1.includes('usdt') || s1.includes('usds');
                        if (isStable0) pairTVL = r0 * 2;
                        else if (isStable1) pairTVL = r1 * 2;
                        else pairTVL = 0;
                    }

                    return {
                        address: pairAddr,
                        tvl: pairTVL,
                        t0: { symbol: sym0 || 'UNK', addr: t0Addr, reserve: r0, price: price0 || 0 },
                        t1: { symbol: sym1 || 'UNK', addr: t1Addr, reserve: r1, price: price1 || 0 }
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

            // small throttle
            await new Promise(res => setTimeout(res, 120));
        }

        // Pasar a render
        finalizeAnalytics(pairsData, globalTVL, oracle);

    } catch (e) {
        console.error("Analytics Engine Crash:", e);
        if(tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--danger);">Error loading pairs.</td></tr>`;
    }
}
// -------------------- RENDER & UI FINALIZATION --------------------

function finalizeAnalytics(pairsData, globalTVL, oracle) {
    // 1. Ordenar por TVL descendente
    pairsData.sort((a, b) => b.tvl - a.tvl);

    // 2. Actualizar Métricas Superiores
    animateValue("globalTVL", globalTVL, true);
    
    const nativePriceDisp = getEl("nativePriceDisplay");
    if (nativePriceDisp) {
        nativePriceDisp.textContent = oracle ? "Active" : "On-Chain";
        nativePriceDisp.style.color = oracle ? "var(--success)" : "var(--warning)";
    }

    const oracleStatus = getEl("oracleStatus");
    if (oracleStatus) {
        oracleStatus.textContent = oracle ? "SoneVibe Oracle Linked" : "Using Pair Reserves";
        oracleStatus.style.color = "var(--success)";
    }

    // 3. Renderizar Tabla
    renderAnalyticsTable(pairsData, globalTVL);
}

function renderAnalyticsTable(data, total) {
    const tbody = getEl("analyticsTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted);">No liquidity pairs found on this network.</td></tr>`;
        return;
    }

    data.forEach(p => {
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
        
        // Lógica de iconos (mismo estilo que Swap)
        const icon0 = `icons/${p.t0.symbol.toLowerCase()}.svg`;
        const icon1 = `icons/${p.t1.symbol.toLowerCase()}.svg`;
        
        const percentageOfTotal = total > 0 ? (p.tvl / total) * 100 : 0;

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
                    <button class="btn-ghost btn-xs" onclick="window.open('${ACTIVE.blockExplorerUrls[0]}/address/${p.address}')">Scan</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// -------------------- FORMATTERS & ANIMATIONS --------------------

function formatNumber(n, decimals = 2) {
    if (n === 0) return "0.00";
    if (n < 0.01 && n > 0) return n.toFixed(6);
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

// Listener para cerrar modal al hacer click fuera (UX Pro)
window.addEventListener('click', (e) => {
    const modal = getEl('walletModal');
    if (e.target === modal) window.closeWalletModal && window.closeWalletModal();
});