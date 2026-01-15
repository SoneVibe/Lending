// VIBE SOUS CHEF - GOD TIER (LIQUIDATOR CORE)
let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let selectedProvider = null; 

// Estado para multiples pools: { 0: { mode: 'stake', balance: 0, staked: 0 }, 1: ... }
let poolsState = {};

const getEl = (id) => document.getElementById(id);

// --- UI HELPERS (LIQUIDATOR STYLE) ---
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
    
    if(!btn.querySelector('span')) {
        const arrow = document.createElement("span");
        arrow.textContent = "▼";
        arrow.style.fontSize = "0.7em";
        arrow.style.marginLeft = "6px";
        btn.appendChild(arrow);
    }
    getEl('dropdownAddress').textContent = userAddress.substring(0,8) + "..." + userAddress.substring(38);
  } else {
    dot.style.color = "var(--danger)";
    txt.textContent = "Disconnected";
    btn.textContent = "Connect Wallet";
    btn.className = "btn-primary";
    btn.style.background = "";
    if (btn.lastChild && btn.lastChild.tagName === 'SPAN') btn.removeChild(btn.lastChild);
  }
};

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
    try {
        NETWORKS_DATA = await window.loadNetworks();
        initNetworkSelector();
        if (window.ethereum) {
            const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
            ACTIVE = Object.values(NETWORKS_DATA).find(n => parseInt(n.chainId) === parseInt(chainIdHex, 16));
        }
        if(!ACTIVE) ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == "1868" && n.enabled);
        
        // Init State for Pools
        if(ACTIVE && ACTIVE.sousChefs) {
            ACTIVE.sousChefs.forEach(pool => {
                poolsState[pool.id] = { mode: 'stake', balance: 0n, staked: 0n, allowance: 0n };
            });
        }

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
    if(ACTIVE) sel.value = ACTIVE.chainId;
    sel.onchange = async (e) => {
        const targetChainId = e.target.value;
        if(userAddress) await switchNetwork(targetChainId);
        else ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);
    };
}

// --- WALLET CONNECT (CORE ESTABLE) ---
function openWalletModal() {
    const modal = getEl('walletModal');
    const list = getEl('walletList');
    if (!modal || !list) return;
    list.innerHTML = ''; 
    if (window.WALLET_CONFIG) {
        window.WALLET_CONFIG.forEach(w => {
            const btn = document.createElement('div');
            btn.className = 'wallet-btn';
            btn.innerHTML = `<div class="wallet-info"><img src="${w.icon}" alt="${w.name}" style="width:32px; height:32px; object-fit:contain;"><span>${w.name}</span></div><span style="color:var(--success)">›</span>`;
            btn.onclick = async () => {
                if(!w.check()) { window.open(w.installUrl, '_blank'); return; }
                selectedProvider = w.getProvider();
                closeWalletModal();
                await connectWallet();
            };
            list.appendChild(btn);
        });
    }
    modal.classList.add('open');
}
window.closeWalletModal = () => getEl('walletModal').classList.remove('open');
window.onclick = (e) => {
    const modal = getEl('walletModal');
    if (e.target === modal) closeWalletModal();
    const accountDropdown = getEl("accountDropdown");
    if (accountDropdown && accountDropdown.classList.contains('show') && !e.target.closest('#btnConnect')) accountDropdown.classList.remove('show');
};

const btnConnect = getEl("btnConnect");
const accountDropdown = getEl("accountDropdown");
if(btnConnect) {
    btnConnect.onclick = (e) => {
        e.stopPropagation();
        if(userAddress) accountDropdown.classList.toggle("show"); else openWalletModal();
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
    if (!ethProvider) { alert("Install Wallet"); return; }
    getEl("btnConnect").textContent = "Connecting...";
    try {
        provider = new ethers.BrowserProvider(ethProvider);
        if(!NETWORKS_DATA) NETWORKS_DATA = await window.loadNetworks();
        await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        if(window.SessionManager) window.SessionManager.save();
        
        // Refresh Network
        const chainIdHex = await provider.send("eth_chainId", []);
        ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === parseInt(chainIdHex, 16)) && n.enabled);
        
        updateStatus(true);
        await refreshPools(); // Load Data

        if(ethProvider.on) {
             ethProvider.on('chainChanged', () => window.location.reload());
             ethProvider.on('accountsChanged', () => window.location.reload());
        }
    } catch(e) { console.error(e); updateStatus(false); }
}

