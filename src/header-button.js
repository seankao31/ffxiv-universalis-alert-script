const HeaderButton = (() => {
  const _apiModule = typeof module !== 'undefined' ? require('./api') : null;
  const _modalModule = typeof module !== 'undefined' ? require('./modal') : null;
  const _groupingModule = typeof module !== 'undefined' ? require('./grouping') : null;
  const _worldMapModule = typeof module !== 'undefined' ? require('./worldmap') : null;

  function _API() { return typeof API !== 'undefined' ? API : _apiModule; }
  function _Modal() { return typeof Modal !== 'undefined' ? Modal : _modalModule; }
  function _Grouping() { return typeof Grouping !== 'undefined' ? Grouping : _groupingModule; }
  function _WorldMap() { return typeof WorldMap !== 'undefined' ? WorldMap : _worldMapModule; }

  let _initObserver = null;

  function findAccountSection() {
    const accountLink = document.querySelector('header a[href="/account"]');
    if (!accountLink) return null;
    const headerWrapper = document.querySelector('header > div');
    if (!headerWrapper) return null;
    // Walk up from the account link to find the direct child of the header wrapper
    let el = accountLink;
    while (el.parentElement && el.parentElement !== headerWrapper) {
      el = el.parentElement;
    }
    return el.parentElement === headerWrapper ? el : null;
  }

  function injectButton() {
    if (document.getElementById('univ-alert-btn')) return;
    const section = findAccountSection();
    if (!section) return;

    const btn = document.createElement('button');
    btn.id = 'univ-alert-btn';
    btn.textContent = '\uD83D\uDD14 Bulk Alerts';
    btn.style.cssText = 'background:#1a5a8a;border:none;color:#fff;padding:8px 16px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;margin-right:8px';
    btn.addEventListener('click', () => handleClick());
    section.insertBefore(btn, section.firstChild);
  }

  async function fetchItemNames() {
    try {
      const res = await fetch('/account/alerts');
      if (!res.ok) return new Map();
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const map = new Map();
      doc.querySelectorAll('a[href^="/market/"]').forEach(a => {
        const parts = a.getAttribute('href').split('/');
        const itemId = Number(parts[2]);
        if (!isNaN(itemId)) map.set(itemId, a.textContent.trim());
      });
      return map;
    } catch {
      return new Map();
    }
  }

  function detectPageContext() {
    const parts = window.location.pathname.split('/');
    if (parts.length === 3 && parts[1] === 'market') {
      const itemId = Number(parts[2]);
      if (itemId > 0) {
        const h1 = document.querySelector('h1');
        const itemName = h1 ? h1.textContent.trim() : '';
        return { currentItemId: itemId, currentItemName: itemName };
      }
    }
    return { currentItemId: null, currentItemName: null };
  }

  async function handleClick() {
    // Clear previous error
    const prevError = document.getElementById('univ-alert-error');
    if (prevError) prevError.remove();

    const results = await Promise.allSettled([
      _API().getAlerts(),
      fetchItemNames(),
    ]);

    const alertsResult = results[0];
    const namesResult = results[1];

    if (alertsResult.status === 'rejected') {
      const errorEl = document.createElement('div');
      errorEl.id = 'univ-alert-error';
      errorEl.style.cssText = 'color:#ff6b6b;font-size:13px;margin-top:4px';
      errorEl.textContent = 'Failed to load alerts \u2014 check your connection';
      const btn = document.getElementById('univ-alert-btn');
      if (btn) btn.insertAdjacentElement('afterend', errorEl);
      return;
    }

    const allAlerts = alertsResult.value;
    const nameMap = namesResult.status === 'fulfilled' ? namesResult.value : new Map();

    const groups = _Grouping().groupAlerts(allAlerts);
    groups.forEach(g => {
      g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap().worldById(w.worldId)?.worldName || '' }));
    });

    const { currentItemId, currentItemName } = detectPageContext();
    _Modal().openBulkModal({ groups, nameMap, currentItemId, currentItemName });
  }

  function init() {
    if (findAccountSection()) {
      injectButton();
      return;
    }
    if (_initObserver) return; // already watching
    _initObserver = new MutationObserver(() => {
      if (findAccountSection()) {
        _initObserver.disconnect();
        _initObserver = null;
        injectButton();
      }
    });
    _initObserver.observe(document.body, { childList: true, subtree: true });
  }

  return { init, injectButton, handleClick };
})();

if (typeof module !== 'undefined') module.exports = HeaderButton;
