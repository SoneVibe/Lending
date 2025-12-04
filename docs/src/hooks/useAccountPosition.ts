import { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { CTOKENS } from '../lib/constants';
import { CTokenAbi, MasterAbi } from '../lib/abis';
import { MASTER_ADDRESS } from '../lib/constants';

interface MarketPosition {
  cToken: `0x${string}`;
  supplyCTokens: bigint;
  borrowUnderlying: bigint;
  exchangeRate: bigint;
  underlyingDecimals: number;
}

export function useAccountPosition(address?: `0x${string}`) {
  const client = usePublicClient();
  const [positions, setPositions] = useState<MarketPosition[]>([]);
  const [liquidityData, setLiquidityData] = useState<{ liquidationUSD: bigint; borrowUSD: bigint; shortfallUSD: bigint } | null>(null);

  async function load() {
    if (!address) { setPositions([]); setLiquidityData(null); return; }
    const pos: MarketPosition[] = [];
    for (const m of CTOKENS) {
      const [balCT, debt, exch, uDec] = await Promise.all([
        client.readContract({ address: m.address, abi: CTokenAbi.abi, functionName: 'balanceOf', args: [address] }),
        client.readContract({ address: m.address, abi: CTokenAbi.abi, functionName: 'borrowBalance', args: [address] }),
        client.readContract({ address: m.address, abi: CTokenAbi.abi, functionName: 'exchangeRateStored' }),
        client.readContract({ address: m.address, abi: CTokenAbi.abi, functionName: 'underlyingDecimals' })
      ]);
      pos.push({
        cToken: m.address,
        supplyCTokens: balCT as bigint,
        borrowUnderlying: debt as bigint,
        exchangeRate: exch as bigint,
        underlyingDecimals: Number(uDec)
      });
    }

    const [liq0, liq1, liq2] = await client.readContract({
      address: MASTER_ADDRESS,
      abi: MasterAbi.abi,
      functionName: 'getAccountLiquidity',
      args: [address]
    }) as [bigint, bigint, bigint];

    setPositions(pos);
    setLiquidityData({ liquidationUSD: liq0, borrowUSD: liq1, shortfallUSD: liq2 });
  }

  useEffect(() => { load(); }, [address]);

  return { positions, liquidityData, refresh: load };
}