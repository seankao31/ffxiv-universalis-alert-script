# Partial Failure Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix stale-group-on-retry duplicates, add world-aware error messages, and add delete-button recovery with retry UX.

**Architecture:** Three independent fixes applied to the existing IIFE module structure. Fix 2 (world-aware errors) changes the `deletesAfterSuccess` data shape in `computeSaveOps`, which Fix 3 also consumes, so Fix 2 must land first. Fix 1 (re-fetch on retry) is independent but is implemented after Fix 2 since the `onSave` callbacks call `executeSaveOps`.

**Tech Stack:** Vanilla JS (ES6), Jest + jsdom tests, TamperMonkey userscript.

**Spec:** `docs/superpowers/specs/2026-03-24-partial-failure-handling-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/save-ops.js` | `computeSaveOps` returns rich `deletesAfterSuccess` objects; `executeSaveOps` produces world-aware error messages |
| `src/modal.js` | `onProgress` handler gains `'refreshing'` phase display |
| `src/market-page.js` | `onSave` re-fetches alerts and recomputes ops on every save |
| `src/alerts-page.js` | `onSave` re-fetches on every save; `deleteGroup` returns `{ failures }` instead of throwing; delete handler supports retry with pill update |
| `tests/save-ops.test.js` | Updated fixtures for rich `deletesAfterSuccess`; world-aware error message assertions |
| `tests/modal.test.js` | Test for `'refreshing'` phase status text |
| `tests/market-page.test.js` | Test that `onSave` re-fetches before computing ops |
| `tests/alerts-page.test.js` | Tests for `deleteGroup` return shape, delete retry UX, and `onSave` re-fetch |

---

## Task 1: Rich `deletesAfterSuccess` shape in `computeSaveOps`

**Files:**
- Modify: `src/save-ops.js:33-35,42-44` (two push sites)
- Modify: `src/save-ops.js:93` (DELETE loop reads `.alertId`)
- Modify: `tests/save-ops.test.js:17-22,29-58,66-72` (fixture + assertions)

- [ ] **Step 1: Update `computeSaveOps` test fixtures for rich delete shape**

In `tests/save-ops.test.js`, the `existingGroup` fixture at line 17-22 has `worlds: [{ worldId: 4030, alertId: 'alert-4030' }]`. Add `worldName` to it:

```js
const existingGroup = {
  name: 'My Alert',
  itemId: 44015,
  trigger,
  worlds: [{ worldId: 4030, alertId: 'alert-4030', worldName: '利維坦' }],
};
```

Update the three `computeSaveOps` tests that assert on `deletesAfterSuccess` content. Change from:

```js
expect(ops.deletesAfterSuccess).toContain('alert-4030');
```

to:

```js
expect(ops.deletesAfterSuccess).toContainEqual(
  expect.objectContaining({ alertId: 'alert-4030', worldId: 4030, worldName: '利維坦' })
);
```

And the no-op test assertion from:

```js
expect(ops.deletesAfterSuccess).not.toContain('alert-4030');
```

to:

```js
expect(ops.deletesAfterSuccess.map(d => d.alertId)).not.toContain('alert-4030');
```

Also update the `executeSaveOps` fixture at line 66-72. Change `deletesAfterSuccess: ['old-alert-1']` to:

```js
deletesAfterSuccess: [{ alertId: 'old-alert-1', worldId: 4028, worldName: '伊弗利特' }],
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/save-ops.test.js --no-coverage`
Expected: Multiple failures — `computeSaveOps` still pushes bare strings, `executeSaveOps` tries to use string as alertId.

- [ ] **Step 3: Update `computeSaveOps` to push rich objects**

In `src/save-ops.js`, change line 35 from:

```js
deletesAfterSuccess.push(existing.alertId);
```

to:

```js
deletesAfterSuccess.push({ alertId: existing.alertId, worldId: existing.worldId, worldName: existing.worldName || '' });
```

And change line 43 from:

```js
deletesAfterSuccess.push(existing.alertId);
```

to:

```js
deletesAfterSuccess.push({ alertId: existing.alertId, worldId: existing.worldId, worldName: existing.worldName || '' });
```

- [ ] **Step 4: Update `executeSaveOps` DELETE loop to read `.alertId`**

In `src/save-ops.js`, change line 93 from:

```js
ops.deletesAfterSuccess.map(async (id) => {
  try {
    return await _API.deleteAlert(id);
```

to:

