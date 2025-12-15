// VIBESWAP LOGIC - PRO TIER (DYNAMIC + SLIPPAGE + LIQUIDATOR STYLE CONNECT)
let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let selectedProvider = null;

// STATE
let isEthToToken = true;   
let currentSlippage = 0.5; 
let pairData = { base: null, quote: null };

const getEl = (id) => document.getElementById(id);

// --- UI HELPERS (LIQUIDATOR STYLE STRICT) ---
const updateStatus = (connected) => {
  const dot = getEl('statusDot');
  const txt = getEl('connStatus');
  const btn = getEl('btnConnect'); // Header btn
  const btnAction = getEl('btnSwapAction'); // Swap action btn
  
  if(connected && userAddress) {
    // Header Status
    dot.style.color = "var(--success)";
    txt.textContent = "Online";
    
    // Header Button
    btn.textContent = userAddress.substring(0,6) + "..." + userAddress.substring(38);
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-connected');
    
    // Add Arrow
    const arrow = document.createElement("span");
    arrow.textContent = "▼";
    arrow.style.fontSize = "0.7em";
    arrow.style.marginLeft = "6px";
    if (btn.lastChild && btn.lastChild.tagName === 'SPAN') btn.removeChild(btn.lastChild);
    btn.appendChild(arrow);
    
    getEl('dropdownAddress').textContent = userAddress.substring(0,8) + "..." + userAddress.substring(38);

    // Swap Action Button
    if(btnAction) {
        btnAction.textContent = "Swap";
        btnAction.disabled = false;
    }
  } else {
    // Header Status
    dot.style.color = "var(--danger)";
    txt.textContent = "Disconnected";
    
    // Header Button
    btn.textContent = "Connect Wallet";
    btn.className = "btn-primary";
    btn.style.background = ""; // Reset connected style
    if (btn.lastChild && btn.lastChild.tagName === 'SPAN') btn.removeChild(btn.lastChild);

    // Swap Action Button
    if(btnAction) {
        btnAction.textContent = "Connect Wallet";
    }
  }
};

// --- INIT APP ---
document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
    try {
        // USAMOS SWAP CONFIG (CRÍTICO)
        NETWORKS_DATA = await window.loadSwapConfig();
        initNetworkSelector();
        // NOTA: Quitamos initChart() de aquí arriba para evitar errores de timing
        
        // Auto-select Default (Soneium)
        ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == "1868" && n.enabled);
        
        // Initial Asset Setup
        if(ACTIVE) {
            setupAssets(ACTIVE);
            updateBalances(); // Asumo que ya tienes esto
            
            // PARCHE: Inicializamos la gráfica AQUÍ, cuando ACTIVE ya existe
            await initHybridChart(); 
            loadChartData(); 
        }

        if(window.checkAutoConnect) {
            await window.checkAutoConnect(connectWallet);
        }
    } catch(e) { console.error("Init Error:", e); }
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
        else {
            ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);
            setupAssets(ACTIVE);
            updateBalances();
            // PARCHE: Recargar gráfica al cambiar red
            loadChartData();
        }
    };
}

// --- WALLET CONNECT (LIQUIDATOR LOGIC) ---
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
};

window.closeWalletModal = () => getEl('walletModal').classList.remove('open');
window.onclick = (e) => {
    const modal = getEl('walletModal');
    const tokenModal = getEl('tokenModal');
    if (e.target === modal) closeWalletModal();
    if (e.target === tokenModal) closeTokenModal(); // Manejar ambos modales
    
    const accountDropdown = getEl("accountDropdown");
    if (accountDropdown && accountDropdown.classList.contains('show') && !e.target.closest('#btnConnect')) {
         accountDropdown.classList.remove('show');
    }
};

const btnConnect = getEl("btnConnect");
const accountDropdown = getEl("accountDropdown");

if(btnConnect) {
    btnConnect.onclick = (e) => {
        e.stopPropagation();
        if(userAddress) { 
            if (accountDropdown) accountDropdown.classList.toggle("show"); 
        } else { 
            openWalletModal(); 
        }
    };
}

