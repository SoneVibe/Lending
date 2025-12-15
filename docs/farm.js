// VIBE FARM LOGIC - GOD TIER FINAL (Liquidator Connect + Farm Actions)
let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let selectedProvider = null; 
let currentFarm = null;
let isStakeMode = true; 

// Variables globales para saldos
let balanceWallet = 0n;
let balanceStaked = 0n;

const getEl = (id) => document.getElementById(id);

// --- 1. UI HELPERS & NETWORK (COPIADO DE LIQUIDATOR) ---
const updateStatus = (connected) => {
  const dot = getEl('statusDot');
  const txt = getEl('connStatus');
  const btn = getEl('btnConnect');
  
  if(connected && userAddress) {
    dot.style.color = "var(--success)";
    txt.textContent = "Online";
    btn.textContent = userAddress.substring(0,6) + "..." + userAddress.substring(38);
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-connected');
    
    // Flechita para dropdown
    const arrow = document.createElement("span");
    arrow.textContent = "▼";
    arrow.style.fontSize = "0.7em";
    arrow.style.marginLeft = "6px";
    if (btn.lastChild && btn.lastChild.tagName === 'SPAN') btn.removeChild(btn.lastChild);
    btn.appendChild(arrow);
    
    getEl('dropdownAddress').textContent = userAddress.substring(0,8) + "..." + userAddress.substring(38);
  } else {
    dot.style.color = "var(--danger)";
    txt.textContent = "Disconnected";
    btn.textContent = "Connect Wallet";
    btn.className = "btn-primary";
    btn.style.background = "";
  }
};

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
    try {
        NETWORKS_DATA = await window.loadNetworks();
        initNetworkSelector();
        // Selección inicial de red
        ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == "1868" && n.enabled);
        if(ACTIVE && ACTIVE.farms) currentFarm = ACTIVE.farms[0];
        
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
        else {
            ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);
            if(ACTIVE && ACTIVE.farms) currentFarm = ACTIVE.farms[0];
        }
    };
}

// --- 2. WALLET MODAL & CONNECT (COPIADO DE LIQUIDATOR) ---
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

// Handlers Globales de Clic (Dropdown Logic)
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
if(btnConnect) {
    btnConnect.onclick = (e) => {
        e.stopPropagation();
        if(userAddress) { if (accountDropdown) accountDropdown.classList.toggle("show"); }
        else { openWalletModal(); }
    };
}

// Acciones del Dropdown
if(getEl("btnCopyAddress")) getEl("btnCopyAddress").onclick = () => { navigator.clipboard.writeText(userAddress); alert("Copied!"); };
if(getEl("btnViewExplorer")) getEl("btnViewExplorer").onclick = () => { if(ACTIVE) window.open(ACTIVE.blockExplorerUrls[0] + "/address/" + userAddress, '_blank'); };
if(getEl("btnDisconnect")) getEl("btnDisconnect").onclick = () => {
    if(window.SessionManager) window.SessionManager.clear();
    userAddress = null; signer = null; selectedProvider = null;
    updateStatus(false);
    accountDropdown.classList.remove("show");
    window.location.reload();
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
            let targetId = sel ? sel.value : null;
            if(!targetId) { const def = Object.values(NETWORKS_DATA).find(n => n.enabled); if(def) targetId = def.chainId; }
            if(targetId) { await switchNetwork(targetId); return; }
            else { alert("Unsupported Network."); updateStatus(false); return; }
        }
        if(sel && ACTIVE) sel.value = ACTIVE.chainId;
        if(ACTIVE.farms) currentFarm = ACTIVE.farms[0];

        updateStatus(true);
        
        // --- AQUÍ CONECTAMOS LA LÓGICA DE FARM ---
        await refreshFarmUI();

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

// --- 3. FARM LOGIC (TABS + ACTIONS) ---

window.setFarmMode = (mode) => {
    isStakeMode = (mode === 'stake');
    const tStake = getEl('tabStake');
    const tUnstake = getEl('tabUnstake');
    if(isStakeMode) {
        tStake.classList.add('active');
        tUnstake.classList.remove('active', 'unstake-mode');
        getEl('balLabel').textContent = "Wallet";
    } else {
        tStake.classList.remove('active');
        tUnstake.classList.add('active', 'unstake-mode');
        getEl('balLabel').textContent = "Staked";
    }
    getEl('stakeAmount').value = "";
    refreshFarmUI();
};

