// CONFIGURACIÓN DE WALLETS PRO
(function() {
  

  const WALLETS = [
    {
      id: 'metamask',
      name: 'MetaMask',
      icon: 'icons/metamask.svg', 
      installUrl: 'https://metamask.io/download/',
      check: () => window.ethereum && window.ethereum.isMetaMask,
      getProvider: () => window.ethereum
    },
    {
      id: 'trust',
      name: 'Trust Wallet',
       icon: 'icons/trust.svg',
       installUrl: 'https://trustwallet.com/download',
      check: () => window.trustwallet || (window.ethereum && window.ethereum.isTrust),
      getProvider: () => window.trustwallet || window.ethereum
    },
    {
      id: 'nova',
      name: 'Nova Wallet',
      icon: 'icons/nova.png',
      installUrl: 'https://novawallet.io/',
      description: 'Polkadot & EVM Mobile',
      check: () => window.ethereum, // Nova inyecta un standard provider
      getProvider: () => window.ethereum
    }
  ];

  window.WALLET_CONFIG = WALLETS;
})();
