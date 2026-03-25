# Header Button Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the "Bulk Alerts" button from per-page injection to the global header, remove the dedicated alerts page, and make the modal the single interface for all alerts.

**Architecture:** Replace `market-page.js` with `header-button.js` that injects into the header's account section. Redesign `modal.js`'s list view to show all alerts (flat list sorted by item), add `nameMap` and `newAlertDisabled` params, update `openBulkModal` signature, and delete `openModal`. Simplify `init.js` to just call `HeaderButton.init()`.

**Tech Stack:** Vanilla JS (ES6), IIFE + CommonJS dual-export, Jest + jsdom, no bundler.

**Spec:** `docs/superpowers/specs/2026-03-25-header-button-redesign.md`

---

### Task 1: Delete alerts-page.js and clean up build config

**Files:**
- Delete: `src/alerts-page.js`
- Delete: `tests/alerts-page.test.js`
- Modify: `build.js:4-15`
- Modify: `src/header.js:7-8`

This is pure deletion and config changes. No TDD needed.

- [ ] **Step 1: Delete src/alerts-page.js**

- [ ] **Step 2: Delete tests/alerts-page.test.js**

- [ ] **Step 3: Remove alerts-page.js from build.js SRC_ORDER**

Remove the `'src/alerts-page.js',` line from the SRC_ORDER array.

- [ ] **Step 4: Update header.js @match to match all pages**

Replace:
```js
// @match        https://universalis.app/market/*
// @match        https://universalis.app/account/*
```
With:
```js
// @match        https://universalis.app/*
```

- [ ] **Step 5: Run tests to verify nothing breaks**

