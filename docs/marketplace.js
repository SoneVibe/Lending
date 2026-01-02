// ==========================================
// SONEVIBE MARKETPLACE CONTROLLER V5 (UNIFIED WALLET & GRAPH)
// ==========================================

// Variables Globales de Web3
let provider, signer, userAddress;
let NETWORKS_DATA = {}; // Se cargará de networks.json
let ACTIVE_NETWORK = null; // Objeto de red activa (Chain info)
let ACTIVE_MARKET_CONFIG = null; // Configuración del mercado (Contracts/Graph)
let marketContract; // Instancia ethers del contrato
let selectedProvider = null; // Helper para modal de wallets

// Estado de la Aplicación
const APP_STATE = {
    currentCollection: null, // Objeto de colección seleccionado
    listings: [],            // Items del mercado (Graph o RPC)
    myListings: [],          // Items del usuario
    mode: 'LOADING'          // 'GRAPH' | 'RPC' | 'LOADING'
};

// Helpers DOM
const getEl = (id) => document.getElementById(id);

// =========================================================
// 1. INICIALIZACIÓN Y CARGA DE CONFIGURACIÓN
// =========================================================
document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
    console.log("🚀 Initializing SoneVibe Market V5...");
    try {
        // 1. Cargar Redes desde networks.json (Infraestructura base)
        NETWORKS_DATA = await window.loadNetworks();
        
        // 2. Inicializar Selector de Redes (UI)
        initNetworkSelector();

        // 3. Detectar entorno (ReadOnly o Wallet Pre-conectada)
        await tryInitEnvironment();

        // 4. Hook para Auto-Connect (usando SessionManager de config.js)
        if(window.checkAutoConnect) {
            await window.checkAutoConnect(connectWallet);
        }
    } catch(e) { 
        console.error("Critical Init Error:", e);
        showToast("Error initializing app. Check console.", "error");
    }
}

/**
 * Intenta configurar el entorno inicial basado en window.ethereum o defaults
 */
async function tryInitEnvironment() {
    // Si hay wallet inyectada, intentamos leer la red actual para sincronizar UI
    // aunque el usuario no esté conectado aún
    if(window.ethereum) {
        try {
            const tempProvider = new ethers.BrowserProvider(window.ethereum);
            const chainIdHex = await tempProvider.send("eth_chainId", []);
            const chainId = parseInt(chainIdHex, 16).toString();
            
            // Sincronizar UI con la red detectada (Solo Lectura)
            // Esto prepara el selector antes de que el usuario haga click en conectar
            const netData = Object.values(NETWORKS_DATA).find(n => n.chainId == chainId);
            if (netData) {
                 const sel = getEl("networkSelect");
                 if(sel) sel.value = chainId;
                 // Inicializamos data en modo lectura
                 await handleNetworkChange(chainId, tempProvider, false);
            }
        } catch(e) {
            console.warn("Could not detect initial network, waiting for user.", e);
        }
    }
}

// =========================================================
// 2. LÓGICA DE REDES Y SELECTORES
// =========================================================

function initNetworkSelector() {
    const sel = getEl("networkSelect");
    if (!NETWORKS_DATA || !sel) return;
    
    sel.innerHTML = "";
    // Opción default
    const defOpt = document.createElement("option");
    defOpt.textContent = "Select Network";
    defOpt.value = "";
    defOpt.disabled = true;
    defOpt.selected = true;
    sel.appendChild(defOpt);

    Object.values(NETWORKS_DATA).forEach(n => {
        if(n.enabled) {
            const opt = document.createElement("option");
            opt.value = n.chainId; 
            opt.textContent = n.label;
            sel.appendChild(opt);
        }
    });

    sel.onchange = async (e) => {
        const targetId = e.target.value;
        if(userAddress) {
            // Si hay usuario, forzamos cambio de red en Wallet
            await switchNetworkWallet(targetId);
        } else {
            // Modo solo lectura
            const netData = Object.values(NETWORKS_DATA).find(n => n.chainId == targetId);
            if(netData) {
                // Crear provider RPC público para lectura
                const rpcProvider = new ethers.JsonRpcProvider(netData.rpcUrls[0]);
                await handleNetworkChange(targetId, rpcProvider, false);
            }
        }
    };
}

