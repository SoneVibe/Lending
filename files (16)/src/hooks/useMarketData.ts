import { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { CTOKENS } from '../lib/constants';
import { CTokenAbi } from '../lib/abis';
import { apyString } from '../lib/format';

interface MarketRow {
  cToken: `0x${string}`;
  symbol: string;
  underlying: string;
  exchangeRate: bigint;
  totalSupply: bigint;
  totalBorrows: bigint;
  totalReserves: bigint;
  borrowRatePerBlock: bigint;
  supplyRatePerBlock: bigint;
  utilization: bigint;
  borrowAPY: string;
  supplyAPY: string;
}

export function useMarketData(): { markets: MarketRow[]; loading: boolean; refresh: () => void } {
  const client = usePublicClient();
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const out: MarketRow[] = [];
    for (const m of CTOKENS) {
      const cAddr = m.address;
      const [
        exch,
        ts,
        tb,
        tr,
        rates
      ] = await Promise.all([
        client.readContract({ address: cAddr, abi: CTokenAbi.abi, functionName: 'exchangeRateStored' }),
        client.readContract({ address: cAddr, abi: CTokenAbi.abi, functionName: 'totalSupply' }),
        client.readContract({ address: cAddr, abi: CTokenAbi.abi, functionName: 'totalBorrows' }),
        client.readContract({ address: cAddr, abi: CTokenAbi.abi, functionName: 'totalReserves' }),
        client.readContract({ address: cAddr, abi: CTokenAbi.abi, functionName: 'peekRates' })
      ]);

      const [borrowRatePerBlock, supplyRatePerBlock, utilization] = rates as [bigint, bigint, bigint];
      out.push({
        cToken: cAddr,
        symbol: m.symbol,
        underlying: m.underlying,
        exchangeRate: exch as bigint,
        totalSupply: ts as bigint,
        totalBorrows: tb as bigint,
        totalReserves: tr as bigint,
        borrowRatePerBlock,
        supplyRatePerBlock,
        utilization,
        borrowAPY: apyString(borrowRatePerBlock),
        supplyAPY: apyString(supplyRatePerBlock)
      });
    }
    setMarkets(out);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);
  return { markets, loading, refresh: load };
}