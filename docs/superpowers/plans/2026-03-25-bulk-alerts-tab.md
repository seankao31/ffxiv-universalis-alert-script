# Bulk Alerts Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Bulk Alerts" tab to the universalis.app account page navigation that renders the alerts manager into the existing page layout at `/account/bulk-alerts`, instead of replacing the native alerts page.

**Architecture:** `AlertsPage` gains two new functions: `injectTab()` (adds nav button on any `/account/*` page) and `fetchItemNames()` (fetches item names from `/account/alerts` HTML). `renderAlertsPanel` and `handleInitError` are updated to accept a container parameter. `init()` is reworked to render into `<main>`'s second child div. `Init.route()` adds two new routing rules.

**Tech Stack:** Vanilla JS (ES6), Jest + jsdom, TamperMonkey userscript

**Spec:** `docs/superpowers/specs/2026-03-25-bulk-alerts-tab-design.md`

---

### Task 1: Add `fetchItemNames()`

New function that fetches `/account/alerts` HTML and parses item names from it. No changes to existing code — purely additive.

**Files:**
- Modify: `src/alerts-page.js` (add function, add to return object)
- Test: `tests/alerts-page.test.js`

- [ ] **Step 1: Write failing tests for `fetchItemNames()`**

Add a new describe block at the end of the test file:

```js
describe('fetchItemNames', () => {
  test('parses item names from fetched /account/alerts HTML', async () => {
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body><a href="/market/44015">木棉原木</a><a href="/market/99">Other</a></body></html>'),
    });
    const map = await AlertsPage.fetchItemNames();
    expect(map.get(44015)).toBe('木棉原木');
    expect(map.get(99)).toBe('Other');
    expect(fetch).toHaveBeenCalledWith('/account/alerts');
  });

  test('returns empty Map when fetch fails', async () => {
    fetch.mockRejectedValue(new Error('Network error'));
    const map = await AlertsPage.fetchItemNames();
    expect(map.size).toBe(0);
  });

  test('returns empty Map when response has no market links', async () => {
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body><p>No alerts</p></body></html>'),
    });
    const map = await AlertsPage.fetchItemNames();
    expect(map.size).toBe(0);
  });

  test('returns empty Map when response is not ok', async () => {
    fetch.mockResolvedValue({ ok: false, status: 403 });
    const map = await AlertsPage.fetchItemNames();
    expect(map.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/alerts-page.test.js -t "fetchItemNames"`
Expected: FAIL — `AlertsPage.fetchItemNames is not a function`

- [ ] **Step 3: Implement `fetchItemNames()`**

In `src/alerts-page.js`, add this function inside the IIFE (after `scrapeItemNames`):

```js
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
```

Add `fetchItemNames` to the return object:

```js
  return { init, scrapeItemNames, fetchItemNames, renderAlertsPanel, deleteGroup, handleInitError };
```

