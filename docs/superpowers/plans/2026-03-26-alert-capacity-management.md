# Alert Capacity Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the 40-alert-per-account limit with capacity display, pre-save validation, and interleaved POST/DELETE execution for tight-capacity edits.

**Architecture:** Add `MAX_ALERTS` constant and capacity validation to `computeSaveOps`, rewrite `executeSaveOps` to batch POST/DELETE operations based on available slots, and thread alert count through the modal UI for display and validation.

**Tech Stack:** Vanilla JS (ES6), Jest + jsdom for testing

**Spec:** `docs/superpowers/specs/2026-03-26-alert-capacity-management-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/save-ops.js` | Modify | Add `MAX_ALERTS`, capacity validation in `computeSaveOps`, interleaved execution in `executeSaveOps` |
| `src/modal.js` | Modify | Display capacity in list view, handle `capacityError` in form, Retry button text |
| `src/header-button.js` | Modify | Pass `allAlerts.length` as `alertCount` into `openBulkModal` |
| `tests/save-ops.test.js` | Modify | Add capacity validation tests, rewrite execution tests for interleaving |
| `tests/modal.test.js` | Modify | Add capacity display tests, capacityError handling tests |
| `tests/bulk-modal.test.js` | Modify | Update `openBulkModal` calls to include `alertCount` |
| `tests/header-button.test.js` | Modify | Verify `alertCount` is passed to `openBulkModal` |

---

### Task 1: `computeSaveOps` — capacity validation (new alerts)

**Files:**
- Modify: `tests/save-ops.test.js`
- Modify: `src/save-ops.js:1-50`

- [ ] **Step 1: Write failing tests for capacity fields and new-alert rejection**

Add these tests to the existing `describe('computeSaveOps')` block in `tests/save-ops.test.js`:

```js
test('returns netChange = postsNeeded.length - deletesAfterSuccess.length', () => {
  const ops = computeSaveOps(null, formState([4028, 4029]), WORLDS, 0);
  expect(ops.netChange).toBe(2);
});

test('returns capacityError null when new alerts fit within limit', () => {
  const ops = computeSaveOps(null, formState([4028, 4029]), WORLDS, 38);
  expect(ops.capacityError).toBeNull();
});

test('returns capacityError when new alerts would exceed MAX_ALERTS', () => {
  const ops = computeSaveOps(null, formState([4028, 4029, 4030]), WORLDS, 38);
  expect(ops.capacityError).toBe('Not enough alert slots (need 3, only 2 available)');
});

test('returns capacityError at exactly MAX_ALERTS with posts needed', () => {
  const ops = computeSaveOps(null, formState([4028]), WORLDS, 40);
  expect(ops.capacityError).toBe('Not enough alert slots (need 1, only 0 available)');
});

test('no capacityError when no posts are needed', () => {
  // All worlds unchecked → nothing to post
  const ops = computeSaveOps(null, formState([]), WORLDS, 40);
  expect(ops.capacityError).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/save-ops.test.js`
