# Bulk Alerts Tab — Design Spec

## Summary

Add a "Bulk Alerts" tab to the universalis.app account page navigation (alongside account, characters, lists, alerts) instead of replacing the existing alerts page. The tab navigates to `/account/bulk-alerts` and renders the alerts manager panel inside the existing page layout.

## Current Behavior

- `AlertsPage.init()` runs on `/account/alerts`, hides all native body content, and prepends a custom alerts panel
- Item names are scraped from native `<a href="/market/{id}">` links already in the DOM
- `Init.route()` maps `/account/alerts` → `AlertsPage.init()`
- Header `@match` targets `https://universalis.app/account/alerts`

## New Behavior

### Tab Injection — `AlertsPage.injectTab()`

- New exported function, runs on **any `/account/*`** page
- Finds `<main>` → first child div (the nav button list)
- Appends a "Bulk Alerts" button styled to match existing tabs
- Clicking it calls `history.pushState({}, '', '/account/bulk-alerts')` and triggers content rendering
- Idempotent — no-ops if button already injected
- Needs MutationObserver wait for `<main>` on SPA navigation (same pattern as existing init functions)

### Content Rendering — `AlertsPage.init()`

- Only runs on `/account/bulk-alerts`
- Finds `<main>` → second child div (the content area)
- Replaces that div's `innerHTML` with the alerts panel (reuses existing `renderAlertsPanel`)
- No longer hides native body content or prepends to `document.body`
- Uses `fetchItemNames()` instead of `scrapeItemNames()` for name resolution

### Item Name Resolution — `fetchItemNames()`

- New function in AlertsPage
- Fetches `/account/alerts` HTML via same-origin `fetch()`
- Parses response with `DOMParser().parseFromString(html, 'text/html')`
- Extracts `<a href="/market/{id}">Name</a>` links → returns `Map<number, string>`
- Same shape as existing `scrapeItemNames()` but works from fetched HTML rather than live DOM
- `scrapeItemNames()` retained for potential reuse but no longer called by `init()`

### Routing — `Init.route()`

Updated rules:
- `/account/*` (any account page) → `AlertsPage.injectTab()`
- `/account/bulk-alerts` specifically → also `AlertsPage.init()`
- `/market/{id}` → `MarketPage.init()` (unchanged)
- Old `/account/alerts` → `AlertsPage.init()` mapping removed

### Header

- Change `@match https://universalis.app/account/alerts` → `@match https://universalis.app/account/*`

## Files Changed

| File | Change |
|------|--------|
| `src/header.js` | Update `@match` from `/account/alerts` to `/account/*` |
| `src/init.js` | Add `/account/*` → `injectTab()` route, change `/account/bulk-alerts` → `init()` |
| `src/alerts-page.js` | Add `injectTab()`, add `fetchItemNames()`, rework `init()` to render into `<main>` second div |
| `tests/alerts-page.test.js` | Update tests for new rendering target, add tests for `injectTab()` and `fetchItemNames()` |
| `tests/init.test.js` | Update routing tests |

## Testing Strategy

- `injectTab()`: verify button injected into first div of `<main>`, verify idempotent
- `fetchItemNames()`: mock `fetch` to return HTML with market links, verify Map output
- `init()`: verify content rendered into second div of `<main>` (not body prepend)
- Routing: verify `/account/characters` calls `injectTab()` only, `/account/bulk-alerts` calls both