Run: `npx jest --no-coverage`
Expected: All remaining tests pass. The init.test.js tests that reference `AlertsPage` will still pass because they use mocked globals.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: delete alerts-page module and broaden @match to all pages"
```

---

### Task 2: Update renderFormView — remove multipleGroups

**Files:**
- Modify: `src/modal.js:40,62-65,306`
- Modify: `tests/modal.test.js:91-101`

- [ ] **Step 1: Update tests — remove multipleGroups tests and param usage**

In `tests/modal.test.js`, delete the entire `describe('openModal — multi-group notice')` block (lines 91-101). This removes 2 tests:
- "shows multi-group notice when multipleGroups flag is true"
- "no multi-group notice when flag is false"

No other tests pass `multipleGroups` explicitly (it defaults to `false`), so no other test changes needed.

- [ ] **Step 2: Run tests to verify they pass before implementation changes**

Run: `npx jest --no-coverage tests/modal.test.js`
Expected: PASS (the deleted tests no longer run; remaining tests still work because `multipleGroups` defaults to false)

- [ ] **Step 3: Remove multipleGroups from renderFormView**

In `src/modal.js`:

1. Change line 40 signature from:
```js
function renderFormView(container, { itemId, itemName, group, onSave, onBack, multipleGroups }) {
```
to:
```js
function renderFormView(container, { itemId, itemName, group, onSave, onBack }) {
```

2. Delete lines 62-65 (the `multiNotice` variable and its HTML template).

3. Remove `${multiNotice}` from the container.innerHTML template (line 74).

4. In `showFormView` (line 306), change:
```js
renderFormView(innerContainer, { itemId, itemName, group, onSave, onBack, multipleGroups: false });
```
to:
```js
renderFormView(innerContainer, { itemId, itemName, group, onSave, onBack });
```

- [ ] **Step 4: Run tests**

Run: `npx jest --no-coverage tests/modal.test.js tests/bulk-modal.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modal.js tests/modal.test.js && git commit -m "refactor: remove multipleGroups param from renderFormView"
```

---

### Task 3: Redesign renderListView — new params, flat multi-item list

**Files:**
- Modify: `src/modal.js:185-233` (renderListView function)
- Modify: `tests/modal.test.js:221-438` (renderListView and delete behavior tests)

The list view changes from single-item to multi-item: adds `nameMap` for item name resolution, `newAlertDisabled` for greying out "New Alert", sorts groups by `itemId`, and shows item name + ID per row.

- [ ] **Step 1: Write new tests for renderListView**

Replace the existing `describe('renderListView')` block in `tests/modal.test.js` with updated tests. Key test cases:

```js
describe('renderListView', () => {
  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
  const trigger2 = { filters: [], mapper: 'quantity', reducer: 'max', comparison: { gt: { target: 500 } } };
  const nameMap = new Map([[44015, '木棉原木'], [12345, '鐵礦石']]);

  const groups = [{
    itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
    worlds: [
      { worldId: 4030, alertId: 'a1', worldName: '利維坦' },
      { worldId: 4031, alertId: 'a2', worldName: '鳳凰' },
    ],
  }];

  test('renders one row per alert group', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    expect(container.querySelectorAll('[data-group-row]')).toHaveLength(1);
  });

  test('renders world pills for each group', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    const pills = container.querySelectorAll('[data-group-row="0"] [data-world-pill]');
    expect(pills).toHaveLength(2);
    expect(pills[0].textContent).toBe('利維坦');
    expect(pills[1].textContent).toBe('鳳凰');
  });

  test('renders Edit and Delete buttons per group', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    expect(container.querySelector('[data-action="edit"]')).not.toBeNull();
    expect(container.querySelector('[data-action="delete"]')).not.toBeNull();
  });

  test('renders item name and ID from nameMap', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    const row = container.querySelector('[data-group-row="0"]');
    expect(row.textContent).toContain('木棉原木');
    expect(row.textContent).toContain('#44015');
  });

  test('falls back to Item #ID when nameMap has no entry', () => {
    const container = document.createElement('div');
    const unknownGroups = [{ ...groups[0], itemId: 99999 }];
    Modal.renderListView(container, { groups: unknownGroups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    const row = container.querySelector('[data-group-row="0"]');
    expect(row.textContent).toContain('Item #99999');
  });

  test('sorts groups by itemId so same-item alerts cluster together', () => {
    const container = document.createElement('div');
    const mixedGroups = [
      { itemId: 44015, name: 'A2', discordWebhook: 'https://wh.com', trigger: trigger2, worlds: [{ worldId: 4030, alertId: 'a3', worldName: '利維坦' }] },
      { itemId: 12345, name: 'A1', discordWebhook: 'https://wh.com', trigger, worlds: [{ worldId: 4030, alertId: 'a4', worldName: '利維坦' }] },
      { itemId: 44015, name: 'A3', discordWebhook: 'https://wh.com', trigger, worlds: [{ worldId: 4031, alertId: 'a5', worldName: '鳳凰' }] },
    ];
    Modal.renderListView(container, { groups: mixedGroups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    const rows = container.querySelectorAll('[data-group-row]');
    expect(rows).toHaveLength(3);
    // itemId 12345 first, then two 44015 rows
    expect(rows[0].textContent).toContain('鐵礦石');
    expect(rows[1].textContent).toContain('木棉原木');
    expect(rows[2].textContent).toContain('木棉原木');
  });

  test('header says "Bulk Alerts" without item-specific suffix', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    const header = container.querySelector('h3');
    expect(header.textContent).toBe('Bulk Alerts');
  });

  test('"New Alert" button is enabled when newAlertDisabled is false', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    const btn = container.querySelector('[data-action="new-alert"]');
    expect(btn.disabled).toBe(false);
  });

  test('"New Alert" button is disabled with tooltip when newAlertDisabled is true', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: true });
    const btn = container.querySelector('[data-action="new-alert"]');
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Navigate to an item page to create alerts');
  });

  test('renders formatted rule text', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    expect(container.textContent).toContain('Min');
    expect(container.textContent).toContain('<');
    expect(container.textContent).toContain('130');
  });

  test('"New Alert" button calls onNew callback', () => {
    const container = document.createElement('div');
    const onNew = jest.fn();
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew, onClose: jest.fn(), newAlertDisabled: false });
    container.querySelector('[data-action="new-alert"]').click();
    expect(onNew).toHaveBeenCalled();
  });

  test('Edit button calls onEdit with the group', () => {
    const container = document.createElement('div');
    const onEdit = jest.fn();
    Modal.renderListView(container, { groups, nameMap, onEdit, onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    container.querySelector('[data-action="edit"]').click();
    expect(onEdit).toHaveBeenCalledWith(groups[0]);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx jest --no-coverage tests/modal.test.js -t "renderListView"`
Expected: FAIL — new tests expect `nameMap`, item names in rows, sorting, disabled button behavior.

- [ ] **Step 3: Update renderListView implementation**

Replace `renderListView` in `src/modal.js` (lines 185-233). Key changes:

1. New parameter destructuring: `{ groups, nameMap, onEdit, onDelete, onNew, onClose, newAlertDisabled }`
2. Sort groups by itemId before rendering: `const sorted = [...groups].sort((a, b) => a.itemId - b.itemId);`
3. Add item name + ID to each row: `const itemName = nameMap.get(g.itemId) || 'Item #' + g.itemId;`
4. Header: `Bulk Alerts` (no item suffix)
5. New Alert button: add `disabled` and `title` attributes when `newAlertDisabled` is true

```js
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
              <div style="font-size:14px;color:#fff">${itemName} <span style="font-size:11px;color:#888">#${g.itemId}</span></div>
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
```

- [ ] **Step 4: Update existing delete behavior and no-duplicate-handler tests**

These tests in `modal.test.js` call `renderListView` with the old signature. Update all calls to use the new signature pattern:

```js
// Old:
Modal.renderListView(container, { itemId: 44015, itemName: 'Item', groups, onEdit: jest.fn(), onDelete: ..., onNew: jest.fn(), onClose: jest.fn() });
// New:
Modal.renderListView(container, { groups, nameMap: new Map([[44015, 'Item']]), onEdit: jest.fn(), onDelete: ..., onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
```

Update every `renderListView` call in the delete behavior, queued state, and no-duplicate-handler `describe` blocks.

- [ ] **Step 5: Run all modal tests**

Run: `npx jest --no-coverage tests/modal.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modal.js tests/modal.test.js && git commit -m "feat: redesign renderListView for multi-item flat list with nameMap and newAlertDisabled"
```

---

### Task 4: Redesign openBulkModal — new signature and routing

**Files:**
- Modify: `src/modal.js:235-315` (openBulkModal function)
- Modify: `tests/bulk-modal.test.js` (full rewrite)

The key changes: new signature `({ groups, nameMap, currentItemId, currentItemName })`, updated `showListView`/`showFormView` closures, empty state routing, `onAllDeleted` conditional behavior.

- [ ] **Step 1: Rewrite bulk-modal.test.js**

Replace the entire file. Key test cases for the new signature and routing:

```js
const Modal = require('../src/modal');

global.API = { getAlerts: jest.fn(), deleteAlert: jest.fn(), createAlert: jest.fn() };
global.Grouping = require('../src/grouping');
global.SaveOps = { computeSaveOps: jest.fn(), executeSaveOps: jest.fn() };
global.WorldMap = require('../src/worldmap');

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
  GM_getValue.mockReset();
  GM_setValue.mockReset();
});

const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
const nameMap = new Map([[44015, '木棉原木']]);

describe('openBulkModal — routing', () => {
  test('opens to form view when groups is empty and currentItemId is set', () => {
    Modal.openBulkModal({ groups: [], nameMap, currentItemId: 44015, currentItemName: '木棉原木' });
    const modal = document.querySelector('#univ-alert-modal');
    expect(modal.querySelector('[data-field="name"]')).not.toBeNull();
    expect(modal.querySelector('[data-action="new-alert"]')).toBeNull();
  });

  test('opens to list view with empty state when groups is empty and no currentItemId', () => {
    Modal.openBulkModal({ groups: [], nameMap, currentItemId: null, currentItemName: null });
    const modal = document.querySelector('#univ-alert-modal');
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
    expect(modal.textContent).toContain('No alerts yet');
  });

  test('opens to list view when groups is non-empty', () => {
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木' });
    const modal = document.querySelector('#univ-alert-modal');
    expect(modal.querySelector('[data-action="new-alert"]')).not.toBeNull();
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
  });
});

describe('openBulkModal — navigation', () => {
  const groups = [{
    itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
    worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
  }];

  test('"New Alert" navigates from list to blank form', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木' });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="new-alert"]').click();
    expect(modal.querySelector('[data-field="name"]')).not.toBeNull();
    expect(modal.querySelector('[data-action="back"]')).not.toBeNull();
  });

  test('"← Back to alerts" navigates from form to list', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木' });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="new-alert"]').click();
    modal.querySelector('[data-action="back"]').click();
    expect(modal.querySelector('[data-action="new-alert"]')).not.toBeNull();
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
  });

  test('Edit button navigates to form pre-filled with group data', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木' });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    const nameInput = modal.querySelector('[data-field="name"]');
    expect(nameInput.value).toBe('Alert');
    expect(modal.querySelector('[data-action="back"]')).not.toBeNull();
  });

  test('Edit resolves itemId/itemName from the group via nameMap', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: null, currentItemName: null });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    // Form header should show item name from nameMap
    expect(modal.querySelector('h3').textContent).toContain('木棉原木');
  });

  test('close button dismisses the modal', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木' });
    document.querySelector('#univ-alert-modal [data-action="close"]').click();
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('Escape dismisses the modal', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('overlay background click dismisses the modal', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木' });
    const overlay = document.querySelector('#univ-alert-modal');
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });
});

