// VIBE FARM LOGIC
// Chains other than Minato (1946) keep the original MasterChef v1 path (block-based ABI in abis.js).
// Minato uses VibeMasterChefV2 only. That ABI lives here so abis.js / other pages stay untouched.
let provider, signer, userAddress, NETWORKS_DATA, ACTIVE;
let selectedProvider = null;
let currentFarm = null;
let isStakeMode = true;
let txBusy = false;
let refreshGen = 0;
let pollTimer = null;
let farmState = null;
let readProviderCache = null;

let balanceWallet = 0n;
let balanceStaked = 0n;

const MINATO_CHAIN_ID = 1946;
const SECONDS_PER_YEAR = 31536000n;

// Subset of VibeMasterChefV2.json. userInfo is (amount, rewardDebt, unpaid).
const MASTERCHEF_V2_ABI = [
  "function poolLength() view returns (uint256)",
  "function poolInfo(uint256) view returns (address lpToken, uint256 allocPoint, uint256 lastRewardTime, uint256 accLightPerShare, uint256 totalStaked, address rewarder)",
  "function userInfo(uint256,address) view returns (uint256 amount, uint256 rewardDebt, uint256 unpaid)",
  "function pendingLight(uint256,address) view returns (uint256)",
  "function poolLightPerSecond(uint256) view returns (uint256)",
  "function startTime() view returns (uint256)",
  "function endTime() view returns (uint256)",
  "function fundedUntil() view returns (uint256)",
  "function paused() view returns (bool)",
  "function lightPerSecond() view returns (uint256)",
  "function deposit(uint256 pid, uint256 amount)",
  "function withdraw(uint256 pid, uint256 amount)",
  "function harvest(uint256 pid)",
  "function emergencyWithdraw(uint256 pid)",
  "error VibeInvalidPid()",
  "error VibeInsufficientStake()",
  "error VibeUnderfunded()",
  "error VibeForbidden()",
  "error VibeLowGas()",
  "error EnforcedPause()",
  "error SafeERC20FailedOperation(address token)"
];

const PAIR_READ_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const getEl = (id) => document.getElementById(id);

function isMinato() {
  return !!(ACTIVE && Number(ACTIVE.chainId) === MINATO_CHAIN_ID);
}

function setText(id, value) {
  const el = getEl(id);
  if (el) el.textContent = value == null ? "" : String(value);
}

function setIcon(id, src) {
  const el = getEl(id);
  if (!el) return;
  if (typeof src === "string" && /^icons\/[A-Za-z0-9._-]+$/.test(src)) el.src = src;
}

function sameAddr(a, b) {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}

function formatAmount(wei, decimals) {
  if (wei == null) return "—";
  try {
    const s = ethers.formatUnits(wei, Number(decimals ?? 18));
    if (!s.includes(".")) return s;
    const trimmed = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    return trimmed === "" ? "0" : trimmed;
  } catch {
    return "—";
  }
}

