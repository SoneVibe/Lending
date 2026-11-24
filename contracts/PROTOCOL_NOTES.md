# SoneVibe protocol notes

Read from the verified sources in this folder and from a local fork of Soneium mainnet (chain id 1868, RPC `https://rpc.soneium.org`) at block **31,211,000** (timestamp 1,795,556,751). Nothing here was broadcast. Interest and reward speeds move with utilization and governance parameters. They are variable, not guaranteed.

## DEX

Live Soneium contracts, from `contracts/README.md`:

| Role | Address |
| --- | --- |
| VibeFactory (drain-free) | `0x77b141dCFDa726e239efF005E3DE7A47AeBFf948` |
| VibeRouter | `0x97C180C2e3097f28D8F14114AD1C0dEF81244344` |
| Legacy factory (not in use) | `0x06C0b58287794a0bdce20ce768b601CA974618DC` |

The router’s `factory()` is the drain-free factory. Its `WETH()` is the OP-stack wrapped native token `0x4200000000000000000000000000000000000006`. The router was not paused at the pinned block. New pair creation is closed (`isPairCreationOpen == false`); only the factory admin can create pairs. `getInitCodeHash()` matches the router’s `PAIR_INIT_CODE_HASH`, so `getAmountsOut` quotes the CREATE2 pair.

The pool is a constant-product pair. The swap fee is **0.25%** per hop: `amountIn * 9975 / 10000`, checked in the pair as a 25 / 10,000 deduction from the input side. `feeTo` is set (`0x7500773881f3E5058F7A93Ca956116A352897eF6`), so 1/6 of sqrt(k) growth can be minted as LP to `feeTo` on the next `mint` or `burn` (the Uniswap V2 protocol-fee mechanism). That does not change the 0.25% quote. Pairs themselves are not pausable.

WETH/USDC.e (`USDC.e` is `0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369`, the cUSDC underlying):

- Legacy pair `0xc58ce2E71D0D64fC016DbB826714530B475adc0C`, `factory()` = legacy factory, reserves **0 / 0**. A swap reverts `VibeInsufficientLiquidity`.
- Live pair from `getPair`, `0x9726ecEB595376765f7391e16e438cfb7b8D71F2`. Reserves at the pin: about **0.1504 WETH** and **254.71 USDC.e**. LP total supply about `6.184e12`.

There is a second live pair, ASTR/USDC.e `0x18b2e9E07d191A110DAEA6Ad3468495caf4d1CB9`. Fork tests use the WETH/USDC.e pair.

## Lending

Compound-style markets behind a Unitroller-style proxy.

| Role | Address |
| --- | --- |
| Comptroller proxy (`V_Unit`) | `0x1126859aB6911Fc3b4f86f2F65E7B6F2eEDe5185` |
| Implementation (`V_MasterEnhanced`), `getImplementation()` | `0x95Fd3B75EF4BaFc6c621abc0B08F6b016F672401` |
| Oracle (`ViveOracleHybridV3`) | `0x6EC1403e2962332205817523f241E34fd41c81CB` |
| Jump rate model (cASTR, cUSDSC, cUSDC) | `0x91414eD684F78B7401C438400E755069DC007CFf` |
| Fixed rate model (cSVUSD) | `0x31526a94797fF50aF30A7ECDA16C459E4A8fc561` |

cTokens are not proxies: `getImplementation()` reverts and the account code is the market itself. `getAllMarkets()` reverts. Markets are `allMarkets(uint256)` (four entries) or `getAllMarketsData()`.

| Market | cToken | Underlying | Collateral factor | Liquidation threshold | Cash at pin |
| --- | --- | --- | --- | --- | --- |
| cASTR | `0x7CA06966B0c07C5e35aA180643E98bB3057EBb27` | ASTR, 18 decimals | 0.30 | 0.35 | 110 ASTR |
| cUSDSC | `0xDB3e66b87c42C7F3599fbdcBFe08DfF0689A6D77` | USDSC, 6 decimals | 0.80 | 0.85 | 1 USDSC |
| cUSDC | `0x96ae93Df119c131469b38e3d558899F23678dCFb` | USDC.e, 6 decimals | 0.80 | 0.85 | 1 USDC.e |
| cSVUSD | `0x65f059eA5C90daE2BbF37a1A8c93A6C843255452` | SVUSD, 18 decimals | 0 | 0 | none (mint/burn) |

Global pause flags (borrow, redeem, liquidate) were false, and no market was mint-paused, borrow-paused, or frozen. Supply caps are 0 (uncapped) except cSVUSD’s borrow cap of 10,000 SVUSD. Close factor is **0.50e18**. Liquidation incentive is **1.10e18** (10% bonus). User-level borrow cap in USD is 0 (unset). Reserve factor is 10% on the three jump markets and 100% on cSVUSD.

Collateral value counts only markets the account has entered. Borrowing also requires `enterMarkets` on the **borrowed** market. `canBorrow` checks collateral value after the collateral factor. Shortfall for liquidation is `borrowUSD > liquidationUSD` (the threshold, not the collateral factor). A healthy `liquidateBorrow` reverts `CollateralInsufficient` inside `seize`. The cToken caps a repayment at the close factor, rounding up by at most 1 wei: `(debt * closeFactor + 1e18 - 1) / 1e18`.