/**
 * Maneja centralizadamente el cambio de red y configuración de mercado
 */
async function handleNetworkChange(chainId, newProvider, isConnected) {
    console.log(`🌐 Network Changed to ChainID: ${chainId}`);
    
    // 1. Buscar Datos de Red (Infra)
    const netData = Object.values(NETWORKS_DATA).find(n => n.chainId == chainId);
    ACTIVE_NETWORK = netData;

    // 2. Buscar Configuración de Mercado (Contracts/Graph)
    // Usamos la función global window.getMarketConfig de market-config.js
    ACTIVE_MARKET_CONFIG = window.getMarketConfig ? window.getMarketConfig(chainId) : null;

    if (!ACTIVE_NETWORK) {
        console.warn("Network not defined in networks.json");
        return;
    }

    // 3. Actualizar Providers Globales
    provider = newProvider;
    if (isConnected) {
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        updateStatus(true);
    } else {
        signer = null;
        // userAddress se mantiene null o previo
    }

    // 4. Sincronizar Selectores UI
    const sel = getEl("networkSelect");
    if(sel && sel.value != chainId) sel.value = chainId;

    // 5. Inicializar Selector de Colecciones para esta Red
    initCollectionSelector();

    // 6. Cargar Datos del Mercado
    if (ACTIVE_MARKET_CONFIG) {
        await refreshMarketData();
    } else {
        // Red sin soporte de mercado configurado
        const grid = getEl('marketGrid');
        if(grid) grid.innerHTML = `<div style="text-align:center; padding:40px;">Marketplace not deployed on ${ACTIVE_NETWORK.label} yet.</div>`;
        getEl('collectionSelect').innerHTML = "<option>No Collections</option>";
    }
}

async function switchNetworkWallet(targetChainId) {
    const targetNetwork = Object.values(NETWORKS_DATA).find(n => n.chainId == targetChainId);
    if (!targetNetwork) return;
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: "0x" + Number(targetNetwork.chainId).toString(16) }],
        });
    } catch (switchError) {
        if (switchError.code === 4902) {
            try {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: "0x" + Number(targetNetwork.chainId).toString(16),
                        chainName: targetNetwork.label,
                        rpcUrls: targetNetwork.rpcUrls,
                        blockExplorerUrls: targetNetwork.blockExplorerUrls,
                        nativeCurrency: targetNetwork.nativeCurrency
                    }],
                });
            } catch (e) { console.error("Add Chain Error", e); }
        }
    }
}
// =========================================================
// 3. GESTIÓN DE COLECCIONES Y DATOS
// =========================================================

function initCollectionSelector() {
    const sel = getEl('collectionSelect');
    if(!sel) return;
    sel.innerHTML = "";
    
    // Validar si hay configuración para esta red
    if (!ACTIVE_MARKET_CONFIG || !ACTIVE_MARKET_CONFIG.collections.length) {
        const opt = document.createElement('option');
        opt.textContent = "No Collections Available";
        sel.appendChild(opt);
        APP_STATE.currentCollection = null;
        return;
    }

    // Llenar selector dinámicamente
    ACTIVE_MARKET_CONFIG.collections.forEach((col, idx) => {
        const opt = document.createElement('option');
        opt.value = idx; // Usamos índice para referencia rápida
        opt.textContent = col.name;
        sel.appendChild(opt);
    });

    // Seleccionar la primera por defecto
    APP_STATE.currentCollection = ACTIVE_MARKET_CONFIG.collections[0];
    
    sel.onchange = (e) => {
        const idx = e.target.value;
        APP_STATE.currentCollection = ACTIVE_MARKET_CONFIG.collections[idx];
        refreshMarketData();
    };
}

/**
 * ORQUESTADOR PRINCIPAL DE DATOS
 * Decide si usar The Graph o RPC
 */
