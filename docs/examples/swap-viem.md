# Swap quote and transaction (viem)

Read-only quote, then a swap transaction that sets `amountOutMin` and a deadline. The connected wallet signs. Do not put a private key, seed phrase, or keystore in this file or in any script that copies it.

Addresses are the Soneium mainnet values from `docs/networks.json`. ABIs are the fragments in `docs/abi/`.

Pools are thin, so integrators should check price impact before swapping and keep amounts small.

```js
import { createPublicClient, http, parseUnits } from "viem";
import routerAbi from "../abi/router.json" with { type: "json" };
import erc20Abi from "../abi/erc20.json" with { type: "json" };

const soneium = {
  id: 1868,
  name: "Soneium",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.soneium.org"] } }
};

const ROUTER = "0x97C180C2e3097f28D8F14114AD1C0dEF81244344";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC_E = "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369";

const publicClient = createPublicClient({ chain: soneium, transport: http() });

// Read-only. getAmountsOut already applies the pool fee. No account and no key.
const amountIn = parseUnits("0.01", 18);
const path = [WETH, USDC_E];
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

// WETH is an ERC20 here, so the wallet must approve the router for amountIn first.
const hash = await walletClient.writeContract({
  account,
  address: WETH,
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

// Native ETH uses swapExactETHForTokens instead, with value: amountIn.
// The path still starts at WETH. amountOutMin and deadline stay mandatory.
// await walletClient.writeContract({
//   account,
//   address: ROUTER,
//   abi: routerAbi,
//   functionName: "swapExactETHForTokens",
//   args: [amountOutMin, path, account, deadline],
//   value: amountIn
// });
```

## Arbitrum One (chain ID 42161)

Use the same quote and swap calls as the Soneium example. Only the chain and addresses change. The connected wallet still signs. Do not put a private key in this file.

Checked on `https://arb1.arbitrum.io/rpc`:

- Router: `0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72`
- Factory: `0xA95107ebE4e54480bA755061eF3207c3421150f0`
- WETH: `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`
- USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- WETH/USDC pair: `0x4DF5bcAC28b8898988Ba576B8463664b53ddb9F7` (`factory.getPair` returns this pair; token0 is WETH and token1 is USDC)
- Swap fee: 0.25% (`amountIn * 9975 / 10000`)
- Factory init code hash: `0x87b780b5d19df9ad0d4c866dcd6b169f14846fb24232a128b678c5bdb395b012` (`factory.getInitCodeHash()`)
- Sourcify exact match. The factory fund-rescue function is removed (`rescueFundsFromPair` exists on the Soneium factory and not on this one). Router `rescueFunds(address)` remains owner-only and moves only ETH or ERC-20 already held by the router.
- Pair creation is closed (`factory.isPairCreationOpen()` returns false). A flash swap calls `vibeCall`, not `uniswapV2Call`.

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
// with the same amountOutMin and deadline rules as the Soneium example.
```
