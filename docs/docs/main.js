// ABIs global
const C_TOKEN_ABI   = window.C_TOKEN_ABI;
const MASTER_ABI    = window.MASTER_ABI;
const MIN_ERC20_ABI = window.MIN_ERC20_ABI;
const REWARDS_ABI   = window.REWARDS_ABI;
let VIBE_VAULT_ADDR = window.REWARDS_ADDRESS;

let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;

// UI tags
const btnConnect       = document.getElementById("btnConnect");
const btnEnter         = document.getElementById("btnEnter");
const walletAddrSpan   = document.getElementById("walletAddr");
const networkTag       = document.getElementById("networkTag");
const networkSelect    = document.getElementById("networkSelect");
const marketsBody      = document.getElementById("marketsBody");
const hfValue          = document.getElementById("hfValue");
const liqUSDSpan       = document.getElementById("liqUSD");
const borUSDSpan       = document.getElementById("borUSD");
const actionCTokenSel  = document.getElementById("actionCToken");
const actionTypeSel    = document.getElementById("actionType");
const actionAmountInput= document.getElementById("actionAmount");
const btnDo            = document.getElementById("btnDo");
const txStatus         = document.getElementById("txStatus");

const vaultVibeRewards    = document.getElementById("vaultVibeRewards");
const btnVaultClaimVibe   = document.getElementById("btnVaultClaimVibe");
const vaultVibeStatus     = document.getElementById("vaultVibeStatus");
const vaultVibeWallet     = document.getElementById("vaultVibeWallet");
const vaultVibeAPYSupply  = document.getElementById("vaultVibeAPYSupply");
const vaultVibeAPYBorrow  = document.getElementById("vaultVibeAPYBorrow");

const ICON_MAP = { ASTR: "icons/astr.svg", USDC: "icons/usdc.svg" };

function formatNumber(n, dp=2) {
  return Number(n).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:dp});
}

function ratePerBlockToAPY(rateMantissa, blocksPerYear) {
  const r = Number(rateMantissa)/1e18;
  if (r <= 0) return 0;
  if (r > 0.5) return r * blocksPerYear * 100;
  return (Math.pow(1+r, blocksPerYear)-1)*100;
}

// NETWORKS (ACTUALIZADA)
async function initNetworks() {
  NETWORKS_DATA = await window.loadNetworks();
  // Opcional: si tienes un select de redes en la landing
  if(networkSelect) {
      const enabled = window.listEnabledNetworks(NETWORKS_DATA);
      networkSelect.innerHTML = "";
      for (const n of enabled) {
        const opt = document.createElement("option");
        opt.value = n.slug;
        opt.textContent = n.label;
        networkSelect.appendChild(opt);
      }
  }
}

async function detectActiveNetwork() {
  const chainIdHex = await provider.send("eth_chainId", []);
  const chainIdDecimal = parseInt(chainIdHex, 16);
  
  ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === chainIdDecimal) && n.enabled);
  
  if (!ACTIVE) {
    if(networkTag) networkTag.textContent = "Red no soportada";
    if(txStatus) txStatus.textContent = "Cambia a una red soportada.";
    return false;
  }
  if(networkTag) networkTag.textContent = "Red: " + ACTIVE.label;
  if(networkSelect) networkSelect.value = ACTIVE.slug;
  return true;
}

if(btnConnect) {
    btnConnect.onclick = async () => {
      if (!window.ethereum) { alert("Instala MetaMask"); return; }
      provider = new ethers.BrowserProvider(window.ethereum);
      await initNetworks();
      await provider.send("eth_requestAccounts", []);
      signer = await provider.getSigner();
      userAddress = await signer.getAddress();
      if(walletAddrSpan) walletAddrSpan.textContent = userAddress;
      
      // AUTO-SWITCH INTEGRADO AQUÍ
      const chainIdHex = await provider.send("eth_chainId", []);
      const chainIdDecimal = parseInt(chainIdHex, 16);
      ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === chainIdDecimal) && n.enabled);
      
      if(!ACTIVE) {
         const targetNetwork = Object.values(NETWORKS_DATA).find(n => n.chainId == "1868" && n.enabled);
         if(targetNetwork) {
             try {
                 await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: "0x" + Number(targetNetwork.chainId).toString(16) }]
                 });
                 window.location.reload();
                 return;
             } catch(err) {
                 if(err.code === 4902) {
                     try {
                         await window.ethereum.request({
                            method: 'wallet_addEthereumChain',
                            params: [{
                                chainId: "0x" + Number(targetNetwork.chainId).toString(16),
                                chainName: targetNetwork.label,
                                rpcUrls: targetNetwork.rpcUrls,
                                blockExplorerUrls: targetNetwork.blockExplorerUrls,
                                nativeCurrency: targetNetwork.nativeCurrency
                            }]
                         });
                         window.location.reload();
                         return;
                     } catch(e){}
                 }
             }
         }
         alert("Red Incorrecta. Conecta a Soneium Mainnet.");
         return;
      }

      const ok = await detectActiveNetwork();
      if (ok && typeof fillActionSelect === "function" && typeof refreshAll === "function") {
        fillActionSelect();
        await refreshAll();
      }
    };
}

