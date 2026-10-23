# Swap quote and transaction (viem)

Read-only quote, then a swap transaction that sets `amountOutMin` and a deadline. The connected wallet signs. Do not put a private key, seed phrase, or keystore in this file or in any script that copies it.

Addresses are the Soneium mainnet values from `docs/networks.json`. ABIs are the fragments in `docs/abi/`.

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

const ROUTER = "0xa393E76bE079cF1ccf684D0f815795Dde248f157";
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
await walletClient.writeContract({
  account,
  address: WETH,
  abi: erc20Abi,
  functionName: "approve",
  args: [ROUTER, amountIn]
});

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