Exchange rate on a normal cToken is `(cash + borrows - reserves) / totalSupply` after normalizing underlying to 18 decimals. Cash used for that accounting is `internalCash`, not a raw `balanceOf`, so a direct token transfer does not inflate the rate. cSVUSD’s exchange rate is fixed at 1e18. It has no supplier `mint`; `borrow` mints SVUSD and `repay` burns it.

Interest accrues in `accrueInterest` from `block.number - accrualBlockNumber`, not from the timestamp. The jump model converts annual parameters with `blocksPerYear = 15,768,000` (2 second blocks, which matches the chain: 1,000 blocks took 2,000 seconds). At the pin the per-block parameters are base `1,268,391,679`, slope1 `2,536,783,358`, slope2 `50,735,667,174`, kink `0.9e18`. At zero utilization the borrow rate is the base (about 2% per year at that block count). At the kink it is about 5.6% per year, and at full utilization about 13.6% per year, before the model’s per-block safety cap. Realized supply and borrow rates depend on utilization and are variable, not guaranteed. The fixed model ignores cash and borrows and charges `3,107,559,614` per block (about 4.90% per year at the same block count). Its supply rate is 0.

Oracle prices are scaled to 1e18. At the pin: ASTR about `$0.00439369` (Chainlink), USDC.e about `$0.999863` (Chainlink), USDSC and SVUSD `$1` (manual; no Chainlink feed). Default staleness is 86,400 seconds and the default Chainlink-vs-manual deviation limit is 1,500 bps.

VIBE reward speeds on cASTR, cUSDSC, and cUSDC were `2e11` per block for supply and borrow. cSVUSD speeds were 0. Reward index updates run inside `accrueInterest`. Claimed token amounts are variable, not guaranteed.

## SVUSD and the Stability Module

SVUSD (`0xcEca29F5f722a2922237c4D2b6Fe46Fa274B190B`) is an 18-decimal token. `mint` and `burn` are `onlyFacilitator` and respect an emergency pause (the token was not paused). Each facilitator has a bucket capacity and a level. At the pin both facilitators had capacity `1e24` and level 0, and SVUSD `totalSupply` was 0.

Two facilitators:

1. **Stability module** `0x7F1aF1382899263aF50Bc6d3601bdaB1E17Ba20D`. `buySVUSD` pulls USDC.e (6 decimals), mints 18-decimal SVUSD 1:1 after a fee, and `sellSVUSD` burns SVUSD and pays USDC.e. Fees are `feeIn = 10` and `feeOut = 10` (0.10% each, max admin fee 5%). The reserve cap is `1e12` (1,000,000 USDC.e). The module was not paused. Its USDC.e balance was **0**, so a sell cannot pay until a buy (or some other deposit) has funded it. The fee on a buy is minted to `treasury` (`0x7500773881f3E5058F7A93Ca956116A352897eF6`); the fee on a sell is transferred in USDC.e.
2. **cSVUSD** (above). Borrowing mints SVUSD to the borrower against other collateral. Repaying burns that SVUSD. Collateral factor and liquidation threshold are 0, and `seize` on cSVUSD always reverts, so SVUSD debt is not itself posted as collateral. Interest accrued on this market is 100% reserves. Reserves are an accounting balance; `sweepReserves` is what mints them. At the pin `totalBorrows == totalReserves ≈ 0.0275 SVUSD`, which matches unpaid interest with no SVUSD left in circulation.

## Behaviors found on the fork

- The WETH/USDC.e address `0xc58c…adc0C` is the **legacy** pair and its reserves are zero. The live factory’s pair for the same tokens has the reserves above. Legacy `allPairs` (8) are all at zero reserves. Tests swap, add, and remove on the live pair only.
- Because `feeTo` is set, adding liquidity and removing it in the same transaction returns slightly less of each token than was deposited. LP minted to the caller still matches `addLiquidity`’s return value, and removing that LP burns it.
- `getAllMarkets()` reverts. Use `allMarkets(i)` or `getAllMarketsData()`.
- cUSDC’s underlying is USDC.e, the same token as the DEX pair, not a second USDC.
- cUSDC and cUSDSC each hold 1 unit of underlying, so those markets cannot fund a large borrow. cASTR holds 110 ASTR. Fork borrows use that cash.
- An account must `enterMarkets` on the market it borrows, as well as on collateral. Collateral that was supplied but not entered does not count.
- `vm.warp` does not accrue interest. `accrueInterest` after `vm.roll` does, because the index advances with `block.number`. Block time on this chain is 2 seconds, in line with `blocksPerYear`.
- Chainlink staleness defaults to 86,400 seconds. ASTR and USDC.e have no manual price, so once the feed is older than that, `getUnderlyingPrice` returns 0. `canRedeem` treats a zero price as not allowed, and redeem reverts `CollateralInsufficient`. USDSC and SVUSD keep the manual price of $1.
- A liquidation that asks to repay the whole debt still pulls only the close-factor amount (50%) and seizes the `previewSeizeTokens` amount of collateral cTokens. The rest of the debt stays.
- cSVUSD has no deposit `mint`. The open mint paths are `StabilityModule.buySVUSD` and `cSVUSD.borrow`. The burn paths are `sellSVUSD` and `cSVUSD.repay`.
- With the stability module’s reserve at 0, `sellSVUSD` cannot pay USDC.e until a buy has deposited some. After a 1,000 USDC.e buy the 0.10% fee is minted to the treasury and a full sell returns the deposit minus both fees.