function formatUnix(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function formatRate(wei) {
  if (wei == null) return "—";
  return formatAmount(wei, 18);
}

function rewardPhase(now, start, end, funded) {
  if (now < start) return "not-started";
  if (end > 0 && now >= end) return "ended";
  if (!(funded > 0) || now >= funded) return "not-funded";
  return "active";
}

// APR% with 2 decimal places, scaled by 100 (157680 = 1,576.80%).
// poolLightPerSecond * secondsPerYear * LIGHT price / (totalStaked * LP price).
// Both prices come from the pair: USDC.e side is ~$1, so the stable reserve cancels and
// APR = rate * 31536000 * 10^lightDecimals * lpSupply / (10^18 * lightReserve * totalStaked * 2).
function computeAprScaled(poolLightPerSecond, reserveLight, lightDecimals, lpSupply, totalStaked) {
  if (poolLightPerSecond == null || reserveLight == null || lpSupply == null || totalStaked == null) return null;
  let rate, lightReserve, supply, staked, dec;
  try {
    rate = BigInt(poolLightPerSecond);
    lightReserve = BigInt(reserveLight);
    supply = BigInt(lpSupply);
    staked = BigInt(totalStaked);
    dec = BigInt(lightDecimals);
  } catch {
    return null;
  }
  if (rate <= 0n || lightReserve <= 0n || supply <= 0n || staked <= 0n) return null;
  if (dec > 36n) return null;
  const num = rate * SECONDS_PER_YEAR * (10n ** dec) * supply * 10000n;
  const den = (10n ** 18n) * lightReserve * staked * 2n;
  if (den === 0n) return null;
  return num / den;
}

function formatAprScaled(scaled) {
  if (scaled == null) return "—";
  const v = BigInt(scaled);
  if (v <= 0n) return "<0.01%";
  const whole = v / 100n;
  const frac = (v % 100n).toString().padStart(2, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return grouped + "." + frac + "%";
}

function parseAmount(value, decimals) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (!/^\d+(\.\d+)?$/.test(v)) return undefined;
  try { return ethers.parseUnits(v, Number(decimals)); }
  catch { return undefined; }
}

function errorText(e) {
  const code = e && (e.code || (e.info && e.info.error && e.info.error.code));
  if (code === 4001 || code === "ACTION_REJECTED") return "Cancelled / Cancelado";
  const msg = (e && (e.shortMessage || e.reason || e.message)) || "Failed";
  return String(msg).replace(/^execution reverted:?\s*/i, "").slice(0, 220);
}

function showBanner(text, kind) {
  const el = getEl("farmBanner");
  if (!el) return;
  if (!isMinato() || !text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.dataset.kind = kind || "warn";
  el.textContent = text;
}

function showTx(text) {
  const el = getEl("farmTx");
  if (!el) return;
  if (!isMinato() || !text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function applyFarmChrome() {
  const v2 = isMinato();
  const note = getEl("aprNote");
  const meta = getEl("farmMeta");
  const emergency = getEl("btnEmergency");
  if (v2 && currentFarm) {
    setText("farmTitle", currentFarm.lpSymbol || "LP");
    setText("farmBadge", "Minato testnet");
    setIcon("farmIcon1", currentFarm.icon1 || "icons/vibe.svg");
    setIcon("farmIcon2", currentFarm.icon2 || "icons/usdc.e.svg");
    setText("aprValue", "—");
    if (note) { note.hidden = false; note.textContent = "variable, no garantizado"; }
    if (meta) meta.hidden = false;
    if (emergency) emergency.hidden = false;
    setText("userStaked", "—");
    setText("userEarned", "—");
    setText("walletLP", "—");
  } else {
    setText("farmTitle", "LIGHT-ETH LP");
    setText("farmBadge", "40x Multiplier");
    setIcon("farmIcon1", "icons/vibe.svg");
    setIcon("farmIcon2", "icons/weth.svg");
    setText("aprValue", "🔥 420%");
    if (note) note.hidden = true;
    if (meta) meta.hidden = true;
    if (emergency) emergency.hidden = true;
    showBanner("");
    showTx("");
    farmState = null;
    if (!signer) {
      setText("userStaked", "0.0000");
      setText("userEarned", "0.0000");
      setText("walletLP", "0.00");
    }
  }
}

function readProvider() {
  const rpc = ACTIVE && ACTIVE.rpcUrls && ACTIVE.rpcUrls[0];
  if (!rpc || typeof ethers.JsonRpcProvider !== "function") return provider || null;
  const chainId = Number(ACTIVE.chainId);
  if (!readProviderCache || readProviderCache.rpc !== rpc || readProviderCache.chainId !== chainId) {
    readProviderCache = {
      rpc,
      chainId,
      provider: new ethers.JsonRpcProvider(rpc, chainId, { staticNetwork: true })
    };
  }
  return readProviderCache.provider;
}

function syncPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (!isMinato()) return;
  pollTimer = setInterval(() => {
    if (document.hidden || txBusy) return;
    refreshFarmUI();
  }, 15000);
}

// --- 1. UI HELPERS & NETWORK ---
const updateStatus = (connected) => {
  const dot = getEl("statusDot");
  const txt = getEl("connStatus");
  const btn = getEl("btnConnect");
  if (!dot || !txt || !btn) return;

  if (connected && userAddress) {
    dot.style.color = "var(--success)";
    txt.textContent = "Online";
    btn.textContent = userAddress.substring(0, 6) + "..." + userAddress.substring(38);
    btn.classList.remove("btn-primary");
    btn.classList.add("btn-connected");

    const arrow = document.createElement("span");
    arrow.textContent = "▼";
    arrow.style.fontSize = "0.7em";
    arrow.style.marginLeft = "6px";
    if (btn.lastChild && btn.lastChild.tagName === "SPAN") btn.removeChild(btn.lastChild);
    btn.appendChild(arrow);

    setText("dropdownAddress", userAddress.substring(0, 8) + "..." + userAddress.substring(38));
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
    if (ACTIVE && ACTIVE.farms) currentFarm = ACTIVE.farms[0];
    const sel = getEl("networkSelect");
    if (sel && ACTIVE) sel.value = String(ACTIVE.chainId);
    applyFarmChrome();
    syncPoll();
    if (isMinato()) await refreshFarmUI();
    if (window.checkAutoConnect) await window.checkAutoConnect(connectWallet);
  } catch (e) { console.error("Init Error", e); }
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
  sel.onchange = async (e) => {
    const targetChainId = e.target.value;
    if (userAddress) await switchNetwork(targetChainId);
    else {
      ACTIVE = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);
      currentFarm = ACTIVE && ACTIVE.farms ? ACTIVE.farms[0] : null;
      applyFarmChrome();
      syncPoll();
      await refreshFarmUI();
    }
  };
}

function openWalletModal() {
  const modal = getEl("walletModal");
  const list = getEl("walletList");
  if (!modal || !list) return;
  list.replaceChildren();
  if (window.WALLET_CONFIG) {
    window.WALLET_CONFIG.forEach(w => {
      const isInstalled = w.check();
      const btn = document.createElement("div");
      btn.className = "wallet-btn";
      const info = document.createElement("div");
      info.className = "wallet-info";
      const img = document.createElement("img");
      img.alt = "";
      img.style.width = "32px";
      img.style.height = "32px";
      img.style.objectFit = "contain";
      if (typeof w.icon === "string" && /^icons\/[A-Za-z0-9._-]+$/.test(w.icon)) img.src = w.icon;
      const name = document.createElement("span");
      name.textContent = String(w.name ?? "");
      info.append(img, name);
      const badge = document.createElement("span");
      if (isInstalled) {
        badge.style.color = "var(--success)";
        badge.style.fontSize = "1.2rem";
        badge.textContent = "›";
      } else {
        badge.className = "wallet-badge";
        badge.textContent = "Install";
      }
      btn.append(info, badge);
      btn.onclick = async () => {
        if (!isInstalled) { window.open(w.installUrl, "_blank", "noopener"); return; }
        selectedProvider = w.getProvider();
        closeWalletModal();
        await connectWallet();
      };
      list.appendChild(btn);
    });
  }
  modal.classList.add("open");
}
window.closeWalletModal = () => { const modal = getEl("walletModal"); if (modal) modal.classList.remove("open"); };

function openEmergency() {
  if (!isMinato() || !farmState || farmState.staked == null || farmState.staked <= 0n) return;
  const dec = farmState.lpDecimals ?? 18;
  setText(
    "emergencyDetail",
    "You will withdraw " + formatAmount(farmState.staked, dec) + " LP and forfeit " + formatAmount(farmState.pending || 0n, 18) + " LIGHT."
  );
  const modal = getEl("emergencyModal");
  if (modal) modal.classList.add("open");
}
function closeEmergency() {
  const modal = getEl("emergencyModal");
  if (modal) modal.classList.remove("open");
}

window.onclick = (e) => {
  const modal = getEl("walletModal");
  if (e.target === modal) closeWalletModal();
  const emergency = getEl("emergencyModal");
  if (e.target === emergency) closeEmergency();
  const accountDropdown = getEl("accountDropdown");
  if (accountDropdown && accountDropdown.classList.contains("show") && !e.target.closest("#btnConnect")) {
    accountDropdown.classList.remove("show");
  }
};

const btnConnect = getEl("btnConnect");
const accountDropdown = getEl("accountDropdown");
if (btnConnect) {
  btnConnect.onclick = (e) => {
    e.stopPropagation();
    if (userAddress) { if (accountDropdown) accountDropdown.classList.toggle("show"); }
    else { openWalletModal(); }
  };
}

if (getEl("btnCopyAddress")) getEl("btnCopyAddress").onclick = () => { navigator.clipboard.writeText(userAddress); alert("Copied!"); };
if (getEl("btnViewExplorer")) getEl("btnViewExplorer").onclick = () => { if (ACTIVE) window.open(ACTIVE.blockExplorerUrls[0] + "/address/" + userAddress, "_blank", "noopener"); };
if (getEl("btnDisconnect")) getEl("btnDisconnect").onclick = () => {
  if (window.SessionManager) window.SessionManager.clear();
  userAddress = null; signer = null; selectedProvider = null;
  updateStatus(false);
  if (accountDropdown) accountDropdown.classList.remove("show");
  window.location.reload();
};
if (getEl("btnEmergencyClose")) getEl("btnEmergencyClose").onclick = closeEmergency;
if (getEl("btnEmergencyCancel")) getEl("btnEmergencyCancel").onclick = closeEmergency;
if (getEl("btnEmergencyConfirm")) getEl("btnEmergencyConfirm").onclick = () => { closeEmergency(); handleEmergencyWithdraw(); };

async function connectWallet() {
  const ethProvider = selectedProvider || window.ethereum;
  if (!ethProvider) { alert("Please install MetaMask."); return; }
  const btn = getEl("btnConnect");
  if (btn) btn.textContent = "Connecting...";

  try {
    provider = new ethers.BrowserProvider(ethProvider);
    if (!NETWORKS_DATA) NETWORKS_DATA = await window.loadNetworks();

    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    if (window.SessionManager) window.SessionManager.save();

    const chainIdHex = await provider.send("eth_chainId", []);
    const chainIdDecimal = parseInt(chainIdHex, 16);
    ACTIVE = Object.values(NETWORKS_DATA).find(n => (parseInt(n.chainId) === chainIdDecimal) && n.enabled);

    const sel = getEl("networkSelect");
    if (!ACTIVE) {
      let targetId = sel ? sel.value : null;
      if (!targetId) { const def = Object.values(NETWORKS_DATA).find(n => n.enabled); if (def) targetId = def.chainId; }
      if (targetId) { await switchNetwork(targetId); return; }
      else { alert("Unsupported Network."); updateStatus(false); return; }
    }
    if (sel && ACTIVE) sel.value = ACTIVE.chainId;
    currentFarm = ACTIVE.farms ? ACTIVE.farms[0] : null;

    updateStatus(true);
    applyFarmChrome();
    syncPoll();
    await refreshFarmUI();

    if (ethProvider.on) {
      ethProvider.on("chainChanged", () => window.location.reload());
      ethProvider.on("accountsChanged", () => window.location.reload());
    }
  } catch (e) { console.error(e); updateStatus(false); }
}

async function switchNetwork(targetChainId) {
  const targetNetwork = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);
  if (!targetNetwork) return;
  const eth = selectedProvider || window.ethereum;
  if (!eth) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x" + Number(targetNetwork.chainId).toString(16) }] });
  } catch (switchError) {
    if (switchError.code === 4902) {
      try {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x" + Number(targetNetwork.chainId).toString(16),
            chainName: targetNetwork.label,
            rpcUrls: targetNetwork.rpcUrls,
            blockExplorerUrls: targetNetwork.blockExplorerUrls,
            nativeCurrency: targetNetwork.nativeCurrency
          }]
        });
      } catch (e) {}
    }
  }
}

