let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let comptrollerContract, cSvusdContract, svusdContract;
let isBorrowMode = true;

// ---- Explicit UI state (avoid accidental globals) ----
let currentDebt = 0;        // SVUSD (token units)
let walletBalance = 0;      // SVUSD (token units)
let availableToBorrow = 0;  // USD

// ---- Wallet modal/provider selection (like markets) ----
let selectedProvider = null;

const getEl = (id) => document.getElementById(id);

// ======================================================
// UI HELPERS PRO (EXACTLY LIKE markets.js)
// ======================================================
const updateStatus = (connected) => {
  const dot = getEl('statusDot');
  const txt = getEl('connStatus');
  const btn = getEl('btnConnect');

  if (!dot || !txt || !btn) return;

  if (connected && userAddress) {
    dot.style.color = "var(--success)";
    txt.textContent = "Online";

    // Pro Button Style
    btn.textContent = userAddress.substring(0, 6) + "..." + userAddress.substring(38);
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-connected');

    // Dropdown Icon
    const arrow = document.createElement("span");
    arrow.textContent = "▼";
    arrow.style.fontSize = "0.7em";
    arrow.style.marginLeft = "6px";
    if (btn.lastChild && btn.lastChild.tagName === 'SPAN') btn.removeChild(btn.lastChild);
    btn.appendChild(arrow);

    // Dropdown Data
    const dd = getEl('dropdownAddress');
    if (dd) dd.textContent = userAddress.substring(0, 8) + "..." + userAddress.substring(38);

  } else {
    dot.style.color = "var(--warning)";
    txt.textContent = "Syncing...";

    btn.textContent = "Connect Wallet";
    btn.className = "btn-primary";
    btn.style.background = "";
  }
};

// ======================================================
// INIT APP (OFFLINE + AUTO-CONNECT) - SAME STRUCTURE AS markets.js
// ======================================================
document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  try {
    NETWORKS_DATA = await window.loadNetworks();
    initNetworkSelector();

    // Same UX as markets: show Syncing until connected (no read-only fetch here)
    updateStatus(false);

    // Auto-Connect Pro (if present in config.js)
    if (window.checkAutoConnect) {
      await window.checkAutoConnect(connectWallet);
    }

    // Mint listeners (existing behavior)
    const input = getEl("amountInput");
    if (input) input.addEventListener('input', validateInput);

    const btnMax = getEl("btnMax");
    if (btnMax) btnMax.addEventListener('click', setMax);

    // Toggle Listener (New)
    const toggle = getEl("toggleCollateral");
    if(toggle) {
        toggle.addEventListener('click', handleToggleCollateral);
    }

    updateActionButton();

  } catch (e) {
    console.log("Init failed", e);
    updateStatus(false);
  }
}

function initNetworkSelector() {
  const sel = getEl("networkSelect");
  if (!NETWORKS_DATA || !sel) return;

  sel.innerHTML = "";
  Object.values(NETWORKS_DATA).forEach(n => {
    if (n.enabled) {
      const opt = document.createElement("option");
      opt.value = n.chainId;
      opt.textContent = n.label;
      sel.appendChild(opt);
    }
  });

  // Keep your default selection logic (Minato first)
  if (!ACTIVE) {
    ACTIVE =
      Object.values(NETWORKS_DATA).find(n => n.chainId == "1946") ||
      Object.values(NETWORKS_DATA).find(n => n.enabled) ||
      Object.values(NETWORKS_DATA)[0];
  }
  if (ACTIVE) sel.value = ACTIVE.chainId;

  sel.onchange = async (e) => {
    const targetChainId = e.target.value;
    if (userAddress) {
      await switchNetwork(targetChainId);
    } else {
      ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);
      console.log("Read-mode network changed:", ACTIVE ? ACTIVE.label : targetChainId);
    }
  };
}

// ======================================================
// WALLET MODAL LOGIC - EXACTLY LIKE markets.js
// ======================================================
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
        if (!isInstalled) { window.open(w.installUrl, '_blank'); return; }
        selectedProvider = w.getProvider();
        closeWalletModal();
        await connectWallet();
      };
      list.appendChild(btn);
    });
  }
  modal.classList.add('open');
}

function closeWalletModal() {
  const modal = getEl('walletModal');
  if (modal) modal.classList.remove('open');
}
window.closeWalletModal = closeWalletModal;

