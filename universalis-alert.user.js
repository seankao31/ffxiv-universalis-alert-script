// ===== src/header.js =====
// ==UserScript==
// @name         Universalis Alert Manager
// @namespace    https://universalis.app/
// @version      1.0.0
// @description  Multi-world bulk alert creation and management for Universalis
// @author       You
// @match        https://universalis.app/market/*
// @match        https://universalis.app/account/alerts
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==


// ===== src/worldmap.js =====
const WorldMap = (() => {
  const WORLDS = [
    { worldId: 4028, worldName: '伊弗利特' },
    { worldId: 4029, worldName: '迦樓羅' },
    { worldId: 4030, worldName: '利維坦' },
    { worldId: 4031, worldName: '鳳凰' },
    { worldId: 4032, worldName: '奧汀' },
    { worldId: 4033, worldName: '巴哈姆特' },
    { worldId: 4034, worldName: '拉姆' },
    { worldId: 4035, worldName: '泰坦' },
  ];

  function worldById(id) {
    return WORLDS.find(w => w.worldId === id) || null;
  }

  return { WORLDS, worldById };
})();

if (typeof module !== 'undefined') module.exports = WorldMap;


// ===== src/grouping.js =====
const Grouping = (() => {
  const TRIGGER_KEY_ORDER = ['filters', 'mapper', 'reducer', 'comparison'];

  function normalizeTrigger(trigger) {
    const triggerKeys = Object.keys(trigger).sort();
    const allowedKeys = [...TRIGGER_KEY_ORDER].sort();
    if (JSON.stringify(triggerKeys) !== JSON.stringify(allowedKeys)) return null;

    const normalized = {};
    for (const key of TRIGGER_KEY_ORDER) {
      normalized[key] = trigger[key];
    }
    return JSON.stringify(normalized);
  }

  function groupAlerts(alerts) {
    const groups = new Map(); // key: `${itemId}::${normalizedTrigger}` → group object

    for (const alert of alerts) {
      const normalized = normalizeTrigger(alert.trigger);
      // Use alert id as a unique fallback key for ungroupable alerts
      const key = normalized !== null
        ? `${alert.itemId}::${normalized}`
        : `ungroupable::${alert.id}`;

      if (!groups.has(key)) {
        groups.set(key, {
          itemId: alert.itemId,
          name: alert.name,
          discordWebhook: alert.discordWebhook || '',
          trigger: alert.trigger,
          worlds: [],
        });
      }

      groups.get(key).worlds.push({
        worldId: alert.worldId,
        alertId: alert.id,
        worldName: null, // filled in by callers who have WorldMap access
      });
    }

    return Array.from(groups.values());
  }

  return { normalizeTrigger, groupAlerts };
})();

if (typeof module !== 'undefined') module.exports = Grouping;


// ===== src/rate-limit.js =====
const RateLimit = (() => {
  const DELAY_MS = 200;
  const MAX_RETRIES = 3;
  const BASE_BACKOFF_MS = 1000;

  let lastRequestTime = 0;
  let queue = Promise.resolve();

  /**
   * Drop-in replacement for fetch() that serialises requests through a queue
   * and retries on HTTP 429 with exponential back-off / Retry-After.
   */
  function rateLimitedFetch(url, options) {
    const request = queue.then(async () => {
      const now = Date.now();
      const elapsed = now - lastRequestTime;
      if (elapsed < DELAY_MS) {
        await sleep(DELAY_MS - elapsed);
      }

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const res = await fetch(url, options);
        lastRequestTime = Date.now();

        if (res.status !== 429) return res;

        if (attempt < MAX_RETRIES) {
          const retryAfter = parseRetryAfter(res);
          const backoff = retryAfter || BASE_BACKOFF_MS * Math.pow(2, attempt);
          await sleep(backoff);
        }
      }

      // All retries exhausted — return the last 429 so the caller's !res.ok check fires
      lastRequestTime = Date.now();
      return { ok: false, status: 429, json: async () => ({}) };
    });

    // Chain next request after this one settles (success or failure)
    queue = request.catch(() => {});
    return request;
  }

  function parseRetryAfter(res) {
    const header = res.headers && res.headers.get && res.headers.get('Retry-After');
    if (!header) return null;
    const seconds = Number(header);
    return isNaN(seconds) ? null : seconds * 1000;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Reset internal state between tests. */
  function _reset() {
    lastRequestTime = 0;
    queue = Promise.resolve();
  }

  return { rateLimitedFetch, _reset };
})();

if (typeof module !== 'undefined') module.exports = RateLimit;


