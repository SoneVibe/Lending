// ============================================================
// SONEVIBE MARKET CONFIGURATION V5 (MULTI-CHAIN: GRAPH & SUBQUERY)
// ============================================================

/**
 * GLOSARIO DE ICONOS (Rutas relativas)
 */
const ICONS = {
    vibe: "icons/vibe.svg",
    astr: "icons/astr.svg",
    eth: "icons/weth.svg",
    usdc: "icons/usdc.svg"
};

/**
 * CONFIGURACIÓN MAESTRA DE MERCADO
 * Clave: ChainID (string decimal)
 * NOTA IMPORTANTE:
 * - isNative: false -> El contrato usa ERC20 (approve + transferFrom).
 * - graphEndpoint: URL de tu Subgraph/SubQuery.
 * - indexerType: 'THEGRAPH' (Defecto) o 'SUBQUERY'.
 */
const MARKET_CONFIG = {
    // --- SONEIUM MINATO TESTNET (ChainID: 1946) ---
    "1946": {
        label: "Minato Testnet",
        marketplaceAddress: "0x8f77C59d58488C576f444D5481958935a811fcFB",
        
        // Usando The Graph
        indexerType: "THEGRAPH",
        graphEndpoint: "https://api.studio.thegraph.com/query/1721868/sone-vibe-market/v0.0.16",
        
        paymentToken: {
            address: "0x26e6f7c7047252DdE3dcBF26AA492e6a264Db655", 
            symbol: "ASTR",
            decimals: 18,
            isNative: false 
        },
        collections: [
            {
                id: "yoki-origins",
                name: "Yoki Origins (Official)",
                address: "0x4ea1141673CA8D44ee5c88Ab719f51a210f0E70D", 
                type: "ERC1155", 
                imagePlaceholder: ICONS.vibe
            },
            {
                id: "founders-pass",
                name: "SoneVibe Founders Pass",
                address: "0x84B5aEC57DB0eBD291Ad88995009dA9787339B56", 
                type: "ERC721",
                imagePlaceholder: ICONS.vibe
            }
        ]
    },

    // --- SONEIUM MAINNET (ChainID: 1868) ---
    "1868": {
        label: "Soneium Mainnet",
        marketplaceAddress: "0x7242ACB7a27052abBe49EF096aC473e9cBC02627",
        
        // Usando The Graph
        indexerType: "THEGRAPH",
        graphEndpoint: "https://api.studio.thegraph.com/query/1721868/sone-vibe-market-soneium/v0.0.1",
        
        paymentToken: {
            address: "0x2CAE934a1e84F693fbb78CA5ED3B0A6893259441",
            symbol: "ASTR",
            decimals: 18,
            isNative: false
        },
        collections: [
            {
                id: "Astar Degens",
                name: "Astar Degens (Official)",
                address: "0xf1cb8D5ac598f03f182e0E1436Ce13583CE16FAb", 
                type: "ERC1155", 
                imagePlaceholder: ICONS.vibe
            },
            {
                id: "jcc-collection",
                name: "Japan Creators Collection (JCC)",
                address: "0x8a6387C00f5069e71124907F2a0F5bCBca611105",
                type: "ERC721",
                imagePlaceholder: ICONS.vibe
            },           
            {
                id: "yoki-origins",
                name: "Yoki Origins (Official) !on Maintenance mode!",
                address: "0x5f2a5818DF3216Aa6ac44632541db8F3EC4e9954", 
                type: "ERC1155", 
                imagePlaceholder: ICONS.vibe
            }

        ]
    },

    // --- ASTAR EVM MAINNET (ChainID: 592) ---
    // [CONFIGURACIÓN PARA SUBQUERY PRODUCTION]
    "592": {
        label: "Astar Mainnet",
        // Dirección de tu contrato Proxy V3 desplegado en Astar
        marketplaceAddress: "0x691459a1D00e6fa2BD39502FF58BfDE8a804940c", 
        
        // Configuración SUBQUERY
        indexerType: "SUBQUERY",
        
        // OPCIÓN A: Producción (SubQuery Managed Service)
        // Reemplaza esto con tu URL HTTPS de producción cuando despliegues (ej: https://api.subquery.network/sq/...)
        graphEndpoint: "https://index-api.onfinality.io/sq/SoneVibe/sone-vibe-astar", 
        
        // OPCIÓN B: Desarrollo Local (Descomentar para probar con Docker)
        // graphEndpoint: "http://localhost:3000",

        paymentToken: {
            // Dirección de Wrapped ASTR en Astar Mainnet (Verifica esta dirección en el explorer)
            address: "0xAeaaf0e2c81Af264101B9129C00F4440cCF0F720", 
            symbol: "WASTR",
            decimals: 18,
            isNative: false
        },
        collections: [
            // [SUGERENCIA]: Para agregar colecciones futuras en Astar:
            // 1. Despliega tu NFT o obtén la dirección de uno existente.
            // 2. Copia este bloque, cambia 'address', 'name' y 'type'.
            // 3. Asegúrate que 'type' sea exactamente "ERC721" o "ERC1155".
            {
                id: "Astar Degens",
                name: "Astar Degens Official",
                address: "0xd59fC6Bfd9732AB19b03664a45dC29B8421BDA9a", // <--- CAMBIAR POR DIRECCIÓN REAL
                type: "ERC721",
                imagePlaceholder: ICONS.vibe
            },
            {
                id: "Test Degen",
                name: "Test Degen",
                address: "0x74d9431C9cD7a1872FCEf824348a8475F6E0Ef99",
                type: "ERC721",
                imagePlaceholder: ICONS.vibe
            }

        ]
    }
};

