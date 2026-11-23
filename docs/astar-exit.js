/**
 * Temporary owner tool: direct Astar XCM precompile assets_withdraw (v1, bytes32 recipient).
 * ABI source: https://github.com/AstarNetwork/Astar/blob/master/precompiles/xcm/XCM.sol
 * Docs: https://docs.astar.network/docs/build/EVM/precompiles/
 */
(function () {
  'use strict';

  const ASTAR_CHAIN_ID = 592;
  const ASTAR_CHAIN_HEX = '0x250';
  const XCM_PRECOMPILE = '0x0000000000000000000000000000000000005004';

  // v1 interface only (Astar/Shiden). bytes32 recipient overload — not the address overload, not XCM_v2.
  const XCM_ABI = [
    'function assets_withdraw(address[] asset_id, uint256[] asset_amount, bytes32 recipient_account_id, bool is_relay, uint256 parachain_id, uint256 fee_index) returns (bool)'
  ];
  const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
  ];

  const ASSETS = {
    HDX: {
      symbol: 'HDX',
      address: '0xffFffFfF0000000000000001000000000000000e',
      decimals: 12,
      parachainId: 2034,
      isRelay: false,
      feeIndex: 0,
      destName: 'Hydration',
      ss58Prefix: 63,
      // 5 HDX: Hydration ED is 1 HDX; 1 HDX minus XCM fee can be lost on an empty account
      testHuman: '5',
      testRaw: 5000000000000n, // 5 * 10^12
      minFullRaw: 2000000000000n, // block full-mode below 2 HDX
      minFullHuman: '2 HDX'
    },
    USDT: {
      symbol: 'USDT',
      address: '0xfFFfffFF000000000000000000000001000007C0',
      decimals: 6,
      parachainId: 1000,
      isRelay: false,
      feeIndex: 0,
      destName: 'Polkadot Asset Hub',
      ss58Prefix: 0,
      testHuman: '0.1',
      testRaw: 100000n, // 0.1 * 10^6 (Asset Hub minBalance 0.01)
      minFullRaw: 20000n, // block full-mode below 0.02 USDT
      minFullHuman: '0.02 USDT'
    },
    DOT: {
      symbol: 'DOT',
      // EIP-55 checksum of 0xFFF…FFF (xcDOT on Astar EVM)
      address: '0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF',
      decimals: 10,
      parachainId: 1000,
      isRelay: false, // is_relay=true reverts: route via Asset Hub
      feeIndex: 0,
      destName: 'Polkadot Asset Hub',
      ss58Prefix: 0,
      testHuman: '0.1',
      testRaw: 1000000000n, // 0.1 * 10^10
      minFullRaw: 500000000n, // block full-mode below 0.05 DOT
      minFullHuman: '0.05 DOT'
    }
  };

  const el = (id) => document.getElementById(id);
  const crypto = window.polkadotUtilCrypto;
  const util = window.polkadotUtil;

  let provider = null;
  let signer = null;
  let account = null;
  let chainId = null;
  let cryptoReady = false;
  let recipient = null; // { pubkeyHex, destSs58, prefix }
  let balances = { HDX: null, USDT: null, DOT: null, ASTR: null, hdxDecimals: 12, usdtDecimals: 6, dotDecimals: 10 };

  function decimalsFor(asset) {
    if (asset.symbol === 'HDX') return balances.hdxDecimals;
    if (asset.symbol === 'USDT') return balances.usdtDecimals;
    if (asset.symbol === 'DOT') return balances.dotDecimals;
    return asset.decimals;
  }
  let lastSimOk = false;
  let lastSimKey = '';

  function setStatus(node, text, kind) {
    node.textContent = text || '';
    node.className = 'status' + (kind ? ' ' + kind : '');
  }

  function isH160(s) {
    return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s.trim());
  }

  function selectedAsset() {
    return ASSETS[el('assetSelect').value];
  }

  function testModeOn() {
    return el('testMode').checked;
  }

  async function ensureCrypto() {
    if (cryptoReady) return;
    if (!crypto || !util) throw new Error('Polkadot crypto libraries failed to load');
    if (typeof crypto.cryptoWaitReady === 'function') {
      await crypto.cryptoWaitReady();
    }
    cryptoReady = true;
  }

  function getEthereum() {
    return window.ethereum || null;
  }

  async function connect() {
    const eth = getEthereum();
    if (!eth) {
      setStatus(el('walletStatus'), 'No Ethereum provider found. Open this page in MetaMask’s browser or install MetaMask.', 'bad');
      return;
    }
    provider = new ethers.BrowserProvider(eth, 'any');
    const accounts = await provider.send('eth_requestAccounts', []);
    account = accounts[0] || null;
    signer = account ? await provider.getSigner() : null;
    await refreshChain();
    await refreshBalances();
    updateAmountUi();
    updateSendEnabled();
    setStatus(el('walletStatus'), account ? 'Wallet connected.' : 'No account returned.', account ? 'ok' : 'bad');
  }

  async function refreshChain() {
    if (!provider) return;
    const net = await provider.getNetwork();
    chainId = Number(net.chainId);
    el('chainId').textContent = String(chainId) + (chainId === ASTAR_CHAIN_ID ? ' (Astar)' : ' — switch required');
    el('connectedAddr').textContent = account || '—';
    if (chainId !== ASTAR_CHAIN_ID) {
      setStatus(el('walletStatus'), 'Wrong network. Refuse to send unless chain id is 592 (Astar). Use “Switch to Astar”.', 'warn');
    }
  }

  async function switchToAstar() {
    const eth = getEthereum();
    if (!eth) {
      setStatus(el('walletStatus'), 'No wallet provider.', 'bad');
      return;
    }
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: ASTAR_CHAIN_HEX }]
      });
    } catch (err) {
      // 4902 = chain not added
      if (err && (err.code === 4902 || err.code === '4902')) {
        try {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: ASTAR_CHAIN_HEX,
              chainName: 'Astar',
              nativeCurrency: { name: 'ASTR', symbol: 'ASTR', decimals: 18 },
              rpcUrls: ['https://evm.astar.network'],
              blockExplorerUrls: ['https://astar.blockscout.com']
            }]
          });
        } catch (addErr) {
          setStatus(el('walletStatus'), 'Could not add Astar network: ' + (addErr.message || addErr), 'bad');
          return;
        }
      } else {
        setStatus(el('walletStatus'), 'Switch rejected: ' + (err.message || err), 'bad');
        return;
      }
    }
    if (provider) {
      await refreshChain();
      await refreshBalances();
      lastSimOk = false;
      updateSendEnabled();
      setStatus(el('walletStatus'), chainId === ASTAR_CHAIN_ID ? 'On Astar (592).' : 'Still not on 592.', chainId === ASTAR_CHAIN_ID ? 'ok' : 'bad');
    }
  }

  async function refreshBalances() {
    if (!provider || !account || chainId !== ASTAR_CHAIN_ID) {
      el('balHdx').textContent = '—';
      el('balUsdt').textContent = '—';
      el('balDot').textContent = '—';
      el('balAstr').textContent = '—';
      return;
    }
    try {
      const hdx = new ethers.Contract(ASSETS.HDX.address, ERC20_ABI, provider);
      const usdt = new ethers.Contract(ASSETS.USDT.address, ERC20_ABI, provider);
      const dot = new ethers.Contract(ASSETS.DOT.address, ERC20_ABI, provider);
      const [hdxBal, usdtBal, dotBal, astrBal, hdxDec, usdtDec, dotDec] = await Promise.all([
        hdx.balanceOf(account),
        usdt.balanceOf(account),
        dot.balanceOf(account),
        provider.getBalance(account),
        hdx.decimals().catch(() => 12),
        usdt.decimals().catch(() => 6),
        dot.decimals().catch(() => 10)
      ]);
      balances.HDX = hdxBal;
      balances.USDT = usdtBal;
      balances.DOT = dotBal;
      balances.ASTR = astrBal;
      balances.hdxDecimals = Number(hdxDec);
      balances.usdtDecimals = Number(usdtDec);
      balances.dotDecimals = Number(dotDec);
      el('balHdx').textContent = ethers.formatUnits(hdxBal, balances.hdxDecimals) + ' HDX (on-chain)';
      el('balUsdt').textContent = ethers.formatUnits(usdtBal, balances.usdtDecimals) + ' USDT (on-chain)';
      el('balDot').textContent = ethers.formatUnits(dotBal, balances.dotDecimals) + ' DOT (on-chain)';
      el('balAstr').textContent = ethers.formatEther(astrBal) + ' ASTR (needed for gas)';
      updateAmountUi();
    } catch (err) {
      setStatus(el('walletStatus'), 'Balance read failed: ' + (err.message || err), 'bad');
    }
  }

  function computeAmount() {
    const asset = selectedAsset();
    if (testModeOn()) {
      return { raw: asset.testRaw, human: asset.testHuman + ' ' + asset.symbol + ' (test)', mode: 'test' };
    }
    if (!el('fullBalance').checked) {
      return { raw: null, human: 'Enable full-balance mode or keep test mode', mode: 'none' };
    }
    const bal = balances[asset.symbol];
    if (bal == null) {
      return { raw: null, human: 'Connect and refresh balances first', mode: 'none' };
    }
    if (bal === 0n) {
      return { raw: null, human: 'On-chain balance is zero', mode: 'none' };
    }
    if (bal < asset.minFullRaw) {
      const dec = decimalsFor(asset);
      return {
        raw: null,
        human:
          'Full-mode blocked: balance ' +
          ethers.formatUnits(bal, dec) +
          ' ' +
          asset.symbol +
          ' is below minimum ' +
          asset.minFullHuman,
        mode: 'none'
      };
    }
    const dec = decimalsFor(asset);
    return {
      raw: bal,
      human: ethers.formatUnits(bal, dec) + ' ' + asset.symbol + ' (full on-chain balance)',
      mode: 'full'
    };
  }

  function updateAmountUi() {
    const asset = selectedAsset();
    const amt = computeAmount();
    el('amountHuman').textContent = amt.human;
    el('amountRaw').textContent = amt.raw == null ? '—' : String(amt.raw);
    el('assetAddr').textContent = asset.address;
    el('destInfo').textContent =
      asset.destName + ' parachain ' + asset.parachainId +
      ', is_relay=' + asset.isRelay +
      ', fee_index=' + asset.feeIndex +
      ', SS58 prefix ' + asset.ss58Prefix;

    const full = el('fullBalance');
    const warn = el('fullWarn');
    if (testModeOn()) {
      full.checked = false;
      full.disabled = true;
      warn.classList.remove('show');
    } else {
      full.disabled = false;
      warn.classList.toggle('show', full.checked);
    }

    lastSimOk = false;
    lastSimKey = '';
    updateCallSummary();
    updateSendEnabled();
  }

  async function decodeRecipient() {
    setStatus(el('addrStatus'), '', '');
    recipient = null;
    el('pubkeyHex').textContent = '—';
    el('destSs58').textContent = '—';
    el('destPrefix').textContent = '—';
    el('ownAddr').checked = false;
    el('ownAddr').disabled = true;
    lastSimOk = false;

    const raw = el('ss58Input').value.trim();
    if (!raw) {
      updateCallSummary();
      updateSendEnabled();
      return;
    }
    if (isH160(raw)) {
      setStatus(el('addrStatus'), 'Rejected: H160 / EVM addresses are not accepted as recipient. Paste an SS58 address.', 'bad');
      updateCallSummary();
      updateSendEnabled();
      return;
    }
    if (/^0x[0-9a-fA-F]+$/.test(raw)) {
      setStatus(el('addrStatus'), 'Rejected: hex / H160-style input is not accepted. Paste an SS58 address only.', 'bad');
      updateCallSummary();
      updateSendEnabled();
      return;
    }

    try {
      await ensureCrypto();
      // ignoreChecksum=false → validates SS58 checksum
      const pub = crypto.decodeAddress(raw, false);
      if (!(pub instanceof Uint8Array) || pub.length !== 32) {
        throw new Error('Expected 32-byte public key');
      }
      const pubkeyHex = util.u8aToHex(pub);
      const asset = selectedAsset();
      const destSs58 = crypto.encodeAddress(pub, asset.ss58Prefix);
      recipient = { pubkeyHex, destSs58, prefix: asset.ss58Prefix, pub };
      el('pubkeyHex').textContent = pubkeyHex;
      el('destSs58').textContent = destSs58;
      el('destPrefix').textContent = String(asset.ss58Prefix) + ' (' + asset.destName + ')';
      el('ownAddr').disabled = false;
      setStatus(
        el('addrStatus'),
        'Checksum OK. Compare the destination SS58 below with your wallet on ' + asset.destName + '.',
        'ok'
      );
    } catch (err) {
      setStatus(el('addrStatus'), 'Invalid SS58 / checksum failed: ' + (err.message || err), 'bad');
    }
    updateCallSummary();
    updateSendEnabled();
  }

  function buildArgs() {
    const asset = selectedAsset();
    const amt = computeAmount();
    if (!recipient || amt.raw == null || amt.raw <= 0n) return null;
    return {
      asset,
      amt,
      assetIds: [asset.address],
      amounts: [amt.raw],
      recipientBytes32: recipient.pubkeyHex,
      isRelay: asset.isRelay,
      parachainId: asset.parachainId,
      feeIndex: asset.feeIndex
    };
  }

  function simKey(args) {
    return [
      args.asset.symbol,
      String(args.amt.raw),
      args.recipientBytes32,
      args.isRelay,
      args.parachainId,
      args.feeIndex,
      account,
      chainId
    ].join('|');
  }

  function updateCallSummary() {
    const args = buildArgs();
    const box = el('callSummary');
    if (!args) {
      box.textContent = 'Incomplete: need valid SS58 recipient and a positive amount (test or full balance).';
      return;
    }
    box.textContent = [
      'Precompile: ' + XCM_PRECOMPILE,
      'Method: assets_withdraw(address[],uint256[],bytes32,bool,uint256,uint256)  [v1 bytes32 overload]',
      'asset_id: [' + args.assetIds[0] + ']',
      'asset_amount: [' + String(args.amounts[0]) + ']  // ' + args.amt.human,
      'recipient_account_id (bytes32): ' + args.recipientBytes32,
      'is_relay: ' + args.isRelay,
      'parachain_id: ' + args.parachainId + '  // ' + args.asset.destName,
      'fee_index: ' + args.feeIndex,
      'from (msg.sender): ' + (account || '(not connected)'),
      'dest SS58 (prefix ' + args.asset.ss58Prefix + '): ' + recipient.destSs58,
      'Note: ASTR needed for EVM gas. No approve(). Direct wallet → precompile only.'
    ].join('\n');
  }

  function updateSendEnabled() {
    const args = buildArgs();
    const key = args && account ? simKey(args) : '';
    const ok =
      !!account &&
      chainId === ASTAR_CHAIN_ID &&
      !!args &&
      el('ownAddr').checked &&
      lastSimOk &&
      lastSimKey === key;
    el('btnSend').disabled = !ok;
  }

  async function simulate() {
    setStatus(el('simStatus'), '', '');
    lastSimOk = false;
    lastSimKey = '';
    updateSendEnabled();

    if (!account || !signer || !provider) {
      setStatus(el('simStatus'), 'Connect wallet first.', 'bad');
      return;
    }
    if (chainId !== ASTAR_CHAIN_ID) {
      setStatus(el('simStatus'), 'Refuse: chain id is not 592.', 'bad');
      return;
    }
    if (!recipient) {
      setStatus(el('simStatus'), 'Paste and validate your SS58 recipient first.', 'bad');
      return;
    }
    if (!el('ownAddr').checked) {
      setStatus(el('simStatus'), 'Tick “This is my own address” before simulating send.', 'warn');
      return;
    }
    const args = buildArgs();
    if (!args) {
      setStatus(el('simStatus'), 'Amount not ready (enable test mode or full-balance after refresh).', 'bad');
      return;
    }

    try {
      const xcm = new ethers.Contract(XCM_PRECOMPILE, XCM_ABI, signer);
      setStatus(el('simStatus'), 'Running eth_call / staticCall of the exact calldata…', 'warn');
      const result = await xcm.assets_withdraw.staticCall(
        args.assetIds,
        args.amounts,
        args.recipientBytes32,
        args.isRelay,
        args.parachainId,
        args.feeIndex
      );
      if (result !== true) {
        lastSimOk = false;
        setStatus(el('simStatus'), 'eth_call returned false — send blocked.', 'bad');
        updateSendEnabled();
        return;
      }
      lastSimOk = true;
      lastSimKey = simKey(args);
      setStatus(el('simStatus'), 'eth_call OK (returned true). Send is now enabled for this exact calldata.', 'ok');
      updateSendEnabled();
    } catch (err) {
      lastSimOk = false;
      lastSimKey = '';
      const msg = err && (err.shortMessage || err.reason || err.message) || String(err);
      setStatus(el('simStatus'), 'eth_call reverted / failed — send blocked.\n' + msg, 'bad');
      updateSendEnabled();
    }
  }

  async function send() {
    setStatus(el('txStatus'), '', '');
    if (el('btnSend').disabled) return;

    if (chainId !== ASTAR_CHAIN_ID) {
      setStatus(el('txStatus'), 'Refuse: chain id is not 592.', 'bad');
      return;
    }
    if (!el('ownAddr').checked || !recipient) {
      setStatus(el('txStatus'), 'Ownership confirmation / recipient missing.', 'bad');
      return;
    }
    const args = buildArgs();
    if (!args || !lastSimOk || lastSimKey !== simKey(args)) {
      setStatus(el('txStatus'), 'Re-run eth_call simulation for the current calldata first.', 'bad');
      return;
    }

    try {
      // Re-simulate immediately before send (same calldata)
      const xcm = new ethers.Contract(XCM_PRECOMPILE, XCM_ABI, signer);
      const pre = await xcm.assets_withdraw.staticCall(
        args.assetIds,
        args.amounts,
        args.recipientBytes32,
        args.isRelay,
        args.parachainId,
        args.feeIndex
      );
      if (pre !== true) {
        lastSimOk = false;
        updateSendEnabled();
        setStatus(el('txStatus'), 'Pre-send eth_call returned false — aborted.', 'bad');
        return;
      }

      setStatus(el('txStatus'), 'Confirm the transaction in your wallet…', 'warn');
      const tx = await xcm.assets_withdraw(
        args.assetIds,
        args.amounts,
        args.recipientBytes32,
        args.isRelay,
        args.parachainId,
        args.feeIndex
      );
      setStatus(el('txStatus'), 'Submitted: ' + tx.hash + '\nWaiting for confirmation…', 'warn');
      const receipt = await tx.wait();
      lastSimOk = false;
      lastSimKey = '';
      updateSendEnabled();
      await refreshBalances();
      setStatus(
        el('txStatus'),
        'Confirmed in block ' + receipt.blockNumber + '.\nTx: ' + tx.hash +
          '\nVerify the test amount on ' + args.asset.destName + ' before any full-balance send.',
        'ok'
      );
    } catch (err) {
      const msg = err && (err.shortMessage || err.reason || err.message) || String(err);
      setStatus(el('txStatus'), 'Send failed / rejected:\n' + msg, 'bad');
    }
  }

  function wire() {
    el('btnConnect').addEventListener('click', () => connect().catch((e) => setStatus(el('walletStatus'), String(e.message || e), 'bad')));
    el('btnSwitch').addEventListener('click', () => switchToAstar().catch((e) => setStatus(el('walletStatus'), String(e.message || e), 'bad')));
    el('btnRefresh').addEventListener('click', () => refreshBalances().catch((e) => setStatus(el('walletStatus'), String(e.message || e), 'bad')));
    el('btnSimulate').addEventListener('click', () => simulate().catch((e) => setStatus(el('simStatus'), String(e.message || e), 'bad')));
    el('btnSend').addEventListener('click', () => send().catch((e) => setStatus(el('txStatus'), String(e.message || e), 'bad')));

    el('assetSelect').addEventListener('change', () => {
      decodeRecipient();
      updateAmountUi();
    });
    el('testMode').addEventListener('change', updateAmountUi);
    el('fullBalance').addEventListener('change', updateAmountUi);
    el('ss58Input').addEventListener('input', () => {
      decodeRecipient();
    });
    el('ownAddr').addEventListener('change', () => {
      lastSimOk = false;
      lastSimKey = '';
      updateSendEnabled();
      setStatus(el('simStatus'), el('ownAddr').checked ? 'Re-run eth_call after confirming ownership.' : '', el('ownAddr').checked ? 'warn' : '');
    });

    const eth = getEthereum();
    if (eth && eth.on) {
      eth.on('accountsChanged', () => {
        account = null;
        connect().catch(() => {});
      });
      eth.on('chainChanged', () => {
        lastSimOk = false;
        window.location.reload();
      });
    }

    updateAmountUi();
    ensureCrypto().catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
