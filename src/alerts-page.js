const AlertsPage = (() => {
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

  function scrapeItemNames() {
    const map = new Map();
    document.querySelectorAll('a[href^="/market/"]').forEach(a => {
      const parts = a.getAttribute('href').split('/');
      const itemId = Number(parts[2]);
      if (!isNaN(itemId)) map.set(itemId, a.textContent.trim());
    });
    return map;
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

  function formatRule(trigger) {
    const comparator = 'lt' in trigger.comparison ? '<' : '>';
    const target = trigger.comparison[Object.keys(trigger.comparison)[0]].target;
    const metricLabels = { pricePerUnit: 'Min price', quantity: 'Quantity', total: 'Total' };
    const reducerLabels = { min: 'Min', max: 'Max', mean: 'Avg' };
    const label = `${reducerLabels[trigger.reducer] || trigger.reducer} ${metricLabels[trigger.mapper] || trigger.mapper} ${comparator} ${target}`;
    return trigger.filters.includes('hq') ? `${label} <span style="background:#4a8a4a;border-radius:3px;padding:0 4px;font-size:11px">HQ</span>` : label;
  }

  function renderAlertsPanel(alerts, nameMap, container) {
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
            <button data-action="edit" data-group-idx="${idx}" style="background:#1a4a7a;border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;margin-right:6px;display:inline-flex;align-items:center;justify-content:center">Edit</button>
            <button data-action="delete" data-group-idx="${idx}" style="background:#6a1a1a;border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">Delete</button>
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
        e.target.textContent = 'Queued\u2026';
        e.target.style.opacity = '0.7';
        const { failures } = await deleteGroup(group, ({ completed, total }) => {
          e.target.textContent = `Deleting ${completed}/${total}...`;
          e.target.style.opacity = '1';
        });
        if (failures.length === 0) {
          e.target.closest('tr').remove();
        } else {
          // Update group to only contain failed worlds for retry
          group.worlds = failures;
          e.target.textContent = `Retry (${failures.length} remaining)`;
          e.target.disabled = false;
          e.target.style.opacity = '1';
          // Update world pills in the row
          const pillsCell = e.target.closest('tr').querySelector('td:nth-child(3)');
          pillsCell.innerHTML = failures
            .map(w => `<span style="background:#1a3a5c;border-radius:12px;padding:2px 8px;font-size:12px;margin:2px">${w.worldName || w.worldId}</span>`)
            .join('');
        }
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
          onSave: async (formState, onProgress) => {
            onProgress?.({ phase: 'refreshing' });
            const refetchedAlerts = await _API().getAlerts();
            const refetchedItemAlerts = refetchedAlerts.filter(a => a.itemId === group.itemId);
            const refetchedGroups = _Grouping().groupAlerts(refetchedItemAlerts);
            refetchedGroups.forEach(g => {
              g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap().worldById(w.worldId)?.worldName || '' }));
            });
            const { normalizeTrigger } = _Grouping();
            const originalTriggerKey = normalizeTrigger(group.trigger);
            const latestGroup = refetchedGroups.find(g => normalizeTrigger(g.trigger) === originalTriggerKey) || null;
            const ops = _SaveOps().computeSaveOps(latestGroup, formState, _WorldMap().WORLDS);
            await _SaveOps().executeSaveOps(ops, group.itemId, formState, { onProgress });
            // Refresh panel after save — reuse closed-over nameMap and container
            const updatedAlerts = await _API().getAlerts();
            renderAlertsPanel(updatedAlerts, nameMap, container);
          },
        });
      }
    });

    // Render into container
    container.innerHTML = '';
    container.appendChild(panel);
  }

  async function deleteGroup(group, onProgress) {
    const total = group.worlds.length;
    let completed = 0;
    const results = await Promise.allSettled(group.worlds.map(async (w) => {
      try {
        return await _API().deleteAlert(w.alertId);
      } finally {
        completed++;
        onProgress?.({ completed, total });
      }
    }));
    const failures = results
      .map((r, i) => r.status === 'rejected' ? group.worlds[i] : null)
      .filter(Boolean);
    return { failures };
  }

  function injectTab() {
    function inject() {
      if (document.getElementById('univ-bulk-alerts-tab')) return true; // idempotent
      const main = document.querySelector('main');
      if (!main) return false;
      const wrapper = main.querySelector(':scope > div');
      if (!wrapper) return false;
      const navDiv = wrapper.querySelector(':scope > div:first-child');
      if (!navDiv) return false;

      const btn = document.createElement('button');
      btn.id = 'univ-bulk-alerts-tab';
      btn.textContent = 'Bulk Alerts';
      btn.style.cssText = 'background:#1a5a8a;border:none;color:#fff;padding:8px 16px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;margin-left:8px';
      btn.addEventListener('click', () => {
        history.pushState({}, '', '/account/bulk-alerts');
        init();
      });
      navDiv.appendChild(btn);
      return true;
    }

    if (inject()) return;

    // <main> not yet in DOM — wait for SPA render
    const observer = new MutationObserver(() => {
      if (inject()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    function findContentDiv() {
      const main = document.querySelector('main');
      if (!main) return null;
      const wrapper = main.querySelector(':scope > div');
      if (!wrapper) return null;
      const divs = wrapper.querySelectorAll(':scope > div');
      return divs.length >= 2 ? divs[1] : null;
    }

    async function run(contentDiv) {
      const nameMap = await fetchItemNames();

      let alerts;
      try {
        alerts = await _API().getAlerts();
      } catch {
        await handleInitError(contentDiv);
        return;
      }

      renderAlertsPanel(alerts, nameMap, contentDiv);
    }

    const contentDiv = findContentDiv();
    if (contentDiv) {
      run(contentDiv);
      return;
    }

    // <main> not yet rendered — wait for SPA navigation
    const observer = new MutationObserver(() => {
      const div = findContentDiv();
      if (!div) return;
      observer.disconnect();
      run(div);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Exported so it can be tested directly without triggering MutationObserver
  async function handleInitError(container) {
    const errorEl = document.createElement('div');
    errorEl.dataset.initError = '';
    errorEl.style.cssText = 'color:#ff6b6b;padding:24px;font-size:16px;width:100%';
    errorEl.textContent = 'Failed to load existing alerts — check your connection';
    container.innerHTML = '';
    container.appendChild(errorEl);
  }

  return { init, injectTab, scrapeItemNames, fetchItemNames, renderAlertsPanel, deleteGroup, handleInitError };
})();

if (typeof module !== 'undefined') module.exports = AlertsPage;