// --- 3. FARM LOGIC ---

window.setFarmMode = (mode) => {
  isStakeMode = (mode === "stake");
  const tStake = getEl("tabStake");
  const tUnstake = getEl("tabUnstake");
  if (!tStake || !tUnstake) return;
  if (isStakeMode) {
    tStake.classList.add("active");
    tUnstake.classList.remove("active", "unstake-mode");
    setText("balLabel", "Wallet");
  } else {
    tStake.classList.remove("active");
    tUnstake.classList.add("active", "unstake-mode");
    setText("balLabel", "Staked");
  }
  const input = getEl("stakeAmount");
  if (input) input.value = "";
  if (isMinato()) paintMinatoActions();
  else refreshFarmUI();
};

function paintMinatoActions() {
  if (txBusy) return;
  const btn = getEl("btnMainAction");
  if (!btn) return;
  const s = farmState;
  const dec = s && s.lpDecimals != null ? s.lpDecimals : 18;

  const setBtn = (text, enabled, handler) => {
    btn.textContent = text;
    btn.className = "btn-primary";
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? "1" : "0.55";
    btn.style.cursor = enabled ? "pointer" : "not-allowed";
    btn.onclick = enabled ? handler : null;
  };

  if (!userAddress) {
    setBtn("Connect Wallet", true, () => openWalletModal());
  } else if (!s || !s.readable) {
    setBtn("Unavailable", false, null);
  } else if (!s.poolReady) {
    setBtn("Pool not added", false, null);
  } else if (s.poolReadFailed) {
    setBtn("Unavailable", false, null);
  } else if (s.mismatch) {
    setBtn("Pool mismatch", false, null);
  } else if (isStakeMode) {
    const raw = getEl("stakeAmount") ? getEl("stakeAmount").value : "";
    const parsed = parseAmount(raw, dec);
    if (s.paused) setBtn("Paused", false, null);
    else if (!String(raw).trim()) setBtn("Stake", false, null);
    else if (parsed === undefined) setBtn("Invalid amount", false, null);
    else if (parsed === 0n) setBtn("Stake", false, null);
    else if (s.wallet != null && parsed > s.wallet) setBtn("Insufficient LP", false, null);
    else if (s.allowance == null) setBtn("Stake", false, null);
    else if (s.allowance < parsed) setBtn("Approve LP", true, () => handleApprove());
    else setBtn("Stake", true, () => handleDeposit());
  } else {
    const raw = getEl("stakeAmount") ? getEl("stakeAmount").value : "";
    const parsed = parseAmount(raw, dec);
    if (!String(raw).trim()) setBtn("Unstake", false, null);
    else if (parsed === undefined) setBtn("Invalid amount", false, null);
    else if (parsed === 0n) setBtn("Unstake", false, null);
    else if (s.staked == null) setBtn("Unstake", false, null);
    else if (parsed > s.staked) setBtn("Insufficient stake", false, null);
    else setBtn("Unstake", true, () => handleWithdraw());
  }

  const harvest = getEl("btnHarvest");
  const pending = s && s.pending;
  const canHarvest = !!(userAddress && s && s.poolReady && !s.poolReadFailed && !s.mismatch && pending != null && pending > 0n);
  if (harvest) {
    harvest.disabled = !canHarvest;
    harvest.style.opacity = canHarvest ? "1" : "0.5";
    harvest.style.cursor = canHarvest ? "pointer" : "not-allowed";
    if (!txBusy) harvest.textContent = "Harvest";
    harvest.onclick = canHarvest ? () => handleHarvest() : null;
  }

  const emergency = getEl("btnEmergency");
  const canEmergency = !!(userAddress && s && s.poolReady && !s.poolReadFailed && !s.mismatch && s.staked != null && s.staked > 0n);
  if (emergency) {
    emergency.disabled = !canEmergency;
    emergency.onclick = canEmergency ? openEmergency : null;
  }

  if (!userAddress || !s || !s.readable) {
    setText("userStaked", "—");
    setText("userEarned", "—");
    setText("walletLP", "—");
    return;
  }
  if (!s.poolReady || s.poolReadFailed || s.mismatch || s.staked == null) setText("userStaked", "—");
  else setText("userStaked", formatAmount(s.staked, dec));
  if (!s.poolReady || s.poolReadFailed || s.mismatch || s.pending == null) setText("userEarned", "—");
  else setText("userEarned", formatAmount(s.pending, 18));
  const shown = isStakeMode ? s.wallet : s.staked;
  setText("walletLP", shown == null ? "—" : formatAmount(shown, dec));
}