if(getEl("btnCopyAddress")) getEl("btnCopyAddress").onclick = () => { navigator.clipboard.writeText(userAddress); alert("Copied!"); };
if(getEl("btnDisconnect")) getEl("btnDisconnect").onclick = () => {
    if(window.SessionManager) window.SessionManager.clear();
    userAddress = null; signer = null; selectedProvider = null;
    updateStatus(false);
    accountDropdown.classList.remove("show");
    window.location.reload();
};

async function connectWallet() {
    const ethProvider = selectedProvider || window.ethereum;
    if (!ethProvider) { alert("Please install a compatible Wallet."); return; }
    
    getEl("btnConnect").textContent = "Connecting...";

    try {
        provider = new ethers.BrowserProvider(ethProvider);
        if(!NETWORKS_DATA) NETWORKS_DATA = await window.loadSwapConfig();
        
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
            if(targetId) { 
                await switchNetwork(targetId); 
                return; 
            } else { 
                alert("Unsupported Network."); 
                updateStatus(false); 
                return; 
            }
        }
        
        if(sel && ACTIVE) sel.value = ACTIVE.chainId;
        setupAssets(ACTIVE);
        
        // USA EL UI HELPER DEL LIQUIDATOR
        updateStatus(true);
        updateBalances();
        loadChartData(); // <--- PARCHE: REFRESCAR CHART AL CONECTAR

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
        window.location.reload();
    } catch (switchError) {
        console.error(switchError);
    }
}
// --- SWAP UI LOGIC ---

window.setTab = (tab) => {
    const swapPanel = getEl('swapPanel');
    const zapPanel = getEl('zapPanel');
    const tabs = document.querySelectorAll('.swap-tab');
    tabs.forEach(t => t.classList.remove('active'));
    
    if(tab === 'swap') {
        tabs[0].classList.add('active');
        if(swapPanel) swapPanel.style.display = 'block';
        if(zapPanel) zapPanel.style.display = 'none';
    } else {
        tabs[1].classList.add('active');
        if(swapPanel) swapPanel.style.display = 'none';
        if(zapPanel) zapPanel.style.display = 'block';
    }
};

window.setSlippage = (val) => {
    currentSlippage = val;
    const disp = getEl('slippageDisplay');
    const small = getEl('slippageSmall');
    if(disp) disp.textContent = val + "%";
    if(small) small.textContent = val + "% Slippage";

    const buttons = document.querySelectorAll('.btn-ghost');
    buttons.forEach(b => {
        if(b.textContent.includes(val.toString())) {
            b.style.border = val >= 5 ? '1px solid var(--warning)' : '1px solid var(--success)';
        } else {
            b.style.border = '1px solid transparent';
        }
    });
    if(getEl('amountIn').value) getEl('amountIn').dispatchEvent(new Event('input'));
};

function formatSmartRate(rate) {
    if (!rate || isNaN(rate) || rate === 0) return "--";
    if (rate < 0.0001) return rate.toFixed(8).replace(/\.?0+$/, ""); 
    if (rate > 1000) return rate.toFixed(2);
    return rate.toFixed(4);
}

// Configura los iconos y símbolos iniciales
function setupAssets(network) {
    if(!network.swapTokens) return;
    
    pairData.base = network.swapTokens.base;   
    pairData.quote = network.swapTokens.quote; 
    
    // Asegurar flags de isNative si no existen
    if(pairData.base.isNative === undefined) pairData.base.isNative = true;
    
    updateSwapUI();
}

function updateSwapUI() {
    if (!pairData || !pairData.base || !pairData.quote) return;

    const base = pairData.base;
    const quote = pairData.quote;
    const inToken = isEthToToken ? base : quote;
    const outToken = isEthToToken ? quote : base;
    
    getEl('symIn').textContent = inToken.symbol;
    getEl('symOut').textContent = outToken.symbol;
    
    // Fix imágenes con fallback
    const imgIn = getEl('imgIn');
    const imgOut = getEl('imgOut');
    if(imgIn) {
        imgIn.src = inToken.icon || 'icons/token.svg';
        imgIn.onerror = () => { imgIn.src = 'icons/token.svg'; };
    }
    if(imgOut) {
        imgOut.src = outToken.icon || 'icons/token.svg';
        imgOut.onerror = () => { imgOut.src = 'icons/token.svg'; };
    }
    
    const chartTitle = getEl('chartPairName');
    if(chartTitle) chartTitle.textContent = `${quote.symbol} / ${base.symbol}`;
}

