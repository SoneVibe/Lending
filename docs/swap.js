// VIBESWAP LOGIC - PRO TIER (DYNAMIC + SLIPPAGE + LIQUIDATOR STYLE CONNECT + WRAP/UNWRAP)
let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let selectedProvider = null;

// STATE
let isEthToToken = true;   
let currentSlippage = 0.5; 
let pairData = { base: null, quote: null };

// FLAG GLOBAL PARA LA EJECUCIÓN
let isWrapAction = false;
let isUnwrapAction = false;

// ABI MINIMO PARA WETH
const WETH_ABI = [
    "function deposit() payable",
    "function withdraw(uint256 amount)"
];

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
    refreshActionButton();
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
    refreshActionButton();
  }
};

// --- INIT APP ---
document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
    try {
        // USAMOS SWAP CONFIG (CRÍTICO)
        NETWORKS_DATA = await window.loadSwapConfig();
        initNetworkSelector();
        
        ACTIVE = await detectInitialNetwork();
        
        // Initial Asset Setup
        if(ACTIVE) {
            if(getEl("networkSelect")) getEl("networkSelect").value = ACTIVE.chainId;
            setupAssets(ACTIVE);
            updateBalances(); 
            
            // PARCHE: Inicializamos la gráfica AQUÍ, cuando ACTIVE ya existe
            await initHybridChart(); 
            loadChartData(); 
        }

        if(!userAddress && getEl('connStatus')) {
            getEl('statusDot').style.color = "var(--success)";
            getEl('connStatus').textContent = "Online · wallet not connected";
        }

        if(window.checkAutoConnect) {
            await window.checkAutoConnect(connectWallet);
        }
    } catch(e) { console.error("Init Error:", e); }
}

