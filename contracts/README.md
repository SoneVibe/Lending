# Live contract sources

Every live contract file in this folder is byte-identical to its verified source on [Sourcify](https://sourcify.dev).

Sources for deployed VIBE contracts. Explorer / Sourcify verification is against deployed bytecode, so moving or grouping these files does not affect on-chain verification.

Addresses below were confirmed to have contract code via `eth_getCode` on the listed RPCs (Soneium `https://rpc.soneium.org`, BNB `https://bsc-dataseed.bnbchain.org`, Arbitrum `https://arb1.arbitrum.io/rpc`). Sourcify links are chain-1868 exact matches unless noted.

## Soneium (chainId 1868) — DEX / LIGHT

| Contract | File | Address | Verification |
| --- | --- | --- | --- |
| VibeFactory (drain-free) | `DrainFree_VibeSwapCore.sol` | `0x77b141dCFDa726e239efF005E3DE7A47AeBFf948` | [Blockscout](https://soneium.blockscout.com/address/0x77b141dCFDa726e239efF005E3DE7A47AeBFf948) · [Sourcify (Arb twin)](https://sourcify.dev/#/lookup/0xA95107ebE4e54480bA755061eF3207c3421150f0) |
| VibeRouter (drain-free) | `VibeSwapRouter.sol` | `0x97C180C2e3097f28D8F14114AD1C0dEF81244344` | [Blockscout](https://soneium.blockscout.com/address/0x97C180C2e3097f28D8F14114AD1C0dEF81244344) · [Sourcify (Arb twin)](https://sourcify.dev/#/lookup/0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72) |
| LIGHT | — | `0x84998bf491C80a79B99540666569F360d5Acae6E` | [Blockscout](https://soneium.blockscout.com/address/0x84998bf491C80a79B99540666569F360d5Acae6E) |
| LightRewards (VibeMasterChefV2) | `LightRewards_VibeMasterChefV2.sol` | `0x8f2F9B17b173C91c7B9195096030a39227B94f62` | [Sourcify exact](https://sourcify.dev/#/lookup/0x8f2F9B17b173C91c7B9195096030a39227B94f62) |

## Soneium — Marketplace (Sourcify exact_match)

Implementation read via EIP-1967 slot `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` (`implementation()` / `getImplementation()` revert on this proxy).

| Contract | Role | File | Address | Sourcify |
| --- | --- | --- | --- | --- |
| SoneVibeProxy | proxy | `SoneVibeProxy.sol` | `0x7242ACB7a27052abBe49EF096aC473e9cBC02627` | exact_match — [Sourcify](https://sourcify.dev/#/lookup/0x7242ACB7a27052abBe49EF096aC473e9cBC02627) |
| SoneVibeMarketV3 | implementation | `SoneVibeMarketV3.sol` | `0x8Bf75C5c411Fdd2AF14002Ce20Ba8b3604437AA0` | exact_match — [Sourcify](https://sourcify.dev/#/lookup/0x8Bf75C5c411Fdd2AF14002Ce20Ba8b3604437AA0) |

## Soneium — Lending (Sourcify exact_match)

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

## BNB (chainId 56)

| Contract | File | Address | Verification |
| --- | --- | --- | --- |
| VibeFactory (drain-free) | `DrainFree_VibeSwapCore.sol` | `0x26b13e7e923e964b0514B3167A90901B49DAe205` | [BscScan](https://bscscan.com/address/0x26b13e7e923e964b0514B3167A90901B49DAe205) · [Sourcify (Arb twin)](https://sourcify.dev/#/lookup/0xA95107ebE4e54480bA755061eF3207c3421150f0) |
| VibeRouter (drain-free, live on BNB) | `VibeSwapRouter.sol` | `0xa393E76bE079cF1ccf684D0f815795Dde248f157` | [BscScan](https://bscscan.com/address/0xa393E76bE079cF1ccf684D0f815795Dde248f157) · [Sourcify (Arb twin)](https://sourcify.dev/#/lookup/0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72) |

Note: `0xa393E76bE079cF1ccf684D0f815795Dde248f157` is the **live drain-free router only on BNB**. On Soneium that same address is the **legacy** router (not the live one).

## Arbitrum One (chainId 42161)

| Contract | File | Address | Verification |
| --- | --- | --- | --- |
| VibeFactory (drain-free) | `DrainFree_VibeSwapCore.sol` | `0xA95107ebE4e54480bA755061eF3207c3421150f0` | [Sourcify exact match](https://sourcify.dev/#/lookup/0xA95107ebE4e54480bA755061eF3207c3421150f0) · [ArbScan](https://arbiscan.io/address/0xA95107ebE4e54480bA755061eF3207c3421150f0) |
| VibeRouter (drain-free) | `VibeSwapRouter.sol` | `0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72` | [Sourcify exact match](https://sourcify.dev/#/lookup/0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72) · [ArbScan](https://arbiscan.io/address/0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72) |

## LEGACY (not in use)

| Contract | File | Address | Notes |
| --- | --- | --- | --- |
| Old Soneium factory | `VibeSwapCore.sol` | `0x06C0b58287794a0bdce20ce768b601CA974618DC` | Confirmed on-chain. Includes `rescueFundsFromPair`. **Legacy — not in use.** |
| Legacy Soneium router | — | `0xa393E76bE079cF1ccf684D0f815795Dde248f157` | Same address as the live BNB router; on Soneium it is legacy. Live Soneium router is `0x97C180C2e3097f28D8F14114AD1C0dEF81244344`. |

## Reference copies, not verified as deployed source

These renamed local copies are **not** the Sourcify-verified deployed source (or have no live mapping):

| File | Notes |
| --- | --- |
| [`sonevibeoracle.sol`](../archive/sonevibeoracle.sol) | reference copy, not deployed source. Differs from live `vibeoraclesoneium.sol` (trailing newline only, but not byte-identical). Live oracle → `vibeoraclesoneium.sol`. |
| [`JumpRateModel.sol`](../archive/JumpRateModel.sol) | reference copy, not deployed source. Different contract (`JumpRateModel`) from live `jump.sol` (`JumpRateModelSafe`). Live IRM → `jump.sol`. |
| [`VibeMasterChef.sol`](../archive/VibeMasterChef.sol) | reference copy, not deployed source. Not the live chef; live LightRewards → `LightRewards_VibeMasterChefV2.sol`. |

Not in this section (they **are** byte-identical to Sourcify exact_match deployed sources): `V_MasterEnhanced.sol`, `V_cERC20_ExtendedInterest.sol`, `SVUSD_StabilityModule.sol`, `FixedRateModel.sol`.