// --- CORE FIX: BALANCES CORRECTOS ---
async function updateBalances() {
    if(!signer || !ACTIVE || !pairData.base || !pairData.quote) return;
    try {
        const base = pairData.base;
        const quote = pairData.quote;
        
        // Identificar cual es cual basado en la dirección del swap
        const tokenInObj = isEthToToken ? base : quote;
        const tokenOutObj = isEthToToken ? quote : base;

        // Función auxiliar para leer saldo de un token arbitrario
        const getBalanceForToken = async (tokenObj) => {
            if(tokenObj.isNative || tokenObj.address === 'NATIVE') {
                const b = await provider.getBalance(userAddress);
                return parseFloat(ethers.formatEther(b)).toFixed(4);
            } else {
                const c = new ethers.Contract(tokenObj.address, window.MIN_ERC20_ABI, provider);
                const b = await c.balanceOf(userAddress);
                return parseFloat(ethers.formatUnits(b, tokenObj.decimals)).toFixed(2); // Usa decimales correctos
            }
        };

        const balIn = await getBalanceForToken(tokenInObj);
        const balOut = await getBalanceForToken(tokenOutObj);
        
        // Zap Balance siempre es nativo (ETH)
        const ethBalRaw = await provider.getBalance(userAddress);
        const ethBalFmt = parseFloat(ethers.formatEther(ethBalRaw)).toFixed(4);

        getEl('balIn').textContent = balIn;
        getEl('balOut').textContent = balOut;
        getEl('zapBal').textContent = ethBalFmt;

    } catch(e) { console.error("Balance Error", e); }
}

// --- SWAP EXECUTION ---
const amountIn = getEl('amountIn');
const amountOut = getEl('amountOut');
const btnSwap = getEl('btnSwapAction');

// INPUT LISTENER (QUOTE + PRICE IMPACT)
if(amountIn) {
    amountIn.addEventListener('input', async () => {
        const val = amountIn.value;
        const details = getEl('swapDetails');
        
        if(!val || parseFloat(val) === 0 || !ACTIVE?.router) {
            amountOut.value = "";
            if(details) details.style.display = 'none';
            const impactEl = getEl('impactDisplay');
            if(impactEl) { impactEl.textContent = "--"; impactEl.style.color = "var(--success)"; }
            return;
        }

        if(btnSwap) { btnSwap.disabled = true; btnSwap.textContent = "Fetching Price..."; }

        try {
            const router = new ethers.Contract(ACTIVE.router, window.ROUTER_ABI, provider);
            
            if (!pairData.base || !pairData.quote) throw new Error("Pair data incomplete");

            // Configurar direcciones para el Router
            // Si el token es Nativo, el router usa WETH en el path para cotizar, 
            // pero las funciones swapExactETH... manejan el wrap internamente.
            
            // Determinar WETH Address de la red
            const WETH_ADDR = ACTIVE.swapTokens.base.underlyingAddress; // Dirección del contrato WETH

            const tokenInObj = isEthToToken ? pairData.base : pairData.quote;
            const tokenOutObj = isEthToToken ? pairData.quote : pairData.base;

            const addrIn = (tokenInObj.isNative || tokenInObj.address === 'NATIVE') ? WETH_ADDR : tokenInObj.address;
            const addrOut = (tokenOutObj.isNative || tokenOutObj.address === 'NATIVE') ? WETH_ADDR : tokenOutObj.address;
            
            const path = [addrIn, addrOut];
            
            // Decimales Correctos
            const decimalsIn = tokenInObj.decimals;
            const decimalsOut = tokenOutObj.decimals;
            
            // 1. Obtener Quote (Router)
            const amountWei = ethers.parseUnits(val, decimalsIn);
            const amounts = await router.getAmountsOut(amountWei, path);
            const outFmt = ethers.formatUnits(amounts[1], decimalsOut);
            
            // Actualizar UI Input B
            amountOut.value = parseFloat(outFmt).toFixed(6);
            if(details) details.style.display = 'block';
            
            // 2. CÁLCULO DE PRICE IMPACT
            const impactData = await calculatePriceImpact(amountWei, path, decimalsIn);
            updateImpactUI(impactData);

            // 3. Rate y Min Received
            const rate = parseFloat(outFmt) / parseFloat(val);
            getEl('priceDisplay').textContent = `1 ${tokenInObj.symbol} ≈ ${formatSmartRate(rate)} ${tokenOutObj.symbol}`;
            
            const slippageMulti = 1 - (currentSlippage / 100);
            const minOut = parseFloat(outFmt) * slippageMulti;
            getEl('minReceivedDisplay').textContent = `${minOut.toFixed(4)} ${tokenOutObj.symbol}`;

            if(btnSwap) { btnSwap.textContent = "Swap"; btnSwap.disabled = false; }

        } catch(e) {
            console.log("Quote Error:", e);
            amountOut.value = "0.0";
            if(btnSwap) { btnSwap.textContent = "Insufficient Liquidity / Config"; btnSwap.disabled = true; }
            const impactEl = getEl('impactDisplay');
            if(impactEl) impactEl.textContent = "--";
        }
    });
}

