# Bulk Alerts Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the market page "Set Alerts" button into "Bulk Alerts" with a full alert management modal (view, create, edit, delete) for a single item.

**Architecture:** Extract form rendering from `openModal` into a shared `renderFormView` internal function. Add `renderListView` for the alert list. Add `openBulkModal` that routes to list or form based on existing alerts. `openModal` delegates to `renderFormView` (no behavior change for alerts-page callers).

**Tech Stack:** Vanilla JS (ES6), Jest + jsdom for tests.

**Spec:** `docs/superpowers/specs/2026-03-25-bulk-alerts-modal-design.md`

---

### Task 1: Extract `renderFormView` from `openModal` (pure refactor)

**Files:**
- Modify: `src/modal.js`
- Test: `tests/modal.test.js` (existing tests verify — no new tests needed)

This is a pure refactor. Extract the form-building and event-binding code from `openModal` into a new internal function `renderFormView(container, { itemId, itemName, group, onSave, onBack, multipleGroups })`. Then have `openModal` create the overlay and delegate to `renderFormView`.

- [ ] **Step 1: Extract `renderFormView` from `openModal`**

In `src/modal.js`, create a new internal function `renderFormView` that receives a container element and renders the form into it. Then refactor `openModal` to create the overlay, then call `renderFormView`.

The new `renderFormView` function should:
1. Accept `(container, { itemId, itemName, group, onSave, onBack, multipleGroups })`.
2. Compute `existingWorldIds`, `existingTrigger`, `existingComparator`, `existingTarget`, `isHQ`, `initialWebhook` (moved from `openModal`).
3. Set `container.innerHTML` to the form HTML (everything inside the `<div style="background:#1a1a2e...">` box currently in `openModal`). Add a "← Back to alerts" link at the very top of the form HTML when `onBack` is provided:
   ```html
   <a href="#" data-action="back" style="color:#aaa;font-size:13px;text-decoration:none;display:inline-block;margin-bottom:12px">← Back to alerts</a>
   ```
4. Bind all event listeners (webhook input, select-all, clear-all, cancel → `closeModal`, and if `onBack` is provided, the back link → `onBack`).
5. **IMPORTANT: On save success, `renderFormView` calls `await onSave(formState, onProgress)` and does NOT call `closeModal()`.** The caller is responsible for post-save navigation. This is critical because `openModal` needs `closeModal()` after save, but `openBulkModal` needs to return to list view instead.

The refactored `openModal` should:
1. Create the overlay element (same as now — `position:fixed;inset:0;...`).
2. Create an inner container div (`background:#1a1a2e;border-radius:8px;padding:24px;width:480px;max-height:80vh;overflow-y:auto;color:#fff`).
3. Append the inner container to the overlay, append overlay to `document.body`.
4. **Wrap the original `onSave`** to add `closeModal()` after success:
   ```js
   const wrappedOnSave = async (formState, onProgress) => {
     await onSave(formState, onProgress);
     closeModal();
   };
   ```
5. Call `renderFormView(innerContainer, { itemId, itemName, group, onSave: wrappedOnSave, onBack: null, multipleGroups })`.

- [ ] **Step 2: Run existing modal tests to verify refactor is clean**

Run: `npx jest --no-coverage tests/modal.test.js`
Expected: All tests pass (no behavior change).