describe('openBulkModal — form save returns to list', () => {
  test('after save, re-fetches all alerts and shows updated list view', async () => {
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];

    const updatedAlert = { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0, trigger };
    const newAlert = { id: 'a3', itemId: 44015, worldId: 4031, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0, trigger };
    API.getAlerts.mockResolvedValue([updatedAlert, newAlert]);
    SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [], deletesAfterSuccess: [] });
    SaveOps.executeSaveOps.mockResolvedValue();
    GM_getValue.mockReturnValue('https://wh.com');

    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木' });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="new-alert"]').click();
    modal.querySelector('[data-action="save"]').click();
    await new Promise(r => setTimeout(r, 0));

    expect(modal.querySelector('[data-action="new-alert"]')).not.toBeNull();
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
  });
});

describe('openBulkModal — no duplicate deletes after navigation', () => {
  test('delete after list→form→back does not fire duplicate API calls', async () => {
    API.deleteAlert.mockResolvedValue();
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];

    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木' });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="new-alert"]').click();
    modal.querySelector('[data-action="back"]').click();
    modal.querySelector('[data-action="delete"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(API.deleteAlert).toHaveBeenCalledTimes(1);
  });
});

describe('openBulkModal — delete last group', () => {
  test('transitions to form view when last group deleted and currentItemId set', async () => {
    API.deleteAlert.mockResolvedValue();
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];

    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木' });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="delete"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(modal.querySelector('[data-field="name"]')).not.toBeNull();
    expect(modal.querySelector('[data-action="back"]')).toBeNull();
  });

  test('shows empty state when last group deleted and no currentItemId', async () => {
    API.deleteAlert.mockResolvedValue();
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];

    Modal.openBulkModal({ groups, nameMap, currentItemId: null, currentItemName: null });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="delete"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
    expect(modal.textContent).toContain('No alerts yet');
  });
});
```

- [ ] **Step 2: Run new tests to verify they fail**

Run: `npx jest --no-coverage tests/bulk-modal.test.js`
Expected: FAIL — old openBulkModal signature doesn't accept the new params.

- [ ] **Step 3: Update openBulkModal implementation**

Replace `openBulkModal` in `src/modal.js`. Key changes:

1. New signature: `({ groups, nameMap, currentItemId, currentItemName })`
2. `showListView(currentGroups)`:
   - Passes `nameMap` (closed over), `newAlertDisabled: !currentItemId`
   - `onEdit(group)`: calls `showFormView(group)`
   - `onDelete`: `onAllDeleted` checks `currentItemId` — if set, shows form; if null, shows empty state
   - `onNew`: calls `showFormView(null)`
3. `showFormView(group)`:
   - Resolves `itemId`/`itemName`: if `group`, from `group.itemId` + `nameMap`; if null, from `currentItemId`/`currentItemName`
   - `onSave`: re-fetches ALL alerts (no filter by itemId), re-groups, enriches, calls `showListView(updatedGroups)`
4. `showEmptyState()`: renders "No alerts yet. Navigate to an item page to create one." + close button
5. Initial routing: groups empty + currentItemId → form; groups empty + no currentItemId → empty state; groups non-empty → list

```js
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
```

- [ ] **Step 4: Run bulk-modal tests**

Run: `npx jest --no-coverage tests/bulk-modal.test.js`
Expected: PASS

- [ ] **Step 5: Run all modal tests to check for regressions**

Run: `npx jest --no-coverage tests/modal.test.js tests/bulk-modal.test.js`
Expected: modal.test.js tests that use `openModal` still pass (openModal not yet removed). bulk-modal tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modal.js tests/bulk-modal.test.js && git commit -m "feat: redesign openBulkModal for multi-item alerts with new routing"
```