if(getEl('btnSwitch')) {
    getEl('btnSwitch').onclick = () => {
        isEthToToken = !isEthToToken;
        updateSwapUI();
        updateBalances();
        
        // PARCHE: RECARGAR GRÁFICA AL INVERTIR (SWITCH)
        loadChartData(); 
        
        amountIn.value = ""; amountOut.value = "";
        getEl('swapDetails').style.display = 'none';
    };
}

if(btnSwap) {
    btnSwap.onclick = async () => {
        if(!signer) { openWalletModal(); return; }
        const val = amountIn.value;
        if(!val) return;

        const statusDiv = getEl('swapStatus');
        
        try {
            const router = new ethers.Contract(ACTIVE.router, window.ROUTER_ABI, signer);
            
            const tokenInObj = isEthToToken ? pairData.base : pairData.quote;
            const tokenOutObj = isEthToToken ? pairData.quote : pairData.base;
            
            const WETH_ADDR = ACTIVE.swapTokens.base.underlyingAddress;
            const addrIn = (tokenInObj.isNative || tokenInObj.address === 'NATIVE') ? WETH_ADDR : tokenInObj.address;
            const addrOut = (tokenOutObj.isNative || tokenOutObj.address === 'NATIVE') ? WETH_ADDR : tokenOutObj.address;
            
            const path = [addrIn, addrOut];
            
            const amountInWei = ethers.parseUnits(val, tokenInObj.decimals);
            
            const amounts = await router.getAmountsOut(amountInWei, path);
            const amountOutExpected = amounts[1];
            
            const slippageBps = BigInt(Math.floor(currentSlippage * 100));
            const BPS_MAX = 10000n;
            const amountOutMin = (amountOutExpected * (BPS_MAX - slippageBps)) / BPS_MAX;
            const deadline = Math.floor(Date.now() / 1000) + 1200;

            statusDiv.innerText = `Swapping...`;
            statusDiv.style.color = "var(--warning)";

            let tx;
            
            // Lógica de Swap basada en si es nativo o token
            if(tokenInObj.isNative || tokenInObj.address === 'NATIVE') {
                // ETH -> Token
                tx = await router.swapExactETHForTokens(
                    amountOutMin, path, userAddress, deadline, { value: amountInWei }
                );
            } else if (tokenOutObj.isNative || tokenOutObj.address === 'NATIVE') {
                // Token -> ETH
                const tokenContract = new ethers.Contract(tokenInObj.address, window.MIN_ERC20_ABI, signer);
                const allow = await tokenContract.allowance(userAddress, ACTIVE.router);
                if(allow < amountInWei) {
                    statusDiv.innerText = "Approving Token...";
                    const txApp = await tokenContract.approve(ACTIVE.router, ethers.MaxUint256);
                    await txApp.wait();
                }
                statusDiv.innerText = "Confirm Swap...";
                tx = await router.swapExactTokensForETH(
                    amountInWei, amountOutMin, path, userAddress, deadline
                );
            } else {
                // Token -> Token (No implementado en UI básica, pero preparado)
                const tokenContract = new ethers.Contract(tokenInObj.address, window.MIN_ERC20_ABI, signer);
                const allow = await tokenContract.allowance(userAddress, ACTIVE.router);
                if(allow < amountInWei) {
                    statusDiv.innerText = "Approving Token...";
                    const txApp = await tokenContract.approve(ACTIVE.router, ethers.MaxUint256);
                    await txApp.wait();
                }
                statusDiv.innerText = "Confirm Swap...";
                tx = await router.swapExactTokensForTokens(
                    amountInWei, amountOutMin, path, userAddress, deadline
                );
            }

            statusDiv.innerText = "Tx Sent...";
            await tx.wait();
            statusDiv.innerText = "Swap Successful! 🚀";
            statusDiv.style.color = "var(--success)";
            updateBalances();
            amountIn.value = ""; amountOut.value = "";
            
        } catch(e) {
            console.error(e);
            let msg = "Swap Failed";
            if(e.reason && e.reason.includes("INSUFFICIENT_OUTPUT_AMOUNT")) msg = "Slippage Error";
            statusDiv.innerText = msg;
            statusDiv.style.color = "var(--danger)";
        }
    };
}

