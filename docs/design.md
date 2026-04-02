# FFXIV Universalis Alert Manager — Design

**Last updated:** 2026-03-26

---

## Overview

TamperMonkey userscript that adds bulk alert management to [universalis.app](https://universalis.app). A persistent header button opens a modal for viewing, creating, editing, and deleting alerts across all items. Targets the 陸行鳥 (繁中服) data center (8 worlds).

---

## Architecture

Source is split into modules under `src/`, concatenated into a single `.user.js` by `bun run build.js`. Build order is defined in `build.js:SRC_ORDER`.

### Module Pattern

Every module uses an IIFE + CommonJS dual-export:

```js
const ModuleName = (() => {
  // ...
  return { publicFn1, publicFn2 };
})();
if (typeof module !== 'undefined') module.exports = ModuleName;
```

In TamperMonkey, modules are globals available by name. In tests, modules are `require()`'d via CommonJS.

### Modules

| Module | File | Responsibility |
|---|---|---|
| `WorldMap` | `src/worldmap.js` | World ID ↔ name mapping, hardcoded to 陸行鳥 DC (IDs 4028–4035) |
| `Grouping` | `src/grouping.js` | Normalizes triggers and groups flat API alerts into logical alert groups |
| `RateLimit` | `src/rate-limit.js` | Sequential request queue with 429 retry and exponential backoff |
| `API` | `src/api.js` | Thin wrappers: `getAlerts()`, `createAlert(payload)`, `deleteAlert(id)` — all calls go through `RateLimit` |
| `SaveOps` | `src/save-ops.js` | Pure `computeSaveOps` function + capacity-aware interleaved `executeSaveOps` |
| `Modal` | `src/modal.js` | Bulk alert modal with list/form views, delete handling, progress display |
| `HeaderButton` | `src/header-button.js` | Header injection, item name fetching, page context detection, click handler |
| `Init` | `src/init.js` | SPA navigation observer, calls `HeaderButton.init()` on every route change |

Build order (`SRC_ORDER`): header → worldmap → grouping → rate-limit → api → save-ops → modal → header-button → init.

### Dependency Resolution

- **Direct** (most modules): `const _Dep = typeof Dep !== 'undefined' ? Dep : require('./dep');`
- **Lazy function** (HeaderButton, Modal — many cross-references): `function _API() { return typeof API !== 'undefined' ? API : _apiModule; }`

### TamperMonkey Header

```js
// @match  https://universalis.app/*
// @grant  GM_getValue
// @grant  GM_setValue
```

The script activates on all pages. `GM_getValue`/`GM_setValue` persist the Discord webhook and item name cache.

---

## API

### Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/web/alerts` | Fetch all alerts (includes `discordWebhook` per alert) |
| `POST` | `/api/web/alerts` | Create one alert |
| `DELETE` | `/api/web/alerts/{alertId}` | Delete one alert |

No `PATCH`/`PUT` exists. Edit = delete affected alerts + create new ones.

### Alert POST Body

```js
{
  name: string,
  itemId: number,
  worldId: number,
  discordWebhook: string,
  triggerVersion: 0,
  trigger: {
    filters: [] | ["hq"],
    mapper: "pricePerUnit" | "quantity" | "total",
    reducer: "min" | "max" | "mean",
    comparison: { lt: { target: number } } | { gt: { target: number } }
  }
}
```

### Rate Limiting

All `fetch` calls go through `RateLimit.rateLimitedFetch()`:

1. **Sequential queue** — one HTTP request at a time, 200 ms minimum delay between requests. Callers using `Promise.allSettled` are transparently throttled.
2. **429 retry with backoff** — up to 3 retries. Uses `Retry-After` header when present, otherwise exponential backoff (1s → 2s → 4s). After exhaustion, returns the 429 response.

| Parameter | Value |
|---|---|
| Inter-request delay | 200 ms |
| Max retries on 429 | 3 |
| Backoff (no Retry-After) | 1000 × 2^attempt ms |

### Capacity Limit

Universalis enforces **40 alerts per account**. Alerts on different servers count separately — monitoring 8 worlds for one item consumes 8 slots.

---

## Data Model

### Logical Alert Groups

Individual API alerts are grouped by `(itemId, normalizedTrigger)`:

```js
{
  itemId: 44015,
  name: "木棉原木 price alert",   // from first alert in group
  discordWebhook: "https://...",
  trigger: {
    filters: [],
    mapper: "pricePerUnit",
    reducer: "min",
    comparison: { lt: { target: 130 } }
  },
  worlds: [
    { worldId: 4030, worldName: "利維坦", alertId: "abc123" },
    { worldId: 4033, worldName: "巴哈姆特", alertId: "def456" }
  ]
}
```

**Grouping rule:** alerts with identical `(itemId, trigger)` belong to the same group. `name` is excluded from the grouping key — minor label differences don't split groups. The group's `name` comes from the first alert.

**Canonical trigger key order:** `filters`, `mapper`, `reducer`, `comparison`. Triggers with keys outside this set are ungroupable and displayed as standalone single-world groups.

**`discordWebhook` is not part of the grouping key.** Alerts with different webhooks merge into one group and are saved with the modal's webhook value.

**Multiple rules for the same item** (e.g., price < 130 and price < 200) produce separate groups.

### World List (陸行鳥 DC)

| World | ID |
|---|---|
| 伊弗利特 | 4028 |
| 迦樓羅 | 4029 |
| 利維坦 | 4030 |
| 鳳凰 | 4031 |
| 奧汀 | 4032 |
| 巴哈姆特 | 4033 |
| 拉姆 | 4034 |
| 泰坦 | 4035 |

---

## Header Button (`HeaderButton`)

### Injection

The button lives in the site's global `<header>`, inside the account section. Found by querying `header a[href="/account"]` and walking up via `.parentElement` to find the direct child of `<header>`.

```html
<header>
  <div>  <!-- main wrapper -->
    ...
  </div>
  <div>  <!-- account section (direct child of header) -->
    <div>  <!-- account div -->
      <!-- "Bulk Alerts" button inserted here as firstChild -->
      <a href="/account">帳號</a> ...
    </div>
    <div><button>⚙️</button></div>
  </div>
</header>
```

- `injectButton()` creates the button with `id="univ-alert-btn"`, inserts as `firstChild` of the account div (the div containing the account link). `white-space:nowrap` prevents line-wrapping when the button is added. Idempotent — no-ops if button already exists.
- `init()` attempts immediate injection, then sets up a `MutationObserver` on `document.body` to re-inject after React re-renders. Observer persists for the session lifetime.
- On logged-out pages (no account section), injection is a no-op.

### Item Name Resolution

`fetchItemNames(itemIds)` resolves item names by fetching individual market pages (`/market/{id}`) and extracting the `<h1>` text.

**Caching:** Names are cached in `GM_setValue('nameCache')` as a JSON object (`{itemId: name}`). On each call, only uncached IDs are fetched. The cache persists across sessions.

**Current page seeding:** When on a `/market/{id}` page, `handleClick` reads the page's `<h1>` and seeds it into the name map, so the item appears with its name even before any alerts exist for it.

**Fallback:** Items without resolved names display as `"Item #12345"`.

### Click Handler (`handleClick`)

1. Clear any previous inline error
2. `GET /api/web/alerts` — on failure, show inline error next to the button; modal does not open
3. Detect page context: if on `/market/{id}`, read `currentItemId` and `currentItemName` from URL + `<h1>`
4. Fetch item names for all unique `itemId`s in alerts (uses cache)
5. Seed current page item name into `nameMap` if not already present
6. Group alerts via `Grouping.groupAlerts`, enrich with world names from `WorldMap`, sort world pills alphabetically within each group
7. Open modal: `Modal.openBulkModal({ groups, nameMap, currentItemId, currentItemName, alertCount })`

---

## Modal (`Modal`)

### Structure

Full-screen overlay (`position:fixed; inset:0`) with a centered inner container (600px wide, max-height 90vh). Dismissible via Escape key or clicking the overlay background.

Two views swap within the inner container:

1. **List View** — all alert groups, with Edit/Delete per group, capacity display, and "New Alert" button
2. **Form View** — alert creation/editing form

### Routing on Open

- **No alerts + on item page** → Form View (create for current item)
- **No alerts + NOT on item page** → Empty state: "No alerts yet. Navigate to an item page to create one."
- **Has alerts** → List View

### List View

Header: "Bulk Alerts" with ✕ close button.

**Capacity display:** `"Alert slots: N / 40 used"` (styled as `color:#888; font-size:13px`).

**Status banner:** Shown after save when worlds were skipped (e.g., "Skipped 2 world(s) where alert already exists: 利維坦, 鳳凰"). Dismissible with ✕.

**Rows:** Flat list sorted by `itemId` so same-item alerts cluster. Each row shows:
- Item name + ID (resolved from `nameMap`, fallback `Item #ID`)
- Formatted rule (e.g., "Min Price < 130" with HQ badge if applicable)
- World pills (sorted by world ID)
- Edit / Delete buttons

**"New Alert" button:** Pinned below the scrollable list area.
- When `currentItemId` is null (not on an item page): greyed out, disabled, with tooltip "Navigate to an item page to create alerts"
- When on an item page: enabled, opens Form View for creating a new alert

### Form View

Fields:
- **Alert Name** — pre-filled with group name (edit) or item name (new)
- **Discord Webhook** — auto-populated: 1) from group's webhook, 2) `GM_getValue('discordWebhook')`, 3) empty. Save is disabled until non-empty.
- **Metric** — dropdown: Price Per Unit, Quantity, Total
- **Reducer** — dropdown: min, max, mean
- **Comparator** — dropdown: < or >
- **Target Value** — number input
- **HQ Only** — checkbox
- **Worlds** — 8 checkboxes (one per 陸行鳥 world) with Select All / Clear buttons. New alerts default all checked; edits match existing group.

