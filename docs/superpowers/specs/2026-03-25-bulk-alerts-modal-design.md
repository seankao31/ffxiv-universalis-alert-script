# Bulk Alerts Modal — Design Spec

## Overview

Transform the market page's "Set Alerts" button into a "Bulk Alerts" button that opens a full alert management modal for the current item. The modal supports viewing, creating, editing, and deleting alerts — bringing core Alerts page functionality to individual market pages.

## Modal States & Navigation

The modal has two views that swap in-place:

1. **List View** — all alert groups for this item, with Edit/Delete per group and a pinned "New Alert" button. A ✕ close button in the header dismisses the modal (uses existing `closeModal`).
2. **Form View** — the alert creation/editing form (same fields as today's modal form)

### Routing on open

The caller (`market-page.js`) fetches alerts and filters for the item before opening the modal. If the fetch fails, the error is displayed inline next to the button (same as current behavior — modal does not open).

- Item has **no alerts** → open directly to Form View
- Item has **alerts** → open to List View

### Transitions

| From | Action | To |
|------|--------|----|
| List View | Click "New Alert" | Form View (blank) |
| List View | Click "Edit" on a group | Form View (pre-filled with group data) |
| List View | Click ✕ close button | Modal closes |
| Form View | Click "← Back to alerts" | List View |
| Form View | Successful save | List View (re-fetched) |
| List View | Delete last remaining group (fully successful) | Form View (blank, same defaults as "New Alert") |

The modal can also be dismissed by pressing Escape or clicking the overlay background. This applies to both the existing `openModal` and the new `openBulkModal`.

## List View

Scoped to the current item. Each alert group row shows:

- **Rule** — formatted trigger string (e.g., "Min price < 130 HQ"). Uses a `formatRule` helper extracted from `alerts-page.js` or duplicated in `modal.js`.
- **World pills** — which worlds have this alert
- **Edit button** — navigates to Form View pre-filled with the group's data
- **Delete button** — same retry UX as alerts page:
  - Shows "Deleting X/Y..." progress
  - On partial failure: button updates to "Retry (N remaining)", world pills update to show only failed worlds
  - On complete success: removes the row from the list

The alert list area has `max-height` with `overflow-y: auto`. The "New Alert" button is pinned below the scroll area (outside the scrolling container).

## Form View

Identical fields to the current modal form:

- Alert Name (text input, defaults to item name or group name when editing)
- Discord Webhook (text input, defaults from group → GM_getValue → empty)
- Metric (dropdown: Price Per Unit, Quantity, Total)
- Reducer (dropdown: min, max, mean)
- Comparator (dropdown: < or >)
- Target Value (number input)
- HQ Only (checkbox)
- World Checkboxes (all 8 worlds, with Select All / Clear)

When navigating from List View, a "← Back to alerts" link appears at the top of the form.

### Editing

When clicking Edit on a group, the form pre-fills:
- Name, webhook from the group
- Trigger fields (metric, reducer, comparator, target, HQ) extracted from `group.trigger` — reuses the same parsing logic currently in `openModal` (extracting comparator key, target value, HQ from filters, mapper, reducer)
- World checkboxes set to match `group.worlds`

Save uses existing `computeSaveOps` / `executeSaveOps` flow. On success, the modal re-fetches alerts and returns to List View.

**Known limitation:** `computeSaveOps` detects changes to trigger and name only. If a user edits only the webhook, no save operations are produced. This is a pre-existing limitation not addressed in this feature.

### Creating

When clicking "New Alert", the form opens blank (same defaults as today). Save creates alerts for selected worlds, then returns to List View.

## Button Change

Market page button text changes from "🔔 Set Alerts" to "🔔 Bulk Alerts".

## Files Changed

### Modified

- **`src/market-page.js`**
  - Button label: "Set Alerts" → "Bulk Alerts"
  - `handleAlertButtonClick`: simplified — fetches alerts, filters for item, groups them, and calls `openBulkModal` passing itemId, itemName, and groups. Error handling for failed fetch stays in the caller (modal does not open on error).

- **`src/modal.js`**
  - New function: `openBulkModal({ itemId, itemName, groups })` — creates modal overlay/container, renders List View or Form View based on whether groups is non-empty
  - New internal function: `renderListView(container, itemId, itemName, groups)` — renders alert group rows with Edit/Delete, "New Alert" button
  - New internal function: `renderFormView(container, { itemId, itemName, group, onSave, onBack })` — renders the form (refactored from current `openModal` internals)
  - Existing `openModal` preserved for alerts-page.js backward compatibility. The `multipleGroups` parameter in `openModal` becomes unused by the market page flow but remains for alerts-page compatibility (alerts-page always passes `multipleGroups: false`).
  - New export: `openBulkModal`

### Unchanged

- `src/api.js` — no new endpoints needed
- `src/save-ops.js` — existing computeSaveOps/executeSaveOps reused as-is
- `src/grouping.js` — existing groupAlerts/normalizeTrigger reused
- `src/alerts-page.js` — completely untouched
- `src/rate-limit.js`, `src/worldmap.js`, `src/init.js`, `src/header.js` — untouched
- `build.js` — no new modules, build order unchanged

### Tests

- New test file or additions to existing modal tests:
  - List view renders correctly with grouped alerts
  - Navigation: "New Alert" → form, "← Back" → list, Edit → pre-filled form
  - Delete with retry UX (progress, partial failure, row removal)
  - Routing: no alerts → form directly, has alerts → list view
  - After save → returns to list view with re-fetched data