// Restored sessions start on the wallet's chain, so the first render never shows another network's pair.
async function detectInitialNetwork() {
    const enabled = Object.values(NETWORKS_DATA).filter(n => n.enabled);
    let walletChainId = null;
    if (window.SessionManager?.isActive() && window.ethereum) {
        try { walletChainId = parseInt(await window.ethereum.request({ method: 'eth_chainId' }), 16); } catch (e) {}
    }
    return enabled.find(n => parseInt(n.chainId) === walletChainId)
        || enabled.find(n => n.chainId == "1868")
        || enabled[0];
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
    if (e.target === tokenModal) closeTokenModal(); 
    
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
        
        updateStatus(true);
        updateBalances();
        loadChartData(); 

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

window.setSlippage = (val) => {
    currentSlippage = val;
    const disp = getEl('slippageDisplay');
    const small = getEl('slippageSmall');
    if(disp) disp.textContent = val + "%";
    if(small) small.textContent = val + "% Slippage";

    const buttons = document.querySelectorAll('.btn-ghost');
    buttons.forEach(b => {
        const btnVal = parseFloat(b.textContent);
        if(btnVal === val) {
            b.style.border = val >= 5 ? '1px solid var(--warning)' : '1px solid var(--success)';
        } else {
            b.style.border = '1px solid transparent';
        }
    });
    if(getEl('spSlipDetail')) getEl('spSlipDetail').textContent = val + "%";
    if(getEl('amountIn').value || getEl('amountOut').value) scheduleQuote();
};

function formatSmartRate(rate) {
    if (!rate || isNaN(rate) || rate === 0) return "--";
    if (rate < 0.0001) return rate.toFixed(8).replace(/\.?0+$/, ""); 
    if (rate > 1000) return rate.toFixed(2);
    return rate.toFixed(4);
}

function setupAssets(network) {
    if(!network.swapTokens) return;
    
    pairData.base = network.swapTokens.base;   
    pairData.quote = network.swapTokens.quote; 
    
    if(pairData.base.isNative === undefined) pairData.base.isNative = true;
    
    updateSwapUI();
    pairReady = ensureRoutablePair().catch(() => {});
}

// === FUNCIÓN CORREGIDA: ORDEN DE ICONOS ASTR -> USDC ===
function updateChartIcons() {
    const container = getEl('chartIcons');
    if(!container || !pairData.base || !pairData.quote) return;

    // CORRECCIÓN AQUÍ: Invertimos el orden respecto a la versión anterior.
    // Ahora t1 es el 'base' (o el input actual) para que salga primero (izquierda/arriba)
    // t2 es el 'quote' (o el output actual) para que salga segundo (derecha/abajo)
    const t1 = isEthToToken ? pairData.base : pairData.quote;
    const t2 = isEthToToken ? pairData.quote : pairData.base;

    // Crear las imágenes
    const img1 = document.createElement('img');
    img1.src = t1.icon || 'icons/token.svg';
    img1.onerror = () => { img1.src = 'icons/token.svg'; }; 
    
    const img2 = document.createElement('img');
    img2.src = t2.icon || 'icons/token.svg';
    img2.onerror = () => { img2.src = 'icons/token.svg'; }; 

    // Limpiar y añadir
    container.innerHTML = '';
    container.appendChild(img1);
    container.appendChild(img2);
}

function updateSwapUI() {
    if (!pairData || !pairData.base || !pairData.quote) return;

    const base = pairData.base;
    const quote = pairData.quote;
    const inToken = isEthToToken ? base : quote;
    const outToken = isEthToToken ? quote : base;
    
    getEl('symIn').textContent = inToken.symbol;
    getEl('symOut').textContent = outToken.symbol;
    
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

    // --- LLAMADA A LA FUNCIÓN DE ICONOS ---
    updateChartIcons();
}

let balanceSeq = 0;
async function updateBalances() {
    if(!signer || !ACTIVE || !pairData.base || !pairData.quote) return;
    const seq = ++balanceSeq;
    const tokenInObj = isEthToToken ? pairData.base : pairData.quote;
    const tokenOutObj = isEthToToken ? pairData.quote : pairData.base;

    // Each token is read on its own (public RPC first, wallet RPC second) so one failure never blanks both.
    const readers = [getReadProvider(), provider].filter((p, i, all) => p && all.indexOf(p) === i);
    const getBalanceForToken = async (tokenObj) => {
        for (const rp of readers) {
            try {
                if(tokenObj.isNative || tokenObj.address === 'NATIVE') return await rp.getBalance(userAddress);
                return await new ethers.Contract(tokenObj.address, window.MIN_ERC20_ABI, rp).balanceOf(userAddress);
            } catch(e) { /* try next reader */ }
        }
        console.warn(`Balance unavailable for ${tokenObj.symbol}`);
        return null;
    };

    const [balIn, balOut] = await Promise.all([getBalanceForToken(tokenInObj), getBalanceForToken(tokenOutObj)]);
    if (seq !== balanceSeq) return;
    rawBal = { in: balIn, out: balOut };

    getEl('balIn').textContent = balIn === null ? '—' : fmtWei(balIn, tokenInObj.decimals, 4);
    getEl('balOut').textContent = balOut === null ? '—' : fmtWei(balOut, tokenOutObj.decimals, 4);
    refreshActionButton();
}

// --- SWAP EXECUTION ---
const amountIn = getEl('amountIn');
const amountOut = getEl('amountOut');
const btnSwap = getEl('btnSwapAction');

// ==========================================
// === QUOTE ENGINE (BOTH DIRECTIONS) =======
// ==========================================
// Typing in "You pay" quotes with getAmountsOut; typing in "You receive" quotes with
// getAmountsIn and fills "You pay". Execution stays exact-input (see btnSwap.onclick).

const QUOTE_ROUTER_ABI = [
    "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
    "function getAmountsIn(uint amountOut, address[] path) view returns (uint[] amounts)"
];

let independentField = 'in';
let quoteSeq = 0;
let quoteTimer = null;
let quoteLoading = false;
let quoteError = null;
let lastQuote = null;      // { inWei, outWei, impact }
let rawBal = { in: null, out: null };
let rateInverted = false;
const readProviders = {};

// Reads use the network's public RPC even when a wallet is connected: wallets throttle their RPC
// (MetaMask: "RPC endpoint returned too many errors") and the wallet stays reserved for signing.
function getReadProvider() {
    const url = ACTIVE?.rpcUrls?.[0];
    if (!url) return provider;
    if (!readProviders[ACTIVE.chainId]) {
        readProviders[ACTIVE.chainId] = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true });
    }
    return readProviders[ACTIVE.chainId];
}

function explorerUrl(pathPart) {
    const base = ACTIVE?.blockExplorerUrls?.[0];
    return base ? base.replace(/\/$/, '') + '/' + pathPart : null;
}

// ---- Routing: direct pool or one hop through any listed token, best price wins ----
function routeCandidates(tIn, tOut) {
    const W = ACTIVE.swapTokens.base.underlyingAddress;
    const a = isNativeTok(tIn) ? W : tIn.address;
    const b = isNativeTok(tOut) ? W : tOut.address;
    const seen = new Set([a.toLowerCase(), b.toLowerCase()]);
    const paths = [[a, b]];
    [W, ...(ACTIVE.swapTokenList || []).map(t => t.address)].forEach(m => {
        const l = m.toLowerCase();
        if (seen.has(l)) return;
        seen.add(l);
        paths.push([a, m, b]);
    });
    return paths;
}

