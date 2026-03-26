# Header Button Redesign

**Status:** Superseded by [2026-03-26-current-design.md](2026-03-26-current-design.md) — core design implemented, details evolved (fetchItemNames approach, skip handling, duplicate detection)

Move the "Bulk Alerts" button from per-page injection into the global header. Remove the dedicated alerts page. The modal becomes the single interface for viewing and managing all alerts.

## Motivation

The previous approach injected the button into page-specific locations (market page button bar, account page nav tabs). This was fragile — the account page insertion never worked reliably. Moving to the header eliminates route-specific DOM insertion and provides a consistent entry point on every page.

## Design

### 1. Header Button (market-page.js → header-button.js)

**IIFE global name:** `HeaderButton` (replaces `MarketPage`)

**Injection target:** the div that contains an `a[href="/account"]` link — i.e., the account section in the header. Found by querying `header a[href="/account"]` and using `.closest()` to walk up to the direct child div of `header > div` (the account section). This anchors on a semantic element rather than positional index.

```html
<div>  <!-- account section -->
  <!-- Button inserted here as firstChild -->
  <div><a href="/account">帳號</a> <span class="username">...</span></div>
  <div><button class="btn-settings">⚙️</button></div>
</div>
```

**Module exports:** `{ init, injectButton, handleClick }`

- `findAccountSection()` — queries `header a[href="/account"]` and uses `.closest()` to find the direct child div of the header wrapper (private). Returns null if not found (e.g., logged-out state — injection is a no-op).
- `injectButton()` — creates "🔔 Bulk Alerts" button with `id="univ-alert-btn"`, inserts as `firstChild` of account section. Idempotent.
- `handleClick()` — fetches all alerts and item names in parallel via `Promise.allSettled` (per project convention for concurrent operations that can partially fail), groups alerts, detects current page context, opens modal.
- `fetchItemNames()` — fetches `/account/alerts` HTML, scrapes `a[href^="/market/"]` links into `Map<itemId, name>`. Lives in this module since it's only called from `handleClick`. Falls back to empty Map on failure.
- `init()` — attempts immediate injection, falls back to MutationObserver if header not rendered yet.

**Current page context detection at click time:**
- Check `window.location.pathname` matches `/market/{id}` (3-part path, numeric second segment)
- If so, read item name from `document.querySelector('h1')`
- Pass as `currentItemId`/`currentItemName` to modal (null if not on item page)

**Error handling in `handleClick`:**
- `getAlerts()` failure: show inline error adjacent to the header button ("Failed to load alerts"). Modal does not open. Same pattern as current market-page.js but positioned next to the header button.
- `fetchItemNames()` failure: silently degrade — names fall back to `Item #ID` in the modal. This is non-critical.

### 2. Modal Changes

#### List view (`renderListView`) redesign

**New parameters:** `{ groups, nameMap, onEdit, onDelete, onNew, onClose, newAlertDisabled }`

- Removes `itemId` and `itemName` single-item params
- Adds `nameMap` (Map<number, string>) for item name resolution
- Adds `newAlertDisabled` (boolean) to control "New Alert" button state

**Header:** "Bulk Alerts" (no item-specific suffix)

**Rows:** flat list, sorted by `itemId` inside `renderListView` so same-item alerts cluster together. The sort is performed internally by the render function (not the caller) to ensure consistency across re-renders after save/delete. Each row shows:
- Item name + ID (resolved from `nameMap`, fallback `Item #ID`)
- Formatted rule (existing `formatRule` from modal.js)
- World pills
- Edit / Delete buttons

**"New Alert" button:** when `newAlertDisabled` is true, button is greyed out with `title="Navigate to an item page to create alerts"`.

**Empty state (no alerts + not on item page):** show message "No alerts yet. Navigate to an item page to create one." instead of form view.

#### `openBulkModal` redesign

**New signature:** `openBulkModal({ groups, nameMap, currentItemId, currentItemName })`

- `groups` — all alert groups across all items (already enriched with worldName)
- `nameMap` — Map<number, string> for item name resolution
- `currentItemId` / `currentItemName` — set only on `/market/{id}`, null otherwise

**Initial routing:**
- No alerts + on item page → form view (create for current item)
- No alerts + NOT on item page → list view with empty state message
- Has alerts → list view