// ===== src/api.js =====
const API = (() => {
  const _RL = typeof RateLimit !== 'undefined' ? RateLimit : require('./rate-limit');
  const _fetch = _RL.rateLimitedFetch;

  async function getAlerts() {
    const res = await _fetch('/api/web/alerts');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function createAlert(payload) {
    const res = await _fetch('/api/web/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function deleteAlert(alertId) {
    const res = await _fetch(`/api/web/alerts/${alertId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  return { getAlerts, createAlert, deleteAlert };
})();

if (typeof module !== 'undefined') module.exports = API;


// ===== src/save-ops.js =====
const SaveOps = (() => {
  // Requires: Grouping (for normalizeTrigger), API — injected via globals in TM context
  // In test context, required via module.exports
  const _Grouping = typeof Grouping !== 'undefined' ? Grouping : require('./grouping');
  const _API = typeof API !== 'undefined' ? API : require('./api');

  /**
   * Pure function. Returns { postsNeeded, deletesAfterSuccess }.
   * @param {object|null} group  - existing logical alert group, or null
   * @param {object} formState   - { name, webhook, trigger, selectedWorldIds: Set<number> }
   * @param {Array}  worlds      - full world list (WORLDS)
   */
  function computeSaveOps(group, formState, worlds) {
    const postsNeeded = [];
    const deletesAfterSuccess = [];

    const existingByWorldId = new Map();
    if (group) {
      for (const w of group.worlds) {
        existingByWorldId.set(w.worldId, w);
      }
    }

    const newTriggerKey = _Grouping.normalizeTrigger(formState.trigger);

    for (const world of worlds) {
      const existing = existingByWorldId.get(world.worldId);
      const isSelected = formState.selectedWorldIds.has(world.worldId);

      if (isSelected && !existing) {
        // Newly checked, no existing alert → POST
        postsNeeded.push(world);
      } else if (!isSelected && existing) {
        // Unchecked, had existing alert → DELETE after success
        deletesAfterSuccess.push(existing.alertId);
      } else if (isSelected && existing) {
        const existingTriggerKey = _Grouping.normalizeTrigger(group.trigger);
        const triggerChanged = newTriggerKey !== existingTriggerKey;
        const nameChanged = formState.name !== group.name;
        if (triggerChanged || nameChanged) {
          // Rule or name changed → POST new, DELETE old
          postsNeeded.push(world);
          deletesAfterSuccess.push(existing.alertId);
        }
        // else: identical — no-op
      }
    }

    return { postsNeeded, deletesAfterSuccess };
  }

  /**
   * Executes save ops: all POSTs first, then DELETEs only if all POSTs succeed.
   * Throws if any POST fails (no deletes will have run).
   */
  async function executeSaveOps(ops, itemId, formState) {
    if (ops.postsNeeded.length > 0) {
      const results = await Promise.allSettled(
        ops.postsNeeded.map(world =>
          _API.createAlert({
            name: formState.name,
            itemId,
            worldId: world.worldId,
            discordWebhook: formState.webhook,
            triggerVersion: 0,
            trigger: formState.trigger,
          })
        )
      );

      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        throw new Error(`Failed to create ${failures.length} alert(s). No deletions performed.`);
      }
    }

    if (ops.deletesAfterSuccess.length > 0) {
      const deleteResults = await Promise.allSettled(ops.deletesAfterSuccess.map(id => _API.deleteAlert(id)));
      const deleteFailures = deleteResults.filter(r => r.status === 'rejected');
      if (deleteFailures.length > 0) {
        throw new Error(`Failed to delete ${deleteFailures.length} alert(s). Some alerts may need manual cleanup.`);
      }
    }
  }

  return { computeSaveOps, executeSaveOps };
})();

if (typeof module !== 'undefined') module.exports = SaveOps;


// ===== src/modal.js =====
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

    const isNewAlert = !group;
    const worldCheckboxes = _WorldMap.WORLDS.map(w => {
      const checked = isNewAlert || existingWorldIds.has(w.worldId);
      return `
      <label style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;${checked ? 'background:#1a3a5c;' : ''}">
        <input type="checkbox" data-world-id="${w.worldId}" ${checked ? 'checked' : ''}/>
        ${w.worldName}
      </label>`;
    }).join('');

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


// ===== src/market-page.js =====
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
    btn.textContent = '🔔 Set Alerts';
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


// ===== src/alerts-page.js =====
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
    const results = await Promise.allSettled(group.worlds.map(w => _API().deleteAlert(w.alertId)));
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      throw new Error(`Failed to delete ${failures.length} alert(s). Some may need manual cleanup.`);
    }
  }

  function init() {
    // Remove stale panel if user re-navigated
    const stale = document.getElementById('univ-alert-panel');
    if (stale) stale.remove();

    async function run() {
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
    }

    if (document.querySelector('a[href^="/market/"]')) {
      run(); // market links already in DOM (SSR/CSR already rendered)
      return;
    }

    // Not yet rendered — observe for market links (SPA navigation case)
    const TIMEOUT_MS = 10000;
    const startedAt = Date.now();

    const observer = new MutationObserver(() => {
      if (!document.querySelector('a[href^="/market/"]')) {
        if (Date.now() - startedAt > TIMEOUT_MS) {
          observer.disconnect(); // no alerts — leave native page intact
        }
        return;
      }
      observer.disconnect();
      run();
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


// ===== src/init.js =====
const Init = (() => {
  function route(pathname) {
    if (pathname.startsWith('/market/')) {
      if (pathname.split('/').length === 3) { // /market/{id} only, not sub-paths
        MarketPage.init();
      }
    } else if (pathname === '/account/alerts') {
      AlertsPage.init();
    }
  }

  function setupNavigationObserver() {
    let lastPath = window.location.pathname;

    const observer = new MutationObserver(() => {
      const currentPath = window.location.pathname;
      if (currentPath === lastPath) return;
      lastPath = currentPath;
      route(currentPath);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function main() {
    setupNavigationObserver();
    route(window.location.pathname);
  }

  main();

  return { main, route, setupNavigationObserver };
})();

if (typeof module !== 'undefined') module.exports = Init;
