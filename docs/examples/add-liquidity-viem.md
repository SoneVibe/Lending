# Add and remove liquidity (viem)

Read reserves first, abort if either is zero, then approve and call
`addLiquidity` with `amountAMin`, `amountBMin`, and a deadline. The same
pattern, with an approval of the LP token, is used for `removeLiquidity`.
The connected wallet signs. Do not put a private key, seed phrase, or
keystore in this file or in any script that copies it.

Addresses are copied from `docs/networks.json` and `docs/pools.json`.
ABIs are the fragments in `docs/abi/`.

Pools can be thin, so integrators should keep amounts small and should add
liquidity at the current reserve ratio. Yield is variable, not guaranteed.
Do not quote APR or APY. The swap fee is 0.25% (`9975/10000`).

The published router ABI has `addLiquidity` and `removeLiquidity` for
ERC-20 pairs. It does not have `addLiquidityETH` or `removeLiquidityETH`.
Use WBNB as an ERC-20.

```js
import { createPublicClient, http, parseUnits } from "viem";
import routerAbi from "../abi/router.json" with { type: "json" };
import factoryAbi from "../abi/factory.json" with { type: "json" };
import pairAbi from "../abi/pair.json" with { type: "json" };
import erc20Abi from "../abi/erc20.json" with { type: "json" };

const bsc = {
  id: 56,
  name: "BNB Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-dataseed.binance.org"] } }
};

const ROUTER = "0xa393E76bE079cF1ccf684D0f815795Dde248f157";
const FACTORY = "0x26b13e7e923e964b0514B3167A90901B49DAe205";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const PAIR = "0x6dABcbFdFE097e421269a444eBF22999B1EAE279";

const publicClient = createPublicClient({ chain: bsc, transport: http() });

// Read-only checks. No account and no key.
const onChainFactory = await publicClient.readContract({
  address: ROUTER,
  abi: [{ name: "factory", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }],
  functionName: "factory"
});
if (onChainFactory.toLowerCase() !== FACTORY.toLowerCase()) {
  throw new Error("Router factory() does not match the live BNB Chain factory");
}

const pairFromFactory = await publicClient.readContract({
  address: FACTORY,
  abi: factoryAbi,
  functionName: "getPair",
  args: [USDT, WBNB]
});
if (pairFromFactory.toLowerCase() !== PAIR.toLowerCase()) {
  throw new Error("factory.getPair does not match the live USDT/WBNB pair");
}

const [token0, token1, reserves] = await Promise.all([
  publicClient.readContract({ address: PAIR, abi: pairAbi, functionName: "token0" }),
  publicClient.readContract({ address: PAIR, abi: pairAbi, functionName: "token1" }),
  publicClient.readContract({ address: PAIR, abi: pairAbi, functionName: "getReserves" })
]);
const [reserve0, reserve1] = reserves;
if (reserve0 === 0n || reserve1 === 0n) {
  throw new Error("Reserves are zero; do not deposit into this pair");
}

// token0 is USDT, token1 is WBNB on this pair. USDT on BNB Chain has 18 decimals.
const reserveA = token0.toLowerCase() === USDT.toLowerCase() ? reserve0 : reserve1;
const reserveB = token1.toLowerCase() === WBNB.toLowerCase() ? reserve1 : reserve0;

// Example size only. Keep this small relative to reserves.
const amountADesired = parseUnits("1", 18);
const amountBDesired = (amountADesired * reserveB) / reserveA;

// 50 bps is the 0.5% default shown on the swap page. The user chooses the real limit.
const slippageBps = 50n;
const amountAMin = (amountADesired * (10000n - slippageBps)) / 10000n;
const amountBMin = (amountBDesired * (10000n - slippageBps)) / 10000n;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

// walletClient and account come from the user's wallet (for example window.ethereum).
// This process never sees a private key. The wallet shows each transaction and the user signs it.

let hash = await walletClient.writeContract({
  account,
  address: USDT,
  abi: erc20Abi,
  functionName: "approve",
  args: [ROUTER, amountADesired]
});
await publicClient.waitForTransactionReceipt({ hash });

hash = await walletClient.writeContract({
  account,
  address: WBNB,
  abi: erc20Abi,
  functionName: "approve",
  args: [ROUTER, amountBDesired]
});
await publicClient.waitForTransactionReceipt({ hash });

await walletClient.writeContract({
  account,
  address: ROUTER,
  abi: routerAbi,
  functionName: "addLiquidity",
  args: [USDT, WBNB, amountADesired, amountBDesired, amountAMin, amountBMin, account, deadline]
});
```

