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
- `rescueFunds` sends tokens or BNB held by the router to `owner`
- `transferOwnership` and `renounceOwnership` transfer or clear router `owner`

`rescueFunds` uses the router’s own balance.

## Arbitrum One (chainId 42161)

Maintenance only. The factory and the router are exact-match verified on Sourcify.

| Contract | Address |
| --- | --- |
| Factory | [`0xA95107ebE4e54480bA755061eF3207c3421150f0`](https://arbiscan.io/address/0xA95107ebE4e54480bA755061eF3207c3421150f0) · [Sourcify exact match](https://sourcify.dev/#/lookup/0xA95107ebE4e54480bA755061eF3207c3421150f0) |
| Router | [`0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72`](https://arbiscan.io/address/0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72) · [Sourcify exact match](https://sourcify.dev/#/lookup/0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72) |

## Soneium (chainId 1868)

Legacy.

| Contract | Address |
| --- | --- |
| Factory | `0x77b141dCFDa726e239efF005E3DE7A47AeBFf948` |
| Router | `0x97C180C2e3097f28D8F14114AD1C0dEF81244344` |
| Older factory (`VibeSwapCore.sol`, includes `rescueFundsFromPair`) | `0x06C0b58287794a0bdce20ce768b601CA974618DC` |
| Older router | `0xa393E76bE079cF1ccf684D0f815795Dde248f157` |

`0xa393E76bE079cF1ccf684D0f815795Dde248f157` is the live router on BNB Chain. On Soneium that address is a legacy router.

## Astar

Astar is retired.