let factoryAddrCache = {};
function getFactoryAddress() {
    const id = ACTIVE.chainId;
    if (ACTIVE.factory) return Promise.resolve(ACTIVE.factory);
    if (!factoryAddrCache[id]) {
        factoryAddrCache[id] = new ethers.Contract(ACTIVE.router, ["function factory() view returns (address)"], getReadProvider())
            .factory().catch((e) => { delete factoryAddrCache[id]; throw e; });
    }
    return factoryAddrCache[id];
}

// Pool existence per hop, cached for the session. Lookup errors count as "maybe" so quoting still decides.
const pairExistsCache = {};
function pairExists(a, b) {
    const key = ACTIVE.chainId + ':' + [a.toLowerCase(), b.toLowerCase()].sort().join(':');
    if (!pairExistsCache[key]) {
        pairExistsCache[key] = getFactoryAddress()
            .then(f => new ethers.Contract(f, FACTORY_ABI_IMPACT, getReadProvider()).getPair(a, b))
            .then(p => p !== ethers.ZeroAddress)
            .catch(() => { delete pairExistsCache[key]; return true; });
    }
    return pairExistsCache[key];
}

async function viablePaths(paths) {
    const checked = await Promise.all(paths.map(async (path) => {
        for (let i = 0; i < path.length - 1; i++) {
            if (!(await pairExists(path[i], path[i + 1]))) return null;
        }
        return path;
    }));
    return checked.filter(Boolean);
}

async function bestRoute(amountWei, exactIn, tIn, tOut) {
    const router = new ethers.Contract(ACTIVE.router, QUOTE_ROUTER_ABI, getReadProvider());
    const paths = await viablePaths(routeCandidates(tIn, tOut));
    const results = await Promise.all(paths.map(async (path) => {
        try {
            const amounts = exactIn ? await router.getAmountsOut(amountWei, path) : await router.getAmountsIn(amountWei, path);
            return amounts[0] > 0n && amounts[amounts.length - 1] > 0n ? { path, amounts: [...amounts] } : null;
        } catch (e) { return null; }
    }));
    const ok = results.filter(Boolean);
    if (!ok.length) throw new Error("No route");
    ok.sort((x, y) => {
        const d = exactIn ? y.amounts[y.amounts.length - 1] - x.amounts[x.amounts.length - 1] : x.amounts[0] - y.amounts[0];
        return d > 0n ? 1 : d < 0n ? -1 : x.path.length - y.path.length;
    });
    return ok[0];
}

async function routeImpact(path, amounts) {
    try {
        const rp = getReadProvider();
        const factoryAddr = await getFactoryAddress();
        const factory = new ethers.Contract(factoryAddr, FACTORY_ABI_IMPACT, rp);
        let keep = 1;
        for (let i = 0; i < path.length - 1; i++) {
            const pairAddr = await factory.getPair(path[i], path[i + 1]);
            if (pairAddr === ethers.ZeroAddress) return { impact: 0, warning: "No Liquidity" };
            const pair = new ethers.Contract(pairAddr, PAIR_ABI_IMPACT, rp);
            const [reserves, token0] = await Promise.all([pair.getReserves(), pair.token0()]);
            const reserveIn = path[i].toLowerCase() === token0.toLowerCase() ? reserves[0] : reserves[1];
            if (reserveIn <= 0n) return { impact: 0, warning: "Empty Pool" };
            keep *= Number(reserveIn) / (Number(reserveIn) + Number(amounts[i]));
        }
        return { impact: (1 - keep) * 100, warning: null };
    } catch (e) {
        console.error("Impact Calc Error:", e);
        return { impact: 0, warning: "Error" };
    }
}

function routeLabel(path, tIn, tOut) {
    const W = ACTIVE.swapTokens.base.underlyingAddress.toLowerCase();
    const mid = path.slice(1, -1).map(a => {
        const t = (ACTIVE.swapTokenList || []).find(x => x.address.toLowerCase() === a.toLowerCase());
        if (t) return t.symbol;
        return a.toLowerCase() === W ? 'W' + (ACTIVE.nativeCurrency?.symbol || 'ETH') : a.slice(0, 6);
    });
    return [tIn.symbol, ...mid, tOut.symbol].join(' → ');
}

