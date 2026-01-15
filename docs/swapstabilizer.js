let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let selectedProvider = null;
let hsmContract = null;
let svusdContract = null;
let reserveContract = null;

// Module State
let isMintMode = true; // true = USDC->SVUSD, false = SVUSD->USDC
let feeIn = 0;
let feeOut = 0;
let reserveDecimals = 6;
let reserveAddress = "";
let svusdAddress = "";

const getEl = (id) => document.getElementById(id);

// --- UI HELPERS ---
const updateStatus = (connected) => {
  const dot = getEl('statusDot');
  const txt = getEl('connStatus');
  const btn = getEl('btnConnect');
  const actionBtn = getEl('btnActionSwap');
  
  if(connected && userAddress) {
    dot.style.color = "var(--success)";
    txt.textContent = "Online";
    btn.textContent = userAddress.substring(0,6) + "..." + userAddress.substring(38);
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-connected');
    
    // Dropdown logic
    const arrow = document.createElement("span");
    arrow.textContent = "▼";
    arrow.style.fontSize = "0.7em";
    arrow.style.marginLeft = "6px";
    if (btn.lastChild && btn.lastChild.tagName === 'SPAN') btn.removeChild(btn.lastChild);
    btn.appendChild(arrow);
    getEl('dropdownAddress').textContent = userAddress.substring(0,8) + "..." + userAddress.substring(38);
    
    actionBtn.textContent = "Loading Data...";
    refreshData();
  } else {
    dot.style.color = "var(--danger)";
    txt.textContent = "Disconnected";
    btn.textContent = "Connect Wallet";
    btn.className = "btn-primary";
    btn.style.background = "";
    actionBtn.textContent = "Connect Wallet";
    actionBtn.onclick = openWalletModal;
  }
};

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
    try {
        NETWORKS_DATA = await window.loadNetworks();
        initNetworkSelector();
        // Default to Soneium or first enabled
        ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == "1868" && n.enabled);
        
        // Input Listeners
        getEl("inputAmount").addEventListener("input", calculateOutput);
        getEl("balanceIn").onclick = setMaxInput;
        
        if(window.checkAutoConnect) await window.checkAutoConnect(connectWallet);
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
        else ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);
    };
}

// --- MODE SWITCHING ---
window.setMode = (mode) => {
    isMintMode = (mode === 'mint');
    
    // Update Tabs
    getEl("tabMint").className = isMintMode ? "swap-tab active" : "swap-tab";
    getEl("tabRedeem").className = !isMintMode ? "swap-tab active" : "swap-tab";
    
    // Update Tokens Labels
    getEl("tokenInName").textContent = isMintMode ? "USDC" : "SVUSD";
    getEl("tokenInBadge").querySelector("span").textContent = isMintMode ? "💲" : "⚡";
    
    getEl("tokenOutName").textContent = !isMintMode ? "USDC" : "SVUSD";
    getEl("tokenOutBadge").querySelector("span").textContent = !isMintMode ? "💲" : "⚡";

    // Clear Inputs
    getEl("inputAmount").value = "";
    getEl("outputAmount").value = "";
    getEl("feeAmount").textContent = "0.00";

    // Refresh Balances Display if connected
    if(userAddress) refreshBalances();
    
    // Update Button Text
    const btn = getEl("btnActionSwap");
    if(userAddress) {
        btn.textContent = isMintMode ? "Approve & Mint" : "Redeem USDC";
    }
};

// --- WALLET CONNECT ---
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

