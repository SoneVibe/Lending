// VIBE DASHBOARD WIDGET - PRO LOGIC (Slippage + Impact + Dynamic Pathing)
const getD = (id) => document.getElementById(id);

let dashTokenList = [];
let dashSlippage = 0.5; // Default 0.5%
let activePath = []; 

// === MASTER INIT LOGIC (AUTO-RECONNECT FIX) ===
let isWidgetInitialized = false;

// 1. Escuchar evento explícito
document.addEventListener("DashboardReady", () => {
    if(!isWidgetInitialized) initDashWidget();
});

// 2. Polling proactivo para reconexión rápida al navegar
const initCheck = setInterval(() => {
    if (window.ACTIVE && window.ACTIVE.chainId) {
        if(!isWidgetInitialized) {
            console.log("Widget: Auto-detected active network");
            initDashWidget();
        }
        clearInterval(initCheck);
    }
}, 200);

async function initDashWidget() {
    if (!window.ACTIVE) return; 
    isWidgetInitialized = true; // Lock initialization

    const net = window.ACTIVE;

    // 1. Preparar lista de tokens
    const baseTokens = net.swapTokens || {
        base: { symbol: "ETH", underlyingAddress: "0x4200000000000000000000000000000000000006", decimals: 18, isNative: true },
        quote: { symbol: "LIGHT", address: "0x957E619104a03552d767430F2F9a2D17C847310d", decimals: 18, isNative: false }
    };

    dashTokenList = [
        { ...baseTokens.base, isNative: true }, 
        { ...baseTokens.quote, isNative: false }
    ];

    if(net.cTokens) {
        net.cTokens.forEach(t => {
            const sym = t.underlyingSymbol || t.symbol.replace(/^c/, '');
            // Evitar duplicados
            if(!dashTokenList.find(x => x.symbol === sym)) {
                dashTokenList.push({
                    symbol: sym,
                    address: t.underlying,
                    decimals: t.underlyingDecimals || 18,
                    isNative: false
                });
            }
        });
    }

    // 2. Llenar Selectores
    fillDashSelector('dashTokenIn', dashTokenList, 0); 
    fillDashSelector('dashTokenOut', dashTokenList, 1);

    // 3. Listeners
    const amountIn = getD('dashAmountIn');
    if(amountIn) amountIn.addEventListener('input', debounce(handleDashQuote, 500));
    
    getD('dashTokenIn').addEventListener('change', () => { updateDashBalances(); handleDashQuote(); });
    getD('dashTokenOut').addEventListener('change', () => { updateDashBalances(); handleDashQuote(); });
    
    getD('btnDashSwitch').onclick = () => {
        const tkIn = getD('dashTokenIn').value;
        const tkOut = getD('dashTokenOut').value;
        getD('dashTokenIn').value = tkOut;
        getD('dashTokenOut').value = tkIn;
        getD('dashAmountIn').value = "";
        getD('dashAmountOut').value = "";
        resetDashUI();
        updateDashBalances();
    };

    // Slippage Control
    const btnSlip = getD('dashSlippageBtn');
    if(btnSlip) btnSlip.onclick = () => {
        if(dashSlippage === 0.1) dashSlippage = 0.5;
        else if(dashSlippage === 0.5) dashSlippage = 1.0;
        else if(dashSlippage === 1.0) dashSlippage = 5.0;
        else dashSlippage = 0.1;
        
        btnSlip.innerText = `⚙ ${dashSlippage}%`;
        const val = getD('dashAmountOut').value;
        if(val) handleDashQuote();
    };

    getD('btnDashSwap').onclick = handleDashExecution;

    // 4. Initial Update & Auto-Check Signer
    updateDashBalances();
}

function resetDashUI() {
    getD('dashRate').innerText = "--";
    getD('dashImpact').innerText = "0.00%";
    getD('dashMinReceived').innerText = "--";
}