// If a network's default pair has no pool, start from the first listed token that can be routed.
let pairCheckSeq = 0;
async function ensureRoutablePair() {
    const seq = ++pairCheckSeq;
    const net = ACTIVE;
    const base = pairData.base, quote = pairData.quote;
    if (!net?.router || !base || !quote) return;
    const probe = async (t) => {
        try { await bestRoute(ethers.parseUnits('0.0001', base.decimals || 18), true, base, t); return true; }
        catch (e) { return false; }
    };
    if (await probe(quote)) return;
    const W = (base.underlyingAddress || '').toLowerCase();
    const pref = ['USDC', 'USDT', 'DOT', 'ASTR'];
    const rank = (s) => { const i = pref.indexOf(String(s).toUpperCase()); return i === -1 ? pref.length : i; };
    const list = (net.swapTokenList || [])
        .filter(t => t.address.toLowerCase() !== W && t.address.toLowerCase() !== String(quote.address).toLowerCase())
        .sort((a, b) => rank(a.symbol) - rank(b.symbol));
    for (const t of list) {
        const cand = { symbol: t.symbol, address: t.address, decimals: t.decimals || 18, icon: t.logoURI || t.icon || 'icons/token.svg', isNative: false };
        const ok = await probe(cand);
        if (seq !== pairCheckSeq || ACTIVE !== net) return;
        if (!ok) continue;
        pairData.quote = cand;
        rawBal = { in: null, out: null };
        updateSwapUI();
        updateBalances();
        loadChartData();
        if (amountIn.value || amountOut.value) scheduleQuote();
        return;
    }
}

let chartRoutePath = null;

const tokenIn = () => isEthToToken ? pairData.base : pairData.quote;
const tokenOut = () => isEthToToken ? pairData.quote : pairData.base;
const isNativeTok = (t) => t.isNative || t.address === 'NATIVE';

function cleanAmount(v, decimals) {
    let s = String(v || '').replace(/,/g, '.').replace(/[^0-9.]/g, '');
    const dot = s.indexOf('.');
    if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
    if (s.startsWith('.')) s = '0' + s;
    const [i, f] = s.split('.');
    return f !== undefined ? `${i}.${f.slice(0, Number(decimals))}` : i;
}

function toWei(v, decimals) {
    const c = cleanAmount(v, decimals);
    if (!c || c === '.' || Number(c) === 0) return null;
    try { return ethers.parseUnits(c.endsWith('.') ? c.slice(0, -1) : c, decimals); } catch (e) { return null; }
}

// Formats a raw amount with a sensible number of decimals. roundUp is used for the
// computed "You pay" side so the displayed input always covers the requested output.
function fmtWei(wei, decimals, maxDec, roundUp = false) {
    if (wei === null || wei === undefined) return '0';
    const d = Number(decimals);
    const whole = wei / (10n ** BigInt(d));
    let places = maxDec ?? (whole >= 1000n ? 2 : whole >= 1n ? 6 : 8);
    places = Math.min(places, d);
    const scale = 10n ** BigInt(d - places);
    let q = wei / scale;
    if (roundUp && wei % scale !== 0n) q += 1n;
    const out = ethers.formatUnits(q * scale, d);
    return out.includes('.') ? out.replace(/\.?0+$/, '') : out;
}

function setHints() {
    const hin = getEl('spHintIn'), hout = getEl('spHintOut');
    const hasValue = amountIn.value || amountOut.value;
    if (hin) hin.textContent = hasValue && independentField === 'out' ? 'Estimated' : '';
    if (hout) hout.textContent = hasValue && independentField === 'in' ? 'Estimated' : '';
}

function resetQuote() {
    quoteSeq++;
    clearTimeout(quoteTimer);
    quoteLoading = false; quoteError = null; lastQuote = null;
    isWrapAction = false; isUnwrapAction = false;
    const details = getEl('swapDetails');
    if (details) details.style.display = 'none';
    const impactEl = getEl('impactDisplay');
    if (impactEl) { impactEl.textContent = "--"; impactEl.style.color = "var(--success)"; }
    document.querySelectorAll('.token-input-box-pro').forEach(b => b.classList.remove('is-loading'));
    setHints();
    refreshActionButton();
}

function scheduleQuote() {
    clearTimeout(quoteTimer);
    const seq = ++quoteSeq;
    const typed = independentField === 'in' ? amountIn.value : amountOut.value;
    if (!typed || Number(cleanAmount(typed, 18)) === 0) {
        (independentField === 'in' ? amountOut : amountIn).value = '';
        resetQuote();
        return;
    }
    quoteLoading = true; quoteError = null;
    document.querySelectorAll('.token-input-box-pro').forEach((b, i) =>
        b.classList.toggle('is-loading', (independentField === 'in') === (i === 1)));
    setHints();
    refreshActionButton();
    quoteTimer = setTimeout(() => runQuote(seq), 250);
}