const btnConnect = getEl("btnConnect");
const accountDropdown = getEl("accountDropdown");
btnConnect.onclick = (e) => {
    e.stopPropagation();
    if(userAddress) { if (accountDropdown) accountDropdown.classList.toggle("show"); }
    else { openWalletModal(); }
};
getEl("btnCopyAddress").onclick = () => { navigator.clipboard.writeText(userAddress); alert("Copied!"); };
getEl("btnViewExplorer").onclick = () => { if(ACTIVE) window.open(ACTIVE.blockExplorerUrls[0] + "/address/" + userAddress, '_blank'); };
getEl("btnDisconnect").onclick = () => {
    if(window.SessionManager) window.SessionManager.clear();
    userAddress = null; signer = null; selectedProvider = null;
    updateStatus(false);
    accountDropdown.classList.remove("show");
};

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
        
        if(window.SessionManager) window.SessionManager.save();
        
        const chainIdHex = await provider.send("eth_chainId", []);
        const chainIdDecimal = parseInt(chainIdHex, 16);
        ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === chainIdDecimal) && n.enabled);
        
        const sel = getEl("networkSelect");
        if(!ACTIVE) {
             alert("Unsupported Network. Please switch to Soneium."); 
             updateStatus(false); 
             return; 
        }
        if(sel && ACTIVE) sel.value = ACTIVE.chainId;
        
        // Initialize Contracts
        if(!ACTIVE.stabilityModule) {
            console.error("Stability Module address missing in config");
            alert("Stability module not configured for this network");
            return;
        }

        hsmContract = new ethers.Contract(ACTIVE.stabilityModule, window.STABILITY_ABI, provider);
        
        // Load basic info to init other contracts
        reserveAddress = await hsmContract.reserveAsset();
        svusdAddress = await hsmContract.svusd();
        
        svusdContract = new ethers.Contract(svusdAddress, window.ERC20_ABI, provider);
        reserveContract = new ethers.Contract(reserveAddress, window.ERC20_ABI, provider);

        updateStatus(true);
        
        if(ethProvider.on) {
             ethProvider.on('chainChanged', () => window.location.reload());
             ethProvider.on('accountsChanged', () => window.location.reload());
        }
    } catch(e) { console.error(e); updateStatus(false); }
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

// --- CORE STABILIZER LOGIC ---

async function refreshData() {
    if(!hsmContract) return;
    try {
        const [fIn, fOut, cap, paused, decimals] = await Promise.all([
            hsmContract.feeIn(),
            hsmContract.feeOut(),
            hsmContract.reserveCap(),
            hsmContract.paused(),
            hsmContract.reserveDecimals()
        ]);

        feeIn = Number(fIn);
        feeOut = Number(fOut);
        reserveDecimals = Number(decimals);
        
        getEl("systemStatus").textContent = paused ? "PAUSED 🔴" : "ACTIVE 🟢";
        getEl("systemStatus").style.color = paused ? "var(--danger)" : "var(--success)";
        
        // Reserve Data
        const currentReserveBal = await reserveContract.balanceOf(ACTIVE.stabilityModule);
        const capFormatted = ethers.formatUnits(cap, reserveDecimals);
        const currentFormatted = ethers.formatUnits(currentReserveBal, reserveDecimals);
        const available = Number(capFormatted) - Number(currentFormatted);
        
        getEl("reserveCapacity").textContent = `${Number(currentFormatted).toLocaleString()} / ${Number(capFormatted).toLocaleString()} USDC`;
        getEl("reserveAvailable").textContent = `Available space: ${available.toLocaleString()} USDC`;
        
        // Update Fees Display based on current mode
        updateFeeDisplay();
        refreshBalances();

    } catch(e) { console.error("Data Refresh Error", e); }
}

function updateFeeDisplay() {
    const currentFee = isMintMode ? feeIn : feeOut;
    getEl("feePercent").textContent = (currentFee / 100).toFixed(2);
    getEl("feeDisplay").textContent = `${(currentFee / 100).toFixed(2)}%`;
}

async function refreshBalances() {
    if(!userAddress) return;
    
    // Balance In (Source)
    if(isMintMode) {
        // Minting: Check USDC Balance
        const bal = await reserveContract.balanceOf(userAddress);
        getEl("balanceIn").textContent = `Balance: ${Number(ethers.formatUnits(bal, reserveDecimals)).toFixed(2)}`;
        getEl("balanceOut").textContent = `Balance: ...`; // Destination
    } else {
        // Redeeming: Check SVUSD Balance
        const bal = await svusdContract.balanceOf(userAddress);
        getEl("balanceIn").textContent = `Balance: ${Number(ethers.formatUnits(bal, 18)).toFixed(2)}`;
        getEl("balanceOut").textContent = `Balance: ...`;
    }
    
    // Balance Out (Destination) - fetch async
    if(isMintMode) {
         const bal = await svusdContract.balanceOf(userAddress);
         getEl("balanceOut").textContent = `Balance: ${Number(ethers.formatUnits(bal, 18)).toFixed(2)}`;
    } else {
         const bal = await reserveContract.balanceOf(userAddress);
         getEl("balanceOut").textContent = `Balance: ${Number(ethers.formatUnits(bal, reserveDecimals)).toFixed(2)}`;
    }
}

