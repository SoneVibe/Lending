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
  // end === 0 is an open-ended MINT chef. fundedUntil() then returns 0 as well,
  // which means "no end", not "unfunded". PREFUND always has end > 0.
  if (end > 0 && (!(funded > 0) || now >= funded)) return "not-funded";
  return "active";
}

// APR% with 2 decimal places, scaled by 100 (157680 = 1,576.80%).
// poolLightPerSecond * secondsPerYear * LIGHT price / (totalStaked * LP price).
// USDC.e (~$1) prices both sides, so its 6 decimals cancel. Rate and the LIGHT
// reserve are both raw LIGHT units (18 decimals), and lpSupply and totalStaked
// are both raw LP units (18 decimals), so those decimals cancel too:
// APR = rate * 31536000 * lpSupply / (lightReserve * totalStaked * 2).
function computeAprScaled(poolLightPerSecond, reserveLight, lpSupply, totalStaked) {
  if (poolLightPerSecond == null || reserveLight == null || lpSupply == null || totalStaked == null) return null;
  let rate, lightReserve, supply, staked;
  try {
    rate = BigInt(poolLightPerSecond);
    lightReserve = BigInt(reserveLight);
    supply = BigInt(lpSupply);
    staked = BigInt(totalStaked);
  } catch {
    return null;
  }
  if (rate <= 0n || lightReserve <= 0n || supply <= 0n || staked <= 0n) return null;
  const num = rate * SECONDS_PER_YEAR * supply * 10000n;
  const den = lightReserve * staked * 2n;
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

// USD cents, truncated. LP value = amount / supply * (stable reserve as dollars * 2).
// LIGHT value = amount * stable dollars / light reserve. USDC.e is treated as about $1.
function lpUsdCents(amount, lpSupply, stableReserve, stableDecimals) {
  if (amount == null || lpSupply == null || stableReserve == null || stableDecimals == null) return null;
  let amt, supply, stable, dec;
  try {
    amt = BigInt(amount);
    supply = BigInt(lpSupply);
    stable = BigInt(stableReserve);
    dec = BigInt(stableDecimals);
  } catch { return null; }
  if (supply <= 0n || stable < 0n || dec < 0n || dec > 36n) return null;
  if (amt <= 0n) return 0n;
  return amt * 2n * stable * 100n / (supply * (10n ** dec));
}

function lightUsdCents(amount, lightReserve, stableReserve, stableDecimals) {
  if (amount == null || lightReserve == null || stableReserve == null || stableDecimals == null) return null;
  let amt, light, stable, dec;
  try {
    amt = BigInt(amount);
    light = BigInt(lightReserve);
    stable = BigInt(stableReserve);
    dec = BigInt(stableDecimals);
  } catch { return null; }
  if (light <= 0n || stable < 0n || dec < 0n || dec > 36n) return null;
  if (amt <= 0n) return 0n;
  return amt * stable * 100n / (light * (10n ** dec));
}

function formatUsdEstimate(cents, amount) {
  if (cents == null) return "—";
  const v = BigInt(cents);
  if (v < 0n) return "—";
  if (amount === 0n || amount === 0) return "≈ $0.00 estimated";
  if (v === 0n) return "≈ <$0.01 estimated";
  const whole = v / 100n;
  const frac = (v % 100n).toString().padStart(2, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "≈ $" + grouped + "." + frac + " estimated";
}

function fractionOf(amount, numer, denom) {
  if (amount == null) return null;
  const base = BigInt(amount);
  if (denom === 1n) return base;
  if (base <= 0n) return 0n;
  return base * numer / denom;
}

function parseAmount(value, decimals) {
  let v = String(value ?? "").trim().replace(",", ".");
  if (!v) return null;
  if (!/^(?:\d*\.?\d+|\d+\.)$/.test(v)) return undefined;
  if (v.endsWith(".")) v = v.slice(0, -1);
  if (v.startsWith(".")) v = "0" + v;
  try { return ethers.parseUnits(v, Number(decimals)); }
  catch { return undefined; }
}

const walletWatch = new WeakSet();

function bindWalletEvents(ethProvider) {
  if (!ethProvider || typeof ethProvider.on !== "function" || walletWatch.has(ethProvider)) return;
  walletWatch.add(ethProvider);
  ethProvider.on("chainChanged", () => window.location.reload());
  ethProvider.on("accountsChanged", () => window.location.reload());
}

async function assertMinato() {
  let chainId = null;
  try {
    const net = await provider.getNetwork();
    chainId = net.chainId;
  } catch { /* wallet changed network, or the read failed */ }
  if (chainId !== BigInt(MINATO_CHAIN_ID)) {
    throw new Error("Wrong network. Switch to Minato (1946).");
  }
}

function errorText(e) {
  const code = e && (e.code || (e.info && e.info.error && e.info.error.code));
  if (code === 4001 || code === "ACTION_REJECTED") return "Cancelled";
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

function setHidden(id, hidden) {
  const el = getEl(id);
  if (el) el.hidden = hidden;
}

function applyFarmChrome() {
  const v2 = isMinato() && !!currentFarm;
  const card = getEl("farmCard");
  if (card) card.classList.toggle("is-minato", v2);
  const note = getEl("aprNote");
  const meta = getEl("farmMeta");
  const advanced = getEl("farmAdvanced");
  if (v2) {
    setText("farmTitle", currentFarm.lpSymbol || "LP");
    setText("farmBadge", "Minato testnet");
    setIcon("farmIcon1", currentFarm.icon1 || "icons/vibe.svg");
    setIcon("farmIcon2", currentFarm.icon2 || "icons/usdc.e.svg");
    setText("aprValue", "—");
    if (note) { note.hidden = false; note.textContent = "variable, not guaranteed"; }
    if (meta) meta.hidden = false;
    if (advanced) { advanced.hidden = false; advanced.open = false; }
    setHidden("pctRow", false);
    setHidden("btnMax", true);
    setHidden("userStakedUsd", false);
    setHidden("userEarnedUsd", false);
    setHidden("walletLpUsd", false);
    syncFarmMode();
    setText("userStaked", "—");
    setText("userEarned", "—");
    setText("walletLP", "—");
    setText("userStakedUsd", "—");
    setText("userEarnedUsd", "—");
    setText("walletLpUsd", "");
    setHidden("earnedHint", true);
  } else {
    setText("farmTitle", "LIGHT-ETH LP");
    setText("farmBadge", "40x Multiplier");
    setIcon("farmIcon1", "icons/vibe.svg");
    setIcon("farmIcon2", "icons/weth.svg");
    setText("aprValue", "🔥 420%");
    if (note) note.hidden = true;
    if (meta) meta.hidden = true;
    if (advanced) { advanced.hidden = true; advanced.open = false; }
    setHidden("pctRow", true);
    setHidden("btnMax", false);
    setHidden("unstakeHint", true);
    setHidden("earnedHint", true);
    setHidden("userStakedUsd", true);
    setHidden("userEarnedUsd", true);
    setHidden("walletLpUsd", true);
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
    if (userAddress) {
      await switchNetwork(targetChainId);
      if (ACTIVE) sel.value = String(ACTIVE.chainId);
    } else {
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
    bindWalletEvents(ethProvider);
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

function syncFarmMode() {
  const tStake = getEl("tabStake");
  const tUnstake = getEl("tabUnstake");
  if (tStake && tUnstake) {
    tStake.classList.toggle("active", isStakeMode);
    tUnstake.classList.toggle("active", !isStakeMode);
    tUnstake.classList.toggle("unstake-mode", !isStakeMode);
    tStake.setAttribute("aria-pressed", isStakeMode ? "true" : "false");
    tUnstake.setAttribute("aria-pressed", isStakeMode ? "false" : "true");
  }
  setText("balLabel", isStakeMode ? "Wallet" : "Staked");
  if (isMinato() && currentFarm) {
    setHidden("unstakeHint", false);
    setText(
      "unstakeHint",
      isStakeMode
        ? "Stake deposits LP from your wallet."
        : "Unstake returns your LP and pays the pending LIGHT the farm can cover; any rest stays credited."
    );
  }
}

window.setFarmMode = (mode) => {
  if (txBusy) return;
  isStakeMode = (mode === "stake");
  syncFarmMode();
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

  const hint = getEl("earnedHint");
  if (!userAddress || !s || !s.readable) {
    setText("userStaked", "—");
    setText("userEarned", "—");
    setText("walletLP", "—");
    setText("userStakedUsd", "—");
    setText("userEarnedUsd", "—");
    setText("walletLpUsd", "");
    if (hint) { hint.hidden = true; hint.textContent = ""; }
    return;
  }
  const positionKnown = s.poolReady && !s.poolReadFailed && !s.mismatch && s.staked != null;
  if (!positionKnown) {
    setText("userStaked", "—");
    setText("userStakedUsd", "—");
  } else {
    setText("userStaked", formatAmount(s.staked, dec) + " LP");
    setText("userStakedUsd", formatUsdEstimate(s.stakedUsdCents, s.staked));
  }
  if (!positionKnown || s.pending == null) {
    setText("userEarned", "—");
    setText("userEarnedUsd", "—");
    if (hint) { hint.hidden = true; hint.textContent = ""; }
  } else {
    setText("userEarned", formatAmount(s.pending, 18));
    setText("userEarnedUsd", formatUsdEstimate(s.pendingUsdCents, s.pending));
    if (hint) {
      hint.hidden = s.pending <= 0n;
      hint.textContent = s.pending > 0n
        ? "Unstake pays this LIGHT with your LP. Anything the farm cannot pay yet stays credited. Emergency withdraw forfeits it."
        : "";
    }
  }
  const shown = isStakeMode ? s.wallet : s.staked;
  const shownCents = isStakeMode ? s.walletUsdCents : s.stakedUsdCents;
  setText("walletLP", shown == null ? "—" : formatAmount(shown, dec));
  setText("walletLpUsd", shown == null ? "" : formatUsdEstimate(shownCents, shown));
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
    showBanner("Minato farm is not configured.", "danger");
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
    showBanner("Could not read the farm contract on Minato.", "danger");
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
  let stableReserve = null;
  let stableAddr = null;
  if (reserves && token0 && token1 && currentFarm.token0 && currentFarm.token1) {
    const stable = currentFarm.token0;
    const light = currentFarm.token1;
    if (sameAddr(token0, light) && sameAddr(token1, stable)) {
      lightReserve = reserves[0];
      stableReserve = reserves[1];
      stableAddr = token1;
    } else if (sameAddr(token1, light) && sameAddr(token0, stable)) {
      lightReserve = reserves[1];
      stableReserve = reserves[0];
      stableAddr = token0;
    }
  }
  let stableDecimals = null;
  if (stableAddr && window.MIN_ERC20_ABI) {
    try {
      stableDecimals = Number(await new ethers.Contract(stableAddr, window.MIN_ERC20_ABI, read).decimals());
    } catch { /* use the configured scale below */ }
  }
  if (!still()) return;
  if (!Number.isInteger(stableDecimals) && stableAddr && sameAddr(stableAddr, currentFarm.token0)) {
    const configured = Number(currentFarm.token0Decimals);
    if (Number.isInteger(configured) && configured >= 0 && configured <= 36) stableDecimals = configured;
  }

  const startN = Number(start);
  const endN = Number(end);
  const fundedN = funded == null ? 0 : Number(funded);
  const phase = rewardPhase(now, startN, endN, fundedN);

  const aprAllowed = poolReady && !poolReadFailed && !mismatch && phase === "active" && totalStaked != null && totalStaked > 0n && poolRate != null && poolRate > 0n;
  const aprScaled = aprAllowed ? computeAprScaled(poolRate, lightReserve, lpSupply, totalStaked) : null;

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
    poolRate,
    stakedUsdCents: lpUsdCents(staked, lpSupply, stableReserve, stableDecimals),
    walletUsdCents: lpUsdCents(wallet, lpSupply, stableReserve, stableDecimals),
    pendingUsdCents: lightUsdCents(pending, lightReserve, stableReserve, stableDecimals)
  };
  balanceWallet = wallet || 0n;
  balanceStaked = staked || 0n;

  setText("farmPeriod", formatUnix(start) + " → " + formatUnix(end));
  setText("farmFunded", formatUnix(funded));
  setText("farmPoolRate", poolReady && !poolReadFailed && !mismatch ? formatRate(poolRate) : "—");
  setText("farmChefRate", formatRate(chefRate));
  setText("aprValue", formatAprScaled(aprScaled));
  const note = getEl("aprNote");
  if (note) { note.hidden = false; note.textContent = "variable, not guaranteed"; }

  const lines = [];
  if (!poolReady) {
    lines.push("Pool not added yet. Deposit stays disabled until the owner calls add().");
  } else if (poolReadFailed) {
    lines.push("Could not read this pool. Staking and APR stay hidden.");
  } else if (mismatch) {
    lines.push("Pool pid " + currentFarm.pid + " does not match the configured LP. Staking and APR are hidden.");
  }
  if (paused === true) {
    lines.push("Paused. New deposits are disabled. Withdraw, harvest and emergency withdraw still work.");
  }
  if (phase === "not-started") lines.push("Not started.");
  else if (phase === "ended") lines.push("Ended.");
  else if (phase === "not-funded") lines.push("Not funded.");
  else if (poolReady && !poolReadFailed && !mismatch && (totalStaked == null || totalStaked === 0n)) {
    lines.push("No LP staked yet, so APR is unavailable.");
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
      await assertMinato();
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
    if (isMinato()) await assertMinato();
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
    if (isMinato()) await assertMinato();
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
    if (isMinato()) await assertMinato();
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
    await assertMinato();
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

function fillAmount(raw) {
  if (txBusy) return;
  if (raw == null || !userAddress) return;
  const input = getEl("stakeAmount");
  if (!input) return;
  const dec = isMinato() && farmState && farmState.lpDecimals != null ? farmState.lpDecimals : 18;
  input.value = isMinato() ? ethers.formatUnits(raw, dec) : ethers.formatEther(raw);
  if (isMinato()) paintMinatoActions();
  else refreshFarmUI();
}

function fillFraction(numer, denom) {
  if (!isMinato() || !farmState) return;
  const base = isStakeMode ? farmState.wallet : farmState.staked;
  fillAmount(fractionOf(base, numer, denom));
}

const btnMax = getEl("btnMax");
if (btnMax) {
  btnMax.onclick = () => {
    if (!userAddress) return;
    fillAmount(isStakeMode ? balanceWallet : balanceStaked);
  };
}
const btnPct25 = getEl("btnPct25");
const btnPct50 = getEl("btnPct50");
const btnPctMax = getEl("btnPctMax");
if (btnPct25) btnPct25.onclick = () => fillFraction(25n, 100n);
if (btnPct50) btnPct50.onclick = () => fillFraction(50n, 100n);
if (btnPctMax) btnPctMax.onclick = () => fillFraction(1n, 1n);

const stakeInput = getEl("stakeAmount");
if (stakeInput) {
  stakeInput.addEventListener("input", () => {
    if (isMinato()) paintMinatoActions();
    else refreshFarmUI();
  });
}