function fillDashSelector(id, list, selectedIndex) {
    const sel = getD(id);
    if(!sel) return;
    sel.innerHTML = "";
    list.forEach((t, i) => {
        const opt = document.createElement("option");
        opt.value = i; 
        opt.textContent = t.symbol;
        if(i === selectedIndex) opt.selected = true;
        sel.appendChild(opt);
    });
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

async function updateDashBalances() {
    if (!window.signer) {
        // Doble check por si window.signer cargó después del init
        if(window.ACTIVE && window.provider) {
             try {
                 // Intentar recuperar signer si provider existe (caso Edge de navegación rápida)
                 const accounts = await window.provider.listAccounts();
                 if(accounts.length > 0) {
                     window.signer = await window.provider.getSigner();
                 }
             } catch(e) {}
        }
        
        if(!window.signer) {
            getD('btnDashSwap').textContent = "Connect Wallet";
            return;
        }
    }
    
    getD('btnDashSwap').textContent = "Swap";
    const user = await window.signer.getAddress(); 

    const idxIn = getD('dashTokenIn').value;
    const idxOut = getD('dashTokenOut').value;
    
    if(!dashTokenList[idxIn]) return;

    const tIn = dashTokenList[idxIn];
    const tOut = dashTokenList[idxOut];

    const getBal = async (t) => {
        try {
            if(t.isNative) {
                const b = await window.provider.getBalance(user);
                return parseFloat(ethers.formatEther(b)).toFixed(4);
            } else {
                const c = new ethers.Contract(t.address, window.MIN_ERC20_ABI, window.provider);
                const b = await c.balanceOf(user);
                return parseFloat(ethers.formatUnits(b, t.decimals)).toFixed(4);
            }
        } catch(e) { return "0.00"; }
    };

    getD('dashBalIn').textContent = await getBal(tIn);
    getD('dashBalOut').textContent = await getBal(tOut);
}

// --- CORE LOGIC: Path Finder & Quote ---

async function getBestPath(tIn, tOut, amountWei, router) {
    const WETH = window.ACTIVE.swapTokens ? window.ACTIVE.swapTokens.base.underlyingAddress : "0x4200000000000000000000000000000000000006";
    
    const pathA = (tIn.isNative || tIn.address === 'NATIVE') 
        ? [WETH, tOut.address] 
        : (tOut.isNative || tOut.address === 'NATIVE')
            ? [tIn.address, WETH]
            : [tIn.address, tOut.address];

    const pathB = (tIn.isNative || tIn.address === 'NATIVE') 
        ? [WETH, tOut.address] 
        : (tOut.isNative || tOut.address === 'NATIVE')
            ? [tIn.address, WETH]
            : [tIn.address, WETH, tOut.address]; 

    try {
        const amounts = await router.getAmountsOut(amountWei, pathA);
        if(amounts && amounts.length > 0) return pathA;
    } catch(e) {}

    try {
        const amounts = await router.getAmountsOut(amountWei, pathB);
        if(amounts && amounts.length > 0) return pathB;
    } catch(e) {}

    return null;
}

async function handleDashQuote() {
    const val = getD('dashAmountIn').value;
    
    if (!val || parseFloat(val) === 0) {
        getD('dashAmountOut').value = "";
        resetDashUI();
        return;
    }

    try {
        const idxIn = getD('dashTokenIn').value;
        const idxOut = getD('dashTokenOut').value;
        const tIn = dashTokenList[idxIn];
        const tOut = dashTokenList[idxOut];
        
        if(tIn.address === tOut.address) return;

        const routerAddr = window.ACTIVE.router;
        const router = new ethers.Contract(routerAddr, window.ROUTER_ABI, window.provider);

        const amountWei = ethers.parseUnits(val, tIn.decimals);
        
        const path = await getBestPath(tIn, tOut, amountWei, router);
        
        if (!path) {
            getD('dashAmountOut').value = "No Liquidity";
            return;
        }
        activePath = path;

        const amounts = await router.getAmountsOut(amountWei, path);
        const amountOut = amounts[amounts.length - 1];
        const fmtOut = ethers.formatUnits(amountOut, tOut.decimals);
        
        getD('dashAmountOut').value = parseFloat(fmtOut).toFixed(4);

        const rate = parseFloat(fmtOut) / parseFloat(val);
        getD('dashRate').textContent = `1 ${tIn.symbol} ≈ ${rate.toFixed(4)} ${tOut.symbol}`;

        const slippageMulti = 1 - (dashSlippage / 100);
        const minOut = parseFloat(fmtOut) * slippageMulti;
        getD('dashMinReceived').textContent = `${minOut.toFixed(4)} ${tOut.symbol}`;

        calculateDashImpact(amountWei, path, tIn.decimals);

    } catch (e) {
        getD('dashAmountOut').value = "Error";
    }
}

async function calculateDashImpact(amountInWei, path, decimalsIn) {
    try {
        const tokenA = path[0];
        const tokenB = path[1];
        
        let factoryAddr = window.ACTIVE.factory;
        const FACTORY_ABI = ["function getPair(address, address) view returns (address)"];
        const PAIR_ABI = ["function getReserves() view returns (uint112, uint112, uint32)", "function token0() view returns (address)"];

        const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, window.provider);
        const pairAddr = await factory.getPair(tokenA, tokenB);

        if (pairAddr === "0x0000000000000000000000000000000000000000") return;

        const pair = new ethers.Contract(pairAddr, PAIR_ABI, window.provider);
        const [reserves, token0] = await Promise.all([pair.getReserves(), pair.token0()]);

        const isTokenA0 = tokenA.toLowerCase() === token0.toLowerCase();
        const reserveIn = isTokenA0 ? reserves[0] : reserves[1];

        if(reserveIn <= 0n) return;

        const amountInFloat = parseFloat(ethers.formatUnits(amountInWei, decimalsIn));
        const reserveInFloat = parseFloat(ethers.formatUnits(reserveIn, decimalsIn));

        const impact = (amountInFloat / (reserveInFloat + amountInFloat)) * 100;
        
        const el = getD('dashImpact');
        el.textContent = impact < 0.01 ? "< 0.01%" : impact.toFixed(2) + "%";

        if(impact > 5) el.style.color = "var(--danger)";
        else if(impact > 1) el.style.color = "var(--warning)";
        else el.style.color = "var(--success)";

    } catch(e) { }
}

