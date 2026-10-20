// CONFIGURACIÓN EXCLUSIVA PARA SWAP (NO TOCA EL LENDING)
(function() {
    
    // Rutas de archivos
    const PATHS = {
        networks: "networks.json",   // Reusa la infra del Lending
        tokens: "token-list.json"    // Lista exclusiva del Swap
    };

    // Función principal de carga (reemplaza a loadNetworks en swap.js)
    async function loadSwapConfig() {
        try {
            // 1. Cargar ambas fuentes en paralelo
            const [netRes, tokRes] = await Promise.all([
                fetch(PATHS.networks),
                fetch(PATHS.tokens)
            ]);

            if (!netRes.ok) throw new Error("Networks failed");
            const networksData = await netRes.json();
            
            let swapTokens = [];
            if (tokRes.ok) {
                const tokenData = await tokRes.json();
                swapTokens = tokenData.tokens || [];
            }

            // 2. Inyectar tokens en la estructura de redes
            // Esto crea un objeto 'ACTIVE' vitaminado solo para el Swap
            Object.values(networksData).forEach(network => {
                const chainId = parseInt(network.chainId);
                
                // Filtrar tokens que pertenecen a esta red
                const chainTokens = swapTokens.filter(t => t.chainId === chainId);
                
                // Guardamos en una propiedad nueva para no conflicturar con cTokens
                network.swapTokenList = chainTokens;
                
                // Opcional: Si quieres que los cTokens del lending también aparezcan en el swap
                // como "Underlying", puedes agregarlos aquí manualmente.
                // Por ahora, usamos solo la lista limpia de token-list.json
            });

            return networksData;

        } catch (error) {
            console.error("Swap Config Error:", error);
            return null;
        }
    }

    // Exponer globalmente con un nombre específico para evitar conflictos
    window.loadSwapConfig = loadSwapConfig;

})();