---

### Task 5: Remove openModal and migrate modal.test.js

**Files:**
- Modify: `src/modal.js:317-346,400` (delete openModal, update exports)
- Modify: `tests/modal.test.js` (rewrite tests that use openModal)

All `openModal` tests need to be rewritten to use `openBulkModal`. For tests that tested form view with `group: null` (new alert), use `openBulkModal({ groups: [], nameMap, currentItemId, currentItemName })` which routes to form view. For tests with a `group` (editing), use `openBulkModal` with groups and click Edit.

- [ ] **Step 1: Rewrite modal.test.js tests**

Key migration patterns:

**New alert tests** (previously `openModal({ group: null })`):
```js
// Old:
Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn() });
// New:
Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item' });
```

**Edit tests** (previously `openModal({ group })`):
```js
// Old:
Modal.openModal({ itemId: 44015, itemName: 'Item', group, onSave: jest.fn() });
// New:
const enrichedGroup = { ...group, worlds: group.worlds || [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }] };
Modal.openBulkModal({ groups: [enrichedGroup], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item' });
const modal = document.querySelector('#univ-alert-modal');
modal.querySelector('[data-action="edit"]').click(); // navigate to form
```

**Save tests**: The `onSave` callback is no longer passed externally. Mock `API.getAlerts`, `SaveOps.computeSaveOps`, `SaveOps.executeSaveOps` instead. The save button's behavior (disable, "Saving...", progress, error) is still testable through DOM assertions.

