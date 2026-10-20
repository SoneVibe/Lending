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

    function isZeroAddress(addr) {
        return !addr || /^0x0{40}$/i.test(String(addr));
    }

    function trimUnits(wei, decimals) {
        const s = ethers.formatUnits(wei, Number(decimals));
        if (!s.includes(".")) return s;
        const trimmed = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
        return trimmed === "" ? "0" : trimmed;
    }

    // Soneium mainnet pairs from networks.json farms. Reserves are read live.
    // A missing pair is "Not created yet". Nothing here is a dollar TVL.
    async function renderFeaturedPairs(network) {
        const box = document.getElementById("featuredPairs");
        if (!box) return;
        const show = !!(network && String(network.chainId) === "1868" && network.factory && Array.isArray(network.farms) && network.farms.length);
        if (!show || typeof ethers === "undefined" || !network.rpcUrls || !network.rpcUrls[0]) {
            box.hidden = true;
            box.replaceChildren();
            return;
        }
        box.hidden = false;
        box.replaceChildren();
        const title = document.createElement("div");
        title.className = "pl-section-label";
        title.textContent = "Pairs";
        title.style.cssText = "font-size:0.78rem;font-weight:600;color:var(--text-muted);margin:12px 0 4px;";
        box.appendChild(title);
        const reader = new ethers.JsonRpcProvider(network.rpcUrls[0], Number(network.chainId), { staticNetwork: true });
        const factory = new ethers.Contract(network.factory, ["function getPair(address,address) view returns (address)"], reader);
        const pairAbi = [
            "function getReserves() view returns (uint112,uint112,uint32)",
            "function token0() view returns (address)"
        ];
        for (const farm of network.farms) {
            const row = document.createElement("p");
            row.className = "pl-note";
            row.style.cssText = "margin:6px 0 0;font-size:0.8rem;line-height:1.45;color:var(--text-muted);";
            const label = farm.lpSymbol || "LP";
            let text = label + ": Could not read this pair";
            try {
                let pair = farm.lpToken;
                if (isZeroAddress(pair) && farm.token0 && farm.token1) pair = await factory.getPair(farm.token0, farm.token1);
                if (isZeroAddress(pair)) text = label + ": Not created yet";
                else {
                    const c = new ethers.Contract(pair, pairAbi, reader);
                    const [res, token0] = await Promise.all([c.getReserves(), c.token0()]);
                    const token0Is0 = String(token0).toLowerCase() === String(farm.token0).toLowerCase();
                    const a = token0Is0 ? res[0] : res[1];
                    const b = token0Is0 ? res[1] : res[0];
                    if (a === 0n && b === 0n) text = label + ": Not created yet";
                    else text = label + ": " + trimUnits(a, farm.token0Decimals ?? 18) + " " + (farm.token0Symbol || "token0") + " · " + trimUnits(b, farm.token1Decimals ?? 18) + " " + (farm.token1Symbol || "token1");
                }
            } catch (e) { /* keep the read-failed line */ }
            row.textContent = text;
            box.appendChild(row);
        }
    }

    window.renderFeaturedPairs = renderFeaturedPairs;

})();