// --- TOKEN SELECTOR (FIXED & ROBUST) ---
const modalToken = getEl('tokenModal');
const tokenListContainer = getEl('tokenListContainer');
const searchInput = getEl('tokenSearch');
let selectingSide = null;

window.openTokenModal = (side) => {
    selectingSide = side;
    renderTokenList();
    if(modalToken) modalToken.classList.add('open');
    if(searchInput) { searchInput.value = ""; searchInput.focus(); }
};

window.closeTokenModal = () => {
    if(modalToken) modalToken.classList.remove('open');
    selectingSide = null;
};

const btnIn = getEl('tokenInBtn');
const btnOut = getEl('tokenOutBtn');
if(btnIn) btnIn.onclick = () => openTokenModal(isEthToToken ? 'base' : 'quote');
if(btnOut) btnOut.onclick = () => openTokenModal(isEthToToken ? 'quote' : 'base');

if(searchInput) searchInput.oninput = (e) => renderTokenList(e.target.value);

function renderTokenList(filter = "") {
    if(!tokenListContainer || !ACTIVE) return;
    tokenListContainer.innerHTML = "";
    
    const uniqueTokens = new Map();

    // 1. NATIVE
    if(ACTIVE.nativeCurrency) {
        uniqueTokens.set("NATIVE", {
            symbol: ACTIVE.nativeCurrency.symbol,
            name: ACTIVE.nativeCurrency.name,
            address: "NATIVE",
            decimals: ACTIVE.nativeCurrency.decimals,
            icon: ACTIVE.swapTokens?.base?.icon || "icons/token.svg",
            isNative: true
        });
    }

    // 2. TOKEN LIST
    const cleanList = ACTIVE.swapTokenList || [];
    const sourceList = (cleanList.length > 0) ? cleanList : (ACTIVE.cTokens || []);

    if(sourceList) {
        sourceList.forEach(t => {
            const addr = t.address.toLowerCase();
            if(!uniqueTokens.has(addr)) {
                uniqueTokens.set(addr, {
                    symbol: t.symbol,
                    name: t.name || t.symbol,
                    address: t.address,
                    decimals: t.decimals || 18,
                    icon: t.logoURI || t.icon || "icons/token.svg",
                    isNative: false
                });
            }
        });
    }

    const term = filter.toLowerCase();
    const filtered = Array.from(uniqueTokens.values()).filter(t => 
        t.symbol.toLowerCase().includes(term) || 
        t.address.toLowerCase().includes(term)
    );

    filtered.forEach(token => {
        const item = document.createElement('div');
        item.className = 'wallet-btn';
        item.style.justifyContent = "flex-start";
        item.style.padding = "10px";
        
        item.innerHTML = `
            <img src="${token.icon}" onerror="this.onerror=null;this.src='icons/token.svg';" 
                 style="width:32px; height:32px; border-radius:50%; margin-right:12px; object-fit:contain;">
            <div style="text-align:left;">
                <div style="font-weight:700; color:#fff;">${token.symbol}</div>
                <div style="font-size:0.8rem; color:var(--text-muted);">${token.address === 'NATIVE' ? 'Native' : token.address.substring(0,6)+'...'}</div>
            </div>
        `;
        item.onclick = () => selectToken(token);
        tokenListContainer.appendChild(item);
    });
}

