// Shared app navigation: mobile drawer for nav.sidebar (≤900px) and "More" group state.
(function () {
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
    '<a class="mobile-bar-brand" href="index.html"><img src="icons/vibe.svg" alt="" width="28" height="28"> SoneVibe</a>' +
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
})();