async function refreshFarmUI() {
  if (!ACTIVE) return;
  if (isMinato()) return refreshMinato();
  return refreshLegacy();
}

async function refreshLegacy() {
  if (!signer || !ACTIVE || !currentFarm || !ACTIVE.masterChef || !window.MASTERCHEF_ABI) return;
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

    setText("userStaked", parseFloat(ethers.formatEther(balanceStaked)).toFixed(4));
    setText("userEarned", parseFloat(ethers.formatEther(pending)).toFixed(4));

    if (isStakeMode) setText("walletLP", parseFloat(ethers.formatEther(balanceWallet)).toFixed(4));
    else setText("walletLP", parseFloat(ethers.formatEther(balanceStaked)).toFixed(4));

    const btnMain = getEl("btnMainAction");
    if (!btnMain) return;
    const inputVal = getEl("stakeAmount") ? getEl("stakeAmount").value : "";
    let amountWei = 0n;
    if (inputVal) {
      try { amountWei = ethers.parseEther(inputVal); } catch { amountWei = 0n; }
    }

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
    if (btnHarvest) {
      if (pending > 0n) {
        btnHarvest.disabled = false;
        btnHarvest.style.opacity = "1";
        btnHarvest.style.cursor = "pointer";
        btnHarvest.onclick = () => handleHarvest();
      } else {
        btnHarvest.disabled = true;
        btnHarvest.style.opacity = "0.5";
        btnHarvest.style.cursor = "not-allowed";
        btnHarvest.onclick = null;
      }
    }
  } catch (e) { console.error("Farm Data Error:", e); }
}

