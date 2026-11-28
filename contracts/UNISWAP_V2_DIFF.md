# SoneVibe DEX vs canonical Uniswap V2

Line-by-line differences between SoneVibe’s factory, pair, router, and library and canonical Uniswap V2 (`Uniswap/v2-core` and `Uniswap/v2-periphery`, `master`). Canonical line numbers refer to `UniswapV2Factory.sol`, `UniswapV2Pair.sol`, `UniswapV2ERC20.sol`, `UniswapV2Library.sol`, and `UniswapV2Router02.sol`.

BNB Chain (chainId 56) runs the drain-free core and the router:

| Role | Source in this repo | Address |
| --- | --- | --- |
| Factory + pair | `contracts/DrainFree_VibeSwapCore.sol` | Factory `0x26b13e7e923e964b0514B3167A90901B49DAe205` |
| Router + `VibeLibrary` | `contracts/VibeSwapRouter.sol` | Router `0xa393E76bE079cF1ccf684D0f815795Dde248f157` |
| Legacy factory + pair (not the BNB deployment) | `contracts/VibeSwapCore.sol` | Soneium legacy factory only |

`getInitCodeHash()` on the BNB factory is `0x87b780b5d19df9ad0d4c866dcd6b169f14846fb24232a128b678c5bdb395b012`, the same constant the router stores as `PAIR_INIT_CODE_HASH`.

What did **not** change, so it is not repeated below: constant-product reserves, CREATE2 salt `keccak256(abi.encodePacked(token0, token1))`, reserve packing (`uint112` / `uint32`), TWAP accumulators (`UQ112x112`, overflow desired), `skim` / `sync`, permit typehash `0x6e71edae…`, the Mint/Burn/Swap/Sync event shapes, and `quote` (no fee). `swap` still reverts when `to` is `token0` or `token1`. The file header lists that check as a difference; canonical `UniswapV2Pair.sol:169` has the same `INVALID_TO` require. It is not a behavioral change.

## Fee: 0.30% to 0.25%, and the 1/6 protocol cut

Swap fee is 0.25% (25 / 10_000) instead of 0.30% (3 / 1_000). The protocol-fee formula is unchanged: when `feeTo != address(0)`, `mint` and `burn` mint LP for 1/6 of sqrt(k) growth.

Canonical `UniswapV2Library.sol:46-48`:

```solidity
uint amountInWithFee = amountIn.mul(997);
uint denominator = reserveIn.mul(1000).add(amountInWithFee);
```

SoneVibe `VibeSwapRouter.sol:106-108` (`VibeLibrary.getAmountOut`):

```solidity
uint amountInWithFee = amountIn * 9975;
uint denominator = reserveIn * 10000 + amountInWithFee;
```

Canonical `UniswapV2Library.sol:56-57` (`getAmountIn`):

```solidity
uint numerator = reserveIn.mul(amountOut).mul(1000);
uint denominator = reserveOut.sub(amountOut).mul(997);
```

SoneVibe `VibeSwapRouter.sol:115-116`:

```solidity
uint numerator = reserveIn * amountOut * 10000;
uint denominator = (reserveOut - amountOut) * 9975;
```

Canonical `UniswapV2Pair.sol:180-182`:

```solidity
uint balance0Adjusted = balance0.mul(1000).sub(amount0In.mul(3));
uint balance1Adjusted = balance1.mul(1000).sub(amount1In.mul(3));
require(balance0Adjusted.mul(balance1Adjusted) >= uint(_reserve0).mul(_reserve1).mul(1000**2), 'UniswapV2: K');
```

SoneVibe `DrainFree_VibeSwapCore.sol:381-383`:

```solidity
uint balance0Adjusted = balance0 * 10000 - amount0In * 25;
uint balance1Adjusted = balance1 * 10000 - amount1In * 25;
if (balance0Adjusted * balance1Adjusted < uint(_reserve0) * _reserve1 * 10000**2) revert VibeInvalidK();
```

