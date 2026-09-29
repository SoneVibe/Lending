/*
 * SoneVibe Portal — registry of chains, assets and routes.
 *
 * Adding a new asset or chain is a config change: the route engine
 * (portal-xcm.js) builds every transfer from the data below.
 * All locations/ids were read from mainnet storage (Asset Hub spec 2005000, Astar spec 2400).
 */
(function (root) {
  const AH_PARA = 1000;
  const ASTAR_PARA = 2006;

  const eth = (key) => ({ parents: 2, interior: { X2: [{ GlobalConsensus: { Ethereum: { chainId: 1 } } }, { AccountKey20: { network: null, key } }] } });

  const chains = {
    assethub: {
      id: 'assethub', name: 'Polkadot Asset Hub', short: 'Asset Hub', eco: 'Polkadot', kind: 'substrate',
      color: '#E6007A', ss58: 0, paraId: AH_PARA, nativeSymbol: 'DOT', nativeDecimals: 10,
      ws: ['wss://polkadot-asset-hub-rpc.polkadot.io', 'wss://sys.ibp.network/asset-hub-polkadot', 'wss://asset-hub-polkadot-rpc.n.dwellir.com', 'wss://polkadot-asset-hub.api.onfinality.io/public-ws'],
      explorerTx: 'https://assethub-polkadot.subscan.io/extrinsic/', explorerAcct: 'https://assethub-polkadot.subscan.io/account/',
      blurb: 'Home of DOT, USDt and USDC on Polkadot.'
    },
    hubevm: {
      id: 'hubevm', name: 'Polkadot Hub EVM', short: 'Hub EVM', eco: 'Polkadot', kind: 'evm', twinOf: 'assethub',
      color: '#FF2670', chainId: 420420419, nativeSymbol: 'DOT', nativeDecimals: 18,
      rpc: 'https://services.polkadothub-rpc.com/mainnet',
      explorerTx: 'https://blockscout.polkadot.io/tx/', explorerAcct: 'https://blockscout.polkadot.io/address/',
      blurb: 'Same chain as Asset Hub, seen through MetaMask. SoneVibe DEX lives here.',
      addChain: {
        chainId: '0x190f1b43', chainName: 'Polkadot Hub', rpcUrls: ['https://services.polkadothub-rpc.com/mainnet'],
        nativeCurrency: { name: 'Polkadot', symbol: 'DOT', decimals: 18 }, blockExplorerUrls: ['https://blockscout.polkadot.io/']
      }
    },
    astar: {
      id: 'astar', name: 'Astar Network', short: 'Astar', eco: 'Astar', kind: 'substrate',
      color: '#0AE2FF', ss58: 5, paraId: ASTAR_PARA, nativeSymbol: 'ASTR', nativeDecimals: 18,
      ws: ['wss://rpc.astar.network', 'wss://astar.api.onfinality.io/public-ws', 'wss://astar-rpc.n.dwellir.com'],
      explorerTx: 'https://astar.subscan.io/extrinsic/', explorerAcct: 'https://astar.subscan.io/account/',
      blurb: 'Astar native (Substrate) accounts.'
    },
    astarevm: {
      id: 'astarevm', name: 'Astar EVM', short: 'Astar EVM', eco: 'Astar', kind: 'evm', twinOf: 'astar', destinationOnly: true,
      color: '#1B6DC1', chainId: 592, nativeSymbol: 'ASTR', nativeDecimals: 18, rpc: 'https://evm.astar.network',
      explorerTx: 'https://astar.blockscout.com/tx/', explorerAcct: 'https://astar.blockscout.com/address/',
      blurb: 'Your MetaMask address on Astar. XC assets appear as ERC20 at 0xFFFFFFFF…'
    },
    ethereum: {
      id: 'ethereum', name: 'Ethereum', short: 'Ethereum', eco: 'Ethereum', kind: 'external', color: '#627EEA', chainId: 1,
      blurb: 'Connected to Polkadot through Snowbridge (trustless light-client bridge).'
    },
    soneium: {
      id: 'soneium', name: 'Soneium', short: 'Soneium', eco: 'Soneium', kind: 'external', color: '#F4F4F5', chainId: 1868,
      blurb: 'SoneVibe flagship chain. Linked to Ethereum (canonical bridge) and Astar (CCIP).'
    }
  };

  /*
   * Asset shape:
   *   on.assethub  -> how the asset lives on Asset Hub: native | assets(id) | foreign(location)
   *   on.hubevm    -> ERC20 precompile (or native DOT)
   *   on.astar     -> Astar assets pallet id
   *   ahLoc        -> location as seen from Asset Hub itself (for WithdrawAsset)
   *   remoteLoc    -> location as seen from a sibling parachain (Astar)
   *   astarOut     -> which Astar pallet can send it back to Asset Hub
   */
  const pc = (idx, suffix) => '0x' + idx.toString(16).padStart(8, '0') + '0'.repeat(24) + suffix;
  const trust = (id) => pc(id, '01200000');
  const foreign = (idx) => pc(idx, '02200000');
  const xc = (id) => '0xffffffff' + BigInt(id).toString(16).padStart(32, '0');

  const assets = {
    DOT: {
      symbol: 'DOT', name: 'Polkadot', decimals: 10, icon: 'icons/dot.svg', color: '#E6007A', group: 'core', sufficient: true, minBalance: '100000000',
      on: { assethub: { type: 'native' }, hubevm: { type: 'native' }, astar: { type: 'asset', id: '340282366920938463463374607431768211455' } },
      astarEvmErc20: xc('340282366920938463463374607431768211455'),
      ahLoc: { parents: 1, interior: 'Here' },
      remoteLoc: { parents: 1, interior: 'Here' },
      astarOut: 'xTokens'
    },
    USDT: {
      symbol: 'USDt', name: 'Tether USD (native)', decimals: 6, icon: 'icons/tether.svg', color: '#26A17B', group: 'core', sufficient: true, minBalance: '10000',
      on: { assethub: { type: 'assets', id: 1984 }, hubevm: { type: 'erc20', address: trust(1984) }, astar: { type: 'asset', id: '4294969280' } },
      astarEvmErc20: xc('4294969280'),
      ahLoc: { parents: 0, interior: { X2: [{ PalletInstance: 50 }, { GeneralIndex: 1984 }] } },
      remoteLoc: { parents: 1, interior: { X3: [{ Parachain: AH_PARA }, { PalletInstance: 50 }, { GeneralIndex: 1984 }] } },
      astarOut: 'transferAssets',
      sonevibe: { wrapper: '0xbeE14ad0949eBB63b90E04b8fD0a78AF2F0f3354', label: 'SoneVibe USDT (DEX)' }
    },
    USDC: {
      symbol: 'USDC', name: 'USD Coin (native)', decimals: 6, icon: 'icons/usdc.svg', color: '#2775CA', group: 'core', sufficient: true, minBalance: '10000',
      on: { assethub: { type: 'assets', id: 1337 }, hubevm: { type: 'erc20', address: trust(1337) }, astar: { type: 'asset', id: '4294969281' } },
      astarEvmErc20: xc('4294969281'),
      ahLoc: { parents: 0, interior: { X2: [{ PalletInstance: 50 }, { GeneralIndex: 1337 }] } },
      remoteLoc: { parents: 1, interior: { X3: [{ Parachain: AH_PARA }, { PalletInstance: 50 }, { GeneralIndex: 1337 }] } },
      astarOut: 'transferAssets'
    }
  };

  // Foreign assets on Asset Hub (Snowbridge / parachains). Bridgeable Asset Hub <-> Hub EVM.
  const foreignList = [
    ['ETH', 'Ether (Snowbridge)', 18, 37, { parents: 2, interior: { X1: [{ GlobalConsensus: { Ethereum: { chainId: 1 } } }] } }, true, '15000000000000', 'icons/eth.svg', 'ethereum'],
    ['WETH', 'Wrapped Ether (Snowbridge)', 18, 2, eth('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'), true, '15000000000000', 'icons/weth.svg', 'ethereum'],
    ['USDC.e', 'USDC from Ethereum', 6, 18, eth('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'), true, '10000', 'icons/usdc.svg', 'ethereum'],
    ['USDT.e', 'USDT from Ethereum', 6, 39, eth('0xdac17f958d2ee523a2206206994597c13d831ec7'), true, '10000', 'icons/tether.svg', 'ethereum'],
    ['WBTC', 'Wrapped BTC (Snowbridge)', 8, 31, eth('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'), false, '1', 'icons/wbtc.svg', 'ethereum'],
    ['tBTC', 'tBTC (Snowbridge)', 18, 23, eth('0x18084fba666a33d37592fa2633fd49a74dd93a88'), false, '1', '', 'ethereum'],
    ['wstETH', 'Lido wstETH (Snowbridge)', 18, 24, eth('0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0'), false, '1', '', 'ethereum'],
    ['DAI', 'Dai (Snowbridge)', 18, 27, eth('0x6b175474e89094c44da98b954eedeac495271d0f'), false, '1', '', 'ethereum'],
    ['EURC', 'Euro Coin (Snowbridge)', 6, 14, eth('0x1abaea1f7c830bd89acc67ec4af516284b1bc33c'), false, '1', '', 'ethereum'],
    ['LINK', 'Chainlink (Snowbridge)', 18, 42, eth('0x514910771af9ca656af840dff83e8264ecf986ca'), false, '1', '', 'ethereum'],
    ['AAVE', 'Aave (Snowbridge)', 18, 44, eth('0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'), false, '1', '', 'ethereum'],
    ['sUSDe', 'Ethena sUSDe (Snowbridge)', 18, 0, eth('0x9d39a5de30e57443bff2a8307a4256c8797a3497'), false, '1', '', 'ethereum'],
    ['KSM', 'Kusama', 12, 7, { parents: 2, interior: { X1: [{ GlobalConsensus: { Kusama: null } }] } }, true, '1000000000', '', 'kusama'],
    ['HOLLAR', 'Hollar (Hydration)', 18, 46, { parents: 1, interior: { X2: [{ Parachain: 2034 }, { GeneralIndex: 222 }] } }, true, '20000000000000000', '', 'polkadot'],
    ['HDX', 'Hydration', 12, 36, { parents: 1, interior: { X2: [{ Parachain: 2034 }, { GeneralIndex: 0 }] } }, false, '1', 'icons/hdx.svg', 'polkadot'],
    ['vDOT', 'Bifrost vDOT', 10, 34, { parents: 1, interior: { X2: [{ Parachain: 2030 }, { GeneralKey: { length: 2, data: '0x0900000000000000000000000000000000000000000000000000000000000000' } }] } }, false, '1', '', 'polkadot'],
    ['BNC', 'Bifrost', 12, 16, { parents: 1, interior: { X2: [{ Parachain: 2030 }, { GeneralKey: { length: 2, data: '0x0001000000000000000000000000000000000000000000000000000000000000' } }] } }, false, '1', '', 'polkadot'],
    ['GLMR', 'Moonbeam', 18, 32, { parents: 1, interior: { X2: [{ Parachain: 2004 }, { PalletInstance: 10 }] } }, false, '1', '', 'polkadot'],
    ['MYTH', 'Mythos', 18, 33, { parents: 1, interior: { X1: [{ Parachain: 3369 }] } }, false, '10000000000000000', '', 'polkadot']
  ];
  const colors = ['#8b5cf6', '#22c55e', '#f59e0b', '#06b6d4', '#ef4444', '#eab308', '#14b8a6', '#f97316'];
  foreignList.forEach(([symbol, name, decimals, idx, loc, sufficient, minBalance, icon, origin], i) => {
    assets[symbol] = {
      symbol, name, decimals, icon, color: colors[i % colors.length], group: 'foreign', origin, sufficient, minBalance,
      on: { assethub: { type: 'foreign', location: loc }, hubevm: { type: 'erc20', address: foreign(idx) } },
      ahLoc: loc
    };
  });

  assets.ASTR = {
    symbol: 'ASTR', name: 'Astar', decimals: 18, icon: 'icons/astr.svg', color: '#0AE2FF', group: 'core', sufficient: true, minBalance: '1000000',
    on: { astar: { type: 'native' } }
  };

  /*
   * Native routes executed by the portal. `method` is implemented in portal-xcm.js.
   * `assets: '*'` = every asset that exists on both sides.
   */
  const routes = [
    { from: 'assethub', to: 'hubevm', method: 'ah-to-twin', assets: '*', eta: '~12 s', label: 'Same chain · instant' },
    { from: 'hubevm', to: 'assethub', method: 'evm-xcm-local', assets: '*', eta: '~12 s', label: 'Same chain · XCM precompile' },
    { from: 'assethub', to: 'astar', method: 'ah-xcm-reserve', assets: ['DOT', 'USDT', 'USDC'], eta: '~30 s', label: 'XCM reserve transfer' },
    { from: 'assethub', to: 'astarevm', method: 'ah-xcm-reserve', assets: ['DOT', 'USDT', 'USDC'], eta: '~30 s', label: 'XCM reserve transfer' },
    { from: 'hubevm', to: 'astar', method: 'evm-xcm-reserve', assets: ['DOT', 'USDT', 'USDC'], eta: '~30 s', label: 'XCM precompile' },
    { from: 'hubevm', to: 'astarevm', method: 'evm-xcm-reserve', assets: ['DOT', 'USDT', 'USDC'], eta: '~30 s', label: 'XCM precompile' },
    { from: 'astar', to: 'assethub', method: 'astar-out', assets: ['DOT', 'USDT', 'USDC'], eta: '~30 s', label: 'XCM back to reserve' },
    { from: 'astar', to: 'hubevm', method: 'astar-out', assets: ['DOT', 'USDT', 'USDC'], eta: '~30 s', label: 'XCM straight to your EVM address' }
  ];

  /* Trusted partner bridges for hops the portal does not sign itself. */
  const partners = [
    { from: 'ethereum', to: 'assethub', assets: ['ETH', 'WETH', 'USDC.e', 'USDT.e', 'WBTC', 'tBTC', 'wstETH', 'DAI', 'EURC', 'LINK', 'AAVE', 'sUSDe'], name: 'Snowbridge', url: 'https://app.snowbridge.network/', eta: '~30 min', note: 'Arrives on Asset Hub. Come back here to move it into Hub EVM in one click.' },
    { from: 'ethereum', to: 'hubevm', assets: ['ETH', 'WETH', 'USDC.e', 'USDT.e', 'WBTC', 'tBTC', 'wstETH', 'DAI', 'EURC', 'LINK', 'AAVE', 'sUSDe'], name: 'Snowbridge', url: 'https://app.snowbridge.network/', eta: '~30 min + 12 s', note: 'Bridge to your Asset Hub deposit address with Snowbridge, then move it to Hub EVM here (Asset Hub → Hub EVM).', via: 'assethub' },
    { from: 'assethub', to: 'ethereum', assets: ['ETH', 'WETH', 'USDC.e', 'USDT.e', 'WBTC', 'tBTC', 'wstETH', 'DAI', 'EURC', 'LINK', 'AAVE', 'sUSDe', 'DOT'], name: 'Snowbridge', url: 'https://app.snowbridge.network/', eta: '~30–60 min', note: 'Ethereum-side gas is paid in DOT on Asset Hub.' },
    { from: 'hubevm', to: 'ethereum', assets: ['ETH', 'WETH', 'USDC.e', 'USDT.e', 'WBTC', 'tBTC', 'wstETH', 'DAI', 'EURC', 'LINK', 'AAVE', 'sUSDe', 'DOT'], name: 'Snowbridge', url: 'https://app.snowbridge.network/', eta: '~30–60 min', note: 'First move the asset to Asset Hub here (Hub EVM → Asset Hub), then use Snowbridge.', via: 'assethub' },
    { from: 'ethereum', to: 'soneium', assets: ['ETH', 'USDC.e'], name: 'Soneium Bridge', url: 'https://superbridge.app/soneium', eta: '~3 min', note: 'Canonical OP-Stack bridge.' },
    { from: 'soneium', to: 'ethereum', assets: ['ETH', 'USDC.e'], name: 'Soneium Bridge', url: 'https://superbridge.app/soneium', eta: '~7 days (withdrawal)', note: 'Canonical withdrawals wait 7 days. Fast bridges (Relay, Across) settle in minutes.' },
    { from: 'astar', to: 'soneium', assets: ['ASTR'], name: 'Astar Portal · CCIP', url: 'https://portal.astar.network/', eta: '~20 min', note: 'Chainlink CCIP lane for ASTR between Astar and Soneium.' },
    { from: 'astarevm', to: 'soneium', assets: ['ASTR'], name: 'Astar Portal · CCIP', url: 'https://portal.astar.network/', eta: '~20 min', note: 'Chainlink CCIP lane for ASTR between Astar and Soneium.' },
    { from: 'soneium', to: 'astar', assets: ['ASTR'], name: 'Astar Portal · CCIP', url: 'https://portal.astar.network/', eta: '~20 min', note: 'Chainlink CCIP lane for ASTR between Soneium and Astar.' }
  ];

  /* Explicitly unsupported pairs, with the reason shown to the user. */
  const blocked = [
    { asset: 'ASTR', to: ['assethub', 'hubevm'], reason: 'ASTR is not registered as a foreign asset on Polkadot Asset Hub yet, so it cannot land there. Registration has to be proposed by Astar governance over XCM. Use the Astar ⇄ Soneium CCIP lane meanwhile.' }
  ];

  const xcmPrecompile = '0x00000000000000000000000000000000000a0000';
  const weightMargin = 1.3;

  const cfg = { chains, assets, routes, partners, blocked, xcmPrecompile, weightMargin, AH_PARA, ASTAR_PARA };
  if (typeof module !== 'undefined' && module.exports) module.exports = cfg;
  root.SV_PORTAL = cfg;
})(typeof window !== 'undefined' ? window : globalThis);
