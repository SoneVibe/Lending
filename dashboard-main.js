let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let currentRealLiquidityUSD = 0; 

const getEl = (id) => document.getElementById(id);
const updateStatus = (connected) => {
  const dot = getEl('statusDot');
  const txt = getEl('connStatus');
  const btn = getEl('btnConnect');
  if(connected) {
    dot.style.color = "var(--success)";
    txt.textContent = "Connected";
    btn.textContent = userAddress.substring(0,6) + "..." + userAddress.substring(38);
    btn.style.background = "rgba(255,255,255,0.1)";
  } else {
    dot.style.color = "var(--danger)";
    txt.textContent = "Disconnected";
    btn.textContent = "Connect Wallet";
    btn.style.background = "var(--accent)";
  }
};

async function connectWallet() {
  if (!window.ethereum) { alert("Please install MetaMask."); return; }
  getEl("btnConnect").textContent = "Connecting...";
  
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    NETWORKS_DATA = await window.loadNetworks();
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    
    // 1. Obtener ChainID y normalizar a decimal
    const chainIdHex = await provider.send("eth_chainId", []);
    const chainIdDecimal = parseInt(chainIdHex, 16);
    
    console.log("Detected ChainID:", chainIdDecimal); // Debug

    // 2. Buscar red activa (comparación flexible string/number)
    ACTIVE = Object.values(NETWORKS_DATA).find(n => 
        (parseInt(n.chainId) === chainIdDecimal) && n.enabled
    );
    
    // 3. Auto-Switch si es necesario
    if(!ACTIVE) {
        console.log("Network not found in JSON. Attempting switch to Soneium (1868)...");
        const targetNetwork = Object.values(NETWORKS_DATA).find(n => parseInt(n.chainId) === 1868 && n.enabled);
        
        if (targetNetwork) {
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: "0x" + Number(targetNetwork.chainId).toString(16) }],
                });
                window.location.reload();
                return;
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
                        window.location.reload();
                        return;
                    } catch (addError) {
                        console.error("Add chain failed", addError);
                    }
                }
            }
        }
        alert(`Wrong Network (ChainID: ${chainIdDecimal}). Please switch to Soneium Mainnet.`);
        updateStatus(false);
        getEl("btnConnect").textContent = "Connect Wallet";
        return;
    }
    
    console.log("Active Network:", ACTIVE.label);
    console.log("Markets found:", ACTIVE.cTokens ? ACTIVE.cTokens.length : 0);

    // Si llegamos aquí, todo bien
    updateStatus(true);
    fillHypotheticalAssetSelect();
    fillActionAssets();
    await refreshDashboard();
    
  } catch (e) {
    console.error("Connection Error:", e);
    updateStatus(false);
    getEl("btnConnect").textContent = "Connect Wallet";
  }
}

getEl("btnConnect").onclick = connectWallet;

async function refreshDashboard() {
  // Renderizar mercados primero para asegurar que la tabla se llene
  await renderMarkets();
  // Luego el resto
  await Promise.all([
    renderAccountStats(),
    renderVibeVault()
  ]);
}