async function switchNetwork(targetChainId) {
    try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: "0x" + Number(targetChainId).toString(16) }] }); } catch (e) {
        if(e.code === 4902) try { /* Logic to add chain */ } catch(err) {}
    }
}

// =========================================================
// === SOUS CHEF LOGIC (MULTI POOL) ========================
// =========================================================

window.setPoolMode = (poolId, mode, btnElement) => {
    if(!poolsState[poolId]) poolsState[poolId] = {};
    poolsState[poolId].mode = mode;
    
    // UI Visuals
    const parent = btnElement.parentElement;
    parent.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active', 'unstake-mode'));
    btnElement.classList.add('active');
    if(mode === 'unstake') btnElement.classList.add('unstake-mode');
    
    // Clear Input
    const card = getEl(`pool-${poolId}`);
    card.querySelector('.pool-input').value = "";
    
    refreshPoolUI(poolId);
};

async function refreshPools() {
    if(!signer || !ACTIVE || !ACTIVE.sousChefs) return;
    for(let pool of ACTIVE.sousChefs) {
        await fetchPoolData(pool);
    }
}

async function fetchPoolData(pool) {
    try {
        const contract = new ethers.Contract(pool.contract, window.SOUSCHEF_ABI, provider);
        const stakeToken = new ethers.Contract(pool.stakeToken, window.MIN_ERC20_ABI, provider);
        
        const [userInfo, pending, balance, allowance] = await Promise.all([
            contract.userInfo(userAddress),
            contract.pendingReward(userAddress),
            stakeToken.balanceOf(userAddress),
            stakeToken.allowance(userAddress, pool.contract)
        ]);

        // Guardar estado
        if(!poolsState[pool.id]) poolsState[pool.id] = { mode: 'stake' };
        poolsState[pool.id].staked = userInfo.amount;
        poolsState[pool.id].balance = balance;
        poolsState[pool.id].allowance = allowance;
        poolsState[pool.id].pending = pending;

        // Renderizar UI
        const card = getEl(`pool-${pool.id}`);
        if(card) {
            card.querySelector('.val-earned').textContent = parseFloat(ethers.formatEther(pending)).toFixed(4);
            card.querySelector('.val-staked').textContent = parseFloat(ethers.formatEther(userInfo.amount)).toFixed(4);
            
            const btnHarvest = card.querySelector('.btn-harvest');
            if(pending > 0n) {
                btnHarvest.disabled = false;
                btnHarvest.style.opacity = "1";
                btnHarvest.style.cursor = "pointer";
            } else {
                btnHarvest.disabled = true;
                btnHarvest.style.opacity = "0.5";
            }
            
            refreshPoolUI(pool.id);
        }

    } catch(e) { console.error(`Error pool ${pool.id}`, e); }
}

function refreshPoolUI(poolId) {
    const state = poolsState[poolId];
    const card = getEl(`pool-${poolId}`);
    const btnAction = card.querySelector('.btn-action');
    const valWallet = card.querySelector('.val-wallet');
    const inputVal = card.querySelector('.pool-input').value;
    const amountWei = inputVal ? ethers.parseEther(inputVal) : 0n;

    if(state.mode === 'stake') {
        valWallet.textContent = parseFloat(ethers.formatEther(state.balance)).toFixed(4);
        
        if (state.allowance < amountWei && amountWei > 0n) {
            btnAction.textContent = "Approve LIGHT";
            btnAction.style.background = "";
            btnAction.onclick = () => handleApprove(poolId);
        } else {
            btnAction.textContent = "Stake";
            btnAction.style.background = "";
            btnAction.onclick = () => handleStake(poolId);
        }
    } else {
        // Unstake Mode
        valWallet.textContent = parseFloat(ethers.formatEther(state.staked)).toFixed(4);
        btnAction.textContent = "Unstake";
        btnAction.style.background = "var(--danger)";
        btnAction.onclick = () => handleUnstake(poolId);
    }
}