async function refreshMarketData() {
    if(!provider || !ACTIVE_MARKET_CONFIG || !APP_STATE.currentCollection) return;
    
    // UI Loading state
    const grid = getEl('marketGrid');
    if(grid) grid.innerHTML = '<div style="text-align:center; grid-column:1/-1; color:#888;">Loading Items...</div>';
    
    // Indicador de fuente
    updateSourceIndicator("loading");

    APP_STATE.listings = [];
    APP_STATE.myListings = [];

    let success = false;

    // A. INTENTO 1: THE GRAPH (Si hay endpoint configurado)
    if (ACTIVE_MARKET_CONFIG.graphEndpoint) {
        console.time("GraphFetch");
        try {
            await fetchFromGraph();
            success = true;
            APP_STATE.mode = 'GRAPH';
            updateSourceIndicator("graph");
            console.log("⚡ Data loaded from The Graph");
        } catch (e) {
            console.warn("⚠️ Graph failed, falling back to RPC...", e);
        }
        console.timeEnd("GraphFetch");
    }

    // B. INTENTO 2: RPC FALLBACK (Si Graph falló o no existe)
    if (!success) {
        console.time("RPCFetch");
        try {
            await fetchFromRPC();
            APP_STATE.mode = 'RPC';
            updateSourceIndicator("rpc");
            console.log("🐢 Data loaded from RPC");
        } catch (e) {
            console.error("❌ All fetch methods failed", e);
            if(grid) grid.innerHTML = `<div style="text-align:center; grid-column:1/-1; color:var(--danger);">Error loading market data. Try switching networks.</div>`;
            return;
        }
        console.timeEnd("RPCFetch");
    }

    // Renderizar Resultados
    renderGrid(APP_STATE.listings, 'marketGrid', false);
    
    // Si hay wallet conectada, filtrar "My Listings"
    if (userAddress) {
        APP_STATE.myListings = APP_STATE.listings.filter(item => 
            item.seller.toLowerCase() === userAddress.toLowerCase()
        );
        renderGrid(APP_STATE.myListings, 'myListingsGrid', true);
    } else {
        getEl('myListingsGrid').innerHTML = '<div style="text-align:center; grid-column:1/-1; color:#888;">Connect wallet to view your listings.</div>';
    }
}

// --- ESTRATEGIA A: THE GRAPH ---
async function fetchFromGraph() {
    const endpoint = ACTIVE_MARKET_CONFIG.graphEndpoint;
    const collectionAddr = APP_STATE.currentCollection.address.toLowerCase();

    // Query GraphQL: Solo items activos, con stock > 0, de la colección actual
    const query = `
    {
      listings(where: { 
        nftContract: "${collectionAddr}", 
        active: true, 
        amount_gt: "0" 
      }, orderBy: blockTimestamp, orderDirection: desc) {
        id
        seller
        tokenId
        pricePerUnit
        amount
        tokenType
      }
    }
    `;

    const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
    });

    const json = await res.json();
    if (json.errors) throw new Error("GraphQLError");

    // Mapear respuesta a nuestro formato interno
    APP_STATE.listings = json.data.listings.map(item => ({
        tokenId: item.tokenId, // String desde Graph
        seller: item.seller,
        price: BigInt(item.pricePerUnit), // Convertir a BigInt para consistencia con ethers
        amount: BigInt(item.amount),
        tokenType: item.tokenType // 0 o 1
    }));
}

