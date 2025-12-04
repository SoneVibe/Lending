let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;

const getEl = (id) => document.getElementById(id);
const updateStatus = (connected) => {
  const dot = getEl('statusDot');
  const txt = getEl('connStatus');
  const btn = getEl('btnConnect');
  
  if(connected) {
    dot.style.color = "var(--success)";
    txt.textContent = "Online";
    btn.textContent = userAddress.substring(0,6) + "..." + userAddress.substring(38);
    btn.style.background = "rgba(255,255,255,0.1)";
  } else {
    dot.style.color = "var(--warning)";
    txt.textContent = "Syncing...";
    btn.textContent = "Connect Wallet";
    btn.style.background = "var(--accent)";
  }
};

// Carga inicial de solo lectura (para mostrar datos sin conectar wallet)
document.addEventListener("DOMContentLoaded", async () => {
    if (window.ethereum) {
        provider = new ethers.BrowserProvider(window.ethereum);
        NETWORKS_DATA = await window.loadNetworks();
        
        // Intenta leer la red actual
        try {
            const chainIdHex = await provider.send("eth_chainId", []);
            const chainIdDecimal = parseInt(chainIdHex, 16);
            ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === chainIdDecimal) && n.enabled);
            
            if(ACTIVE) {
                // Si estamos en la red correcta, chequear cuentas
                const accounts = await provider.send("eth_accounts", []);
                if (accounts.length > 0) {
                    signer = await provider.getSigner();
                    userAddress = accounts[0];
                    updateStatus(true);
                } else {
                    updateStatus(false);
                }
                await loadMarketData();
            }
        } catch(e) { console.log("Initial load check failed", e); }
    }
});

// Connect Wallet (ACTUALIZADA)
getEl("btnConnect").onclick = async () => {
    if (!window.ethereum) { alert("Please install MetaMask."); return; }
    
    try {
        provider = new ethers.BrowserProvider(window.ethereum);
        NETWORKS_DATA = await window.loadNetworks();
        await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        
        // 1. Detección Robusta
        const chainIdHex = await provider.send("eth_chainId", []);
        const chainIdDecimal = parseInt(chainIdHex, 16);
        
        ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === chainIdDecimal) && n.enabled);
        
        // 2. Auto-Switch
        if(!ACTIVE) {
            const targetNetwork = Object.values(NETWORKS_DATA).find(n => n.chainId == "1868" && n.enabled);
            if (targetNetwork) {
                try {
                    await window.ethereum.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: "0x" + Number(targetNetwork.chainId).toString(16) }],
                    });
                    window.location.reload();
                    return;
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
                            window.location.reload();
                            return;
                        } catch (e) {}
                    }
                }
            }
            alert(`Wrong Network (${chainIdDecimal}). Please switch to Soneium Mainnet.`);
            updateStatus(false);
            return;
        }
        
        updateStatus(true);
        await loadMarketData();
        
    } catch(e) { console.error(e); }
};

