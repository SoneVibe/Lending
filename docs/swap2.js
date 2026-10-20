let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let selectedProvider = null;
let isEthToToken = true;

const getEl = (id) => document.getElementById(id);

// --- TAB SWITCHER ---
window.setTab = (tab) => {
    document.querySelectorAll('.swap-tab').forEach(t => t.classList.remove('active'));
    if(tab === 'swap') {
        const t1 = document.querySelectorAll('.swap-tab')[0];
        if(t1) t1.classList.add('active');
        getEl('swapPanel').style.display = 'block';
        getEl('zapPanel').style.display = 'none';
    } else {
        const t2 = document.querySelectorAll('.swap-tab')[1];
        if(t2) t2.classList.add('active');
        getEl('swapPanel').style.display = 'none';
        getEl('zapPanel').style.display = 'block';
    }
};

// --- INIT APP ---
document.addEventListener("DOMContentLoaded", initSwapApp);

async function initSwapApp() {
    try {
        NETWORKS_DATA = await window.loadNetworks();
        initNetworkSelector();
        
        // Auto-select Soneium by default
        ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == "1868" && n.enabled);
        
        if(window.checkAutoConnect) {
            await window.checkAutoConnect(connectWallet);
        }
    } catch(e) { console.error("Init Error:", e); }
}

// --- NETWORK SELECTOR (Definida explícitamente para evitar ReferenceError) ---
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
        }
    };
}

// --- WALLET HELPERS ---
function updateStatus(connected) {
  const dot = getEl('statusDot');
  const txt = getEl('connStatus');
  const btn = getEl('btnConnect');
  const btnSwap = getEl('btnSwapAction');
  
  if(connected && userAddress) {
    if(dot) dot.style.color = "var(--success)";
    if(txt) txt.textContent = "Online";
    
    if(btn) {
        btn.textContent = userAddress.substring(0,6) + "...";
        btn.classList.add('btn-connected');
    }
    
    const dropdown = getEl('dropdownAddress');
    if(dropdown) dropdown.textContent = userAddress;

    // Actualizar botón de Swap también
    if(btnSwap) {
        btnSwap.textContent = "Swap";
        btnSwap.classList.remove('btn-primary'); // Opcional, mantener estilo
    }

  } else {
    if(dot) dot.style.color = "var(--danger)";
    if(txt) txt.textContent = "Disconnected";
    if(btn) {
        btn.textContent = "Connect Wallet";
        btn.classList.remove('btn-connected');
    }
    if(btnSwap) btnSwap.textContent = "Connect Wallet";
  }
};

// --- CONNECT WALLET ---
async function connectWallet() {
  const ethProvider = window.ethereum; // Simplificado para demo
  if (!ethProvider) { alert("Install MetaMask"); return; }
  
  try {
    provider = new ethers.BrowserProvider(ethProvider);
    if(!NETWORKS_DATA) NETWORKS_DATA = await window.loadNetworks();
    
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    
    // Identificar Red
    const chainIdHex = await provider.send("eth_chainId", []);
    const chainIdDecimal = parseInt(chainIdHex, 16);
    ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === chainIdDecimal) && n.enabled);
    
    const sel = getEl("networkSelect");
    if(!ACTIVE) {
        alert("Wrong Network. Please switch.");
        return;
    }
    if(sel) sel.value = ACTIVE.chainId;

    updateStatus(true);
    await updateBalances(); // <--- Aquí llamamos a la función problemática
    
  } catch (e) {
    console.error("Connection Error:", e);
    updateStatus(false);
  }
}

// --- UPDATE BALANCES (CORREGIDA Y BLINDADA) ---
async function updateBalances() {
    if(!signer || !ACTIVE) return;
    
    try {
        // 1. Balance ETH
        const ethBal = await provider.getBalance(userAddress);
        const ethFmt = parseFloat(ethers.formatEther(ethBal)).toFixed(4);
        
        // 2. Balance Token (LIGHT)
        // OJO: Asegúrate que esta dirección está bien en tu código
        const LIGHT = "0x957E619104a03552d767430F2F9a2D17C847310d"; 
        const token = new ethers.Contract(LIGHT, window.MIN_ERC20_ABI, provider);
        const tokenBal = await token.balanceOf(userAddress);
        const tokenFmt = parseFloat(ethers.formatEther(tokenBal)).toFixed(2);
        
        // 3. Actualizar DOM (Con verificaciones de nulidad)
        const elBalIn = getEl('balIn');
        const elBalOut = getEl('balOut');
        const elZapBal = getEl('zapBal');

        if(elBalIn) {
            elBalIn.textContent = isEthToToken ? ethFmt : tokenFmt;
        }
        if(elBalOut) {
            elBalOut.textContent = isEthToToken ? tokenFmt : ethFmt;
        }
        if(elZapBal) {
            elZapBal.textContent = ethFmt;
        }

    } catch(e) {
        console.error("Balance Error", e);
    }
}

// --- UI INTERACTIONS ---
// Wallet Modal (Simplificado)
window.openWalletModal = () => getEl('walletModal').style.display = 'flex';
window.closeWalletModal = () => getEl('walletModal').style.display = 'none';
getEl('btnConnect').onclick = async () => {
    if(userAddress) getEl('accountDropdown').classList.toggle('show');
    else await connectWallet();
};

// --- SWAP LOGIC ---
const amountIn = getEl('amountIn');
const amountOut = getEl('amountOut');
const btnSwap = getEl('btnSwapAction');

