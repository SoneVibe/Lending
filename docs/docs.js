/**
 * docs.js — SoneVibe Docs
 * Fills the documentation with live data: networks (networks.json), DEX contracts,
 * and factory admin roles. BNB Chain is the main chain. Arbitrum One also runs the DEX.
 * Also handles the side index (scrollspy, search, mobile menu) and copy buttons.
 */
(() => {
  'use strict';

  const FLAGSHIP = '56';
  const ORDER = ['56', '42161'];
  const NAMES = { '56': 'BNB Chain', '42161': 'Arbitrum One' };
  const ZERO = '0x0000000000000000000000000000000000000000';

  const ABI = {
    factory: ['function feeTo() view returns (address)', 'function feeToSetter() view returns (address)'],
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '') && a !== ZERO;
  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const safe = (p) => p.catch(() => null);

  function explorerLink(net, a, label) {
    const base = (net?.blockExplorerUrls?.[0] || '').replace(/\/$/, '');
    return `<span class="dc-addr"><a href="${esc(base)}/address/${esc(a)}" target="_blank" rel="noopener"><span class="full">${esc(label || a)}</span><span class="short">${esc(label || short(a))}</span> ↗</a><button type="button" class="dc-copy" data-copy="${esc(a)}" aria-label="Copy address">Copy</button></span>`;
  }

  const provider = (net) => new ethers.JsonRpcProvider(net.rpcUrls[0], undefined, { staticNetwork: true, batchMaxCount: 20 });

  function productsOf(net) {
    const out = [];
    if (isAddr(net.factory)) out.push('DEX');
    return out;
  }

  function renderNetworks(nets) {
    const rows = ORDER.filter((id) => nets[id]).map((id) => {
      const n = nets[id];
      const status = id === FLAGSHIP ? '<span class="tag ok">Mainnet · home</span>' : '<span class="tag ok">Mainnet</span>';
      const ex = (n.blockExplorerUrls?.[0] || '').replace(/\/$/, '');
      return `<tr><td><b>${esc(NAMES[id] || n.label)}</b></td><td class="num">${esc(id)}</td><td>${status}</td><td>${esc(productsOf(n).join(' · ') || '—')}</td><td>${ex ? `<a href="${esc(ex)}" target="_blank" rel="noopener">${esc(new URL(ex).host)} ↗</a>` : '—'}</td></tr>`;
    });
    $('netTable').tBodies[0].innerHTML = rows.join('');
  }

  const extra = {};

  function contractRows(net) {
    const rows = [];
    const add = (name, a) => { if (isAddr(a)) rows.push([name, a]); };
    add('DEX Factory', net.factory);
    add('DEX Router', net.router);
    add('Protocol treasury (feeTo)', extra[net.chainId]?.feeTo);
    return rows;
  }

  let ctActive = FLAGSHIP;
  function renderContracts(nets) {
    const ids = ORDER.filter((id) => nets[id]);
    if (!ids.includes(ctActive)) ctActive = ids[0];
    $('ctTabs').innerHTML = ids.map((id) => `<button type="button" role="tab" data-chain="${id}" aria-selected="${id === ctActive}">${esc(NAMES[id] || nets[id].label)}</button>`).join('');
    const net = nets[ctActive];
    const rows = contractRows(net);
    $('ctTable').tBodies[0].innerHTML = rows.length
      ? rows.map(([name, a]) => `<tr><td>${esc(name)}</td><td>${explorerLink(net, a)}</td></tr>`).join('')
      : '<tr><td colspan="2" class="muted">No contracts configured on this network.</td></tr>';
  }

  async function renderAdmin(nets) {
    const lines = [];
    const kinds = {};
    const classify = (code) => (code == null ? null : code === '0x' ? 'eoa' : code.toLowerCase().startsWith('0xef0100') ? 'eoa7702' : 'contract');
    const typeTag = (k) => (k === 'eoa' ? '<span class="tag eoa">Wallet (EOA)</span>'
      : k === 'eoa7702' ? '<span class="tag eoa" title="EOA with an EIP-7702 smart-account delegation; still controlled by one key">Wallet (EOA · 7702)</span>'
      : k === 'contract' ? '<span class="tag ctr">Contract</span>' : '<span class="muted">—</span>');

    const rows = await Promise.all(ORDER.filter((id) => nets[id] && isAddr(nets[id].factory)).map(async (id) => {
      const net = nets[id];
      try {
        const rpc = provider(net);
        const f = new ethers.Contract(net.factory, ABI.factory, rpc);
        const [setter, feeTo] = await Promise.all([safe(f.feeToSetter()), safe(f.feeTo())]);
        extra[id] = { ...(extra[id] || {}), feeTo };
        if (!isAddr(setter)) return '';
        const k = classify(await safe(rpc.getCode(setter)));
        kinds[setter] = k;
        return `<tr><td><b>DEX fee setter (Factory)</b><br><span class="muted">${esc(NAMES[id])}</span></td><td>${explorerLink(net, setter, short(setter))}</td><td>${typeTag(k)}</td><td>Chooses the treasury address for the 1/6 protocol fee, and can open or close pair creation.</td></tr>`;
      } catch (e) { return ''; }
    }));
    lines.push(...rows.filter(Boolean));
    $('adminTable').tBodies[0].innerHTML = lines.join('') || '<tr><td colspan="4" class="muted">Could not read admin roles right now.</td></tr>';

    const eoa = Object.values(kinds).some((k) => k === 'eoa' || k === 'eoa7702');
    if (eoa && !$('adminNote')) {
      $('adminTable').closest('.dc-table-wrap').insertAdjacentHTML('afterend',
        '<div class="dc-note warn" id="adminNote">Some admin roles are held by a single wallet (EOA), with no timelock, so changes take effect immediately. This table is read from the contracts and updates automatically if roles move to a multisig or timelock.</div>');
    }
  }

  function initToc() {
    const links = [...document.querySelectorAll('#toc a')];
    const byId = Object.fromEntries(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const sections = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
    const setActive = (id) => links.forEach((a) => a.classList.toggle('on', a === byId[id]));
    const onScroll = () => {
      let current = sections[0]?.id;
      for (const s of sections) if (s.getBoundingClientRect().top < 140) current = s.id;
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) current = sections[sections.length - 1].id;
      setActive(current);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const search = $('tocSearch');
    const text = Object.fromEntries(sections.map((s) => [s.id, s.textContent.toLowerCase()]));
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      links.forEach((a) => {
        const id = a.getAttribute('href').slice(1);
        const hit = !q || a.textContent.toLowerCase().includes(q) || (text[id] || '').includes(q);
        a.hidden = !hit;
        if (hit) shown++;
      });
      document.querySelectorAll('.dc-toc-group').forEach((g) => { g.hidden = !!q; });
      $('tocEmpty').hidden = shown > 0;
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = links.find((a) => !a.hidden); if (first) { first.click(); search.blur(); } }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== search && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); openToc(true); search.focus(); }
      if (e.key === 'Escape') openToc(false);
    });

    const toggle = $('tocToggle');
    const openToc = (open) => {
      if (window.innerWidth > 960) return;
      document.body.classList.toggle('toc-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Close ✕' : 'Contents ☰';
    };
    toggle.addEventListener('click', () => openToc(!document.body.classList.contains('toc-open')));
    links.forEach((a) => a.addEventListener('click', () => openToc(false)));
  }

  function initCopy() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-copy]');
      if (!b) return;
      navigator.clipboard.writeText(b.dataset.copy);
      b.textContent = 'Copied';
      setTimeout(() => { b.textContent = 'Copy'; }, 1400);
    });
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('#ctTabs [data-chain]');
      if (!tab) return;
      ctActive = tab.dataset.chain;
      renderContracts(state.nets);
    });
  }

  const state = { nets: {} };

  document.addEventListener('DOMContentLoaded', async () => {
    $('year').textContent = new Date().getFullYear();
    initToc();
    initCopy();
    try {
      const all = await window.loadNetworks();
      Object.values(all).forEach((n) => { if (n.enabled && ORDER.includes(n.chainId)) state.nets[n.chainId] = n; });
      renderNetworks(state.nets);
      renderContracts(state.nets);
      await renderAdmin(state.nets);
      renderContracts(state.nets);
      $('docUpdated').textContent = `Read from chain at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (e) {
      console.error('[docs] live data failed', e);
      $('docUpdated').textContent = 'Live values unavailable right now';
    }
    document.querySelectorAll('.lv.loading').forEach((el) => { el.classList.remove('loading'); el.textContent = '—'; });
  });
})();
