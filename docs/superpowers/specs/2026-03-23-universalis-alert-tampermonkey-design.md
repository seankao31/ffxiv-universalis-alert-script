# Universalis Alert Manager — TamperMonkey Script Design

**Date:** 2026-03-23
**Status:** Approved

## Problem

The native Universalis alert UI requires filling out a separate form for each world/server. There is no bulk creation, no editing (only delete + recreate), and the alerts list has poor information density. The target use case is: one alert rule applied uniformly to a chosen subset of worlds in a single data center.

---

## Approach

A TamperMonkey userscript that injects into two pages of universalis.app:

1. `/market/[itemId]` — appends a custom "Set Alerts" button to the native button bar, opening a multi-world creation modal
2. `/account/alerts` — replaces the native alert list with a denser, grouped, editable panel

Auth is free: the script runs inside the user's logged-in browser session, so `fetch` calls carry cookies automatically.

---

## Architecture

Source is split into logical modules under `src/`, concatenated into a single `.user.js` by `node build.js`.

### TamperMonkey Header

Required `@grant` and `@match` declarations:

```js
// @match  https://universalis.app/market/*
// @match  https://universalis.app/account/alerts
// @grant  GM_getValue
// @grant  GM_setValue
```

`GM_getValue`/`GM_setValue` are used for webhook persistence. Without the `@grant` declarations, these functions are undefined at runtime.

The `@match` pattern `https://universalis.app/market/*` matches any path under `/market/`, including potential sub-paths. A runtime guard at injection time checks that `location.pathname.split('/').length === 3` (i.e., exactly `/market/{id}`) and returns early otherwise.

### Sections

| Section | Responsibility |
|---|---|
| `RateLimit` | Sequential request queue with 429 retry and exponential backoff |
| `API` | Thin wrappers: `getAlerts()`, `createAlert(payload)`, `deleteAlert(id)` — all calls go through `RateLimit` |
| `WorldMap` | World ID ↔ name mapping, hardcoded to 陸行鳥 DC (IDs 4028–4035) |
| `Grouping` | Groups flat API alert array into logical alert groups |
| `Modal` | Shared create/edit modal component, used by both pages |
| `MarketPage` | Injection logic for `/market/*` pages |
| `AlertsPage` | Injection logic for `/account/alerts` |

### API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/web/alerts` | Fetch all alerts (response includes `discordWebhook` per alert) |
| `POST` | `/api/web/alerts` | Create one alert |
| `DELETE` | `/api/web/alerts/{alertId}` | Delete one alert |

No `PATCH`/`PUT` exists. Edit = delete affected alerts + create new ones.

**Error handling:** if `GET /api/web/alerts` fails (network error, 4xx, 5xx), the modal displays an inline error ("Failed to load existing alerts — check your connection") and the Save button is disabled. On the alerts page, a full-width error message is shown in place of the panel.

### Rate Limiting

All `fetch` calls in the `API` module go through `RateLimit.rateLimitedFetch()`, a drop-in `fetch` replacement that provides two protections:

1. **Sequential queue** — requests are serialised through a promise chain so that only one HTTP request is in flight at a time, with a 200 ms minimum delay between requests. Callers that fire many promises concurrently (e.g. `Promise.allSettled` in `executeSaveOps`) are transparently throttled without any changes to call-site code.

2. **429 retry with backoff** — if the server returns HTTP 429 (Too Many Requests), the request is retried up to 3 times. The wait before each retry is taken from the `Retry-After` response header (interpreted as seconds) when present, otherwise exponential backoff is used (1 s → 2 s → 4 s). After all retries are exhausted, the 429 response is returned to the caller, which surfaces it through the normal `!res.ok` error path.

| Parameter | Value |
|---|---|
| Inter-request delay | 200 ms |
| Max retries on 429 | 3 |
| Backoff (no Retry-After header) | 1000 × 2^attempt ms |

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

---

## Data Model

Individual API alerts are grouped into **logical alert groups**:

```js
{
  itemId: 44015,
  itemName: "木棉原木",         // scraped from DOM, language-aware
  name: "木棉原木 price alert", // taken from the first alert in the group
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

**Grouping rule:** alerts with identical `(itemId, trigger)` — differing only in `worldId` or `name` — belong to the same logical group. Both `itemId` and the normalized trigger are part of the equality key; `name` is excluded because it is a user-editable label and minor differences should not split a group. The group's `name` is taken from the first alert in the group. Trigger equality is determined by normalizing the trigger object to a canonical key order before JSON stringification.

**Canonical trigger key order:** `filters`, `mapper`, `reducer`, `comparison`. Any alert with trigger keys outside this set is treated as ungroupable and displayed as a standalone single-world group rather than merged or dropped.

**The canonical trigger normalization is the single source of truth for grouping.** The save logic uses a broader "alert needs update" check that also includes `name`: if only the name changed (trigger unchanged, world already covered), the alert is still re-POSTed and the old one deleted so the new name is applied.

**`discordWebhook` is not part of the grouping key.** If alerts in the same group were created with different webhooks (e.g., via the native UI), they will be merged into one group and saved with the single webhook from the modal. This is expected behavior and acceptable for the single-user use case.

**Multiple distinct rules for the same item** (e.g., price < 130 and price < 200) produce separate groups and appear as separate rows on the alerts page.

### 陸行鳥 DC World IDs

IDs sourced from `GET https://universalis.app/api/v3/game/data-centers`. **Pre-ship checklist item:** verify these IDs against the live endpoint before first release; Square Enix can reassign IDs during data center reorganizations.

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

