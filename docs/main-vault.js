let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let selectedProvider = null;

const getEl = (id) => document.getElementById(id);

// --- UI HELPERS PRO ---
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

document.addEventListener("DOMContentLoaded", initVaultApp);

async function initVaultApp() {
    try {
        NETWORKS_DATA = await window.loadNetworks();
        initNetworkSelector();
        // Fallback default
        ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == "1868" && n.enabled);
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

// --- WALLET MODAL ---
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

// --- CONNECT / DISCONNECT ---
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
    getEl("vaultVibeRewards").textContent = "0.00";
};

// --- CORE CONNECT ---
async function connectWallet() {
  const ethProvider = selectedProvider || window.ethereum;
  if (!ethProvider) { alert("Please install MetaMask"); return; }
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
        if(!targetId) {
             const def = Object.values(NETWORKS_DATA).find(n => n.enabled);
             if(def) targetId = def.chainId;
        }
        if(targetId) { await switchNetwork(targetId); return; }
        else { alert("Unsupported Network."); updateStatus(false); return; }
    }
    
    if(sel && ACTIVE) sel.value = ACTIVE.chainId;
    updateStatus(true);
    await updateVibeVault();
    
    if(ethProvider.on) {
        ethProvider.on('chainChanged', () => window.location.reload());
        ethProvider.on('accountsChanged', () => window.location.reload());
    }
  } catch (e) { console.error("Connection Error:", e); updateStatus(false); }
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

// --- VAULT LOGIC (Original) ---
const btnClaim = getEl("btnVaultClaimVibe");
const statusEl = getEl("vaultVibeStatus");

async function updateVibeVault() {
  if (!window.REWARDS_ADDRESS || !userAddress) return;
  const vault = new ethers.Contract(window.REWARDS_ADDRESS, window.REWARDS_ABI, provider);
  try {
    const pending = await vault.vibeAccrued(userAddress);
    const pendingFmt = Number(pending)/1e18;
    getEl("vaultVibeRewards").textContent = pendingFmt.toLocaleString('en-US', {maximumFractionDigits:4});
    btnClaim.disabled = pendingFmt < 0.0001;
    if(pendingFmt >= 0.0001) { btnClaim.style.background = "var(--warning)"; btnClaim.style.color = "#000"; }

    let vibeTokenAddr = await vault.vibeTokenExternal();
    if (vibeTokenAddr && vibeTokenAddr !== ethers.ZeroAddress) {
      const vibeToken = new ethers.Contract(vibeTokenAddr, window.MIN_ERC20_ABI, provider);
      const vibeBal = await vibeToken.balanceOf(userAddress);
      getEl("vaultVibeWallet").textContent = (Number(vibeBal)/1e18).toLocaleString('en-US', {maximumFractionDigits:2});
    }
    await renderVaultAPYs(vault);
  } catch(e) { console.error("Vault Error:", e); statusEl.textContent = "Error loading vault data."; statusEl.style.color = "var(--danger)"; }
}

async function renderVaultAPYs(vault) {
    const blocksPerYear = ACTIVE.blocksPerYear || 15768000;
    const supplyList = getEl("supplyApyList");
    const borrowList = getEl("borrowApyList");
    supplyList.innerHTML = ""; borrowList.innerHTML = "";
    for (const m of ACTIVE.cTokens) {
      try {
          const [vibeSupplySpeedRaw, vibeBorrowSpeedRaw] = await Promise.all([vault.vibeSupplySpeed(m.address), vault.vibeBorrowSpeed(m.address)]);
          if(vibeSupplySpeedRaw == 0n && vibeBorrowSpeedRaw == 0n) continue;
          const c = new ethers.Contract(m.address, window.C_TOKEN_ABI, provider);
          const [totalSupplyRaw, exchRateRaw, totalBorrowsRaw] = await Promise.all([c.totalSupply(), c.exchangeRateStored(), c.totalBorrows()]);
          const supplyUnderlying = Number(totalSupplyRaw) * Number(exchRateRaw) / 1e36;
          const borrowUnderlying = Number(totalBorrowsRaw) / Math.pow(10, m.underlyingDecimals || 18);
          const vibePerSupplyYear = Number(vibeSupplySpeedRaw) * blocksPerYear / 1e18;
          const vibePerBorrowYear = Number(vibeBorrowSpeedRaw) * blocksPerYear / 1e18;
          const vibeSupplyAPY = supplyUnderlying > 0.1 ? (vibePerSupplyYear / supplyUnderlying) * 100 : 0;
          const vibeBorrowAPY = borrowUnderlying > 0.1 ? (vibePerBorrowYear / borrowUnderlying) * 100 : 0;
          if(vibeSupplyAPY > 0.01) {
              const div = document.createElement("div"); div.className = "apy-item";
              div.innerHTML = `<span>${m.symbol}</span> <span class="apy-val">+${vibeSupplyAPY.toFixed(2)}%</span>`;
              supplyList.appendChild(div);
          }
          if(vibeBorrowAPY > 0.01) {
              const div = document.createElement("div"); div.className = "apy-item";
              div.innerHTML = `<span>${m.symbol}</span> <span class="apy-val">+${vibeBorrowAPY.toFixed(2)}%</span>`;
              borrowList.appendChild(div);
          }
      } catch(e) {}
    }
    if(supplyList.innerHTML === "") supplyList.innerHTML = "<div style='padding:10px; color:var(--text-muted);'>No active rewards</div>";
    if(borrowList.innerHTML === "") borrowList.innerHTML = "<div style='padding:10px; color:var(--text-muted);'>No active rewards</div>";
}

btnClaim.onclick = async () => {
  if (!signer || !userAddress || !window.REWARDS_ADDRESS) return;
  try {
    const vaultSigner = new ethers.Contract(window.REWARDS_ADDRESS, window.REWARDS_ABI, signer);
    btnClaim.textContent = "Claiming..."; statusEl.textContent = "Confirming...";
    const tx = await vaultSigner.claimVIBE(userAddress);
    statusEl.textContent = "Transaction sent..."; await tx.wait();
    btnClaim.textContent = "Claim Rewards"; statusEl.textContent = "Success! Rewards claimed.";
    await updateVibeVault();
    setTimeout(() => statusEl.textContent = "", 5000);
  } catch(e) {
    btnClaim.textContent = "Claim Rewards"; statusEl.textContent = "Error: " + (e.shortMessage || "Failed"); statusEl.style.color = "var(--danger)";
  }
};