**Navigation:**
- **Cancel** button: returns to List View if navigated from there (`onBack`); closes modal if opened directly into Form View

**Save behavior:**
- Save button shows "Saving..." while in progress
- Status line shows phase-specific progress (see Save Logic below)
- On success: re-fetches all alerts, re-groups, returns to List View
- On capacity/duplicate error: shows error message, button resets to "Save"
- On API failure: shows error message, button changes to "Retry"

### Delete Handling

In List View, each group has a Delete button. The flow:

1. Button disables, shows "Queued…"
2. Deletes all `alertId`s in the group via `Promise.allSettled` (serialized through rate limiter)
3. Progress: "Deleting 3/5…"
4. **Complete success:** row is removed. If all groups deleted, transitions to Form View (on item page) or empty state.
5. **Partial failure:** `group.worlds` is mutated to only the failed worlds, world pills update to show remaining, button shows "Retry (N remaining)" and re-enables. Next click retries only remaining deletions.

---

## Save Logic (`SaveOps`)

### `computeSaveOps(group, formState, worlds, currentAlertCount)`

Pure function. Compares the existing group state against the form's desired state and returns:

```js
{
  postsNeeded: [{ worldId, worldName }],           // worlds that need new alerts
  deletesAfterSuccess: [{ alertId, worldId, worldName }],  // alerts to delete after POSTs
  skippedWorlds: [{ worldId, worldName }],          // worlds already covered (no-op)
  netChange: number,                                // postsNeeded.length - deletesAfterSuccess.length
  capacityError: string | null                      // null if operation fits within 40-alert limit
}
```