Rewrite these `describe` blocks:
- `openModal — DOM structure` → `openBulkModal — form view DOM structure`
- `openModal — webhook auto-populate` → keep tests, change entry point
- `openModal — pre-population from group` → navigate via Edit
- `openModal — save progress` → mock API/SaveOps globals
- `modal dismiss — Escape and overlay click` → already covered in bulk-modal.test.js, can be removed or kept with new entry point
- `renderFormView — *` tests → change entry point to openBulkModal with empty groups

For the save progress tests specifically, set up mocks like:
```js
API.getAlerts.mockResolvedValue([]);
SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [], deletesAfterSuccess: [] });
SaveOps.executeSaveOps.mockImplementation(async (ops, itemId, formState, { onProgress }) => {
  onProgress({ phase: 'creating', completed: 1, total: 3 });
});
```

Add `global.API`, `global.SaveOps`, and `global.Grouping` setup at the top of `modal.test.js` (currently only some describe blocks set these up). Add them at file scope like `bulk-modal.test.js` does:
```js
global.API = { getAlerts: jest.fn(), deleteAlert: jest.fn(), createAlert: jest.fn() };
global.Grouping = require('../src/grouping');
global.SaveOps = { computeSaveOps: jest.fn(), executeSaveOps: jest.fn() };
global.WorldMap = require('../src/worldmap');
```

- [ ] **Step 2: Run migrated tests to verify they fail**

Run: `npx jest --no-coverage tests/modal.test.js`
Expected: FAIL — tests call openBulkModal with new signature, but openModal entry points are gone.

Actually, after Task 4, openBulkModal already works. But some tests may fail because of the mock setup changes. This step verifies the test rewrites are correct.

- [ ] **Step 3: Delete openModal from modal.js**

1. Delete the entire `openModal` function (lines 317-346).
2. Update the return statement (line 400) from:
```js
return { openModal, closeModal, formatRule, renderListView, handleListDelete, openBulkModal };
```
to:
```js
return { closeModal, formatRule, renderListView, handleListDelete, openBulkModal };
```

- [ ] **Step 4: Run all tests**

Run: `npx jest --no-coverage --testPathIgnorePatterns=market-page`
Expected: PASS (excluding market-page.test.js which still references the deleted `openModal` — it will be deleted in Task 6).

- [ ] **Step 5: Commit**

