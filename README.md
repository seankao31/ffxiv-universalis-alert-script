# Universalis Alert Manager

A TamperMonkey userscript for bulk-managing market alerts on [universalis.app](https://universalis.app/). Create, edit, and delete alerts across multiple worlds in a single operation instead of one-at-a-time through the native UI.

Currently hardcoded to the **陸行鳥 (Chocobo)** data center.

## Features

- **Market page** (`/market/{itemId}`) — "Set Alerts" button opens a modal to create or edit alerts for all 8 worlds at once
- **Alerts page** (`/account/alerts`) — replaces the native list with a grouped view showing item, rule, worlds, and edit/delete actions
- **Partial failure recovery** — save and delete operations show per-world progress, name failed worlds in error messages, and support retry
- **Rate limiting** — requests are serialised with 200 ms spacing and automatic 429 retry with backoff

## Installation

1. Install [TamperMonkey](https://www.tampermonkey.net/) in your browser
2. Create a new userscript and paste the contents of `universalis-alert.user.js`
3. Navigate to any market page or the alerts page on universalis.app

## Project Structure

```
src/
  header.js        TamperMonkey metadata block
  worldmap.js      World ID/name mapping (陸行鳥 DC)
  grouping.js      Groups flat alerts into logical alert groups
  rate-limit.js    Sequential request queue with 429 retry
  api.js           GET/POST/DELETE wrappers for /api/web/alerts
  save-ops.js      Computes and executes save operations (POST-first safety)
  modal.js         Shared create/edit modal component
  market-page.js   Injection for /market/* pages
  alerts-page.js   Injection for /account/alerts
  init.js          Entry point — detects current page and initialises
tests/             Jest tests (jsdom environment)
build.js           Concatenates src/ into the userscript
```

`node build.js` concatenates the source files in dependency order into `universalis-alert.user.js`.

## Development

### Prerequisites

- Node.js (for tests and build)
- npm or bun

### Setup

```bash
npm install
```

### Tests

```bash
npx jest              # run all tests
npx jest --watch      # re-run on file changes
npx jest --no-coverage tests/save-ops.test.js  # run a single suite
```

### Build

```bash
node build.js
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
// @match        https://universalis.app/market/*
// @match        https://universalis.app/account/alerts
// @grant        GM_getValue
// @grant        GM_setValue
// @require      file:///path/to/your/project/universalis-alert.user.js
// ==/UserScript==
```

4. After running `node build.js`, refresh the page to pick up changes — no need to touch TamperMonkey

> **Note:** The `file://` `@require` path must be an absolute path. On macOS this looks like `file:///Users/you/project/universalis-alert.user.js`. On Windows: `file:///C:/Users/you/project/universalis-alert.user.js`.