**Internal closures (`showListView` / `showFormView`):**

`showListView(currentGroups)` — calls `renderListView` with:
- `groups`: `currentGroups` (passed in)
- `nameMap`: closed over from `openBulkModal` params
- `newAlertDisabled`: `!currentItemId` (closed over)
- `onEdit(group)`: calls `showFormView(group)`
- `onDelete`: calls `handleListDelete`; `onAllDeleted` transitions to form view if `currentItemId` is set, otherwise shows empty state message
- `onNew`: calls `showFormView(null)` (uses `currentItemId`/`currentItemName`)

`showFormView(group)` — calls `renderFormView` with:
- `itemId`/`itemName`: if `group` is non-null (editing), resolve from `group.itemId` + `nameMap`; if null (new alert), use `currentItemId`/`currentItemName`
- `onBack`: points back to `showListView` (null if no alerts existed initially, same as current behavior)
- `onSave`: re-fetches all alerts via `getAlerts()`, re-groups, re-enriches with worldName, then calls `showListView(updatedGroups)`. Does **not** filter to a single itemId (unlike current code).

**After save in form view:** re-fetch all alerts, re-group, return to list view.

#### Form view (`renderFormView`)

**Updated parameter set:** `(container, { itemId, itemName, group, onSave, onBack })`

- Removes `multipleGroups` — and the notice div that linked to `/account/alerts`
- `itemId`, `itemName`, `group`, `onSave`, `onBack` — unchanged semantics
- The caller (`showFormView`) resolves `itemId`/`itemName` before calling:
  - **Edit:** from the group's `itemId` + `nameMap` lookup
  - **New Alert:** from `currentItemId`/`currentItemName` (page context)

These are distinct contexts: Edit always uses the group's item, New Alert always uses the page's item. This means a user can edit alerts for item X while on any page, but can only create new alerts when on a specific item page.

#### Superseded code from alerts-page.js

All of the following from `alerts-page.js` are superseded by existing modal.js code and do not need to be ported:

- `deleteGroup()` → superseded by `handleListDelete()` in modal.js
- `formatRule()` → identical copy already exists in modal.js (lines 31-38)
- `renderAlertsPanel()` → replaced by the redesigned `renderListView()` in modal.js
- Edit handler (lines 120-163) → superseded by `openBulkModal`'s internal `showFormView` / `onSave` flow

#### `openModal()` removal

`openModal()` was only called by `AlertsPage.renderAlertsPanel`'s edit handler. With alerts-page.js deleted and all editing routed through `openBulkModal`'s `showFormView`, `openModal` is no longer needed. Delete entirely.

**Updated Modal exports:** `{ closeModal, formatRule, renderListView, handleListDelete, openBulkModal }`

### 3. Init Simplification

**init.js** removes all pathname branching:
- `route()` just calls `HeaderButton.init()` (idempotent)
- SPA navigation observer stays — re-calls on pathname change to handle header re-renders

### 4. Cleanup

**Files deleted:**
- `src/alerts-page.js`
- `tests/alerts-page.test.js`

**Files renamed:**
- `src/market-page.js` → `src/header-button.js`
- `tests/market-page.test.js` → `tests/header-button.test.js`

**build.js:**
- Remove `src/alerts-page.js` from `SRC_ORDER`
- Replace `src/market-page.js` with `src/header-button.js` (same position — after modal.js)

**header.js @match:**
- From: `// @match https://universalis.app/market/*` and `// @match https://universalis.app/account/*`
- To: `// @match https://universalis.app/*`

This broadens activation to all pages. The script is lightweight — `init()` just injects one button into the header. On logged-out pages (no account section in header), `findAccountSection()` returns null and injection is a no-op.

**Unchanged modules:** `api.js`, `save-ops.js`, `worldmap.js`, `grouping.js`, `rate-limit.js` — no changes needed.

**Test updates:**
- `tests/header-button.test.js` — rewritten for header injection (account section DOM via `a[href="/account"]` ancestor, not `.box_flex.form`)
- `tests/modal.test.js` / `tests/bulk-modal.test.js` — updated for flat list, nameMap, newAlertDisabled, empty state, multi-item rendering
- `tests/init.test.js` — simplified (no route branching, just HeaderButton.init)
