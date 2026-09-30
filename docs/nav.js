// Shared SoneVibe navigation:
//  1. App pages: mobile drawer for nav.sidebar (≤900px) and "More" group state.
//  2. Landing / Docs / Portal: mobile menu for the top bar when its links are hidden.
(function () {
  const SITE_LINKS = [
    ['index.html', 'Home'], ['swap.html', 'Swap'], ['pools.html', 'Liquidity Pools'], ['dashboard.html', 'Lend / Borrow'],
    ['portal.html', 'Portal'], ['analytics.html', 'Analytics'], ['marketplace.html', 'NFT Market'], ['docs.html', 'Docs'],
  ];
  const SITE_MORE = [
    ['markets.html', 'Markets Overview'], ['mint-svusd.html', 'Mint SVUSD'], ['swapstabilizer.html', 'Peg Stabilizer'],
    ['vibe-vault.html', 'Governance Vault'], ['farm.html', 'Yield Farms'], ['souschef.html', 'Sous Chef Pools'], ['SonevibeAI.html', 'VIBE AI'],
  ];
  const here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  function initSidebar() {
    const sidebar = document.querySelector('nav.sidebar');
    if (!sidebar) return;

    const more = sidebar.querySelector('details.nav-more');
    if (more && more.querySelector('.nav-link.active')) more.open = true;

    // SonevibeAI.html ships its own drawer (#mobileMenuBtn).
    if (document.getElementById('mobileMenuBtn')) return;

    if (!sidebar.id) sidebar.id = 'appSidebar';
    const main = document.querySelector('.main-content');
    if (!main) return;

    const bar = document.createElement('div');
    bar.className = 'mobile-bar';
    bar.innerHTML =
      '<a class="mobile-bar-brand" href="index.html" aria-label="SoneVibe home"><img src="icons/vibe.svg" alt="" width="28" height="28"> SoneVibe</a>' +
      '<button type="button" class="nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="' + sidebar.id + '">' +
      '<span></span><span></span><span></span></button>';
    main.insertBefore(bar, main.firstChild);

    const backdrop = document.createElement('div');
    backdrop.className = 'nav-backdrop';
    backdrop.hidden = true;
    document.body.appendChild(backdrop);

    const toggle = bar.querySelector('.nav-toggle');
    const mq = window.matchMedia('(max-width: 900px)');

    function setOpen(open) {
      sidebar.classList.toggle('is-open', open);
      document.body.classList.toggle('nav-open', open);
      backdrop.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (open) {
        const first = sidebar.querySelector('.nav-link');
        if (first) requestAnimationFrame(() => first.focus());
      }
    }

    toggle.addEventListener('click', () => setOpen(!sidebar.classList.contains('is-open')));
    backdrop.addEventListener('click', () => setOpen(false));
    sidebar.addEventListener('click', (e) => { if (e.target.closest('a') && mq.matches) setOpen(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('is-open')) { setOpen(false); toggle.focus(); }
    });
    mq.addEventListener('change', (e) => { if (!e.matches) setOpen(false); });
  }

  function initTopMenu() {
    const pairs = [['.lp-nav', '.lp-links'], ['.dc-nav', '.dc-links'], ['.pt-nav', '.pt-links']];
    const found = pairs.map(([n, l]) => [document.querySelector(n), document.querySelector(l)]).find(([n, l]) => n && l);
    if (!found) return;
    const [nav, links] = found;
    const wrap = links.parentElement;

    const item = ([href, label]) =>
      '<a href="' + href + '"' + (href.toLowerCase() === here ? ' aria-current="page"' : '') + '>' + label + '</a>';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'site-menu-btn';
    btn.setAttribute('aria-label', 'Open menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'siteMenu');
    btn.innerHTML = '<span></span><span></span><span></span>';
    wrap.appendChild(btn);

    const panel = document.createElement('div');
    panel.id = 'siteMenu';
    panel.className = 'site-menu';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="site-menu-grid">' + SITE_LINKS.map(item).join('') + '</div>' +
      '<div class="site-menu-label">More</div>' +
      '<div class="site-menu-grid">' + SITE_MORE.map(item).join('') + '</div>' +
      '<a class="site-menu-cta" href="swap.html">Launch App</a>';
    nav.appendChild(panel);

    function setOpen(open) {
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (open) requestAnimationFrame(() => { const a = panel.querySelector('a'); if (a) a.focus(); });
    }
    function sync() {
      const collapsed = getComputedStyle(links).display === 'none';
      btn.hidden = !collapsed;
      if (!collapsed) setOpen(false);
    }

    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(panel.hidden); });
    panel.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('click', (e) => { if (!panel.hidden && !nav.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); } });
    window.addEventListener('resize', sync);
    sync();
  }

  initSidebar();
  initTopMenu();
})();