// --- ACTIONS ---

window.handleApprove = async (poolId) => {
    if(!signer) return;
    const pool = ACTIVE.sousChefs.find(p => p.id === poolId);
    const card = getEl(`pool-${poolId}`);
    const btn = card.querySelector('.btn-action');
    try {
        btn.textContent = "Approving...";
        const token = new ethers.Contract(pool.stakeToken, window.MIN_ERC20_ABI, signer);
        const tx = await token.approve(pool.contract, ethers.MaxUint256);
        await tx.wait();
        await fetchPoolData(pool);
    } catch(e) { console.error(e); btn.textContent = "Failed"; }
};

window.handleStake = async (poolId) => {
    if(!signer) return;
    const pool = ACTIVE.sousChefs.find(p => p.id === poolId);
    const card = getEl(`pool-${poolId}`);
    const val = card.querySelector('.pool-input').value;
    const btn = card.querySelector('.btn-action');
    if(!val) return;

    try {
        btn.textContent = "Staking...";
        const contract = new ethers.Contract(pool.contract, window.SOUSCHEF_ABI, signer);
        const tx = await contract.deposit(ethers.parseEther(val));
        await tx.wait();
        card.querySelector('.pool-input').value = "";
        await fetchPoolData(pool);
    } catch(e) { console.error(e); btn.textContent = "Failed"; }
};

window.handleUnstake = async (poolId) => {
    if(!signer) return;
    const pool = ACTIVE.sousChefs.find(p => p.id === poolId);
    const card = getEl(`pool-${poolId}`);
    const val = card.querySelector('.pool-input').value;
    const btn = card.querySelector('.btn-action');
    if(!val) return;

    try {
        btn.textContent = "Unstaking...";
        const contract = new ethers.Contract(pool.contract, window.SOUSCHEF_ABI, signer);
        const tx = await contract.withdraw(ethers.parseEther(val));
        await tx.wait();
        card.querySelector('.pool-input').value = "";
        await fetchPoolData(pool);
    } catch(e) { console.error(e); btn.textContent = "Failed"; }
};

window.handleHarvest = async (poolId) => {
    if(!signer) return;
    const pool = ACTIVE.sousChefs.find(p => p.id === poolId);
    const btn = getEl(`pool-${poolId}`).querySelector('.btn-harvest');
    try {
        btn.textContent = "...";
        const contract = new ethers.Contract(pool.contract, window.SOUSCHEF_ABI, signer);
        const tx = await contract.deposit(0); // Harvest pattern
        await tx.wait();
        await fetchPoolData(pool);
        btn.textContent = "Harvest";
    } catch(e) { console.error(e); btn.textContent = "Error"; }
};

window.handleMax = (poolId) => {
    const state = poolsState[poolId];
    if(!state) return;
    const card = getEl(`pool-${poolId}`);
    const amount = state.mode === 'stake' ? state.balance : state.staked;
    card.querySelector('.pool-input').value = ethers.formatEther(amount);
    refreshPoolUI(poolId); // Re-check allowance
};

// Listeners para Inputs
document.querySelectorAll('.pool-input').forEach(input => {
    input.addEventListener('input', (e) => {
        const cardId = e.target.closest('.glass-panel').id;
        const pid = parseInt(cardId.split('-')[1]);
        refreshPoolUI(pid);
    });
});