# Alert Capacity Management

Universalis enforces a 40-alert-per-account limit. Alerts on different servers count separately, so monitoring 8 worlds for one item consumes 8 slots. This design adds capacity awareness to the bulk alerts modal.

## Goals

1. Show current usage vs. max capacity in the modal list view
2. Reject saves that would exceed capacity, with an actionable error message
3. Handle edits safely via interleaved POST/DELETE when capacity is tight

## Constants & Capacity Computation

`MAX_ALERTS = 40` in `SaveOps`.

New signature: `computeSaveOps(group, formState, worlds, currentAlertCount)`.

It returns two new fields alongside the existing `postsNeeded` and `deletesAfterSuccess`:

- `capacityError` — `null` if the operation fits, or a string like `"Not enough alert slots (need 8, only 3 available)"`
- `netChange` — `postsNeeded.length - deletesAfterSuccess.length`

Validation rules:
- **New alerts:** `currentAlertCount + postsNeeded.length > 40` → reject
- **Edits:** `currentAlertCount + netChange > 40` → reject. The interleaving algorithm ensures the final count does not exceed 40; individual API calls within a batch are serialized by `rate-limit.js`, so the server-side count stays consistent. Note: for new alerts `deletesAfterSuccess` is always empty, so both rules produce the same result; they are separated for clarity.

## Interleaved Execution

`executeSaveOps` receives `availableSlots` in its options object (= `40 - currentAlertCount`) and batches operations:

```
while (pending POSTs or DELETEs remain):
  1. POST min(remainingPOSTs, availableSlots)  [parallel within batch]
  2. availableSlots -= postsCompleted
  3. If availableSlots === 0 and POSTs remain:
     - DELETE old alerts, preferring those whose replacements were just POSTed
     - Fall back to old alerts without replacements if no "safe" deletes exist
     - availableSlots += deletesCompleted
  4. Repeat
After all POSTs done:
  5. DELETE any remaining old alerts
```

Note: "parallel within batch" means requests are enqueued concurrently via `Promise.allSettled` but individual API calls are serialized by the existing `rate-limit.js` module. No new throttling logic is needed.

POST-to-DELETE matching uses `worldId` — when a world appears in both `postsNeeded` and `deletesAfterSuccess`, the DELETE is "safe" once its replacement POST succeeds.

**Coverage gap at full capacity:** When `availableSlots` is 0, no POSTs have occurred yet, so there are no "safe" deletes. The fallback deletes old alerts before their replacements exist, creating a brief window where those alerts are missing. This is accepted behavior — the alternative (rejecting all edits at full capacity) would be far worse for the user.

## Failure & Retry

On failure mid-interleave:
- Stop after the current batch settles — operations within a batch use `Promise.allSettled` (consistent with existing codebase), so in-flight requests in the same batch complete, but no new batches are started
- Show error with Retry button
- Error indicates what failed, e.g. `"Failed to save alerts for: 泰坦, 拉姆"`

On Retry:
- Re-fetch alerts via `getAlerts()` for fresh state
- Recompute `computeSaveOps` against fresh state — partial progress is automatically accounted for (completed POSTs won't reappear, completed DELETEs won't reappear)
- Re-run `executeSaveOps` with reduced ops and updated `availableSlots`

This is idempotent — no tracking of previous attempt needed.

## UI Changes

**List view:** A line below the title:
```
Alert slots: 24 / 40 used
```
Styled as `color:#888; font-size:13px`. Count from `allAlerts.length`, passed through `openBulkModal` → `renderListView`. Stays accurate after save/delete since list re-renders with fresh data.

**Form view — save validation:** When `computeSaveOps` returns `capacityError`, show it in the existing `data-error-area`. Save button stays enabled so user can uncheck worlds and retry.

**Form view — execution failure:** Show error in `data-error-area`, change Save button text to "Retry". Click re-invokes the same `onSave` callback — no separate retry code path needed, since the existing fresh-fetch → recompute → execute flow is already idempotent.

## Data Flow

```
handleClick()
  → getAlerts() → allAlerts.length = alertCount
  → openBulkModal({ groups, nameMap, currentItemId, currentItemName, alertCount })

List view: displays "Alert slots: N / 40 used"

Form view onSave:
  → getAlerts() [fresh]
  → computeSaveOps(freshGroup, formState, WORLDS, freshAlertCount)
      → if capacityError: show error, stop
  → executeSaveOps(ops, itemId, formState, { onProgress, availableSlots })
      → interleaved POST/DELETE batching
      → on failure: show error + Retry
  → getAlerts() [refresh]
  → re-render list view with updated count
```

## Modules Touched

- `save-ops.js` — `MAX_ALERTS`, capacity validation in `computeSaveOps`, interleaved execution in `executeSaveOps`
- `modal.js` — pass `alertCount` to list view, handle `capacityError`, Retry button
- `header-button.js` — pass `allAlerts.length` into `openBulkModal`

No changes to: `api.js`, `grouping.js`, `worldmap.js`, `header.js`, `init.js`, `rate-limit.js`