This router address is the live router on BNB Chain. Always match address and chain ID.

The featured pair is ETH/USDT `0x93016Fa6e3c184c96Df7466579DfaA970C7cb6A5`
(token0 is ETH `0x2170Ed0880ac9A755fd29B2688956BD959F933F8`, token1 is USDT).
Repeat the same reads and calls with those addresses. Confirm
`factory.getPair(ETH, USDT)` and that both reserves are nonzero first.

Do not use the deprecated BNB factory
`0xaf905e66038EcE89e03D843B35a11D262053B630` or the deprecated router
`0x7532b23DFB30ac22b2a74E3B81cC288de19379BA`.

## Remove liquidity

Approve the pair (the LP token) for the router, then call
`removeLiquidity`. Read `balanceOf`, `totalSupply`, and `getReserves`
first. Both reserves must still be nonzero.

```js
const liquidity = await publicClient.readContract({
  address: PAIR,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account]
});
const totalSupply = await publicClient.readContract({
  address: PAIR,
  abi: [...erc20Abi, { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }],
  functionName: "totalSupply"
});
if (liquidity === 0n || totalSupply === 0n) {
  throw new Error("No LP balance to remove");
}

const amountAExpected = (liquidity * reserveA) / totalSupply;
const amountBExpected = (liquidity * reserveB) / totalSupply;
const amountAMinOut = (amountAExpected * (10000n - slippageBps)) / 10000n;
const amountBMinOut = (amountBExpected * (10000n - slippageBps)) / 10000n;

hash = await walletClient.writeContract({
  account,
  address: PAIR,
  abi: erc20Abi,
  functionName: "approve",
  args: [ROUTER, liquidity]
});
await publicClient.waitForTransactionReceipt({ hash });

await walletClient.writeContract({
  account,
  address: ROUTER,
  abi: routerAbi,
  functionName: "removeLiquidity",
  args: [USDT, WBNB, liquidity, amountAMinOut, amountBMinOut, account, deadline]
});
```

## Arbitrum One (chain ID 42161)

Use the same quote, approve, and `addLiquidity` / `removeLiquidity` calls.
Only the chain and addresses change. The connected wallet still signs.
Do not put a private key in this file.

Addresses copied from `docs/networks.json` and `docs/pools.json`:

- Router: `0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72` (`factory()` returns the factory below)
- Factory: `0xA95107ebE4e54480bA755061eF3207c3421150f0`
- WETH: `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` (18 decimals)
- USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (6 decimals)
- WETH/USDC pair: `0x4DF5bcAC28b8898988Ba576B8463664b53ddb9F7`
  (`factory.getPair` returns this pair; `token0` is WETH and `token1` is USDC)

```js
const arbitrum = {
  id: 42161,
  name: "Arbitrum One",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://arb1.arbitrum.io/rpc"] } }
};

const ARB_ROUTER = "0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72";
const ARB_FACTORY = "0xA95107ebE4e54480bA755061eF3207c3421150f0";
const ARB_WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const ARB_PAIR = "0x4DF5bcAC28b8898988Ba576B8463664b53ddb9F7";

// path / tokens = [ARB_WETH, ARB_USDC]
// read router.factory, factory.getPair, getReserves (abort if either is 0),
// set amountBDesired from the reserve ratio, then approve both ERC-20s and
// write addLiquidity on ARB_ROUTER, with the same amount*Min and deadline
// rules as the BNB Chain example. USDC on this chain has 6 decimals.
```