function renderRate(inWei, outWei) {
    const tIn = tokenIn(), tOut = tokenOut();
    const a = parseFloat(ethers.formatUnits(inWei, tIn.decimals));
    const b = parseFloat(ethers.formatUnits(outWei, tOut.decimals));
    const el = getEl('priceDisplay');
    if (!el || !a || !b) return;
    const fmt = (x) => x >= 1000 ? x.toLocaleString('en-US', { maximumFractionDigits: 2 })
        : x >= 1 ? String(+x.toFixed(4)) : String(+x.toPrecision(4));
    el.textContent = rateInverted
        ? `1 ${tOut.symbol} = ${fmt(a / b)} ${tIn.symbol}`
        : `1 ${tIn.symbol} = ${fmt(b / a)} ${tOut.symbol}`;
}

async function runQuote(seq) {
    const tIn = tokenIn(), tOut = tokenOut();
    const details = getEl('swapDetails');
    const exactIn = independentField === 'in';
    const typedWei = exactIn ? toWei(amountIn.value, tIn.decimals) : toWei(amountOut.value, tOut.decimals);
    const dependent = exactIn ? amountOut : amountIn;

    isWrapAction = false; isUnwrapAction = false;

    try {
        if (!typedWei) { dependent.value = ''; resetQuote(); return; }
        if (!ACTIVE?.router || !tIn || !tOut) throw new Error("Pair data incomplete");

        const WETH_ADDR = ACTIVE.swapTokens.base.underlyingAddress;
        const wethLC = WETH_ADDR.toLowerCase();
        const addrIn = isNativeTok(tIn) ? 'NATIVE' : tIn.address.toLowerCase();
        const addrOut = isNativeTok(tOut) ? 'NATIVE' : tOut.address.toLowerCase();

        let inWei, outWei, impact = 0, path = null;

        if ((addrIn === 'NATIVE' && addrOut === wethLC) || (addrIn === wethLC && addrOut === 'NATIVE')) {
            isWrapAction = addrIn === 'NATIVE';
            isUnwrapAction = !isWrapAction;
            inWei = outWei = typedWei;
        } else {
            const best = await bestRoute(typedWei, exactIn, tIn, tOut);
            if (seq !== quoteSeq) return;
            path = best.path;
            inWei = best.amounts[0];
            outWei = best.amounts[best.amounts.length - 1];
            const impactData = await routeImpact(path, best.amounts);
            if (seq !== quoteSeq) return;
            updateImpactUI(impactData);
            impact = impactData.warning ? 0 : impactData.impact;
            const route = getEl('spRoute');
            if (route) route.textContent = routeLabel(path, tIn, tOut);
        }
        if (seq !== quoteSeq) return;

        dependent.value = exactIn ? fmtWei(outWei, tOut.decimals) : fmtWei(inWei, tIn.decimals, undefined, true);
        lastQuote = { inWei, outWei, impact, path };

        if (details) details.style.display = 'block';
        if (isWrapAction || isUnwrapAction) {
            getEl('priceDisplay').textContent = isWrapAction ? "1 : 1 (Wrap)" : "1 : 1 (Unwrap)";
            getEl('impactDisplay').textContent = "0.00%";
            getEl('impactDisplay').style.color = "var(--success)";
            getEl('minReceivedDisplay').textContent = `${fmtWei(outWei, tOut.decimals)} ${tOut.symbol}`;
            const route = getEl('spRoute');
            if (route) route.textContent = `${tIn.symbol} → ${tOut.symbol} · ${isWrapAction ? 'Wrap' : 'Unwrap'}`;
        } else {
            renderRate(inWei, outWei);
            const slippageBps = BigInt(Math.floor(currentSlippage * 100));
            const minOut = (outWei * (10000n - slippageBps)) / 10000n;
            getEl('minReceivedDisplay').textContent = `${fmtWei(minOut, tOut.decimals)} ${tOut.symbol}`;
        }
        quoteError = null;
    } catch (e) {
        if (seq !== quoteSeq) return;
        console.log("Quote Error:", e);
        dependent.value = '';
        lastQuote = null;
        quoteError = "Insufficient liquidity for this trade";
        if (details) details.style.display = 'none';
        const impactEl = getEl('impactDisplay');
        if (impactEl) impactEl.textContent = "--";
    } finally {
        if (seq === quoteSeq) {
            quoteLoading = false;
            document.querySelectorAll('.token-input-box-pro').forEach(b => b.classList.remove('is-loading'));
            setHints();
            refreshActionButton();
        }
    }
}