// --- ESTRATEGIA B: RPC (Scan de Eventos) ---
async function fetchFromRPC() {
    const marketAddress = ACTIVE_MARKET_CONFIG.marketplaceAddress;
    // Usamos el ABI global definido en market-config.js
    if(!marketContract) marketContract = new ethers.Contract(marketAddress, window.MARKET_ABIS.MARKET, provider);

    const currentBlock = await provider.getBlockNumber();
    // Scanear últimos 10,000 bloques (ajustar según la red para evitar timeout)
    const fromBlock = currentBlock - 10000 > 0 ? currentBlock - 10000 : 0;
    
    const filter = marketContract.filters.ItemListed(); 
    const logs = await marketContract.queryFilter(filter, fromBlock);
    
    const processedIds = new Set();

    // Loop inverso para ver los más nuevos primero
    for (let i = logs.length - 1; i >= 0; i--) {
        const log = logs[i];
        const nftContractAddr = log.args[1];
        const tokenId = log.args[2];

        // Filtro estricto por colección actual
        if(nftContractAddr.toLowerCase() !== APP_STATE.currentCollection.address.toLowerCase()) continue;

        // Evitar duplicados (RPC escanea eventos, no estado actual directo)
        if (!processedIds.has(tokenId.toString())) {
            // Verificar estado actual on-chain (llamada individual necesaria en modo RPC)
            const details = await marketContract.listings(nftContractAddr, tokenId);
            
            // details struct: [seller, nftContract, tokenId, price, amount, type, active]
            // details[6] is active, details[4] is amount
            if(details[6] === true && details[4] > 0n) {
                APP_STATE.listings.push({
                    tokenId: tokenId.toString(),
                    seller: details[0],
                    price: details[3],
                    amount: details[4],
                    tokenType: Number(details[5])
                });
                processedIds.add(tokenId.toString());
            }
        }
    }
}

// --- UI HELPER: SOURCE INDICATOR ---
function updateSourceIndicator(status) {
    const div = getEl('dataSourceDisplay');
    const txt = getEl('sourceText');
    if(!div) return;

    div.className = 'source-indicator'; // Reset
    if(status === 'graph') {
        div.classList.add('source-active', 'graph');
        txt.textContent = "Live via The Graph";
    } else if (status === 'rpc') {
        div.classList.add('source-active', 'rpc');
        txt.textContent = "Live via RPC Scan";
    } else {
        txt.textContent = "Loading Data...";
    }
}
// =========================================================
// 4. RENDERIZADO DE LA INTERFAZ (GRID & CARDS)
// =========================================================

function renderGrid(items, containerId, isMyListing) {
    const grid = getEl(containerId);
    if(!grid) return;
    grid.innerHTML = "";

    if(items.length === 0) {
        const msg = isMyListing 
            ? "You don't have any active listings for this collection."
            : "No active listings found in this collection.";
        grid.innerHTML = `<div style="text-align:center; grid-column:1/-1; padding:40px; color:#555;">${msg}</div>`;
        return;
    }

    // Configuración actual para placeholders y moneda
    const currencySym = ACTIVE_MARKET_CONFIG.paymentToken.symbol;
    const placeholder = APP_STATE.currentCollection.imagePlaceholder;

    items.forEach(item => {
        // Formateo de Precios (BigInt -> String)
        const priceFmt = ethers.formatEther(item.price);
        
        const card = document.createElement('div');
        card.className = 'glass-panel nft-card';
        
        // Botones de Acción (Comprar vs Cancelar)
        let btnHtml = "";
        if(isMyListing) {
            btnHtml = `<button class="btn-primary" style="width:100%; background:var(--danger); border:none;" onclick="window.cancelItem('${item.tokenId}')">Cancel Listing</button>`;
        } else {
            // Pasamos item.price y item.amount como strings para evitar problemas de precisión en JS
            btnHtml = `<button class="btn-primary" style="width:100%" onclick="window.openBuyModal('${item.tokenId}', '${item.price.toString()}', ${item.amount})">Buy Now</button>`;
        }

        card.innerHTML = `
            <div class="badge">${item.amount}x Stock</div>
            <div style="height:240px; background:#111; display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative;">
                <img id="img-${containerId}-${item.tokenId}" src="${placeholder}" style="width:100%; height:100%; object-fit:cover; transition:0.3s; opacity:0.6;">
                <div class="loader-overlay" id="loader-${containerId}-${item.tokenId}"></div> 
            </div>
            <div style="padding:15px; flex-grow:1; display:flex; flex-direction:column;">
                <h4 style="margin:0 0 5px 0; font-size:1.1rem;">Token #${item.tokenId}</h4>
                
                <div style="font-size:0.8rem; color:#888; margin-bottom:15px; display:flex; justify-content:space-between;">
                    <span>Seller:</span>
                    <a href="${ACTIVE_NETWORK.blockExplorerUrls[0]}/address/${item.seller}" target="_blank" style="color:var(--primary); text-decoration:none;">
                        ${item.seller.substring(0,4)}...${item.seller.substring(38)}
                    </a>
                </div>
                
                <div style="margin-top:auto;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; background:rgba(0,0,0,0.3); padding:8px; border-radius:6px;">
                        <span style="color:#FF00FF; font-weight:bold; font-size:1rem;">${priceFmt} ${currencySym}</span>
                        <span style="font-size:0.7rem; color:#aaa;">/unit</span>
                    </div>
                    ${btnHtml}
                </div>
            </div>
        `;
        grid.appendChild(card);
        
        // Carga asíncrona de Metadata (Imagen/Nombre real)
        fetchMetadata(item.tokenId, `img-${containerId}-${item.tokenId}`);
    });
}