Canonical and SoneVibe protocol fee (`UniswapV2Pair.sol:99`, `DrainFree_VibeSwapCore.sol:296`):

```solidity
uint denominator = rootK.mul(5).add(rootKLast); // canonical
uint denominator = (rootK * 5) + rootKLast;     // SoneVibe
```

`getAmountOut` always prices the full 0.25%. It does not change when `feeTo` is set. The 1/6 cut is taken later, as new LP, inside `_mintFee` on `mint` / `burn`.

| | Swap fee | LP share of that fee | `feeTo` share |
| --- | --- | --- | --- |
| Uniswap V2, `feeTo == 0` | 0.30% | 0.30% | 0 |
| Uniswap V2, `feeTo` set | 0.30% | 0.25% (5/6) | 0.05% (1/6) |
| SoneVibe, `feeTo == 0` | 0.25% | 0.25% | 0 |
| SoneVibe, `feeTo` set | 0.25% | 0.2083% (5/6 of 0.25%) | 0.0417% (1/6 of 0.25%) |

0.2083% and 0.0417% are the 4-decimal forms of `0.25% * 5/6` and `0.25% * 1/6`. The code uses the integer `* 5` denominator, not those rounded percents.

**Risk.** LPs earn less per swap than on Uniswap V2 (0.25% vs 0.30% with `feeTo` unset; about 0.2083% vs 0.25% with `feeTo` set). A quoter that still uses 997/1000 mis-prices every hop: exact-output users can overpay, exact-input transactions can revert on slippage or leave surplus. `feeToSetter` can point `feeTo` at any address and thereby take the 1/6 LP mint. That is the same power Uniswap’s `feeToSetter` has (`UniswapV2Factory.sol:40-47`, `DrainFree_VibeSwapCore.sol:464-471`). It dilutes LPs. It does not transfer reserve tokens out of the pair.

## Factory

Canonical factory (`UniswapV2Factory.sol`) has `feeTo`, `feeToSetter`, permissionless `createPair` (`:23`), `setFeeTo`, and `setFeeToSetter`. No owner, no pause, no creation switch, no `getInitCodeHash`.

SoneVibe `VibeFactory` in `DrainFree_VibeSwapCore.sol` adds:

1. **Pair-creation gate** (`:420`, `:435-443`). `isPairCreationOpen` defaults to `false`. `createPair` reverts `VibeForbidden` unless the caller is `feeToSetter` or the flag is true. `setPairCreationStatus(bool)` is `feeToSetter`-only.
   **Risk.** New markets are admin-gated. The router’s `_addLiquidity` (`VibeSwapRouter.sol:185-187`) calls `factory.createPair` when `getPair` is zero. That call comes from the router, not from `feeToSetter`, so a user cannot create a pair through the router while the flag is closed. Existing pairs are not affected. This is censorship of new listings, not a withdrawal of reserves.

2. **`whenNotPaused` on `createPair` only** (`:441`, pause/unpause `:474-479`). `owner` (OpenZeppelin `Ownable`, set to the deployer in the constructor at `:426`) can pause and unpause the factory. The pair contract is not `Pausable`.
   **Risk.** `owner` can block new pair creation, including creation by `feeToSetter`, until `unpause`. Pairs keep swapping, minting, and burning. Availability of new markets only.

3. **Two admin roles.** Uniswap has only `feeToSetter`. SoneVibe also has `owner` (pause, `transferOwnership`, `renounceOwnership`). On the BNB deployment those two addresses happen to match; the constructor does not force them to stay the same. Transferring `feeToSetter` (`:469-471`) does not transfer `owner`, and the reverse is also true.
   **Risk.** A key that has given up one role may still hold the other. Compromised `owner` can pause creation. Compromised `feeToSetter` can redirect the protocol fee and open or close permissionless creation. Neither role has a function on this factory that transfers tokens out of a pair.