window.onclick = (e) => {
  const modal = getEl('walletModal');
  if (e.target === modal) closeWalletModal();

  const accountDropdown = getEl("accountDropdown");
  if (accountDropdown && accountDropdown.classList.contains('show') && !e.target.closest('#btnConnect')) {
    accountDropdown.classList.remove('show');
  }
};

// ======================================================
// CONNECT & DISCONNECT UI HANDLERS - EXACTLY LIKE markets.js
// ======================================================
const btnConnect = getEl("btnConnect");
const accountDropdown = getEl("accountDropdown");

if (btnConnect) {
  btnConnect.onclick = (e) => {
    e.stopPropagation();
    if (userAddress) {
      if (accountDropdown) accountDropdown.classList.toggle("show");
    } else {
      openWalletModal();
    }
  };
}

const btnCopyAddress = getEl("btnCopyAddress");
if (btnCopyAddress) {
  btnCopyAddress.onclick = () => {
    if (!userAddress) return;
    navigator.clipboard.writeText(userAddress);
    alert("Copied!");
  };
}

const btnViewExplorer = getEl("btnViewExplorer");
if (btnViewExplorer) {
  btnViewExplorer.onclick = () => {
    if (ACTIVE && ACTIVE.blockExplorerUrls && ACTIVE.blockExplorerUrls[0] && userAddress) {
      window.open(ACTIVE.blockExplorerUrls[0] + "/address/" + userAddress, '_blank');
    }
  };
}

const btnDisconnect = getEl("btnDisconnect");
if (btnDisconnect) {
  btnDisconnect.onclick = () => {
    if (window.SessionManager) window.SessionManager.clear();

    userAddress = null;
    signer = null;
    selectedProvider = null;

    updateStatus(false);
    if (accountDropdown) accountDropdown.classList.remove("show");

    // NOTE: markets.js leaves reload optional; keep identical (no reload)
    // window.location.reload();
  };
}

// ======================================================
// CORE CONNECTION LOGIC - EXACTLY LIKE markets.js
// ======================================================
async function connectWallet() {
  const ethProvider = selectedProvider || window.ethereum;
  if (!ethProvider) { alert("Please install MetaMask."); return; }

  getEl("btnConnect").textContent = "Connecting...";

  try {
    provider = new ethers.BrowserProvider(ethProvider);
    if (!NETWORKS_DATA) NETWORKS_DATA = await window.loadNetworks();

    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    // Guardar Sesión Pro
    if (window.SessionManager) window.SessionManager.save();

    const chainIdHex = await provider.send("eth_chainId", []);
    const chainIdDecimal = parseInt(chainIdHex, 16);

    ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === chainIdDecimal) && n.enabled);

    const sel = getEl("networkSelect");

    // Auto-Switch Logic
    if (!ACTIVE) {
      console.log("Unsupported chain. Switching...");
      let targetId = sel ? sel.value : null;
      if (!targetId) {
        const def = Object.values(NETWORKS_DATA).find(n => n.enabled);
        if (def) targetId = def.chainId;
      }
      if (targetId) { await switchNetwork(targetId); return; }
      else { alert("Unsupported Network."); updateStatus(false); return; }
    }

    if (sel && ACTIVE) sel.value = ACTIVE.chainId;

    updateStatus(true);

    // Mint-specific: init contracts and start refresh loop
    initContracts();

    if (ethProvider.on) {
      ethProvider.on('chainChanged', () => window.location.reload());
      ethProvider.on('accountsChanged', () => window.location.reload());
    }

  } catch (e) {
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
  } catch (switchError) {
    if (switchError.code === 4902) {
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
      } catch (e) {}
    }
  }
}

// ======================================================
// MINT LOGIC (UNCHANGED)
// ======================================================

window.setMode = (mode) => {
  isBorrowMode = (mode === 'borrow');

  getEl('tabBorrow').className = isBorrowMode ? "toggle-btn active" : "toggle-btn";
  getEl('tabRepay').className = !isBorrowMode ? "toggle-btn active" : "toggle-btn";

  getEl('tabBorrow').style.background = isBorrowMode ? "var(--card-bg)" : "transparent";
  getEl('tabBorrow').style.color = isBorrowMode ? "#fff" : "var(--text-muted)";

  getEl('tabRepay').style.background = !isBorrowMode ? "var(--card-bg)" : "transparent";
  getEl('tabRepay').style.color = !isBorrowMode ? "#fff" : "var(--text-muted)";

  getEl('amountInput').value = "";
  const status = getEl("txStatus");
  if (status) status.innerHTML = "";
  updateActionButton();
  refreshData();
};