function settled(result) {
  return result && result.status === "fulfilled" ? result.value : null;
}

async function refreshMinato() {
  if (txBusy) return;
  const gen = ++refreshGen;
  const still = () => gen === refreshGen && isMinato();
  const read = readProvider();
  if (!read || !ACTIVE || !ACTIVE.masterChef || !currentFarm || !currentFarm.lpToken) {
    farmState = { readable: false };
    showBanner("Minato farm is not configured. / La farm de Minato no está configurada.", "danger");
    setText("aprValue", "—");
    paintMinatoActions();
    return;
  }

  const chef = new ethers.Contract(ACTIVE.masterChef, MASTERCHEF_V2_ABI, read);
  const pair = new ethers.Contract(currentFarm.lpToken, PAIR_READ_ABI, read);
  const pid = BigInt(currentFarm.pid ?? 0);

  const base = await Promise.allSettled([
    chef.poolLength(),
    chef.startTime(),
    chef.endTime(),
    chef.fundedUntil(),
    chef.paused(),
    chef.lightPerSecond(),
    read.getBlock("latest"),
    pair.token0(),
    pair.token1(),
    pair.getReserves(),
    pair.totalSupply(),
    pair.decimals()
  ]);

  const poolLength = settled(base[0]);
  const start = settled(base[1]);
  const end = settled(base[2]);
  const funded = settled(base[3]);
  const paused = settled(base[4]);
  const chefRate = settled(base[5]);
  const block = settled(base[6]);
  const token0 = settled(base[7]);
  const token1 = settled(base[8]);
  const reserves = settled(base[9]);
  const lpSupply = settled(base[10]);
  const lpDecimalsRaw = settled(base[11]);
  if (!still()) return;

  if (poolLength == null || start == null || end == null) {
    farmState = { readable: false };
    showBanner("Could not read the farm contract on Minato. / No se pudo leer el contrato de la farm.", "danger");
    setText("aprValue", "—");
    setText("farmPeriod", "—");
    setText("farmFunded", "—");
    setText("farmPoolRate", "—");
    setText("farmChefRate", "—");
    paintMinatoActions();
    return;
  }

  const now = block && block.timestamp != null ? Number(block.timestamp) : Math.floor(Date.now() / 1000);
  const lpDecimals = lpDecimalsRaw == null ? 18 : Number(lpDecimalsRaw);
  const poolReady = pid >= 0n && pid < BigInt(poolLength);

  let poolRate = null;
  let totalStaked = null;
  let mismatch = false;
  let poolReadFailed = false;
  let wallet = null;
  let allowance = null;
  let staked = null;
  let pending = null;

  if (poolReady) {
    const info = await chef.poolInfo(pid).then(v => v, () => null);
    poolRate = await chef.poolLightPerSecond(pid).then(v => v, () => null);
    if (!info) poolReadFailed = true;
    else if (!sameAddr(info.lpToken, currentFarm.lpToken)) mismatch = true;
    else totalStaked = info.totalStaked;
  }

  if (userAddress) {
    wallet = await pair.balanceOf(userAddress).then(v => v, () => null);
    if (poolReady && !mismatch && !poolReadFailed) {
      allowance = await pair.allowance(userAddress, ACTIVE.masterChef).then(v => v, () => null);
      const userInfo = await chef.userInfo(pid, userAddress).then(v => v, () => null);
      pending = await chef.pendingLight(pid, userAddress).then(v => v, () => null);
      staked = userInfo ? userInfo.amount : null;
    }
  }
  if (!still()) return;

  let lightReserve = null;
  let lightDecimals = Number(currentFarm.token1Decimals ?? 18);
  if (reserves && token0 && token1 && currentFarm.token0 && currentFarm.token1) {
    const stable = currentFarm.token0;
    const light = currentFarm.token1;
    let lightAddr = null;
    if (sameAddr(token0, light) && sameAddr(token1, stable)) {
      lightReserve = reserves[0];
      lightAddr = token0;
    } else if (sameAddr(token1, light) && sameAddr(token0, stable)) {
      lightReserve = reserves[1];
      lightAddr = token1;
    }
    if (lightAddr && window.MIN_ERC20_ABI) {
      try {
        const dec = await new ethers.Contract(lightAddr, window.MIN_ERC20_ABI, read).decimals();
        lightDecimals = Number(dec);
      } catch { /* keep the configured fallback */ }
    }
  }
  if (!still()) return;

  const startN = Number(start);
  const endN = Number(end);
  const fundedN = funded == null ? 0 : Number(funded);
  const phase = rewardPhase(now, startN, endN, fundedN);

  const aprAllowed = poolReady && !poolReadFailed && !mismatch && phase === "active" && totalStaked != null && totalStaked > 0n && poolRate != null && poolRate > 0n;
  const aprScaled = aprAllowed ? computeAprScaled(poolRate, lightReserve, lightDecimals, lpSupply, totalStaked) : null;

  farmState = {
    readable: true,
    poolReady,
    poolReadFailed,
    mismatch,
    paused: paused === true,
    phase,
    lpDecimals,
    wallet,
    allowance,
    staked,
    pending,
    totalStaked,
    poolRate
  };
  balanceWallet = wallet || 0n;
  balanceStaked = staked || 0n;

  setText("farmPeriod", formatUnix(start) + " → " + formatUnix(end));
  setText("farmFunded", formatUnix(funded));
  setText("farmPoolRate", poolReady && !poolReadFailed && !mismatch ? formatRate(poolRate) : "—");
  setText("farmChefRate", formatRate(chefRate));
  setText("aprValue", formatAprScaled(aprScaled));
  const note = getEl("aprNote");
  if (note) { note.hidden = false; note.textContent = "variable, no garantizado"; }

  const lines = [];
  if (!poolReady) {
    lines.push("Pool not added yet. Deposit stays disabled until the owner calls add().\nEl pool todavía no está añadido.");
  } else if (poolReadFailed) {
    lines.push("Could not read this pool. Staking and APR stay hidden.\nNo se pudo leer este pool.");
  } else if (mismatch) {
    lines.push("Pool pid " + currentFarm.pid + " does not match the configured LP. Staking and APR are hidden.\nEl pool no coincide con el LP configurado.");
  }
  if (paused === true) {
    lines.push("Paused. New deposits are disabled. Withdraw, harvest and emergency withdraw still work.\nEn pausa. No se puede depositar. Retirar, cobrar y el retiro de emergencia siguen activos.");
  }
  if (phase === "not-started") lines.push("Not started / Aún no empieza.");
  else if (phase === "ended") lines.push("Ended / Terminado.");
  else if (phase === "not-funded") lines.push("Not funded / Sin fondos para recompensas.");
  else if (poolReady && !poolReadFailed && !mismatch && (totalStaked == null || totalStaked === 0n)) {
    lines.push("No LP staked yet, so APR is unavailable.\nNadie tiene LP en stake, así que el APR no se muestra.");
  }
  if (!still()) return;
  showBanner(lines.join("\n"), "warn");
  paintMinatoActions();
}

