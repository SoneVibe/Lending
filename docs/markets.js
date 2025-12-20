let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let selectedProvider = null; // Helper para modal

const getEl = (id) => document.getElementById(id);

// --- UI HELPERS PRO ---
const updateStatus = (connected) => {
  const dot = getEl('statusDot');
  const txt = getEl('connStatus');
  const btn = getEl('btnConnect');
  
  if(connected && userAddress) {
    dot.style.color = "var(--success)";
    txt.textContent = "Online";
    
    // Pro Button Style
    btn.textContent = userAddress.substring(0,6) + "..." + userAddress.substring(38);
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-connected');
    
    // Icono Dropdown
    const arrow = document.createElement("span");
    arrow.textContent = "▼";
    arrow.style.fontSize = "0.7em";
    arrow.style.marginLeft = "6px";
    if (btn.lastChild && btn.lastChild.tagName === 'SPAN') btn.removeChild(btn.lastChild);
    btn.appendChild(arrow);
    
    // Dropdown Data
    getEl('dropdownAddress').textContent = userAddress.substring(0,8) + "..." + userAddress.substring(38);

  } else {
    dot.style.color = "var(--warning)";
    txt.textContent = "Syncing...";
    
    btn.textContent = "Connect Wallet";
    btn.className = "btn-primary";
    btn.style.background = "";
  }
};

// --- INIT APP (OFFLINE + AUTO-CONNECT) ---
document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
    try {
        NETWORKS_DATA = await window.loadNetworks();
        initNetworkSelector();

        // Carga Read-Only inicial (sin wallet)
        await tryLoadReadOnlyData();

        // Auto-Connect Pro
        if(window.checkAutoConnect) {
            await window.checkAutoConnect(connectWallet);
        }
    } catch(e) { console.log("Init failed", e); }
}

async function tryLoadReadOnlyData() {
    // Si hay un provider inyectado (aunque no conectado), intenta leer la cadena actual
    if(window.ethereum) {
        try {
            const tempProvider = new ethers.BrowserProvider(window.ethereum);
            const chainIdHex = await tempProvider.send("eth_chainId", []);
            const chainIdDecimal = parseInt(chainIdHex, 16);
            ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === chainIdDecimal) && n.enabled);
            
            if(ACTIVE) {
                // Configurar provider solo para lectura por ahora
                provider = tempProvider;
                const sel = getEl("networkSelect");
                if(sel) sel.value = ACTIVE.chainId;
                await loadMarketData();
            }
        } catch(e) {}
    }
}

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
        if(userAddress) {
             await switchNetwork(targetChainId);
        } else {
             ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);
             // Si cambiamos red en modo lectura, recargamos datos si es posible (future upgrade)
             console.log("Read-mode network changed:", ACTIVE.label);
        }
    };
}

// --- WALLET MODAL LOGIC ---
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

// --- CONNECT & DISCONNECT UI HANDLERS ---
const btnConnect = getEl("btnConnect");
const accountDropdown = getEl("accountDropdown");

btnConnect.onclick = (e) => {
    e.stopPropagation();
    if(userAddress) {
        if (accountDropdown) accountDropdown.classList.toggle("show");
    } else {
        openWalletModal();
    }
};

getEl("btnCopyAddress").onclick = () => { navigator.clipboard.writeText(userAddress); alert("Copied!"); };
getEl("btnViewExplorer").onclick = () => { if(ACTIVE) window.open(ACTIVE.blockExplorerUrls[0] + "/address/" + userAddress, '_blank'); };

getEl("btnDisconnect").onclick = () => {
    if(window.SessionManager) window.SessionManager.clear();
    userAddress = null;
    signer = null;
    selectedProvider = null;
    updateStatus(false);
    accountDropdown.classList.remove("show");
    // Opcional: Recargar para limpiar estado
    // window.location.reload(); 
};