**Per-world logic:**
- **Newly checked + no existing alert** → POST
- **Unchecked + has existing alert** → DELETE (after POSTs succeed)
- **Checked + existing alert + trigger or name changed** → POST new + DELETE old
- **Checked + existing alert + identical** → skip (added to `skippedWorlds`)

**Capacity validation:**
- If `currentAlertCount + netChange > 40`, returns `capacityError`
- Error message includes both needed slots and available slots (accounting for deletes freeing capacity)

**New alert protection:** When creating (not editing), the modal's `onSave` clears `deletesAfterSuccess` and recomputes capacity without reclaimed slots. This prevents new alerts from deleting existing alerts that share the same trigger.

**Duplicate detection:** When `postsNeeded` and `deletesAfterSuccess` are both empty, the modal throws a user-friendly error:
- New alert: `"Alert 'ItemName' (Min Price < 130) already exists on selected worlds"`
- Edit: `"No changes to save"`

### `executeSaveOps(ops, itemId, formState, { onProgress, availableSlots })`

Capacity-aware interleaved execution:

```
while (pending POSTs or DELETEs remain):
  1. POST min(remainingPOSTs, availableSlots) alerts
  2. availableSlots -= postsCompleted
  3. If slots exhausted and POSTs remain:
     - DELETE old alerts (prefer "safe" deletes — those whose replacements were just POSTed)
     - Fall back to unreplaced deletes if no safe ones exist
     - availableSlots += deletesCompleted
  4. Repeat
After all POSTs done:
  5. DELETE remaining old alerts
```

**Progress reporting** via `onProgress({ phase, completed, total })`:

| Phase | Status text |
|---|---|
| `refreshing` | "Refreshing state..." |
| `creating` | "Creating alert 3 of 8..." |
| `removing` | "Removing old alert 1 of 3..." |

**Error messages name specific worlds:**
- POST failure: `"Failed to save alerts for: 利維坦, 鳳凰"`
- DELETE failure: `"Alerts saved, but failed to remove old alerts for: 巴哈姆特. These may need manual cleanup."`

**Re-fetch on every save:** The modal's `onSave` re-fetches `GET /api/web/alerts` before computing ops, preventing stale-group duplicates when retrying after partial failure.

**Coverage gap at full capacity:** When `availableSlots` is 0, no POSTs have occurred yet, so there are no "safe" deletes. The fallback deletes old alerts before replacements exist, creating a brief window where those alerts are missing. This is accepted — rejecting all edits at full capacity would be worse.

---

## Discord Webhook

Treated as a global setting. Auto-populate priority on modal open:
1. Webhook from existing alert group (from `GET /api/web/alerts` response)
2. `GM_getValue('discordWebhook')` — last used value
3. Empty — user enters manually

Save button is disabled until webhook is non-empty. On save, the webhook is persisted via `GM_setValue('discordWebhook')`.

---

## SPA Navigation (`Init`)

Universalis is a Next.js SPA. `Init` sets up a `MutationObserver` on `document.body` that tracks `window.location.pathname`. On every pathname change, it re-calls `HeaderButton.init()` (idempotent) to handle header re-renders.

The observer also fires `route()` once immediately on script load.

---

## Out of Scope

- Supporting multiple data centers (hardcoded to 陸行鳥)
- Per-world different rules for the same item
- Webhook URL format validation (non-empty string is sufficient)
