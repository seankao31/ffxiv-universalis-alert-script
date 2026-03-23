# Universalis Alert Manager — TamperMonkey Script Design

**Date:** 2026-03-23
**Status:** Approved

## Problem

The native Universalis alert UI requires filling out a separate form for each world/server. There is no bulk creation, no editing (only delete + recreate), and the alerts list has poor information density. The target use case is: one alert rule applied uniformly to a chosen subset of worlds in a single data center.

---

## Approach

A TamperMonkey userscript that injects into two pages of universalis.app:

1. `/market/[itemId]` — replaces the native Alerts button/modal with a custom multi-world creation modal
2. `/account/alerts` — replaces the native alert list with a denser, grouped, editable panel

Auth is free: the script runs inside the user's logged-in browser session, so `fetch` calls carry cookies automatically.

---

## Architecture

Single `.user.js` file, organized into logical sections. No build step — plain JavaScript.

### TamperMonkey Header

Required `@grant` declarations:

```js
// @grant GM_getValue
// @grant GM_setValue
// @match  https://universalis.app/market/*
// @match  https://universalis.app/account/alerts
```

`GM_getValue`/`GM_setValue` are used for webhook persistence. Without the `@grant` declarations, these functions are undefined at runtime.

### Sections

| Section | Responsibility |
|---|---|
| `API` | Thin wrappers: `getAlerts()`, `createAlert(payload)`, `deleteAlert(id)` |
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

**Grouping rule:** alerts with identical `(itemId, trigger)` — differing only in `worldId` or `name` — belong to the same logical group. The `name` field is excluded from the equality key because it is a user-editable label; minor name differences (e.g., trailing spaces, manual edits) should not split a group. The group's `name` is taken from the first alert in the group. Trigger equality is determined by normalizing the trigger object to a canonical key order before JSON stringification.

**Canonical trigger key order:** `filters`, `mapper`, `reducer`, `comparison`.

**Multiple distinct rules for the same item** (e.g., price < 130 and price < 200) are supported — they produce separate groups and appear as separate rows on the alerts page.

### 陸行鳥 DC World IDs

IDs sourced from `GET https://universalis.app/api/v3/game/data-centers`. Verify against this endpoint before shipping; Square Enix can reassign IDs during data center reorganizations.

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

The market page is React-rendered. The script waits for the item name heading (an `h1` or equivalent prominent heading containing the item name) to appear in the DOM before attempting to locate the native button or read the item name. A `MutationObserver` on `document.body` triggers this check.

### Injection

- Locate the native "Alerts" button by matching button text content containing `"Alerts"`. This text is always English regardless of the user's locale setting (Universalis uses English for UI chrome elements even when item names are localized).
- Fallback selector if text matching fails: the button immediately following the "Add to list" button in the action bar.
- Hide the native button; inject a custom "🔔 Set Alerts" button in its place.

### Modal UX

On button click:
1. Fetch fresh alert state via `GET /api/web/alerts`, filter to current `itemId`
2. Read item name from page DOM (already rendered in the user's configured language)
3. Open modal with fields:
   - **Alert name** — pre-filled with item name
   - **Discord webhook** — auto-populated (see Webhook section below)
   - **Trigger condition** — metric dropdown (Price Per Unit / Quantity / Total), comparator (< / >), value input
   - **HQ only** — checkbox
   - **Worlds** — one checkbox per 陸行鳥 world; pre-checked for worlds that already have an active alert for this item; active worlds highlighted in blue
   - **Select All / Clear** buttons

### Save Logic

To prevent data loss on partial failure: all `POST` requests are issued first. `DELETE` requests are only sent after **all** `POST` requests succeed. If any `POST` fails, no deletions are performed and an error message is shown listing the affected worlds. The user can retry; any duplicate alerts created in a failure scenario are cleaned up on the next successful save.

For each world in 陸行鳥 DC:
- If **newly checked** and no existing alert → `POST` new alert
- If **unchecked** and had existing alert → `DELETE` that alert (only after all POSTs succeed)
- If **checked** and already has identical alert → skip (no-op)
- If **checked** and has an alert with different rule → `POST` new alert; if all POSTs succeed, `DELETE` old alert

---

## Alerts Page (`/account/alerts`)

### Injection Readiness

1. `MutationObserver` on `document.body` detects Next.js client-side navigation to `/account/alerts`
2. Wait for at least one `a[href^="/market/"]` anchor to appear in the DOM — this is the deterministic signal that the native React list has rendered item data
3. Walk the native DOM: collect `{ itemId → itemName }` — item ID from the `href` path, item name from the anchor's text content (already rendered in the user's language — no extra API calls needed)
4. If scraping yields zero anchors (user has no alerts), skip injection and leave the native page intact
5. Hide native content, inject enhanced panel

**Item name fallback:** any alert whose `itemId` was not found during DOM scraping is displayed as `"Item #44015"` in the panel.

### Enhanced Panel UX

Table layout, one row per logical alert group:

| Column | Content |
|---|---|
| Item | Item name + ID (scraped from native DOM; `"Item #XXXXX"` if not found) |
| Rule | Human-readable summary, e.g. "Min price < 130" with HQ badge if applicable |
| Worlds | Pill tags for each world covered |
| Actions | Edit button, Delete button |

- **Edit** — re-fetches `GET /api/web/alerts` on open to get fresh state (avoids stale in-memory edits). Opens the same Modal pre-populated with the group's current values. Uses the same POST-first, DELETE-after save logic as the market page modal.
- **Delete** — deletes all `alertId`s in the group in parallel, then removes the row.

---

## Discord Webhook

Treated as a global setting shared across all alerts. The `GET /api/web/alerts` response includes `discordWebhook` per alert object.

**Auto-populate priority (on modal open):**
1. Webhook found in existing alerts for this item (read from `GET /api/web/alerts` response field `discordWebhook`)
2. `GM_getValue('discordWebhook')` — last used value, persisted by TamperMonkey
3. Empty — user enters manually

**On save:** always write the current webhook value to `GM_setValue('discordWebhook')`.

---

## Page Navigation Detection

Universalis is a Next.js SPA — navigating between pages does not reload the document. The script uses a `MutationObserver` on `document.body` combined with `window.location` checks to detect route changes and re-run the appropriate injection logic.

---

## Out of Scope

- Supporting multiple data centers (hardcoded to 陸行鳥)
- Per-world different rules for the same item
- Pagination or lazy-loaded alert lists (assumed all alerts fit in a single render)