async function selectToken(token) {
    if(!pairData || !selectingSide) return;

    let finalAddress = token.address;
    
    // Si es NATIVO, tratamos de sacar la dirección del Underlying para propósitos internos si es necesario
    // Pero mantenemos isNative=true para la lógica de balances
    
    const newTokenObj = {
        symbol: token.symbol,
        address: finalAddress,
        decimals: token.decimals,
        icon: token.icon,
        isNative: token.isNative || token.address === 'NATIVE'
    };

    if(selectingSide === 'base') pairData.base = newTokenObj;
    else pairData.quote = newTokenObj;

    updateSwapUI();     
    updateBalances(); 
    // PARCHE: Recargar gráfica al cambiar token
    loadChartData(); 
    getEl('amountIn').value = ""; getEl('amountOut').value = "";
    if(getEl('swapDetails')) getEl('swapDetails').style.display = 'none';
    closeTokenModal();
}

// ==========================================
// === PRICE IMPACT CALCULATION (PRO) =======
// ==========================================

const PAIR_ABI_IMPACT = [
    "function getReserves() view returns (uint112, uint112, uint32)",
    "function token0() view returns (address)"
];

const FACTORY_ABI_IMPACT = [
    "function getPair(address, address) view returns (address)"
];

async function calculatePriceImpact(amountInWei, path, decimalsIn) {
    try {
        const tokenA = path[0];
        const tokenB = path[1];
        
        let factoryAddr = ACTIVE.factory;
        if(!factoryAddr) {
            const router = new ethers.Contract(ACTIVE.router, window.POOL_ROUTER_ABI, provider);
            factoryAddr = await router.factory();
        }

        const factory = new ethers.Contract(factoryAddr, FACTORY_ABI_IMPACT, provider);
        const pairAddr = await factory.getPair(tokenA, tokenB);

        if (pairAddr === "0x0000000000000000000000000000000000000000") {
            return { impact: 0, warning: "No Liquidity" };
        }

        const pair = new ethers.Contract(pairAddr, PAIR_ABI_IMPACT, provider);
        const [reserves, token0] = await Promise.all([
            pair.getReserves(),
            pair.token0()
        ]);

        const isTokenA0 = tokenA.toLowerCase() === token0.toLowerCase();
        const reserveIn = isTokenA0 ? reserves[0] : reserves[1];

        if(reserveIn <= 0n) return { impact: 0, warning: "Empty Pool" };

        const amountInFloat = parseFloat(ethers.formatUnits(amountInWei, decimalsIn));
        const reserveInFloat = parseFloat(ethers.formatUnits(reserveIn, decimalsIn));

        // Impacto Simplificado (Standard AMM)
        const impact = (amountInFloat / (reserveInFloat + amountInFloat)) * 100;
        
        return { impact: impact, warning: null };

    } catch (e) {
        console.error("Impact Calc Error:", e);
        return { impact: 0, warning: "Error" };
    }
}

function updateImpactUI(impactData) {
    const el = getEl('impactDisplay');
    if(!el) return;

    if(impactData.warning) {
        el.textContent = impactData.warning;
        el.style.color = "var(--text-muted)";
        return;
    }

    const val = impactData.impact;
    let color = "var(--success)"; // < 1%
    
    if(val > 5) color = "var(--danger)"; // > 5%
    else if(val > 1) color = "var(--warning)"; // 1-5%

    const text = val < 0.01 ? "< 0.01%" : val.toFixed(2) + "%";
    el.textContent = text;
    el.style.color = color;
}

// ... (MANTÉN TODO EL CÓDIGO ANTERIOR HASTA LLEGAR A LA SECCIÓN DEL CHART) ...
// ... (Justo después de la función updateImpactUI) ...

/* =========================================================
   HYBRID CHART: SYNTHETIC HISTORY + REAL-TIME UPDATES (CON FALLBACK)
   ========================================================= */

