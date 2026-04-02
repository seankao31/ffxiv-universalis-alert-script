// ===== src/header.js =====
// ==UserScript==
// @name         FFXIV Universalis Alert Manager
// @namespace    https://universalis.app/
// @version      0.1.2
// @description  Multi-world bulk alert creation and management for Universalis
// @author       Yshan
// @homepage     https://yhkao.com
// @updateURL    https://raw.githubusercontent.com/seankao31/ffxiv-universalis-alert-script/release/ffxiv-universalis-alert.meta.js
// @downloadURL  https://raw.githubusercontent.com/seankao31/ffxiv-universalis-alert-script/release/ffxiv-universalis-alert.user.js
// @match        https://universalis.app/*
// @grant        GM_getValue
// @grant        GM_setValue
// @require      https://storage.ko-fi.com/cdn/widget/Widget_2.js
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
  const SORTED_TRIGGER_KEYS = [...TRIGGER_KEY_ORDER].sort();

  function normalizeTrigger(trigger) {
    const triggerKeys = Object.keys(trigger).sort();
    if (JSON.stringify(triggerKeys) !== JSON.stringify(SORTED_TRIGGER_KEYS)) return null;

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
    const skippedWorlds = [];

    const existingByWorldId = new Map();
    if (group) {
      for (const w of group.worlds) {
        existingByWorldId.set(w.worldId, w);
      }
    }

    const newTriggerKey = _Grouping.normalizeTrigger(formState.trigger);
    const existingTriggerKey = group ? _Grouping.normalizeTrigger(group.trigger) : null;

    for (const world of worlds) {
      const existing = existingByWorldId.get(world.worldId);
      const isSelected = formState.selectedWorldIds.has(world.worldId);

      if (isSelected && !existing) {
        postsNeeded.push(world);
      } else if (!isSelected && existing) {
        deletesAfterSuccess.push({ alertId: existing.alertId, worldId: existing.worldId, worldName: existing.worldName || '' });
      } else if (isSelected && existing) {
        const triggerChanged = newTriggerKey !== existingTriggerKey;
        const nameChanged = formState.name !== group.name;
        if (triggerChanged || nameChanged) {
          // Rule or name changed → POST new, DELETE old
          postsNeeded.push(world);
          deletesAfterSuccess.push({ alertId: existing.alertId, worldId: existing.worldId, worldName: existing.worldName || '' });
        } else {
          // Identical — already covered, skip
          skippedWorlds.push({ worldId: existing.worldId, worldName: existing.worldName || '' });
        }
      }
    }

    const netChange = postsNeeded.length - deletesAfterSuccess.length;
    const available = MAX_ALERTS - (currentAlertCount || 0);
    let capacityError = null;
    if (postsNeeded.length > 0 && (currentAlertCount || 0) + netChange > MAX_ALERTS) {
      // available + deletesAfterSuccess.length: deletes free slots during interleaved execution,
      // so effective capacity = unused slots + slots that will be reclaimed by deletes.
      capacityError = `Not enough alert slots (need ${postsNeeded.length}, only ${available + deletesAfterSuccess.length} available)`;
    }

    return { postsNeeded, deletesAfterSuccess, skippedWorlds, netChange, capacityError };
  }

  function getFailedIndices(results) {
    return results
      .map((r, i) => r.status === 'rejected' ? i : -1)
      .filter(i => i !== -1);
  }

  function sortDeletesByReplacement(deletes, postedWorldIds) {
    deletes.sort((a, b) => {
      const aReplaced = postedWorldIds.has(a.worldId) ? 0 : 1;
      const bReplaced = postedWorldIds.has(b.worldId) ? 0 : 1;
      return aReplaced - bReplaced;
    });
  }

  async function runDeleteBatch(batch, onEachDone) {
    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        try {
          return await _API.deleteAlert(entry.alertId);
        } finally {
          onEachDone();
        }
      })
    );
    const failed = getFailedIndices(results);
    if (failed.length > 0) {
      const names = failed.map(i => batch[i].worldName || batch[i].worldId).join(', ');
      throw new Error(`Alerts saved, but failed to remove old alerts for: ${names}. These may need manual cleanup.`);
    }
  }

  async function executeSaveOps(ops, itemId, formState, { onProgress, availableSlots } = {}) {
    let slots = typeof availableSlots === 'number' ? availableSlots : ops.postsNeeded.length;

    const pendingPosts = ops.postsNeeded.map((world, i) => ({ world, index: i }));
    const pendingDeletes = [...ops.deletesAfterSuccess];
    const postedWorldIds = new Set();
    const totalPosts = ops.postsNeeded.length;
    const totalDeletes = ops.deletesAfterSuccess.length;
    let postCompleted = 0;
    let deleteCompleted = 0;

    const onDeleteDone = () => {
      deleteCompleted++;
      onProgress?.({ phase: 'removing', completed: deleteCompleted, total: totalDeletes });
    };

    while (pendingPosts.length > 0 || pendingDeletes.length > 0) {
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

        const failed = getFailedIndices(results);
        if (failed.length > 0) {
          const names = failed.map(i => batch[i].world.worldName || batch[i].world.worldId).join(', ');
          throw new Error(`Failed to save alerts for: ${names}`);
        }

        for (const { world } of batch) {
          postedWorldIds.add(world.worldId);
        }
        slots -= batch.length;
      }

      if (pendingPosts.length === 0) break;

      sortDeletesByReplacement(pendingDeletes, postedWorldIds);

      const deleteBatchSize = Math.min(pendingDeletes.length, pendingPosts.length);
      if (deleteBatchSize === 0) break;

      const deleteBatch = pendingDeletes.splice(0, deleteBatchSize);
      await runDeleteBatch(deleteBatch, onDeleteDone);
      slots += deleteBatch.length;
    }

    if (pendingDeletes.length > 0) {
      sortDeletesByReplacement(pendingDeletes, postedWorldIds);
      await runDeleteBatch(pendingDeletes, onDeleteDone);
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

  function injectKofi(container) {
    if (typeof kofiwidget2 === 'undefined') return;
    const el = container.querySelector('[data-kofi-container]');
    if (!el) return;
    kofiwidget2.init('Support this project', '#bc9df9', 'Y8Y41WOCXM');
    el.innerHTML = kofiwidget2.getHTML();
    const btn = el.querySelector('.kofi-button');
    if (btn) btn.style.cssText += 'padding:4px 10px !important;line-height:1 !important;font-size:12px !important;border-radius:4px !important;';
    const img = el.querySelector('.kofiimg');
    if (img) img.style.cssText += 'height:13px !important;width:auto !important;vertical-align:middle !important;padding-top:0 !important;';
    const text = el.querySelector('.kofitext');
    if (text) text.style.cssText += 'line-height:1 !important;';
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function createModalShell() {
    closeModal();

    const overlay = document.createElement('div');
    overlay.id = 'univ-alert-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999';

    const inner = document.createElement('div');
    inner.style.cssText = 'background:#1a1a2e;border-radius:8px;padding:24px;width:600px;max-height:90vh;overflow-y:auto;color:#fff';
    overlay.appendChild(inner);
    document.body.appendChild(overlay);

    const onKeydown = (e) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onKeydown);
    overlay._onKeydown = onKeydown;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    return { overlay, inner };
  }

  function attributionHtml(withBorder) {
    const borderStyle = withBorder ? 'border-top:1px solid #333;margin-top:32px;padding-top:12px;' : 'margin-top:20px;';
    return `<div data-attribution style="${borderStyle}text-align:center;color:#555;font-size:11px">Made with \u2665 by <a href="https://yhkao.com" target="_blank" rel="noopener" style="color:#555;text-decoration:underline">Yshan</a></div>
      <div data-kofi-container style="text-align:center;margin-top:6px"></div>`;
  }

  function worldPillHtml(w) {
    return `<span data-world-pill style="background:#1a3a5c;border-radius:12px;padding:2px 8px;font-size:12px;margin:2px;display:inline-block">${w.worldName || w.worldId}</span>`;
  }

  const METRIC_LABELS = { pricePerUnit: 'Price Per Unit', quantity: 'Quantity', total: 'Total' };
  const MAPPER_VALUES = Object.keys(METRIC_LABELS);
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

  const RULE_METRIC_LABELS = { pricePerUnit: 'Price', quantity: 'Quantity', total: 'Total' };
  const RULE_REDUCER_LABELS = { min: 'Min', max: 'Max', mean: 'Avg' };

  function formatRuleLabel(trigger) {
    const comparator = 'lt' in trigger.comparison ? '<' : '>';
    const target = trigger.comparison[Object.keys(trigger.comparison)[0]].target;
    return `${RULE_REDUCER_LABELS[trigger.reducer] || trigger.reducer} ${RULE_METRIC_LABELS[trigger.mapper] || trigger.mapper} ${comparator} ${target}`;
  }

  function formatRule(trigger) {
    const label = formatRuleLabel(trigger);
    return trigger.filters.includes('hq') ? `${label} <span style="background:#4a8a4a;border-radius:3px;padding:0 4px;font-size:11px">HQ</span>` : label;
  }

  function formatRuleText(trigger) {
    const label = formatRuleLabel(trigger);
    return trigger.filters.includes('hq') ? `${label} HQ` : label;
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
    const CHIP_ON = 'background:#1a5a8a;border:1px solid #3a8abf;color:#fff';
    const CHIP_OFF = 'background:#2a2a4e;border:1px solid #444;color:#888';
    const worldChips = _WorldMap.WORLDS.map(w => {
      const selected = isNewAlert || existingWorldIds.has(w.worldId);
      return `<span data-world-id="${w.worldId}" data-selected="${selected}" style="padding:6px 12px;border-radius:16px;cursor:pointer;font-size:13px;user-select:none;transition:all .15s;display:inline-block;${selected ? CHIP_ON : CHIP_OFF}">${w.worldName}</span>`;
    }).join('');

    container.innerHTML = `
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
            <div data-world-grid style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${worldChips}</div>
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

    function toggleChip(chip, selected) {
      chip.dataset.selected = String(selected);
      chip.style.cssText = `padding:6px 12px;border-radius:16px;cursor:pointer;font-size:13px;user-select:none;transition:all .15s;display:inline-block;${selected ? CHIP_ON : CHIP_OFF}`;
    }

    container.querySelector('[data-world-grid]').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-world-id]');
      if (!chip) return;
      toggleChip(chip, chip.dataset.selected !== 'true');
    });
    container.querySelector('[data-action="select-all"]').addEventListener('click', () => {
      container.querySelectorAll('[data-world-id]').forEach(chip => toggleChip(chip, true));
    });
    container.querySelector('[data-action="clear-all"]').addEventListener('click', () => {
      container.querySelectorAll('[data-world-id]').forEach(chip => toggleChip(chip, false));
    });
    container.querySelector('[data-action="cancel"]').addEventListener('click', onBack || closeModal);

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      errorArea.style.display = 'none';
      statusEl.style.display = 'none';

      const webhook = webhookInput.value.trim();
      const selectedWorldIds = new Set(
        [...container.querySelectorAll('[data-world-id][data-selected="true"]')].map(el => Number(el.dataset.worldId))
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
        // Capacity/duplicate errors (validation) → "Save" so user can adjust.
        // Execution errors (API failure) → "Retry" to re-attempt the same operation.
        saveBtn.textContent = (err.isCapacityError || err.isDuplicateError) ? 'Save' : 'Retry';
        saveBtn.disabled = false;
      }
    });
  }

  function renderListView(container, { groups, nameMap, onEdit, onDelete, onNew, onClose, newAlertDisabled, alertCount, statusMessage }) {
    const sorted = [...groups].sort((a, b) => a.itemId - b.itemId);
    const rows = sorted.map((g, idx) => {
      const itemName = nameMap.get(g.itemId) || `Item #${g.itemId}`;
      const worldPills = g.worlds.map(worldPillHtml).join('');
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
      ? 'disabled title="Navigate to an item page to create alerts" style="background:#333;border:none;color:#666;padding:12px 32px;border-radius:6px;cursor:not-allowed;display:inline-flex;align-items:center;justify-content:center;font-size:16px"'
      : 'style="background:#1a5a2a;border:none;color:#fff;padding:12px 32px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:16px"';

    const capacityLine = typeof alertCount === 'number'
      ? `<div style="color:#888;font-size:13px;margin-bottom:12px">Alert slots: ${alertCount} / 40 used</div>`
      : '';

    const statusBanner = statusMessage
      ? `<div data-status-banner style="background:#3a3a1a;border:1px solid #665;color:#dda;font-size:13px;padding:8px 12px;border-radius:4px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center"><span>${escHtml(statusMessage)}</span><span data-action="dismiss-banner" style="cursor:pointer;color:#888;font-size:16px;margin-left:8px">\u2715</span></div>`
      : '';

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0;color:#fff">Bulk Alerts</h3>
        <span data-action="close" style="cursor:pointer;color:#888;font-size:18px">\u2715</span>
      </div>
      ${capacityLine}
      ${statusBanner}
      <div data-list-area style="max-height:500px;overflow-y:auto">${rows}</div>
      <div style="margin-top:12px;text-align:center">
        <button data-action="new-alert" ${newAlertAttrs}>New Alert</button>
      </div>
      ${attributionHtml(true)}`;

    // Event delegation — remove stale listener from previous render to avoid duplicates.
    // innerHTML = '' only removes child nodes, not listeners on the container itself,
    // so list→form→back→list stacks duplicate handlers without this cleanup.
    if (container._listClickHandler) {
      container.removeEventListener('click', container._listClickHandler);
    }
    const handler = (e) => {
      const action = e.target.dataset.action;
      if (action === 'close') { onClose(); return; }
      if (action === 'dismiss-banner') { const banner = container.querySelector('[data-status-banner]'); if (banner) banner.remove(); return; }
      if (action === 'new-alert') { if (!newAlertDisabled) onNew(); return; }
      const idx = Number(e.target.dataset.groupIdx);
      const group = sorted[idx];
      if (!group) return;
      if (action === 'edit') onEdit(group);
      if (action === 'delete') onDelete(group, idx, e.target);
    };
    container._listClickHandler = handler;
    container.addEventListener('click', handler);
    injectKofi(container);
  }

  function openBulkModal({ groups, nameMap, currentItemId, currentItemName, alertCount }) {
    const { overlay, inner: innerContainer } = createModalShell();

    function showEmptyState() {
      innerContainer.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="margin:0;color:#fff">Bulk Alerts</h3>
          <span data-action="close-empty" style="cursor:pointer;color:#888;font-size:18px">\u2715</span>
        </div>
        <p style="color:#888;text-align:center;padding:24px 0">No alerts yet. Navigate to an item page to create one.</p>
        ${attributionHtml(false)}`;
      innerContainer.querySelector('[data-action="close-empty"]').addEventListener('click', () => closeModal());
      injectKofi(innerContainer);
    }

    function showListView(currentGroups, currentAlertCount, statusMessage) {
      innerContainer.innerHTML = '';
      renderListView(innerContainer, {
        groups: currentGroups, nameMap,
        newAlertDisabled: !currentItemId,
        alertCount: currentAlertCount,
        statusMessage,
        onEdit: (group) => showFormView(group, currentGroups, currentAlertCount),
        onDelete: (group, idx, btn) => {
          handleListDelete(group, idx, btn, innerContainer, () => {
            if (currentItemId) {
              showFormView(null, null, currentAlertCount);
            } else {
              showEmptyState();
            }
          });
        },
        onNew: () => showFormView(null, currentGroups, currentAlertCount),
        onClose: () => closeModal(),
      });
    }

    function enrichGroups(groups) {
      groups.forEach(g => {
        g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap.worldById(w.worldId)?.worldName || '' }));
        g.worlds.sort((a, b) => a.worldId - b.worldId);
      });
    }

    function showFormView(group, currentGroupsForBack, currentAlertCount) {
      innerContainer.innerHTML = '';
      const onBack = currentGroupsForBack ? () => showListView(currentGroupsForBack, currentAlertCount) : null;
      const itemId = group ? group.itemId : currentItemId;
      const itemName = group ? (nameMap.get(group.itemId) || `Item #${group.itemId}`) : currentItemName;

      const onSave = async (formState, onProgress) => {
        onProgress?.({ phase: 'refreshing' });
        const freshAlerts = await _API().getAlerts();
        const freshGroups = _Grouping().groupAlerts(freshAlerts);
        enrichGroups(freshGroups);

        const normalizeTrigger = _Grouping().normalizeTrigger;
        const isEditing = !!group;
        const originalTriggerKey = group ? normalizeTrigger(group.trigger) : null;
        const formTriggerKey = normalizeTrigger(formState.trigger);

        // When editing, match by original trigger to find the group even if the user
        // changed the trigger. When creating new, match by form trigger for duplicate detection.
        const matchKey = originalTriggerKey || formTriggerKey;
        const freshGroup = matchKey
          ? freshGroups.find(g => g.itemId === itemId && normalizeTrigger(g.trigger) === matchKey) || null
          : null;

        // Pass freshGroup so computeSaveOps knows which worlds already have alerts.
        const ops = _SaveOps().computeSaveOps(freshGroup, formState, _WorldMap.WORLDS, freshAlerts.length);

        // New alerts should only create, never delete existing alerts.
        // Edits can delete (deselected worlds) and recreate (changed trigger/name).
        if (!isEditing) {
          ops.deletesAfterSuccess = [];
          // Recompute capacity without deletes freeing slots
          const maxAlerts = _SaveOps().MAX_ALERTS;
          if (ops.postsNeeded.length > 0 && freshAlerts.length + ops.postsNeeded.length > maxAlerts) {
            const available = maxAlerts - freshAlerts.length;
            ops.capacityError = `Not enough alert slots (need ${ops.postsNeeded.length}, only ${available} available)`;
          }
        }

        if (ops.capacityError) {
          const err = new Error(ops.capacityError);
          err.isCapacityError = true;
          throw err;
        }

        // Duplicate check: for new alerts, all selected worlds already covered.
        // For edits, nothing changed.
        if (ops.postsNeeded.length === 0 && ops.deletesAfterSuccess.length === 0) {
          const label = nameMap.get(itemId) || formState.name || `Item #${itemId}`;
          const rule = formatRuleText(formState.trigger);
          const msg = isEditing ? 'No changes to save' : `Alert "${label}" (${rule}) already exists on selected worlds`;
          const err = new Error(msg);
          err.isDuplicateError = true;
          throw err;
        }
        const availableSlots = _SaveOps().MAX_ALERTS - freshAlerts.length;
        await _SaveOps().executeSaveOps(ops, itemId, formState, { onProgress, availableSlots });

        // Build status message for partial skips (new alerts only)
        let statusMessage = null;
        if (!isEditing && ops.skippedWorlds && ops.skippedWorlds.length > 0) {
          const names = ops.skippedWorlds.map(w => w.worldName || w.worldId).join(', ');
          statusMessage = `Skipped ${ops.skippedWorlds.length} world(s) where alert already exists: ${names}`;
        }

        const updatedAlerts = await _API().getAlerts();
        const updatedGroups = _Grouping().groupAlerts(updatedAlerts);
        enrichGroups(updatedGroups);

        // Re-read <h1> for current page item — it may not have been rendered
        // when handleClick first ran (SPA navigations render content async)
        if (currentItemId && !nameMap.has(currentItemId)) {
          const h1 = document.querySelector('h1');
          if (h1) {
            const name = h1.textContent.trim().replace(/^\d+\s+/, '');
            if (name) nameMap.set(currentItemId, name);
          }
        }

        showListView(updatedGroups, updatedAlerts.length, statusMessage);
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
      pillsContainer.innerHTML = failures.map(worldPillHtml).join('');
    }
  }

  function openErrorModal(message) {
    const { overlay, inner } = createModalShell();

    inner.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0;color:#fff">Bulk Alerts</h3>
        <span data-action="close-error" style="cursor:pointer;color:#888;font-size:18px">\u2715</span>
      </div>
      <p style="color:#ff6b6b;text-align:center;padding:24px 0">${message}</p>
      ${attributionHtml(false)}`;
    inner.querySelector('[data-action="close-error"]').addEventListener('click', () => closeModal());

    injectKofi(inner);
  }

  function openLoadingModal() {
    // Inject @keyframes once
    if (!document.getElementById('univ-spinner-style')) {
      const style = document.createElement('style');
      style.id = 'univ-spinner-style';
      style.textContent = '@keyframes spin { to { transform: rotate(360deg) } }';
      document.head.appendChild(style);
    }

    const { overlay, inner } = createModalShell();

    inner.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0;color:#fff">Bulk Alerts</h3>
        <span data-action="close-loading" style="cursor:pointer;color:#888;font-size:18px">\u2715</span>
      </div>
      <div style="text-align:center;padding:48px 0">
        <div data-spinner style="display:inline-block;width:32px;height:32px;border:3px solid #444;border-top-color:#bc9df9;border-radius:50%;animation:spin 0.8s linear infinite"></div>
        <p style="color:#888;margin-top:16px">Loading alerts\u2026</p>
      </div>`;
    inner.querySelector('[data-action="close-loading"]').addEventListener('click', () => closeModal());
  }

  return { closeModal, formatRule, renderListView, handleListDelete, openBulkModal, openErrorModal, openLoadingModal };
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
    btn.textContent = 'Bulk Alerts';
    btn.style.cssText = 'background:#bc9df9;border:none;color:#fff;padding:8px 16px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;margin-right:8px;font-weight:700';
    btn.addEventListener('mouseenter', () => { btn.style.background = '#a07de0'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#bc9df9'; });
    btn.addEventListener('click', handleClick);
    const accountLink = section.querySelector('a[href="/account"]');
    const accountDiv = accountLink ? accountLink.parentElement : null;
    section.style.alignItems = 'center';
    if (accountDiv) {
      accountDiv.style.whiteSpace = 'nowrap';
      accountDiv.insertBefore(btn, accountDiv.firstChild);
    } else {
      section.insertBefore(btn, section.firstChild);
    }
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
    _Modal().openLoadingModal();

    let allAlerts;
    try {
      allAlerts = await _API().getAlerts();
    } catch {
      // If user closed the loading modal while waiting, don't pop up the error
      if (!document.getElementById('univ-alert-modal')) return;
      _Modal().openErrorModal('Failed to load alerts \u2014 an error occurred with the Universalis alerts API');
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
      g.worlds.sort((a, b) => a.worldId - b.worldId);
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