function initContracts() {
  if (!ACTIVE) return;

  const svusdConfig = window.SVUSD_CONFIG ? window.SVUSD_CONFIG[ACTIVE.chainId] : null;

  if (!svusdConfig || !svusdConfig.contracts || !svusdConfig.contracts.svusd) {
    console.warn(`SVUSD Config missing for chain ${ACTIVE.chainId}`);
    const btn = getEl("btnAction");
    if (btn) {
      btn.textContent = "SVUSD Not Configured";
      btn.disabled = true;
    }
    return;
  }

  try {
    if (!provider) return;

    comptrollerContract = new ethers.Contract(ACTIVE.master, window.MASTER_ABI, provider);
    cSvusdContract = new ethers.Contract(svusdConfig.contracts.cSvusd, window.CSVUSD_MINTABLE_ABI, provider);
    svusdContract = new ethers.Contract(svusdConfig.contracts.svusd, window.ERC20_ABI, provider);

    refreshData();

    if (window.svusdInterval) clearInterval(window.svusdInterval);
    window.svusdInterval = setInterval(refreshData, 15000);

  } catch (e) {
    console.error("Contract Init Error:", e);
  }
}

async function fetchBorrowRateSafe(contract) {
  const IRM_ABI_LOCAL = ["function getBorrowRate(uint cash, uint borrows, uint reserves) external view returns (uint)"];
  try {
    const irmAddress = await contract.interestRateModel();
    const totalBorrows = await contract.totalBorrows();
    let totalReserves = 0n;
    try { totalReserves = await contract.totalReserves(); } catch { }
    const cash = 0n;
    const irmContract = new ethers.Contract(irmAddress, IRM_ABI_LOCAL, provider);
    return await irmContract.getBorrowRate(cash, totalBorrows, totalReserves);
  } catch (err) {
    try { return await contract.borrowRatePerBlock(); } catch { return 0n; }
  }
}