- [ ] **Step 3: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modal.js
git commit -m "refactor: extract renderFormView from openModal in modal.js"
```

---

### Task 2: Add Escape key and overlay-click dismiss

**Files:**
- Modify: `src/modal.js`
- Modify: `tests/modal.test.js`

- [ ] **Step 1: Write failing tests for Escape and overlay click**

Add to `tests/modal.test.js`:

```js
describe('modal dismiss — Escape and overlay click', () => {
  test('closes modal on Escape key press', () => {
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn() });
    expect(document.querySelector('#univ-alert-modal')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('closes modal when clicking overlay background', () => {
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn() });
    const overlay = document.querySelector('#univ-alert-modal');
    expect(overlay).not.toBeNull();
    // Click the overlay itself (not the inner container)
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('does NOT close modal when clicking inside the form container', () => {
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn() });
    const innerContainer = document.querySelector('#univ-alert-modal > div');
    innerContainer.dispatchEvent(new MouseEvent('click', { bubbles: false }));
    expect(document.querySelector('#univ-alert-modal')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/modal.test.js --testNamePattern="modal dismiss"`
Expected: FAIL — Escape and overlay click don't close the modal yet.

- [ ] **Step 3: Implement Escape and overlay-click dismiss**

In `src/modal.js`, in the `openModal` function, after appending the overlay to `document.body`, add:

```js
// Dismiss on Escape
const onKeydown = (e) => {
  if (e.key === 'Escape') {
    closeModal();
    document.removeEventListener('keydown', onKeydown);
  }
};
document.addEventListener('keydown', onKeydown);

// Dismiss on overlay background click
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeModal();
});
```

Also update `closeModal` to clean up the keydown listener. The simplest approach: store the listener reference on the overlay element itself, or just let `closeModal` remove the overlay (which also removes its click listener), and also remove the document keydown listener. Since `closeModal` removes the overlay by ID, the overlay click listener is auto-cleaned. For the keydown listener, update `closeModal` to dispatch a custom cleanup. Simplest approach: keep `onKeydown` as a module-level variable that `closeModal` can reference and remove:

Actually, the cleanest approach: in `openModal`, after creating the overlay, attach both listeners. In `closeModal`, before removing the overlay, remove the document keydown listener. To share the reference, store it on the overlay element:

```js
// In openModal, after overlay is appended:
const onKeydown = (e) => {
  if (e.key === 'Escape') closeModal();
};
document.addEventListener('keydown', onKeydown);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeModal();
});
overlay._onKeydown = onKeydown; // store for cleanup

