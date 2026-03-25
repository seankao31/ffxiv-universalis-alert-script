const MarketPage = (() => {
  const _apiModule = typeof module !== 'undefined' ? require('./api') : null;
  const _modalModule = typeof module !== 'undefined' ? require('./modal') : null;
  const _groupingModule = typeof module !== 'undefined' ? require('./grouping') : null;
  const _worldMapModule = typeof module !== 'undefined' ? require('./worldmap') : null;

  function _API() { return typeof API !== 'undefined' ? API : _apiModule; }
  function _Modal() { return typeof Modal !== 'undefined' ? Modal : _modalModule; }
  function _Grouping() { return typeof Grouping !== 'undefined' ? Grouping : _groupingModule; }
  function _WorldMap() { return typeof WorldMap !== 'undefined' ? WorldMap : _worldMapModule; }

  function findButtonBar() {
    return document.querySelector('.box_flex.form');
  }

  function readItemName() {
    const heading = document.querySelector('h1');
    return heading ? heading.textContent.trim() : '';
  }

  function injectMarketButton(itemId) {
    if (document.getElementById('univ-alert-btn')) return; // idempotent

    const btn = document.createElement('button');
    btn.id = 'univ-alert-btn';
    btn.textContent = '🔔 Bulk Alerts';
    btn.style.cssText = 'background:#1a5a8a;border:none;color:#fff;padding:8px 16px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;margin-left:8px';

    btn.addEventListener('click', () => handleAlertButtonClick(itemId, readItemName()));

    const bar = findButtonBar();
    if (bar) {
      bar.appendChild(btn);
    } else {
      document.body.appendChild(btn);
    }
  }

  async function handleAlertButtonClick(itemId, itemName) {
    let allAlerts;
    try {
      allAlerts = await _API().getAlerts();
    } catch (err) {
      // Show inline error — modal not opened
      const errorEl = document.getElementById('univ-alert-error') || document.createElement('div');
      errorEl.id = 'univ-alert-error';
      errorEl.style.cssText = 'color:#ff6b6b;font-size:13px;margin-top:4px';
      errorEl.textContent = 'Failed to load existing alerts — check your connection';
      const btn = document.getElementById('univ-alert-btn');
      if (btn) btn.insertAdjacentElement('afterend', errorEl);
      return;
    }

    const itemAlerts = allAlerts.filter(a => a.itemId === itemId);
    const groups = _Grouping().groupAlerts(itemAlerts);
    groups.forEach(g => {
      g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap().worldById(w.worldId)?.worldName || '' }));
    });

    _Modal().openBulkModal({ itemId, itemName, groups });
  }

  function init() {
    function attempt() {
      if (!findButtonBar()) return false;
      const pathParts = window.location.pathname.split('/');
      if (pathParts.length !== 3) return true; // not a /market/{id} page, but done waiting
      const itemId = Number(pathParts[2]);
      if (itemId > 0) injectMarketButton(itemId);
      return true;
    }

    if (attempt()) return; // h1 already present (SSR/CSR already rendered)

    // h1 not yet in DOM — observe for it (SPA navigation case)
    const observer = new MutationObserver(() => {
      if (attempt()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  return { init, injectMarketButton, handleAlertButtonClick };
})();

if (typeof module !== 'undefined') module.exports = MarketPage;
