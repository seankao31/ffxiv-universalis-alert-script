# Partial Failure Handling — Design

**Date:** 2026-03-24
**Status:** Superseded by [2026-03-26-current-design.md](2026-03-26-current-design.md) — all fixes implemented

## Problem

With rate-limited sequential requests, save and delete operations take noticeable time and can partially fail. The current implementation has three issues:

1. **Stale-group-on-retry creates duplicates.** The modal's `onSave` callback captures the alert group at modal-open time. If a save partially succeeds (e.g., 5 of 8 POSTs land) and the user retries, `computeSaveOps` runs against the stale group and re-POSTs the 5 already-created alerts, producing duplicates.

2. **Error messages don't name the failed worlds.** The user sees "Failed to create 3 alert(s)" with no indication of which worlds failed.

3. **Delete button has no recovery path.** On the alerts page, if `deleteGroup` partially fails, the Delete button is stuck disabled with no retry option.

---

## Fix 1: Re-fetch on every save

### Approach

Move the re-fetch + recompute logic into the `onSave` callback. On **every** Save click (including retries), `onSave` will:

1. Report progress: `{ phase: 'refreshing' }` — modal displays "Refreshing state..."
2. `GET /api/web/alerts`, filter to current `itemId`, group alerts, find the matching group by normalized trigger
3. `computeSaveOps` against the fresh group
4. Execute with progress as before

Both call sites (market-page `onSave` and alerts-page edit `onSave`) get the same treatment. The first save also re-fetches — one extra GET is cheap and avoids a "is this a retry?" flag.

### Modal status mapping

The modal's `onProgress` handler gains a `'refreshing'` phase:

| Phase | Status text |
|---|---|
| `refreshing` | "Refreshing state..." |
| `creating` | "Creating alert 3 of 8..." |
| `removing` | "Removing old alert 1 of 3..." |

---

## Fix 2: World-aware error messages

### Changes to `computeSaveOps`

`deletesAfterSuccess` currently stores bare `alertId` strings. Change to store objects: `{ alertId, worldId, worldName }`. This gives `executeSaveOps` the world info it needs for both POST and DELETE error messages.

All consumers of `deletesAfterSuccess` (the DELETE loop in `executeSaveOps`) must be updated to read `.alertId` from the object instead of using the string directly.

### Changes to `executeSaveOps`

Track which worlds failed in each phase. Error messages name the worlds using user-intent language:

- **POST failures:** `"Failed to save alerts for: 利維坦, 鳳凰"`
- **DELETE failures (cleanup during save):** `"Alerts saved, but failed to remove old alerts for: 巴哈姆特. These may need manual cleanup."`

The world names come from:
- POST phase: the `world.worldName` property on each `postsNeeded` entry (already available)
- DELETE phase: the `worldName` property on each `deletesAfterSuccess` entry (newly added above)

---

## Fix 3: Delete button recovery

### Changes to `deleteGroup`

Instead of throwing on partial failure, `deleteGroup` returns a result object:

```js
{ failures: [{ alertId, worldId, worldName }] }
```

On complete success, `failures` is empty. This is cleaner than throw/catch because partial success is not an exception.

The error message for delete failures uses the same world-aware format:
`"Failed to delete alerts for: 巴哈姆特, 拉姆"`

### Changes to the delete button handler

On partial failure:
1. Mutate `group.worlds` to contain only the surviving (failed-to-delete) worlds
2. Update the button text to **"Retry (N remaining)"**, re-enable the button
3. Update the world pills in the row to show only the remaining worlds (remove the successfully-deleted ones)
4. Clicking again calls `deleteGroup` with the reduced group

On complete success: remove the row as before.

On complete failure (every delete failed): same "Retry (N remaining)" UX, all pills stay.

---

## Files affected

| File | Change |
|---|---|
| `src/save-ops.js` | `computeSaveOps`: `deletesAfterSuccess` stores `{ alertId, worldId, worldName }`. `executeSaveOps`: world-aware error messages. |
| `src/modal.js` | `onProgress` handler: add `'refreshing'` phase display. |
| `src/market-page.js` | `onSave`: re-fetch alerts, recompute ops, report `'refreshing'` phase. |
| `src/alerts-page.js` | `onSave`: re-fetch alerts, recompute ops, report `'refreshing'` phase. `deleteGroup`: return `{ failures }` instead of throwing. Delete handler: retry UX with world pill update. |
| `tests/save-ops.test.js` | Update `deletesAfterSuccess` shape in all test fixtures. Add world-aware error message assertions. |
| `tests/modal.test.js` | Add test for `'refreshing'` phase status display. |
| `tests/market-page.test.js` | Test that `onSave` re-fetches before computing ops. |
| `tests/alerts-page.test.js` | Test `deleteGroup` return shape. Test delete retry UX (button text, world pill update). |