const CHART_THEME = {
    up: '#00e0ff',
    down: '#ff5555',
    bg: 'transparent',
    grid: 'rgba(255,255,255,0.05)',
    text: '#8fa2b7'
};

let chartInstance = null;
let candleSeries = null;
let chartInterval = null;
let lastCandleData = null; 

// Inicialización segura
document.addEventListener('DOMContentLoaded', () => {
    // Pequeño delay para asegurar que el DOM del contenedor existe
    setTimeout(initHybridChart, 1000);
});

// Hacemos las funciones globales para initApp
window.initChart = function() { initHybridChart(); };

window.loadChartData = async function() {
    if(chartInterval) clearInterval(chartInterval);

    // Validar entorno básico
    if(!ACTIVE) return; 

    // Referencia al título
    const titleEl = document.getElementById('chartPairName');
    
    // Nombres de tokens actuales
    const tIn = isEthToToken ? pairData.base : pairData.quote; 
    const tOut = isEthToToken ? pairData.quote : pairData.base;
    
    if(titleEl) titleEl.innerText = `Loading ${tIn.symbol}/${tOut.symbol}...`;

    try {
        let price = null;
        let isFallback = false;

        // 1. Intentar obtener PRECIO REAL de la Blockchain
        if(ACTIVE.rpcUrls && ACTIVE.rpcUrls.length > 0) {
            const readProvider = new ethers.JsonRpcProvider(ACTIVE.rpcUrls[0]);
            price = await fetchPriceFromBlockchain(readProvider);
        }

        // 2. Lógica de FALLBACK (Si no hay precio real)
        if (!price || price === 0) {
            console.warn("Chart: No liquidity found, switching to BTC Fallback.");
            isFallback = true;
            price = 96500.00; // Precio base simulado de BTC para el fallback
            
            if(titleEl) {
                titleEl.innerHTML = `
                    ${tIn.symbol} / ${tOut.symbol} 
                    <span style="color:var(--text-muted); font-size:0.7em; margin-left:10px;">(Market View: BTC Trend)</span>
                `;
            }
        } else {
             updateChartTitle(price);
        }

        // 3. Generar Historial
        // Si es fallback, generamos más volatilidad para que parezca Bitcoin
        const volatility = isFallback ? 0.05 : 0.02; 
        const historyData = generateSyntheticHistory(price, 100, volatility);
        
        if(candleSeries) {
            candleSeries.setData(historyData);
        }
        
        lastCandleData = historyData[historyData.length - 1];

        // 4. Loop Real-Time
        // Si es real, consultamos la blockchain. Si es fallback, simulamos movimiento.
        chartInterval = setInterval(async () => {
            let livePrice;
            
            if (isFallback) {
                // Simulación Random Walk para Fallback
                const change = (Math.random() - 0.5) * (lastCandleData.close * 0.005);
                livePrice = lastCandleData.close + change;
            } else {
                // Consulta Real
                const readProvider = new ethers.JsonRpcProvider(ACTIVE.rpcUrls[0]);
                livePrice = await fetchPriceFromBlockchain(readProvider);
            }

            if(livePrice) updateRealTimeCandle(livePrice);
        }, 5000); // 5 segundos para más fluidez

    } catch(e) {
        console.error("Chart Data Error:", e);
    }
};

async function initHybridChart() {
    const container = document.getElementById('priceChart');
    if(!container || !window.LightweightCharts) return;

    container.innerHTML = ''; 
    
    chartInstance = window.LightweightCharts.createChart(container, {
        layout: { backgroundColor: CHART_THEME.bg, textColor: CHART_THEME.text },
        grid: { 
            vertLines: { color: CHART_THEME.grid }, 
            horzLines: { color: CHART_THEME.grid } 
        },
        width: container.clientWidth,
        height: 350,
        timeScale: {
            timeVisible: true,
            secondsVisible: false,
            borderColor: CHART_THEME.grid,
        },
        rightPriceScale: {
            borderColor: CHART_THEME.grid,
        },
        crosshair: {
            mode: window.LightweightCharts.CrosshairMode.Normal,
        },
    });

    candleSeries = chartInstance.addCandlestickSeries({
        upColor: CHART_THEME.up,
        downColor: CHART_THEME.down,
        borderVisible: false,
        wickUpColor: CHART_THEME.up,
        wickDownColor: CHART_THEME.down,
    });

    window.addEventListener('resize', () => {
        if(container && chartInstance) {
            chartInstance.applyOptions({ width: container.clientWidth });
        }
    });
}