if(networkSelect) {
    networkSelect.onchange = async (e) => {
      const slug = e.target.value;
      const target = window.getNetworkBySlug(NETWORKS_DATA, slug);
      if (!target) return;
      try {
        await window.ethereum.request({
          method:'wallet_switchEthereumChain',
          params:[{ chainId: "0x" + Number(target.chainId).toString(16) }]
        });
        window.location.reload();
      } catch (err) {
        if(txStatus) txStatus.textContent = "No se pudo cambiar de red";
      }
    };
}

if(btnEnter) {
    btnEnter.onclick = async () => {
      if (!signer || !ACTIVE) { alert("Conecta wallet y red"); return; }
      try {
        const master = new ethers.Contract(ACTIVE.master, MASTER_ABI, signer);
        txStatus.textContent = "enterMarkets...";
        const tx = await master.enterMarkets(ACTIVE.cTokens.map(m=>m.address));
        await tx.wait();
        txStatus.textContent = "enterMarkets ok";
        await refreshAll();
      } catch (e) {
        txStatus.textContent = "Error enterMarkets";
      }
    };
}

function fillActionSelect() {
  if(!actionCTokenSel) return;
  actionCTokenSel.innerHTML = "";
  for (const m of ACTIVE.cTokens) {
    const opt = document.createElement("option");
    const uSym = m.underlyingSymbol || m.symbol.replace(/^c/,"");
    opt.value = m.address;
    opt.textContent = `${uSym} (${m.symbol})`;
    actionCTokenSel.appendChild(opt);
  }
}

