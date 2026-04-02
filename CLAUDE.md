# CLAUDE.md

## Project Overview

TamperMonkey userscript for bulk-managing market alerts on universalis.app, targeting the 陸行鳥 (Chocobo) data center. Source is split into modules under `src/`, concatenated into a single `.user.js` by `bun run build.js`.

## Commands

```bash
bunx jest --no-coverage          # run all tests
bunx jest --no-coverage tests/save-ops.test.js  # run one suite
bun run build.js                 # build ffxiv-universalis-alert.user.js
```

## Architecture

### Module Pattern

Every `src/*.js` file uses the same IIFE + CommonJS dual-export pattern:

```js
const ModuleName = (() => {
  // ... module body
  return { publicFn1, publicFn2 };
})();
if (typeof module !== 'undefined') module.exports = ModuleName;
```

- In TamperMonkey: modules are globals, available by name after concatenation
- In tests: modules are `require()`'d via CommonJS

**Do not change this pattern.** It enables the same code to run in both contexts without a bundler.

### Dependency Resolution

Modules reference dependencies in two ways:

1. **Direct** (for modules with no circular risk): `const _Dep = typeof Dep !== 'undefined' ? Dep : require('./dep');`
2. **Lazy function** (for page modules that cross-reference many deps): `function _API() { return typeof API !== 'undefined' ? API : _apiModule; }`

Modal and HeaderButton use the lazy pattern. Other modules use direct resolution.

### Source Order

`build.js` concatenates files in dependency order — globals must exist before modules that reference them. The order is defined in `build.js:SRC_ORDER`. When adding a new module, place it after its dependencies in this array.

### Test Setup

- **Environment:** Jest + jsdom (configured in `jest.config.js`)
- **Global stubs:** `tests/setup.js` provides `GM_getValue`, `GM_setValue`, and `fetch` as Jest mocks
- **Test-specific globals:** some test files set `global.API`, `global.Modal`, etc. to mock objects for modules that use the lazy accessor pattern

## Conventions

- Vanilla JS (ES6), no TypeScript, no bundler, no linter
- 2-space indentation, semicolons
- No production dependencies — only Jest as dev dependency
- Tests use real module imports where possible (e.g., `global.Grouping = require('../src/grouping')`) and mock only external boundaries (API calls, fetch)
- `Promise.allSettled` for concurrent operations that can partially fail; index-correlated mapping to trace failures back to inputs
