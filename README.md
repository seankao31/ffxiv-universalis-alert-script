# Universalis Alert Manager

A TamperMonkey userscript for bulk-managing market alerts on [universalis.app](https://universalis.app/). Create, edit, and delete alerts across multiple worlds in a single operation instead of one-at-a-time through the native UI.

Currently hardcoded to the **陸行鳥 (繁中服)** data center.

## Installation

1. Install [TamperMonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/) in your browser
2. **Chrome users:** enable Developer Mode in `chrome://extensions` and enable user scripts in TamperMonkey ([details](https://www.tampermonkey.net/faq.php?q=Q209))
3. **[Click here to install](https://raw.githubusercontent.com/seankao31/ffxiv-universalis-alert-script/release/universalis-alert.user.js)** — your script manager will prompt you to confirm
4. Navigate to any page on universalis.app — the **Bulk Alerts** button appears in the header

The script auto-updates when a new version is released.

## Features

- **Bulk Alerts button** — persistent header button on every page opens a modal to create, edit, and delete alerts for all 8 worlds at once
- **Grouped alert view** — alerts are grouped by item and rule, with world pills showing which worlds are covered
- **Alert capacity tracking** — displays used/available alert slots and validates capacity before saving
- **Partial failure recovery** — save and delete operations show per-world progress, surface skipped worlds, name failures, and support retry
- **Interleaved batching** — POST/DELETE operations are batched to stay within capacity while minimising intermediate states
- **Rate limiting** — requests are serialised with 200 ms spacing and automatic 429 retry with backoff

## Project Structure

```
src/
  header.js        TamperMonkey metadata block
  worldmap.js      World ID/name mapping (陸行鳥 DC)
  grouping.js      Groups flat alerts into logical alert groups
  rate-limit.js    Sequential request queue with 429 retry
  api.js           GET/POST/DELETE wrappers for /api/web/alerts
  save-ops.js      Computes and executes save operations (interleaved batching)
  modal.js         Alert modal — list view, form view, capacity display
  header-button.js Injects Bulk Alerts button into site header, manages modal lifecycle
  init.js          Entry point — initialises header button and navigation observer
tests/             Jest tests (jsdom environment)
build.js           Concatenates src/ into the userscript
```

`bun run build.js` concatenates the source files in dependency order into `universalis-alert.user.js`.

## Development

### Prerequisites

- [Bun](https://bun.sh/) (for tests and build)

### Setup

```bash
bun install
```

### Tests

```bash
bunx jest              # run all tests
bunx jest --watch      # re-run on file changes
bunx jest --no-coverage tests/save-ops.test.js  # run a single suite
```

### Build

```bash
bun run build.js
```

This produces `universalis-alert.user.js` in the project root.

### Local development with TamperMonkey

TamperMonkey can load a userscript directly from your filesystem, so you don't need to copy-paste the built file after every change:

1. In TamperMonkey, go to **Settings > General > Config mode** and set it to **Advanced**
2. Under **Settings > Security**, enable **Allow scripts to access local files via @require** (may vary by browser)
3. Create a new userscript with just the metadata header and a `@require` pointing to your local build:

```js
// ==UserScript==
// @name         Universalis Alert Manager (Dev)
// @namespace    https://universalis.app/
// @version      dev
// @match        https://universalis.app/*
// @grant        GM_getValue
// @grant        GM_setValue
// @require      https://storage.ko-fi.com/cdn/widget/Widget_2.js
// @require      file:///path/to/your/project/universalis-alert.user.js
// ==/UserScript==
```

4. After running `bun run build.js`, refresh the page to pick up changes — no need to touch TamperMonkey

> **Note:** The `file://` `@require` path must be an absolute path. On macOS this looks like `file:///Users/you/project/universalis-alert.user.js`. On Windows: `file:///C:/Users/you/project/universalis-alert.user.js`.
