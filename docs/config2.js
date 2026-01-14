// CONFIG ESTABLE + SESSION MANAGER PRO
(function() {
  // --- Lógica de Datos ---
  function loadNetworks() {
    return fetch('./networks2.json').then(r => {
      if (!r.ok) throw new Error('No se pudo cargar networks.json');
      return r.json();
    });
  }

  function getActiveNetworkByChainId(data, chainIdHex) {
    return Object.values(data).find(n => parseInt(n.chainId) === parseInt(chainIdHex) && n.enabled);
  }

  // --- SESSION MANAGER PRO (Persistencia) ---
  const SESSION_KEY = "VIBE_SESSION_ACTIVE";
  
  const SessionManager = {
    save: () => localStorage.setItem(SESSION_KEY, "true"),
    clear: () => localStorage.removeItem(SESSION_KEY),
    isActive: () => localStorage.getItem(SESSION_KEY) === "true"
  };

  // --- AUTO CONNECT LOGIC (Inteligencia entre páginas) ---
  async function checkAutoConnect(connectCallback) {
    // 1. Si el usuario no estaba conectado previamente, no hacemos nada (evita popups molestos)
    if (!SessionManager.isActive()) return;

    // 2. Verificamos si el navegador tiene provider
    if (!window.ethereum) return;

    try {
        // 3. Preguntamos silenciosamente si ya tenemos permisos
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts && accounts.length > 0) {
            console.log("Session restored. Auto-connecting...");
            await connectCallback(); // Ejecuta la conexión sin popup
        } else {
            // Si metamask está bloqueado o desconectado, limpiamos la sesión local
            SessionManager.clear();
        }
    } catch (e) {
        console.error("Auto-connect check failed", e);
    }
  }

  // --- Lógica UI Pro Switcher ---
  async function setupNetworkSwitcher(networksData, currentChainIdDecimal) {
    const btn = document.getElementById('networkTrigger');
    const dropdown = document.getElementById('networkDropdown');
    const label = document.getElementById('networkLabel');
    
    if(!btn || !dropdown) return; 

    const current = Object.values(networksData).find(n => parseInt(n.chainId) === currentChainIdDecimal);
    
    if (current) {
      label.textContent = current.label;
    } else {
      label.textContent = "Wrong Network";
      label.style.color = "var(--danger)";
    }

    dropdown.innerHTML = '';
    Object.values(networksData).filter(n => n.enabled).forEach(n => {
      const item = document.createElement('div');
      item.className = 'network-item';
      const isActive = parseInt(n.chainId) === currentChainIdDecimal;
      
      item.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
           <div style="width:8px; height:8px; border-radius:50%; background:${isActive ? 'var(--success)' : '#555'}"></div>
           ${n.label}
        </div>
        ${isActive ? '<span style="color:var(--success); font-size:0.8em;">●</span>' : ''}
      `;
      
      item.onclick = async () => {
        dropdown.classList.remove('show');
        await switchNetwork(n);
      };
      dropdown.appendChild(item);
    });

    btn.onclick = (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('show');
    };
    
    window.onclick = () => {
      if (dropdown.classList.contains('show')) dropdown.classList.remove('show');
    };
  }

  async function switchNetwork(networkData) {
    if(!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: "0x" + Number(networkData.chainId).toString(16) }],
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: "0x" + Number(networkData.chainId).toString(16),
              chainName: networkData.label,
              rpcUrls: networkData.rpcUrls,
              blockExplorerUrls: networkData.blockExplorerUrls,
              nativeCurrency: networkData.nativeCurrency
            }],
          });
        } catch (addError) { console.error(addError); }
      }
    }
  }

  // Exponer en window
  window.loadNetworks = loadNetworks;
  window.getActiveNetworkByChainId = getActiveNetworkByChainId;
  window.setupNetworkSwitcher = setupNetworkSwitcher;
  window.SessionManager = SessionManager;
  window.checkAutoConnect = checkAutoConnect;
})();
