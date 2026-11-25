# Swap quote and transaction (viem)

Read-only quote, then a swap transaction that sets `amountOutMin` and a deadline. The connected wallet signs. Do not put a private key, seed phrase, or keystore in this file or in any script that copies it.

Addresses are copied from `docs/networks.json` and `docs/pools.json`. ABIs are the fragments in `docs/abi/`.

Pools can be thin, so integrators should check price impact before swapping and keep amounts small.

```js
import { createPublicClient, http, parseUnits } from "viem";
import routerAbi from "../abi/router.json" with { type: "json" };
import erc20Abi from "../abi/erc20.json" with { type: "json" };

const bsc = {
  id: 56,
  name: "BNB Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-dataseed.binance.org"] } }
};

const ROUTER = "0xa393E76bE079cF1ccf684D0f815795Dde248f157";
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const USDT = "0x55d398326f99059fF775485246999027B3197955";

const publicClient = createPublicClient({ chain: bsc, transport: http() });

// Read-only. getAmountsOut already applies the pool fee. No account and no key.
// Example size only. USDT on BNB Chain has 18 decimals.
const amountIn = parseUnits("0.01", 18);
const path = [WBNB, USDT];
const amounts = await publicClient.readContract({
  address: ROUTER,
  abi: routerAbi,
  functionName: "getAmountsOut",
  args: [amountIn, path]
});
const quotedOut = amounts[amounts.length - 1];

// 50 bps is the 0.5% default shown on the swap page. The user chooses the real limit.
const slippageBps = 50n;
const amountOutMin = (quotedOut * (10000n - slippageBps)) / 10000n;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

// walletClient and account come from the user's wallet (for example window.ethereum).
// This process never sees a private key. The wallet shows the transaction and the user signs it.

// WBNB is an ERC20 here, so the wallet must approve the router for amountIn first.
const hash = await walletClient.writeContract({
  account,
  address: WBNB,
  abi: erc20Abi,
  functionName: "approve",
  args: [ROUTER, amountIn]
});
await publicClient.waitForTransactionReceipt({ hash });

await walletClient.writeContract({
  account,
  address: ROUTER,
  abi: routerAbi,
  functionName: "swapExactTokensForTokens",
  args: [amountIn, amountOutMin, path, account, deadline]
});

// Native BNB uses swapExactETHForTokens instead, with value: amountIn.
// The path still starts at WBNB. amountOutMin and deadline stay mandatory.
// await walletClient.writeContract({
//   account,
//   address: ROUTER,
//   abi: routerAbi,
//   functionName: "swapExactETHForTokens",
//   args: [amountOutMin, path, account, deadline],
//   value: amountIn
// });
```

This router address is the live router on BNB Chain. Always match address and chain ID.

The featured pair is ETH/USDT `0x93016Fa6e3c184c96Df7466579DfaA970C7cb6A5` (token0 ETH `0x2170Ed0880ac9A755fd29B2688956BD959F933F8`, token1 USDT). The listed USDT/WBNB pair is `0x6dABcbFdFE097e421269a444eBF22999B1EAE279`.

Do not use the deprecated BNB factory `0xaf905e66038EcE89e03D843B35a11D262053B630` or the deprecated router `0x7532b23DFB30ac22b2a74E3B81cC288de19379BA`.

## Arbitrum One (chain ID 42161)

Use the same quote and swap calls as the BNB Chain example. Only the chain and addresses change. The connected wallet still signs. Do not put a private key in this file.

Addresses copied from `docs/networks.json` and `docs/pools.json`:

- Router: `0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72`
- Factory: `0xA95107ebE4e54480bA755061eF3207c3421150f0`
- WETH: `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`
- USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- WETH/USDC pair: `0x4DF5bcAC28b8898988Ba576B8463664b53ddb9F7` (`factory.getPair` returns this pair; token0 is WETH and token1 is USDC)
- Swap fee: 0.25% (`amountIn * 9975 / 10000`)
- Factory init code hash: `0x87b780b5d19df9ad0d4c866dcd6b169f14846fb24232a128b678c5bdb395b012`
- Sourcify exact match. The factory fund-rescue function is removed. Router `rescueFunds(address)` remains owner-only and moves only ETH or ERC-20 already held by the router.
- A flash swap calls `vibeCall`, not `uniswapV2Call`.

```js
const arbitrum = {
  id: 42161,
  name: "Arbitrum One",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://arb1.arbitrum.io/rpc"] } }
};

const ARB_ROUTER = "0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72";
const ARB_WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const ARB_PAIR = "0x4DF5bcAC28b8898988Ba576B8463664b53ddb9F7";

// path = [ARB_WETH, ARB_USDC]
// read getAmountsOut and write swapExactTokensForTokens on ARB_ROUTER,
// with the same amountOutMin and deadline rules as the BNB Chain example.
```
