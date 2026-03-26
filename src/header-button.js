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
  let _nameCache;

  function _loadNameCache() {
    _nameCache = new Map();
    try {
      const raw = GM_getValue('nameCache', '{}');
      const obj = JSON.parse(raw);
      for (const [k, v] of Object.entries(obj)) {
        _nameCache.set(Number(k), v);
      }
    } catch { /* corrupt data — start fresh */ }
  }
  _loadNameCache();

  function _saveNameCache() {
    const obj = {};
    for (const [k, v] of _nameCache) obj[k] = v;
    GM_setValue('nameCache', JSON.stringify(obj));
  }

  function findAccountSection() {
    const accountLink = document.querySelector('header a[href="/account"]');
    if (!accountLink) return null;
    const header = document.querySelector('header');
    if (!header) return null;
    // Walk up from the account link to find the direct child of <header>
    let el = accountLink;
    while (el.parentElement && el.parentElement !== header) {
      el = el.parentElement;
    }
    return el.parentElement === header ? el : null;
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

  async function fetchItemNames(itemIds) {
    const uncached = itemIds.filter(id => !_nameCache.has(id));
    if (uncached.length) {
      const results = await Promise.allSettled(
        uncached.map(id =>
          fetch(`/market/${id}`).then(res => res.ok ? res.text() : null)
        )
      );
      let added = false;
      results.forEach((result, i) => {
        if (result.status !== 'fulfilled' || !result.value) return;
        const doc = new DOMParser().parseFromString(result.value, 'text/html');
        const h1 = doc.querySelector('h1');
        if (h1) {
          const name = h1.textContent.trim().replace(/^\d+\s+/, '');
          if (name) { _nameCache.set(uncached[i], name); added = true; }
        }
      });
      if (added) _saveNameCache();
    }
    const map = new Map();
    for (const id of itemIds) {
      if (_nameCache.has(id)) map.set(id, _nameCache.get(id));
    }
    return map;
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

    let allAlerts;
    try {
      allAlerts = await _API().getAlerts();
    } catch {
      const errorEl = document.createElement('div');
      errorEl.id = 'univ-alert-error';
      errorEl.style.cssText = 'color:#ff6b6b;font-size:13px;margin-top:4px';
      errorEl.textContent = 'Failed to load alerts \u2014 check your connection';
      const btn = document.getElementById('univ-alert-btn');
      if (btn) btn.insertAdjacentElement('afterend', errorEl);
      return;
    }

    const { currentItemId, currentItemName } = detectPageContext();

    const uniqueItemIds = [...new Set(allAlerts.map(a => a.itemId))];
    const nameMap = await fetchItemNames(uniqueItemIds);

    // Seed the current page's item name so the list view can display it
    // even before any alerts exist for this item (avoids "Item #..." fallback)
    if (currentItemId && currentItemName && !nameMap.has(currentItemId)) {
      const stripped = currentItemName.replace(/^\d+\s+/, '');
      if (stripped) {
        nameMap.set(currentItemId, stripped);
        _nameCache.set(currentItemId, stripped);
        _saveNameCache();
      }
    }

    const groups = _Grouping().groupAlerts(allAlerts);
    groups.forEach(g => {
      g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap().worldById(w.worldId)?.worldName || '' }));
    });

    _Modal().openBulkModal({ groups, nameMap, currentItemId, currentItemName, alertCount: allAlerts.length });
  }

  function init() {
    injectButton();
    if (_initObserver) return; // already watching
    _initObserver = new MutationObserver(() => {
      try { injectButton(); } catch (_) { /* DOM torn down */ }
    });
    _initObserver.observe(document.body, { childList: true, subtree: true });
  }

  return { init, injectButton, handleClick, _resetNameCache: _loadNameCache };
})();

if (typeof module !== 'undefined') module.exports = HeaderButton;
