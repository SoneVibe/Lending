# Add and remove liquidity (viem)

Read reserves first, abort if either is zero, then approve and call
`addLiquidity` with `amountAMin`, `amountBMin`, and a deadline. The same
pattern, with an approval of the LP token, is used for `removeLiquidity`.
The connected wallet signs. Do not put a private key, seed phrase, or
keystore in this file or in any script that copies it.

Addresses are the Soneium mainnet values verified against
`https://rpc.soneium.org` (`router.factory()` and `factory.getPair`).
ABIs are the fragments in `docs/abi/`.

Pools are thin, so integrators should keep amounts small and should add
liquidity at the current reserve ratio. Yield is variable, not guaranteed.
Do not quote APR or APY. The swap fee is 0.25% (`9975/10000`).

The published router ABI has `addLiquidity` and `removeLiquidity` for
ERC-20 pairs. It does not have `addLiquidityETH` or `removeLiquidityETH`.
Use WETH as an ERC-20.

```js
import { createPublicClient, http, parseUnits } from "viem";
import routerAbi from "../abi/router.json" with { type: "json" };
import factoryAbi from "../abi/factory.json" with { type: "json" };
import pairAbi from "../abi/pair.json" with { type: "json" };
import erc20Abi from "../abi/erc20.json" with { type: "json" };

const soneium = {
  id: 1868,
  name: "Soneium",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.soneium.org"] } }
};

const ROUTER = "0x97C180C2e3097f28D8F14114AD1C0dEF81244344";
const FACTORY = "0x77b141dCFDa726e239efF005E3DE7A47AeBFf948";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC_E = "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369";
const PAIR = "0x9726ecEB595376765f7391e16e438cfb7b8D71F2";

const publicClient = createPublicClient({ chain: soneium, transport: http() });

// Read-only checks. No account and no key.
const onChainFactory = await publicClient.readContract({
  address: ROUTER,
  abi: [{ name: "factory", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }],
  functionName: "factory"
});
if (onChainFactory.toLowerCase() !== FACTORY.toLowerCase()) {
  throw new Error("Router factory() does not match the live Soneium factory");
}

const pairFromFactory = await publicClient.readContract({
  address: FACTORY,
  abi: factoryAbi,
  functionName: "getPair",
  args: [WETH, USDC_E]
});
if (pairFromFactory.toLowerCase() !== PAIR.toLowerCase()) {
  throw new Error("factory.getPair does not match the live WETH/USDC.e pair");
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

// token0 is WETH, token1 is USDC.e on this pair.
const reserveA = token0.toLowerCase() === WETH.toLowerCase() ? reserve0 : reserve1; // WETH
const reserveB = token1.toLowerCase() === USDC_E.toLowerCase() ? reserve1 : reserve0; // USDC.e

// Example size only. Pools are thin: keep this small relative to reserves.
// 0.001 WETH, with USDC.e matched to the current ratio (USDC.e has 6 decimals).
const amountADesired = parseUnits("0.001", 18);
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
  address: WETH,
  abi: erc20Abi,
  functionName: "approve",
  args: [ROUTER, amountADesired]
});
await publicClient.waitForTransactionReceipt({ hash });

hash = await walletClient.writeContract({
  account,
  address: USDC_E,
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
  args: [WETH, USDC_E, amountADesired, amountBDesired, amountAMin, amountBMin, account, deadline]
});
```

The ASTR/USDC.e pair on the same factory is
`0x18b2e9E07d191A110DAEA6Ad3468495caf4d1CB9` (`token0` is ASTR
`0x2CAE934a1e84F693fbb78CA5ED3B0A6893259441`, 18 decimals; `token1` is
USDC.e). Repeat the same reads and calls with those addresses. Confirm
`factory.getPair(ASTR, USDC.e)` and that both reserves are nonzero first.

Do not use the Soneium legacy factory
`0x06C0b58287794a0bdce20ce768b601CA974618DC`, the Soneium legacy router
`0xa393E76bE079cF1ccf684D0f815795Dde248f157`, or LP tokens from
VibeMasterChefV2. Those LPs are from the old factory.

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
  args: [WETH, USDC_E, liquidity, amountAMinOut, amountBMinOut, account, deadline]
});
```

## BNB Smart Chain (chain ID 56)

Use the same quote, approve, and `addLiquidity` / `removeLiquidity` calls.
Only the chain and addresses change. The connected wallet still signs.
Do not put a private key in this file.

The BNB router address is the same as the **legacy Soneium router**.
Always match address and chain ID. On BNB Chain this router is live; on
Soneium it is not.

Checked on `https://bsc-dataseed.bnbchain.org`:

- Router: `0xa393E76bE079cF1ccf684D0f815795Dde248f157` (`factory()` returns the factory below)
- Factory: `0x26b13e7e923e964b0514B3167A90901B49DAe205`
- USDT: `0x55d398326f99059fF775485246999027B3197955` (18 decimals, not 6)
- WBNB: `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` (18 decimals)
- USDT/WBNB pair: `0x6dABcbFdFE097e421269a444eBF22999B1EAE279`
  (`factory.getPair` returns this pair; `token0` is USDT and `token1` is WBNB)
- Factory init code hash: `0x87b780b5d19df9ad0d4c866dcd6b169f14846fb24232a128b678c5bdb395b012`
- Swap fee: 0.25% (`9975/10000`)

Do not use the deprecated BNB factory
`0xaf905e66038EcE89e03D843B35a11D262053B630` or the deprecated router
`0x7532b23DFB30ac22b2a74E3B81cC288de19379BA`.

```js
const bsc = {
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-dataseed.bnbchain.org"] } }
};

const BSC_ROUTER = "0xa393E76bE079cF1ccf684D0f815795Dde248f157";
const BSC_FACTORY = "0x26b13e7e923e964b0514B3167A90901B49DAe205";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const BSC_PAIR = "0x6dABcbFdFE097e421269a444eBF22999B1EAE279";

// path / tokens = [USDT, WBNB]
// read router.factory, factory.getPair, getReserves (abort if either is 0),
// set amountBDesired from the reserve ratio, then approve both ERC-20s and
// write addLiquidity on BSC_ROUTER, with the same amount*Min and deadline
// rules as the Soneium example. USDT on this chain has 18 decimals.
```

## Arbitrum One (chain ID 42161)

Use the same quote, approve, and `addLiquidity` / `removeLiquidity` calls.
Only the chain and addresses change. The connected wallet still signs.
Do not put a private key in this file.

Checked on `https://arb1.arbitrum.io/rpc`:

- Router: `0x8BE6469287A872B34665F5c0c8fbce73c0Dcbf72` (`factory()` returns the factory below)
- Factory: `0xA95107ebE4e54480bA755061eF3207c3421150f0`
- WETH: `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` (18 decimals)
- USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (6 decimals)
- WETH/USDC pair: `0x4DF5bcAC28b8898988Ba576B8463664b53ddb9F7`
  (`factory.getPair` returns this pair; `token0` is WETH and `token1` is USDC; both reserves were nonzero)

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
// rules as the Soneium example. USDC on this chain has 6 decimals.
```