Note: `DOMParser` is available in jsdom (Jest's test environment), so no extra setup needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --no-coverage tests/alerts-page.test.js -t "fetchItemNames"`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/alerts-page.js tests/alerts-page.test.js
git commit -m "feat: add fetchItemNames to parse item names from alerts page HTML"
```

---

### Task 2: Update `renderAlertsPanel` to accept container parameter

Change `renderAlertsPanel(alerts, nameMap)` → `renderAlertsPanel(alerts, nameMap, container)`. The panel renders into the provided container instead of `document.body.prepend`. All existing tests must be updated to pass a container.

**Files:**
- Modify: `src/alerts-page.js:33-156` (renderAlertsPanel function)
- Test: `tests/alerts-page.test.js` (update all renderAlertsPanel tests)

- [ ] **Step 1: Update existing tests to pass a container element**

Every test that calls `AlertsPage.renderAlertsPanel(alerts, nameMap)` must change to create a container div and pass it as the third argument. The container should be appended to `document.body` so that DOM queries still work.

Add a helper near the top of the test file (after `setupNativeDOM`):

```js
function createContainer() {
  const container = document.createElement('div');
  container.id = 'test-container';
  document.body.appendChild(container);
  return container;
}
```

Here are the complete updated tests for **every** affected describe block. Remove all `setupNativeDOM()` calls from these blocks — only `scrapeItemNames` tests use it now.

**`renderAlertsPanel` describe block:**

```js
describe('renderAlertsPanel', () => {
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'My Alert', discordWebhook: 'https://wh.com',
    triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };

  test('injects panel with id univ-alert-panel', () => {
    const container = createContainer();
    const nameMap = new Map([[44015, '木棉原木']]);
    AlertsPage.renderAlertsPanel([alert1], nameMap, container);
    expect(document.getElementById('univ-alert-panel')).not.toBeNull();
  });

  test('renders one row per logical alert group', () => {
    const container = createContainer();
    const alert2 = { ...alert1, id: 'a2', worldId: 4031 }; // same group
    const nameMap = new Map([[44015, '木棉原木']]);
    AlertsPage.renderAlertsPanel([alert1, alert2], nameMap, container);
    const rows = document.querySelectorAll('#univ-alert-panel [data-group-row]');
    expect(rows).toHaveLength(1);
  });

  test('displays "Item #44015" for items not in nameMap', () => {
    const container = createContainer();
    AlertsPage.renderAlertsPanel([alert1], new Map(), container);
    expect(document.getElementById('univ-alert-panel').textContent).toContain('Item #44015');
  });

  test('clears container before re-rendering (stale panel cleanup)', () => {
    const container = createContainer();
    const nameMap = new Map([[44015, '木棉原木']]);
    AlertsPage.renderAlertsPanel([alert1], nameMap, container);
    AlertsPage.renderAlertsPanel([alert1], nameMap, container);
    expect(document.querySelectorAll('#univ-alert-panel')).toHaveLength(1);
  });
});
```

**`renderAlertsPanel — edit onSave re-fetch` describe block:**

```js
describe('renderAlertsPanel — edit onSave re-fetch', () => {
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'My Alert', discordWebhook: 'https://wh.com',
    triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };

  test('edit onSave re-fetches alerts before computing ops', async () => {
    const container = createContainer();
    const nameMap = new Map([[44015, '木棉原木']]);

    // First render — initial alerts
    API.getAlerts.mockResolvedValue([alert1]);
    AlertsPage.renderAlertsPanel([alert1], nameMap, container);

    // Click the edit button
    const editBtn = document.querySelector('#univ-alert-panel [data-action="edit"]');
    API.getAlerts.mockResolvedValue([alert1]); // re-fetch inside edit click handler
    editBtn.click();
    await new Promise(r => setTimeout(r, 0));

    // Modal.openModal should have been called
    expect(Modal.openModal).toHaveBeenCalled();
    const { onSave } = Modal.openModal.mock.calls[0][0];

    // Set up mocks for onSave
    const onProgress = jest.fn();
    const formState = { name: 'Test', webhook: 'https://wh.com', trigger: alert1.trigger, selectedWorldIds: new Set([4030]) };
    SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [], deletesAfterSuccess: [] });
    SaveOps.executeSaveOps.mockResolvedValue();

    // Return fresh data on onSave re-fetch
    const alert2 = { ...alert1, id: 'a2', worldId: 4031 };
    const getAlertsCallCount = API.getAlerts.mock.calls.length;
    API.getAlerts.mockResolvedValue([alert1, alert2]);

    await onSave(formState, onProgress);

    // Should have called getAlerts again inside onSave (for re-fetch before computeSaveOps)
    expect(API.getAlerts.mock.calls.length).toBeGreaterThan(getAlertsCallCount);
    // onProgress should have been called with 'refreshing' phase
    expect(onProgress).toHaveBeenCalledWith({ phase: 'refreshing' });
    // computeSaveOps should have been called
    expect(SaveOps.computeSaveOps).toHaveBeenCalled();
    // Panel should have re-rendered in the same container
    expect(container.querySelector('#univ-alert-panel')).not.toBeNull();
  });
});
```

**`renderAlertsPanel — edit re-fetch failure` describe block:**

```js
describe('renderAlertsPanel — edit re-fetch failure', () => {
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'My Alert', discordWebhook: 'https://wh.com',
    triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };

  test('shows native alert when re-fetch fails on edit click', async () => {
    const container = createContainer();
    const nameMap = new Map([[44015, '木棉原木']]);
    AlertsPage.renderAlertsPanel([alert1], nameMap, container);

    // First getAlerts (edit click re-fetch) fails
    API.getAlerts.mockRejectedValue(new Error('Network error'));
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

    const editBtn = document.querySelector('#univ-alert-panel [data-action="edit"]');
    editBtn.click();
    await new Promise(r => setTimeout(r, 0));

    expect(alertSpy).toHaveBeenCalledWith('Failed to load alerts — check your connection');
    expect(Modal.openModal).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
```

**`renderAlertsPanel — formatRule in table` describe block:**

```js
describe('renderAlertsPanel — formatRule in table', () => {
  test('displays HQ badge for triggers with hq filter', () => {
    const container = createContainer();
    const hqAlert = { id: 'a1', itemId: 44015, worldId: 4030, name: 'HQ Alert', discordWebhook: 'https://wh.com',
      triggerVersion: 0, trigger: { filters: ['hq'], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 100 } } } };
    AlertsPage.renderAlertsPanel([hqAlert], new Map([[44015, '木棉原木']]), container);
    const panel = document.getElementById('univ-alert-panel');
    expect(panel.innerHTML).toContain('HQ');
  });

  test('displays gt comparator as >', () => {
    const container = createContainer();
    const gtAlert = { id: 'a1', itemId: 44015, worldId: 4030, name: 'GT Alert', discordWebhook: 'https://wh.com',
      triggerVersion: 0, trigger: { filters: [], mapper: 'quantity', reducer: 'max', comparison: { gt: { target: 500 } } } };
    AlertsPage.renderAlertsPanel([gtAlert], new Map([[44015, '木棉原木']]), container);
    const panel = document.getElementById('univ-alert-panel');
    expect(panel.textContent).toContain('>');
    expect(panel.textContent).toContain('500');
  });
});
```

**`renderAlertsPanel — world name enrichment` describe block:**

```js
describe('renderAlertsPanel — world name enrichment', () => {
  test('enriches group worlds with worldName from WorldMap', () => {
    const container = createContainer();
    const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com',
      triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };
    AlertsPage.renderAlertsPanel([alert1], new Map([[44015, '木棉原木']]), container);
    const panel = document.getElementById('univ-alert-panel');
    expect(panel.textContent).toContain('利維坦');
  });
});
```

**`delete button — retry on partial failure` describe block:**

```js
describe('delete button — retry on partial failure', () => {
  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'My Alert', discordWebhook: 'https://wh.com',
    triggerVersion: 0, trigger };
  const alert2 = { ...alert1, id: 'a2', worldId: 4031 };
  const alert3 = { ...alert1, id: 'a3', worldId: 4032 };

  test('shows "Queued…" with reduced opacity immediately on delete click', () => {
    const container = createContainer();
    API.deleteAlert.mockReturnValue(new Promise(() => {})); // never resolves
    AlertsPage.renderAlertsPanel([alert1, alert2], new Map([[44015, '木棉原木']]), container);

    const deleteBtn = document.querySelector('[data-action="delete"]');
    deleteBtn.click();

    expect(deleteBtn.textContent).toBe('Queued\u2026');
    expect(deleteBtn.disabled).toBe(true);
    expect(deleteBtn.style.opacity).toBe('0.7');
  });

  test('shows "Retry (N remaining)" and updates pills on partial delete failure', async () => {
    const container = createContainer();
    // First delete succeeds, second fails, third fails
    API.deleteAlert
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('500'))
      .mockRejectedValueOnce(new Error('500'));

    AlertsPage.renderAlertsPanel([alert1, alert2, alert3], new Map([[44015, '木棉原木']]), container);

    const deleteBtn = document.querySelector('[data-action="delete"]');
    deleteBtn.click();
    await new Promise(r => setTimeout(r, 0));

    // Button should show retry text and be re-enabled
    expect(deleteBtn.textContent).toBe('Retry (2 remaining)');
    expect(deleteBtn.disabled).toBe(false);

    // World pills should only show the 2 failed worlds
    const row = deleteBtn.closest('tr');
    const pills = row.querySelectorAll('td:nth-child(3) span');
    expect(pills).toHaveLength(2);
  });

  test('removes row when all deletes succeed', async () => {
    const container = createContainer();
    API.deleteAlert.mockResolvedValue();

    AlertsPage.renderAlertsPanel([alert1, alert2], new Map([[44015, '木棉原木']]), container);

    const deleteBtn = document.querySelector('[data-action="delete"]');
    const row = deleteBtn.closest('tr');
    deleteBtn.click();
    await new Promise(r => setTimeout(r, 0));

    expect(row.parentNode).toBeNull(); // removed from DOM
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/alerts-page.test.js`
Expected: FAIL — `renderAlertsPanel` still renders into `document.body` instead of the container, so `container.querySelector(...)` calls won't find the panel

- [ ] **Step 3: Update `renderAlertsPanel` implementation**

In `src/alerts-page.js`, change the function signature and body:

```js
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
```

Key changes from current code:
- Removed `const existing = document.getElementById('univ-alert-panel'); if (existing) existing.remove();` — replaced by `container.innerHTML = ''`
- Removed `document.body.prepend(panel)` — replaced by `container.appendChild(panel)`
- onSave callback: replaced `scrapeItemNames()` merge with closed-over `nameMap`; calls `renderAlertsPanel(updatedAlerts, nameMap, container)` instead

- [ ] **Step 4: Run all tests to verify they pass**

Run: `npx jest --no-coverage tests/alerts-page.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/alerts-page.js tests/alerts-page.test.js
git commit -m "refactor: renderAlertsPanel accepts container parameter"
```

---

### Task 3: Update `handleInitError` to accept container parameter

Small change — `handleInitError()` → `handleInitError(container)`.

**Files:**
- Modify: `src/alerts-page.js:225-231` (handleInitError)
- Test: `tests/alerts-page.test.js` (update init failure test)

- [ ] **Step 1: Replace the existing test**

Remove the entire `init — GET failure` describe block (lines 70-84 in the original test file) and replace it with:

```js
describe('handleInitError', () => {
  test('renders error message into container', async () => {
    const container = createContainer();
    await AlertsPage.handleInitError(container);

    expect(document.getElementById('univ-alert-panel')).toBeNull();
    const errorEl = container.querySelector('[data-init-error]');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('Failed to load existing alerts');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --no-coverage tests/alerts-page.test.js -t "handleInitError"`
Expected: FAIL — error element rendered into `document.body`, not `container`

- [ ] **Step 3: Update `handleInitError` implementation**

```js
  async function handleInitError(container) {
    const errorEl = document.createElement('div');
    errorEl.dataset.initError = '';
    errorEl.style.cssText = 'color:#ff6b6b;padding:24px;font-size:16px;width:100%';
    errorEl.textContent = 'Failed to load existing alerts — check your connection';
    container.innerHTML = '';
    container.appendChild(errorEl);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --no-coverage tests/alerts-page.test.js -t "handleInitError"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/alerts-page.js tests/alerts-page.test.js
git commit -m "refactor: handleInitError accepts container parameter"
```

---

### Task 4: Add `injectTab()`

New function that injects a "Bulk Alerts" button into the account page navigation.

**Files:**
- Modify: `src/alerts-page.js` (add function, add to return object)
- Test: `tests/alerts-page.test.js`

- [ ] **Step 1: Write failing tests for `injectTab()`**

```js
describe('injectTab', () => {
  function setupAccountDOM() {
    document.body.innerHTML = `
      <main>
        <div id="nav-div"><button>Account</button><button>Alerts</button></div>
        <div id="content-div"><p>Page content</p></div>
      </main>`;
  }

  test('appends Bulk Alerts button to first div of <main>', () => {
    setupAccountDOM();
    AlertsPage.injectTab();
    const navDiv = document.querySelector('main > div:first-child');
    const btn = navDiv.querySelector('#univ-bulk-alerts-tab');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('Bulk Alerts');
  });

  test('is idempotent — second call does not duplicate button', () => {
    setupAccountDOM();
    AlertsPage.injectTab();
    AlertsPage.injectTab();
    const buttons = document.querySelectorAll('#univ-bulk-alerts-tab');
    expect(buttons).toHaveLength(1);
  });

  test('click calls history.pushState to /account/bulk-alerts', () => {
    setupAccountDOM();
    window.history.pushState = jest.fn();
    // Mock fetch and API.getAlerts so the init() triggered by click doesn't error
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<html><body></body></html>') });
    API.getAlerts.mockResolvedValue([]);

    AlertsPage.injectTab();
    const btn = document.querySelector('#univ-bulk-alerts-tab');
    btn.click();

    expect(window.history.pushState).toHaveBeenCalledWith({}, '', '/account/bulk-alerts');
  });

  test('click triggers init — renders panel into content div', async () => {
    setupAccountDOM();
    window.history.pushState = jest.fn();
    const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com',
      triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body><a href="/market/44015">木棉原木</a></body></html>'),
    });
    API.getAlerts.mockResolvedValue([alert1]);

    AlertsPage.injectTab();
    const btn = document.querySelector('#univ-bulk-alerts-tab');
    btn.click();
    await new Promise(r => setTimeout(r, 0));

    const contentDiv = document.querySelector('main > div:nth-child(2)');
    expect(contentDiv.querySelector('#univ-alert-panel')).not.toBeNull();
  });

  test('waits for <main> via MutationObserver when not yet in DOM', async () => {
    document.body.innerHTML = '<div>Loading...</div>';
    AlertsPage.injectTab();
    // Not yet injected
    expect(document.querySelector('#univ-bulk-alerts-tab')).toBeNull();

    // Simulate SPA render — add <main> to DOM
    const main = document.createElement('main');
    main.innerHTML = '<div><button>Account</button></div><div></div>';
    document.body.appendChild(main);

    await new Promise(r => setTimeout(r, 0));

    expect(document.querySelector('#univ-bulk-alerts-tab')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/alerts-page.test.js -t "injectTab"`
Expected: FAIL — `AlertsPage.injectTab is not a function`

- [ ] **Step 3: Implement `injectTab()`**

In `src/alerts-page.js`, add inside the IIFE (before `init`):

```js
  function injectTab() {
    function inject() {
      if (document.getElementById('univ-bulk-alerts-tab')) return true; // idempotent
      const main = document.querySelector('main');
      if (!main) return false;
      const navDiv = main.querySelector(':scope > div:first-child');
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
```

Add `injectTab` to the return object:

```js
  return { init, injectTab, scrapeItemNames, fetchItemNames, renderAlertsPanel, deleteGroup, handleInitError };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --no-coverage tests/alerts-page.test.js -t "injectTab"`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/alerts-page.js tests/alerts-page.test.js
git commit -m "feat: add injectTab to inject Bulk Alerts button into account nav"
```

---

### Task 5: Rework `init()` to render into `<main>` second div

The big change: `init()` no longer hides native content or prepends to body. It finds `<main>`'s second child div, fetches item names via `fetchItemNames()`, and renders the panel there.

**Files:**
- Modify: `src/alerts-page.js:175-222` (init function)
- Test: `tests/alerts-page.test.js` (replace init tests)

- [ ] **Step 1: Replace existing init tests**

Remove the old `init — stale panel cleanup and native content hiding` describe block entirely. Replace with:

```js
describe('init — renders into <main> content div', () => {
  function setupAccountDOM() {
    document.body.innerHTML = `
      <main>
        <div><button>Account</button></div>
        <div id="content-div"><p>Native content</p></div>
      </main>`;
  }

  test('renders alerts panel into second div of <main>', async () => {
    setupAccountDOM();
    const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com',
      triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };
    API.getAlerts.mockResolvedValue([alert1]);
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body><a href="/market/44015">木棉原木</a></body></html>'),
    });

    AlertsPage.init();
    await new Promise(r => setTimeout(r, 0));

    const contentDiv = document.querySelector('main > div:nth-child(2)');
    expect(contentDiv.querySelector('#univ-alert-panel')).not.toBeNull();
    expect(contentDiv.textContent).toContain('木棉原木');
  });

  test('renders error into content div when getAlerts fails', async () => {
    setupAccountDOM();
    API.getAlerts.mockRejectedValue(new Error('fail'));
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body></body></html>'),
    });

    AlertsPage.init();
    await new Promise(r => setTimeout(r, 0));

    const contentDiv = document.querySelector('main > div:nth-child(2)');
    const errorEl = contentDiv.querySelector('[data-init-error]');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('Failed to load existing alerts');
  });

  test('does not hide native body content', async () => {
    setupAccountDOM();
    API.getAlerts.mockResolvedValue([]);
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body></body></html>'),
    });

    AlertsPage.init();
    await new Promise(r => setTimeout(r, 0));

    const navDiv = document.querySelector('main > div:first-child');
    expect(navDiv.style.display).not.toBe('none');
  });

  test('waits for <main> with 2 child divs via MutationObserver', async () => {
    document.body.innerHTML = '<div>Loading...</div>';
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body></body></html>'),
    });
    API.getAlerts.mockResolvedValue([]);

    AlertsPage.init();

    // No panel yet
    expect(document.querySelector('#univ-alert-panel')).toBeNull();

    // Simulate SPA render — add <main> with 2 child divs
    const main = document.createElement('main');
    main.innerHTML = '<div><button>Account</button></div><div></div>';
    document.body.appendChild(main);

    await new Promise(r => setTimeout(r, 0));

    const contentDiv = main.querySelector(':scope > div:nth-child(2)');
    expect(contentDiv.querySelector('#univ-alert-panel')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/alerts-page.test.js -t "init — renders"`
Expected: FAIL — `init()` still uses old rendering logic

- [ ] **Step 3: Rewrite `init()` implementation**

Replace the entire `init` function in `src/alerts-page.js`:

```js
  function init() {
    function findContentDiv() {
      const main = document.querySelector('main');
      if (!main) return null;
      const divs = main.querySelectorAll(':scope > div');
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
```

Key changes:
- No more `scrapeItemNames()` — uses `fetchItemNames()`
- No more hiding native content (`display: none` loop removed)
- No more restoring native content on error
- MutationObserver waits for `<main>` with at least 2 child divs (replaces old observer that waited for market links)
- No more stale panel cleanup (container.innerHTML handles it)
- Renders into `contentDiv` via `renderAlertsPanel(alerts, nameMap, contentDiv)`
- Errors render via `handleInitError(contentDiv)`

- [ ] **Step 4: Run all tests**

Run: `npx jest --no-coverage tests/alerts-page.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/alerts-page.js tests/alerts-page.test.js
git commit -m "feat: rework init to render into <main> content div using fetchItemNames"
```

---

### Task 6: Update routing in `Init.route()`

Add `/account/*` → `injectTab()` and `/account/bulk-alerts` → `init()`. Remove old `/account/alerts` mapping.

**Files:**
- Modify: `src/init.js:2-9` (route function)
- Test: `tests/init.test.js`

- [ ] **Step 1: Update existing tests and add new ones**

The global mock at the top needs `injectTab` added:

```js
global.AlertsPage = { init: jest.fn(), injectTab: jest.fn() };
```

Replace the `route — alerts page dispatch` describe block:

```js
describe('route — account page dispatch', () => {
  test('routes /account/bulk-alerts to both injectTab and init', () => {
    delete window.location;
    window.location = { pathname: '/account/bulk-alerts' };
    requireInit();
    expect(AlertsPage.injectTab).toHaveBeenCalled();
    expect(AlertsPage.init).toHaveBeenCalled();
  });

  test('routes /account/alerts to injectTab only (native page preserved)', () => {
    delete window.location;
    window.location = { pathname: '/account/alerts' };
    requireInit();
    expect(AlertsPage.injectTab).toHaveBeenCalled();
    expect(AlertsPage.init).not.toHaveBeenCalled();
  });

  test('routes /account/characters to injectTab only', () => {
    delete window.location;
    window.location = { pathname: '/account/characters' };
    requireInit();
    expect(AlertsPage.injectTab).toHaveBeenCalled();
    expect(AlertsPage.init).not.toHaveBeenCalled();
  });
});
```

Update the `no-op paths` describe block — remove the `/account/settings` test since it now matches `/account/*`:

```js
describe('route — no-op paths', () => {
  test('does nothing for root path', () => {
    delete window.location;
    window.location = { pathname: '/' };
    requireInit();
    expect(MarketPage.init).not.toHaveBeenCalled();
    expect(AlertsPage.init).not.toHaveBeenCalled();
    expect(AlertsPage.injectTab).not.toHaveBeenCalled();
  });

  test('does nothing for unrelated path', () => {
    delete window.location;
    window.location = { pathname: '/about' };
    requireInit();
    expect(MarketPage.init).not.toHaveBeenCalled();
    expect(AlertsPage.init).not.toHaveBeenCalled();
    expect(AlertsPage.injectTab).not.toHaveBeenCalled();
  });

  test('does nothing for /account with no sub-path', () => {
    delete window.location;
    window.location = { pathname: '/account' };
    requireInit();
    expect(AlertsPage.injectTab).not.toHaveBeenCalled();
    expect(AlertsPage.init).not.toHaveBeenCalled();
  });
});
```

Update the `exported function direct calls` tests:

```js
describe('route — exported function direct calls', () => {
  test('route() can be called directly after module load', () => {
    delete window.location;
    window.location = { pathname: '/' };
    const Init = requireInit();

    MarketPage.init.mockReset();
    Init.route('/market/12345');
    expect(MarketPage.init).toHaveBeenCalledTimes(1);
  });

  test('route() to /account/bulk-alerts calls injectTab and init', () => {
    delete window.location;
    window.location = { pathname: '/' };
    const Init = requireInit();

    AlertsPage.init.mockReset();
    AlertsPage.injectTab.mockReset();
    Init.route('/account/bulk-alerts');
    expect(AlertsPage.injectTab).toHaveBeenCalledTimes(1);
    expect(AlertsPage.init).toHaveBeenCalledTimes(1);
  });

  test('route() to /account/alerts calls injectTab only', () => {
    delete window.location;
    window.location = { pathname: '/' };
    const Init = requireInit();

    AlertsPage.init.mockReset();
    AlertsPage.injectTab.mockReset();
    Init.route('/account/alerts');
    expect(AlertsPage.injectTab).toHaveBeenCalledTimes(1);
    expect(AlertsPage.init).not.toHaveBeenCalled();
  });
});
```

Also add `AlertsPage.injectTab.mockReset()` to the `beforeEach` block:

```js
beforeEach(() => {
  delete window.location;
  window.location = { pathname: '/' };
  document.body.innerHTML = '<div></div>';
  MarketPage.init.mockReset();
  AlertsPage.init.mockReset();
  AlertsPage.injectTab.mockReset();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/init.test.js`
Expected: FAIL — old routing still maps `/account/alerts` → `init()`

- [ ] **Step 3: Update `Init.route()` implementation**

Replace the `route` function in `src/init.js`:

```js
  function route(pathname) {
    if (pathname.startsWith('/market/')) {
      if (pathname.split('/').length === 3) { // /market/{id} only, not sub-paths
        MarketPage.init();
      }
    } else if (pathname.startsWith('/account/') && pathname.split('/').length === 3) {
      AlertsPage.injectTab();
      if (pathname === '/account/bulk-alerts') {
        AlertsPage.init();
      }
    }
  }
```

The condition `pathname.startsWith('/account/') && pathname.split('/').length === 3` matches `/account/alerts`, `/account/characters`, `/account/bulk-alerts`, etc. but NOT `/account` alone or `/account/alerts/sub-path`.

- [ ] **Step 4: Run all tests**

Run: `npx jest --no-coverage tests/init.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/init.js tests/init.test.js
git commit -m "feat: route /account/* to injectTab, /account/bulk-alerts to init"
```

---

### Task 7: Update header and rebuild

**Files:**
- Modify: `src/header.js:8` (change @match)

- [ ] **Step 1: Update the `@match` line**

In `src/header.js`, change line 8:

```js
// @match        https://universalis.app/account/*
```

- [ ] **Step 2: Rebuild the userscript**

Run: `node build.js`
Expected: `Built universalis-alert.user.js (NNNN bytes)`

- [ ] **Step 3: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/header.js universalis-alert.user.js
git commit -m "build: update @match to /account/* and regenerate userscript"
```
