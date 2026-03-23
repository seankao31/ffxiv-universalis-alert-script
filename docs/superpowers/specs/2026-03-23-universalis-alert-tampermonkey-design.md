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
| `GET` | `/api/web/alerts` | Fetch all alerts |
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
  name: "木棉原木 price alert",
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

**Grouping rule:** alerts with identical `(itemId, name, trigger)` — differing only in `worldId` — belong to the same logical group. Trigger equality is determined by JSON stringification.

### 陸行鳥 DC World IDs

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

### Injection

- Hide the native "Alerts" button (second `.btn_addto_list` on the page)
- Inject a custom "🔔 Set Alerts" button next to it

### Modal UX

On button click:
1. Fetch all alerts via `GET /api/web/alerts`, filter to current `itemId`
2. Read item name from page DOM (already rendered in the user's configured language)
3. Open modal with fields:
   - **Alert name** — pre-filled with item name
   - **Discord webhook** — auto-populated (see Webhook section below)
   - **Trigger condition** — metric dropdown (Price Per Unit / Quantity / Total), comparator (< / >), value input
   - **HQ only** — checkbox
   - **Worlds** — one checkbox per 陸行鳥 world; pre-checked for worlds that already have an active alert for this item; active worlds highlighted in blue
   - **Select All / Clear** buttons

### Save Logic

For each world in 陸行鳥 DC:
- If **newly checked** and no existing alert → `POST` new alert
- If **unchecked** and had existing alert → `DELETE` that alert
- If **checked** and already has identical alert → skip (no-op)
- If **checked** and has an alert with different rule → `DELETE` old, `POST` new

---

## Alerts Page (`/account/alerts`)

### Injection

1. `MutationObserver` on `document.body` detects Next.js client-side navigation to `/account/alerts`
2. Once the native React list mounts, wait for render to stabilize (~200ms debounce with no further DOM mutations)
3. Walk the native DOM: collect `{ itemId → itemName }` from item anchor `href="/market/{itemId}"` elements (names are already rendered in the user's language — no extra API calls needed)
4. Hide native content, inject enhanced panel

### Enhanced Panel UX

Table layout, one row per logical alert group:

| Column | Content |
|---|---|
| Item | Item name + ID (scraped from native DOM) |
| Rule | Human-readable summary, e.g. "Min price < 130" with HQ badge if applicable |
| Worlds | Pill tags for each world covered |
| Actions | Edit button, Delete button |

- **Edit** — opens the same Modal as the market page, pre-populated with existing values. Save = delete all alerts in the group + create new ones for the selected worlds/rule.
- **Delete** — deletes all `alertId`s in the group in parallel, then removes the row.

---

## Discord Webhook

Treated as a global setting shared across all alerts.

**Auto-populate priority (on modal open):**
1. Webhook found in existing alerts for this item (from `GET /api/web/alerts` response)
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
- Edge case where an item alert is not visible in the rendered DOM before scraping
