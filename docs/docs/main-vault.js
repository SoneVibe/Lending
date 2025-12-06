let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;

const getEl = (id) => document.getElementById(id);
const btnConnect = getEl("btnConnect");
const btnClaim = getEl("btnVaultClaimVibe");
const statusEl = getEl("vaultVibeStatus");

// UI Helper to update connection status
const updateStatus = (connected) => {
  const dot = getEl('statusDot');
  const txt = getEl('connStatus');
  if(connected) {
    dot.style.color = "var(--success)";
    txt.textContent = "Connected";
    btnConnect.textContent = userAddress.substring(0,6) + "..." + userAddress.substring(38);
    btnConnect.style.background = "rgba(255,255,255,0.1)";
  } else {
    dot.style.color = "var(--danger)";
    txt.textContent = "Disconnected";
    btnConnect.textContent = "Connect Wallet";
    btnConnect.style.background = "var(--accent)";
  }
};

// Connect Wallet Function (ACTUALIZADA)
async function connectWallet() {
  if (!window.ethereum) { alert("Please install MetaMask"); return; }
  btnConnect.textContent = "Connecting...";
  
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    NETWORKS_DATA = await window.loadNetworks();
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    
    // 1. Detección Robusta (Hex -> Decimal)
    const chainIdHex = await provider.send("eth_chainId", []);
    const chainIdDecimal = parseInt(chainIdHex, 16);
    
    ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === chainIdDecimal) && n.enabled);
    
    // 2. Auto-Switch Logic
    if(!ACTIVE) {
        // Intenta buscar Soneium (1868) o la primera red habilitada
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
                if (switchError.code === 4902) { // Red no existe, agregarla
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
                    } catch (addError) { console.error(addError); }
                }
            }
        }
        alert(`Wrong Network (${chainIdDecimal}). Please switch to Soneium Mainnet.`);
        updateStatus(false);
        btnConnect.textContent = "Connect Wallet";
        return;
    }
    
    updateStatus(true);
    await updateVibeVault();
    
  } catch (e) {
    console.error("Connection Error:", e);
    updateStatus(false);
    btnConnect.textContent = "Connect Wallet";
  }
}

btnConnect.onclick = connectWallet;

// --- VAULT LOGIC ---

async function updateVibeVault() {
  if (!window.REWARDS_ADDRESS || !userAddress) return;
  const vault = new ethers.Contract(window.REWARDS_ADDRESS, window.REWARDS_ABI, provider);
  
  try {
    // 1. Pending Rewards
    const pending = await vault.vibeAccrued(userAddress);
    const pendingFmt = Number(pending)/1e18;
    getEl("vaultVibeRewards").textContent = pendingFmt.toLocaleString('en-US', {maximumFractionDigits:4});
    
    btnClaim.disabled = pendingFmt < 0.0001;
    if(pendingFmt >= 0.0001) {
        btnClaim.style.background = "var(--warning)";
        btnClaim.style.color = "#000";
    }

    // 2. Wallet Balance
    let vibeTokenAddr = await vault.vibeTokenExternal();
    if (vibeTokenAddr && vibeTokenAddr !== ethers.ZeroAddress) {
      const vibeToken = new ethers.Contract(vibeTokenAddr, window.MIN_ERC20_ABI, provider);
      const vibeBal = await vibeToken.balanceOf(userAddress);
      getEl("vaultVibeWallet").textContent = (Number(vibeBal)/1e18).toLocaleString('en-US', {maximumFractionDigits:2});
    }

    // 3. Calculate APYs
    await renderVaultAPYs(vault);

  } catch(e) {
    console.error("Vault Error:", e);
    statusEl.textContent = "Error loading vault data.";
    statusEl.style.color = "var(--danger)";
  }
}

async function renderVaultAPYs(vault) {
    const blocksPerYear = ACTIVE.blocksPerYear || 15768000;
    const supplyList = getEl("supplyApyList");
    const borrowList = getEl("borrowApyList");
    
    supplyList.innerHTML = "";
    borrowList.innerHTML = "";

    for (const m of ACTIVE.cTokens) {
      try {
          // Fetch Speeds
          const [vibeSupplySpeedRaw, vibeBorrowSpeedRaw] = await Promise.all([
              vault.vibeSupplySpeed(m.address),
              vault.vibeBorrowSpeed(m.address)
          ]);

          // Skip if no rewards
          if(vibeSupplySpeedRaw == 0n && vibeBorrowSpeedRaw == 0n) continue;

          // Fetch Market Data for Calc
          const c = new ethers.Contract(m.address, window.C_TOKEN_ABI, provider);
          const [totalSupplyRaw, exchRateRaw, totalBorrowsRaw] = await Promise.all([
              c.totalSupply(),
              c.exchangeRateStored(),
              c.totalBorrows()
          ]);

          // Math
          const supplyUnderlying = Number(totalSupplyRaw) * Number(exchRateRaw) / 1e36;
          const borrowUnderlying = Number(totalBorrowsRaw) / Math.pow(10, m.underlyingDecimals || 18);

          const vibePerSupplyYear = Number(vibeSupplySpeedRaw) * blocksPerYear / 1e18;
          const vibePerBorrowYear = Number(vibeBorrowSpeedRaw) * blocksPerYear / 1e18;

          const vibeSupplyAPY = supplyUnderlying > 0.1 ? (vibePerSupplyYear / supplyUnderlying) * 100 : 0;
          const vibeBorrowAPY = borrowUnderlying > 0.1 ? (vibePerBorrowYear / borrowUnderlying) * 100 : 0;

          // Render Supply Item
          if(vibeSupplyAPY > 0.01) {
              const div = document.createElement("div");
              div.className = "apy-item";
              div.innerHTML = `<span>${m.symbol}</span> <span class="apy-val">+${vibeSupplyAPY.toFixed(2)}%</span>`;
              supplyList.appendChild(div);
          }

          // Render Borrow Item
          if(vibeBorrowAPY > 0.01) {
              const div = document.createElement("div");
              div.className = "apy-item";
              div.innerHTML = `<span>${m.symbol}</span> <span class="apy-val">+${vibeBorrowAPY.toFixed(2)}%</span>`;
              borrowList.appendChild(div);
          }

      } catch(e) { console.error(e); }
    }
    
    if(supplyList.innerHTML === "") supplyList.innerHTML = "<div style='padding:10px; color:var(--text-muted);'>No active rewards</div>";
    if(borrowList.innerHTML === "") borrowList.innerHTML = "<div style='padding:10px; color:var(--text-muted);'>No active rewards</div>";
}

btnClaim.onclick = async () => {
  if (!signer || !userAddress || !window.REWARDS_ADDRESS) return;
  try {
    const vaultSigner = new ethers.Contract(window.REWARDS_ADDRESS, window.REWARDS_ABI, signer);
    btnClaim.textContent = "Claiming...";
    statusEl.textContent = "Confirm transaction in wallet...";
    
    const tx = await vaultSigner.claimVIBE(userAddress);
    statusEl.textContent = "Transaction sent...";
    
    await tx.wait();
    btnClaim.textContent = "Claim Rewards";
    statusEl.textContent = "Success! Rewards claimed.";
    
    await updateVibeVault();
    setTimeout(() => statusEl.textContent = "", 5000);
  } catch(e) {
    console.error(e);
    btnClaim.textContent = "Claim Rewards";
    statusEl.textContent = "Error: " + (e.shortMessage || "Failed");
    statusEl.style.color = "var(--danger)";
  }
};