// --- PANEL LENDING (Solo si existe la tabla) ---
async function refreshAll() {
  if(!marketsBody) return;
  marketsBody.innerHTML = "";
  const blocksPerYear = ACTIVE.blocksPerYear || 15768000;
  for (const m of ACTIVE.cTokens) {
    try {
      const c = new ethers.Contract(m.address, C_TOKEN_ABI, provider);
      const cTokenDecimals = 18;
      const underlyingDecimals = m.underlyingDecimals || 18;

      const [
        totalSupplyBig, totalBorrowsBig,
        userCTokensBig, userBorrowsBig,
        rates, exchRateRaw
      ] = await Promise.all([
        c.totalSupply(),
        c.totalBorrows(),
        userAddress ? c.balanceOf(userAddress) : 0n,
        userAddress ? c.borrowBalance(userAddress) : 0n,
        c.peekRates(),
        c.exchangeRateStored()
      ]);
      const totalSupply   = Number(totalSupplyBig.toString());
      const totalBorrows  = Number(totalBorrowsBig.toString());
      const userCTokens   = Number(userCTokensBig.toString());
      const userBorrows   = Number(userBorrowsBig.toString());
      const exchangeRate  = exchRateRaw ? Number(exchRateRaw.toString()) : 1e18;

      const totalSupplyFmtC       = formatNumber(totalSupply / Math.pow(10, cTokenDecimals), 2);
      const totalSupplyUnderlying = totalSupply * exchangeRate / (Math.pow(10, cTokenDecimals) * 1e18);
      const totalSupplyFmtUnderlying = formatNumber(totalSupplyUnderlying, 2);

      const totalBorrowFmt        = formatNumber(totalBorrows / Math.pow(10, underlyingDecimals), 2);

      const userSupplyUnderlying  = userCTokens * exchangeRate / (Math.pow(10, cTokenDecimals) * 1e18);
      const userSupplyFmtC        = formatNumber(userCTokens / Math.pow(10, cTokenDecimals), 4);
      const userSupplyFmtUnderlying = formatNumber(userSupplyUnderlying, 4);
      const userDebtFmtUnderlying = formatNumber(userBorrows / Math.pow(10, underlyingDecimals), 4);

      const supplyAPY = rates && rates[1] ? ratePerBlockToAPY(rates[1], blocksPerYear) : 0;
      const borrowAPY = rates && rates[0] ? ratePerBlockToAPY(rates[0], blocksPerYear) : 0;
      const utilPct   = rates && rates[2] ? (Number(rates[2].toString())/1e18*100).toFixed(1) : "0.0";

      const uSym = m.underlyingSymbol || m.symbol.replace(/^c/,"");
      const icon = m.icon || ICON_MAP[uSym] || "icons/unknown.svg";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="assetCell">
          <img src="${icon}" alt="${uSym}" style="width:22px;height:22px;border-radius:50%;margin-right:6px;vertical-align:middle;" onerror="this.src='icons/unknown.svg';"/>
          <div style="display:inline-block;">
            <strong>${uSym}</strong><br/>
            <span class="muted">${m.symbol}</span>
          </div>
        </td>
        <td>
          ${totalSupplyFmtC} <span class="muted">${m.symbol}</span><br>
          <span style="font-size:11px;color:#8fa2b7;">(~${totalSupplyFmtUnderlying} ${uSym})</span>
        </td>
        <td><span style="font-weight:bold;color:#2d6cdf;">${supplyAPY.toFixed(2)}%</span></td>
        <td>${totalBorrowFmt}</td>
        <td><span style="font-weight:bold;color:#ffb347;">${borrowAPY.toFixed(2)}%</span></td>
        <td>
          <span style="display:inline-block;">
            Supply: <span style="color:#64fa;">${userSupplyFmtUnderlying} ${uSym}</span><br/>
            <span class="muted">${userSupplyFmtC} ${m.symbol}</span><br/>
            Debt: ${userDebtFmtUnderlying} ${uSym}<br/>
            Util: <span style="font-weight:bold;color:#5ed0a4;">${utilPct}%</span>
          </span>
        </td>
      `;
      marketsBody.appendChild(tr);
    } catch (e) {
      console.error(`Error en el mercado ${m.symbol}:`, e);
    }
  }
  if (userAddress) {
    try {
      const master = new ethers.Contract(ACTIVE.master, MASTER_ABI, provider);
      const res = await master.getAccountLiquidity(userAddress);
      const ld = res.ld ? res.ld : res;
      const borrowPower = Number(ld.liquidationUSD)/1e18;
      const borrowed    = Number(ld.borrowUSD)/1e18;
      const hf = ld.borrowUSD === 0n ? Infinity : borrowPower / borrowed;
      if(liqUSDSpan) liqUSDSpan.textContent = borrowPower.toFixed(2);
      if(borUSDSpan) borUSDSpan.textContent = borrowed.toFixed(2);
      if(hfValue) hfValue.textContent = hf === Infinity ? "∞" : hf.toFixed(2);
    } catch {}
  }
  await updateVibeVault();
}

if(btnDo) {
    btnDo.onclick = async () => {
      if (!signer || !ACTIVE) { alert("Conecta wallet"); return; }
      const cAddr = actionCTokenSel.value;
      const action = actionTypeSel.value;
      const amountStr = actionAmountInput.value.trim();
      if (!amountStr) { alert("Ingresa monto"); return; }
      const m = ACTIVE.cTokens.find(x => x.address === cAddr);
      const cTokenDecimals = 18;
      const decimals = action === "redeem" ? cTokenDecimals : m.underlyingDecimals;
      const raw = parseToRaw(amountStr, decimals);
      if (raw === 0n) { alert("Monto inválido"); return; }
      const c = new ethers.Contract(cAddr, C_TOKEN_ABI, signer);
      try {
        if (action === "mint") {
          if (!m.skipAllowance) {
            await ensureAllowance(m.underlying, cAddr, raw);
          }
          txStatus.textContent = "Mint...";
          const tx = await c.mint(raw); await tx.wait(); txStatus.textContent = "Mint ok";
        } else if (action === "redeem") {
          txStatus.textContent = "Redeem...";
          const tx = await c.redeem(raw); await tx.wait(); txStatus.textContent = "Redeem ok";
        } else if (action === "borrow") {
          txStatus.textContent = "Borrow...";
          const tx = await c.borrow(raw); await tx.wait(); txStatus.textContent = "Borrow ok";
        } else if (action === "repay") {
          if (!m.skipAllowance) {
            await ensureAllowance(m.underlying, cAddr, raw);
          }
          txStatus.textContent = "Repay...";
          const tx = await c.repay(raw); await tx.wait(); txStatus.textContent = "Repay ok";
        }
        await refreshAll();
      } catch (e) {
        txStatus.textContent = "Error: " + (e.shortMessage || e.message);
      }
    };
}

async function updateVibeVault() {
  if (!provider || !userAddress || !VIBE_VAULT_ADDR) return;
  const vault = new ethers.Contract(VIBE_VAULT_ADDR, REWARDS_ABI, provider);
  try {
    const pending = await vault.vibeAccrued(userAddress);
    const pendingFmt = Number(pending)/1e18;
    if(vaultVibeRewards) vaultVibeRewards.textContent = pendingFmt.toLocaleString('en-US', {maximumFractionDigits:6});
    if(btnVaultClaimVibe) btnVaultClaimVibe.disabled = pendingFmt < 0.0001;

    let vibeTokenAddr = await vault.vibeTokenExternal();
    if (!vibeTokenAddr || vibeTokenAddr === "0x0000000000000000000000000000000000000000") {
      if(vaultVibeWallet) vaultVibeWallet.textContent = "—";
    } else {
      const vibeToken = new ethers.Contract(vibeTokenAddr, MIN_ERC20_ABI, provider);
      const vibeBal   = await vibeToken.balanceOf(userAddress);
      const vibeBalFmt= Number(vibeBal)/1e18;
      if(vaultVibeWallet) vaultVibeWallet.textContent = vibeBalFmt.toLocaleString('en-US', {maximumFractionDigits:6});
    }
    await updateVibeAPY(vault, vibeTokenAddr);
  } catch(e) {}
}

if(btnVaultClaimVibe) btnVaultClaimVibe.onclick = vaultClaimVibe;

async function vaultClaimVibe() {
  if (!signer || !userAddress || !VIBE_VAULT_ADDR) return;
  try {
    const vaultSigner = new ethers.Contract(VIBE_VAULT_ADDR, REWARDS_ABI, signer);
    btnVaultClaimVibe.textContent = "Enviando...";
    if(vaultVibeStatus) vaultVibeStatus.textContent = "Procesando...";
    const tx = await vaultSigner.claimVIBE(userAddress);
    await tx.wait();
    btnVaultClaimVibe.textContent = "Claim VIBE";
    if(vaultVibeStatus) vaultVibeStatus.textContent = "¡Recompensa recibida!";
    await updateVibeVault();
  } catch(e) {
    btnVaultClaimVibe.textContent = "Claim VIBE";
    if(vaultVibeStatus) vaultVibeStatus.textContent = "Error: " + (e.shortMessage || e.message);
  }
}

async function updateVibeAPY(vault, vibeTokenAddr) {
  try {
    const blocksPerYear = ACTIVE.blocksPerYear || 15768000;
    let supplyApyText = "", borrowApyText = "";

    for (const m of ACTIVE.cTokens) {
      const vibeSupplySpeedRaw = await vault.vibeSupplySpeed(m.address);
      const vibeBorrowSpeedRaw = await vault.vibeBorrowSpeed(m.address);
      if(vibeSupplySpeedRaw == 0n && vibeBorrowSpeedRaw == 0n) continue;

      const c = new ethers.Contract(m.address, C_TOKEN_ABI, provider);
      const totalSupplyRaw = await c.totalSupply();
      const exchangeRateRaw = await c.exchangeRateStored();

      const supplyUnderlying = Number(totalSupplyRaw) * Number(exchangeRateRaw) / 1e36;
      const totalBorrowsRaw = await c.totalBorrows();
      const borrowUnderlying = Number(totalBorrowsRaw) / (m.underlyingDecimals ? Math.pow(10, m.underlyingDecimals) : 1);

      const vibePerSupplyYear = Number(vibeSupplySpeedRaw.toString()) * blocksPerYear / 1e18;
      const vibePerBorrowYear = Number(vibeBorrowSpeedRaw.toString()) * blocksPerYear / 1e18;

      const vibeSupplyAPY = supplyUnderlying > 0 ? vibePerSupplyYear / supplyUnderlying : 0;
      const vibeBorrowAPY = borrowUnderlying > 0 ? vibePerBorrowYear / borrowUnderlying : 0;

      supplyApyText += `${m.symbol}: <span style="color:#f9e061;">${(vibeSupplyAPY*100).toFixed(2)}%</span> supply<br>`;
      borrowApyText += `${m.symbol}: <span style="color:#f98c61;">${(vibeBorrowAPY*100).toFixed(2)}%</span> borrow<br>`;
    }

    if(vaultVibeAPYSupply) vaultVibeAPYSupply.innerHTML = `APY VIBE (Supply):<br>${supplyApyText}`;
    if(vaultVibeAPYBorrow) vaultVibeAPYBorrow.innerHTML = `APY VIBE (Borrow):<br>${borrowApyText}`;
  } catch(e){}
}

function parseToRaw(amountStr, decimals) {
  const parts = amountStr.split(".");
  let whole = parts[0] || "0";
  let frac = parts[1] || "";
  if (!/^\d+$/.test(whole) || (frac && !/^\d+$/.test(frac))) return 0n;
  if (frac.length > decimals) frac = frac.slice(0,decimals);
  while (frac.length < decimals) frac += "0";
  return BigInt(whole + frac);
}

async function ensureAllowance(underlying, spender, neededRaw) {
  const erc = new ethers.Contract(underlying, MIN_ERC20_ABI, signer);
  try {
    const current = await erc.allowance(userAddress, spender);
    if (current >= neededRaw) return;
    txStatus.textContent = "Approve...";
    const tx = await erc.approve(spender, neededRaw);
    await tx.wait();
    txStatus.textContent = "Approve ok";
  } catch(e) {
    console.error("Approve error", e);
    throw e;
  }
}
