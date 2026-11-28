# Contracts

SoneVibe is a Uniswap V2-style constant-product DEX. The main chain is BNB Chain (chainId 56).

Factory and pair source: `DrainFree_VibeSwapCore.sol`. Router source: `VibeSwapRouter.sol`.

## BNB Chain (chainId 56)

The factory and the router are exact-match verified on Sourcify.

| Contract | Address |
| --- | --- |
| Factory | [`0x26b13e7e923e964b0514B3167A90901B49DAe205`](https://bscscan.com/address/0x26b13e7e923e964b0514B3167A90901B49DAe205) · [Sourcify exact match](https://sourcify.dev/#/lookup/0x26b13e7e923e964b0514B3167A90901B49DAe205) |
| Router | [`0xa393E76bE079cF1ccf684D0f815795Dde248f157`](https://bscscan.com/address/0xa393E76bE079cF1ccf684D0f815795Dde248f157) · [Sourcify exact match](https://sourcify.dev/#/lookup/0xa393E76bE079cF1ccf684D0f815795Dde248f157) |
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |
| ETH/USDT pair | `0x93016Fa6e3c184c96Df7466579DfaA970C7cb6A5` |
| USDT/WBNB pair | `0x6dABcbFdFE097e421269a444eBF22999B1EAE279` |

Init code hash: `0x87b780b5d19df9ad0d4c866dcd6b169f14846fb24232a128b678c5bdb395b012`

The router’s `factory()` is the factory above. Its `WETH()` is WBNB.

Each swap charges 0.25% (`amountIn * 9975 / 10000`). On BNB Chain `feeTo` is set. With `feeTo` set, one sixth of fee growth is minted as LP tokens to `feeTo`: liquidity providers receive 0.2083% and the protocol treasury receives 0.0417%. With `feeTo` at the zero address, liquidity providers receive the full 0.25%.

## Admin

On the BNB factory, `owner` and `feeToSetter` are the same address. The router `owner` is that same address.

Factory functions, and who can call them:

- `feeToSetter`: `setFeeTo` (protocol fee recipient), `setFeeToSetter` (transfer that role), `setPairCreationStatus` (open or close permissionless pair creation)
- `owner`: `pause` and `unpause` (new pair creation only), `transferOwnership`, `renounceOwnership`
- `createPair`: anyone while creation is open; only `feeToSetter` while it is closed. A factory pause blocks `createPair` for every caller, including `feeToSetter`

The factory `owner` / `feeToSetter` cannot move tokens out of pairs. Pair contracts have no owner and no admin withdrawal. Tokens leave a pair through `swap`, through `burn` when LP tokens are redeemed, and through `skim` for any balance above the stored reserves.

Router functions for `owner`:

- `pause` and `unpause` pause and unpause router calls

A router pause also blocks removeLiquidity through the router, but LPs can still exit by calling the pair directly (transfer LP to the pair, then burn).

- `rescueFunds` sends tokens or BNB held by the router to `owner`
- `transferOwnership` and `renounceOwnership` transfer or clear router `owner`

`rescueFunds` uses the router’s own balance.

## Soneium (legacy)

### Soneium (chainId 1868) — DEX / LIGHT

| Contract | File | Address | Verification |
| --- | --- | --- | --- |
| VibeFactory (drain-free) | `DrainFree_VibeSwapCore.sol` | `0x77b141dCFDa726e239efF005E3DE7A47AeBFf948` | [Blockscout](https://soneium.blockscout.com/address/0x77b141dCFDa726e239efF005E3DE7A47AeBFf948) · [Sourcify (Arb twin)](https://sourcify.dev/#/lookup/0xA95107ebE4e54480bA755061eF3207c3421150f0) |
| VibeRouter (drain-free) | `VibeSwapRouter.sol` | `0x97C180C2e3097f28D8F14114AD1C0dEF81244344` | [Blockscout](https://soneium.blockscout.com/address/0x97C180C2e3097f28D8F14114AD1C0dEF81244344) · [Sourcify (Arb twin)](https://sourcify.dev/#/lookup/0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72) |
| LIGHT | — | `0x84998bf491C80a79B99540666569F360d5Acae6E` | [Blockscout](https://soneium.blockscout.com/address/0x84998bf491C80a79B99540666569F360d5Acae6E) |
| LightRewards (VibeMasterChefV2) | `LightRewards_VibeMasterChefV2.sol` | `0x8f2F9B17b173C91c7B9195096030a39227B94f62` | [Sourcify exact](https://sourcify.dev/#/lookup/0x8f2F9B17b173C91c7B9195096030a39227B94f62) |

### Soneium — Marketplace (Sourcify exact_match)

Implementation read via EIP-1967 slot `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` (`implementation()` / `getImplementation()` revert on this proxy).

| Contract | Role | File | Address | Sourcify |
| --- | --- | --- | --- | --- |
| SoneVibeProxy | proxy | `SoneVibeProxy.sol` | `0x7242ACB7a27052abBe49EF096aC473e9cBC02627` | exact_match — [Sourcify](https://sourcify.dev/#/lookup/0x7242ACB7a27052abBe49EF096aC473e9cBC02627) |
| SoneVibeMarketV3 | implementation | `SoneVibeMarketV3.sol` | `0x8Bf75C5c411Fdd2AF14002Ce20Ba8b3604437AA0` | exact_match — [Sourcify](https://sourcify.dev/#/lookup/0x8Bf75C5c411Fdd2AF14002Ce20Ba8b3604437AA0) |

### Soneium — Lending (Sourcify exact_match)

Comptroller proxy is `V_Unit`; implementation read on-chain via `getImplementation()` / `masterImplementation()` → `0x95Fd3B75EF4BaFc6c621abc0B08F6b016F672401`. Markets via `allMarkets(uint256)` (live API is `getAllMarketsData()`, not Compound-style `getAllMarkets()`).

| Contract | File | Address | Verification |
| --- | --- | --- | --- |
| Comptroller proxy (V_Unit) | `V_Unit.sol` (+ `V_UnitAdminStorage.sol`) | `0x1126859aB6911Fc3b4f86f2F65E7B6F2eEDe5185` | [Sourcify exact](https://sourcify.dev/#/lookup/0x1126859aB6911Fc3b4f86f2F65E7B6F2eEDe5185) |
| Comptroller implementation (V_MasterEnhanced) | `V_MasterEnhanced.sol` (+ `V_MasterEnhancedUnitSupport.sol`, `V_MasterTypes.sol`, interfaces) | `0x95Fd3B75EF4BaFc6c621abc0B08F6b016F672401` | [Sourcify exact](https://sourcify.dev/#/lookup/0x95Fd3B75EF4BaFc6c621abc0B08F6b016F672401) |
| Oracle (ViveOracleHybridV3) | `vibeoraclesoneium.sol` | `0x6EC1403e2962332205817523f241E34fd41c81CB` | [Sourcify exact](https://sourcify.dev/#/lookup/0x6EC1403e2962332205817523f241E34fd41c81CB) |
| SVUSD | `SVUSD.sol` | `0xcEca29F5f722a2922237c4D2b6Fe46Fa274B190B` | [Sourcify exact](https://sourcify.dev/#/lookup/0xcEca29F5f722a2922237c4D2b6Fe46Fa274B190B) |
| cSVUSD (V_cSVUSD_Mintable) | `V_cSVUSD_Mintable.sol` | `0x65f059eA5C90daE2BbF37a1A8c93A6C843255452` | [Sourcify exact](https://sourcify.dev/#/lookup/0x65f059eA5C90daE2BbF37a1A8c93A6C843255452) |
| SVUSD Stability Module | `SVUSD_StabilityModule.sol` | `0x7F1aF1382899263aF50Bc6d3601bdaB1E17Ba20D` | [Sourcify exact](https://sourcify.dev/#/lookup/0x7F1aF1382899263aF50Bc6d3601bdaB1E17Ba20D) |
| cASTR | `V_cERC20_ExtendedInterest.sol` | `0x7CA06966B0c07C5e35aA180643E98bB3057EBb27` | [Sourcify exact](https://sourcify.dev/#/lookup/0x7CA06966B0c07C5e35aA180643E98bB3057EBb27) |
| cUSDSC | `V_cERC20_ExtendedInterest.sol` | `0xDB3e66b87c42C7F3599fbdcBFe08DfF0689A6D77` | [Sourcify exact](https://sourcify.dev/#/lookup/0xDB3e66b87c42C7F3599fbdcBFe08DfF0689A6D77) |
| cUSDC | `V_cERC20_ExtendedInterest.sol` | `0x96ae93Df119c131469b38e3d558899F23678dCFb` | [Sourcify exact](https://sourcify.dev/#/lookup/0x96ae93Df119c131469b38e3d558899F23678dCFb) |
| JumpRateModelSafe (cASTR / cUSDSC / cUSDC) | `jump.sol` | `0x91414ed684f78b7401c438400e755069dc007cff` | [Sourcify exact](https://sourcify.dev/#/lookup/0x91414ed684f78b7401c438400e755069dc007cff) |
| FixedRateModel (cSVUSD) | `FixedRateModel.sol` | `0x31526a94797ff50af30a7ecda16c459e4a8fc561` | [Sourcify exact](https://sourcify.dev/#/lookup/0x31526a94797ff50af30a7ecda16c459e4a8fc561) |

Supporting project files from the same verified sets (not OpenZeppelin): `SafeTransferLib.sol`, `IV_MasterEnhanced.sol`, `IV_cTokenExtended.sol`, `IV_cTokenMinimal.sol`, `IVibePriceOracle.sol`, `V_MasterTypes.sol`, `V_MasterEnhancedUnitSupport.sol`, `V_UnitAdminStorage.sol`.

`SVUSD_StabilityModule.sol`, `V_MasterEnhanced.sol`, `V_cERC20_ExtendedInterest.sol`, and `FixedRateModel.sol` in this folder are **byte-identical** to the Sourcify exact_match sources for the addresses above (no `Live_` duplicate added).

### LEGACY (not in use)

| Contract | File | Address | Notes |
| --- | --- | --- | --- |
| Old Soneium factory | `VibeSwapCore.sol` | `0x06C0b58287794a0bdce20ce768b601CA974618DC` | Confirmed on-chain. Includes `rescueFundsFromPair`. **Legacy — not in use.** |
| Legacy Soneium router | — | `0xa393E76bE079cF1ccf684D0f815795Dde248f157` | Same address as the live BNB router; on Soneium it is legacy. Live Soneium router is `0x97C180C2e3097f28D8F14114AD1C0dEF81244344`. |

## Arbitrum One (chainId 42161)

Maintenance only. The factory and the router are exact-match verified on Sourcify.

| Contract | Address |
| --- | --- |
| Factory | [`0xA95107ebE4e54480bA755061eF3207c3421150f0`](https://arbiscan.io/address/0xA95107ebE4e54480bA755061eF3207c3421150f0) · [Sourcify exact match](https://sourcify.dev/#/lookup/0xA95107ebE4e54480bA755061eF3207c3421150f0) |
| Router | [`0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72`](https://arbiscan.io/address/0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72) · [Sourcify exact match](https://sourcify.dev/#/lookup/0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72) |

## Astar

Astar is retired.

## Reference copies, not verified as deployed source

These renamed local copies are **not** the Sourcify-verified deployed source (or have no live mapping):

| File | Notes |
| --- | --- |
| [`sonevibeoracle.sol`](../archive/sonevibeoracle.sol) | reference copy, not deployed source. Differs from live `vibeoraclesoneium.sol` (trailing newline only, but not byte-identical). Live oracle → `vibeoraclesoneium.sol`. |
| [`JumpRateModel.sol`](../archive/JumpRateModel.sol) | reference copy, not deployed source. Different contract (`JumpRateModel`) from live `jump.sol` (`JumpRateModelSafe`). Live IRM → `jump.sol`. |
| [`VibeMasterChef.sol`](../archive/VibeMasterChef.sol) | reference copy, not deployed source. Not the live chef; live LightRewards → `LightRewards_VibeMasterChefV2.sol`. |

Not in this section (they **are** byte-identical to Sourcify exact_match deployed sources): `V_MasterEnhanced.sol`, `V_cERC20_ExtendedInterest.sol`, `SVUSD_StabilityModule.sol`, `FixedRateModel.sol`.