async function handleDashExecution() {
    if(!window.signer) { openWalletModal(); return; }

    const btn = getD('btnDashSwap');
    const val = getD('dashAmountIn').value;
    if(!val || !activePath) return;

    btn.textContent = "Processing...";
    btn.disabled = true;

    try {
        const idxIn = getD('dashTokenIn').value;
        const idxOut = getD('dashTokenOut').value;
        const tIn = dashTokenList[idxIn];
        const tOut = dashTokenList[idxOut];
        
        const routerAddr = window.ACTIVE.router;
        const router = new ethers.Contract(routerAddr, window.ROUTER_ABI, window.signer);
        
        const amountWei = ethers.parseUnits(val, tIn.decimals);
        const user = await window.signer.getAddress();
        const deadline = Math.floor(Date.now()/1000) + 1200;

        const amountsExpected = await router.getAmountsOut(amountWei, activePath);
        const amountOutExpected = amountsExpected[amountsExpected.length - 1];
        
        const slippageBps = BigInt(Math.floor(dashSlippage * 100));
        const BPS_MAX = 10000n;
        const amountOutMin = (amountOutExpected * (BPS_MAX - slippageBps)) / BPS_MAX;

        let tx;

        if (!tIn.isNative) {
            const tokenContract = new ethers.Contract(tIn.address, window.MIN_ERC20_ABI, window.signer);
            const allow = await tokenContract.allowance(user, routerAddr);
            if (allow < amountWei) {
                btn.textContent = `Approving ${tIn.symbol}...`;
                const txApp = await tokenContract.approve(routerAddr, ethers.MaxUint256);
                await txApp.wait();
            }
        }

        btn.textContent = "Swapping...";
        if (tIn.isNative) {
            tx = await router.swapExactETHForTokens(amountOutMin, activePath, user, deadline, { value: amountWei });
        } else if (tOut.isNative) {
            tx = await router.swapExactTokensForETH(amountWei, amountOutMin, activePath, user, deadline);
        } else {
            tx = await router.swapExactTokensForTokens(amountWei, amountOutMin, activePath, user, deadline);
        }

        await tx.wait();
        btn.textContent = "Success! 🦄";
        btn.style.background = "var(--success)";
        
        getD('dashAmountIn').value = "";
        getD('dashAmountOut').value = "";
        resetDashUI();
        updateDashBalances(); 
        
        if(window.refreshDashboard) window.refreshDashboard();

        setTimeout(() => {
            btn.textContent = "Swap";
            btn.style.background = "";
            btn.disabled = false;
        }, 2500);

    } catch (e) {
        console.error(e);
        let msg = "Failed";
        if(e.reason && e.reason.includes("INSUFFICIENT_OUTPUT_AMOUNT")) msg = "Slippage Error";
        btn.textContent = msg;
        btn.style.background = "var(--danger)";
        setTimeout(() => {
            btn.textContent = "Swap";
            btn.style.background = "";
            btn.disabled = false;
        }, 2500);
    }
}