function refreshActionButton() {
    const btn = getEl('btnSwapAction');
    if (!btn) return;
    btn.classList.remove('is-warning', 'is-danger');
    const set = (text, disabled) => { btn.textContent = text; btn.disabled = disabled; };

    if (!userAddress) return set("Connect Wallet", false);
    if (!pairData.base || !pairData.quote) return set("Select a token", true);
    const hasValue = (getEl('amountIn')?.value || getEl('amountOut')?.value);
    if (quoteLoading) return set("Fetching best price…", true);
    if (quoteError) return set(quoteError, true);
    if (!hasValue || !lastQuote) return set("Enter an amount", true);
    if (rawBal.in !== null && lastQuote.inWei > rawBal.in) return set(`Insufficient ${tokenIn().symbol} balance`, true);

    if (isWrapAction) return set("Wrap", false);
    if (isUnwrapAction) return set("Unwrap", false);
    if (lastQuote.impact > 15) { btn.classList.add('is-danger'); return set("Swap anyway · high price impact", false); }
    if (lastQuote.impact > 5) btn.classList.add('is-warning');
    set("Swap", false);
}

function onAmountTyped(field) {
    const el = field === 'in' ? amountIn : amountOut;
    const t = field === 'in' ? tokenIn() : tokenOut();
    const cleaned = cleanAmount(el.value, t ? t.decimals : 18);
    if (cleaned !== el.value) el.value = cleaned;
    independentField = field;
    getEl('swapStatus').textContent = '';
    scheduleQuote();
}

if (amountIn) amountIn.addEventListener('input', () => onAmountTyped('in'));
if (amountOut) {
    amountOut.disabled = false;
    amountOut.addEventListener('input', () => onAmountTyped('out'));
}

async function setFractionOfBalance(numerator, denominator) {
    if (!signer) { openWalletModal(); return; }
    if (rawBal.in === null) await updateBalances();
    const t = tokenIn();
    if (!t || rawBal.in === null) return;
    let amount = (rawBal.in * BigInt(numerator)) / BigInt(denominator);
    if (isNativeTok(t) && numerator === denominator) {
        try {
            const fee = await getReadProvider().getFeeData();
            const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
            const reserve = gasPrice * 300000n * 2n;
            amount = amount > reserve ? amount - reserve : 0n;
        } catch (e) { /* keep full balance */ }
    }
    amountIn.value = amount > 0n ? fmtWei(amount, t.decimals, Math.min(8, Number(t.decimals))) : '';
    independentField = 'in';
    scheduleQuote();
}
if (getEl('spMax')) getEl('spMax').onclick = () => setFractionOfBalance(1, 1);
if (getEl('spHalf')) getEl('spHalf').onclick = () => setFractionOfBalance(1, 2);

if (getEl('priceDisplay')) getEl('priceDisplay').onclick = () => {
    rateInverted = !rateInverted;
    if (lastQuote && !isWrapAction && !isUnwrapAction) renderRate(lastQuote.inWei, lastQuote.outWei);
};

