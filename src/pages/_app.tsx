import '../styles.css';
import type { AppProps } from 'next/app';
import { WagmiConfig, createConfig, http } from 'wagmi';
import { defineChain } from 'viem';

const customChain = defineChain({
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID || 31337),
  name: 'CustomTestnet',
  network: 'custom-testnet',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:8545'] },
    public: { http: [process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:8545'] }
  }
});

const config = createConfig({
  chains: [customChain],
  transports: {
    [customChain.id]: http(customChain.rpcUrls.default.http[0])
  }
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WagmiConfig config={config}>
      <Component {...pageProps} />
    </WagmiConfig>
  );
}