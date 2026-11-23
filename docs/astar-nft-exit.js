/**
 * Temporary owner/seller tool: cancel SoneVibe Astar NFT market listings via RPC.
 * Proxy + ABI: docs/market-config.js (chain 592).
 * Event: ItemListed. Cancel: cancelListing(address _nftContract, uint256 _tokenId).
 * No listing id. NFT always returns to the listing seller.
 */
(function () {
  'use strict';

  const ASTAR_CHAIN_ID = 592;
  const ASTAR_CHAIN_HEX = '0x250';
  const MARKET = '0x691459a1D00e6fa2BD39502FF58BfDE8a804940c';
  const DEPLOY_BLOCK = 11702077;
  const RPC_URL = 'https://evm.astar.network';
  const IDEAL_CHUNK = 5000; // requested; public Astar RPC often caps near ~1024
  const MIN_CHUNK = 250;

  const MARKET_ABI = [
    'event ItemListed(address indexed seller, address indexed nftContract, uint256 indexed tokenId, uint256 amount, uint256 pricePerUnit, string standard)',
    'event ItemCanceled(address indexed seller, address indexed nftContract, uint256 indexed tokenId)',
    'event ItemSold(address indexed buyer, address indexed nftContract, uint256 indexed tokenId, uint256 amount, uint256 totalPrice)',
    'function listings(address,uint256) view returns (address seller, address nftContract, uint256 tokenId, uint256 pricePerUnit, uint256 amount, uint8 tokenType, bool active)',
    'function cancelListing(address _nftContract, uint256 _tokenId)',
    'function owner() view returns (address)'
  ];
  const ERC721_ABI = [
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function name() view returns (string)'
  ];

  const KNOWN_COLLECTIONS = {
    '0xd59fc6bfd9732ab19b03664a45dc29b8421bda9a': 'Astar Degens Official',
    '0x74d9431c9cd7a1872fcef824348a8475f6e0ef99': 'Test Degen'
  };

  const IPFS_GATEWAYS = [
    'https://ipfs.io/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://gateway.pinata.cloud/ipfs/'
  ];

  const el = (id) => document.getElementById(id);

  let ethProvider = null;
  let readProvider = null;
  let signer = null;
  let account = null;
  let chainId = null;
  let marketOwner = null;
  let listings = []; // active listings from scan / manual
  let selected = null;
  let lastSimOk = false;
  let lastSimKey = '';
  let scanAbort = false;
  let scanning = false;

  function setStatus(node, text, kind) {
    node.textContent = text || '';
    node.className = 'status' + (kind ? ' ' + kind : '');
  }

  function short(addr) {
    if (!addr || addr.length < 12) return addr || '—';
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  function keyOf(nft, tokenId) {
    return nft.toLowerCase() + ':' + String(tokenId);
  }

  function getEthereum() {
    return window.ethereum || null;
  }

  function marketRead() {
    return new ethers.Contract(MARKET, MARKET_ABI, readProvider || ethProvider);
  }

  function marketWrite() {
    return new ethers.Contract(MARKET, MARKET_ABI, signer);
  }

  function isSellerOrOwner(listing) {
    if (!account || !listing) return false;
    const a = account.toLowerCase();
    if (listing.seller.toLowerCase() === a) return true;
    if (marketOwner && marketOwner.toLowerCase() === a) return true;
    return false;
  }

  function isMarketOwnerConnected() {
    return !!(account && marketOwner && account.toLowerCase() === marketOwner.toLowerCase());
  }

  function roleText() {
    if (!account) return '—';
    if (isMarketOwnerConnected()) return 'Market owner (may cancel any listing; NFT returns to seller)';
    return 'Connected wallet (can cancel only own listings)';
  }

  async function refreshOwner() {
    if (!readProvider && !ethProvider) return;
    try {
      marketOwner = await marketRead().owner();
      el('marketOwner').textContent = marketOwner;
    } catch (e) {
      marketOwner = null;
      el('marketOwner').textContent = 'read failed';
    }
    el('roleLabel').textContent = roleText();
  }

  async function connect() {
    const eth = getEthereum();
    if (!eth) {
      setStatus(el('walletStatus'), 'No Ethereum provider found. Install MetaMask.', 'bad');
      return;
    }
    ethProvider = new ethers.BrowserProvider(eth, 'any');
    readProvider = ethProvider;
    const accounts = await ethProvider.send('eth_requestAccounts', []);
    account = accounts[0] || null;
    signer = account ? await ethProvider.getSigner() : null;
    await refreshChain();
    await refreshOwner();
    updateSelectionUi();
    setStatus(el('walletStatus'), account ? 'Wallet connected.' : 'No account returned.', account ? 'ok' : 'bad');
  }

  async function refreshChain() {
    if (!ethProvider) return;
    const net = await ethProvider.getNetwork();
    chainId = Number(net.chainId);
    el('chainId').textContent = String(chainId) + (chainId === ASTAR_CHAIN_ID ? ' (Astar)' : ' — switch required');
    el('connectedAddr').textContent = account || '—';
    if (chainId !== ASTAR_CHAIN_ID) {
      setStatus(el('walletStatus'), 'Wrong network. Refuse unless chain id is 592.', 'warn');
    }
  }

  async function switchToAstar() {
    const eth = getEthereum();
    if (!eth) {
      setStatus(el('walletStatus'), 'No wallet provider.', 'bad');
      return;
    }
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ASTAR_CHAIN_HEX }] });
    } catch (err) {
      if (err && (err.code === 4902 || err.code === '4902')) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: ASTAR_CHAIN_HEX,
            chainName: 'Astar',
            nativeCurrency: { name: 'ASTR', symbol: 'ASTR', decimals: 18 },
            rpcUrls: [RPC_URL],
            blockExplorerUrls: ['https://astar.blockscout.com']
          }]
        });
      } else {
        setStatus(el('walletStatus'), 'Switch rejected: ' + (err.message || err), 'bad');
        return;
      }
    }
    await refreshChain();
    await refreshOwner();
    lastSimOk = false;
    updateSelectionUi();
  }

  function ensureReadProvider() {
    if (ethProvider && chainId === ASTAR_CHAIN_ID) {
      readProvider = ethProvider;
      return readProvider;
    }
    readProvider = new ethers.JsonRpcProvider(RPC_URL, ASTAR_CHAIN_ID, { staticNetwork: true });
    return readProvider;
  }

  function ipfsToHttp(uri, gatewayIndex) {
    if (!uri) return '';
    if (uri.startsWith('ipfs://')) {
      const path = uri.replace(/^ipfs:\/\//, '').replace(/^ipfs\//, '');
      return IPFS_GATEWAYS[gatewayIndex % IPFS_GATEWAYS.length] + path;
    }
    if (uri.startsWith('https://ipfs.io/ipfs/') || uri.includes('/ipfs/')) return uri;
    return uri;
  }

  async function fetchJsonWithFallback(uri) {
    if (!uri) return null;
    if (uri.startsWith('data:application/json')) {
      const raw = uri.replace(/^data:application\/json[^,]*,/, '');
      try { return JSON.parse(decodeURIComponent(raw)); } catch { return null; }
    }
    const attempts = uri.startsWith('ipfs://') ? IPFS_GATEWAYS.length : 1;
    for (let i = 0; i < attempts; i++) {
      const url = ipfsToHttp(uri, i);
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) continue;
        return await res.json();
      } catch (_) { /* try next gateway */ }
    }
    return null;
  }

  async function loadMetadata(nft, tokenId) {
    const c = new ethers.Contract(nft, ERC721_ABI, ensureReadProvider());
    let name = KNOWN_COLLECTIONS[nft.toLowerCase()] || short(nft);
    let image = '';
    let tokenName = '#' + String(tokenId);
    try {
      const collectionName = await c.name().catch(() => null);
      if (collectionName) name = collectionName;
    } catch (_) {}
    try {
      const uri = await c.tokenURI(tokenId);
      const meta = await fetchJsonWithFallback(uri);
      if (meta) {
        if (meta.name) tokenName = meta.name;
        const img = meta.image || meta.image_url || meta.animation_url || '';
        if (img) {
          if (img.startsWith('ipfs://')) image = ipfsToHttp(img, 0);
          else image = img;
        }
      }
    } catch (_) {}
    return { collectionName: name, tokenName, image };
  }

  async function readListing(nft, tokenId) {
    const L = await marketRead().listings(nft, tokenId);
    return {
      seller: L.seller,
      nftContract: L.nftContract && L.nftContract !== ethers.ZeroAddress ? L.nftContract : nft,
      tokenId: L.tokenId.toString() === '0' ? String(tokenId) : L.tokenId.toString(),
      pricePerUnit: L.pricePerUnit,
      amount: L.amount,
      tokenType: Number(L.tokenType),
      active: L.active
    };
  }

  async function queryLogsChunk(provider, topic, fromBlock, toBlock) {
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await provider.getLogs({
          address: MARKET,
          topics: [topic],
          fromBlock,
          toBlock
        });
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
    throw lastErr || new Error('getLogs failed');
  }

  async function scanListings() {
    if (scanning) return;
    scanning = true;
    scanAbort = false;
    listings = [];
    selected = null;
    lastSimOk = false;
    el('listingCards').innerHTML = '';
    updateSelectionUi();

    const provider = ensureReadProvider();
    const market = new ethers.Contract(MARKET, MARKET_ABI, provider);
    const topic = market.interface.getEvent('ItemListed').topicHash;
    const tip = await provider.getBlockNumber();
    const start = DEPLOY_BLOCK;
    const total = Math.max(1, tip - start + 1);

    setStatus(el('scanStatus'), 'Scanning ItemListed from block ' + start + ' to ' + tip + '…', 'warn');
    el('scanBar').style.width = '0%';

    const seen = new Map(); // key -> latest event info
    let chunk = IDEAL_CHUNK;
    let from = start;
    let scanned = 0;

    while (from <= tip && !scanAbort) {
      let to = Math.min(from + chunk - 1, tip);
      let logs = null;
      while (!logs) {
        try {
          logs = await queryLogsChunk(provider, topic, from, to);
        } catch (e) {
          if (chunk > MIN_CHUNK) {
            chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2));
            to = Math.min(from + chunk - 1, tip);
            setStatus(
              el('scanStatus'),
              'RPC rejected range; retrying with chunk ' + chunk + ' (blocks ' + from + '–' + to + ')…',
              'warn'
            );
            continue;
          }
          setStatus(el('scanStatus'), 'Scan failed at ' + from + '–' + to + ': ' + (e.shortMessage || e.message || e), 'bad');
          scanning = false;
          return;
        }
      }

      for (const log of logs) {
        try {
          const parsed = market.interface.parseLog(log);
          const nft = parsed.args.nftContract;
          const tokenId = parsed.args.tokenId.toString();
          seen.set(keyOf(nft, tokenId), {
            sellerFromEvent: parsed.args.seller,
            nftContract: nft,
            tokenId,
            priceFromEvent: parsed.args.pricePerUnit,
            amountFromEvent: parsed.args.amount,
            standard: parsed.args.standard,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash
          });
        } catch (_) {}
      }

      scanned = to - start + 1;
      const pct = Math.min(100, (scanned / total) * 100);
      el('scanBar').style.width = pct.toFixed(2) + '%';
      setStatus(
        el('scanStatus'),
        'Scanning blocks ' + from + '–' + to + ' / tip ' + tip +
          ' (chunk ' + chunk + '). Unique ItemListed keys: ' + seen.size,
        'warn'
      );
      from = to + 1;
    }

    if (scanAbort) {
      setStatus(el('scanStatus'), 'Scan stopped. Checking active status for events found so far…', 'warn');
    }

    const active = [];
    for (const ev of seen.values()) {
      try {
        const L = await readListing(ev.nftContract, ev.tokenId);
        if (!L.active || L.amount === 0n) continue;
        const meta = await loadMetadata(ev.nftContract, ev.tokenId);
        active.push({
          ...ev,
          seller: L.seller, // authoritative for return address
          pricePerUnit: L.pricePerUnit,
          amount: L.amount,
          tokenType: L.tokenType,
          active: true,
          meta
        });
      } catch (e) {
        console.warn('listings() failed', ev, e);
      }
    }

    listings = active;
    renderCards();
    scanning = false;
    setStatus(
      el('scanStatus'),
      'Done. Active listings: ' + listings.length +
        (listings.length ? '\n' + listings.map((l) =>
          (l.meta.collectionName || short(l.nftContract)) + ' #' + l.tokenId +
          ' seller ' + l.seller + ' @ block ' + l.blockNumber
        ).join('\n') : ''),
      listings.length ? 'ok' : 'warn'
    );
  }

  function renderCards() {
    const box = el('listingCards');
    box.innerHTML = '';
    if (!listings.length) {
      box.innerHTML = '<p style="color:var(--muted);margin:0">No active listings found yet.</p>';
      return;
    }
    listings.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'card';
      const img = document.createElement('img');
      img.alt = item.meta.tokenName || ('#' + item.tokenId);
      img.src = item.meta.image || '';
      img.onerror = () => {
        if (!img.dataset.tried) {
          img.dataset.tried = '1';
          if (item.meta.image && item.meta.image.includes('ipfs')) {
            // try next gateway path rewrite
            const m = item.meta.image.match(/\/ipfs\/(.+)$/);
            if (m) img.src = IPFS_GATEWAYS[1] + m[1];
            return;
          }
        }
        img.style.display = 'none';
      };
      const body = document.createElement('div');
      const title = (item.meta.collectionName || short(item.nftContract)) + ' — ' + (item.meta.tokenName || ('#' + item.tokenId));
      body.innerHTML =
        '<h3></h3>' +
        '<dl class="kv">' +
        '<dt>Collection</dt><dd></dd>' +
        '<dt>tokenId</dt><dd></dd>' +
        '<dt>Seller (return to)</dt><dd></dd>' +
        '<dt>Price</dt><dd></dd>' +
        '<dt>Listed at block</dt><dd></dd>' +
        '</dl>' +
        '<div class="actions"><button type="button" class="primary pick">Select</button></div>';
      body.querySelector('h3').textContent = title;
      const dds = body.querySelectorAll('dd');
      dds[0].textContent = item.nftContract;
      dds[1].textContent = String(item.tokenId);
      dds[2].textContent = item.seller;
      dds[3].textContent = ethers.formatEther(item.pricePerUnit) + ' WASTR';
      dds[4].textContent = String(item.blockNumber || '—');
      body.querySelector('.pick').addEventListener('click', () => selectListing(item));
      card.appendChild(img);
      card.appendChild(body);
      box.appendChild(card);
    });
  }

  function selectListing(item) {
    selected = item;
    lastSimOk = false;
    lastSimKey = '';
    updateSelectionUi();
    setStatus(el('simStatus'), 'Selected. Expected NFT return address after cancel: ' + item.seller, 'warn');
  }

  function updateSelectionUi() {
    if (!selected) {
      el('selNft').textContent = '—';
      el('selToken').textContent = '—';
      el('selSeller').textContent = '—';
      el('selPrice').textContent = '—';
      el('selTarget').textContent = MARKET;
      el('ownerCancelNote').classList.remove('show');
      el('btnCancel').disabled = true;
      return;
    }
    el('selNft').textContent = selected.nftContract;
    el('selToken').textContent = String(selected.tokenId);
    el('selSeller').textContent = selected.seller;
    el('selPrice').textContent = ethers.formatEther(selected.pricePerUnit) + ' WASTR';
    el('selTarget').textContent = MARKET + ' → cancelListing(' + selected.nftContract + ', ' + selected.tokenId + ')';

    const ownerActing = isMarketOwnerConnected() && selected.seller.toLowerCase() !== (account || '').toLowerCase();
    if (ownerActing) {
      el('ownerCancelNote').classList.add('show');
      el('ownerCancelSeller').textContent = selected.seller;
    } else {
      el('ownerCancelNote').classList.remove('show');
    }

    const key = simKey(selected);
    const ok =
      !!account &&
      chainId === ASTAR_CHAIN_ID &&
      isSellerOrOwner(selected) &&
      lastSimOk &&
      lastSimKey === key;
    el('btnCancel').disabled = !ok;
  }

  function simKey(item) {
    return [item.nftContract.toLowerCase(), String(item.tokenId), item.seller.toLowerCase(), account, chainId].join('|');
  }

  async function loadManual() {
    setStatus(el('manualStatus'), '', '');
    const nft = (el('manualNft').value || '').trim();
    const tokenId = (el('manualToken').value || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(nft)) {
      setStatus(el('manualStatus'), 'Enter a valid collection address.', 'bad');
      return;
    }
    if (!/^\d+$/.test(tokenId)) {
      setStatus(el('manualStatus'), 'Enter a numeric tokenId.', 'bad');
      return;
    }
    try {
      ensureReadProvider();
      const L = await readListing(nft, tokenId);
      if (!L.active || L.amount === 0n) {
        setStatus(el('manualStatus'), 'listings() reports this is not an active listing.', 'bad');
        return;
      }
      const meta = await loadMetadata(nft, tokenId);
      const item = {
        seller: L.seller,
        nftContract: ethers.getAddress(nft),
        tokenId: String(tokenId),
        pricePerUnit: L.pricePerUnit,
        amount: L.amount,
        tokenType: L.tokenType,
        active: true,
        blockNumber: null,
        meta
      };
      // upsert into listings list
      const k = keyOf(item.nftContract, item.tokenId);
      listings = listings.filter((x) => keyOf(x.nftContract, x.tokenId) !== k).concat([item]);
      renderCards();
      selectListing(item);
      setStatus(
        el('manualStatus'),
        'Active listing loaded. Seller / expected return address: ' + item.seller,
        'ok'
      );
    } catch (e) {
      setStatus(el('manualStatus'), 'Failed: ' + (e.shortMessage || e.message || e), 'bad');
    }
  }

  async function simulate() {
    setStatus(el('simStatus'), '', '');
    lastSimOk = false;
    lastSimKey = '';
    updateSelectionUi();

    if (!selected) {
      setStatus(el('simStatus'), 'Select a listing first.', 'bad');
      return;
    }
    if (!account || !signer) {
      setStatus(el('simStatus'), 'Connect wallet first.', 'bad');
      return;
    }
    if (chainId !== ASTAR_CHAIN_ID) {
      setStatus(el('simStatus'), 'Refuse: chain id is not 592.', 'bad');
      return;
    }
    if (!isSellerOrOwner(selected)) {
      setStatus(el('simStatus'), 'Connected wallet is neither the seller nor the market owner.', 'bad');
      return;
    }

    // Refresh listing so seller/return address is current
    try {
      const L = await readListing(selected.nftContract, selected.tokenId);
      if (!L.active) {
        setStatus(el('simStatus'), 'Listing is no longer active.', 'bad');
        return;
      }
      selected.seller = L.seller;
      selected.pricePerUnit = L.pricePerUnit;
      selected.amount = L.amount;
      updateSelectionUi();
    } catch (e) {
      setStatus(el('simStatus'), 'Could not re-read listing: ' + (e.message || e), 'bad');
      return;
    }

    try {
      const m = marketWrite();
      setStatus(
        el('simStatus'),
        'Simulating cancelListing on ' + MARKET +
          '\nArgs: (' + selected.nftContract + ', ' + selected.tokenId + ')' +
          '\nExpected NFT return address (listing seller): ' + selected.seller +
          '\nvalue: 0',
        'warn'
      );
      await m.cancelListing.staticCall(selected.nftContract, selected.tokenId);
      // optional gas estimate
      let gas = null;
      try {
        gas = await m.cancelListing.estimateGas(selected.nftContract, selected.tokenId);
      } catch (_) {}
      lastSimOk = true;
      lastSimKey = simKey(selected);
      updateSelectionUi();
      setStatus(
        el('simStatus'),
        'eth_call OK.' +
          (gas != null ? ' estimateGas ≈ ' + gas.toString() + ' (~180k expected).' : '') +
          '\nTarget: ' + MARKET +
          '\nFunction: cancelListing(address,uint256)' +
          '\nNFT will return to seller: ' + selected.seller,
        'ok'
      );
    } catch (e) {
      lastSimOk = false;
      lastSimKey = '';
      updateSelectionUi();
      setStatus(el('simStatus'), 'eth_call failed — cancel blocked.\n' + (e.shortMessage || e.reason || e.message || e), 'bad');
    }
  }

  async function cancel() {
    setStatus(el('txStatus'), '', '');
    if (el('btnCancel').disabled || !selected) return;
    if (chainId !== ASTAR_CHAIN_ID) {
      setStatus(el('txStatus'), 'Refuse: chain id is not 592.', 'bad');
      return;
    }
    if (!isSellerOrOwner(selected)) {
      setStatus(el('txStatus'), 'Not seller or market owner.', 'bad');
      return;
    }
    if (!lastSimOk || lastSimKey !== simKey(selected)) {
      setStatus(el('txStatus'), 'Re-run eth_call for the current listing first.', 'bad');
      return;
    }

    const expectedReturn = selected.seller; // MUST be listing seller, not connected wallet
    const nft = selected.nftContract;
    const tokenId = selected.tokenId;

    try {
      const m = marketWrite();
      // Pre-send simulation
      await m.cancelListing.staticCall(nft, tokenId);
      setStatus(
        el('txStatus'),
        'Confirm in wallet.\nTarget: ' + MARKET +
          '\ncancelListing(' + nft + ', ' + tokenId + '), value 0' +
          '\nExpected ownerOf after cancel: ' + expectedReturn,
        'warn'
      );
      const tx = await m.cancelListing(nft, tokenId); // value defaults to 0
      setStatus(el('txStatus'), 'Submitted: ' + tx.hash + '\nWaiting…', 'warn');
      await tx.wait();

      // Post-check: ownerOf must equal THIS listing's seller
      const nftC = new ethers.Contract(nft, ERC721_ABI, ensureReadProvider());
      const ownerNow = await nftC.ownerOf(tokenId);
      const ok = ownerNow.toLowerCase() === expectedReturn.toLowerCase();
      lastSimOk = false;
      lastSimKey = '';
      updateSelectionUi();

      // Refresh listing active flag
      let stillActive = false;
      try {
        const L = await readListing(nft, tokenId);
        stillActive = L.active;
      } catch (_) {}

      setStatus(
        el('txStatus'),
        (ok ? 'Cancel confirmed. NFT is back with the listing seller.\n' : 'Cancel mined but ownerOf mismatch!\n') +
          'ownerOf(' + tokenId + ') = ' + ownerNow + '\n' +
          'expected seller     = ' + expectedReturn + '\n' +
          'listings.active     = ' + stillActive + '\n' +
          'tx: ' + tx.hash,
        ok ? 'ok' : 'bad'
      );

      // update local list
      if (!stillActive) {
        listings = listings.filter((x) => keyOf(x.nftContract, x.tokenId) !== keyOf(nft, tokenId));
        if (selected && keyOf(selected.nftContract, selected.tokenId) === keyOf(nft, tokenId)) {
          selected = null;
        }
        renderCards();
        updateSelectionUi();
      }
    } catch (e) {
      setStatus(el('txStatus'), 'Cancel failed / rejected:\n' + (e.shortMessage || e.reason || e.message || e), 'bad');
    }
  }

  function wire() {
    el('proxyLabel').textContent = MARKET;
    el('btnConnect').addEventListener('click', () => connect().catch((e) => setStatus(el('walletStatus'), String(e.message || e), 'bad')));
    el('btnSwitch').addEventListener('click', () => switchToAstar().catch((e) => setStatus(el('walletStatus'), String(e.message || e), 'bad')));
    el('btnScan').addEventListener('click', () => scanListings().catch((e) => { scanning = false; setStatus(el('scanStatus'), String(e.message || e), 'bad'); }));
    el('btnStopScan').addEventListener('click', () => { scanAbort = true; });
    el('btnManual').addEventListener('click', () => loadManual().catch((e) => setStatus(el('manualStatus'), String(e.message || e), 'bad')));
    el('btnSimulate').addEventListener('click', () => simulate().catch((e) => setStatus(el('simStatus'), String(e.message || e), 'bad')));
    el('btnCancel').addEventListener('click', () => cancel().catch((e) => setStatus(el('txStatus'), String(e.message || e), 'bad')));

    // Prefill known collections for convenience (not a hardcoded recipient — seller is always on-chain)
    el('manualNft').placeholder = '0xd59f… or 0x74d9…';

    const eth = getEthereum();
    if (eth && eth.on) {
      eth.on('accountsChanged', () => { account = null; connect().catch(() => {}); });
      eth.on('chainChanged', () => { window.location.reload(); });
    }

    // Read-only provider for scan without wallet
    ensureReadProvider();
    refreshOwner().catch(() => {});
    updateSelectionUi();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