// ------------------------------------------------------------------
// GLOBAL MARKET DATA LOGIC (CORREGIDO)
// ------------------------------------------------------------------
async function loadMarketData() {
    if(!ACTIVE) return;
    
    const ICON_MAP = { ASTR:"icons/astr.svg", WBTC:"icons/bitcoin.svg", DOT:"icons/dot.svg", WETH:"icons/weth.svg", USDC:"icons/usdc.svg" };
    const tbody = getEl("marketsBody");
    tbody.innerHTML = "";
    
    const blocksPerYear = ACTIVE.blocksPerYear || 15768000;
    const master = new ethers.Contract(ACTIVE.master, window.MASTER_ABI, provider);
    
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
            const cTokenDecimals = 18; // Tus cTokens siempre son 18 decimales
            const underlyingDecimals = m.underlyingDecimals || 18;

            // Fetch Data
            const [
                totalSupplyRaw, 
                totalBorrowsRaw, 
                totalReservesRaw,
                exchRateRaw, 
                rates, 
                priceRaw
            ] = await Promise.all([
                c.totalSupply(),
                c.totalBorrows(),
                c.totalReserves(),
                c.exchangeRateStored(),
                c.peekRates(),
                oracle ? oracle.getUnderlyingPrice(m.address) : 0n
            ]);

            // --- 1. PRICE (Normalizado a 18 por tu oráculo) ---
            const priceUSD = oracle && priceRaw > 0n ? parseFloat(ethers.formatUnits(priceRaw, 18)) : 0;

            // --- 2. SUPPLY (CORREGIDO) ---
            const totalSupplyUnderlying = (Number(totalSupplyRaw) * Number(exchRateRaw)) / 1e36;
            const totalSupplyUSD = totalSupplyUnderlying * priceUSD;

            // --- 3. BORROWS ---
            const totalBorrowsUnderlying = Number(totalBorrowsRaw) / Math.pow(10, underlyingDecimals);
            const totalBorrowsUSD = totalBorrowsUnderlying * priceUSD;

            // --- 4. RESERVES ---
            const totalReservesUnderlying = Number(totalReservesRaw) / Math.pow(10, underlyingDecimals);
            const totalReservesUSD = totalReservesUnderlying * priceUSD;

            // APYs & Util
            const supplyAPY = rates && rates[1] ? ratePerBlockToAPY(rates[1], blocksPerYear) : 0;
            const borrowAPY = rates && rates[0] ? ratePerBlockToAPY(rates[0], blocksPerYear) : 0;
            const utilRate = totalSupplyUnderlying > 0 ? (totalBorrowsUnderlying / totalSupplyUnderlying) * 100 : 0;

            // Aggregate
            globalSupplyUSD += totalSupplyUSD;
            globalBorrowUSD += totalBorrowsUSD;
            globalReservesUSD += totalReservesUSD;

            // Render
            const uSym = m.underlyingSymbol || m.symbol.replace(/^c/,"");
            const icon = m.icon || ICON_MAP[uSym] || "icons/unknown.svg";
            
            // Mostrar más decimales para BTC
            const displayDec = (uSym === 'WBTC' || uSym === 'BTC') ? 6 : 2;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>
                    <div class="asset-flex">
                        <img src="${icon}" class="asset-icon">
                        <div>
                            <div>${uSym}</div>
                            <div style="font-size:0.7em; color:var(--text-muted);">${m.symbol}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <div>$${formatCompact(totalSupplyUSD)}</div>
                    <div style="font-size:0.75em; color:var(--text-muted);">${formatNumber(totalSupplyUnderlying, displayDec)} ${uSym}</div>
                </td>
                <td>
                    <div>$${formatCompact(totalBorrowsUSD)}</div>
                    <div style="font-size:0.75em; color:var(--text-muted);">${formatNumber(totalBorrowsUnderlying, displayDec)} ${uSym}</div>
                </td>
                <td>
                    <div style="color:var(--warning)">$${formatCompact(totalReservesUSD)}</div>
                    <div style="font-size:0.75em; color:var(--text-muted);">${formatNumber(totalReservesUnderlying, displayDec)} ${uSym}</div>
                </td>
                <td><span class="text-green">${supplyAPY.toFixed(2)}%</span></td>
                <td><span class="text-yellow">${borrowAPY.toFixed(2)}%</span></td>
                <td style="min-width:120px;">
                    <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:2px;">
                        <span>${utilRate.toFixed(1)}%</span>
                    </div>
                    <div class="util-bar-bg">
                        <div class="util-bar-fill" style="width:${Math.min(100, utilRate)}%"></div>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);

        } catch(e) { console.error("Row Error", e); }
    }

    // Header Stats
    const totalTVL = globalSupplyUSD - globalBorrowUSD;

    animateValue("totalMarketSize", globalSupplyUSD);
    animateValue("totalBorrows", globalBorrowUSD);
    animateValue("totalTVL", totalTVL);
    animateValue("totalReserves", globalReservesUSD);
}

// --- Helpers ---
function formatNumber(n, dp=2) { return Number(n).toLocaleString('en-US', {minimumFractionDigits:dp, maximumFractionDigits:dp}); }

function formatCompact(n) {
    return Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

function ratePerBlockToAPY(rate, blocks) { 
    const r = Number(rate)/1e18; 
    return r <= 0 ? 0 : ((Math.pow(1+r, blocks)-1)*100); 
}

function animateValue(id, endValue) {
    const el = getEl(id);
    const duration = 1000;
    const start = 0;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const current = progress * endValue;
        el.textContent = "$" + current.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}