// --- CORE CONNECTION LOGIC ---
async function connectWallet() {
    const ethProvider = selectedProvider || window.ethereum;
    if (!ethProvider) { alert("Please install MetaMask."); return; }
    
    getEl("btnConnect").textContent = "Connecting...";

    try {
        provider = new ethers.BrowserProvider(ethProvider);
        if(!NETWORKS_DATA) NETWORKS_DATA = await window.loadNetworks();
        
        await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        
        // Guardar Sesión Pro
        if(window.SessionManager) window.SessionManager.save();
        
        const chainIdHex = await provider.send("eth_chainId", []);
        const chainIdDecimal = parseInt(chainIdHex, 16);
        
        ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === chainIdDecimal) && n.enabled);
        
        const sel = getEl("networkSelect");
        
        // Auto-Switch Logic
        if(!ACTIVE) {
            console.log("Unsupported chain. Switching...");
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
        await loadMarketData();
        
        if(ethProvider.on) {
            ethProvider.on('chainChanged', () => window.location.reload());
            ethProvider.on('accountsChanged', () => window.location.reload());
        }
        
    } catch(e) { 
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
            } catch (e) {}
        }
    }
}

// ------------------------------------------------------------------
// GLOBAL MARKET DATA LOGIC (FIXED ABI FOR COLLATERAL FACTOR)
// ------------------------------------------------------------------
async function loadMarketData() {
    if(!ACTIVE) return;
    
    const ICON_MAP = { ASTR:"icons/astr.svg", WBTC:"icons/bitcoin.svg", DOT:"icons/dot.svg", WETH:"icons/weth.svg", USDC:"icons/usdc.svg" };
    const tbody = getEl("marketsBody");
    tbody.innerHTML = "";
    
    const blocksPerYear = ACTIVE.blocksPerYear || 15768000;
    
    // [MODIFICADO] ABI Extra para asegurar que leemos los mappings del Comptroller Enhanced
    // Esto soluciona el error "master.marketCollateralFactorMantissa is not a function"
    const COMP_EXTRA_ABI = [
        "function marketCollateralFactorMantissa(address) view returns (uint)",
        "function marketLiquidationThresholdMantissa(address) view returns (uint)",
        "function oracle() view returns (address)"
    ];

    // [MODIFICADO] Combinamos ABI global con el extra
    const FULL_ABI = window.MASTER_ABI ? [...window.MASTER_ABI, ...COMP_EXTRA_ABI] : COMP_EXTRA_ABI;
    const master = new ethers.Contract(ACTIVE.master, FULL_ABI, provider);
    
    let oracle = null;
    try {
        const oracleAddr = await master.oracle();
        oracle = new ethers.Contract(oracleAddr, window.ORACLE_ABI, provider);
    } catch(e) { console.error("Oracle Error", e); }

    let globalSupplyUSD = 0;
    let globalBorrowUSD = 0;
    let globalReservesUSD = 0;

    for(const m of ACTIVE.cTokens) {
        try {
            const c = new ethers.Contract(m.address, window.C_TOKEN_ABI, provider);
            const underlyingDecimals = m.underlyingDecimals || 18;

            const [totalSupplyRaw, totalBorrowsRaw, totalReservesRaw, exchRateRaw, rates, priceRaw] = await Promise.all([
                c.totalSupply(), c.totalBorrows(), c.totalReserves(), c.exchangeRateStored(), c.peekRates(),
                oracle ? oracle.getUnderlyingPrice(m.address) : 0n
            ]);

            // [MODIFICADO] Fetch Risk Params (CF & LiT)
            let cfRaw = 0n;
            let ltRaw = 0n;
            try {
                [cfRaw, ltRaw] = await Promise.all([
                    master.marketCollateralFactorMantissa(m.address),
                    master.marketLiquidationThresholdMantissa(m.address)
                ]);
            } catch(e) {
                console.warn(`Risk params fetch failed for ${m.symbol}`, e);
            }

            const priceUSD = oracle && priceRaw > 0n ? parseFloat(ethers.formatUnits(priceRaw, 18)) : 0;
            const totalSupplyUnderlying = (Number(totalSupplyRaw) * Number(exchRateRaw)) / 1e36;
            const totalSupplyUSD = totalSupplyUnderlying * priceUSD;
            const totalBorrowsUnderlying = Number(totalBorrowsRaw) / Math.pow(10, underlyingDecimals);
            const totalBorrowsUSD = totalBorrowsUnderlying * priceUSD;
            const totalReservesUnderlying = Number(totalReservesRaw) / Math.pow(10, underlyingDecimals);
            const totalReservesUSD = totalReservesUnderlying * priceUSD;

            const supplyAPY = rates && rates[1] ? ratePerBlockToAPY(rates[1], blocksPerYear) : 0;
            const borrowAPY = rates && rates[0] ? ratePerBlockToAPY(rates[0], blocksPerYear) : 0;
            const utilRate = totalSupplyUnderlying > 0 ? (totalBorrowsUnderlying / totalSupplyUnderlying) * 100 : 0;

            // [MODIFICADO] Calcular porcentajes para UI
            const cfPercent = Number(cfRaw) / 1e16; 
            const ltPercent = Number(ltRaw) / 1e16;

            globalSupplyUSD += totalSupplyUSD;
            globalBorrowUSD += totalBorrowsUSD;
            globalReservesUSD += totalReservesUSD;

            const uSym = m.underlyingSymbol || m.symbol.replace(/^c/,"");
            const icon = m.icon || ICON_MAP[uSym] || "icons/unknown.svg";
            const displayDec = (uSym === 'WBTC' || uSym === 'BTC') ? 6 : 2;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>
                    <div class="asset-flex"><img src="${icon}" class="asset-icon"><div><div>${uSym}</div><div style="font-size:0.7em; color:var(--text-muted);">${m.symbol}</div></div></div>
                </td>
                <td><div>$${formatCompact(totalSupplyUSD)}</div><div style="font-size:0.75em; color:var(--text-muted);">${formatNumber(totalSupplyUnderlying, displayDec)} ${uSym}</div></td>
                <td><div>$${formatCompact(totalBorrowsUSD)}</div><div style="font-size:0.75em; color:var(--text-muted);">${formatNumber(totalBorrowsUnderlying, displayDec)} ${uSym}</div></td>
                <td><div style="color:var(--warning)">$${formatCompact(totalReservesUSD)}</div><div style="font-size:0.75em; color:var(--text-muted);">${formatNumber(totalReservesUnderlying, displayDec)} ${uSym}</div></td>
                <td><span class="text-green">${supplyAPY.toFixed(2)}%</span></td>
                <td><span class="text-yellow">${borrowAPY.toFixed(2)}%</span></td>
                <!-- [MODIFICADO] COLUMNAS NUEVAS -->
                <td><span style="color:#a5b4fc; font-weight:600;">${cfPercent.toFixed(0)}%</span></td>
                <td><span style="color:#f87171; font-weight:600;">${ltPercent.toFixed(0)}%</span></td>
                <!-- FIN NUEVAS -->
                <td style="min-width:120px;"><div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:2px;"><span>${utilRate.toFixed(1)}%</span></div><div class="util-bar-bg"><div class="util-bar-fill" style="width:${Math.min(100, utilRate)}%"></div></div></td>
            `;
            tbody.appendChild(tr);
        } catch(e) { console.error("Row Error", e); }
    }

    const totalTVL = globalSupplyUSD - globalBorrowUSD;
    animateValue("totalMarketSize", globalSupplyUSD);
    animateValue("totalBorrows", globalBorrowUSD);
    animateValue("totalTVL", totalTVL);
    animateValue("totalReserves", globalReservesUSD);
}

function formatNumber(n, dp=2) { return Number(n).toLocaleString('en-US', {minimumFractionDigits:dp, maximumFractionDigits:dp}); }
function formatCompact(n) { return Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 2 }).format(n); }
function ratePerBlockToAPY(rate, blocks) { const r = Number(rate)/1e18; return r <= 0 ? 0 : ((Math.pow(1+r, blocks)-1)*100); }
function animateValue(id, endValue) {
    const el = getEl(id);
    const duration = 1000;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const current = progress * endValue;
        el.textContent = "$" + current.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
        if (progress < 1) { window.requestAnimationFrame(step); }
    };
    window.requestAnimationFrame(step);
}