async function handleApprove() {
  if (!signer || txBusy) return;
  const btn = getEl("btnMainAction");
  txBusy = true;
  try {
    if (btn) btn.textContent = "Approving...";
    showTx("");
    const lpToken = new ethers.Contract(currentFarm.lpToken, window.MIN_ERC20_ABI, signer);
    let amount = ethers.MaxUint256;
    if (isMinato()) {
      const dec = farmState && farmState.lpDecimals != null ? farmState.lpDecimals : 18;
      const parsed = parseAmount(getEl("stakeAmount").value, dec);
      if (parsed == null || parsed <= 0n) {
        if (btn) btn.textContent = "Enter amount";
        return;
      }
      amount = parsed;
    }
    const tx = await lpToken.approve(ACTIVE.masterChef, amount);
    await tx.wait();
  } catch (e) {
    console.error(e);
    if (btn) btn.textContent = "Failed";
    if (isMinato()) showTx(errorText(e));
  } finally {
    txBusy = false;
  }
  await refreshFarmUI();
}

async function handleDeposit() {
  if (!signer || txBusy) return;
  const val = getEl("stakeAmount").value;
  if (!val) return;
  const btn = getEl("btnMainAction");
  txBusy = true;
  try {
    if (btn) btn.textContent = "Staking...";
    showTx("");
    const abi = isMinato() ? MASTERCHEF_V2_ABI : window.MASTERCHEF_ABI;
    const master = new ethers.Contract(ACTIVE.masterChef, abi, signer);
    const dec = isMinato() && farmState && farmState.lpDecimals != null ? farmState.lpDecimals : 18;
    const amount = isMinato() ? parseAmount(val, dec) : ethers.parseEther(val);
    if (amount == null || amount === undefined || amount <= 0n) {
      if (btn) btn.textContent = "Invalid amount";
      return;
    }
    const tx = await master.deposit(currentFarm.pid, amount);
    await tx.wait();
    getEl("stakeAmount").value = "";
  } catch (e) {
    console.error(e);
    if (btn) btn.textContent = "Failed";
    if (isMinato()) showTx(errorText(e));
  } finally {
    txBusy = false;
  }
  await refreshFarmUI();
}

