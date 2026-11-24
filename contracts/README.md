# Live contract sources

Sources for deployed VIBE contracts. Explorer / Sourcify verification is against deployed bytecode, so moving or grouping these files does not affect on-chain verification.

Addresses below were confirmed to have contract code via `eth_getCode` on the listed RPCs (Soneium `https://rpc.soneium.org`, BNB `https://bsc-dataseed.bnbchain.org`, Arbitrum `https://arb1.arbitrum.io/rpc`).

## Soneium (chainId 1868)

| Contract | File | Address | Verification |
| --- | --- | --- | --- |
| VibeFactory (drain-free) | `DrainFree_VibeSwapCore.sol` | `0x77b141dCFDa726e239efF005E3DE7A47AeBFf948` | [Blockscout](https://soneium.blockscout.com/address/0x77b141dCFDa726e239efF005E3DE7A47AeBFf948) · [Sourcify (Arb twin)](https://sourcify.dev/#/lookup/0xA95107ebE4e54480bA755061eF3207c3421150f0) |
| VibeRouter (drain-free) | `VibeSwapRouter.sol` | `0x97C180C2e3097f28D8F14114AD1C0dEF81244344` | [Blockscout](https://soneium.blockscout.com/address/0x97C180C2e3097f28D8F14114AD1C0dEF81244344) · [Sourcify (Arb twin)](https://sourcify.dev/#/lookup/0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72) |
| LIGHT | — | `0x84998bf491C80a79B99540666569F360d5Acae6E` | [Blockscout](https://soneium.blockscout.com/address/0x84998bf491C80a79B99540666569F360d5Acae6E) |
| LightRewards (VibeMasterChefV2) | `LightRewards_VibeMasterChefV2.sol` | `0x8f2F9B17b173C91c7B9195096030a39227B94f62` | [Blockscout](https://soneium.blockscout.com/address/0x8f2F9B17b173C91c7B9195096030a39227B94f62) · [Sourcify](https://sourcify.dev/#/lookup/0x8f2F9B17b173C91c7B9195096030a39227B94f62) |
| Comptroller (V_MasterEnhanced) | `V_MasterEnhanced.sol` | `0x1126859aB6911Fc3b4f86f2F65E7B6F2eEDe5185` | [Blockscout](https://soneium.blockscout.com/address/0x1126859aB6911Fc3b4f86f2F65E7B6F2eEDe5185) |
| Oracle | `sonevibeoracle.sol` | `0x6ec1403e2962332205817523f241e34fd41c81cb` | [Blockscout](https://soneium.blockscout.com/address/0x6ec1403e2962332205817523f241e34fd41c81cb) |
| cASTR | `V_cERC20_ExtendedInterest.sol` | `0x7CA06966B0c07C5e35aA180643E98bB3057EBb27` | [Blockscout](https://soneium.blockscout.com/address/0x7CA06966B0c07C5e35aA180643E98bB3057EBb27) |
| cUSDSC | `V_cERC20_ExtendedInterest.sol` | `0xDB3e66b87c42C7F3599fbdcBFe08DfF0689A6D77` | [Blockscout](https://soneium.blockscout.com/address/0xDB3e66b87c42C7F3599fbdcBFe08DfF0689A6D77) |
| cUSDC | `V_cERC20_ExtendedInterest.sol` | `0x96ae93Df119c131469b38e3d558899F23678dCFb` | [Blockscout](https://soneium.blockscout.com/address/0x96ae93Df119c131469b38e3d558899F23678dCFb) |
| JumpRateModel (cASTR/cUSDSC/cUSDC) | `JumpRateModel.sol` | `0x91414ed684f78b7401c438400e755069dc007cff` | [Blockscout](https://soneium.blockscout.com/address/0x91414ed684f78b7401c438400e755069dc007cff) |
| cSVUSD IRM (FixedRateModel) | `FixedRateModel.sol` | `0x31526a94797ff50af30a7ecda16c459e4a8fc561` | [Blockscout](https://soneium.blockscout.com/address/0x31526a94797ff50af30a7ecda16c459e4a8fc561) |
| SVUSD Stability Module | `SVUSD_StabilityModule.sol` | `0x7F1aF1382899263aF50Bc6d3601bdaB1E17Ba20D` | [Blockscout](https://soneium.blockscout.com/address/0x7F1aF1382899263aF50Bc6d3601bdaB1E17Ba20D) |
| SVUSD | — | `0xcEca29F5f722a2922237c4D2b6Fe46Fa274B190B` | [Blockscout](https://soneium.blockscout.com/address/0xcEca29F5f722a2922237c4D2b6Fe46Fa274B190B) |
| cSVUSD | — | `0x65f059eA5C90daE2BbF37a1A8c93A6C843255452` | [Blockscout](https://soneium.blockscout.com/address/0x65f059eA5C90daE2BbF37a1A8c93A6C843255452) |

Drain-free Factory/Router bytecode matches the Arbitrum verified sources (Sourcify exact/full match). LightRewards verified source is **not** byte-identical to `VibeMasterChef.sol`, so it is kept as a separate file. `VibeMasterChef.sol` is retained as historical source without a confirmed live address in this README.

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