async function setMaxInput() {
    if(!userAddress) return;
    const inputEl = getEl("inputAmount");
    
    if(isMintMode) {
        const bal = await reserveContract.balanceOf(userAddress);
        inputEl.value = ethers.formatUnits(bal, reserveDecimals);
    } else {
        const bal = await svusdContract.balanceOf(userAddress);
        inputEl.value = ethers.formatUnits(bal, 18);
    }
    calculateOutput();
}

function calculateOutput() {
    const inputVal = parseFloat(getEl("inputAmount").value);
    if(isNaN(inputVal) || inputVal <= 0) {
        getEl("outputAmount").value = "";
        getEl("feeAmount").textContent = "0.00";
        return;
    }

    const currentFeeBps = isMintMode ? feeIn : feeOut;
    const feeAmount = inputVal * (currentFeeBps / 10000);
    const outputAmount = inputVal - feeAmount;

    getEl("outputAmount").value = outputAmount.toFixed(4);
    getEl("feeAmount").textContent = feeAmount.toFixed(4);
    
    // Update Button
    updateMainButton(inputVal);
}

async function updateMainButton(inputVal) {
    const btn = getEl("btnActionSwap");
    btn.onclick = executeSwap;
    
    if(isMintMode) {
        // Check Allowance for USDC
        const reserveWithSigner = reserveContract.connect(signer);
        const allowance = await reserveWithSigner.allowance(userAddress, ACTIVE.stabilityModule);
        const amountRaw = ethers.parseUnits(inputVal.toString(), reserveDecimals);
        
        if(allowance < amountRaw) {
            btn.textContent = "Approve USDC";
            btn.dataset.action = "approve";
        } else {
            btn.textContent = "Mint SVUSD";
            btn.dataset.action = "swap";
        }
    } else {
        // Selling SVUSD typically doesn't need approval if burn is handled internally or via permit,
        // but SVUSD is standard ERC20 in logic here for user -> contract.
        // Wait, Stability module calls burn(msg.sender).
        // Since Stability Module is a Facilitator, it can burn WITHOUT allowance in the custom SVUSD contract.
        // So no approval needed for SVUSD sell.
        btn.textContent = "Redeem USDC";
        btn.dataset.action = "swap";
    }
}

async function executeSwap() {
    const btn = getEl("btnActionSwap");
    const inputVal = getEl("inputAmount").value;
    const status = getEl("txStatus");
    
    if(!inputVal || parseFloat(inputVal) <= 0) return;
    
    btn.disabled = true;
    status.textContent = "Processing...";
    status.style.color = "var(--warning)";

    try {
        const hsmWithSigner = hsmContract.connect(signer);
        
        if(isMintMode) {
            // BUY SVUSD
            if(btn.dataset.action === "approve") {
                status.textContent = "Approving USDC...";
                const resWithSigner = reserveContract.connect(signer);
                const tx = await resWithSigner.approve(ACTIVE.stabilityModule, ethers.MaxUint256);
                await tx.wait();
                status.textContent = "Approved! Calculating...";
                await updateMainButton(inputVal); // Refresh button state
                btn.disabled = false;
                return;
            }
            
            status.textContent = "Minting SVUSD...";
            const amountRaw = ethers.parseUnits(inputVal, reserveDecimals);
            const tx = await hsmWithSigner.buySVUSD(amountRaw);
            await tx.wait();
            
        } else {
            // SELL SVUSD
            status.textContent = "Redeeming USDC...";
            const amountRaw = ethers.parseUnits(inputVal, 18);
            const tx = await hsmWithSigner.sellSVUSD(amountRaw);
            await tx.wait();
        }

        status.textContent = "Transaction Successful! 🎉";
        status.style.color = "var(--success)";
        
        // Refresh UI
        getEl("inputAmount").value = "";
        getEl("outputAmount").value = "";
        refreshData();
        
    } catch(e) {
        console.error(e);
        status.textContent = "Error: " + (e.reason || e.message || "Transaction Failed");
        status.style.color = "var(--danger)";
    } finally {
        btn.disabled = false;
        setTimeout(() => { 
            if(status.textContent.includes("Success")) status.textContent = ""; 
        }, 5000);
    }
}