4. **`getInitCodeHash()`** (`:482-484`) returns `keccak256(type(VibePair).creationCode)`. Uniswap has no on-chain helper; integrators paste the hash. The router hardcodes the same hash (`VibeSwapRouter.sol:73`).
   **Risk.** If the pair bytecode, compiler, optimizer, or OpenZeppelin version changes, this hash changes and every CREATE2 address changes. The router’s constant is fixed at deploy time. A mismatch sends `transfer`s and quotes to an address that is not the real pair (lost tokens, or a revert). The live factory hash and the router constant are the value in the table above. Canonical Uniswap’s hash is `0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f` (`UniswapV2Library.sol:24`) and must not be reused.

`setFeeTo` / `setFeeToSetter` match Uniswap’s access check, with `VibeForbidden()` instead of `'UniswapV2: FORBIDDEN'`.

## Pair and LP token

1. **`MINIMUM_LIQUIDITY`** is `10**5` (`DrainFree_VibeSwapCore.sol:206`) instead of `10**3` (`UniswapV2Pair.sol:15`). The first mint still burns that amount to `address(0)`.
   **Risk.** The first LP must supply `sqrt(amount0 * amount1) > 1e5`. More dust is locked forever. The larger burn makes the well-known first-depositor inflation attack harder. It does not give an admin a claim on reserves.

2. **Flash-swap callback** is `IVibeCallee.vibeCall` (`DrainFree_VibeSwapCore.sol:72`, called at `:372`) instead of `uniswapV2Call` (`UniswapV2Pair.sol:172`).
   **Risk.** A callee written for Uniswap is not called, does not repay, and the swap reverts. Failure is closed. Existing V2 flash-swap bots do not work until they implement `vibeCall`.

3. **Custom errors** (`DrainFree_VibeSwapCore.sol:49-62`) replace Uniswap’s revert strings (`'UniswapV2: K'`, `'UniswapV2: LOCKED'`, and the rest).
   **Risk.** Tools that match those strings do not see SoneVibe reverts. No change to who can move funds.

4. **`ReentrancyGuard` plus the `lock` mutex** (`:203`, `mint`/`burn`/`swap` at `:308`, `:333`, `:359`). Uniswap uses only `lock`.
   **Risk.** `vibeCall` cannot reenter `mint`, `burn`, or `swap`. Extra gas. A callback that expected to reenter those functions reverts.

5. **LP token metadata** (`:112-114`) is name `"Vibe LPs"`, symbol `"VIBE-LP"`, decimals 18. Uniswap is `"Uniswap V2"` / `"UNI-V2"` / 18 (`UniswapV2ERC20.sol:9-11`).
   **Risk.** Integrators who key off the symbol need the new one. The permit typehash and domain layout match, so permit still binds the pair’s own address and the chain id captured in the constructor.

6. **Solidity 0.8 checked math** replaces SafeMath, except the oracle accumulators, which stay `unchecked` (`:274-278`) so the TWAP can wrap the same way as Uniswap.
   **Risk.** Paths that would have wrapped now revert. That blocks a wrapped `K` check from succeeding. It does not add an admin withdrawal.

The pair has no `owner`, no `pause`, and no upgrade hook. Tokens leave through `burn` (LP holders), `swap` (the fee-adjusted `K` check), and `skim` (balance above reserves only). Those three are permissionless, as on Uniswap. They are not admin functions.

## Library and router

`VibeLibrary` (`VibeSwapRouter.sol:65-138`) follows `UniswapV2Library`: `sortTokens`, `pairFor`, `getReserves`, `quote`, `getAmountOut`, `getAmountIn`, `getAmountsOut`, `getAmountsIn`. The two numeric differences are the init-code hash and the 9975/10000 fee, both covered above. `getReserves` reads the CREATE2 address, not `factory.getPair`. A wrong hash quotes a contract that is not the pool.

`VibeRouter` keeps the Uniswap V2 router entrypoints for add/remove liquidity, exact-in and exact-out swaps, native wrap/unwrap, and fee-on-transfer swaps. Differences:

1. **`Ownable`, `Pausable`, `ReentrancyGuard`, `Multicall`** (`:147`). The canonical router has none of these. Every state-changing user function is `nonReentrant` and `whenNotPaused`. `owner` can `pause` / `unpause` (`:168-173`).
   **Risk.** `owner` can stop swaps and liquidity changes that go through the router. The pair is not paused: `mint`, `burn`, and `swap` on the pair still work, so LP tokens can still be redeemed by calling the pair. Users who only have the router UI can be stuck until they do that, or until `unpause`. This is an availability control, not a reserve withdrawal.
   `nonReentrant` blocks reentering the router from a token callback. Callers that depended on reentrancy revert.
   `multicall` delegatecalls back into the router, so every subcall sees the same `msg.value`. Payable routes forward BNB with `{value: …}` (`deposit` at `:248`, `:360`, `:411`, `:442`). A second wrap in the same multicall reverts once that BNB is already deposited. Do not treat each subcall as if it received a fresh `msg.value`.

2. **`rescueFunds(address)`** (`:523-535`), `onlyOwner`. `address(0)` sends the router’s BNB balance to `owner`. Any other address sends `IERC20(token).balanceOf(address(this))` — the router’s own balance — to `owner`.
   **Risk.** Tokens or BNB sent to the router by mistake can be taken by `owner`. The router is not supposed to custody funds across transactions. The function does not call the pair and cannot move the pair’s balances. It can take LP tokens that were transferred to the router and not yet burned; burning them still requires someone to call `burn` on the pair.

3. **Removed router functions** that `UniswapV2Router02` has at `:141-210`:
   - `removeLiquidityWithPermit`
   - `removeLiquidityETHWithPermit`
   - `removeLiquidityETHSupportingFeeOnTransferTokens`
   - `removeLiquidityETHWithPermitSupportingFeeOnTransferTokens`
   **Risk.** Permit-based liquidity removal does not exist; the LP token must be `approve`d to the router. Removing native-side liquidity of a fee-on-transfer token has no supporting helper, so that path can revert or mis-count. The pair’s own `burn` is unchanged. Fee-on-transfer **swaps** still have the three `swapExact*SupportingFeeOnTransferTokens` functions (`:418-466`), using the 0.25% `getAmountOut`.

4. **`addLiquidity` inlines the deadline check** (`:216`) instead of the `ensure` modifier, with the same `deadline >= block.timestamp` test. No behavior change. The comment in source is a stack-too-deep workaround.

`receive()` still accepts BNB only from `WETH` (`:163-165`), same idea as Uniswap’s WETH-only receive.

## Legacy core: admin drain (not deployed on BNB)

`contracts/VibeSwapCore.sol` is the older factory/pair. It has the same 0.25% fee, the same creation gate, and the same owner pause. It adds a withdrawal the drain-free core does not have:

`VibePair.emergencyDrain(address token, address to)` (`VibeSwapCore.sol:358-372`) transfers the pair’s full balance of `token` to `to` when `msg.sender == factory`, then `sync`s reserves if `token` is `token0` or `token1`. There is no `K` check.

`VibeFactory.rescueFundsFromPair(address pair, address token, address to)` (`:464-468`) lets `feeToSetter` call that drain.

**Risk.** On any pair deployed by that legacy factory, `feeToSetter` can empty the reserves. That is a full loss of LP funds, and it does not exist in Uniswap V2 or in `DrainFree_VibeSwapCore.sol`. The legacy pair also imports OpenZeppelin `security/ReentrancyGuard.sol` and `security/Pausable.sol` (`VibeSwapCore.sol:5-6`) rather than the drain-free `utils/` paths (`DrainFree_VibeSwapCore.sol:5-6`), so its creation code — and therefore its init-code hash — is not `0x87b780b5…`. The BNB router’s hash is the drain-free pair.

The BNB factory and the BNB pairs do not implement `rescueFundsFromPair` or `emergencyDrain`. Fork tests call both selectors and require the calls to revert without moving pair balances, and they fuzz the admin surface (`owner` / `feeToSetter` pause, role transfer, `setFeeTo`, creation gate, `createPair`, router `rescueFunds`) against the live ETH/USDT and USDT/WBNB pairs.