async function refreshData() {
  if (!userAddress || !comptrollerContract || !cSvusdContract || !svusdContract) return;

  try {
    // 1. Get Account Liquidity
    const res = await comptrollerContract.getAccountLiquidity(userAddress);
    const ld = (res && res.ld) ? res.ld : res;

    const collateralUSD = Number(ld[0].toString()) / 1e18;
    const liquidationUSD = Number(ld[1].toString()) / 1e18;
    const borrowUSD = Number(ld[2].toString()) / 1e18;

    // 2. Get Balances, Reserves & Rates
    const borrowRateMantissa = await fetchBorrowRateSafe(cSvusdContract);
    const [userBorrowBalance, userWalletBalance, totalReserves] = await Promise.all([
      cSvusdContract.borrowBalance(userAddress), // Uses correct accountBorrowIndex logic internally
      svusdContract.balanceOf(userAddress),
      cSvusdContract.totalReserves() // Fetch reserves
    ]);

    // 3. Check Membership (Enter/Exit Status) for Toggle
    try {
        const cTokenAddr = await cSvusdContract.getAddress();
        const isEntered = await comptrollerContract.accountMembership(userAddress, cTokenAddr);
        const toggle = getEl("toggleCollateral");
        if(toggle) toggle.checked = isEntered;
    } catch(e) { console.log("Membership check error", e); }

    const blocksPerYear = ACTIVE.blocksPerYear || 15768000;
    const apr = (parseFloat(ethers.formatEther(borrowRateMantissa)) * blocksPerYear * 100).toFixed(2);

    currentDebt = parseFloat(ethers.formatEther(userBorrowBalance));
    walletBalance = parseFloat(ethers.formatEther(userWalletBalance));
    const reservesVal = parseFloat(ethers.formatEther(totalReserves)); // Formatted reserves

    availableToBorrow = Math.max(0, collateralUSD - borrowUSD);

    if (getEl("valAPR")) getEl("valAPR").textContent = `${apr}%`;
    if (getEl("valDebt")) getEl("valDebt").textContent =
      `$${borrowUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    if (getEl("borrowedBalance")) getEl("borrowedBalance").textContent = currentDebt.toFixed(4);
    if (getEl("walletBalance")) getEl("walletBalance").textContent = walletBalance.toFixed(4);
    if (getEl("totalReservesVal")) getEl("totalReservesVal").textContent = `${reservesVal.toFixed(4)} SVUSD`;

    let hfText = "∞";
    let hfColor = "var(--success)";
    let usedPercent = 0;

    if (borrowUSD > 0) {
      const hf = liquidationUSD > 0 ? (liquidationUSD / borrowUSD) : 0;
      hfText = Number.isFinite(hf) ? hf.toFixed(2) : "∞";

      if (hf < 1.0) hfColor = "var(--danger)";
      else if (hf < 1.1) hfColor = "var(--danger)";
      else if (hf < 1.5) hfColor = "var(--warning)";
      else hfColor = "var(--success)";

      usedPercent = liquidationUSD > 0 ? (borrowUSD / liquidationUSD) * 100 : 110;
    } else {
      hfText = "∞";
      hfColor = "var(--success)";
      usedPercent = 0;
    }

    const hfEl = getEl("valHealth");
    if (hfEl) {
      hfEl.textContent = hfText;
      hfEl.style.color = hfColor;
    }

    if (getEl("valCollateral")) {
      getEl("valCollateral").textContent =
        `$${collateralUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    if (getEl("valPowerUsed")) {
      const safePct = Math.max(0, usedPercent);
      getEl("valPowerUsed").textContent = `${safePct.toFixed(2)}%`;

      const bar = getEl("barPower");
      if (bar) {
        const cssWidth = Math.max(0, Math.min(100, safePct));
        bar.style.width = `${cssWidth}%`;

        if (safePct >= 100) bar.style.backgroundColor = "var(--danger)";
        else if (safePct > 80) bar.style.backgroundColor = "var(--warning)";
        else bar.style.backgroundColor = "var(--success)";
      }
    }

    if (isBorrowMode) {
      getEl("labelBalance").textContent = "Borrow Power Available:";
      getEl("valBalance").textContent =
        `$${availableToBorrow.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      getEl("labelBalance").textContent = "Wallet Balance (Repay):";
      getEl("valBalance").textContent = `${walletBalance.toFixed(2)} SVUSD`;
    }

    updateActionButton();

  } catch (e) {
    console.error("Data Refresh Error:", e);
  }
}

function validateInput() {
  const btn = getEl("btnAction");
  const raw = getEl("amountInput").value;

  if (!btn) return;

  const val = parseFloat(raw);
  if (isNaN(val) || val <= 0) {
    updateActionButton();
    return;
  }

  if (isBorrowMode) {
    if (val > availableToBorrow) {
      btn.textContent = "Insufficient Borrow Power";
      btn.disabled = true;
      return;
    }
  } else {
    if (val > walletBalance) {
      btn.textContent = "Insufficient Balance";
      btn.disabled = true;
      return;
    }
  }

  btn.disabled = false;
  updateActionButton();
}

function setMax() {
  const input = getEl("amountInput");
  if (!input) return;

  if (isBorrowMode) {
    const safeMax = availableToBorrow * 0.99;
    input.value = (safeMax > 0 ? safeMax : 0).toFixed(6);
  } else {
    const maxRepay = Math.min(currentDebt, walletBalance);
    input.value = maxRepay.toFixed(6);
  }
  validateInput();
}

async function updateActionButton() {
  const btn = getEl("btnAction");
  const val = getEl("amountInput") ? getEl("amountInput").value : "";

  if (!btn) return;

  if (!userAddress) {
    btn.textContent = "Connect Wallet";
    btn.onclick = openWalletModal; // open modal, same UX as markets button
    btn.disabled = false;
    return;
  }

  // 1. Check Collateral Enabled (Enter Market) Logic for Borrow Mode
  if (isBorrowMode) {
    const toggle = getEl("toggleCollateral");
    if (toggle && !toggle.checked) {
        btn.textContent = "Enable Collateral First";
        btn.onclick = (e) => handleToggleCollateral(e); // Redirect action to toggle
        btn.disabled = false; // Enabled so user can click to enable
        return;
    }
  }

  if (isBorrowMode) {
    btn.textContent = "Borrow SVUSD";
    btn.onclick = executeBorrow;
    btn.disabled = false;
    return;
  }

  const amountWei = (val && parseFloat(val) > 0) ? ethers.parseEther(val) : 0n;
  if (amountWei <= 0n) {
    btn.textContent = "Enter Amount";
    btn.disabled = true;
    return;
  }

  try {
    const spender = await cSvusdContract.getAddress();
    const allowance = await svusdContract.allowance(userAddress, spender);

    if (allowance < amountWei) {
      btn.textContent = "Approve SVUSD";
      btn.onclick = executeApprove;
    } else {
      btn.textContent = "Repay SVUSD";
      btn.onclick = executeRepay;
    }
    btn.disabled = false;
  } catch (e) {
    console.error("Allowance Check Failed", e);
    btn.textContent = "Error";
    btn.disabled = true;
  }
}

// ======================================================
// TOGGLE COLLATERAL LOGIC (NEW)
// ======================================================
async function handleToggleCollateral(e) {
    e.preventDefault(); // Stop immediate toggle, wait for TX
    
    if(!userAddress || !comptrollerContract) {
        openWalletModal();
        return;
    }

    const toggle = e.target.type === 'checkbox' ? e.target : getEl("toggleCollateral"); // Handle different event targets
    
    // Check current on-chain state to be sure
    const cTokenAddr = await cSvusdContract.getAddress();
    const isEntered = await comptrollerContract.accountMembership(userAddress, cTokenAddr);
    
    const status = getEl("txStatus");
    status.innerHTML = `<span style="color:var(--warning)">${isEntered ? "Exiting" : "Entering"} Market...</span>`;
    
    try {
        const compSigner = comptrollerContract.connect(signer);
        let tx;
        
        if (isEntered) {
            // EXIT
            tx = await compSigner.exitMarket(cTokenAddr);
        } else {
            // ENTER
            tx = await compSigner.enterMarkets([cTokenAddr]);
        }
        await tx.wait();
        
        status.innerHTML = `<span style="color:var(--success)">Success!</span>`;
        await refreshData(); // This will update the toggle UI and re-evaluate button state
        
    } catch(err) {
        console.error(err);
        status.innerHTML = `<span style="color:var(--danger)">Error: ${err.reason || "Failed"}</span>`;
    }
}

async function executeBorrow() {
  const val = getEl("amountInput").value;
  if (!val) return;

  const btn = getEl("btnAction");
  const status = getEl("txStatus");
  btn.disabled = true;
  status.innerHTML = `<span style="color:var(--warning)">Borrowing SVUSD...</span>`;

  try {
    const cSvusdSigner = cSvusdContract.connect(signer);
    const tx = await cSvusdSigner.borrow(ethers.parseEther(val));
    await tx.wait();

    status.innerHTML = `<span style="color:var(--success)">Success! Borrowed ${val} SVUSD</span>`;
    getEl("amountInput").value = "";
    await refreshData();
  } catch (e) {
    console.error(e);
    let msg = e.reason || e.shortMessage || e.message || "Transaction failed";
    if (typeof msg === "string" && msg.includes("Comptroller")) msg = "Rejection: Check collateral, membership, or caps";
    status.innerHTML = `<span style="color:var(--danger)">Error: ${msg}</span>`;
  } finally {
    btn.disabled = false;
    updateActionButton();
  }
}

async function executeApprove() {
  const btn = getEl("btnAction");
  const status = getEl("txStatus");
  btn.disabled = true;
  status.innerHTML = `<span style="color:var(--warning)">Approving SVUSD...</span>`;

  try {
    const svusdSigner = svusdContract.connect(signer);
    const spender = await cSvusdContract.getAddress();
    const tx = await svusdSigner.approve(spender, ethers.MaxUint256);
    await tx.wait();

    status.innerHTML = `<span style="color:var(--success)">Approved! You can now repay.</span>`;
    await updateActionButton();
  } catch (e) {
    console.error(e);
    status.innerHTML = `<span style="color:var(--danger)">Approve Failed</span>`;
  } finally {
    btn.disabled = false;
  }
}

async function executeRepay() {
  const val = getEl("amountInput").value;
  if (!val) return;

  const btn = getEl("btnAction");
  const status = getEl("txStatus");
  btn.disabled = true;
  status.innerHTML = `<span style="color:var(--warning)">Repaying (Burning) SVUSD...</span>`;

  try {
    const cSvusdSigner = cSvusdContract.connect(signer);
    const tx = await cSvusdSigner.repay(ethers.parseEther(val));
    await tx.wait();

    status.innerHTML = `<span style="color:var(--success)">Success! Debt repaid.</span>`;
    getEl("amountInput").value = "";
    await refreshData();
  } catch (e) {
    console.error(e);
    const msg = e.reason || e.shortMessage || e.message || "Transaction failed";
    status.innerHTML = `<span style="color:var(--danger)">Error: ${msg}</span>`;
  } finally {
    btn.disabled = false;
    updateActionButton();
  }
}