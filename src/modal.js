const Modal = (() => {
  const _WorldMap = typeof WorldMap !== 'undefined' ? WorldMap : require('./worldmap');

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

  function openModal({ itemId, itemName, group, onSave, multipleGroups = false }) {
    const existingWorldIds = new Set((group?.worlds || []).map(w => w.worldId));
    const existingTrigger = group?.trigger || { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 0 } } };
    const existingComparator = Object.keys(existingTrigger.comparison)[0]; // 'lt' or 'gt'
    const existingTarget = existingTrigger.comparison[existingComparator].target;
    const isHQ = existingTrigger.filters.includes('hq');

    // Webhook auto-populate: 1) from alert, 2) GM_getValue, 3) empty
    const webhookFromAlert = group?.discordWebhook || '';
    const webhookFromGM = GM_getValue('discordWebhook') || '';
    const initialWebhook = webhookFromAlert || webhookFromGM;

    const overlay = document.createElement('div');
    overlay.id = 'univ-alert-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999';

    const worldCheckboxes = _WorldMap.WORLDS.map(w => `
      <label style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;${existingWorldIds.has(w.worldId) ? 'background:#1a3a5c;' : ''}">
        <input type="checkbox" data-world-id="${w.worldId}" ${existingWorldIds.has(w.worldId) ? 'checked' : ''}/>
        ${w.worldName}
      </label>`).join('');

    const multiNotice = multipleGroups
      ? `<div data-notice="multiple-groups" style="background:#3a2a00;border:1px solid #ff9800;padding:8px;border-radius:4px;margin-bottom:12px;font-size:12px">
           Multiple alert rules exist for this item. Editing here will only affect this rule. Use the <a href="/account/alerts" style="color:#ff9800">Alerts page</a> to manage all rules.
         </div>` : '';

    overlay.innerHTML = `
      <div style="background:#1a1a2e;border-radius:8px;padding:24px;width:480px;max-height:80vh;overflow-y:auto;color:#fff">
        <h3 style="margin:0 0 16px">Set Alerts — ${itemName}</h3>
        ${multiNotice}
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
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button type="button" data-action="cancel" style="background:#2a2a4e;border:1px solid #444;color:#fff;padding:8px 16px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">Cancel</button>
            <button type="button" data-action="save" style="background:#1a5a8a;border:none;color:#fff;padding:8px 16px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" ${initialWebhook ? '' : 'disabled'}>Save</button>
          </div>
        </form>
      </div>`;

    document.body.appendChild(overlay);

    const form = overlay.querySelector('#univ-alert-form');
    const webhookInput = overlay.querySelector('[data-field="webhook"]');
    const saveBtn = overlay.querySelector('[data-action="save"]');
    const errorArea = overlay.querySelector('[data-error-area]');

    // Enable/disable Save based on webhook
    webhookInput.addEventListener('input', () => {
      saveBtn.disabled = !webhookInput.value.trim();
    });

    overlay.querySelector('[data-action="select-all"]').addEventListener('click', () => {
      overlay.querySelectorAll('input[data-world-id]').forEach(cb => { cb.checked = true; });
    });
    overlay.querySelector('[data-action="clear-all"]').addEventListener('click', () => {
      overlay.querySelectorAll('input[data-world-id]').forEach(cb => { cb.checked = false; });
    });
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', closeModal);

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      errorArea.style.display = 'none';

      const webhook = webhookInput.value.trim();
      const selectedWorldIds = new Set(
        [...overlay.querySelectorAll('input[data-world-id]:checked')].map(cb => Number(cb.dataset.worldId))
      );
      const trigger = buildTriggerFromForm(form);
      const name = form.querySelector('[data-field="name"]').value.trim();

      GM_setValue('discordWebhook', webhook);

      try {
        await onSave({ name, webhook, trigger, selectedWorldIds });
        closeModal();
      } catch (err) {
        errorArea.textContent = err.message;
        errorArea.style.display = 'block';
        saveBtn.disabled = false;
      }
    });
  }

  function closeModal() {
    const existing = document.getElementById('univ-alert-modal');
    if (existing) existing.remove();
  }

  return { openModal, closeModal };
})();

if (typeof module !== 'undefined') module.exports = Modal;
