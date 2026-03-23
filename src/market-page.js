const MarketPage = (() => {
  const _apiModule = typeof module !== 'undefined' ? require('./api') : null;
  const _modalModule = typeof module !== 'undefined' ? require('./modal') : null;
  const _groupingModule = typeof module !== 'undefined' ? require('./grouping') : null;
  const _saveOpsModule = typeof module !== 'undefined' ? require('./save-ops') : null;
  const _worldMapModule = typeof module !== 'undefined' ? require('./worldmap') : null;

  function _API() { return typeof API !== 'undefined' ? API : _apiModule; }
  function _Modal() { return typeof Modal !== 'undefined' ? Modal : _modalModule; }
  function _Grouping() { return typeof Grouping !== 'undefined' ? Grouping : _groupingModule; }
  function _SaveOps() { return typeof SaveOps !== 'undefined' ? SaveOps : _saveOpsModule; }
  function _WorldMap() { return typeof WorldMap !== 'undefined' ? WorldMap : _worldMapModule; }

  function findNativeAlertsButton() {
    const byText = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Alerts'));
    return byText || null;
  }

  function readItemName() {
    const heading = document.querySelector('h1');
    return heading ? heading.textContent.trim() : '';
  }

  function injectMarketButton(itemId) {
    if (document.getElementById('univ-alert-btn')) return; // idempotent

    const native = findNativeAlertsButton();
    if (native) native.style.display = 'none';

    const btn = document.createElement('button');
    btn.id = 'univ-alert-btn';
    btn.textContent = '🔔 Set Alerts';
    btn.style.cssText = 'background:#1a5a8a;border:none;color:#fff;padding:8px 16px;border-radius:4px;cursor:pointer';

    btn.addEventListener('click', () => handleAlertButtonClick(itemId, readItemName()));

    const insertAfter = native || document.querySelector('button');
    if (insertAfter) {
      insertAfter.insertAdjacentElement('afterend', btn);
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

    // Enrich worlds with worldName
    groups.forEach(g => {
      g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap().worldById(w.worldId)?.worldName || '' }));
    });

    const group = groups[0] || null;
    const multipleGroups = groups.length > 1;

    _Modal().openModal({
      itemId,
      itemName,
      group,
      multipleGroups,
      onSave: async (formState) => {
        const ops = _SaveOps().computeSaveOps(group, formState, _WorldMap().WORLDS);
        await _SaveOps().executeSaveOps(ops, itemId, formState);
      },
    });
  }

  function init() {
    // Wait for item name heading (React render signal)
    const observer = new MutationObserver(() => {
      if (document.querySelector('h1')) {
        observer.disconnect();
        const pathParts = window.location.pathname.split('/');
        if (pathParts.length !== 3) return; // guard: only /market/{id}
        const itemId = Number(pathParts[2]);
        if (!isNaN(itemId)) injectMarketButton(itemId);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  return { init, injectMarketButton, handleAlertButtonClick };
})();

if (typeof module !== 'undefined') module.exports = MarketPage;