async function handleWithdraw() {
  if (!signer || txBusy) return;
  const val = getEl("stakeAmount").value;
  if (!val) return;
  const btn = getEl("btnMainAction");
  txBusy = true;
  try {
    if (btn) btn.textContent = "Withdrawing...";
    showTx("");
    const abi = isMinato() ? MASTERCHEF_V2_ABI : window.MASTERCHEF_ABI;
    const master = new ethers.Contract(ACTIVE.masterChef, abi, signer);
    const dec = isMinato() && farmState && farmState.lpDecimals != null ? farmState.lpDecimals : 18;
    const amount = isMinato() ? parseAmount(val, dec) : ethers.parseEther(val);
    if (amount == null || amount === undefined || amount <= 0n) {
      if (btn) btn.textContent = "Invalid amount";
      return;
    }
    const tx = await master.withdraw(currentFarm.pid, amount);
    await tx.wait();
    getEl("stakeAmount").value = "";
  } catch (e) {
    console.error(e);
    if (btn) btn.textContent = "Failed";
    if (isMinato()) showTx(errorText(e));
  } finally {
    txBusy = false;
  }
  await refreshFarmUI();
}

async function handleHarvest() {
  if (!signer || txBusy) return;
  const btn = getEl("btnHarvest");
  txBusy = true;
  try {
    if (btn) btn.textContent = "Harvesting...";
    showTx("");
    const abi = isMinato() ? MASTERCHEF_V2_ABI : window.MASTERCHEF_ABI;
    const master = new ethers.Contract(ACTIVE.masterChef, abi, signer);
    const tx = isMinato()
      ? await master.harvest(currentFarm.pid)
      : await master.deposit(currentFarm.pid, 0);
    await tx.wait();
  } catch (e) {
    console.error(e);
    if (btn) btn.textContent = "Failed";
    if (isMinato()) showTx(errorText(e));
  } finally {
    txBusy = false;
  }
  await refreshFarmUI();
}
window.handleHarvest = handleHarvest;

