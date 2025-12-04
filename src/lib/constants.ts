export const BLOCKS_PER_YEAR = 15_768_000; // 2s block time
export const MASTER_ADDRESS = process.env.NEXT_PUBLIC_MASTER_ADDRESS as `0x${string}`;
export const ORACLE_ADDRESS = process.env.NEXT_PUBLIC_ORACLE_ADDRESS as `0x${string}`;
export const CTOKENS = [
  {
    symbol: 'cASTR',
    underlying: 'ASTR',
    address: process.env.NEXT_PUBLIC_CTOKEN_ASTR as `0x${string}`,
    decimalsUnderlying: 18
  },
  {
    symbol: 'cUSDC',
    underlying: 'USDC',
    address: process.env.NEXT_PUBLIC_CTOKEN_USDC as `0x${string}`,
    decimalsUnderlying: 6
  }
];