if(amountIn) {
    amountIn.addEventListener('input', async () => {
        const val = amountIn.value;
        if(!val || parseFloat(val) === 0 || !ACTIVE.router) {
            if(amountOut) amountOut.value = "";
            return;
        }
        
        try {
            const router = new ethers.Contract(ACTIVE.router, window.ROUTER_ABI, provider);
            const WETH = "0x4200000000000000000000000000000000000006"; 
            const LIGHT = "0x957E619104a03552d767430F2F9a2D17C847310d"; 
            
            const path = isEthToToken ? [WETH, LIGHT] : [LIGHT, WETH];
            const amountWei = ethers.parseEther(val);
            
            const amounts = await router.getAmountsOut(amountWei, path);
            const outFmt = ethers.formatEther(amounts[1]);
            
            if(amountOut) amountOut.value = parseFloat(outFmt).toFixed(4);
            if(getEl('swapDetails')) getEl('swapDetails').style.display = 'block';
            if(getEl('priceDisplay')) getEl('priceDisplay').innerText = `1 ${isEthToToken?'ETH':'LIGHT'} = ${(parseFloat(outFmt)/parseFloat(val)).toFixed(4)}`;
            
            if(btnSwap) {
                btnSwap.textContent = "Swap";
                btnSwap.disabled = false;
            }
            
        } catch(e) {
            console.log("Quote Error (Low Liquidity?)", e);
            if(amountOut) amountOut.value = "0.0";
            if(btnSwap) btnSwap.disabled = true;
        }
    });
}

if(getEl('btnSwitch')) {
    getEl('btnSwitch').onclick = () => {
        isEthToToken = !isEthToToken;
        const inL = getEl('tokenInBtn').innerHTML;
        const outL = getEl('tokenOutBtn').innerHTML;
        getEl('tokenInBtn').innerHTML = outL;
        getEl('tokenOutBtn').innerHTML = inL;
        amountIn.value = "";
        amountOut.value = "";
        updateBalances(); // Recargar balances al invertir
    };
}

if(btnSwap) {
    btnSwap.onclick = async () => {
        if(!signer) { await connectWallet(); return; }
        // ... (Tu lógica de ejecución de swap existente) ...
        const val = amountIn.value;
        if(!val) return;
        
        try {
            const router = new ethers.Contract(ACTIVE.router, window.ROUTER_ABI, signer);
            const WETH = "0x4200000000000000000000000000000000000006";
            const LIGHT = "0x957E619104a03552d767430F2F9a2D17C847310d"; 
            
            const amountWei = ethers.parseEther(val);
            const deadline = Math.floor(Date.now() / 1000) + 600;
            const path = isEthToToken ? [WETH, LIGHT] : [LIGHT, WETH];
            
            getEl('swapStatus').innerText = "Processing...";
            
            let tx;
            if(isEthToToken) {
                // ETH -> Token
                tx = await router.swapExactETHForTokens(0, path, userAddress, deadline, { value: amountWei });
            } else {
                // Token -> ETH
                const token = new ethers.Contract(LIGHT, window.MIN_ERC20_ABI, signer);
                const allow = await token.allowance(userAddress, ACTIVE.router);
                if(allow < amountWei) {
                    getEl('swapStatus').innerText = "Approving Token...";
                    const txApp = await token.approve(ACTIVE.router, ethers.MaxUint256);
                    await txApp.wait();
                }
                getEl('swapStatus').innerText = "Swapping...";
                tx = await router.swapExactTokensForETH(amountWei, 0, path, userAddress, deadline);
            }
            
            await tx.wait();
            getEl('swapStatus').innerText = "Swap Successful! 🚀";
            getEl('swapStatus').style.color = "var(--success)";
            updateBalances();
            
        } catch(e) {
            getEl('swapStatus').innerText = "Failed: " + (e.shortMessage || e.message);
            getEl('swapStatus').style.color = "var(--danger)";
        }
    };
}

// --- ZAP LOGIC (CORREGIDA: Comprobamos si el elemento existe) ---
const zapInput = getEl('zapAmount');
if(zapInput) {
    zapInput.addEventListener('input', () => {
        const val = zapInput.value;
        if(val && parseFloat(val) > 0) {
            // Estimación Dummy visual (Multiplica por 1000)
            // En prod usarías el router para calcular el LP value real
            if(getEl('zapEstOut')) getEl('zapEstOut').innerText = (parseFloat(val) * 1000).toFixed(2);
            if(getEl('btnZapAction')) getEl('btnZapAction').disabled = false;
        }
    });
}

const btnZap = getEl('btnZapAction');
if(btnZap) {
    btnZap.onclick = async () => {
        if(!signer) { await connectWallet(); return; }
        if(!ACTIVE.zap) { alert("Zap contract not configured for this network"); return; }
        
        try {
            const zap = new ethers.Contract(ACTIVE.zap, window.ZAP_ABI, signer);
            const LIGHT = "0x957E619104a03552d767430F2F9a2D17C847310d"; 
            const val = ethers.parseEther(zapInput.value);
            
            getEl('zapStatus').innerText = "Zapping...";
            const tx = await zap.zapInETH(LIGHT, 0, { value: val });
            await tx.wait();
            getEl('zapStatus').innerText = "Zap Successful! You have LP.";
            getEl('zapStatus').style.color = "var(--success)";
        } catch(e) {
            console.error(e);
            getEl('zapStatus').innerText = "Zap Failed: " + (e.shortMessage || e.message);
            getEl('zapStatus').style.color = "var(--danger)";
        }
    };
}

// Helper para cambiar red
async function switchNetwork(targetChainId) {
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: "0x" + Number(targetChainId).toString(16) }],
        });
        window.location.reload();
    } catch (e) { console.error(e); }
}
