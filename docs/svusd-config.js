// Configuración de direcciones para SVUSD
// Se carga en window.SVUSD_CONFIG para evitar problemas de fetch/JSON

(function() {
    window.SVUSD_CONFIG = {
        "1868": { // Soneium Mainnet
            chainId: "1868",
            contracts: {
                svusd: "0xcEca29F5f722a2922237c4D2b6Fe46Fa274B190B",
                cSvusd: "0x65f059eA5C90daE2BbF37a1A8c93A6C843255452",
                stabilityModule: "0x7F1aF1382899263aF50Bc6d3601bdaB1E17Ba20D"
            }
        },
        "1946": { // Minato Testnet
            chainId: "1946",
            contracts: {
                // Direcciones tomadas de tu svusd.json anterior
                svusd: "0x79604C0D88E57A98f900492Bb563232d07312428",
                cSvusd: "0x2B5575644CD1fCa7725922e6f30f798888F03533", 
                stabilityModule: "0x8A52De344FccB11CeD9a4b89704935377bf6715d"
            }
        }
    };
    console.log("SVUSD Config Loaded:", window.SVUSD_CONFIG);
})();