// ===== src/header.js =====
// ==UserScript==
// @name         Universalis Alert Manager
// @namespace    https://universalis.app/
// @version      1.0.0
// @description  Multi-world bulk alert creation and management for Universalis
// @author       You
// @match        https://universalis.app/*
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

  const MAX_ALERTS = 40;

  /**
   * Pure function. Returns { postsNeeded, deletesAfterSuccess, netChange, capacityError }.
   * @param {object|null} group  - existing logical alert group, or null
   * @param {object} formState   - { name, webhook, trigger, selectedWorldIds: Set<number> }
   * @param {Array}  worlds      - full world list (WORLDS)
   * @param {number} [currentAlertCount] - current total alert count for capacity check
   */
  function computeSaveOps(group, formState, worlds, currentAlertCount) {
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
        deletesAfterSuccess.push({ alertId: existing.alertId, worldId: existing.worldId, worldName: existing.worldName || '' });
      } else if (isSelected && existing) {
        const existingTriggerKey = _Grouping.normalizeTrigger(group.trigger);
        const triggerChanged = newTriggerKey !== existingTriggerKey;
        const nameChanged = formState.name !== group.name;
        if (triggerChanged || nameChanged) {
          // Rule or name changed → POST new, DELETE old
          postsNeeded.push(world);
          deletesAfterSuccess.push({ alertId: existing.alertId, worldId: existing.worldId, worldName: existing.worldName || '' });
        }
        // else: identical — no-op
      }
    }

    const netChange = postsNeeded.length - deletesAfterSuccess.length;
    const available = MAX_ALERTS - (currentAlertCount || 0);
    let capacityError = null;
    if (postsNeeded.length > 0 && (currentAlertCount || 0) + netChange > MAX_ALERTS) {
      capacityError = `Not enough alert slots (need ${postsNeeded.length}, only ${available + deletesAfterSuccess.length} available)`;
    }

    return { postsNeeded, deletesAfterSuccess, netChange, capacityError };
  }

  /**
   * Executes save ops with capacity-aware interleaving.
   * When slots are limited, interleaves POST and DELETE batches to stay within capacity.
   * When availableSlots is not provided, defaults to posting all at once (backward compat).
   * Throws if any POST fails (no further operations will run).
   * @param {object}   ops
   * @param {number}   itemId
   * @param {object}   formState
   * @param {object}   [options]
   * @param {function} [options.onProgress] - called after each request settles: ({ phase, completed, total })
   * @param {number}   [options.availableSlots] - how many new alerts can be created before hitting capacity
   */
  async function executeSaveOps(ops, itemId, formState, { onProgress, availableSlots } = {}) {
    // Default to unlimited slots when not specified (backward compat)
    let slots = typeof availableSlots === 'number' ? availableSlots : ops.postsNeeded.length;

    const pendingPosts = ops.postsNeeded.map((world, i) => ({ world, index: i }));
    const pendingDeletes = [...ops.deletesAfterSuccess];
    const postedWorldIds = new Set();
    const totalPosts = ops.postsNeeded.length;
    const totalDeletes = ops.deletesAfterSuccess.length;
    let postCompleted = 0;
    let deleteCompleted = 0;

    while (pendingPosts.length > 0 || pendingDeletes.length > 0) {
      // Phase 1: POST as many as slots allow
      const postBatchSize = Math.min(pendingPosts.length, slots);
      if (postBatchSize > 0) {
        const batch = pendingPosts.splice(0, postBatchSize);
        const results = await Promise.allSettled(
          batch.map(async ({ world }) => {
            try {
              return await _API.createAlert({
                name: formState.name,
                itemId,
                worldId: world.worldId,
                discordWebhook: formState.webhook,
                triggerVersion: 0,
                trigger: formState.trigger,
              });
            } finally {
              postCompleted++;
              onProgress?.({ phase: 'creating', completed: postCompleted, total: totalPosts });
            }
          })
        );

        const failedIndices = results
          .map((r, i) => r.status === 'rejected' ? i : -1)
          .filter(i => i !== -1);
        if (failedIndices.length > 0) {
          const names = failedIndices.map(i => batch[i].world.worldName || batch[i].world.worldId).join(', ');
          throw new Error(`Failed to save alerts for: ${names}`);
        }

        // Track which worlds have been successfully posted
        for (const { world } of batch) {
          postedWorldIds.add(world.worldId);
        }
        slots -= batch.length;
      }

      // If no more POSTs needed, break to final DELETE phase
      if (pendingPosts.length === 0) break;

      // Phase 2: Need more slots — DELETE to free capacity
      // Prefer "safe" deletes: old alerts whose replacements have been POSTed
      pendingDeletes.sort((a, b) => {
        const aReplaced = postedWorldIds.has(a.worldId) ? 0 : 1;
        const bReplaced = postedWorldIds.has(b.worldId) ? 0 : 1;
        return aReplaced - bReplaced;
      });

      // Delete enough to make room for remaining POSTs (at least 1)
      const deleteBatchSize = Math.min(pendingDeletes.length, pendingPosts.length);
      if (deleteBatchSize === 0) break; // safety: no deletes possible, avoid infinite loop

      const deleteBatch = pendingDeletes.splice(0, deleteBatchSize);
      const deleteResults = await Promise.allSettled(
        deleteBatch.map(async (entry) => {
          try {
            return await _API.deleteAlert(entry.alertId);
          } finally {
            deleteCompleted++;
            onProgress?.({ phase: 'removing', completed: deleteCompleted, total: totalDeletes });
          }
        })
      );

      const failedDeleteIndices = deleteResults
        .map((r, i) => r.status === 'rejected' ? i : -1)
        .filter(i => i !== -1);
      if (failedDeleteIndices.length > 0) {
        const names = failedDeleteIndices.map(i => deleteBatch[i].worldName || deleteBatch[i].worldId).join(', ');
        throw new Error(`Alerts saved, but failed to remove old alerts for: ${names}. These may need manual cleanup.`);
      }

      slots += deleteBatch.length;
    }

    // Final phase: delete remaining old alerts (pure removals + remaining replacements)
    if (pendingDeletes.length > 0) {
      // Sort: replaced alerts first (safe), unreplaced last
      pendingDeletes.sort((a, b) => {
        const aReplaced = postedWorldIds.has(a.worldId) ? 0 : 1;
        const bReplaced = postedWorldIds.has(b.worldId) ? 0 : 1;
        return aReplaced - bReplaced;
      });

      const deleteResults = await Promise.allSettled(
        pendingDeletes.map(async (entry) => {
          try {
            return await _API.deleteAlert(entry.alertId);
          } finally {
            deleteCompleted++;
            onProgress?.({ phase: 'removing', completed: deleteCompleted, total: totalDeletes });
          }
        })
      );

      const failedDeleteIndices = deleteResults
        .map((r, i) => r.status === 'rejected' ? i : -1)
        .filter(i => i !== -1);
      if (failedDeleteIndices.length > 0) {
        const names = failedDeleteIndices.map(i => pendingDeletes[i].worldName || pendingDeletes[i].worldId).join(', ');
        throw new Error(`Alerts saved, but failed to remove old alerts for: ${names}. These may need manual cleanup.`);
      }
    }
  }

  return { computeSaveOps, executeSaveOps, MAX_ALERTS };
})();