## Market Page (`/market/[itemId]`)

### Injection Readiness

The market page is React-rendered. The script waits for the button bar (`div.box_flex.form`) to appear in the DOM before injecting. A `MutationObserver` on `document.body` triggers this check. This container is the reliable readiness signal because it is the exact element the button is appended to, ensuring it exists on both full reload and SPA back-navigation.

### Injection

- Locate the button bar container via `document.querySelector('.box_flex.form')`. This `<div>` holds the external tool links (Saddlebag Exchange, GarlandTools, Teamcraft) and the native action buttons (清單, 收藏, 提醒).
- Append a custom "🔔 Set Alerts" button to the end of this container. The native buttons are left untouched (not hidden or replaced).

### Modal UX

On button click:
1. Fetch fresh alert state via `GET /api/web/alerts`, filter to current `itemId`
2. Group existing alerts for this item into logical groups
3. Read item name from page DOM
4. Open modal pre-populated from the **first** logical group found for this item (most common case: zero or one group). If multiple groups exist for this item, the market page modal shows the first group's rule and worlds pre-populated, and a notice is shown: "Multiple alert rules exist for this item. Editing here will only affect this rule. Use the Alerts page to manage all rules." The alerts page is the correct place to manage multiple groups per item.
5. Modal fields:
   - **Alert name** — pre-filled with existing group name, or item name if no group exists
   - **Discord webhook** — auto-populated (see Webhook section below); Save is disabled until a non-empty webhook is provided
   - **Trigger condition** — metric dropdown (Price Per Unit / Quantity / Total), comparator (< / >), value input
   - **HQ only** — checkbox
   - **Worlds** — one checkbox per 陸行鳥 world; pre-checked for worlds in the pre-populated group; active worlds highlighted in blue
   - **Select All / Clear** buttons

### Save Logic

To prevent data loss on partial failure: all `POST` requests are issued first. `DELETE` requests are only sent after **all** `POST` requests succeed. If any `POST` fails, no deletions are performed and an error message is shown listing the affected worlds. Any duplicate alerts created in a failure scenario are cleaned up on the next successful save.

The save operates only on the pre-populated group (identified by its normalized trigger). Alerts belonging to other groups for the same item are left untouched.

For each world in 陸行鳥 DC:
- If **newly checked** and no existing alert in this group → `POST` new alert
- If **unchecked** and had an existing alert in this group → `DELETE` that alert (only after all POSTs succeed)
- If **checked** and already has an identical alert in this group → skip (no-op)
- If **checked** and has an alert in this group with a different rule → `POST` new alert; if all POSTs succeed, `DELETE` old alert

---

## Alerts Page (`/account/alerts`)

### Injection Readiness

1. `MutationObserver` on `document.body` detects Next.js client-side navigation to `/account/alerts`
2. If the custom panel element (`id="univ-alert-panel"`) already exists in the DOM (user re-navigated to this page), remove it and re-run injection from scratch to ensure fresh data.
3. Wait for at least one `a[href^="/market/"]` anchor to appear in the DOM — the deterministic signal that the native React list has rendered item data. Native content is **not** hidden at this point.
4. If no such anchor appears within 10 seconds, disconnect the observer and leave the native page intact (user has no alerts).
5. Walk the native DOM: collect `{ itemId → itemName }` — item ID from the `href` path, item name from the anchor's text content (already rendered in the user's language — no extra API calls needed).
6. Hide native content, inject enhanced panel.

**Item name fallback:** any alert whose `itemId` was not found during DOM scraping is displayed as `"Item #44015"` in the panel.

### Enhanced Panel UX

Table layout, one row per logical alert group:

| Column | Content |
|---|---|
| Item | Item name + ID (scraped from native DOM; `"Item #XXXXX"` if not found) |
| Rule | Human-readable summary, e.g. "Min price < 130" with HQ badge if applicable |
| Worlds | Pill tags for each world covered |
| Actions | Edit button, Delete button |

- **Edit** — re-fetches `GET /api/web/alerts` on open to get fresh state. Opens the same Modal pre-populated with the group's current values. On save, if the trigger has changed, all `alertId`s in the original group are treated as "old" and are deleted after all POSTs for the new configuration succeed. Uses the same POST-first, DELETE-after logic as the market page.
- **Delete** — deletes all `alertId`s in the group in parallel, then removes the row.

---

## Discord Webhook

Treated as a global setting shared across all alerts. The `GET /api/web/alerts` response includes `discordWebhook` per alert object.

**Auto-populate priority (on modal open):**
1. Webhook found in existing alerts for this item (read from `GET /api/web/alerts` response field `discordWebhook`)
2. `GM_getValue('discordWebhook')` — last used value, persisted by TamperMonkey
3. Empty — user enters manually

**Validation:** the Save button is disabled until the webhook field contains a non-empty value. URL format validation is out of scope — a non-empty string is sufficient.

**On save:** always write the current webhook value to `GM_setValue('discordWebhook')`.

---

## Page Navigation Detection

Universalis is a Next.js SPA — navigating between pages does not reload the document. The script uses a `MutationObserver` on `document.body` combined with `window.location` checks to detect route changes and re-run the appropriate injection logic.

---

## Out of Scope

- Supporting multiple data centers (hardcoded to 陸行鳥)
- Per-world different rules for the same item
- Pagination or lazy-loaded alert lists (assumed all alerts fit in a single render)