async function handleEmergencyWithdraw() {
  if (!signer || !isMinato() || txBusy) return;
  if (!farmState || farmState.staked == null || farmState.staked <= 0n) return;
  const btn = getEl("btnEmergency");
  txBusy = true;
  try {
    if (btn) btn.textContent = "Emergency withdrawing...";
    showTx("");
    const master = new ethers.Contract(ACTIVE.masterChef, MASTERCHEF_V2_ABI, signer);
    const tx = await master.emergencyWithdraw(currentFarm.pid);
    await tx.wait();
  } catch (e) {
    console.error(e);
    showTx(errorText(e));
  } finally {
    txBusy = false;
    if (btn) btn.textContent = "Emergency withdraw";
  }
  await refreshFarmUI();
}

const btnMax = getEl("btnMax");
if (btnMax) {
  btnMax.onclick = () => {
    if (!userAddress) return;
    const amt = isStakeMode ? balanceWallet : balanceStaked;
    const dec = isMinato() && farmState && farmState.lpDecimals != null ? farmState.lpDecimals : 18;
    const input = getEl("stakeAmount");
    if (!input) return;
    input.value = isMinato() ? ethers.formatUnits(amt, dec) : ethers.formatEther(amt);
    if (isMinato()) paintMinatoActions();
    else refreshFarmUI();
  };
}

const stakeInput = getEl("stakeAmount");
if (stakeInput) {
  stakeInput.addEventListener("input", () => {
    if (isMinato()) paintMinatoActions();
    else refreshFarmUI();
  });
}