// ------------------------------------------------------------------
// MAIN RENDERING LOGIC
// ------------------------------------------------------------------
async function renderMarkets() {
  if(!ACTIVE || !userAddress) return;
  
  // SAFETY CHECK: Si no hay cTokens definidos, salir
  if (!ACTIVE.cTokens || ACTIVE.cTokens.length === 0) {
      console.warn("No markets configured in networks.json for this network.");
      getEl("marketsBody").innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px;">No markets configured</td></tr>`;
      return;
  }

  const ICON_MAP = { ASTR:"icons/astr.svg", WBTC:"icons/bitcoin.svg", DOT:"icons/dot.svg", WETH:"icons/weth.svg", USDC:"icons/usdc.svg" };
  const tbody = getEl("marketsBody");
  tbody.innerHTML = ""; // Limpiar tabla
  
  const blocksPerYear = ACTIVE.blocksPerYear || 15768000;
  const master = new ethers.Contract(ACTIVE.master, window.MASTER_ABI, provider);
  
  // Inicializar rewards si existen
  let vault = null;
  if (window.REWARDS_ADDRESS && window.REWARDS_ADDRESS !== "0x0000000000000000000000000000000000000000") {
      vault = new ethers.Contract(window.REWARDS_ADDRESS, window.REWARDS_ABI, provider);
  }
  
  let oracle = null;
  let enteredAssets = [];
  
  try {
      const oracleAddr = await master.oracle();
      oracle = new ethers.Contract(oracleAddr, window.ORACLE_ABI, provider);
      const assetsIn = await master.getAssetsIn(userAddress);
      enteredAssets = assetsIn.map(a => a.toLowerCase());
  } catch(e) { console.error("Init Data Error (Oracle/AssetsIn):", e); }

  let vaultApyHTML = "";
  let totalAnnualIncome = 0, totalAnnualCost = 0, totalSuppliedUSD = 0, totalBorrowedUSD = 0;
  let globalNetWorth = 0;

  // Iterar sobre mercados
  for(const m of ACTIVE.cTokens){
    try {
      const c = new ethers.Contract(m.address, window.C_TOKEN_ABI, provider);
      const cTokenDecimals = 18;
      const underlyingDecimals = m.underlyingDecimals || 18;

      // Promise.allSettled es mejor para evitar que un fallo rompa toda la tabla, 
      // pero mantendremos Promise.all para velocidad, con try/catch individual.
      const [
        totalSupplyBig, totalBorrowsBig,
        userCTokensBig, userBorrowsBig,
        rates, exchRateRaw
      ] = await Promise.all([
        c.totalSupply(), 
        c.totalBorrows(),
        c.balanceOf(userAddress), 
        c.borrowBalance(userAddress),
        c.peekRates(), 
        c.exchangeRateStored()
      ]);

      // Obtener precio separado para no fallar si oracle falla
      let priceRaw = 0n;
      if (oracle) {
          try { priceRaw = await oracle.getUnderlyingPrice(m.address); } catch {}
      }

      const isEntered = enteredAssets.includes(m.address.toLowerCase());
      const userCTokens = Number(userCTokensBig.toString());
      const exchangeRate = Number(exchRateRaw.toString());
      
      const userSupplyUnderlying = userCTokens * exchangeRate / (Math.pow(10, cTokenDecimals) * 1e18);
      const userBorrows = Number(userBorrowsBig.toString());
      const userBorrowsUnderlying = userBorrows / Math.pow(10, underlyingDecimals);

      let priceUSD = 0;
      if (priceRaw > 0n) {
          priceUSD = parseFloat(ethers.formatUnits(priceRaw, 18));
      }

      const supplyAPY = rates && rates[1] ? ratePerBlockToAPY(rates[1], blocksPerYear) : 0;
      const borrowAPY = rates && rates[0] ? ratePerBlockToAPY(rates[0], blocksPerYear) : 0;

      // Cálculo de Rewards VIBE (si existe vault)
      let vibeSupplyAPY = 0, vibeBorrowAPY = 0;
      if (vault) {
         try {
             const [sSpeed, bSpeed] = await Promise.all([vault.vibeSupplySpeed(m.address), vault.vibeBorrowSpeed(m.address)]);
             
             const totalSupplyNum = Number(totalSupplyBig.toString());
             const totalSupUnderlying = totalSupplyNum * exchangeRate / (Math.pow(10, cTokenDecimals) * 1e18);
             
             const totalBorrowsNum = Number(totalBorrowsBig.toString());
             const totalBorUnderlying = totalBorrowsNum / Math.pow(10, underlyingDecimals);
             
             const vibePerSupplyYear = Number(sSpeed.toString()) * blocksPerYear / 1e18;
             const vibePerBorrowYear = Number(bSpeed.toString()) * blocksPerYear / 1e18;
             
             // Evitar división por cero
             if(totalSupUnderlying > 0.1) vibeSupplyAPY = (vibePerSupplyYear / totalSupUnderlying) * 100;
             if(totalBorUnderlying > 0.1) vibeBorrowAPY = (vibePerBorrowYear / totalBorUnderlying) * 100;
             
             if(vibeSupplyAPY > 0.01 || vibeBorrowAPY > 0.01) {
                vaultApyHTML += `<div style="background:rgba(255,255,255,0.05); padding:8px 12px; border-radius:8px; font-size:0.85rem; margin-bottom:4px;"><strong style="color:var(--warning)">${m.symbol}</strong><br>Sup: ${vibeSupplyAPY.toFixed(2)}% | Bor: ${vibeBorrowAPY.toFixed(2)}%</div>`;
             }
         } catch (errRewards) { console.warn("Rewards Error:", errRewards); }
      }

      const positionSupplyUSD = userSupplyUnderlying * priceUSD;
      const positionBorrowUSD = userBorrowsUnderlying * priceUSD;
      globalNetWorth += (positionSupplyUSD - positionBorrowUSD);
      totalSuppliedUSD += positionSupplyUSD; 
      totalBorrowedUSD += positionBorrowUSD;
      totalAnnualIncome += positionSupplyUSD * ((supplyAPY + vibeSupplyAPY) / 100);
      totalAnnualCost += positionBorrowUSD * ((borrowAPY - vibeBorrowAPY) / 100);

      const uSym = m.underlyingSymbol || m.symbol.replace(/^c/,"");
      const icon = m.icon || ICON_MAP[uSym] || "icons/unknown.svg";
      const totalGovAPY = vibeSupplyAPY + vibeBorrowAPY;
      const displayDecimals = (uSym === 'WBTC' || uSym === 'BTC' || uSym === 'ETH' || uSym === 'WETH') ? 6 : 2;

      const tr = document.createElement("tr");
      const toggleHtml = `
        <label class="switch">
          <input type="checkbox" ${isEntered ? 'checked' : ''} onchange="toggleCollateral('${m.address}', ${!isEntered})">
          <span class="slider"></span>
        </label>
      `;

      tr.innerHTML = `
        <td>
            <div class="asset-flex">
                <img src="${icon}" class="asset-icon" onerror="this.src='icons/unknown.svg'">
                <div>
                    <div>${uSym}</div>
                    <div style="font-size:0.7em; color:var(--text-muted); font-weight:400;">${m.symbol}</div>
                </div>
            </div>
        </td>
        <td>$${priceUSD.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
        <td>${toggleHtml}</td>
        <td>${formatNumber(userSupplyUnderlying, displayDecimals)} <span style="font-size:0.75em; opacity:0.7">${uSym}</span></td>
        <td><span class="apy-badge">${supplyAPY.toFixed(2)}%</span></td>
        <td>${formatNumber(userBorrowsUnderlying, displayDecimals)} <span style="font-size:0.75em; opacity:0.7">${uSym}</span></td>
        <td><span class="apy-badge borrow">${borrowAPY.toFixed(2)}%</span></td>
        <td><span style="color:var(--warning); font-weight:600; font-size:0.9em;">${totalGovAPY > 0 ? totalGovAPY.toFixed(2) + "%" : "-"}</span></td>
      `;
      tbody.appendChild(tr);
    } catch(e) { 
        console.error(`Row Render Error for ${m.symbol}:`, e); 
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${m.symbol}</td><td colspan="7" style="color:var(--danger)">Error loading data</td>`;
        tbody.appendChild(tr);
    }
  }
  
  // Actualizar Globales
  getEl("netWorthDisplay").textContent = "$" + globalNetWorth.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  const totalEquity = totalSuppliedUSD - totalBorrowedUSD;
  let netAPY = 0;
  if (totalEquity > 0) netAPY = ((totalAnnualIncome - totalAnnualCost) / totalEquity) * 100;
  
  const netApyEl = getEl("netApyDisplay");
  netApyEl.textContent = netAPY.toFixed(2) + "%";
  netApyEl.style.color = netAPY >= 0 ? "var(--success)" : "var(--danger)";
  
  if(vaultApyHTML) {
      getEl("vaultApyContainer").innerHTML = vaultApyHTML;
  } else {
      getEl("vaultApyContainer").innerHTML = `<span class="text-muted">No active rewards</span>`;
  }
}

window.toggleCollateral = async (cTokenAddr, shouldEnter) => {
    if(!signer || !ACTIVE) return;
    const master = new ethers.Contract(ACTIVE.master, window.MASTER_ABI, signer);
    const statusEl = getEl("quickStatus");
    const checkboxes = document.querySelectorAll('.switch input');
    checkboxes.forEach(c => c.disabled = true); // Disable all while processing

    try {
        if(statusEl) {
            statusEl.textContent = shouldEnter ? "Enabling Collateral..." : "Disabling Collateral...";
            statusEl.style.color = "var(--warning)";
        }
        let tx;
        if (shouldEnter) tx = await master.enterMarkets([cTokenAddr]);
        else tx = await master.exitMarket(cTokenAddr);
        
        await tx.wait();
        if(statusEl) { statusEl.textContent = "Success!"; statusEl.style.color = "var(--success)"; }
        await refreshDashboard();
    } catch(e) {
        console.error(e);
        if(statusEl) {
            const msg = e.message.includes("revert") ? "Cannot disable (Liquidity Risk)" : "Transaction Failed";
            statusEl.textContent = msg; statusEl.style.color = "var(--danger)";
        }
        // Recargar para restaurar el estado visual correcto del toggle
        setTimeout(refreshDashboard, 2000);
    }
};

// --- ACCOUNT STATS (Health Factor & Bars) ---
async function renderAccountStats() {
  if (!userAddress || !ACTIVE) return;
  try {
    const master = new ethers.Contract(ACTIVE.master, window.MASTER_ABI, provider);
    const res = await master.getAccountLiquidity(userAddress);
    // Soporte para diferentes retornos de ethers.js v6
    const ld = res.ld ? res.ld : res;
    
    // [1] Liquidation Threshold, [2] Borrow USD
    const liquidationThresholdUSD = Number(ld[1].toString())/1e18;
    const borrowUSD = Number(ld[2].toString())/1e18;
    
    currentRealLiquidityUSD = liquidationThresholdUSD - borrowUSD;
    
    // 1. Health Factor
    let hf = 0;
    if (borrowUSD > 0) {
        hf = liquidationThresholdUSD / borrowUSD;
    } else {
        hf = Infinity;
    }

    const hfEl = getEl("healthFactor");
    if(hf === Infinity) { hfEl.textContent = "∞"; hfEl.style.color = "var(--success)"; }
    else { 
        hfEl.textContent = hf.toFixed(2); 
        if (hf < 1.0) hfEl.style.color = "var(--danger)"; 
        else if (hf < 1.1) hfEl.style.color = "var(--danger)"; 
        else if (hf < 1.5) hfEl.style.color = "var(--warning)"; 
        else hfEl.style.color = "var(--success)"; 
    }

    // 2. Barra de Colateral
    let percent = liquidationThresholdUSD === 0 ? 0 : (borrowUSD / liquidationThresholdUSD) * 100;
    if(borrowUSD > 0 && liquidationThresholdUSD === 0) percent = 110;

    const bar = getEl("collateralBar");
    const barTxt = getEl("collateralBarText");
    
    bar.style.width = Math.min(100, percent) + "%";
    
    if (percent >= 100) {
        bar.style.background = "var(--danger)";
        barTxt.style.color = "var(--danger)";
        barTxt.textContent = percent.toFixed(1) + "% (LIQUIDATABLE)";
    } else if (percent > 85) {
        bar.style.background = "var(--danger)";
        barTxt.style.color = "var(--danger)";
        barTxt.textContent = percent.toFixed(1) + "% Risk";
    } else if (percent > 60) {
        bar.style.background = "var(--warning)";
        barTxt.style.color = "var(--warning)";
        barTxt.textContent = percent.toFixed(1) + "% Used";
    } else {
        bar.style.background = "linear-gradient(90deg, var(--success), #00ffaa)";
        barTxt.style.color = "#fff";
        barTxt.textContent = percent.toFixed(1) + "% Used";
    }

  } catch (e) { console.error("Account Stats Error:", e); }
}

async function renderVibeVault() {
  if (!window.REWARDS_ADDRESS || window.REWARDS_ADDRESS === "0x0000000000000000000000000000000000000000" || !userAddress) {
      getEl("vibeRewards").textContent = "—";
      return;
  }
  try {
    const vault = new ethers.Contract(window.REWARDS_ADDRESS, window.REWARDS_ABI, provider);
    const pending = await vault.vibeAccrued(userAddress);
    const pendingFmt = Number(pending.toString())/1e18;
    getEl("vibeRewards").textContent = pendingFmt.toLocaleString('en-US', {maximumFractionDigits:4});
    const btn = getEl("claimVibe");
    btn.disabled = pendingFmt < 0.0001;
    
    btn.onclick = async () => {
       if(!signer) return;
       const vS = new ethers.Contract(window.REWARDS_ADDRESS, window.REWARDS_ABI, signer);
       try { 
         btn.textContent = "Claiming..."; 
         const tx = await vS.claimVIBE(userAddress);
         await tx.wait(); 
         btn.textContent = "Claim VIBE"; 
         renderVibeVault(); 
       } catch(e) { 
           console.error(e);
           alert("Error claiming rewards"); 
           btn.textContent = "Claim VIBE"; 
       }
    };
  } catch {}
}

function fillActionAssets() {
  if(!ACTIVE || !ACTIVE.cTokens) return;
  const sel = getEl("quickAsset");
  sel.innerHTML = "";
  ACTIVE.cTokens.forEach(x => {
    const opt = document.createElement("option");
    opt.value = x.address;
    opt.dataset.decimals = x.underlyingDecimals || 18; 
    opt.dataset.underlying = x.underlying;
    opt.textContent = x.symbol;
    sel.appendChild(opt);
  });
}

getEl("btnQuickExecute").onclick = async () => {
    if (!signer || !ACTIVE) { alert("Connect wallet first"); return; }
    const statusEl = getEl("quickStatus");
    const sel = getEl("quickAsset");
    const cAddr = sel.value;
    if(!cAddr) return;

    const selectedOpt = sel.selectedOptions[0];
    const uDecimals = parseInt(selectedOpt.dataset.decimals || 18);
    const uAddr = selectedOpt.dataset.underlying;
    const action = getEl("quickAction").value;
    const amountStr = getEl("quickAmount").value;

    if (!amountStr || parseFloat(amountStr) <= 0) { alert("Invalid amount"); return; }

    statusEl.textContent = "Processing...";
    statusEl.style.color = "var(--warning)";

    try {
        const cToken = new ethers.Contract(cAddr, window.C_TOKEN_ABI, signer);
        const rawAmount = ethers.parseUnits(amountStr, uDecimals);

        if (action === "mint") {
            await ensureAllowance(uAddr, cAddr, rawAmount, statusEl);
            statusEl.textContent = "Minting...";
            const tx = await cToken.mint(rawAmount);
            await tx.wait();
            statusEl.textContent = "Success!";
        } 
        else if (action === "borrow") {
            const master = new ethers.Contract(ACTIVE.master, window.MASTER_ABI, signer);
            const assetsIn = await master.getAssetsIn(userAddress);
            const isEntered = assetsIn.map(a => a.toLowerCase()).includes(cAddr.toLowerCase());
            
            if (!isEntered) {
                statusEl.textContent = "Enabling Market...";
                const txEnter = await master.enterMarkets([cAddr]);
                await txEnter.wait();
            }

            statusEl.textContent = "Borrowing...";
            const tx = await cToken.borrow(rawAmount);
            await tx.wait();
            statusEl.textContent = "Success!";
        }
        else if (action === "repay") {
            await ensureAllowance(uAddr, cAddr, rawAmount, statusEl);
            statusEl.textContent = "Repaying...";
            const tx = await cToken.repay(rawAmount);
            await tx.wait();
            statusEl.textContent = "Success!";
        }
        else if (action === "redeem") {
            statusEl.textContent = "Calc cTokens...";
            const exchRate = await cToken.exchangeRateStored();
            // Convertir Underlying Amount a cTokens
            // Formula: cTokens = (AmountUnderlying * 1e18) / ExchangeRate
            // Ajustar decimales si es necesario
            let normalizedAmount = rawAmount;
            if (uDecimals < 18) {
                normalizedAmount = rawAmount * (10n ** BigInt(18 - uDecimals));
            } else if (uDecimals > 18) {
                normalizedAmount = rawAmount / (10n ** BigInt(uDecimals - 18));
            }
            const redeemCTokens = (normalizedAmount * 1000000000000000000n) / exchRate;
            
            statusEl.textContent = "Redeeming...";
            const tx = await cToken.redeem(redeemCTokens);
            await tx.wait();
            statusEl.textContent = "Success!";
        }

        statusEl.style.color = "var(--success)";
        setTimeout(() => { statusEl.textContent = "Ready"; statusEl.style.color = "var(--text-muted)"; }, 3000);
        await refreshDashboard();

    } catch (e) {
        console.error(e);
        let errMsg = e.shortMessage || e.message || "Error";
        if(errMsg.includes("User rejected")) errMsg = "User Rejected";
        statusEl.textContent = "Failed: " + errMsg;
        statusEl.style.color = "var(--danger)";
    }
};

async function ensureAllowance(tokenAddr, spender, amount, statusEl) {
    const token = new ethers.Contract(tokenAddr, window.MIN_ERC20_ABI, signer);
    const allowance = await token.allowance(userAddress, spender);
    if (allowance < amount) {
        statusEl.textContent = "Approving...";
        const tx = await token.approve(spender, ethers.MaxUint256);
        await tx.wait();
        statusEl.textContent = "Approved!";
    }
}

function fillHypotheticalAssetSelect() {
  if(!ACTIVE || !ACTIVE.cTokens) return;
  const sel = getEl("hypAssetSelect");
  sel.innerHTML = "";
  ACTIVE.cTokens.forEach(x => {
    const opt = document.createElement("option");
    opt.value = x.address;
    opt.dataset.decimals = x.underlyingDecimals || 18; 
    opt.textContent = x.symbol;
    sel.appendChild(opt);
  });
}

getEl("hypotheticalForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!userAddress) { alert("Connect wallet first"); return; }
  
  const sel = getEl("hypAssetSelect");
  if(!sel.value) return;
  const assetAddr = sel.value;
  const underlyingDecimals = parseInt(sel.selectedOptions[0].dataset.decimals || 18);
  const action = getEl("hypActionType").value; 
  const amountVal = getEl("hypAmount").value;

  if(!amountVal || parseFloat(amountVal) <= 0) { alert("Enter valid amount"); return; }

  const rawAmount = ethers.parseUnits(amountVal, underlyingDecimals); 
  let redeem = 0n, borrow = 0n;
  
  if (action === "borrow") borrow = rawAmount;
  else {
    try {
        const c = new ethers.Contract(assetAddr, window.C_TOKEN_ABI, provider);
        const exchRate = await c.exchangeRateStored();
        let normalizedAmount = rawAmount;
        if (underlyingDecimals < 18) normalizedAmount = rawAmount * (10n ** BigInt(18 - underlyingDecimals));
        else if (underlyingDecimals > 18) normalizedAmount = rawAmount / (10n ** BigInt(underlyingDecimals - 18));
        redeem = (normalizedAmount * 1000000000000000000n) / exchRate;
    } catch(e) { console.error(e); return; }
  }

  try {
    const btn = e.target.querySelector("button");
    const oldTxt = btn.textContent;
    btn.textContent = "Simulating...";

    const master = new ethers.Contract(ACTIVE.master, window.MASTER_ABI, provider);
    const res = await master.getHypotheticalAccountLiquidity(userAddress, assetAddr, redeem, borrow);
    const ldNew = res.ldNew ? res.ldNew : (res[0] ? res[0] : res); 
    
    const liqLimitUSD = Number(ldNew.liquidationUSD.toString()) / 1e18; 
    const bUSD = Number(ldNew.borrowUSD.toString()) / 1e18;
    
    let percent = 0;
    if (liqLimitUSD > 0) percent = (bUSD / liqLimitUSD) * 100;
    else if (bUSD > 0) percent = 110;
    
    const bar = getEl("hypotheticalCollateralBar");
    const txt = getEl("hypotheticalCollateralBarText");
    
    if (action === "redeem" && Math.abs(liqLimitUSD - currentRealLiquidityUSD) < 0.01) {
         txt.textContent = "No Change (Asset not used as collateral)";
         txt.style.color = "var(--text-muted)";
         bar.style.width = "0%";
         bar.style.background = "transparent";
    } else {
         const visualPercent = Math.min(100, percent);
         bar.style.width = visualPercent + "%";
         txt.style.opacity = "1";
         txt.textContent = percent.toFixed(2) + "% (Simulated)";
         
         if(percent >= 100) { bar.style.background = "var(--danger)"; txt.style.color = "var(--danger)"; } 
         else if(percent > 90) { bar.style.background = "rgba(255, 85, 85, 0.6)"; txt.style.color = "var(--danger)"; } 
         else { bar.style.background = "rgba(249, 224, 97, 0.5)"; txt.style.color = "var(--warning)"; }
    }
    btn.textContent = oldTxt;
  } catch(e) { 
    console.error(e);
    alert("Simulation failed.");
    e.target.querySelector("button").textContent = "Simulate Impact";
  }
};

function formatNumber(n, dp=2) { return Number(n).toLocaleString('en-US', {minimumFractionDigits:dp, maximumFractionDigits:dp}); }
function ratePerBlockToAPY(rate, blocks) { const r = Number(rate)/1e18; return r <= 0 ? 0 : ((Math.pow(1+r, blocks)-1)*100); }
