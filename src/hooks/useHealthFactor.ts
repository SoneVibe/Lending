import { useMemo } from 'react';
import { useAccountPosition } from './useAccountPosition';

export function useHealthFactor(address?: `0x${string}`) {
  const { liquidityData } = useAccountPosition(address);
  const hf = useMemo(() => {
    if (!liquidityData) return null;
    const { liquidationUSD, borrowUSD } = liquidityData;
    if (borrowUSD === 0n) return Infinity;
    return Number(liquidityUSDToHF(liquidityData.liquidationUSD, liquidityData.borrowUSD));
  }, [liquidityData]);

  return { healthFactor: hf, raw: liquidityData };
}

function liquidityUSDToHF(liq: bigint, bor: bigint): number {
  return Number(liq) / Number(bor);
}