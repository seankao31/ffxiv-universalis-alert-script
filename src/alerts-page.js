const AlertsPage = (() => {
  const _API = () => (typeof API !== 'undefined' ? API : require('./api'));
  const _Modal = () => (typeof Modal !== 'undefined' ? Modal : require('./modal'));
  const _Grouping = () => (typeof Grouping !== 'undefined' ? Grouping : require('./grouping'));
  const _SaveOps = () => (typeof SaveOps !== 'undefined' ? SaveOps : require('./save-ops'));
  const _WorldMap = () => (typeof WorldMap !== 'undefined' ? WorldMap : require('./worldmap'));

  function scrapeItemNames() {
    const map = new Map();
    document.querySelectorAll('a[href^="/market/"]').forEach(a => {
      const parts = a.getAttribute('href').split('/');
      const itemId = Number(parts[2]);
      if (!isNaN(itemId)) map.set(itemId, a.textContent.trim());
    });
    return map;
  }

  function formatRule(trigger) {
    const comparator = 'lt' in trigger.comparison ? '<' : '>';
    const target = trigger.comparison[Object.keys(trigger.comparison)[0]].target;
    const metricLabels = { pricePerUnit: 'Min price', quantity: 'Quantity', total: 'Total' };
    const reducerLabels = { min: 'Min', max: 'Max', mean: 'Avg' };
    const label = `${reducerLabels[trigger.reducer] || trigger.reducer} ${metricLabels[trigger.mapper] || trigger.mapper} ${comparator} ${target}`;
    return trigger.filters.includes('hq') ? `${label} <span style="background:#4a8a4a;border-radius:3px;padding:0 4px;font-size:11px">HQ</span>` : label;
  }

  function renderAlertsPanel(alerts, nameMap) {
    // Remove stale panel if present
    const existing = document.getElementById('univ-alert-panel');
    if (existing) existing.remove();

    const groups = _Grouping().groupAlerts(alerts);
    // Enrich groups with worldName
    groups.forEach(g => {
      g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap().worldById(w.worldId)?.worldName || '' }));
    });

    const panel = document.createElement('div');
    panel.id = 'univ-alert-panel';
    panel.style.cssText = 'color:#fff;font-family:sans-serif;padding:16px';

    const rows = groups.map((g, idx) => {
      const itemName = nameMap.has(g.itemId) ? nameMap.get(g.itemId) : `Item #${g.itemId}`;
      const worldPills = g.worlds.map(w => `<span style="background:#1a3a5c;border-radius:12px;padding:2px 8px;font-size:12px;margin:2px">${w.worldName || w.worldId}</span>`).join('');
      return `
        <tr data-group-row="${idx}" style="border-bottom:1px solid #333">
          <td style="padding:10px 8px">${itemName}<br/><span style="font-size:11px;color:#888">#${g.itemId}</span></td>
          <td style="padding:10px 8px">${formatRule(g.trigger)}</td>
          <td style="padding:10px 8px">${worldPills}</td>
          <td style="padding:10px 8px;white-space:nowrap">
            <button data-action="edit" data-group-idx="${idx}" style="background:#1a4a7a;border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;margin-right:6px">Edit</button>
            <button data-action="delete" data-group-idx="${idx}" style="background:#6a1a1a;border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer">Delete</button>
          </td>
        </tr>`;
    }).join('');

    panel.innerHTML = `
      <h2 style="margin:0 0 16px">Alerts Manager</h2>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid #555;font-size:13px;color:#aaa">
            <th style="text-align:left;padding:8px">Item</th>
            <th style="text-align:left;padding:8px">Rule</th>
            <th style="text-align:left;padding:8px">Worlds</th>
            <th style="text-align:left;padding:8px">Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    // Event delegation for Edit / Delete
    panel.querySelector('tbody').addEventListener('click', async (e) => {
      const action = e.target.dataset.action;
      const idx = Number(e.target.dataset.groupIdx);
      const group = groups[idx];
      if (!group) return;

      if (action === 'delete') {
        e.target.disabled = true;
        await deleteGroup(group);
        e.target.closest('tr').remove();
      } else if (action === 'edit') {
        // Re-fetch to get fresh state
        let freshAlerts;
        try {
          freshAlerts = await _API().getAlerts();
        } catch {
          alert('Failed to load alerts — check your connection');
          return;
        }
        const freshItemAlerts = freshAlerts.filter(a => a.itemId === group.itemId);
        const freshGroups = _Grouping().groupAlerts(freshItemAlerts);
        freshGroups.forEach(g => {
          g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap().worldById(w.worldId)?.worldName || '' }));
        });
        // Find the matching group by trigger
        const { normalizeTrigger } = _Grouping();
        const targetKey = normalizeTrigger(group.trigger);
        const freshGroup = freshGroups.find(g => normalizeTrigger(g.trigger) === targetKey) || null;
        const itemName = nameMap.get(group.itemId) || `Item #${group.itemId}`;

        _Modal().openModal({
          itemId: group.itemId,
          itemName,
          group: freshGroup,
          multipleGroups: false,
          onSave: async (formState) => {
            const ops = _SaveOps().computeSaveOps(freshGroup, formState, _WorldMap().WORLDS);
            await _SaveOps().executeSaveOps(ops, group.itemId, formState);
            // Refresh panel after save
            const updatedAlerts = await _API().getAlerts();
            const updatedNames = scrapeItemNames();
            // Merge in persisted nameMap entries (native DOM may be hidden)
            nameMap.forEach((v, k) => { if (!updatedNames.has(k)) updatedNames.set(k, v); });
            renderAlertsPanel(updatedAlerts, updatedNames);
          },
        });
      }
    });

    // Inject panel at top of body
    document.body.prepend(panel);
  }

  async function deleteGroup(group) {
    await Promise.all(group.worlds.map(w => _API().deleteAlert(w.alertId)));
  }

  function init() {
    // Remove stale panel if user re-navigated
    const stale = document.getElementById('univ-alert-panel');
    if (stale) stale.remove();

    const TIMEOUT_MS = 10000;
    const startedAt = Date.now();

    const observer = new MutationObserver(async () => {
      if (!document.querySelector('a[href^="/market/"]')) {
        if (Date.now() - startedAt > TIMEOUT_MS) {
          observer.disconnect(); // no alerts — leave native page intact
        }
        return;
      }
      observer.disconnect();

      const nameMap = scrapeItemNames();

      // Hide native content
      document.querySelectorAll('body > *:not(#univ-alert-panel)').forEach(el => {
        if (el.tagName !== 'SCRIPT' && el.id !== 'univ-alert-panel') el.style.display = 'none';
      });

      let alerts;
      try {
        alerts = await _API().getAlerts();
      } catch {
        await handleInitError();
        // Restore native content
        document.querySelectorAll('body > *:not(#univ-alert-panel)').forEach(el => { el.style.display = ''; });
        return;
      }

      renderAlertsPanel(alerts, nameMap);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Exported so it can be tested directly without triggering MutationObserver
  async function handleInitError() {
    const errorEl = document.createElement('div');
    errorEl.dataset.initError = '';
    errorEl.style.cssText = 'color:#ff6b6b;padding:24px;font-size:16px;width:100%';
    errorEl.textContent = 'Failed to load existing alerts — check your connection';
    document.body.prepend(errorEl);
  }

  return { init, scrapeItemNames, renderAlertsPanel, deleteGroup, handleInitError };
})();

if (typeof module !== 'undefined') module.exports = AlertsPage;