const settingsBtn = getEl('spSettingsBtn');
const settingsPanel = getEl('spSettings');
if (settingsBtn && settingsPanel) {
    settingsBtn.onclick = (e) => {
        e.stopPropagation();
        settingsPanel.hidden = !settingsPanel.hidden;
        settingsBtn.setAttribute('aria-expanded', String(!settingsPanel.hidden));
    };
    document.addEventListener('click', (e) => {
        if (!settingsPanel.hidden && !settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
            settingsPanel.hidden = true;
            settingsBtn.setAttribute('aria-expanded', 'false');
        }
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (getEl('tokenModal')?.classList.contains('open')) closeTokenModal();
    if (getEl('walletModal')?.classList.contains('open')) closeWalletModal();
    if (settingsPanel && !settingsPanel.hidden) { settingsPanel.hidden = true; settingsBtn.setAttribute('aria-expanded', 'false'); }
});

if (getEl('btnViewExplorer')) getEl('btnViewExplorer').onclick = () => {
    const url = userAddress && explorerUrl('address/' + userAddress);
    if (url) window.open(url, '_blank', 'noopener');
};

// The typed amount stays with its token when the pair is flipped.
function flipTokens() {
    const vIn = amountIn.value, vOut = amountOut.value;
    isEthToToken = !isEthToToken;
    rawBal = { in: rawBal.out, out: rawBal.in };
    updateSwapUI();
    updateBalances();
    loadChartData();
    if (independentField === 'in') { amountOut.value = vIn; amountIn.value = ''; independentField = 'out'; }
    else { amountIn.value = vOut; amountOut.value = ''; independentField = 'in'; }
    const btn = getEl('btnSwitch');
    if (btn) { btn.classList.remove('spin'); void btn.offsetWidth; btn.classList.add('spin'); }
    if (amountIn.value || amountOut.value) scheduleQuote(); else resetQuote();
}
if (getEl('btnSwitch')) getEl('btnSwitch').onclick = flipTokens;

if(btnSwap) {
    btnSwap.onclick = async () => {
        if(!signer) { openWalletModal(); return; }
        if(btnSwap.disabled) return;
        const tokenInObj = isEthToToken ? pairData.base : pairData.quote;
        const val = cleanAmount(amountIn.value, tokenInObj.decimals);
        if(!val || Number(val) === 0) return;

        const statusDiv = getEl('swapStatus');
        const amountInWei = ethers.parseUnits(val, tokenInObj.decimals);
        const WETH_ADDR = ACTIVE.swapTokens.base.underlyingAddress;

        try {
            let tx;

            // --- EXECUTE WRAP / UNWRAP ---
            if(isWrapAction || isUnwrapAction) {
                const wethContract = new ethers.Contract(WETH_ADDR, WETH_ABI, signer);
                
                if (isWrapAction) {
                    statusDiv.innerText = `Wrapping ETH...`;
                    statusDiv.style.color = "var(--warning)";
                    tx = await wethContract.deposit({ value: amountInWei });
                } else {
                    statusDiv.innerText = `Unwrapping WETH...`;
                    statusDiv.style.color = "var(--warning)";
                    tx = await wethContract.withdraw(amountInWei);
                }
            } 
            // --- EXECUTE STANDARD ROUTER SWAP ---
            else {
                const router = new ethers.Contract(ACTIVE.router, window.ROUTER_ABI, signer);
                
                const tokenOutObj = isEthToToken ? pairData.quote : pairData.base;
                
                const addrIn = (tokenInObj.isNative || tokenInObj.address === 'NATIVE') ? WETH_ADDR : tokenInObj.address;
                const addrOut = (tokenOutObj.isNative || tokenOutObj.address === 'NATIVE') ? WETH_ADDR : tokenOutObj.address;
                const path = (lastQuote && lastQuote.path) ? lastQuote.path : [addrIn, addrOut];
                
                const amounts = await router.getAmountsOut(amountInWei, path);
                const amountOutExpected = amounts[amounts.length - 1];
                
                const slippageBps = BigInt(Math.floor(currentSlippage * 100));
                const BPS_MAX = 10000n;
                const amountOutMin = (amountOutExpected * (BPS_MAX - slippageBps)) / BPS_MAX;
                const deadline = Math.floor(Date.now() / 1000) + 1200;

                statusDiv.innerText = `Swapping...`;
                statusDiv.style.color = "var(--warning)";

                // Aprobaciones y Swap Standard
                if(tokenInObj.isNative || tokenInObj.address === 'NATIVE') {
                    tx = await router.swapExactETHForTokens(
                        amountOutMin, path, userAddress, deadline, { value: amountInWei }
                    );
                } else if (tokenOutObj.isNative || tokenOutObj.address === 'NATIVE') {
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
            }

            statusDiv.innerText = "Tx Sent...";
            btnSwap.disabled = true; btnSwap.textContent = "Confirming…";
            await tx.wait();
            const doneMsg = isWrapAction ? "Wrap successful" : (isUnwrapAction ? "Unwrap successful" : "Swap successful");
            const txUrl = explorerUrl('tx/' + tx.hash);
            statusDiv.textContent = doneMsg + (txUrl ? " · " : "");
            if(txUrl) {
                const a = document.createElement('a');
                a.href = txUrl; a.target = "_blank"; a.rel = "noopener"; a.textContent = "View on explorer ↗";
                statusDiv.appendChild(a);
            }
            statusDiv.style.color = "var(--success)";
            amountIn.value = ""; amountOut.value = "";
            resetQuote();
            updateBalances();
            
        } catch(e) {
            console.error(e);
            let msg = "Transaction Failed";
            if(e.reason && e.reason.includes("INSUFFICIENT_OUTPUT_AMOUNT")) msg = "Slippage Error";
            if(e.code === "ACTION_REJECTED" || e.info?.error?.code === 4001) msg = "Transaction rejected in wallet";
            statusDiv.innerText = msg;
            statusDiv.style.color = "var(--danger)";
            refreshActionButton();
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
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.onkeydown = (e) => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectToken(token); } };
        tokenListContainer.appendChild(item);
    });
}