```js
ops.deletesAfterSuccess.map(async (entry) => {
  try {
    return await _API.deleteAlert(entry.alertId);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/save-ops.test.js --no-coverage`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/save-ops.js tests/save-ops.test.js
git commit -m "refactor: change deletesAfterSuccess to store rich objects with worldId and worldName"
```

---

## Task 2: World-aware error messages in `executeSaveOps`

**Files:**
- Modify: `src/save-ops.js:61-107` (`executeSaveOps` error messages)
- Modify: `tests/save-ops.test.js` (error message assertions)

- [ ] **Step 1: Add tests for world-aware error messages**

In `tests/save-ops.test.js`, update the existing test `'throws and skips deletes if any POST fails'` to assert on the message content:

```js
test('throws with world names when a POST fails', async () => {
  jest.spyOn(API, 'createAlert').mockRejectedValue(new Error('Network error'));
  jest.spyOn(API, 'deleteAlert').mockResolvedValue();
  await expect(executeSaveOps(ops, 44015, formState)).rejects.toThrow(
    'Failed to save alerts for: 利維坦, 鳳凰'
  );
  expect(API.deleteAlert).not.toHaveBeenCalled();
});
```

Add a new test for DELETE-phase failure with world names:

```js
test('throws with world names when a DELETE fails', async () => {
  jest.spyOn(API, 'createAlert').mockResolvedValue({ id: 'new' });
  jest.spyOn(API, 'deleteAlert').mockRejectedValue(new Error('500'));
  await expect(executeSaveOps(ops, 44015, formState)).rejects.toThrow(
    'Alerts saved, but failed to remove old alerts for: 伊弗利特'
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/save-ops.test.js --no-coverage`
Expected: The two error message tests fail — old messages don't contain world names.

- [ ] **Step 3: Implement world-aware error messages**

In `src/save-ops.js`, change the POST failure error (line 84-85) from:

```js
const failures = results.filter(r => r.status === 'rejected');
if (failures.length > 0) {
  throw new Error(`Failed to create ${failures.length} alert(s). No deletions performed.`);
}
```

to:

```js
const failedIndices = results
  .map((r, i) => r.status === 'rejected' ? i : -1)
  .filter(i => i !== -1);
if (failedIndices.length > 0) {
  const names = failedIndices.map(i => ops.postsNeeded[i].worldName || ops.postsNeeded[i].worldId).join(', ');
  throw new Error(`Failed to save alerts for: ${names}`);
}
```

Change the DELETE failure error (line 102-104) from:

```js
const deleteFailures = deleteResults.filter(r => r.status === 'rejected');
if (deleteFailures.length > 0) {
  throw new Error(`Failed to delete ${deleteFailures.length} alert(s). Some alerts may need manual cleanup.`);
}
```

to:

```js
const failedDeleteIndices = deleteResults
  .map((r, i) => r.status === 'rejected' ? i : -1)
  .filter(i => i !== -1);
if (failedDeleteIndices.length > 0) {
  const names = failedDeleteIndices.map(i => ops.deletesAfterSuccess[i].worldName || ops.deletesAfterSuccess[i].worldId).join(', ');
  throw new Error(`Alerts saved, but failed to remove old alerts for: ${names}. These may need manual cleanup.`);
}
```

- [ ] **Step 4: Run all tests**

Run: `npx jest --no-coverage`
Expected: All pass. Note: `tests/alerts-page.test.js` line 99 asserts `toThrow('Failed to delete 1 alert')` — this test will now fail because `deleteGroup` in `alerts-page.js` still uses its own error message. That's fine — it will be fixed in Task 4.

If the alerts-page test fails, temporarily skip it with `test.skip(...)` and note it for Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/save-ops.js tests/save-ops.test.js tests/alerts-page.test.js
git commit -m "feat: include world names in save error messages"
```

---

## Task 3: Modal `'refreshing'` phase and `onSave` re-fetch

**Files:**
- Modify: `src/modal.js:141-148` (add `'refreshing'` phase to `onProgress`)
- Modify: `src/market-page.js:72-75` (`onSave` re-fetches)
- Modify: `src/alerts-page.js:115-117` (edit `onSave` re-fetches)
- Modify: `tests/modal.test.js` (add `'refreshing'` phase test)
- Modify: `tests/market-page.test.js` (test re-fetch in `onSave`)
- Modify: `tests/alerts-page.test.js` (test re-fetch in edit `onSave`)

- [ ] **Step 1: Add modal test for `'refreshing'` phase**

In `tests/modal.test.js`, add to the `'openModal — save progress'` describe:

```js
test('displays "Refreshing state..." for refreshing phase', async () => {
  let resolveOnSave;
  const onSave = jest.fn(() => new Promise(r => { resolveOnSave = r; }));
  GM_getValue.mockReturnValue('https://wh.com');
  Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave });

  const saveBtn = document.querySelector('#univ-alert-modal [data-action="save"]');
  const statusEl = document.querySelector('#univ-alert-modal [data-status]');
  saveBtn.click();
  await new Promise(r => setTimeout(r, 0));

  const onProgress = onSave.mock.calls[0][1];
  onProgress({ phase: 'refreshing' });
  expect(statusEl.style.display).toBe('block');
  expect(statusEl.textContent).toBe('Refreshing state...');

  resolveOnSave();
  await new Promise(r => setTimeout(r, 0));
});
```

- [ ] **Step 2: Add `'refreshing'` phase to modal `onProgress` handler**

In `src/modal.js`, change the `onProgress` callback (lines 141-148) from:

```js
const onProgress = ({ phase, completed, total }) => {
  statusEl.style.display = 'block';
  if (phase === 'creating') {
    statusEl.textContent = `Creating alert ${completed} of ${total}...`;
  } else {
    statusEl.textContent = `Removing old alert ${completed} of ${total}...`;
  }
};
```

to:

```js
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
```

- [ ] **Step 3: Run modal tests**

Run: `npx jest tests/modal.test.js --no-coverage`
Expected: All pass.

- [ ] **Step 4: Add market-page test for re-fetch in `onSave`**

In `tests/market-page.test.js`, add a new test in the `'handleAlertButtonClick'` describe:

```js
test('onSave re-fetches alerts before computing ops', async () => {
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0,
    trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };
  API.getAlerts.mockResolvedValue([alert1]);
  SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [], deletesAfterSuccess: [] });
  SaveOps.executeSaveOps.mockResolvedValue();

  await MarketPage.handleAlertButtonClick(44015, '木棉原木');
  expect(API.getAlerts).toHaveBeenCalledTimes(1); // initial fetch

  // Invoke onSave
  const { onSave } = Modal.openModal.mock.calls[0][0];
  const onProgress = jest.fn();
  const formState = { name: 'Test', webhook: 'https://wh.com', trigger: alert1.trigger, selectedWorldIds: new Set([4030]) };

  // Return a different set on re-fetch to prove it was called
  const alert2 = { ...alert1, id: 'a2', worldId: 4031 };
  API.getAlerts.mockResolvedValue([alert1, alert2]);

  await onSave(formState, onProgress);

  // Should have fetched again inside onSave
  expect(API.getAlerts).toHaveBeenCalledTimes(2);
  // onProgress should have been called with 'refreshing' phase
  expect(onProgress).toHaveBeenCalledWith({ phase: 'refreshing' });
  // computeSaveOps should have been called with the fresh group (not the stale one)
  expect(SaveOps.computeSaveOps).toHaveBeenCalled();
});
```

- [ ] **Step 5: Run market-page test to verify it fails**

Run: `npx jest tests/market-page.test.js --no-coverage`
Expected: Fails — current `onSave` doesn't re-fetch.

- [ ] **Step 6: Update market-page `onSave` to re-fetch**

In `src/market-page.js`, change the `onSave` callback (lines 72-75) from:

```js
onSave: async (formState, onProgress) => {
  const ops = _SaveOps().computeSaveOps(group, formState, _WorldMap().WORLDS);
  await _SaveOps().executeSaveOps(ops, itemId, formState, { onProgress });
},
```

to:

```js
onSave: async (formState, onProgress) => {
  onProgress?.({ phase: 'refreshing' });
  const freshAlerts = await _API().getAlerts();
  const freshItemAlerts = freshAlerts.filter(a => a.itemId === itemId);
  const freshGroups = _Grouping().groupAlerts(freshItemAlerts);
  freshGroups.forEach(g => {
    g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap().worldById(w.worldId)?.worldName || '' }));
  });
  const { normalizeTrigger } = _Grouping();
  const originalTriggerKey = group ? normalizeTrigger(group.trigger) : null;
  const freshGroup = originalTriggerKey
    ? freshGroups.find(g => normalizeTrigger(g.trigger) === originalTriggerKey) || null
    : null;
  const ops = _SaveOps().computeSaveOps(freshGroup, formState, _WorldMap().WORLDS);
  await _SaveOps().executeSaveOps(ops, itemId, formState, { onProgress });
},
```

**Edge case note:** On a retry after partial failure where the user changed the trigger, the original trigger key still matches the group that was being edited. Alerts already created with the *new* trigger would form a new group, and `computeSaveOps` against the *old* group would try to create them again. However, since we re-fetch, those already-created alerts are visible — `freshGroup` would still be the old trigger group (now with fewer worlds), and `computeSaveOps` correctly sees the new-trigger worlds as "not existing in this group" and posts them. The already-created new-trigger alerts belong to a different group and are untouched. This is correct behavior.

- [ ] **Step 7: Run market-page tests**

Run: `npx jest tests/market-page.test.js --no-coverage`
Expected: All pass.

- [ ] **Step 8: Update alerts-page edit `onSave` to re-fetch**

In `src/alerts-page.js`, change the edit `onSave` callback (lines 115-123) from:

```js
onSave: async (formState, onProgress) => {
  const ops = _SaveOps().computeSaveOps(freshGroup, formState, _WorldMap().WORLDS);
  await _SaveOps().executeSaveOps(ops, group.itemId, formState, { onProgress });
  // Refresh panel after save
  const updatedAlerts = await _API().getAlerts();
  const updatedNames = scrapeItemNames();
  // Merge in persisted nameMap entries (native DOM may be hidden)
  nameMap.forEach((v, k) => { if (!updatedNames.has(k)) updatedNames.set(k, v); });
  renderAlertsPanel(updatedAlerts, updatedNames);
},
```

to:

```js
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
  // Refresh panel after save
  const updatedAlerts = await _API().getAlerts();
  const updatedNames = scrapeItemNames();
  nameMap.forEach((v, k) => { if (!updatedNames.has(k)) updatedNames.set(k, v); });
  renderAlertsPanel(updatedAlerts, updatedNames);
},
```

- [ ] **Step 9: Run all tests**

Run: `npx jest --no-coverage`
Expected: All pass (except possibly the alerts-page `deleteGroup` error message test skipped in Task 2).

- [ ] **Step 10: Commit**

```bash
git add src/modal.js src/market-page.js src/alerts-page.js tests/modal.test.js tests/market-page.test.js
git commit -m "feat: re-fetch alerts on every save to prevent stale-group duplicates"
```

---

## Task 4: Delete button recovery with retry UX

**Files:**
- Modify: `src/alerts-page.js:84-89` (delete handler)
- Modify: `src/alerts-page.js:133-148` (`deleteGroup` return shape)
- Modify: `tests/alerts-page.test.js` (new tests for retry UX and return shape)

- [ ] **Step 1: Update `deleteGroup` tests for new return shape**

In `tests/alerts-page.test.js`, replace the existing `deleteGroup` describe with:

```js
describe('deleteGroup', () => {
  test('calls deleteAlert for each alertId in group', async () => {
    API.deleteAlert.mockResolvedValue();
    const group = { worlds: [
      { alertId: 'a1', worldId: 4030, worldName: '利維坦' },
      { alertId: 'a2', worldId: 4031, worldName: '鳳凰' },
    ] };
    const result = await AlertsPage.deleteGroup(group);
    expect(API.deleteAlert).toHaveBeenCalledTimes(2);
    expect(API.deleteAlert).toHaveBeenCalledWith('a1');
    expect(API.deleteAlert).toHaveBeenCalledWith('a2');
    expect(result.failures).toEqual([]);
  });

  test('returns failures with world info on partial failure', async () => {
    API.deleteAlert.mockResolvedValueOnce().mockRejectedValueOnce(new Error('500'));
    const group = { worlds: [
      { alertId: 'a1', worldId: 4030, worldName: '利維坦' },
      { alertId: 'a2', worldId: 4031, worldName: '鳳凰' },
    ] };
    const result = await AlertsPage.deleteGroup(group);
    expect(result.failures).toEqual([
      { alertId: 'a2', worldId: 4031, worldName: '鳳凰' },
    ]);
  });

  test('calls onProgress after each deletion', async () => {
    API.deleteAlert.mockResolvedValue();
    const group = { worlds: [
      { alertId: 'a1', worldId: 4030, worldName: '利維坦' },
      { alertId: 'a2', worldId: 4031, worldName: '鳳凰' },
      { alertId: 'a3', worldId: 4032, worldName: '奧汀' },
    ] };
    const progressCalls = [];
    await AlertsPage.deleteGroup(group, (p) => progressCalls.push(p));
    expect(progressCalls).toEqual([
      { completed: 1, total: 3 },
      { completed: 2, total: 3 },
      { completed: 3, total: 3 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/alerts-page.test.js --no-coverage`
Expected: Fails — `deleteGroup` still throws instead of returning `{ failures }`.

- [ ] **Step 3: Update `deleteGroup` to return `{ failures }`**

In `src/alerts-page.js`, replace the `deleteGroup` function (lines 133-148) with:

```js
async function deleteGroup(group, onProgress) {
  const total = group.worlds.length;
  let completed = 0;
  const results = await Promise.allSettled(group.worlds.map(async (w, i) => {
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
```

- [ ] **Step 4: Run deleteGroup tests**

Run: `npx jest tests/alerts-page.test.js --no-coverage`
Expected: All `deleteGroup` tests pass.

- [ ] **Step 5: Add test for delete button retry UX**

In `tests/alerts-page.test.js`, add a new describe block:

```js
describe('delete button — retry on partial failure', () => {
  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'My Alert', discordWebhook: 'https://wh.com',
    triggerVersion: 0, trigger };
  const alert2 = { ...alert1, id: 'a2', worldId: 4031 };
  const alert3 = { ...alert1, id: 'a3', worldId: 4032 };

  test('shows "Retry (N remaining)" and updates pills on partial delete failure', async () => {
    setupNativeDOM();
    // First delete succeeds, second fails, third fails
    API.deleteAlert
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('500'))
      .mockRejectedValueOnce(new Error('500'));

    AlertsPage.renderAlertsPanel([alert1, alert2, alert3], new Map([[44015, '木棉原木']]));

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
    setupNativeDOM();
    API.deleteAlert.mockResolvedValue();

    AlertsPage.renderAlertsPanel([alert1, alert2], new Map([[44015, '木棉原木']]));

    const deleteBtn = document.querySelector('[data-action="delete"]');
    const row = deleteBtn.closest('tr');
    deleteBtn.click();
    await new Promise(r => setTimeout(r, 0));

    expect(row.parentNode).toBeNull(); // removed from DOM
  });
});
```

- [ ] **Step 6: Run tests to verify new tests fail**

Run: `npx jest tests/alerts-page.test.js --no-coverage`
Expected: The retry UX tests fail — delete handler doesn't handle partial failures.

- [ ] **Step 7: Update delete button handler for retry UX**

In `src/alerts-page.js`, replace the delete handler block (lines 84-89) with:

```js
if (action === 'delete') {
  e.target.disabled = true;
  const { failures } = await deleteGroup(group, ({ completed, total }) => {
    e.target.textContent = `Deleting ${completed}/${total}...`;
  });
  if (failures.length === 0) {
    e.target.closest('tr').remove();
  } else {
    // Update group to only contain failed worlds for retry
    group.worlds = failures;
    e.target.textContent = `Retry (${failures.length} remaining)`;
    e.target.disabled = false;
    // Update world pills in the row
    const pillsCell = e.target.closest('tr').querySelector('td:nth-child(3)');
    pillsCell.innerHTML = failures
      .map(w => `<span style="background:#1a3a5c;border-radius:12px;padding:2px 8px;font-size:12px;margin:2px">${w.worldName || w.worldId}</span>`)
      .join('');
  }
}
```

- [ ] **Step 8: Run all tests**

Run: `npx jest --no-coverage`
Expected: All pass.

- [ ] **Step 9: Commit**

```bash
git add src/alerts-page.js tests/alerts-page.test.js
git commit -m "feat: delete button recovery with retry UX and world-aware error messages"
```

---

## Task 5: Rebuild and update docs

**Files:**
- Run: `build.js`
- Modify: `docs/superpowers/specs/2026-03-23-universalis-alert-tampermonkey-design.md` (update error handling + delete sections)

- [ ] **Step 1: Rebuild userscript**

Run: `node build.js`

- [ ] **Step 2: Update the main design spec**

In `docs/superpowers/specs/2026-03-23-universalis-alert-tampermonkey-design.md`:

1. In the **Save Logic** section, update the error handling paragraph to mention world-aware error messages and re-fetch on retry.

2. In the **Save Logic > Progress indication** subsection, add the `'refreshing'` phase to the status mapping table.

3. In the **Enhanced Panel UX** Delete bullet, mention retry behavior on partial failure.

- [ ] **Step 3: Commit**

```bash
git add universalis-alert.user.js docs/superpowers/specs/2026-03-23-universalis-alert-tampermonkey-design.md
git commit -m "docs: update spec for partial failure handling and rebuild userscript"
```