/**
 * METADATA FETCHER (Robust IPFS & HTTP handling)
 */
async function fetchMetadata(tokenId, imgId) {
    const resolveIPFS = (url) => {
        if (!url) return "";
        if (url.startsWith("ipfs://")) return url.replace("ipfs://", "https://gateway.pinata.cloud/ipfs/");
        return url;
    };
    
    try {
        const collection = APP_STATE.currentCollection;
        // Usamos provider de lectura (puede ser RPC público o Wallet)
        let uri;
        
        if (collection.type === "ERC1155") {
            const contract = new ethers.Contract(collection.address, window.MARKET_ABIS.ERC1155, provider);
            uri = await contract.uri(tokenId);
        } else {
            const contract = new ethers.Contract(collection.address, window.MARKET_ABIS.ERC721, provider);
            uri = await contract.tokenURI(tokenId);
        }

        if(!uri) return;

        // ERC1155 standard: reemplazar {id} por hex padding 64
        if(uri.includes("{id}")) {
            const hexId = BigInt(tokenId).toString(16).padStart(64, '0');
            uri = uri.replace("{id}", hexId);
        }
        
        const finalUrl = resolveIPFS(uri);
        
        // Fetch JSON Metadata
        const res = await fetch(finalUrl);
        const json = await res.json();
        
        // Actualizar UI
        const imgEl = getEl(imgId);
        if(imgEl) {
            const imageUri = json.image || json.image_url; // Compatibilidad OpenSea
            if(imageUri) {
                imgEl.src = resolveIPFS(imageUri);
                imgEl.style.opacity = "1"; // Quitar efecto 'loading'
            }
        }
        
    } catch(e) { 
        // Silent error
    }
}

// =========================================================
// 5. UI HELPERS & UTILS
// =========================================================

function updateStatus(connected) {
    const dot = getEl('statusDot');
    const txt = getEl('connStatus');
    const btn = getEl('btnConnect');
    
    if(connected && userAddress) {
        dot.style.color = "var(--success)";
        txt.textContent = "Online";
        
        // Botón Conectado Pro (Estilo Markets)
        btn.textContent = userAddress.substring(0,6) + "..." + userAddress.substring(38);
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-connected');
        
        // Icono Dropdown
        const arrow = document.createElement("span");
        arrow.textContent = "▼";
        arrow.style.fontSize = "0.7em";
        arrow.style.marginLeft = "6px";
        if (btn.lastChild && btn.lastChild.tagName === 'SPAN') btn.removeChild(btn.lastChild);
        btn.appendChild(arrow);
        
        getEl('dropdownAddress').textContent = userAddress.substring(0,8) + "..." + userAddress.substring(38);
    } else {
        dot.style.color = "var(--warning)";
        txt.textContent = "Syncing...";
        
        btn.textContent = "Connect Wallet";
        btn.className = "btn-primary";
        btn.style.background = ""; // Reset inline styles
    }
}

