// CONFIG ESTABLE – define funciones y las expone en window SIN usar const para evitar redeclaración global.
(function() {
  function loadNetworks() {
    return fetch('./networks.json').then(r => {
      if (!r.ok) throw new Error('No se pudo cargar networks.json');
      return r.json();
    });
  }

  function getActiveNetworkByChainId(data, chainIdHex) {
    return Object.values(data).find(n => n.chainId.toLowerCase() === chainIdHex.toLowerCase() && n.enabled);
  }

  function getNetworkBySlug(data, slug) {
    return Object.values(data).find(n => n.slug === slug && n.enabled);
  }

  function listEnabledNetworks(data) {
    return Object.values(data).filter(n => n.enabled);
  }

  // Exponer en window
  window.loadNetworks = loadNetworks;
  window.getActiveNetworkByChainId = getActiveNetworkByChainId;
  window.getNetworkBySlug = getNetworkBySlug;
  window.listEnabledNetworks = listEnabledNetworks;
})();
