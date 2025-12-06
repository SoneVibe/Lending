// CONFIGURACIÓN DE WALLETS PRO
(function() {
  
  const WALLET_ICONS = {
    metamask: `<svg viewBox="0 0 32 32" width="32" height="32"><path fill="#E17726" d="M29.2 10.8l-2.4-5.6-5.8 2-3.8-2.6h-2.3l-3.8 2.6-5.8-2-2.4 5.6c-1.3 2.1-1.6 6.8 2.6 11.2 0 0 1.2 2.6 5.5 2.6l1.3-1.6 1.7 1.8h3.9l1.7-1.8 1.3 1.6c4.3 0 5.5-2.6 5.5-2.6 4.3-4.5 3.9-9.1 2.6-11.2z"/></svg>`,
    trust: `<svg viewBox="0 0 32 32" width="32" height="32"><path fill="#3375BB" d="M16 1.5l-14 6.2v8.8c0 9.8 11.6 14.5 14 15 2.4-.5 14-5.2 14-15v-8.8l-14-6.2z" /></svg>`,
    nova: `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="16" fill="url(#nova-grad)"/><defs><linearGradient id="nova-grad" x1="0" y1="0" x2="32" y2="32"><stop offset="0%" stop-color="#3C95FF"/><stop offset="100%" stop-color="#2D6CDF"/></linearGradient></defs><path fill="#FFF" d="M16 6l-6 10h12l-6-10zm-6 12l-4 7h20l-4-7H10z"/></svg>`
  };

  const WALLETS = [
    {
      id: 'metamask',
      name: 'MetaMask',
      icon: WALLET_ICONS.metamask,
      check: () => window.ethereum && window.ethereum.isMetaMask,
      getProvider: () => window.ethereum
    },
    {
      id: 'trust',
      name: 'Trust Wallet',
      icon: WALLET_ICONS.trust,
      check: () => window.trustwallet || (window.ethereum && window.ethereum.isTrust),
      getProvider: () => window.trustwallet || window.ethereum
    },
    {
      id: 'nova',
      name: 'Nova Wallet',
      icon: WALLET_ICONS.nova,
      description: 'Polkadot & EVM Mobile',
      check: () => window.ethereum, // Nova inyecta un standard provider
      getProvider: () => window.ethereum
    }
  ];

  window.WALLET_CONFIG = WALLETS;
})();