async function selectToken(token) {
    if(!pairData || !selectingSide) return;

    const other = selectingSide === 'base' ? pairData.quote : pairData.base;
    if(other && String(other.address).toLowerCase() === String(token.address).toLowerCase()) {
        closeTokenModal();
        flipTokens();
        return;
    }

    let finalAddress = token.address;
    
    const newTokenObj = {
        symbol: token.symbol,
        address: finalAddress,
        decimals: token.decimals,
        icon: token.icon,
        isNative: token.isNative || token.address === 'NATIVE'
    };

    if(selectingSide === 'base') pairData.base = newTokenObj;
    else pairData.quote = newTokenObj;

    rawBal = { in: null, out: null };
    updateSwapUI();     
    updateBalances(); 
    loadChartData(); 
    const keep = independentField === 'in' ? amountIn.value : amountOut.value;
    closeTokenModal();
    if(keep) scheduleQuote(); else resetQuote();
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
let chartSeq = 0;
let pairReady = Promise.resolve();

// Hacemos las funciones globales para initApp
window.initChart = function() { initHybridChart(); };

window.loadChartData = async function() {
    const seq = ++chartSeq;
    if(chartInterval) clearInterval(chartInterval);
    chartInterval = null;
    chartRoutePath = null;

    // Validar entorno básico
    if(!ACTIVE) return; 

    // Referencia al título
    const titleEl = document.getElementById('chartPairName');
    if(titleEl) titleEl.innerText = 'Loading price…';

    // The network's default pair may be replaced by a routable one; chart only the final pair.
    await pairReady;
    if (seq !== chartSeq || !pairData.base || !pairData.quote) return;
    const net = ACTIVE;
    const isStale = () => seq !== chartSeq || ACTIVE !== net;
    
    // Nombres de tokens actuales
    const tIn = isEthToToken ? pairData.base : pairData.quote; 
    const tOut = isEthToToken ? pairData.quote : pairData.base;
    
    if(titleEl) titleEl.innerText = `Loading ${tIn.symbol}/${tOut.symbol}...`;

    try {
        let price = null;
        let isFallback = false;

        // 1. Intentar obtener PRECIO REAL de la Blockchain (one retry for transient RPC errors)
        if(ACTIVE.rpcUrls && ACTIVE.rpcUrls.length > 0) {
            price = await fetchPriceFromBlockchain(getReadProvider());
            if (!price && !isStale()) {
                await new Promise(r => setTimeout(r, 1500));
                if (!isStale()) price = await fetchPriceFromBlockchain(getReadProvider());
            }
        }
        if (isStale()) return;

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
            const precision = price >= 100 ? 2 : price >= 1 ? 4 : Math.min(10, Math.max(4, Math.ceil(-Math.log10(price)) + 3));
            candleSeries.applyOptions({ priceFormat: { type: 'price', precision, minMove: Math.pow(10, -precision) } });
            candleSeries.setData(historyData);
        }
        
        lastCandleData = historyData[historyData.length - 1];

        // 4. Loop Real-Time
        // Si es real, consultamos la blockchain. Si es fallback, simulamos movimiento.
        let polling = false;
        chartInterval = setInterval(async () => {
            if (document.hidden || polling || isStale()) return;
            let livePrice;
            
            if (isFallback) {
                // Simulación Random Walk para Fallback
                const change = (Math.random() - 0.5) * (lastCandleData.close * 0.005);
                livePrice = lastCandleData.close + change;
            } else {
                // Consulta Real
                polling = true;
                try { livePrice = await fetchPriceFromBlockchain(getReadProvider()); }
                finally { polling = false; }
                if (isStale()) return;
            }

            if(livePrice) updateRealTimeCandle(livePrice);
        }, isFallback ? 5000 : 10000);

    } catch(e) {
        console.error("Chart Data Error:", e);
    }
};

async function initHybridChart() {
    const container = document.getElementById('priceChart');
    if(!container || !window.LightweightCharts || chartInstance) return;

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
        
        // Determinar dirección basada en el switch de la UI
        const tIn = isEthToToken ? pairData.base : pairData.quote; 
        const tOut = isEthToToken ? pairData.quote : pairData.base;

        // Spot price: quoting a full unit in shallow pools returns the price after slippage,
        // so quote 1/10,000 of a unit (same route as the swap) and scale it back up.
        const probeExp = Number(tIn.decimals) >= 6 ? 4 : 0;
        const probe = ethers.parseUnits("1", Number(tIn.decimals) - probeExp);
        const routeKey = [ACTIVE.chainId, tIn.address, tOut.address].join(':').toLowerCase();
        let amounts;
        if (chartRoutePath && chartRoutePath.key === routeKey) {
            amounts = await router.getAmountsOut(probe, chartRoutePath.path);
        } else {
            const best = await bestRoute(probe, true, tIn, tOut);
            chartRoutePath = { key: routeKey, path: best.path };
            amounts = best.amounts;
        }
        
        const price = parseFloat(ethers.formatUnits(amounts[amounts.length - 1], tOut.decimals)) * Math.pow(10, probeExp);
        return price;
    } catch(e) {
        chartRoutePath = null;
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
