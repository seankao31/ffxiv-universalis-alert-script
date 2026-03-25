const Modal = (() => {
  const _WorldMap = typeof WorldMap !== 'undefined' ? WorldMap : require('./worldmap');

  const _apiModule = typeof module !== 'undefined' ? require('./api') : null;
  const _groupingModule = typeof module !== 'undefined' ? require('./grouping') : null;
  const _saveOpsModule = typeof module !== 'undefined' ? require('./save-ops') : null;

  function _API() { return typeof API !== 'undefined' ? API : _apiModule; }
  function _Grouping() { return typeof Grouping !== 'undefined' ? Grouping : _groupingModule; }
  function _SaveOps() { return typeof SaveOps !== 'undefined' ? SaveOps : _saveOpsModule; }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const METRIC_LABELS = { pricePerUnit: 'Price Per Unit', quantity: 'Quantity', total: 'Total' };
  const MAPPER_VALUES = ['pricePerUnit', 'quantity', 'total'];
  const REDUCER_VALUES = ['min', 'max', 'mean'];
  const COMPARATOR_VALUES = ['lt', 'gt'];

  function buildTriggerFromForm(form) {
    const mapper = form.querySelector('[data-field="mapper"]').value;
    const reducer = form.querySelector('[data-field="reducer"]').value;
    const comparatorKey = form.querySelector('[data-field="comparator"]').value;
    const target = Number(form.querySelector('[data-field="target"]').value);
    const hq = form.querySelector('[data-field="hq"]').checked;
    return {
      filters: hq ? ['hq'] : [],
      mapper,
      reducer,
      comparison: { [comparatorKey]: { target } },
    };
  }

  function formatRule(trigger) {
    const comparator = 'lt' in trigger.comparison ? '<' : '>';
    const target = trigger.comparison[Object.keys(trigger.comparison)[0]].target;
    const metricLabels = { pricePerUnit: 'Price', quantity: 'Quantity', total: 'Total' };
    const reducerLabels = { min: 'Min', max: 'Max', mean: 'Avg' };
    const label = `${reducerLabels[trigger.reducer] || trigger.reducer} ${metricLabels[trigger.mapper] || trigger.mapper} ${comparator} ${target}`;
    return trigger.filters.includes('hq') ? `${label} <span style="background:#4a8a4a;border-radius:3px;padding:0 4px;font-size:11px">HQ</span>` : label;
  }

  function renderFormView(container, { itemId, itemName, group, onSave, onBack }) {
    const existingWorldIds = new Set((group?.worlds || []).map(w => w.worldId));
    const existingTrigger = group?.trigger || { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 0 } } };
    const existingComparator = Object.keys(existingTrigger.comparison)[0]; // 'lt' or 'gt'
    const existingTarget = existingTrigger.comparison[existingComparator].target;
    const isHQ = existingTrigger.filters.includes('hq');

    // Webhook auto-populate: 1) from alert, 2) GM_getValue, 3) empty
    const webhookFromAlert = group?.discordWebhook || '';
    const webhookFromGM = GM_getValue('discordWebhook') || '';
    const initialWebhook = webhookFromAlert || webhookFromGM;

    const isNewAlert = !group;
    const worldCheckboxes = _WorldMap.WORLDS.map(w => {
      const checked = isNewAlert || existingWorldIds.has(w.worldId);
      return `
      <label style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;${checked ? 'background:#1a3a5c;' : ''}">
        <input type="checkbox" data-world-id="${w.worldId}" ${checked ? 'checked' : ''}/>
        ${w.worldName}
      </label>`;
    }).join('');

    const backLink = onBack
      ? `<a href="#" data-action="back" style="color:#aaa;font-size:13px;text-decoration:none;display:inline-block;margin-bottom:12px">\u2190 Back to alerts</a>`
      : '';

    container.innerHTML = `
        ${backLink}
        <h3 style="margin:0 0 16px">Set Alerts \u2014 ${escHtml(itemName)}</h3>
        <form id="univ-alert-form">
          <div style="margin-bottom:12px">
            <label style="display:block;margin-bottom:4px;font-size:13px">Alert Name</label>
            <input data-field="name" type="text" value="${group?.name || itemName}"
              style="width:100%;box-sizing:border-box;background:#2a2a4e;border:1px solid #444;color:#fff;padding:6px 8px;border-radius:4px"/>
          </div>
          <div style="margin-bottom:12px">
            <label style="display:block;margin-bottom:4px;font-size:13px">Discord Webhook</label>
            <input data-field="webhook" type="text" value="${initialWebhook}" placeholder="https://discord.com/api/webhooks/..."
              style="width:100%;box-sizing:border-box;background:#2a2a4e;border:1px solid #444;color:#fff;padding:6px 8px;border-radius:4px"/>
          </div>
          <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
            <select data-field="mapper" style="background:#2a2a4e;border:1px solid #444;color:#fff;padding:6px 8px;border-radius:4px">
              ${MAPPER_VALUES.map(v => `<option value="${v}" ${existingTrigger.mapper === v ? 'selected' : ''}>${METRIC_LABELS[v]}</option>`).join('')}
            </select>
            <select data-field="reducer" style="background:#2a2a4e;border:1px solid #444;color:#fff;padding:6px 8px;border-radius:4px">
              ${REDUCER_VALUES.map(v => `<option value="${v}" ${existingTrigger.reducer === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
            <select data-field="comparator" style="background:#2a2a4e;border:1px solid #444;color:#fff;padding:6px 8px;border-radius:4px">
              ${COMPARATOR_VALUES.map(v => `<option value="${v}" ${existingComparator === v ? 'selected' : ''}>${v === 'lt' ? '<' : '>'}</option>`).join('')}
            </select>
            <input data-field="target" type="number" value="${existingTarget}" min="0"
              style="width:80px;background:#2a2a4e;border:1px solid #444;color:#fff;padding:6px 8px;border-radius:4px"/>
          </div>
          <div style="margin-bottom:12px">
            <label style="display:flex;align-items:center;gap:6px">
              <input data-field="hq" type="checkbox" ${isHQ ? 'checked' : ''}/>
              HQ Only
            </label>
          </div>
          <div style="margin-bottom:12px">
            <div style="font-size:13px;margin-bottom:6px">Worlds</div>
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <button type="button" data-action="select-all" style="background:#2a4a2a;border:1px solid #4a8a4a;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">Select All</button>
              <button type="button" data-action="clear-all" style="background:#4a2a2a;border:1px solid #8a4a4a;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">Clear</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">${worldCheckboxes}</div>
          </div>
          <div data-error-area style="display:none;background:#4a1a1a;border:1px solid #c00;padding:8px;border-radius:4px;margin-bottom:12px;font-size:13px"></div>
          <div data-status style="display:none;color:#aaa;font-size:13px;margin-bottom:12px"></div>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button type="button" data-action="cancel" style="background:#2a2a4e;border:1px solid #444;color:#fff;padding:8px 16px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">Cancel</button>
            <button type="button" data-action="save" style="background:#1a5a8a;border:none;color:#fff;padding:8px 16px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" ${initialWebhook ? '' : 'disabled'}>Save</button>
          </div>
        </form>`;

    const form = container.querySelector('#univ-alert-form');
    const webhookInput = container.querySelector('[data-field="webhook"]');
    const saveBtn = container.querySelector('[data-action="save"]');
    const errorArea = container.querySelector('[data-error-area]');
    const statusEl = container.querySelector('[data-status]');

    // Enable/disable Save based on webhook
    webhookInput.addEventListener('input', () => {
      saveBtn.disabled = !webhookInput.value.trim();
    });

    container.querySelector('[data-action="select-all"]').addEventListener('click', () => {
      container.querySelectorAll('input[data-world-id]').forEach(cb => { cb.checked = true; });
    });
    container.querySelector('[data-action="clear-all"]').addEventListener('click', () => {
      container.querySelectorAll('input[data-world-id]').forEach(cb => { cb.checked = false; });
    });
    container.querySelector('[data-action="cancel"]').addEventListener('click', closeModal);

    if (onBack) {
      container.querySelector('[data-action="back"]').addEventListener('click', (e) => {
        e.preventDefault();
        onBack();
      });
    }

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      errorArea.style.display = 'none';
      statusEl.style.display = 'none';

      const webhook = webhookInput.value.trim();
      const selectedWorldIds = new Set(
        [...container.querySelectorAll('input[data-world-id]:checked')].map(cb => Number(cb.dataset.worldId))
      );
      const trigger = buildTriggerFromForm(form);
      const name = form.querySelector('[data-field="name"]').value.trim();

      GM_setValue('discordWebhook', webhook);

      const onProgress = ({ phase, completed, total }) => {
        statusEl.style.display = 'block';
        if (phase === 'refreshing') {
          statusEl.textContent = 'Refreshing state...';
        } else if (phase === 'creating') {
          statusEl.textContent = `Creating alert ${completed} of ${total}...`;
        } else {
          statusEl.textContent = `Removing old alert ${completed} of ${total}...`;
        }
      };

      try {
        await onSave({ name, webhook, trigger, selectedWorldIds }, onProgress);
      } catch (err) {
        statusEl.style.display = 'none';
        errorArea.textContent = err.message;
        errorArea.style.display = 'block';
        saveBtn.textContent = err.isCapacityError ? 'Save' : 'Retry';
        saveBtn.disabled = false;
      }
    });
  }

  function renderListView(container, { groups, nameMap, onEdit, onDelete, onNew, onClose, newAlertDisabled, alertCount }) {
    const sorted = [...groups].sort((a, b) => a.itemId - b.itemId);
    const rows = sorted.map((g, idx) => {
      const itemName = nameMap.get(g.itemId) || `Item #${g.itemId}`;
      const worldPills = g.worlds.map(w =>
        `<span data-world-pill style="background:#1a3a5c;border-radius:12px;padding:2px 8px;font-size:12px;margin:2px;display:inline-block">${w.worldName || w.worldId}</span>`
      ).join('');
      return `
        <div data-group-row="${idx}" style="background:#2a2a4a;padding:10px;border-radius:4px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div style="font-size:14px;color:#fff">${escHtml(itemName)} <span style="font-size:11px;color:#888">#${g.itemId}</span></div>
              <div style="font-size:13px;color:#ccc;margin-top:4px">${formatRule(g.trigger)}</div>
              <div data-world-pills style="margin-top:6px">${worldPills}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button data-action="edit" data-group-idx="${idx}" style="background:#1a4a7a;border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">Edit</button>
              <button data-action="delete" data-group-idx="${idx}" style="background:#6a1a1a;border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">Delete</button>
            </div>
          </div>
        </div>`;
    }).join('');

    const newAlertAttrs = newAlertDisabled
      ? 'disabled title="Navigate to an item page to create alerts" style="background:#333;border:none;color:#666;padding:8px 20px;border-radius:4px;cursor:not-allowed;display:inline-flex;align-items:center;justify-content:center"'
      : 'style="background:#1a5a2a;border:none;color:#fff;padding:8px 20px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center"';

    const capacityLine = typeof alertCount === 'number'
      ? `<div style="color:#888;font-size:13px;margin-bottom:12px">Alert slots: ${alertCount} / 40 used</div>`
      : '';

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0;color:#fff">Bulk Alerts</h3>
        <span data-action="close" style="cursor:pointer;color:#888;font-size:18px">\u2715</span>
      </div>
      ${capacityLine}
      <div data-list-area style="max-height:300px;overflow-y:auto">${rows}</div>
      <div style="border-top:1px solid #333;margin-top:12px;padding-top:12px;text-align:center">
        <button data-action="new-alert" ${newAlertAttrs}>New Alert</button>
      </div>`;

    // Event delegation — remove stale listener from previous render to avoid duplicates.
    // innerHTML = '' only removes child nodes, not listeners on the container itself,
    // so list→form→back→list stacks duplicate handlers without this cleanup.
    if (container._listClickHandler) {
      container.removeEventListener('click', container._listClickHandler);
    }
    const handler = (e) => {
      const action = e.target.dataset.action;
      if (action === 'close') { onClose(); return; }
      if (action === 'new-alert') { if (!newAlertDisabled) onNew(); return; }
      const idx = Number(e.target.dataset.groupIdx);
      const group = sorted[idx];
      if (!group) return;
      if (action === 'edit') onEdit(group);
      if (action === 'delete') onDelete(group, idx, e.target);
    };
    container._listClickHandler = handler;
    container.addEventListener('click', handler);
  }

  function openBulkModal({ groups, nameMap, currentItemId, currentItemName, alertCount }) {
    closeModal();

    const overlay = document.createElement('div');
    overlay.id = 'univ-alert-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999';

    const innerContainer = document.createElement('div');
    innerContainer.style.cssText = 'background:#1a1a2e;border-radius:8px;padding:24px;width:480px;max-height:80vh;overflow-y:auto;color:#fff';
    overlay.appendChild(innerContainer);
    document.body.appendChild(overlay);

    const onKeydown = (e) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onKeydown);
    overlay._onKeydown = onKeydown;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    function showEmptyState() {
      innerContainer.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="margin:0;color:#fff">Bulk Alerts</h3>
          <span data-action="close-empty" style="cursor:pointer;color:#888;font-size:18px">\u2715</span>
        </div>
        <p style="color:#888;text-align:center;padding:24px 0">No alerts yet. Navigate to an item page to create one.</p>`;
      innerContainer.querySelector('[data-action="close-empty"]').addEventListener('click', () => closeModal());
    }

    function showListView(currentGroups, currentAlertCount) {
      innerContainer.innerHTML = '';
      renderListView(innerContainer, {
        groups: currentGroups, nameMap,
        newAlertDisabled: !currentItemId,
        alertCount: currentAlertCount,
        onEdit: (group) => showFormView(group, currentGroups),
        onDelete: (group, idx, btn) => {
          handleListDelete(group, idx, btn, innerContainer, () => {
            if (currentItemId) {
              showFormView(null, null);
            } else {
              showEmptyState();
            }
          });
        },
        onNew: () => showFormView(null, currentGroups),
        onClose: () => closeModal(),
      });
    }

    function showFormView(group, currentGroupsForBack) {
      innerContainer.innerHTML = '';
      const onBack = currentGroupsForBack ? () => showListView(currentGroupsForBack) : null;
      const itemId = group ? group.itemId : currentItemId;
      const itemName = group ? (nameMap.get(group.itemId) || `Item #${group.itemId}`) : currentItemName;

      const onSave = async (formState, onProgress) => {
        onProgress?.({ phase: 'refreshing' });
        const freshAlerts = await _API().getAlerts();
        const freshGroups = _Grouping().groupAlerts(freshAlerts);
        freshGroups.forEach(g => {
          g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap.worldById(w.worldId)?.worldName || '' }));
        });

        const normalizeTrigger = _Grouping().normalizeTrigger;
        const originalTriggerKey = group ? normalizeTrigger(group.trigger) : null;
        const freshGroup = originalTriggerKey
          ? freshGroups.find(g => g.itemId === itemId && normalizeTrigger(g.trigger) === originalTriggerKey) || null
          : null;

        const ops = _SaveOps().computeSaveOps(freshGroup, formState, _WorldMap.WORLDS, freshAlerts.length);
        if (ops.capacityError) {
          const err = new Error(ops.capacityError);
          err.isCapacityError = true;
          throw err;
        }
        const availableSlots = _SaveOps().MAX_ALERTS - freshAlerts.length;
        await _SaveOps().executeSaveOps(ops, itemId, formState, { onProgress, availableSlots });

        const updatedAlerts = await _API().getAlerts();
        const updatedGroups = _Grouping().groupAlerts(updatedAlerts);
        updatedGroups.forEach(g => {
          g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap.worldById(w.worldId)?.worldName || '' }));
        });
        showListView(updatedGroups, updatedAlerts.length);
      };

      renderFormView(innerContainer, { itemId, itemName, group, onSave, onBack });
    }

    // Initial routing
    if (groups.length === 0) {
      if (currentItemId) {
        showFormView(null, null);
      } else {
        showEmptyState();
      }
    } else {
      showListView(groups, alertCount);
    }
  }

  function closeModal() {
    const existing = document.getElementById('univ-alert-modal');
    if (existing) {
      if (existing._onKeydown) {
        document.removeEventListener('keydown', existing._onKeydown);
      }
      existing.remove();
    }
  }

  async function handleListDelete(group, idx, btn, container, onAllDeleted) {
    btn.disabled = true;
    btn.textContent = 'Queued\u2026';
    btn.style.opacity = '0.7';
    const total = group.worlds.length;
    let completed = 0;

    const results = await Promise.allSettled(group.worlds.map(async (w) => {
      try {
        return await _API().deleteAlert(w.alertId);
      } finally {
        completed++;
        btn.textContent = `Deleting ${completed}/${total}...`;
        btn.style.opacity = '1';
      }
    }));

    const failures = results
      .map((r, i) => r.status === 'rejected' ? group.worlds[i] : null)
      .filter(Boolean);

    if (failures.length === 0) {
      const row = container.querySelector(`[data-group-row="${idx}"]`);
      if (row) row.remove();
      // Check if all groups deleted
      if (!container.querySelector('[data-group-row]')) {
        onAllDeleted();
      }
    } else {
      group.worlds = failures;
      btn.textContent = `Retry (${failures.length} remaining)`;
      btn.disabled = false;
      btn.style.opacity = '1';
      // Update world pills
      const row = container.querySelector(`[data-group-row="${idx}"]`);
      const pillsContainer = row.querySelector('[data-world-pills]');
      pillsContainer.innerHTML = failures
        .map(w => `<span data-world-pill style="background:#1a3a5c;border-radius:12px;padding:2px 8px;font-size:12px;margin:2px;display:inline-block">${w.worldName || w.worldId}</span>`)
        .join('');
    }
  }

  return { closeModal, formatRule, renderListView, handleListDelete, openBulkModal };
})();

if (typeof module !== 'undefined') module.exports = Modal;