Expected: 5 new tests FAIL (computeSaveOps doesn't accept 4th arg, no `netChange` or `capacityError` in return)

- [ ] **Step 3: Implement capacity validation in `computeSaveOps`**

In `src/save-ops.js`, add `MAX_ALERTS` constant at the top of the IIFE (after the dependency declarations, before `computeSaveOps`):

```js
const MAX_ALERTS = 40;
```

Update `computeSaveOps` signature to accept `currentAlertCount`:

```js
function computeSaveOps(group, formState, worlds, currentAlertCount) {
```

At the end of `computeSaveOps`, before `return`, add:

```js
const netChange = postsNeeded.length - deletesAfterSuccess.length;
const available = MAX_ALERTS - (currentAlertCount || 0);
let capacityError = null;
if (postsNeeded.length > 0 && (currentAlertCount || 0) + netChange > MAX_ALERTS) {
  capacityError = `Not enough alert slots (need ${postsNeeded.length}, only ${available + deletesAfterSuccess.length} available)`;
}

return { postsNeeded, deletesAfterSuccess, netChange, capacityError };
```

Update the existing `return` statement from:
```js
return { postsNeeded, deletesAfterSuccess };
```

- [ ] **Step 4: Update existing tests to pass `currentAlertCount`**

Existing `computeSaveOps` tests don't pass the 4th argument. They should still work because `currentAlertCount` defaults to `0` via `(currentAlertCount || 0)`. Verify they pass.

Run: `npx jest --no-coverage tests/save-ops.test.js`
Expected: ALL tests pass (old and new)

- [ ] **Step 5: Export `MAX_ALERTS` for test access**

Update the return statement of the SaveOps IIFE:

```js
return { computeSaveOps, executeSaveOps, MAX_ALERTS };
```

- [ ] **Step 6: Commit**

```bash
git add src/save-ops.js tests/save-ops.test.js
git commit -m "feat: add capacity validation to computeSaveOps"
```

---

### Task 2: `computeSaveOps` — capacity validation (edits)

**Files:**
- Modify: `tests/save-ops.test.js`
- Modify: `src/save-ops.js` (already updated in Task 1)

- [ ] **Step 1: Write failing tests for edit capacity scenarios**

Add to `describe('computeSaveOps')` in `tests/save-ops.test.js`:

```js
test('edit with net zero change at full capacity → no capacityError', () => {
  // 8 worlds selected, 1 existing → 7 POSTs, 0 DELETEs for new; 1 POST + 1 DELETE for changed trigger
  // But if same trigger, just adding worlds: 7 POSTs, 0 DELETEs → net +7
  // For pure re-trigger: all existing stay selected, trigger changes → postsNeeded = existing count, deletes = same
  const group8 = {
    name: 'My Alert', itemId: 44015, trigger,
    worlds: WORLDS.map(w => ({ worldId: w.worldId, alertId: `alert-${w.worldId}`, worldName: w.worldName })),
  };
  const newTrigger = { ...trigger, comparison: { lt: { target: 999 } } };
  const ops = computeSaveOps(group8, formState(WORLDS.map(w => w.worldId), newTrigger), WORLDS, 40);
  expect(ops.netChange).toBe(0); // 8 posts - 8 deletes
  expect(ops.capacityError).toBeNull();
});

test('edit that adds more worlds than it removes → capacityError when exceeds limit', () => {
  // 1 existing world, select 5 (4 new + 1 same trigger = no-op) → 4 POSTs, 0 DELETEs, net +4
  const ops = computeSaveOps(existingGroup, formState([4028, 4029, 4030, 4031, 4032]), WORLDS, 37);
  // net = 4 posts (4028, 4029, 4031, 4032) - 0 deletes = +4; 37 + 4 = 41 > 40
  expect(ops.capacityError).toBe('Not enough alert slots (need 4, only 3 available)');
});

test('edit that adds more worlds than it removes → no error when fits', () => {
  const ops = computeSaveOps(existingGroup, formState([4028, 4029, 4030, 4031, 4032]), WORLDS, 36);
  expect(ops.capacityError).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx jest --no-coverage tests/save-ops.test.js`
Expected: ALL pass — these pass immediately (not red-green-refactor) because Task 1's implementation already covers edits. The `netChange` validation applies uniformly to both new alerts and edits. These tests just document the edit-specific scenarios.

- [ ] **Step 3: Commit**

```bash
git add tests/save-ops.test.js
git commit -m "test: add edit capacity validation tests for computeSaveOps"
```

---

### Task 3: `executeSaveOps` — interleaved POST/DELETE execution

**Files:**
- Modify: `tests/save-ops.test.js`
- Modify: `src/save-ops.js:60-113`

This is the most complex task. The existing `executeSaveOps` does all POSTs then all DELETEs. We rewrite it to batch operations based on `availableSlots`.

- [ ] **Step 1: Write failing test for interleaved execution at tight capacity**

Add a new `describe` block in `tests/save-ops.test.js`:

```js
describe('executeSaveOps — interleaved execution', () => {
  beforeEach(() => jest.resetAllMocks());

  const formState = {
    name: 'Test',
    webhook: 'https://discord.com/wh',
    trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } },
    selectedWorldIds: new Set([4028, 4029, 4030]),
  };

  test('with ample slots, all POSTs run before any DELETEs', async () => {
    const ops = {
      postsNeeded: [
        { worldId: 4028, worldName: '伊弗利特' },
        { worldId: 4029, worldName: '迦樓羅' },
      ],
      deletesAfterSuccess: [
        { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
        { alertId: 'old-2', worldId: 4029, worldName: '迦樓羅' },
      ],
    };
    const callOrder = [];
    jest.spyOn(API, 'createAlert').mockImplementation(async () => { callOrder.push('post'); return { id: 'x' }; });
    jest.spyOn(API, 'deleteAlert').mockImplementation(async () => { callOrder.push('delete'); });

    await executeSaveOps(ops, 44015, formState, { availableSlots: 10 });

    const firstDelete = callOrder.indexOf('delete');
    const lastPost = callOrder.lastIndexOf('post');
    expect(firstDelete).toBeGreaterThan(lastPost);
  });

  test('with 0 available slots, deletes run before posts to free capacity', async () => {
    const ops = {
      postsNeeded: [
        { worldId: 4028, worldName: '伊弗利特' },
        { worldId: 4029, worldName: '迦樓羅' },
      ],
      deletesAfterSuccess: [
        { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
        { alertId: 'old-2', worldId: 4029, worldName: '迦樓羅' },
      ],
    };
    const callOrder = [];
    jest.spyOn(API, 'createAlert').mockImplementation(async () => { callOrder.push('post'); return { id: 'x' }; });
    jest.spyOn(API, 'deleteAlert').mockImplementation(async () => { callOrder.push('delete'); });

    await executeSaveOps(ops, 44015, formState, { availableSlots: 0 });

    // With 0 slots, must delete before posting
    expect(callOrder[0]).toBe('delete');
    // All operations complete
    expect(callOrder.filter(c => c === 'post')).toHaveLength(2);
    expect(callOrder.filter(c => c === 'delete')).toHaveLength(2);
  });

  test('with limited slots, interleaves POST and DELETE batches', async () => {
    // 3 POSTs + 3 DELETEs (replacements), only 1 slot available
    const ops = {
      postsNeeded: [
        { worldId: 4028, worldName: '伊弗利特' },
        { worldId: 4029, worldName: '迦樓羅' },
        { worldId: 4030, worldName: '利維坦' },
      ],
      deletesAfterSuccess: [
        { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
        { alertId: 'old-2', worldId: 4029, worldName: '迦樓羅' },
        { alertId: 'old-3', worldId: 4030, worldName: '利維坦' },
      ],
    };
    const callOrder = [];
    jest.spyOn(API, 'createAlert').mockImplementation(async () => { callOrder.push('post'); return { id: 'x' }; });
    jest.spyOn(API, 'deleteAlert').mockImplementation(async () => { callOrder.push('delete'); });

    await executeSaveOps(ops, 44015, formState, { availableSlots: 1 });

    // Should interleave: post, delete, post, delete, post, delete
    expect(callOrder).toHaveLength(6);
    // First action must be a post (we have 1 slot)
    expect(callOrder[0]).toBe('post');
    // Verify interleaving pattern
    expect(callOrder.filter(c => c === 'post')).toHaveLength(3);
    expect(callOrder.filter(c => c === 'delete')).toHaveLength(3);
  });

  test('prefers deleting replaced alerts (matched by worldId) over unreplaced ones', async () => {
    // 2 POSTs for worlds 4028+4029, 3 DELETEs for 4028+4029+4030
    // 4028 and 4029 are replacements, 4030 is a pure removal
    const ops = {
      postsNeeded: [
        { worldId: 4028, worldName: '伊弗利特' },
        { worldId: 4029, worldName: '迦樓羅' },
      ],
      deletesAfterSuccess: [
        { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
        { alertId: 'old-2', worldId: 4029, worldName: '迦樓羅' },
        { alertId: 'old-3', worldId: 4030, worldName: '利維坦' },
      ],
    };
    const deletedAlertIds = [];
    jest.spyOn(API, 'createAlert').mockImplementation(async () => ({ id: 'x' }));
    jest.spyOn(API, 'deleteAlert').mockImplementation(async (alertId) => { deletedAlertIds.push(alertId); });

    // Only 1 slot: post 1, need to delete to continue
    // After posting 4028, should prefer deleting old-1 (4028, replaced) over old-3 (4030, unreplaced)
    await executeSaveOps(ops, 44015, formState, { availableSlots: 1 });

    // The pure removal (old-3, worldId 4030) should be deleted last
    expect(deletedAlertIds[deletedAlertIds.length - 1]).toBe('old-3');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/save-ops.test.js -t "interleaved"`
Expected: FAIL — `executeSaveOps` doesn't accept `availableSlots`

- [ ] **Step 3: Rewrite `executeSaveOps` with interleaving logic**

Replace the entire `executeSaveOps` function in `src/save-ops.js` with:

```js
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
```

- [ ] **Step 4: Run all save-ops tests**

Run: `npx jest --no-coverage tests/save-ops.test.js`
Expected: ALL pass — both old tests (backward compat via default `availableSlots`) and new interleaving tests.

Note: The existing test `'calls deleteAlert only after all POSTs succeed'` should still pass because with default `availableSlots` (= postsNeeded.length), all POSTs fit in one batch before any DELETEs.

- [ ] **Step 5: Commit**

```bash
git add src/save-ops.js tests/save-ops.test.js
git commit -m "feat: rewrite executeSaveOps with interleaved POST/DELETE batching"
```

---

### Task 4: `executeSaveOps` — error handling and progress for interleaved batches

**Files:**
- Modify: `tests/save-ops.test.js`

- [ ] **Step 1: Write tests for mid-interleave failure and progress**

Add to the `describe('executeSaveOps — interleaved execution')` block:

```js
test('stops after current batch on POST failure mid-interleave', async () => {
  const ops = {
    postsNeeded: [
      { worldId: 4028, worldName: '伊弗利特' },
      { worldId: 4029, worldName: '迦樓羅' },
    ],
    deletesAfterSuccess: [
      { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
      { alertId: 'old-2', worldId: 4029, worldName: '迦樓羅' },
    ],
  };
  // First batch: 1 slot → POST 4028 succeeds
  // After delete old-1 → POST 4029 fails
  let postCount = 0;
  jest.spyOn(API, 'createAlert').mockImplementation(async () => {
    postCount++;
    if (postCount === 2) throw new Error('Server error');
    return { id: 'x' };
  });
  jest.spyOn(API, 'deleteAlert').mockResolvedValue();

  await expect(executeSaveOps(ops, 44015, formState, { availableSlots: 1 }))
    .rejects.toThrow('Failed to save alerts for: 迦樓羅');

  // Only 1 delete should have run (to free space for second POST attempt)
  expect(API.deleteAlert).toHaveBeenCalledTimes(1);
});

test('reports progress across interleaved batches', async () => {
  const ops = {
    postsNeeded: [
      { worldId: 4028, worldName: '伊弗利特' },
      { worldId: 4029, worldName: '迦樓羅' },
    ],
    deletesAfterSuccess: [
      { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
      { alertId: 'old-2', worldId: 4029, worldName: '迦樓羅' },
    ],
  };
  jest.spyOn(API, 'createAlert').mockResolvedValue({ id: 'x' });
  jest.spyOn(API, 'deleteAlert').mockResolvedValue();
  const progressCalls = [];

  await executeSaveOps(ops, 44015, formState, {
    availableSlots: 1,
    onProgress: (p) => progressCalls.push(p),
  });

  // With 1 slot: post, delete, post, delete — progress should track totals
  expect(progressCalls).toEqual([
    { phase: 'creating', completed: 1, total: 2 },
    { phase: 'removing', completed: 1, total: 2 },
    { phase: 'creating', completed: 2, total: 2 },
    { phase: 'removing', completed: 2, total: 2 },
  ]);
});

test('handles pure deletes with no posts (all worlds unchecked)', async () => {
  const ops = {
    postsNeeded: [],
    deletesAfterSuccess: [
      { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
    ],
  };
  jest.spyOn(API, 'createAlert').mockResolvedValue({ id: 'x' });
  jest.spyOn(API, 'deleteAlert').mockResolvedValue();

  await executeSaveOps(ops, 44015, formState, { availableSlots: 0 });

  expect(API.createAlert).not.toHaveBeenCalled();
  expect(API.deleteAlert).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest --no-coverage tests/save-ops.test.js`
Expected: ALL pass

- [ ] **Step 3: Commit**

```bash
git add tests/save-ops.test.js
git commit -m "test: add interleaved error handling and progress tests"
```

---

### Task 5: Modal list view — capacity display

**Files:**
- Modify: `tests/modal.test.js`
- Modify: `src/modal.js:183-238`

- [ ] **Step 1: Write failing tests for capacity display**

Add a new `describe` block in `tests/modal.test.js`:

```js
describe('renderListView — capacity display', () => {
  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
  const groups = [{
    itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
    worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
  }];

  test('displays alert slot usage when alertCount is provided', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, {
      groups, nameMap: new Map([[44015, 'Item']]),
      onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(),
      newAlertDisabled: false, alertCount: 24,
    });
    expect(container.textContent).toContain('Alert slots: 24 / 40 used');
  });

  test('displays 0 / 40 when alertCount is 0', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, {
      groups, nameMap: new Map([[44015, 'Item']]),
      onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(),
      newAlertDisabled: false, alertCount: 0,
    });
    expect(container.textContent).toContain('Alert slots: 0 / 40 used');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/modal.test.js -t "capacity display"`
Expected: FAIL — `renderListView` doesn't render capacity text

- [ ] **Step 3: Add capacity line to `renderListView`**

In `src/modal.js`, in the `renderListView` function, modify the `container.innerHTML` template. After the existing header div with `<h3>Bulk Alerts</h3>` and the close button, add a capacity line. Change:

```js
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0;color:#fff">Bulk Alerts</h3>
        <span data-action="close" style="cursor:pointer;color:#888;font-size:18px">\u2715</span>
      </div>
      <div data-list-area style="max-height:300px;overflow-y:auto">${rows}</div>
```

To:

```js
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
```

Destructure `alertCount` from the function parameter:

```js
function renderListView(container, { groups, nameMap, onEdit, onDelete, onNew, onClose, newAlertDisabled, alertCount }) {
```

- [ ] **Step 4: Run all modal tests**

Run: `npx jest --no-coverage tests/modal.test.js`
Expected: ALL pass

- [ ] **Step 5: Commit**

```bash
git add src/modal.js tests/modal.test.js
git commit -m "feat: display alert slot usage in modal list view"
```

---

### Task 6: Modal form view — capacity error handling and Retry

**Files:**
- Modify: `tests/modal.test.js`
- Modify: `tests/bulk-modal.test.js`
- Modify: `src/modal.js:240-331`

- [ ] **Step 1: Write failing tests for capacityError display**

Add a new `describe` block in `tests/bulk-modal.test.js`:

```js
describe('openBulkModal — capacity error on save', () => {
  test('shows capacityError and keeps Save enabled when capacity exceeded', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockResolvedValue([]);
    SaveOps.computeSaveOps.mockReturnValue({
      postsNeeded: [{ worldId: 4028 }],
      deletesAfterSuccess: [],
      netChange: 1,
      capacityError: 'Not enough alert slots (need 1, only 0 available)',
    });

    Modal.openBulkModal({ groups: [], nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="save"]').click();
    await new Promise(r => setTimeout(r, 10));

    const errorArea = modal.querySelector('[data-error-area]');
    expect(errorArea.style.display).toBe('block');
    expect(errorArea.textContent).toContain('Not enough alert slots');

    const saveBtn = modal.querySelector('[data-action="save"]');
    expect(saveBtn.disabled).toBe(false);
    expect(saveBtn.textContent).toBe('Save');

    // executeSaveOps should NOT have been called
    expect(SaveOps.executeSaveOps).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write failing test for Retry button text after execution failure**

Add to the same describe block:

```js
describe('openBulkModal — Retry on execution failure', () => {
  test('changes Save button to Retry after executeSaveOps failure', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockResolvedValue([]);
    SaveOps.computeSaveOps.mockReturnValue({
      postsNeeded: [{ worldId: 4028 }],
      deletesAfterSuccess: [],
      netChange: 1,
      capacityError: null,
    });
    SaveOps.executeSaveOps.mockRejectedValue(new Error('Failed to save alerts for: 伊弗利特'));

    Modal.openBulkModal({ groups: [], nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="save"]').click();
    await new Promise(r => setTimeout(r, 10));

    const saveBtn = modal.querySelector('[data-action="save"]');
    expect(saveBtn.textContent).toBe('Retry');
    expect(saveBtn.disabled).toBe(false);

    const errorArea = modal.querySelector('[data-error-area]');
    expect(errorArea.textContent).toContain('Failed to save alerts');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest --no-coverage tests/bulk-modal.test.js -t "capacity error|Retry"`
Expected: FAIL

- [ ] **Step 4: Implement capacityError handling and Retry in modal**

Two distinct error paths:
1. **Capacity error** (validation failure) — show error, keep button as "Save" so user can adjust worlds
2. **Execution error** (API failure) — show error, change button to "Retry"

In `src/modal.js`, in the `showFormView` function's `onSave` callback (around line 293), add capacity check that returns early (does NOT throw). After `const ops = _SaveOps().computeSaveOps(freshGroup, formState, _WorldMap.WORLDS);` change to:

```js
const ops = _SaveOps().computeSaveOps(freshGroup, formState, _WorldMap.WORLDS, freshAlerts.length);
if (ops.capacityError) {
  statusEl.style.display = 'none';
  errorArea.textContent = ops.capacityError;
  errorArea.style.display = 'block';
  saveBtn.textContent = 'Save';
  saveBtn.disabled = false;
  return;
}
const availableSlots = _SaveOps().MAX_ALERTS - freshAlerts.length;
await _SaveOps().executeSaveOps(ops, itemId, formState, { onProgress, availableSlots });
```

In the `catch` block of `renderFormView`'s save handler (which now only catches execution errors), change the button text to "Retry":

```js
} catch (err) {
  statusEl.style.display = 'none';
  errorArea.textContent = err.message;
  errorArea.style.display = 'block';
  saveBtn.textContent = 'Retry';
  saveBtn.disabled = false;
}
```

- [ ] **Step 5: Run all modal and bulk-modal tests**

Run: `npx jest --no-coverage tests/modal.test.js tests/bulk-modal.test.js`
Expected: ALL pass

Note: The existing test `'hides status and restores button on save error'` in `tests/modal.test.js` expects `saveBtn.textContent` to be `'Save'` after error. Update this assertion to `'Retry'`:

```js
expect(saveBtn.textContent).toBe('Retry');
```

- [ ] **Step 6: Commit**

```bash
git add src/modal.js tests/modal.test.js tests/bulk-modal.test.js
git commit -m "feat: handle capacity errors and show Retry on save failure"
```

---

### Task 7: Thread `alertCount` through `openBulkModal` and `handleClick`

**Files:**
- Modify: `tests/header-button.test.js`
- Modify: `tests/bulk-modal.test.js`
- Modify: `src/header-button.js:99-127`
- Modify: `src/modal.js:240-331`

- [ ] **Step 1: Write failing test for `alertCount` in `handleClick`**

Add to `describe('handleClick')` in `tests/header-button.test.js`:

```js
test('passes alertCount to openBulkModal', async () => {
  setupHeader();
  delete window.location;
  window.location = { pathname: '/' };

  const alerts = [
    { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } },
    { id: 'a2', itemId: 44015, worldId: 4031, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } },
  ];
  API.getAlerts.mockResolvedValue(alerts);

  await HeaderButton.handleClick();

  const callArgs = Modal.openBulkModal.mock.calls[0][0];
  expect(callArgs.alertCount).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --no-coverage tests/header-button.test.js -t "passes alertCount"`
Expected: FAIL — `alertCount` is undefined

- [ ] **Step 3: Pass `alertCount` in `handleClick`**

In `src/header-button.js`, in the `handleClick` function, change:

```js
_Modal().openBulkModal({ groups, nameMap, currentItemId, currentItemName });
```

To:

```js
_Modal().openBulkModal({ groups, nameMap, currentItemId, currentItemName, alertCount: allAlerts.length });
```

- [ ] **Step 4: Thread `alertCount` through `openBulkModal`**

In `src/modal.js`, update `openBulkModal` to destructure and pass `alertCount`:

```js
function openBulkModal({ groups, nameMap, currentItemId, currentItemName, alertCount }) {
```

Pass it to `showListView`:

```js
function showListView(currentGroups, currentAlertCount) {
  innerContainer.innerHTML = '';
  renderListView(innerContainer, {
    groups: currentGroups, nameMap,
    newAlertDisabled: !currentItemId,
    alertCount: currentAlertCount,
```

Update the initial call to `showListView`:

```js
} else {
  showListView(groups, alertCount);
}
```

Update the `showListView` call after save success (in `onSave` callback). After `const updatedAlerts = await _API().getAlerts();`:

```js
showListView(updatedGroups, updatedAlerts.length);
```

- [ ] **Step 5: Update existing `openBulkModal` test calls to include `alertCount`**

In `tests/bulk-modal.test.js`, update all `Modal.openBulkModal(...)` calls to include `alertCount: 0` (or an appropriate number). For example:

```js
Modal.openBulkModal({ groups: [], nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
```

Do the same for `tests/modal.test.js` — add `alertCount: 0` or a suitable number to each `openBulkModal` call. This prevents the capacity line from showing `undefined`.

- [ ] **Step 6: Run all tests**

Run: `npx jest --no-coverage`
Expected: ALL pass

- [ ] **Step 7: Commit**

```bash
git add src/header-button.js src/modal.js tests/header-button.test.js tests/bulk-modal.test.js tests/modal.test.js
git commit -m "feat: thread alertCount through handleClick → openBulkModal → list view"
```

---

### Task 8: Build and verify

**Files:**
- Run: `node build.js`

- [ ] **Step 1: Run full test suite**

Run: `npx jest --no-coverage`
Expected: ALL pass, no failures

- [ ] **Step 2: Build the userscript**

Run: `node build.js`
Expected: `Built universalis-alert.user.js (XXXX bytes)` — no errors

- [ ] **Step 3: Commit build output**

```bash
git add universalis-alert.user.js
git commit -m "build: regenerate userscript with alert capacity management"
```