```bash
git add src/modal.js tests/modal.test.js && git commit -m "refactor: remove openModal, migrate all tests to use openBulkModal"
```

---

### Task 6: Create header-button.js (replaces market-page.js)

**Files:**
- Create: `src/header-button.js`
- Create: `tests/header-button.test.js`
- Delete: `src/market-page.js`
- Delete: `tests/market-page.test.js`
- Modify: `build.js:12` (replace market-page.js with header-button.js)

- [ ] **Step 1: Write tests/header-button.test.js**

```js
const HeaderButton = require('../src/header-button');

global.Modal = { openBulkModal: jest.fn(), closeModal: jest.fn() };
global.API = { getAlerts: jest.fn() };
global.Grouping = require('../src/grouping');
global.WorldMap = require('../src/worldmap');

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
  fetch.mockReset();
});

function setupHeader() {
  document.body.innerHTML = `
    <header><div>
      <div class="header-home"><a href="/"><img src="/logo.png" /></a></div>
      <div class="header-nav"><input type="text" placeholder="search" /></div>
      <div>
        <div><a href="/account">帳號</a><span class="username">testuser</span></div>
        <div><button class="btn-settings">⚙️</button></div>
      </div>
    </div></header>
  `;
}

describe('injectButton', () => {
  test('inserts button as first child of account section', () => {
    setupHeader();
    HeaderButton.injectButton();
    const accountSection = document.querySelector('header a[href="/account"]').closest('header > div > div:last-child');
    expect(accountSection.firstElementChild.id).toBe('univ-alert-btn');
  });

  test('button has correct text', () => {
    setupHeader();
    HeaderButton.injectButton();
    expect(document.getElementById('univ-alert-btn').textContent).toBe('🔔 Bulk Alerts');
  });

  test('is idempotent — does not duplicate', () => {
    setupHeader();
    HeaderButton.injectButton();
    HeaderButton.injectButton();
    expect(document.querySelectorAll('#univ-alert-btn')).toHaveLength(1);
  });

  test('no-op when header account section is absent (logged out)', () => {
    document.body.innerHTML = '<header><div><div class="header-home"></div></div></header>';
    HeaderButton.injectButton();
    expect(document.getElementById('univ-alert-btn')).toBeNull();
  });
});

describe('handleClick', () => {
  const alert1 = {
    id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0,
    trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } },
  };

  test('fetches alerts and item names, opens bulk modal', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/market/44015' };
    document.body.insertAdjacentHTML('beforeend', '<h1>木棉原木</h1>');

    API.getAlerts.mockResolvedValue([alert1]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<a href="/market/44015">木棉原木</a>') });

    await HeaderButton.handleClick();

    expect(API.getAlerts).toHaveBeenCalled();
    expect(Modal.openBulkModal).toHaveBeenCalled();
    const callArgs = Modal.openBulkModal.mock.calls[0][0];
    expect(callArgs.currentItemId).toBe(44015);
    expect(callArgs.currentItemName).toBe('木棉原木');
    expect(callArgs.groups).toHaveLength(1);
    expect(callArgs.nameMap).toBeInstanceOf(Map);
  });

  test('passes null currentItemId when not on market item page', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/' };

    API.getAlerts.mockResolvedValue([]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });

    await HeaderButton.handleClick();

    const callArgs = Modal.openBulkModal.mock.calls[0][0];
    expect(callArgs.currentItemId).toBeNull();
    expect(callArgs.currentItemName).toBeNull();
  });

  test('shows inline error when getAlerts fails', async () => {
    setupHeader();
    HeaderButton.injectButton();
    API.getAlerts.mockRejectedValue(new Error('Network error'));
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });

    await HeaderButton.handleClick();

    expect(Modal.openBulkModal).not.toHaveBeenCalled();
    const errorEl = document.getElementById('univ-alert-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('Failed to load');
  });

  test('degrades gracefully when fetchItemNames fails', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/market/44015' };
    document.body.insertAdjacentHTML('beforeend', '<h1>木棉原木</h1>');

    API.getAlerts.mockResolvedValue([alert1]);
    fetch.mockRejectedValue(new Error('Network error'));

    await HeaderButton.handleClick();

    expect(Modal.openBulkModal).toHaveBeenCalled();
    const callArgs = Modal.openBulkModal.mock.calls[0][0];
    expect(callArgs.nameMap).toBeInstanceOf(Map);
    // nameMap may be empty but modal still opens
  });

  test('enriches groups with worldName', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/market/44015' };
    document.body.insertAdjacentHTML('beforeend', '<h1>木棉原木</h1>');

    API.getAlerts.mockResolvedValue([alert1]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });

    await HeaderButton.handleClick();

    const callArgs = Modal.openBulkModal.mock.calls[0][0];
    const world = callArgs.groups[0].worlds.find(w => w.worldId === 4030);
    expect(world.worldName).toBe('利維坦');
  });
});

describe('init', () => {
  test('injects button when header account section exists', () => {
    setupHeader();
    HeaderButton.init();
    expect(document.getElementById('univ-alert-btn')).not.toBeNull();
  });

  test('uses MutationObserver when header not yet rendered', async () => {
    document.body.innerHTML = '';
    HeaderButton.init();
    expect(document.getElementById('univ-alert-btn')).toBeNull();

    // Simulate header appearing
    const header = document.createElement('header');
    header.innerHTML = '<div><div class="header-home"></div><div><div><a href="/account">帳號</a></div><div><button class="btn-settings">⚙️</button></div></div></div>';
    document.body.appendChild(header);
    await new Promise(r => setTimeout(r, 0));

    expect(document.getElementById('univ-alert-btn')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/header-button.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/header-button.js**

```js
const HeaderButton = (() => {
  const _apiModule = typeof module !== 'undefined' ? require('./api') : null;
  const _modalModule = typeof module !== 'undefined' ? require('./modal') : null;
  const _groupingModule = typeof module !== 'undefined' ? require('./grouping') : null;
  const _worldMapModule = typeof module !== 'undefined' ? require('./worldmap') : null;

  function _API() { return typeof API !== 'undefined' ? API : _apiModule; }
  function _Modal() { return typeof Modal !== 'undefined' ? Modal : _modalModule; }
  function _Grouping() { return typeof Grouping !== 'undefined' ? Grouping : _groupingModule; }
  function _WorldMap() { return typeof WorldMap !== 'undefined' ? WorldMap : _worldMapModule; }

  function findAccountSection() {
    const accountLink = document.querySelector('header a[href="/account"]');
    if (!accountLink) return null;
    const headerWrapper = document.querySelector('header > div');
    if (!headerWrapper) return null;
    // Walk up from the account link to find the direct child of the header wrapper
    let el = accountLink;
    while (el.parentElement && el.parentElement !== headerWrapper) {
      el = el.parentElement;
    }
    return el.parentElement === headerWrapper ? el : null;
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

    const results = await Promise.allSettled([
      _API().getAlerts(),
      fetchItemNames(),
    ]);

    const alertsResult = results[0];
    const namesResult = results[1];

    if (alertsResult.status === 'rejected') {
      const errorEl = document.createElement('div');
      errorEl.id = 'univ-alert-error';
      errorEl.style.cssText = 'color:#ff6b6b;font-size:13px;margin-top:4px';
      errorEl.textContent = 'Failed to load alerts \u2014 check your connection';
      const btn = document.getElementById('univ-alert-btn');
      if (btn) btn.insertAdjacentElement('afterend', errorEl);
      return;
    }

    const allAlerts = alertsResult.value;
    const nameMap = namesResult.status === 'fulfilled' ? namesResult.value : new Map();

    const groups = _Grouping().groupAlerts(allAlerts);
    groups.forEach(g => {
      g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap().worldById(w.worldId)?.worldName || '' }));
    });

    const { currentItemId, currentItemName } = detectPageContext();
    _Modal().openBulkModal({ groups, nameMap, currentItemId, currentItemName });
  }

  function init() {
    if (findAccountSection()) {
      injectButton();
      return;
    }
    const observer = new MutationObserver(() => {
      if (findAccountSection()) {
        observer.disconnect();
        injectButton();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  return { init, injectButton, handleClick };
})();

if (typeof module !== 'undefined') module.exports = HeaderButton;
```

- [ ] **Step 4: Run header-button tests**

Run: `npx jest --no-coverage tests/header-button.test.js`
Expected: PASS

- [ ] **Step 5: Delete old market-page files**

Delete `src/market-page.js` and `tests/market-page.test.js`.

- [ ] **Step 6: Update build.js SRC_ORDER**

Replace `'src/market-page.js',` with `'src/header-button.js',` in the SRC_ORDER array.

- [ ] **Step 7: Run all tests except init (which still references MarketPage)**

Run: `npx jest --no-coverage --testPathIgnorePatterns=init`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: create header-button module, delete market-page module"
```

---

### Task 7: Update init.js — simplified routing

**Files:**
- Modify: `src/init.js`
- Modify: `tests/init.test.js`

- [ ] **Step 1: Rewrite tests/init.test.js**

```js
// tests/init.test.js
global.HeaderButton = { init: jest.fn() };

function requireInit() {
  let Init;
  jest.isolateModules(() => {
    Init = require('../src/init');
  });
  return Init;
}

beforeEach(() => {
  delete window.location;
  window.location = { pathname: '/' };
  document.body.innerHTML = '<div></div>';
  HeaderButton.init.mockReset();
});

describe('route — always calls HeaderButton.init', () => {
  test('calls HeaderButton.init on root path', () => {
    requireInit();
    expect(HeaderButton.init).toHaveBeenCalled();
  });

  test('calls HeaderButton.init on market page', () => {
    delete window.location;
    window.location = { pathname: '/market/44015' };
    requireInit();
    expect(HeaderButton.init).toHaveBeenCalled();
  });

  test('calls HeaderButton.init on account page', () => {
    delete window.location;
    window.location = { pathname: '/account/alerts' };
    requireInit();
    expect(HeaderButton.init).toHaveBeenCalled();
  });

  test('calls HeaderButton.init on any page', () => {
    delete window.location;
    window.location = { pathname: '/about' };
    requireInit();
    expect(HeaderButton.init).toHaveBeenCalled();
  });
});

describe('route — exported function', () => {
  test('route() calls HeaderButton.init()', () => {
    const Init = requireInit();
    HeaderButton.init.mockReset();
    Init.route();
    expect(HeaderButton.init).toHaveBeenCalledTimes(1);
  });
});

describe('setupNavigationObserver', () => {
  test('calls route when pathname changes and DOM mutates', async () => {
    delete window.location;
    window.location = { pathname: '/' };
    const Init = requireInit();
    HeaderButton.init.mockReset();

    window.location.pathname = '/market/44015';
    document.body.appendChild(document.createElement('div'));
    await new Promise(r => setTimeout(r, 0));

    expect(HeaderButton.init).toHaveBeenCalled();
  });

  test('does not re-route when pathname has not changed', async () => {
    delete window.location;
    window.location = { pathname: '/' };
    const Init = requireInit();
    HeaderButton.init.mockReset();

    document.body.appendChild(document.createElement('span'));
    await new Promise(r => setTimeout(r, 0));

    expect(HeaderButton.init).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/init.test.js`
Expected: FAIL — init.js still references MarketPage/AlertsPage.

- [ ] **Step 3: Update src/init.js**

```js
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
```

- [ ] **Step 4: Run tests**

Run: `npx jest --no-coverage tests/init.test.js`
Expected: PASS

- [ ] **Step 5: Run ALL tests**

Run: `npx jest --no-coverage`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/init.js tests/init.test.js && git commit -m "refactor: simplify init.js to just call HeaderButton.init on every page"
```

---

### Task 8: Final build and verification

**Files:**
- Output: `universalis-alert.user.js`

- [ ] **Step 1: Run full test suite**

Run: `npx jest --no-coverage`
Expected: ALL PASS

- [ ] **Step 2: Build the userscript**

Run: `node build.js`
Expected: "Built universalis-alert.user.js (XXXX bytes)" — smaller than before since alerts-page.js is removed.

- [ ] **Step 3: Verify the built file**

Spot-check the output:
- `@match` line shows `https://universalis.app/*`
- Contains `HeaderButton` IIFE (not `MarketPage`)
- Does not contain `AlertsPage`
- Contains `openBulkModal` (not `openModal`)

- [ ] **Step 4: Commit the built file**

```bash
git add universalis-alert.user.js && git commit -m "build: regenerate userscript with header button redesign"
```