// Update closeModal:
function closeModal() {
  const existing = document.getElementById('univ-alert-modal');
  if (existing) {
    if (existing._onKeydown) {
      document.removeEventListener('keydown', existing._onKeydown);
    }
    existing.remove();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --no-coverage tests/modal.test.js`
Expected: All tests pass including the new dismiss tests.

- [ ] **Step 5: Commit**

```bash
git add src/modal.js tests/modal.test.js
git commit -m "feat: dismiss modal on Escape key and overlay background click"
```

---

### Task 3: Add `formatRule` to `modal.js`

**Files:**
- Modify: `src/modal.js`
- Modify: `tests/modal.test.js`

The list view needs to display formatted trigger strings. `alerts-page.js` has a `formatRule` function but it's not exported. Duplicate it in `modal.js` as an internal helper.

- [ ] **Step 1: Write failing test for `formatRule`**

Add to `tests/modal.test.js`:

```js
describe('formatRule', () => {
  test('formats a basic trigger with lt comparator', () => {
    const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
    const result = Modal.formatRule(trigger);
    expect(result).toContain('Min');
    expect(result).toContain('price');
    expect(result).toContain('<');
    expect(result).toContain('130');
  });

  test('formats a trigger with gt comparator', () => {
    const trigger = { filters: [], mapper: 'quantity', reducer: 'max', comparison: { gt: { target: 500 } } };
    const result = Modal.formatRule(trigger);
    expect(result).toContain('Max');
    expect(result).toContain('>');
    expect(result).toContain('500');
  });

  test('includes HQ badge when filters contain hq', () => {
    const trigger = { filters: ['hq'], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
    const result = Modal.formatRule(trigger);
    expect(result).toContain('HQ');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --no-coverage tests/modal.test.js --testNamePattern="formatRule"`
Expected: FAIL — `Modal.formatRule is not a function`.

- [ ] **Step 3: Implement `formatRule`**

Add to `src/modal.js`, inside the IIFE, before `renderFormView`:

```js
function formatRule(trigger) {
  const comparator = 'lt' in trigger.comparison ? '<' : '>';
  const target = trigger.comparison[Object.keys(trigger.comparison)[0]].target;
  const metricLabels = { pricePerUnit: 'Min price', quantity: 'Quantity', total: 'Total' };
  const reducerLabels = { min: 'Min', max: 'Max', mean: 'Avg' };
  const label = `${reducerLabels[trigger.reducer] || trigger.reducer} ${metricLabels[trigger.mapper] || trigger.mapper} ${comparator} ${target}`;
  return trigger.filters.includes('hq') ? `${label} <span style="background:#4a8a4a;border-radius:3px;padding:0 4px;font-size:11px">HQ</span>` : label;
}
```

Add `formatRule` to the return object: `return { openModal, closeModal, formatRule };`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --no-coverage tests/modal.test.js`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modal.js tests/modal.test.js
git commit -m "feat: add formatRule helper to modal.js for list view"
```

---

### Task 4: Add `renderListView` (alert list rendering)

**Files:**
- Modify: `src/modal.js`
- Modify: `tests/modal.test.js`

- [ ] **Step 1: Write failing tests for list view rendering**

Add to `tests/modal.test.js`:

```js
describe('renderListView', () => {
  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
  const groups = [{
    itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
    worlds: [
      { worldId: 4030, alertId: 'a1', worldName: '利維坦' },
      { worldId: 4031, alertId: 'a2', worldName: '鳳凰' },
    ],
  }];

  test('renders one row per alert group', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { itemId: 44015, itemName: '木棉原木', groups, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn() });
    const rows = container.querySelectorAll('[data-group-row]');
    expect(rows).toHaveLength(1);
  });

  test('renders world pills for each group', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { itemId: 44015, itemName: '木棉原木', groups, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn() });
    const pills = container.querySelectorAll('[data-group-row="0"] [data-world-pill]');
    expect(pills).toHaveLength(2);
    expect(pills[0].textContent).toBe('利維坦');
    expect(pills[1].textContent).toBe('鳳凰');
  });

  test('renders Edit and Delete buttons per group', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { itemId: 44015, itemName: '木棉原木', groups, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn() });
    expect(container.querySelector('[data-action="edit"]')).not.toBeNull();
    expect(container.querySelector('[data-action="delete"]')).not.toBeNull();
  });

  test('renders "New Alert" button', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { itemId: 44015, itemName: '木棉原木', groups, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn() });
    expect(container.querySelector('[data-action="new-alert"]')).not.toBeNull();
  });

  test('"New Alert" button calls onNew callback', () => {
    const container = document.createElement('div');
    const onNew = jest.fn();
    Modal.renderListView(container, { itemId: 44015, itemName: '木棉原木', groups, onEdit: jest.fn(), onDelete: jest.fn(), onNew, onClose: jest.fn() });
    container.querySelector('[data-action="new-alert"]').click();
    expect(onNew).toHaveBeenCalled();
  });

  test('Edit button calls onEdit with the group', () => {
    const container = document.createElement('div');
    const onEdit = jest.fn();
    Modal.renderListView(container, { itemId: 44015, itemName: '木棉原木', groups, onEdit, onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn() });
    container.querySelector('[data-action="edit"]').click();
    expect(onEdit).toHaveBeenCalledWith(groups[0]);
  });

  test('renders formatted rule text', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { itemId: 44015, itemName: '木棉原木', groups, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn() });
    expect(container.textContent).toContain('Min');
    expect(container.textContent).toContain('<');
    expect(container.textContent).toContain('130');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/modal.test.js --testNamePattern="renderListView"`
Expected: FAIL — `Modal.renderListView is not a function`.

- [ ] **Step 3: Implement `renderListView`**

Add to `src/modal.js`, inside the IIFE:

```js
function renderListView(container, { itemId, itemName, groups, onEdit, onDelete, onNew, onClose }) {
  const rows = groups.map((g, idx) => {
    const worldPills = g.worlds.map(w =>
      `<span data-world-pill style="background:#1a3a5c;border-radius:12px;padding:2px 8px;font-size:12px;margin:2px;display:inline-block">${w.worldName || w.worldId}</span>`
    ).join('');
    return `
      <div data-group-row="${idx}" style="background:#2a2a4a;padding:10px;border-radius:4px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-size:13px;color:#ccc">${formatRule(g.trigger)}</div>
            <div data-world-pills style="margin-top:6px">${worldPills}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button data-action="edit" data-group-idx="${idx}" style="background:#1a4a7a;border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">Edit</button>
            <button data-action="delete" data-group-idx="${idx}" style="background:#6a1a1a;border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">Delete</button>
          </div>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0;color:#fff">Bulk Alerts — ${itemName}</h3>
      <span data-action="close" style="cursor:pointer;color:#888;font-size:18px">✕</span>
    </div>
    <div data-list-area style="max-height:300px;overflow-y:auto">${rows}</div>
    <div style="border-top:1px solid #333;margin-top:12px;padding-top:12px;text-align:center">
      <button data-action="new-alert" style="background:#1a5a2a;border:none;color:#fff;padding:8px 20px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">New Alert</button>
    </div>`;

  // Event delegation
  container.addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    if (action === 'close') { onClose(); return; }
    if (action === 'new-alert') { onNew(); return; }
    const idx = Number(e.target.dataset.groupIdx);
    const group = groups[idx];
    if (!group) return;
    if (action === 'edit') onEdit(group);
    if (action === 'delete') onDelete(group, idx, e.target);
  });
}
```

Add `renderListView` to the return object: `return { openModal, closeModal, formatRule, renderListView };`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --no-coverage tests/modal.test.js`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modal.js tests/modal.test.js
git commit -m "feat: add renderListView for bulk alerts list display"
```

---

### Task 5: Add delete functionality to list view

**Files:**
- Modify: `src/modal.js`
- Modify: `tests/modal.test.js`

The delete behavior for the list view reuses the same `Promise.allSettled` pattern from `alerts-page.js`'s `deleteGroup`. We implement a `deleteGroupFromList` internal function in `modal.js` that handles progress, partial failure (retry text + pill update), and row removal.

- [ ] **Step 1: Write failing tests for delete in list view**

Add to `tests/modal.test.js`. These tests need `global.API` set up:

```js
describe('list view — delete behavior', () => {
  // Need API mock for deleteAlert
  beforeAll(() => {
    global.API = { getAlerts: jest.fn(), deleteAlert: jest.fn(), createAlert: jest.fn() };
  });

  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };

  test('removes row on successful delete', async () => {
    API.deleteAlert.mockResolvedValue();
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];
    const container = document.createElement('div');
    const onDelete = jest.fn();
    Modal.renderListView(container, { itemId: 44015, itemName: 'Item', groups, onEdit: jest.fn(), onDelete: (group, idx, btn) => {
      Modal.handleListDelete(group, idx, btn, container, jest.fn());
    }, onNew: jest.fn(), onClose: jest.fn() });

    const deleteBtn = container.querySelector('[data-action="delete"]');
    deleteBtn.click();
    await new Promise(r => setTimeout(r, 0));

    expect(container.querySelector('[data-group-row="0"]')).toBeNull();
  });

  test('shows retry text on partial failure', async () => {
    API.deleteAlert.mockResolvedValueOnce().mockRejectedValueOnce(new Error('500'));
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [
        { worldId: 4030, alertId: 'a1', worldName: '利維坦' },
        { worldId: 4031, alertId: 'a2', worldName: '鳳凰' },
      ],
    }];
    const container = document.createElement('div');
    Modal.renderListView(container, { itemId: 44015, itemName: 'Item', groups, onEdit: jest.fn(), onDelete: (group, idx, btn) => {
      Modal.handleListDelete(group, idx, btn, container, jest.fn());
    }, onNew: jest.fn(), onClose: jest.fn() });

    const deleteBtn = container.querySelector('[data-action="delete"]');
    deleteBtn.click();
    await new Promise(r => setTimeout(r, 0));

    expect(deleteBtn.textContent).toBe('Retry (1 remaining)');
    expect(deleteBtn.disabled).toBe(false);
    // World pills should only show the failed world
    const pills = container.querySelectorAll('[data-group-row="0"] [data-world-pill]');
    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toBe('鳳凰');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/modal.test.js --testNamePattern="list view — delete"`
Expected: FAIL — `Modal.handleListDelete is not a function`.

- [ ] **Step 3: Implement `handleListDelete`**

First, add lazy accessor dependencies at the top of the `modal.js` IIFE, alongside the existing `_WorldMap` const. **Use the lazy function pattern** (not direct const) because tests set `global.API` after module load:

```js
const _apiModule = typeof module !== 'undefined' ? require('./api') : null;
const _groupingModule = typeof module !== 'undefined' ? require('./grouping') : null;
const _saveOpsModule = typeof module !== 'undefined' ? require('./save-ops') : null;

function _API() { return typeof API !== 'undefined' ? API : _apiModule; }
function _Grouping() { return typeof Grouping !== 'undefined' ? Grouping : _groupingModule; }
function _SaveOps() { return typeof SaveOps !== 'undefined' ? SaveOps : _saveOpsModule; }
```

Then add to `src/modal.js`, inside the IIFE:

```js
async function handleListDelete(group, idx, btn, container, onAllDeleted) {
  btn.disabled = true;
  const total = group.worlds.length;
  let completed = 0;

  const results = await Promise.allSettled(group.worlds.map(async (w) => {
    try {
      return await _API().deleteAlert(w.alertId);
    } finally {
      completed++;
      btn.textContent = `Deleting ${completed}/${total}...`;
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
    // Update world pills
    const row = container.querySelector(`[data-group-row="${idx}"]`);
    const pillsContainer = row.querySelector('[data-world-pills]');
    pillsContainer.innerHTML = failures
      .map(w => `<span data-world-pill style="background:#1a3a5c;border-radius:12px;padding:2px 8px;font-size:12px;margin:2px;display:inline-block">${w.worldName || w.worldId}</span>`)
      .join('');
  }
}
```

Add `handleListDelete` to the return object: `return { openModal, closeModal, formatRule, renderListView, handleListDelete };`

Note: The lazy accessors `_API()`, `_Grouping()`, `_SaveOps()` defined at the top of this step handle all dependency resolution. No additional `const` definitions are needed — `_WorldMap` remains the only direct-const import (tests use the real WorldMap module, so no mocking issue).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --no-coverage tests/modal.test.js`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modal.js tests/modal.test.js
git commit -m "feat: add handleListDelete with retry UX for bulk alerts"
```

---

### Task 6: Add `openBulkModal` with view routing and navigation

**Files:**
- Modify: `src/modal.js`
- Create: `tests/bulk-modal.test.js`

This is the main integration point. `openBulkModal` creates the overlay, routes to list or form view, and handles all navigation transitions.

- [ ] **Step 1: Write failing tests for `openBulkModal`**

Create `tests/bulk-modal.test.js`:

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

describe('openBulkModal — routing', () => {
  test('opens to form view when groups is empty', () => {
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups: [] });
    const modal = document.querySelector('#univ-alert-modal');
    expect(modal).not.toBeNull();
    // Form view has a form with data-field="name"
    expect(modal.querySelector('[data-field="name"]')).not.toBeNull();
    // Should NOT have the list view elements
    expect(modal.querySelector('[data-action="new-alert"]')).toBeNull();
  });

  test('opens to list view when groups is non-empty', () => {
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const modal = document.querySelector('#univ-alert-modal');
    expect(modal).not.toBeNull();
    // List view has "New Alert" button
    expect(modal.querySelector('[data-action="new-alert"]')).not.toBeNull();
    // Should NOT have the form fields
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
  });
});

describe('openBulkModal — navigation', () => {
  const groups = [{
    itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
    worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
  }];

  test('"New Alert" navigates from list to blank form', () => {
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="new-alert"]').click();
    // Should now show form
    expect(modal.querySelector('[data-field="name"]')).not.toBeNull();
    // Should have back link
    expect(modal.querySelector('[data-action="back"]')).not.toBeNull();
  });

  test('"← Back to alerts" navigates from form to list', () => {
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const modal = document.querySelector('#univ-alert-modal');
    // Navigate to form
    modal.querySelector('[data-action="new-alert"]').click();
    expect(modal.querySelector('[data-field="name"]')).not.toBeNull();
    // Click back
    modal.querySelector('[data-action="back"]').click();
    // Should show list again
    expect(modal.querySelector('[data-action="new-alert"]')).not.toBeNull();
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
  });

  test('Edit button navigates to form pre-filled with group data', () => {
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    // Should show form with group's name pre-filled
    const nameInput = modal.querySelector('[data-field="name"]');
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('Alert');
    // Should have back link
    expect(modal.querySelector('[data-action="back"]')).not.toBeNull();
  });

  test('close button dismisses the modal', () => {
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="close"]').click();
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('Escape dismisses the modal', () => {
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    expect(document.querySelector('#univ-alert-modal')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('overlay background click dismisses the modal', () => {
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const overlay = document.querySelector('#univ-alert-modal');
    expect(overlay).not.toBeNull();
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });
});

describe('openBulkModal — form save returns to list', () => {
  test('after save, re-fetches and shows updated list view', async () => {
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];

    // After save, getAlerts returns updated alerts
    const updatedAlert = { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0, trigger };
    const newAlert = { id: 'a3', itemId: 44015, worldId: 4031, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0, trigger };
    API.getAlerts.mockResolvedValue([updatedAlert, newAlert]);
    SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [], deletesAfterSuccess: [] });
    SaveOps.executeSaveOps.mockResolvedValue();
    GM_getValue.mockReturnValue('https://wh.com');

    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const modal = document.querySelector('#univ-alert-modal');

    // Navigate to form via "New Alert"
    modal.querySelector('[data-action="new-alert"]').click();

    // Click save
    const saveBtn = modal.querySelector('[data-action="save"]');
    saveBtn.click();
    await new Promise(r => setTimeout(r, 0));

    // Should return to list view with updated data
    expect(modal.querySelector('[data-action="new-alert"]')).not.toBeNull();
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
  });
});

describe('openBulkModal — delete last group transitions to form', () => {
  test('transitions to blank form when last group is deleted', async () => {
    API.deleteAlert.mockResolvedValue();
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];

    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const modal = document.querySelector('#univ-alert-modal');

    // Delete the only group
    modal.querySelector('[data-action="delete"]').click();
    await new Promise(r => setTimeout(r, 0));

    // Should transition to form view (blank)
    expect(modal.querySelector('[data-field="name"]')).not.toBeNull();
    // Should NOT have back link (no list to go back to)
    expect(modal.querySelector('[data-action="back"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/bulk-modal.test.js`
Expected: FAIL — `Modal.openBulkModal is not a function`.

- [ ] **Step 3: Implement `openBulkModal`**

Add to `src/modal.js`, inside the IIFE:

```js
function openBulkModal({ itemId, itemName, groups }) {
  closeModal(); // remove any existing modal

  const overlay = document.createElement('div');
  overlay.id = 'univ-alert-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999';

  const innerContainer = document.createElement('div');
  innerContainer.style.cssText = 'background:#1a1a2e;border-radius:8px;padding:24px;width:480px;max-height:80vh;overflow-y:auto;color:#fff';
  overlay.appendChild(innerContainer);
  document.body.appendChild(overlay);

  // Escape key dismiss
  const onKeydown = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onKeydown);
  overlay._onKeydown = onKeydown;

  // Overlay click dismiss
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  // --- Navigation functions ---

  function showListView(currentGroups) {
    innerContainer.innerHTML = '';
    renderListView(innerContainer, {
      itemId, itemName, groups: currentGroups,
      onEdit: (group) => showFormView(group, currentGroups),
      onDelete: (group, idx, btn) => {
        handleListDelete(group, idx, btn, innerContainer, () => {
          // All groups deleted — show blank form with no back button
          showFormView(null, null);
        });
      },
      onNew: () => showFormView(null, currentGroups),
      onClose: () => closeModal(),
    });
  }

  function showFormView(group, currentGroupsForBack) {
    innerContainer.innerHTML = '';
    const onBack = currentGroupsForBack ? () => showListView(currentGroupsForBack) : null;

    const onSave = async (formState, onProgress) => {
      onProgress?.({ phase: 'refreshing' });
      const freshAlerts = await _API().getAlerts();
      const freshItemAlerts = freshAlerts.filter(a => a.itemId === itemId);
      const freshGroups = _Grouping().groupAlerts(freshItemAlerts);
      freshGroups.forEach(g => {
        g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap.worldById(w.worldId)?.worldName || '' }));
      });

      // Find matching group by trigger key (if editing)
      const normalizeTrigger = _Grouping().normalizeTrigger;
      const originalTriggerKey = group ? normalizeTrigger(group.trigger) : null;
      const freshGroup = originalTriggerKey
        ? freshGroups.find(g => normalizeTrigger(g.trigger) === originalTriggerKey) || null
        : null;

      const ops = _SaveOps().computeSaveOps(freshGroup, formState, _WorldMap.WORLDS);
      await _SaveOps().executeSaveOps(ops, itemId, formState, { onProgress });

      // After save: re-fetch and return to list view
      const updatedAlerts = await _API().getAlerts();
      const updatedItemAlerts = updatedAlerts.filter(a => a.itemId === itemId);
      const updatedGroups = _Grouping().groupAlerts(updatedItemAlerts);
      updatedGroups.forEach(g => {
        g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap.worldById(w.worldId)?.worldName || '' }));
      });
      showListView(updatedGroups);
    };

    renderFormView(innerContainer, { itemId, itemName, group, onSave, onBack, multipleGroups: false });
  }

  // --- Initial routing ---
  if (groups.length === 0) {
    showFormView(null, null);
  } else {
    showListView(groups);
  }
}
```

The lazy accessors `_API()`, `_Grouping()`, `_SaveOps()` were already added in Task 5. No additional imports needed.

**Important:** All references to these dependencies in `openBulkModal` must use the function-call form: `_API().getAlerts()`, `_Grouping().groupAlerts()`, `_Grouping().normalizeTrigger()`, `_SaveOps().computeSaveOps()`, `_SaveOps().executeSaveOps()`, `_WorldMap.worldById()`.

Add `openBulkModal` to the return object: `return { openModal, closeModal, formatRule, renderListView, handleListDelete, openBulkModal };`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --no-coverage tests/bulk-modal.test.js`
Expected: All tests pass.

- [ ] **Step 5: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests pass (no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/modal.js tests/bulk-modal.test.js
git commit -m "feat: add openBulkModal with list/form routing and navigation"
```

---

### Task 7: Update `market-page.js` to use `openBulkModal`

**Files:**
- Modify: `src/market-page.js`
- Modify: `tests/market-page.test.js`

- [ ] **Step 1: Update tests for new button text and `openBulkModal` call**

In `tests/market-page.test.js`:

1. Update the `global.Modal` mock to include `openBulkModal`:
   ```js
   global.Modal = { openModal: jest.fn(), closeModal: jest.fn(), openBulkModal: jest.fn() };
   ```

2. Update the `handleAlertButtonClick` tests:
   - Change `expect(Modal.openModal).toHaveBeenCalled()` to `expect(Modal.openBulkModal).toHaveBeenCalled()`
   - Update the test that checks `multipleGroups` — this parameter no longer exists. Replace it with a test that verifies `groups` is passed to `openBulkModal`:
     ```js
     test('passes grouped alerts to openBulkModal', async () => {
       const alert2 = { ...alert1, id: 'a2', trigger: { ...alert1.trigger, comparison: { lt: { target: 200 } } } };
       API.getAlerts.mockResolvedValue([alert1, alert2]);
       await MarketPage.handleAlertButtonClick(44015, '木棉原木');
       const callArgs = Modal.openBulkModal.mock.calls[0][0];
       expect(callArgs.groups).toHaveLength(2);
     });
     ```
   - Remove the `onSave` re-fetch test (this logic now lives in `openBulkModal`, tested in `tests/bulk-modal.test.js`).

3. Update the error test to use new button text:
   ```js
   document.body.innerHTML = '<button id="univ-alert-btn">🔔 Bulk Alerts</button>';
   ```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/market-page.test.js`
Expected: FAIL — `handleAlertButtonClick` still calls `openModal` and button text is still "Set Alerts".

- [ ] **Step 3: Update `market-page.js`**

1. Change button text in `injectMarketButton`:
   ```js
   btn.textContent = '🔔 Bulk Alerts';
   ```

2. Simplify `handleAlertButtonClick` — remove the `onSave` callback and `multipleGroups` logic, just pass groups to `openBulkModal`:
   ```js
   async function handleAlertButtonClick(itemId, itemName) {
     let allAlerts;
     try {
       allAlerts = await _API().getAlerts();
     } catch (err) {
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
     groups.forEach(g => {
       g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap().worldById(w.worldId)?.worldName || '' }));
     });

     _Modal().openBulkModal({ itemId, itemName, groups });
   }
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --no-coverage tests/market-page.test.js`
Expected: All tests pass.

- [ ] **Step 5: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/market-page.js tests/market-page.test.js
git commit -m "feat: change market page to Bulk Alerts with openBulkModal"
```

---

### Task 8: Build and final verification

**Files:**
- Verify: `universalis-alert.user.js` (build output)

- [ ] **Step 1: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests pass.

- [ ] **Step 2: Build the userscript**

Run: `node build.js`
Expected: `universalis-alert.user.js` generated without errors.

- [ ] **Step 3: Verify build output contains new exports**

Run: `grep -n 'openBulkModal\|Bulk Alerts\|renderListView\|renderFormView\|handleListDelete' universalis-alert.user.js`
Expected: All new functions and the updated button text appear in the built file.

- [ ] **Step 4: Commit build output**

```bash
git add universalis-alert.user.js
git commit -m "build: regenerate userscript with bulk alerts modal"
```