// Control de Tabs
window.switchTab = (tab) => {
    ['view-market', 'view-selling', 'view-wallet'].forEach(id => getEl(id).style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    getEl(`view-${tab}`).style.display = 'block';
    
    // Mapeo simple de índice de botón
    const btns = document.querySelectorAll('.tab-btn');
    if(tab === 'market') btns[0].classList.add('active');
    if(tab === 'selling') btns[1].classList.add('active');
    if(tab === 'wallet') btns[2].classList.add('active');
    
    // Refrescar data si vamos a 'selling' para asegurar estado fresco
    if(tab === 'selling') refreshMarketData();
};

function showToast(msg, type="info") {
    const box = getEl('toast-container');
    if(!box) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerText = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}
// =========================================================
// 6. LÓGICA TRANSACCIONAL (BUY / LIST / CANCEL)
// =========================================================

// --- MODAL: COMPRA ---
window.openBuyModal = (tokenId, priceWeiStr, maxAmount) => {
    if(!signer) return showToast("Connect Wallet First", "error");
    
    const modal = getEl('actionModal');
    const content = getEl('modalContent');
    getEl('modalTitle').innerText = `Buy Item #${tokenId}`;
    
    const priceWei = BigInt(priceWeiStr);
    const currency = ACTIVE_MARKET_CONFIG.paymentToken.symbol;

    content.innerHTML = `
        <div class="input-group">
            <label>Quantity to Buy (Max: ${maxAmount})</label>
            <input type="number" id="buyAmount" class="input-std" value="1" min="1" max="${maxAmount}">
        </div>
        <div class="input-group">
            <label>Total Cost</label>
            <div id="totalCostDisplay" style="font-size:1.4rem; color:#FF00FF; font-weight:bold;">...</div>
        </div>
        <button class="btn-primary" style="width:100%; margin-top:10px;" onclick="window.executeBuy('${tokenId}', '${priceWeiStr}')">
            Confirm Purchase
        </button>
    `;
    
    const input = getEl('buyAmount');
    const display = getEl('totalCostDisplay');
    
    // Cálculo reactivo del precio
    const updateCost = () => {
        let amt = parseInt(input.value) || 0;
        if(amt < 1) amt = 1; 
        if(amt > maxAmount) amt = maxAmount;
        input.value = amt; // Clamp visual
        
        const total = priceWei * BigInt(amt);
        display.innerText = `${ethers.formatEther(total)} ${currency}`;
    };
    
    input.oninput = updateCost;
    updateCost();
    modal.classList.add('open');
};

// --- EJECUCIÓN: COMPRA ---
window.executeBuy = async (tokenId, priceUnitWeiStr) => {
    try {
        const amount = getEl('buyAmount').value;
        const priceUnit = BigInt(priceUnitWeiStr);
        const totalPrice = priceUnit * BigInt(amount);
        
        const marketAddress = ACTIVE_MARKET_CONFIG.marketplaceAddress;
        const market = new ethers.Contract(marketAddress, window.MARKET_ABIS.MARKET, signer);
        const colAddress = APP_STATE.currentCollection.address;

        showToast("Processing Transaction...", "info");

        // A. LÓGICA TOKEN DE PAGO (NATIVO vs ERC20)
        const payToken = ACTIVE_MARKET_CONFIG.paymentToken;

        if (payToken.isNative) {
            // PAGO NATIVO (ETH/ASTR directo)
            // No se necesita approve, enviamos value en la tx
            showToast("Sending Transaction...", "info");
            const tx = await market.buyItem(colAddress, tokenId, amount, { value: totalPrice });
            await waitForTx(tx, "Buy Successful!");

        } else {
            // PAGO ERC20 (WETH, USDC, etc.)
            const tokenContract = new ethers.Contract(payToken.address, window.MARKET_ABIS.ERC20, signer);
            
            // 1. Verificar Allowance
            showToast(`Checking ${payToken.symbol} Allowance...`, "info");
            const allowance = await tokenContract.allowance(userAddress, marketAddress);
            
            if (allowance < totalPrice) {
                showToast(`Approving ${payToken.symbol}...`, "info");
                const txApprove = await tokenContract.approve(marketAddress, totalPrice);
                await txApprove.wait();
                showToast("Approved! Proceeding to buy...", "success");
            }

            // 2. Ejecutar Compra (Value 0 porque es ERC20 pull)
            const tx = await market.buyItem(colAddress, tokenId, amount);
            await waitForTx(tx, "Buy Successful!");
        }

        window.closeActionModal();
        refreshMarketData();

    } catch(e) {
        console.error(e);
        showToast(formatError(e), "error");
    }
};

// --- MODAL: VENTA ---
window.openSellModalManual = () => {
    if(!signer) return showToast("Connect Wallet First", "error");
    const id = getEl('sellIdInput').value;
    if(!id) return showToast("Enter a Token ID first", "error");
    
    const modal = getEl('actionModal');
    const content = getEl('modalContent');
    getEl('modalTitle').innerText = `List Token #${id}`;
    const currency = ACTIVE_MARKET_CONFIG.paymentToken.symbol;
    
    content.innerHTML = `
        <div class="input-group">
            <label>Price Per Unit (${currency})</label>
            <input type="number" id="sellPrice" class="input-std" placeholder="e.g. 10.5">
        </div>
        <div class="input-group">
            <label>Quantity to List</label>
            <input type="number" id="sellAmount" class="input-std" value="1" min="1">
            <small style="color:#666; margin-top:5px; display:block;">For ERC721, quantity is always 1.</small>
        </div>
        <button class="btn-primary" style="width:100%; margin-top:10px;" onclick="window.executeList('${id}')">List Item</button>
    `;
    modal.classList.add('open');
};

// --- EJECUCIÓN: LISTAR ---
window.executeList = async (tokenId) => {
    try {
        const priceInput = getEl('sellPrice').value;
        const amount = getEl('sellAmount').value;
        
        if(!priceInput || parseFloat(priceInput) <= 0) throw new Error("Invalid Price");
        if(!amount || parseInt(amount) <= 0) throw new Error("Invalid Amount");

        const priceWei = ethers.parseEther(priceInput);
        const colAddress = APP_STATE.currentCollection.address;
        const marketAddress = ACTIVE_MARKET_CONFIG.marketplaceAddress;

        // Instancias
        // Usamos ABI 721 o 1155 según config para el Approval
        const isERC1155 = APP_STATE.currentCollection.type === 'ERC1155';
        const nftAbi = isERC1155 ? window.MARKET_ABIS.ERC1155 : window.MARKET_ABIS.ERC721;
        const nft = new ethers.Contract(colAddress, nftAbi, signer);
        const market = new ethers.Contract(marketAddress, window.MARKET_ABIS.MARKET, signer);

        // 1. Check ApprovalForAll
        showToast("Checking NFT Approval...", "info");
        const isApproved = await nft.isApprovedForAll(userAddress, marketAddress);
        
        if(!isApproved) {
            showToast("Approving Marketplace...", "info");
            const txApprove = await nft.setApprovalForAll(marketAddress, true);
            await txApprove.wait();
            showToast("Approved! Listing item...", "success");
        }

        // 2. List Item
        showToast("Sending Listing Tx...", "info");
        const txList = await market.listItem(colAddress, tokenId, amount, priceWei);
        await waitForTx(txList, "Item Listed Successfully!");
        
        window.closeActionModal();
        getEl('sellIdInput').value = "";
        window.switchTab('selling'); // Ir a pestaña de ventas para ver el item
        refreshMarketData();

    } catch(e) {
        console.error(e);
        showToast(formatError(e), "error");
    }
};

// --- EJECUCIÓN: CANCELAR ---
window.cancelItem = async (tokenId) => {
    if(!confirm("Are you sure you want to remove this listing?")) return;
    try {
        const market = new ethers.Contract(ACTIVE_MARKET_CONFIG.marketplaceAddress, window.MARKET_ABIS.MARKET, signer);
        showToast("Canceling listing...", "info");
        
        const tx = await market.cancelListing(APP_STATE.currentCollection.address, tokenId);
        await waitForTx(tx, "Listing Canceled");
        
        refreshMarketData();
    } catch(e) { 
        showToast(formatError(e), "error"); 
    }
};

// =========================================================
// 7. GESTIÓN DE WALLET UNIFICADA (PRO LOGIC)
// =========================================================

// Event Listeners Botones
getEl("btnConnect").onclick = (e) => {
    e.stopPropagation();
    if(userAddress) {
        getEl("accountDropdown").classList.toggle("show");
    } else {
        window.openWalletModal();
    }
};

getEl("btnDisconnect").onclick = () => {
    if(window.SessionManager) window.SessionManager.clear();
    userAddress = null;
    signer = null;
    selectedProvider = null;
    updateStatus(false);
    getEl("accountDropdown").classList.remove("show");
    window.location.reload(); 
};

// Eventos de click global para cerrar modales
window.onclick = (e) => {
    const modal = getEl('walletModal');
    if (e.target === modal) window.closeWalletModal();
    const accountDropdown = getEl("accountDropdown");
    if (accountDropdown && accountDropdown.classList.contains('show') && !e.target.closest('#btnConnect')) {
         accountDropdown.classList.remove('show');
    }
};

// --- WALLET MODAL LOGIC (DINÁMICO) ---
window.openWalletModal = () => {
    const modal = getEl('walletModal');
    const list = getEl('walletList');
    if (!modal || !list) return;
    list.innerHTML = ''; 

    if (window.WALLET_CONFIG) {
        window.WALLET_CONFIG.forEach(w => {
            const isInstalled = w.check();
            const btn = document.createElement('div');
            btn.className = 'wallet-btn';
            btn.innerHTML = `
                <div class="wallet-info">
                    <img src="${w.icon}" alt="${w.name}" style="width:32px; height:32px; object-fit:contain;">
                    <span>${w.name}</span>
                </div>
                ${isInstalled ? '<span style="color:var(--success); font-size:1.2rem;">›</span>' : '<span class="wallet-badge">Install</span>'}
            `;
            
            btn.onclick = async () => {
                if(!isInstalled) { window.open(w.installUrl, '_blank'); return; }
                selectedProvider = w.getProvider();
                window.closeWalletModal();
                await connectWallet();
            };
            list.appendChild(btn);
        });
    }
    modal.classList.add('open');
};

window.closeWalletModal = () => getEl('walletModal').classList.remove('open');
window.closeActionModal = () => getEl('actionModal').classList.remove('open');

// --- CONNECT CORE LOGIC ---
window.connectWallet = async () => {
    // Usamos el provider seleccionado en el modal, o window.ethereum por defecto
    const ethProvider = selectedProvider || window.ethereum;
    if (!ethProvider) { alert("Wallet not found."); return; }
    
    getEl("btnConnect").textContent = "Connecting...";

    try {
        const tempProvider = new ethers.BrowserProvider(ethProvider);
        await tempProvider.send("eth_requestAccounts", []);
        const tempSigner = await tempProvider.getSigner();
        const address = await tempSigner.getAddress();
        
        // Guardar sesión si existe el manager (config.js)
        if(window.SessionManager) window.SessionManager.save();

        // Detectar Red y Cargar todo
        const chainIdHex = await tempProvider.send("eth_chainId", []);
        const chainId = parseInt(chainIdHex, 16).toString();

        // Verificar si la red está soportada en networks.json
        const isSupported = Object.values(NETWORKS_DATA).some(n => n.chainId == chainId);

        if (!isSupported) {
            console.log("Unsupported chain. Attempting switch...");
            // Intentar switch a la primera red disponible
            const defaultNet = Object.values(NETWORKS_DATA)[0];
            if(defaultNet) await switchNetworkWallet(defaultNet.chainId);
        } else {
            // Inicializar App con Wallet
            await handleNetworkChange(chainId, tempProvider, true);
        }

        // Listeners de cambios en Metamask
        if(ethProvider.on) {
            ethProvider.on('chainChanged', () => window.location.reload());
            ethProvider.on('accountsChanged', () => window.location.reload());
        }

    } catch(e) {
        console.error("Connection Error:", e);
        updateStatus(false);
        showToast("Connection failed", "error");
    }
};

// Helper para esperar TX y mostrar feedback
async function waitForTx(txObj, successMsg) {
    showToast("Transaction Sent. Waiting confirmation...", "info");
    await txObj.wait();
    showToast(successMsg, "success");
}

function formatError(e) {
    if (e.reason) return e.reason;
    if (e.message && e.message.includes("user rejected")) return "Transaction rejected by user.";
    return "Transaction Failed. Check console.";
}