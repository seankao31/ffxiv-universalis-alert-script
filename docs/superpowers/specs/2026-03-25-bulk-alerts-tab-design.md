# Bulk Alerts Tab — Design Spec

## Summary

Add a "Bulk Alerts" tab to the universalis.app account page navigation (alongside account, characters, lists, alerts) instead of replacing the existing alerts page. The tab navigates to `/account/bulk-alerts` and renders the alerts manager panel inside the existing page layout.

## Current Behavior

- `AlertsPage.init()` runs on `/account/alerts`, hides all native body content, and prepends a custom alerts panel
- Item names are scraped from native `<a href="/market/{id}">` links already in the DOM
- `Init.route()` maps `/account/alerts` → `AlertsPage.init()`
- Header `@match` targets `https://universalis.app/account/alerts`

## Assumed DOM Structure

The universalis.app account page renders:
```
<main>
  <div><!-- nav button list: account, characters, lists, alerts --></div>
  <div><!-- content area for the active tab --></div>
</main>
```

`/account/bulk-alerts` is a synthetic route — universalis.app will render the account page shell (with `<main>` and the nav div) since it matches `/account/*`. The content div may show a fallback or empty state from the site's own router, which we replace entirely.

## New Behavior

### Tab Injection — `AlertsPage.injectTab()`

- New exported function, runs on **any `/account/*`** page
- Finds `<main>` → first child div (the nav button list)
- Appends a "Bulk Alerts" button styled to match existing tabs
- Clicking it:
  1. Calls `history.pushState({}, '', '/account/bulk-alerts')` to update the URL
  2. Directly calls `AlertsPage.init()` to render content (pushState alone does not trigger the MutationObserver, so we call init explicitly)
- Idempotent — no-ops if button already injected
- Needs MutationObserver wait for `<main>` on SPA navigation (same pattern as existing init functions)
- Does NOT manage active/inactive tab styling on native tabs (out of scope — we just add our button)

**Concurrency note:** `injectTab()` and `init()` are independent — they both wait for `<main>` but have no ordering dependency. The tab button does not need to exist before content renders. On `/account/bulk-alerts` page load, both run concurrently from `Init.route()` without conflict.

### Content Rendering — `AlertsPage.init()`

- Only runs on `/account/bulk-alerts`
- Finds `<main>` → second child div (the content area)
- Replaces that div's `innerHTML` with the alerts panel
- `renderAlertsPanel(alerts, nameMap, container)` updated to accept a **container parameter**. It clears `container.innerHTML` and appends the panel inside it. This allows init, edit-onSave callbacks, and delete-refresh to all target the same container.
- `handleInitError(container)` similarly updated to render error message into the container instead of `document.body.prepend`.
- No longer hides native body content
- Uses `fetchItemNames()` instead of `scrapeItemNames()` for name resolution
- MutationObserver wait condition: waits for `<main>` with at least 2 child divs

### Item Name Resolution — `fetchItemNames()`

- New function in AlertsPage
- Fetches `/account/alerts` HTML via same-origin `fetch()`
- Parses response with `DOMParser().parseFromString(html, 'text/html')`
- Extracts `<a href="/market/{id}">Name</a>` links → returns `Map<number, string>`
- Same shape as existing `scrapeItemNames()` but works from fetched HTML rather than live DOM
- **Error handling:** if fetch fails, returns empty Map (items display as "Item #12345" fallback — same as existing behavior for unknown items)
- **Empty alerts:** if user has no alerts, returns empty Map — same fallback applies
- `scrapeItemNames()` retained but no longer called by `init()` or onSave callbacks
- **onSave name resolution:** the `nameMap` from the initial `fetchItemNames()` call is closed over and reused for re-renders after save. Item names don't change mid-session, so no re-fetch needed.

### Routing — `Init.route()`

Updated rules:
- `/account/*` (any account page) → `AlertsPage.injectTab()`
- `/account/bulk-alerts` specifically → also `AlertsPage.init()`
- `/market/{id}` → `MarketPage.init()` (unchanged)
- Old `/account/alerts` → `AlertsPage.init()` mapping **removed** (intentional: native alerts page stays untouched, only the tab button is injected)

### Header

- Change `@match https://universalis.app/account/alerts` → `@match https://universalis.app/account/*`

## Files Changed

| File | Change |
|------|--------|
| `src/header.js` | Update `@match` from `/account/alerts` to `/account/*` |
| `src/init.js` | Add `/account/*` → `injectTab()` route, change `/account/bulk-alerts` → `init()` |
| `src/alerts-page.js` | Add `injectTab()`, add `fetchItemNames()`, rework `init()` and `renderAlertsPanel` to accept container param |
| `tests/alerts-page.test.js` | Update tests for new rendering target, add tests for `injectTab()` and `fetchItemNames()` |
| `tests/init.test.js` | Update routing tests |

No `build.js` changes needed (AlertsPage already in SRC_ORDER). Rebuild required after changes.

## Testing Strategy

### `injectTab()`
- Button injected into first div of `<main>`
- Idempotent (second call doesn't duplicate)
- MutationObserver waits when `<main>` not yet in DOM
- Click triggers pushState + init

### `fetchItemNames()`
- Mock `fetch` to return HTML with market links → verify Map output
- Fetch failure → returns empty Map (no throw)
- No market links in HTML → returns empty Map

### `init()`
- Content rendered into second div of `<main>` (not body prepend)
- Error handling when `fetchItemNames()` returns empty Map
- MutationObserver wait when `<main>` not yet rendered

### `renderAlertsPanel`
- Accepts container parameter, renders into it
- Edit-onSave re-renders into same container
- Delete removes row, retry on partial failure (existing behavior preserved)

### Routing
- `/account/characters` → calls `injectTab()` only
- `/account/bulk-alerts` → calls both `injectTab()` and `init()`
- `/account/alerts` → calls `injectTab()` only (no longer triggers `init()`)
