let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let closeFactor = 0.5; 
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

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
    try {
        NETWORKS_DATA = await window.loadNetworks();
        initNetworkSelector();
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
};

// --- CORE CONNECT ---
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
        updateStatus(true);
        
        const master = new ethers.Contract(ACTIVE.master, window.MASTER_ABI, provider);
        try { const cfRaw = await master.closeFactorMantissa(); closeFactor = Number(cfRaw) / 1e18; } catch(e) {}

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

// --- LIQUIDATOR CORE (Original) ---
let selectedBorrowCToken = null;
let selectedBorrowDecimals = 18;
let currentTargetData = { borrows: [], collaterals: [] };

getEl("btnScan").onclick = async () => {
    if(!ACTIVE || !provider) { alert("Connect Wallet First"); return; }
    const target = getEl("targetInput").value.trim();
    if(!ethers.isAddress(target)) { alert("Invalid Address"); return; }
    const btn = getEl("btnScan");
    btn.textContent = "SCANNING..."; btn.disabled = true; getEl("resultsArea").style.display = "none";
    try { await analyzeTarget(target); getEl("resultsArea").style.display = "block"; } catch(e) { console.error(e); alert("Error: " + e.message); }
    btn.textContent = "SCAN"; btn.disabled = false;
};

async function analyzeTarget(targetAddr) {
    const master = new ethers.Contract(ACTIVE.master, window.MASTER_ABI, provider);
    const oracleAddr = await master.oracle();
    const oracle = new ethers.Contract(oracleAddr, window.ORACLE_ABI, provider);
    const res = await master.getAccountLiquidity(targetAddr);
    const ld = res.ld ? res.ld : res;
    const liquidationThresholdUSD = Number(ld[1].toString()) / 1e18; 
    const totalBorrowUSDFromContract = Number(ld[2].toString()) / 1e18; 
    const debtList = getEl("debtList"); const colList = getEl("collateralList");
    debtList.innerHTML = ""; colList.innerHTML = "";
    let totalCollateralValue = 0;
    currentTargetData.borrows = []; currentTargetData.collaterals = [];

    for(const m of ACTIVE.cTokens) {
        const c = new ethers.Contract(m.address, window.C_TOKEN_ABI, provider);
        const [borrowBal, supplyBal, priceRaw, exchRate] = await Promise.all([c.borrowBalance(targetAddr), c.balanceOf(targetAddr), oracle.getUnderlyingPrice(m.address), c.exchangeRateStored()]);
        const price = Number(ethers.formatUnits(priceRaw, 18));
        const uDecimals = m.underlyingDecimals || 18;
        const borrowAmt = Number(borrowBal) / Math.pow(10, uDecimals);
        if(borrowAmt > 0.000001) {
            const borrowVal = borrowAmt * price;
            currentTargetData.borrows.push({ symbol: m.symbol, uSymbol: m.underlyingSymbol, address: m.address, decimals: uDecimals, amount: borrowAmt, usd: borrowVal });
        }
        const supplyTokens = Number(supplyBal);
        if(supplyTokens > 0) {
            const supplyUnderlying = (supplyTokens * Number(exchRate)) / 1e36; 
            const supplyVal = supplyUnderlying * price;
            totalCollateralValue += supplyVal;
            currentTargetData.collaterals.push({ symbol: m.symbol, uSymbol: m.underlyingSymbol, address: m.address, amountC: supplyTokens / 1e18, usd: supplyVal });
        }
    }

    let healthFactor = 999;
    if (totalBorrowUSDFromContract > 0) healthFactor = liquidationThresholdUSD / totalBorrowUSDFromContract; else healthFactor = Infinity;
    const maxLiqUSD = totalBorrowUSDFromContract * closeFactor;
    const hfEl = getEl("dispHF");
    const isLiquidatable = healthFactor < 1.0;
    if(isLiquidatable) { hfEl.textContent = healthFactor.toFixed(4) + " (LIQUIDATE)"; hfEl.style.color = "var(--danger)"; getEl("hfMarker").style.left = Math.min(33, healthFactor * 33) + "%"; } 
    else { hfEl.textContent = healthFactor > 99 ? "∞" : healthFactor.toFixed(4); if(healthFactor < 1.05) { hfEl.style.color = "var(--warning)"; getEl("hfMarker").style.left = "35%"; } else { hfEl.style.color = "var(--success)"; getEl("hfMarker").style.left = "98%"; } }
    getEl("dispDebt").textContent = "$" + totalBorrowUSDFromContract.toLocaleString('en-US', {maximumFractionDigits:2});
    getEl("dispCol").textContent = "$" + totalCollateralValue.toLocaleString('en-US', {maximumFractionDigits:2});
    getEl("dispMaxLiq").textContent = "$" + maxLiqUSD.toLocaleString('en-US', {maximumFractionDigits:2});

    if(currentTargetData.borrows.length === 0) debtList.innerHTML = "<div style='color:gray'>No debt</div>";
    else { currentTargetData.borrows.forEach(b => { const maxRepayAsset = b.amount * closeFactor; const disabledAttr = isLiquidatable ? '' : 'disabled style="opacity:0.5; cursor:not-allowed"'; const row = document.createElement("div"); row.className = "liq-row"; row.style.borderLeft = "3px solid var(--danger)"; row.innerHTML = `<div><div style="font-weight:bold;">${b.uSymbol}</div><div style="font-size:0.75rem; color:#ccc;">$${b.usd.toFixed(2)}</div></div><div style="text-align:right;"><div style="font-size:0.8rem;">Max: ${maxRepayAsset.toFixed(4)}</div><button class="liq-action-btn" ${disabledAttr} onclick="selectLiquidation('${b.address}', '${b.uSymbol}', ${b.decimals}, ${maxRepayAsset})">SELECT</button></div>`; debtList.appendChild(row); }); }
    if(currentTargetData.collaterals.length === 0) colList.innerHTML = "<div style='color:gray'>No collateral</div>";
    else { currentTargetData.collaterals.forEach(c => { const row = document.createElement("div"); row.className = "liq-row"; row.style.borderLeft = "3px solid var(--success)"; row.innerHTML = `<div><div style="font-weight:bold;">${c.symbol}</div><div style="font-size:0.75rem; color:#ccc;">${c.amountC.toFixed(2)} cTokens</div></div><div style="font-size:0.85rem; color:var(--success); font-weight:bold;">$${c.usd.toFixed(2)}</div>`; colList.appendChild(row); }); }
}

