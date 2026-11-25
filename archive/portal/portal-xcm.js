/*
 * SoneVibe Portal — route engine.
 *
 * Pure builders: given connected ApiPromise instances and the registry, return
 * either a Substrate extrinsic or an EVM call for a transfer. Used by portal.js
 * in the browser and by the mainnet dry-run test in Node.
 */
(function (root) {
  const XCM_ABI = [
    'function execute(bytes message, (uint64 refTime, uint64 proofSize) weight)',
    'function send(bytes destination, bytes message)',
    'function weighMessage(bytes message) view returns ((uint64 refTime, uint64 proofSize) weight)'
  ];
  const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address,address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
    'function transfer(address,uint256) returns (bool)'
  ];
  const WRAPPER_ABI = ['function depositFor(address,uint256) returns (bool)', 'function withdrawTo(address,uint256) returns (bool)'];
  const WETH_ABI = ['function deposit() payable', 'function withdraw(uint256)'];

  const DOT_EVM_RATIO = 10n ** 8n;
  const ASTAR_IN_WEIGHT = { refTime: 893441000n, proofSize: 9344n };
  const AH_IN_WEIGHT = { refTime: 672214000n, proofSize: 11036n };

  function create(lib, cfg) {
    const { util, crypto } = lib;
    const { u8aToHex, hexToU8a, u8aConcat, stringToU8a, isHex } = util;
    const { decodeAddress, encodeAddress, blake2AsU8a, keccakAsU8a, isEthereumAddress } = crypto;

    const lower = (h) => h.toLowerCase();
    const isH160 = (s) => typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s.trim());

    /** Asset Hub fallback account of an EVM address: h160 ++ 0xEE * 12 */
    const evmTwin = (h160) => lower(h160) + 'ee'.repeat(12);

    /** EVM address that a native Asset Hub account controls inside pallet-revive. */
    function h160OfAccount(id32) {
      const hex = lower(u8aToHex(typeof id32 === 'string' ? decodeAddress(id32) : id32));
      if (hex.endsWith('ee'.repeat(12))) return '0x' + hex.slice(2, 42);
      return u8aToHex(keccakAsU8a(hexToU8a(hex), 256).slice(12));
    }

    /** Astar maps an EVM address to blake2_256("evm:" ++ h160) (HashedAddressMapping). */
    const astarEvmAccount = (h160) => u8aToHex(blake2AsU8a(u8aConcat(stringToU8a('evm:'), hexToU8a(h160)), 256));

    function toAccountId(addr) {
      const a = addr.trim();
      if (isHex(a) && a.length === 66) return lower(a);
      return u8aToHex(decodeAddress(a));
    }

    function validSS58(addr) {
      try { decodeAddress(addr.trim()); return !isH160(addr); } catch { return false; }
    }

    const ss58 = (id32, prefix) => encodeAddress(typeof id32 === 'string' ? hexToU8a(id32) : id32, prefix);

    /**
     * The Asset Hub account that backs an EVM address. If the owner mapped a native
     * account (revive.mapAccount) that account holds the EVM balance; otherwise the twin does.
     */
    async function hubAccountOf(ahApi, h160) {
      const q = ahApi.query.revive && ahApi.query.revive.originalAccount;
      if (q) {
        const o = await q(h160);
        if (o && o.isSome) return { id: lower(o.unwrap().toHex()), mapped: true };
      }
      return { id: evmTwin(h160), mapped: false };
    }

    async function isMapped(ahApi, id32) {
      const h = h160OfAccount(id32);
      if (id32.toLowerCase().endsWith('ee'.repeat(12))) return true;
      const o = await ahApi.query.revive.originalAccount(h);
      return o.isSome;
    }

    const beneficiary = (id) => ({ parents: 0, interior: { X1: [{ AccountId32: { network: null, id } }] } });
    const para = (id) => ({ parents: 1, interior: { X1: [{ Parachain: id }] } });

    function localMessage(api, asset, amount, id32) {
      return api.createType('XcmVersionedXcm', {
        V5: [
          { WithdrawAsset: [{ id: asset.ahLoc, fun: { Fungible: amount } }] },
          { DepositAsset: { assets: { Wild: { AllCounted: 1 } }, beneficiary: beneficiary(id32) } }
        ]
      });
    }

    function reserveToParaMessage(api, asset, amount, paraId, id32) {
      return api.createType('XcmVersionedXcm', {
        V5: [
          { SetFeesMode: { jitWithdraw: true } },
          {
            TransferReserveAsset: {
              assets: [{ id: asset.ahLoc, fun: { Fungible: amount } }],
              dest: para(paraId),
              xcm: [
                { BuyExecution: { fees: { id: asset.remoteLoc, fun: { Fungible: amount } }, weightLimit: 'Unlimited' } },
                { DepositAsset: { assets: { Wild: { AllCounted: 1 } }, beneficiary: beneficiary(id32) } }
              ]
            }
          }
        ]
      });
    }

    async function weigh(ahApi, msg) {
      const r = await ahApi.call.xcmPaymentApi.queryXcmWeight(msg);
      if (r.isErr) throw new Error('Could not weigh XCM: ' + r.asErr.toString());
      const w = r.asOk;
      const m = BigInt(Math.round(cfg.weightMargin * 100));
      return { refTime: (w.refTime.toBigInt() * m) / 100n, proofSize: (w.proofSize.toBigInt() * m) / 100n };
    }

    /**
     * Resolve the AccountId32 that must receive funds on the destination chain.
     * Returns { id, display, note }.
     */
    async function resolveRecipient(apis, destId, recipient) {
      const r = recipient.trim();
      if (destId === 'hubevm') {
        if (!isH160(r)) throw new Error('Enter a 0x… EVM address for Polkadot Hub EVM.');
        const acc = await hubAccountOf(apis.assethub, r);
        return { id: acc.id, display: r, note: acc.mapped ? 'Mapped account' : 'EVM address (auto-derived Asset Hub account)' };
      }
      if (destId === 'astarevm') {
        if (!isH160(r)) throw new Error('Enter a 0x… EVM address for Astar EVM.');
        return { id: astarEvmAccount(r), display: r, note: 'Astar EVM address' };
      }
      if (isH160(r)) throw new Error('This destination needs a Substrate (SS58) address, not 0x….');
      if (!validSS58(r)) throw new Error('Address is not valid.');
      return { id: toAccountId(r), display: r, note: '' };
    }

    function routeFor(from, to) { return cfg.routes.find((x) => x.from === from && x.to === to); }

    function assetsFor(from, to) {
      const r = routeFor(from, to);
      if (!r) return [];
      const both = (a) => {
        const has = (c) => (c === 'hubevm' ? a.on.hubevm : c === 'astarevm' ? a.on.astar && a.astarEvmErc20 : a.on[c]);
        return has(from) && has(to);
      };
      const list = r.assets === '*' ? Object.keys(cfg.assets) : r.assets;
      return list.filter((k) => cfg.assets[k] && both(cfg.assets[k]));
    }

    /**
     * Build the transfer.
     * amount: bigint in the asset's canonical decimals (DOT = 10).
     * returns { kind: 'substrate', chain, tx } | { kind: 'evm', chain, to, data, value }
     */
    async function build({ apis, iface, from, to, assetKey, amount, recipientId }) {
      const route = routeFor(from, to);
      if (!route) throw new Error('Route not supported');
      const asset = cfg.assets[assetKey];
      const ah = apis.assethub;
      const amt = BigInt(amount);

      switch (route.method) {
        case 'ah-to-twin': {
          const t = asset.on.assethub;
          let tx;
          if (t.type === 'native') tx = ah.tx.balances.transferKeepAlive(recipientId, amt);
          else if (t.type === 'assets') tx = ah.tx.assets.transfer(t.id, recipientId, amt);
          else tx = ah.tx.foreignAssets.transfer(t.location, recipientId, amt);
          return { kind: 'substrate', chain: 'assethub', tx };
        }
        case 'ah-xcm-reserve': {
          const msg = reserveToParaMessage(ah, asset, amt, cfg.ASTAR_PARA, recipientId);
          const w = await weigh(ah, msg);
          return { kind: 'substrate', chain: 'assethub', tx: ah.tx.polkadotXcm.execute(msg, w), weight: w };
        }
        case 'evm-xcm-local':
        case 'evm-xcm-reserve': {
          const msg = route.method === 'evm-xcm-local'
            ? localMessage(ah, asset, amt, recipientId)
            : reserveToParaMessage(ah, asset, amt, cfg.ASTAR_PARA, recipientId);
          const w = await weigh(ah, msg);
          const data = iface.encodeFunctionData('execute', [msg.toHex(), [w.refTime, w.proofSize]]);
          return { kind: 'evm', chain: 'hubevm', to: cfg.xcmPrecompile, data, value: 0n, weight: w, message: msg.toHex() };
        }
        case 'astar-out': {
          const as = apis.astar;
          let tx;
          if (asset.astarOut === 'xTokens') {
            tx = as.tx.xTokens.transferMultiasset(
              { V5: { id: asset.remoteLoc, fun: { Fungible: amt } } },
              { V5: { parents: 1, interior: { X2: [{ Parachain: cfg.AH_PARA }, { AccountId32: { network: null, id: recipientId } }] } } },
              'Unlimited'
            );
          } else {
            tx = as.tx.polkadotXcm.transferAssets(
              { V5: para(cfg.AH_PARA) },
              { V5: beneficiary(recipientId) },
              { V5: [{ id: asset.remoteLoc, fun: { Fungible: amt } }] },
              0,
              'Unlimited'
            );
          }
          return { kind: 'substrate', chain: 'astar', tx };
        }
        default:
          throw new Error('Unknown route method ' + route.method);
      }
    }

    /** Fee charged on the destination chain, in the transferred asset (bigint) or null if not applicable. */
    async function destinationFee(apis, from, to, assetKey) {
      const route = routeFor(from, to);
      const asset = cfg.assets[assetKey];
      try {
        if (route.method === 'ah-xcm-reserve' || route.method === 'evm-xcm-reserve') {
          const r = await apis.astar.call.xcmPaymentApi.queryWeightToAssetFee(ASTAR_IN_WEIGHT, { V5: asset.remoteLoc });
          return r.isOk ? r.asOk.toBigInt() : null;
        }
        if (route.method === 'astar-out') {
          const r = await apis.assethub.call.xcmPaymentApi.queryWeightToAssetFee(AH_IN_WEIGHT, { V5: asset.ahLoc });
          return r.isOk ? r.asOk.toBigInt() : null;
        }
      } catch { /* fall through */ }
      return route.method.startsWith('ah-to') || route.method === 'evm-xcm-local' ? 0n : null;
    }

    return {
      XCM_ABI, ERC20_ABI, WRAPPER_ABI, WETH_ABI, DOT_EVM_RATIO,
      isH160, evmTwin, h160OfAccount, astarEvmAccount, toAccountId, validSS58, ss58, hubAccountOf, isMapped,
      localMessage, reserveToParaMessage, weigh, resolveRecipient, routeFor, assetsFor, build, destinationFee,
      isEthereumAddress
    };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SVXcm = api;
})(typeof window !== 'undefined' ? window : globalThis);