async function refreshFarmUI() {
    if(!signer || !ACTIVE || !currentFarm || !ACTIVE.masterChef) return;

    try {
        const masterChef = new ethers.Contract(ACTIVE.masterChef, window.MASTERCHEF_ABI, provider);
        const lpToken = new ethers.Contract(currentFarm.lpToken, window.MIN_ERC20_ABI, provider);

        const [userInfo, pending, lpBalance, allowance] = await Promise.all([
            masterChef.userInfo(currentFarm.pid, userAddress),
            masterChef.pendingLight(currentFarm.pid, userAddress), 
            lpToken.balanceOf(userAddress),
            lpToken.allowance(userAddress, ACTIVE.masterChef)
        ]);

        balanceStaked = userInfo.amount;
        balanceWallet = lpBalance;

        getEl("userStaked").textContent = parseFloat(ethers.formatEther(balanceStaked)).toFixed(4);
        getEl("userEarned").textContent = parseFloat(ethers.formatEther(pending)).toFixed(4);
        
        // Update Available based on Mode
        if(isStakeMode) {
            getEl("walletLP").textContent = parseFloat(ethers.formatEther(balanceWallet)).toFixed(4);
        } else {
            getEl("walletLP").textContent = parseFloat(ethers.formatEther(balanceStaked)).toFixed(4);
        }

        // Button Logic
        const btnMain = getEl("btnMainAction");
        const inputVal = getEl("stakeAmount").value;
        const amountWei = inputVal ? ethers.parseEther(inputVal) : 0n;

        // Reset click listeners
        const newBtn = btnMain.cloneNode(true);
        btnMain.parentNode.replaceChild(newBtn, btnMain);
        const finalBtn = getEl("btnMainAction");

        if (isStakeMode) {
            if (allowance < amountWei && amountWei > 0n) {
                finalBtn.textContent = "Approve LP";
                finalBtn.className = "btn-primary";
                finalBtn.onclick = () => handleApprove();
            } else {
                finalBtn.textContent = "Stake";
                finalBtn.className = "btn-primary";
                finalBtn.onclick = () => handleDeposit();
            }
        } else {
            finalBtn.textContent = "Unstake";
            finalBtn.className = "btn-primary";
            finalBtn.onclick = () => handleWithdraw();
        }

        const btnHarvest = getEl("btnHarvest");
        if(pending > 0n) {
            btnHarvest.disabled = false;
            btnHarvest.style.opacity = "1";
            btnHarvest.style.cursor = "pointer";
        } else {
            btnHarvest.disabled = true;
            btnHarvest.style.opacity = "0.5";
            btnHarvest.style.cursor = "not-allowed";
        }

    } catch(e) { console.error("Farm Data Error:", e); }
}

// Actions
async function handleApprove() {
    if(!signer) return;
    const btn = getEl("btnMainAction");
    try {
        btn.textContent = "Approving...";
        const lpToken = new ethers.Contract(currentFarm.lpToken, window.MIN_ERC20_ABI, signer);
        const tx = await lpToken.approve(ACTIVE.masterChef, ethers.MaxUint256);
        await tx.wait();
        await refreshFarmUI();
    } catch(e) { console.error(e); btn.textContent = "Failed"; }
}

async function handleDeposit() {
    if(!signer) return;
    const val = getEl("stakeAmount").value;
    if(!val) return;
    const btn = getEl("btnMainAction");
    try {
        btn.textContent = "Staking...";
        const master = new ethers.Contract(ACTIVE.masterChef, window.MASTERCHEF_ABI, signer);
        const tx = await master.deposit(currentFarm.pid, ethers.parseEther(val));
        await tx.wait();
        getEl("stakeAmount").value = "";
        await refreshFarmUI();
    } catch(e) { console.error(e); btn.textContent = "Failed"; }
}

async function handleWithdraw() {
    if(!signer) return;
    const val = getEl("stakeAmount").value;
    if(!val) return;
    const btn = getEl("btnMainAction");
    try {
        btn.textContent = "Withdrawing...";
        const master = new ethers.Contract(ACTIVE.masterChef, window.MASTERCHEF_ABI, signer);
        const tx = await master.withdraw(currentFarm.pid, ethers.parseEther(val));
        await tx.wait();
        getEl("stakeAmount").value = "";
        await refreshFarmUI();
    } catch(e) { console.error(e); btn.textContent = "Failed"; }
}

async function handleHarvest() {
    if(!signer) return;
    const btn = getEl("btnHarvest");
    try {
        btn.textContent = "Harvesting...";
        const master = new ethers.Contract(ACTIVE.masterChef, window.MASTERCHEF_ABI, signer);
        const tx = await master.deposit(currentFarm.pid, 0); 
        await tx.wait();
        await refreshFarmUI();
    } catch(e) { console.error(e); btn.textContent = "Failed"; }
}

const btnMax = getEl("btnMax");
if(btnMax) {
    btnMax.onclick = () => {
        if(!userAddress) return;
        const amt = isStakeMode ? balanceWallet : balanceStaked;
        getEl("stakeAmount").value = ethers.formatEther(amt);
        refreshFarmUI();
    };
}

getEl("stakeAmount").addEventListener("input", refreshFarmUI);