window.selectLiquidation = (cTokenDebt, uSymbol, uDecimals, maxAmount) => {
    getEl("executionPanel").style.display = "block"; getEl("repayAssetDisplay").value = uSymbol; getEl("repayAmountInput").value = maxAmount.toFixed(6);
    selectedBorrowCToken = cTokenDebt; selectedBorrowDecimals = uDecimals;
    const sel = getEl("seizeSelect"); sel.innerHTML = "";
    currentTargetData.collaterals.forEach(c => { const opt = document.createElement("option"); opt.value = c.address; opt.textContent = `${c.uSymbol} (Val: $${c.usd.toFixed(2)})`; sel.appendChild(opt); });
};

getEl("btnExecuteLiq").onclick = async () => {
    if(!signer) { alert("Connect wallet"); return; }
    const amountVal = getEl("repayAmountInput").value; const cTokenCollateral = getEl("seizeSelect").value; const targetAddr = getEl("targetInput").value;
    if(!amountVal || !cTokenCollateral) { alert("Check inputs"); return; }
    const status = getEl("liqStatus"); status.textContent = "Processing..."; status.style.color = "var(--warning)";
    try {
        const cDebt = new ethers.Contract(selectedBorrowCToken, window.C_TOKEN_ABI, provider);
        const underlyingAddr = await cDebt.underlying();
        const amountRaw = ethers.parseUnits(amountVal, selectedBorrowDecimals);
        const uToken = new ethers.Contract(underlyingAddr, window.MIN_ERC20_ABI, signer);
        const allow = await uToken.allowance(userAddress, selectedBorrowCToken);
        if(allow < amountRaw) { status.textContent = "Approving..."; const txApp = await uToken.approve(selectedBorrowCToken, ethers.MaxUint256); await txApp.wait(); }
        status.textContent = "Liquidating...";
        const cDebtSigner = new ethers.Contract(selectedBorrowCToken, window.C_TOKEN_ABI, signer);
        const txLiq = await cDebtSigner.liquidateBorrow(targetAddr, amountRaw, cTokenCollateral);
        await txLiq.wait();
        status.textContent = "SUCCESS! Collateral Seized 💰"; status.style.color = "var(--success)";
        setTimeout(() => getEl("btnScan").click(), 2500);
    } catch(e) { console.error(e); status.textContent = "Error: " + (e.shortMessage || "Reverted"); status.style.color = "var(--danger)"; }
};