// --- HELPERS GLOBALES ---

// Recuperar configuración segura por ChainID
window.getMarketConfig = (chainId) => {
    const config = MARKET_CONFIG[chainId.toString()];
    if (!config) {
        console.warn(`[MarketConfig] Config not found for ChainID ${chainId}.`);
        return null;
    }
    return config;
};

// --- DEFINICIONES DE ABIs (Global Export) ---

window.MARKET_ABIS = {
    // ABI COMPLETO V3 (Copiado de tu archivo original)
    MARKET: [
        {"inputs":[],"stateMutability":"nonpayable","type":"constructor"},
        {"inputs":[{"internalType":"address","name":"target","type":"address"}],"name":"AddressEmptyCode","type":"error"},
        {"inputs":[{"internalType":"address","name":"implementation","type":"address"}],"name":"ERC1967InvalidImplementation","type":"error"},
        {"inputs":[],"name":"ERC1967NonPayable","type":"error"},
        {"inputs":[],"name":"EnforcedPause","type":"error"},
        {"inputs":[],"name":"ExpectedPause","type":"error"},
        {"inputs":[],"name":"FailedCall","type":"error"},
        {"inputs":[],"name":"InvalidInitialization","type":"error"},
        {"inputs":[],"name":"NotInitializing","type":"error"},
        {"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"OwnableInvalidOwner","type":"error"},
        {"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"OwnableUnauthorizedAccount","type":"error"},
        {"inputs":[],"name":"ReentrancyGuardReentrantCall","type":"error"},
        {"inputs":[{"internalType":"address","name":"token","type":"address"}],"name":"SafeERC20FailedOperation","type":"error"},
        {"inputs":[],"name":"UUPSUnauthorizedCallContext","type":"error"},
        {"inputs":[{"internalType":"bytes32","name":"slot","type":"bytes32"}],"name":"UUPSUnsupportedProxiableUUID","type":"error"},
        {"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"newFee","type":"uint256"}],"name":"FeesUpdated","type":"event"},
        {"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"token","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"FundsWithdrawn","type":"event"},
        {"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint64","name":"version","type":"uint64"}],"name":"Initialized","type":"event"},
        {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"seller","type":"address"},{"indexed":true,"internalType":"address","name":"nftContract","type":"address"},{"indexed":true,"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"ItemCanceled","type":"event"},
        {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"seller","type":"address"},{"indexed":true,"internalType":"address","name":"nftContract","type":"address"},{"indexed":true,"internalType":"uint256","name":"tokenId","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"pricePerUnit","type":"uint256"},{"indexed":false,"internalType":"string","name":"standard","type":"string"}],"name":"ItemListed","type":"event"},
        {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"buyer","type":"address"},{"indexed":true,"internalType":"address","name":"nftContract","type":"address"},{"indexed":true,"internalType":"uint256","name":"tokenId","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"totalPrice","type":"uint256"}],"name":"ItemSold","type":"event"},
        {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"seller","type":"address"},{"indexed":true,"internalType":"address","name":"nftContract","type":"address"},{"indexed":true,"internalType":"uint256","name":"tokenId","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"newAmount","type":"uint256"}],"name":"ListingUpdated","type":"event"},
        {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousOwner","type":"address"},{"indexed":true,"internalType":"address","name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"},
        {"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"account","type":"address"}],"name":"Paused","type":"event"},
        {"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"account","type":"address"}],"name":"Unpaused","type":"event"},
        {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"implementation","type":"address"}],"name":"Upgraded","type":"event"},
        {"inputs":[],"name":"UPGRADE_INTERFACE_VERSION","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},
        {"inputs":[{"internalType":"address","name":"_nftContract","type":"address"},{"internalType":"uint256","name":"_tokenId","type":"uint256"},{"internalType":"uint256","name":"_amountToBuy","type":"uint256"}],"name":"buyItem","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[{"internalType":"address","name":"_nftContract","type":"address"},{"internalType":"uint256","name":"_tokenId","type":"uint256"}],"name":"cancelListing","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[],"name":"ecosystemHook","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
        {"inputs":[{"internalType":"address","name":"_token","type":"address"},{"internalType":"uint256","name":"_amount","type":"uint256"}],"name":"emergencyWithdraw","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[],"name":"feeBasisPoints","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
        {"inputs":[{"internalType":"address","name":"_paymentToken","type":"address"},{"internalType":"address","name":"_treasury","type":"address"}],"name":"initialize","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[{"internalType":"address","name":"_nftContract","type":"address"},{"internalType":"uint256","name":"_tokenId","type":"uint256"},{"internalType":"uint256","name":"_amount","type":"uint256"},{"internalType":"uint256","name":"_pricePerUnit","type":"uint256"}],"name":"listItem","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"uint256","name":"","type":"uint256"}],"name":"listings","outputs":[{"internalType":"address","name":"seller","type":"address"},{"internalType":"address","name":"nftContract","type":"address"},{"internalType":"uint256","name":"tokenId","type":"uint256"},{"internalType":"uint256","name":"pricePerUnit","type":"uint256"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"enum SoneVibeMarketV3.TokenType","name":"tokenType","type":"uint8"},{"internalType":"bool","name":"active","type":"bool"}],"stateMutability":"view","type":"function"},
        {"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"address","name":"","type":"address"},{"internalType":"uint256[]","name":"","type":"uint256[]"},{"internalType":"uint256[]","name":"","type":"uint256[]"},{"internalType":"bytes","name":"","type":"bytes"}],"name":"onERC1155BatchReceived","outputs":[{"internalType":"bytes4","name":"","type":"bytes4"}],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"address","name":"","type":"address"},{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"bytes","name":"","type":"bytes"}],"name":"onERC1155Received","outputs":[{"internalType":"bytes4","name":"","type":"bytes4"}],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
        {"inputs":[],"name":"paused","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},
        {"inputs":[],"name":"paymentToken","outputs":[{"internalType":"contract IERC20","name":"","type":"address"}],"stateMutability":"view","type":"function"},
        {"inputs":[],"name":"proxiableUUID","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},
        {"inputs":[],"name":"renounceOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[{"internalType":"address","name":"_hook","type":"address"}],"name":"setEcosystemHook","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[{"internalType":"uint256","name":"_newBasisPoints","type":"uint256"}],"name":"setFees","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},
        {"inputs":[],"name":"togglePause","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[],"name":"treasury","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
        {"inputs":[{"internalType":"address","name":"newImplementation","type":"address"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"upgradeToAndCall","outputs":[],"stateMutability":"payable","type":"function"}
    ],
    
    // ABI Estándar ERC-721
    ERC721: [
        "function setApprovalForAll(address operator, bool approved) external",
        "function isApprovedForAll(address owner, address operator) view returns (bool)",
        "function ownerOf(uint256 tokenId) view returns (address)",
        "function tokenURI(uint256 tokenId) view returns (string)",
        "function supportsInterface(bytes4 interfaceId) view returns (bool)"
    ],
    
    // ABI Estándar ERC-1155
    ERC1155: [
        "function setApprovalForAll(address operator, bool approved) external",
        "function isApprovedForAll(address account, address operator) view returns (bool)",
        "function balanceOf(address account, uint256 id) view returns (uint256)",
        "function uri(uint256 id) view returns (string)",
        "function supportsInterface(bytes4 interfaceId) view returns (bool)"
    ],
    
    // ABI Estándar ERC-20 (Para pagos)
    ERC20: [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function allowance(address owner, address spender) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function balanceOf(address account) view returns (uint256)",
        "function symbol() view returns (string)"
    ]
};