if (typeof module !== 'undefined') module.exports = SaveOps;


// ===== src/modal.js =====
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
        saveBtn.textContent = 'Save';
        saveBtn.disabled = false;
      }
    });
  }

  function renderListView(container, { groups, nameMap, onEdit, onDelete, onNew, onClose, newAlertDisabled }) {
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

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0;color:#fff">Bulk Alerts</h3>
        <span data-action="close" style="cursor:pointer;color:#888;font-size:18px">\u2715</span>
      </div>
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

  function openBulkModal({ groups, nameMap, currentItemId, currentItemName }) {
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

    function showListView(currentGroups) {
      innerContainer.innerHTML = '';
      renderListView(innerContainer, {
        groups: currentGroups, nameMap,
        newAlertDisabled: !currentItemId,
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

        const ops = _SaveOps().computeSaveOps(freshGroup, formState, _WorldMap.WORLDS);
        await _SaveOps().executeSaveOps(ops, itemId, formState, { onProgress });

        const updatedAlerts = await _API().getAlerts();
        const updatedGroups = _Grouping().groupAlerts(updatedAlerts);
        updatedGroups.forEach(g => {
          g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap.worldById(w.worldId)?.worldName || '' }));
        });
        showListView(updatedGroups);
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
      showListView(groups);
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


// ===== src/header-button.js =====
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

    const uniqueItemIds = [...new Set(allAlerts.map(a => a.itemId))];
    const nameMap = await fetchItemNames(uniqueItemIds);

    const groups = _Grouping().groupAlerts(allAlerts);
    groups.forEach(g => {
      g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap().worldById(w.worldId)?.worldName || '' }));
    });

    const { currentItemId, currentItemName } = detectPageContext();
    _Modal().openBulkModal({ groups, nameMap, currentItemId, currentItemName });
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


// ===== src/init.js =====
const Init = (() => {
  function route() {
    HeaderButton.init();
  }

  function setupNavigationObserver() {
    let lastPath = window.location.pathname;

    const observer = new MutationObserver(() => {
      const currentPath = window.location.pathname;
      if (currentPath === lastPath) return;
      lastPath = currentPath;
      route();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function main() {
    setupNavigationObserver();
    route();
  }

  main();

  return { main, route, setupNavigationObserver };
})();

if (typeof module !== 'undefined') module.exports = Init;
