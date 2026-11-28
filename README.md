# SoneVibe

SoneVibe is a Uniswap V2-style DEX. The main chain is BNB Chain (chainId 56).

Each swap pays a fee of 0.25%. With `feeTo` set, liquidity providers receive 0.2083% and the protocol treasury receives 0.0417%.

On BNB Chain one address is both factory `owner` and `feeToSetter`. It controls factory settings and pair creation. It cannot move tokens out of pairs. The same address owns the router and can recover tokens or BNB sent to the router. Addresses and admin functions are in [contracts/README.md](contracts/README.md).

Arbitrum is maintenance only. Soneium contracts are legacy. Astar is retired.

## How to integrate

BNB Chain (chainId 56), for aggregators:

- Factory: `0x26b13e7e923e964b0514B3167A90901B49DAe205`
- Router: `0xa393E76bE079cF1ccf684D0f815795Dde248f157`
- Init code hash: `0x87b780b5d19df9ad0d4c866dcd6b169f14846fb24232a128b678c5bdb395b012`
- Fee: 0.25% per swap (`amountIn * 9975 / 10000`). With `feeTo` set, liquidity providers receive 0.2083% and the protocol treasury receives 0.0417%.

Pair addresses are CREATE2 from the factory and the init code hash. WBNB is `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`.

## Contracts

[contracts/README.md](contracts/README.md)

## Official links

- Website: https://sonevibe.github.io/Lending/
- Telegram: https://t.me/SoneVibe
- Discord: https://discord.gg/DV8GYUPDn2

## Stay safe

The SoneVibe team never sends the first DM and never asks for private keys or seed phrases.

## Security

[SECURITY.md](SECURITY.md)