// --- CORE: Obtener Precio Real del Router ---
async function fetchPriceFromBlockchain(provider) {
    if(!ACTIVE.router || !pairData.base || !pairData.quote) return null;

    try {
        const router = new ethers.Contract(ACTIVE.router, window.ROUTER_ABI, provider);
        const WETH = ACTIVE.swapTokens.base.underlyingAddress;
        
        // Determinar dirección basada en el switch de la UI
        const tIn = isEthToToken ? pairData.base : pairData.quote; 
        const tOut = isEthToToken ? pairData.quote : pairData.base;

        const addrIn = (tIn.isNative || tIn.address === 'NATIVE') ? WETH : tIn.address;
        const addrOut = (tOut.isNative || tOut.address === 'NATIVE') ? WETH : tOut.address;

        // Pedir precio de 1 unidad de entrada
        const oneUnit = ethers.parseUnits("1", tIn.decimals);
        const amounts = await router.getAmountsOut(oneUnit, [addrIn, addrOut]);
        
        const price = parseFloat(ethers.formatUnits(amounts[1], tOut.decimals));
        return price;
    } catch(e) {
        // Retornamos null silenciosamente para activar el fallback
        return null;
    }
}

// --- MAGIC: Generador de Velas ---
function generateSyntheticHistory(currentPrice, count, volatilityFactor) {
    let data = [];
    let time = Math.floor(Date.now() / 1000) - (count * 3600);
    let val = currentPrice;

    // Generamos hacia atrás para asegurar que terminamos en el precio actual
    // Creamos un array temporal de valores
    let values = [currentPrice];
    for(let i=0; i<count-1; i++) {
        let prevVal = values[0];
        let change = (Math.random() - 0.5) * (prevVal * volatilityFactor);
        values.unshift(prevVal - change);
    }

    // Convertimos a velas
    for (let i = 0; i < count; i++) {
        let open = values[i];
        let close = (i < count-1) ? values[i+1] : currentPrice;
        
        // Asegurar algo de cuerpo en la vela
        let high = Math.max(open, close) * (1 + (Math.random() * 0.01));
        let low = Math.min(open, close) * (1 - (Math.random() * 0.01));

        data.push({
            time: time + (i * 3600),
            open: open, high: high, low: low, close: close
        });
    }
    
    return data;
}

function updateRealTimeCandle(price) {
    if(!lastCandleData) return;

    const now = Math.floor(Date.now() / 1000);
    const timeFrame = 3600; 
    const candleTime = Math.floor(now / timeFrame) * timeFrame;

    if (lastCandleData.time === candleTime) {
        // Actualizar vela actual
        lastCandleData = {
            time: lastCandleData.time,
            open: lastCandleData.open,
            high: Math.max(lastCandleData.high, price),
            low: Math.min(lastCandleData.low, price),
            close: price
        };
        candleSeries.update(lastCandleData);
    } else {
        // Nueva vela
        lastCandleData = {
            time: candleTime,
            open: lastCandleData.close,
            high: price,
            low: price,
            close: price
        };
        candleSeries.update(lastCandleData);
    }
    // Solo actualizamos el título numérico si NO estamos en modo fallback (para no confundir)
    // Opcionalmente, puedes actualizarlo siempre.
    // updateChartTitle(price); 
}

function updateChartTitle(price) {
    const titleEl = document.getElementById('chartPairName');
    const symIn = isEthToToken ? pairData.base.symbol : pairData.quote.symbol;
    const symOut = isEthToToken ? pairData.quote.symbol : pairData.base.symbol;

    if(titleEl) {
        titleEl.innerHTML = `
            ${symIn} / ${symOut} 
            <span style="color:${CHART_THEME.up}; margin-left:10px; font-size:0.9em;">${price.toFixed(6)}</span>
        `;
    }
}