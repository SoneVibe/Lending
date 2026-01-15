// VIBE DASHBOARD WIDGET - PRO LOGIC (Wrap/Unwrap + Auto-Connect + Safety Fixes)
(function() {
    const getD = (id) => document.getElementById(id);

    let dashTokenList = [];
    let dashSlippage = 0.5; // Default 0.5%
    let activePath = []; 
    let isWrapOperation = false;
    let isUnwrapOperation = false;

    // ABI Minimo para Wrap/Unwrap
    const WETH_ABI = [
        "function deposit() payable",
        "function withdraw(uint256 amount)"
    ];

    // 1. ESPERAR A QUE LA RED (ACTIVE) ESTÉ LISTA
    const initInterval = setInterval(() => {
        if (window.ACTIVE && window.ACTIVE.chainId) {
            clearInterval(initInterval);
            console.log("Swap Widget: Network Detected", window.ACTIVE.label);
            initDashWidget();
        }
    }, 200);

    // 2. ESCUCHAR RE-CONEXIÓN
    window.addEventListener('DashboardReady', () => {
        console.log("Swap Widget: Wallet Connected Signal Received");
        updateDashBalances(); 
    });

    async function initDashWidget() {
        if (!window.ACTIVE) return; 
        const net = window.ACTIVE;

        // --- PREPARAR LISTA DE TOKENS (FIXED) ---
        const baseTokens = net.swapTokens || {
            base: { symbol: "ETH", underlyingAddress: "0x4200000000000000000000000000000000000006", decimals: 18, isNative: true },
            quote: { symbol: "LIGHT", address: "0x957E619104a03552d767430F2F9a2D17C847310d", decimals: 18, isNative: false }
        };

        dashTokenList = [
            { ...baseTokens.base, isNative: true }, 
            { ...baseTokens.quote, isNative: false }
        ];

        // --- CARGA DE CTOKENS SEGURA (FIX DEL ERROR DE CONSOLA) ---
        if(net.cTokens) {
            net.cTokens.forEach(t => {
                // Validación defensiva: si falta el símbolo, saltamos este token
                if (!t || (!t.symbol && !t.underlyingSymbol)) return;

                const sym = t.underlyingSymbol || t.symbol.replace(/^c/, '');
                
                // Evitar duplicados
                const alreadyExists = dashTokenList.find(x => x.symbol === sym);
                if(!alreadyExists) {
                    dashTokenList.push({
                        symbol: sym,
                        address: t.underlying,
                        decimals: t.underlyingDecimals || 18,
                        isNative: false
                    });
                }
            });
        }

        // --- LLENAR SELECTORES ---
        fillDashSelector('dashTokenIn', dashTokenList, 0); 
        fillDashSelector('dashTokenOut', dashTokenList, 1);

        // --- LISTENERS ---
        const amountIn = getD('dashAmountIn');
        if(amountIn) {
            const newAmountIn = amountIn.cloneNode(true);
            amountIn.parentNode.replaceChild(newAmountIn, amountIn);
            newAmountIn.addEventListener('input', debounce(handleDashQuote, 500));
            newAmountIn.id = 'dashAmountIn'; 
        }
        
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

        const btnSlip = getD('dashSlippageBtn');
        if(btnSlip) btnSlip.onclick = () => {
            if(dashSlippage === 0.1) dashSlippage = 0.5;
            else if(dashSlippage === 0.5) dashSlippage = 1.0;
            else if(dashSlippage === 1.0) dashSlippage = 5.0;
            else dashSlippage = 0.1;
            btnSlip.innerText = `⚙ ${dashSlippage}%`;
            const val = getD('dashAmountOut').value;
            if(val && val !== "Error") handleDashQuote();
        };

        getD('btnDashSwap').onclick = handleDashExecution;

        // Update Inicial
        setTimeout(updateDashBalances, 100);
    }

    function resetDashUI() {
        getD('dashRate').innerText = "--";
        getD('dashImpact').innerText = "0.00%";
        getD('dashMinReceived').innerText = "--";
        isWrapOperation = false;
        isUnwrapOperation = false;
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
            getD('btnDashSwap').textContent = "Connect Wallet";
            getD('dashBalIn').textContent = "0.00";
            getD('dashBalOut').textContent = "0.00";
            return;
        }
        
        const user = await window.signer.getAddress(); 
        const idxIn = getD('dashTokenIn').value;
        const idxOut = getD('dashTokenOut').value;
        
        if(!dashTokenList[idxIn]) return;

        const tIn = dashTokenList[idxIn];
        const tOut = dashTokenList[idxOut];

        // --- DETECT WRAP/UNWRAP STATE PARA BOTÓN ---
        const WETH_ADDR = window.ACTIVE.swapTokens ? window.ACTIVE.swapTokens.base.underlyingAddress.toLowerCase() : "";
        const tInAddr = tIn.isNative ? "NATIVE" : tIn.address.toLowerCase();
        const tOutAddr = tOut.isNative ? "NATIVE" : tOut.address.toLowerCase();

        const btn = getD('btnDashSwap');
        
        if (tIn.isNative && tOutAddr === WETH_ADDR) {
            btn.textContent = "Wrap";
        } else if (tInAddr === WETH_ADDR && tOut.isNative) {
            btn.textContent = "Unwrap";
        } else {
            btn.textContent = "Swap";
        }

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

    // --- LOGIC: PATH & WRAP DETECTION ---

    async function getBestPath(tIn, tOut, amountWei, router) {
        const WETH = window.ACTIVE.swapTokens ? window.ACTIVE.swapTokens.base.underlyingAddress : "0x4200000000000000000000000000000000000006";
        
        // --- 1. DETECT WRAP/UNWRAP ---
        isWrapOperation = false;
        isUnwrapOperation = false;

        const tInAddr = tIn.isNative ? "NATIVE" : tIn.address.toLowerCase();
        const tOutAddr = tOut.isNative ? "NATIVE" : tOut.address.toLowerCase();
        const wethAddr = WETH.toLowerCase();

        if (tIn.isNative && tOutAddr === wethAddr) {
            isWrapOperation = true;
            return "WRAP"; // Marcador especial
        }
        if (tInAddr === wethAddr && tOut.isNative) {
            isUnwrapOperation = true;
            return "UNWRAP"; // Marcador especial
        }

        // --- 2. NORMAL SWAP PATHS ---
        const pathA = (tIn.isNative) ? [WETH, tOut.address] 
            : (tOut.isNative) ? [tIn.address, WETH]
            : [tIn.address, tOut.address];

        const pathB = (tIn.isNative) ? [WETH, tOut.address] 
            : (tOut.isNative) ? [tIn.address, WETH]
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
            
            if(tIn.address === tOut.address) return; // Mismo token

            const routerAddr = window.ACTIVE.router;
            const router = new ethers.Contract(routerAddr, window.ROUTER_ABI, window.provider);
            const amountWei = ethers.parseUnits(val, tIn.decimals);
            
            // Buscar ruta o detectar Wrap
            const path = await getBestPath(tIn, tOut, amountWei, router);
            activePath = path; // Guardar ruta

            if (!path) {
                getD('dashAmountOut').value = "No Liquidity";
                return;
            }

            // --- CASO WRAP/UNWRAP (1:1) ---
            if (path === "WRAP" || path === "UNWRAP") {
                getD('dashAmountOut').value = parseFloat(val).toFixed(4);
                getD('dashRate').textContent = `1 ${tIn.symbol} = 1 ${tOut.symbol}`;
                getD('dashImpact').textContent = "0.00%"; // Sin impacto
                getD('dashMinReceived').textContent = `${val} ${tOut.symbol}`; // Sin slippage
                return;
            }

            // --- CASO SWAP NORMAL ---
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
            // console.warn(e);
            getD('dashAmountOut').value = "";
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
        const val = document.getElementById('dashAmountIn').value;
        if(!val || !activePath) return;

        btn.textContent = "Processing...";
        btn.disabled = true;

        try {
            const idxIn = getD('dashTokenIn').value;
            const idxOut = getD('dashTokenOut').value;
            const tIn = dashTokenList[idxIn];
            const tOut = dashTokenList[idxOut];
            
            const amountWei = ethers.parseUnits(val, tIn.decimals);
            const user = await window.signer.getAddress();
            let tx;

            // --- EXECUTE WRAP / UNWRAP ---
            if (activePath === "WRAP" || activePath === "UNWRAP") {
                const WETH = window.ACTIVE.swapTokens.base.underlyingAddress;
                const wethContract = new ethers.Contract(WETH, WETH_ABI, window.signer);

                if (activePath === "WRAP") {
                    btn.textContent = "Wrapping...";
                    tx = await wethContract.deposit({ value: amountWei });
                } else {
                    btn.textContent = "Unwrapping...";
                    tx = await wethContract.withdraw(amountWei);
                }
            } 
            // --- EXECUTE NORMAL SWAP ---
            else {
                const routerAddr = window.ACTIVE.router;
                const router = new ethers.Contract(routerAddr, window.ROUTER_ABI, window.signer);
                const deadline = Math.floor(Date.now()/1000) + 1200;

                const amountsExpected = await router.getAmountsOut(amountWei, activePath);
                const amountOutExpected = amountsExpected[amountsExpected.length - 1];
                
                const slippageBps = BigInt(Math.floor(dashSlippage * 100));
                const BPS_MAX = 10000n;
                const amountOutMin = (amountOutExpected * (BPS_MAX - slippageBps)) / BPS_MAX;

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
            }

            await tx.wait();
            btn.textContent = "Success! 🦄";
            btn.style.background = "var(--success)";
            
            document.getElementById('dashAmountIn').value = "";
            document.getElementById('dashAmountOut').value = "";
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
})();