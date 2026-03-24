# Universalis Alert Manager — TamperMonkey Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single TamperMonkey `.user.js` that adds a multi-world alert creation modal on `/market/[itemId]` (appended to the native button bar) and a dense grouped management panel on `/account/alerts`.

**Architecture:** Plain ES6 JavaScript organized as IIFE modules that expose a conditional `module.exports` for Jest testability. A Node.js build script concatenates source files in dependency order into the final `universalis-alert.user.js`. No transpiler, no bundler — the output is drop-in installable.

**Tech Stack:** Vanilla JS (ES6), TamperMonkey APIs (`GM_getValue`/`GM_setValue`), Jest + jsdom for tests, Node.js build script.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/header.js` | TamperMonkey `==UserScript==` metadata block (comment only, no code) |
| `src/worldmap.js` | `WORLDS` constant (陸行鳥 DC world list), `worldById(id)` lookup |
| `src/grouping.js` | `normalizeTrigger(trigger)`, `groupAlerts(alerts)` — pure functions |
| `src/rate-limit.js` | `rateLimitedFetch(url, options)` — sequential queue with 429 retry and exponential backoff |
| `src/api.js` | `getAlerts()`, `createAlert(payload)`, `deleteAlert(id)` — thin wrappers using `RateLimit.rateLimitedFetch` |
| `src/save-ops.js` | `computeSaveOps(group, formState, worlds)` (pure), `executeSaveOps(ops, itemId, formState)` (async, calls API) |
| `src/modal.js` | `openModal(options)`, `closeModal()` — shared create/edit modal, DOM construction + events |
| `src/market-page.js` | `initMarketPage()` — MutationObserver, native button replacement, modal integration |
| `src/alerts-page.js` | `initAlertsPage()` — MutationObserver, DOM scraping, panel render, edit/delete |
| `src/init.js` | `main()` — SPA navigation observer, routes to `MarketPage.init()` or `AlertsPage.init()` |
| `tests/grouping.test.js` | Tests for `normalizeTrigger` and `groupAlerts` |
| `tests/rate-limit.test.js` | Tests for sequential queue, 429 retry, Retry-After parsing, max retries, queue resilience |
| `tests/api.test.js` | Tests for `getAlerts`, `createAlert`, `deleteAlert` with mocked `fetch` |
| `tests/save-ops.test.js` | Tests for `computeSaveOps` (all four world-state cases) and `executeSaveOps` (POST-first ordering, partial failure) |
| `tests/modal.test.js` | Tests for modal DOM structure, webhook auto-populate priority, Save button disabled state |
| `tests/market-page.test.js` | Tests for button injection, multi-group notice, modal pre-population |
| `tests/alerts-page.test.js` | Tests for panel render, item name fallback, stale panel removal |
| `build.js` | Concatenates src files in dependency order → `universalis-alert.user.js` |
| `package.json` | Jest config, dev dependencies |
| `jest.config.js` | `testEnvironment: 'jsdom'`, global GM mocks |
| `universalis-alert.user.js` | Build output (committed for easy installation) |

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `jest.config.js`
- Create: `.gitignore` (update existing)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "universalis-alert",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "build": "node build.js"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "jest-environment-jsdom": "^29.0.0"
  }
}
```

- [ ] **Step 2: Create `jest.config.js`**

```js
module.exports = {
  testEnvironment: 'jsdom',
  setupFiles: ['./tests/setup.js'],
};
```

- [ ] **Step 3: Create `tests/setup.js`** (global GM API stubs, available to all tests)

```js
// Stub TamperMonkey globals so tests don't throw on import
global.GM_getValue = jest.fn(() => undefined);
global.GM_setValue = jest.fn();
```

- [ ] **Step 4: Append to `.gitignore`**

```
node_modules/
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors

- [ ] **Step 6: Verify Jest runs**

Run: `npx jest --listTests`
Expected: no output (no test files yet), exit 0

- [ ] **Step 7: Commit**

```bash
git add package.json jest.config.js tests/setup.js .gitignore
git commit -m "chore: add jest test infrastructure"
```

---

## Task 2: WorldMap Module

**Files:**
- Create: `src/worldmap.js`
- Create: `tests/worldmap.test.js`

`WorldMap` is pure data — tests verify the lookup works correctly and the world list is complete.

- [ ] **Step 1: Write the failing test**

```js
// tests/worldmap.test.js
const WorldMap = require('../src/worldmap');

describe('WorldMap', () => {
  test('WORLDS contains exactly 8 worlds', () => {
    expect(WorldMap.WORLDS).toHaveLength(8);
  });

  test('worldById returns correct name for known ID', () => {
    expect(WorldMap.worldById(4030)).toEqual({ worldId: 4030, worldName: '利維坦' });
  });

  test('worldById returns null for unknown ID', () => {
    expect(WorldMap.worldById(9999)).toBeNull();
  });

  test('all world IDs are in range 4028–4035', () => {
    WorldMap.WORLDS.forEach(w => {
      expect(w.worldId).toBeGreaterThanOrEqual(4028);
      expect(w.worldId).toBeLessThanOrEqual(4035);
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `npx jest tests/worldmap.test.js`
Expected: FAIL — `Cannot find module '../src/worldmap'`

- [ ] **Step 3: Implement `src/worldmap.js`**

```js
const WorldMap = (() => {
  const WORLDS = [
    { worldId: 4028, worldName: '伊弗利特' },
    { worldId: 4029, worldName: '迦樓羅' },
    { worldId: 4030, worldName: '利維坦' },
    { worldId: 4031, worldName: '鳳凰' },
    { worldId: 4032, worldName: '奧汀' },
    { worldId: 4033, worldName: '巴哈姆特' },
    { worldId: 4034, worldName: '拉姆' },
    { worldId: 4035, worldName: '泰坦' },
  ];

  function worldById(id) {
    return WORLDS.find(w => w.worldId === id) || null;
  }

  return { WORLDS, worldById };
})();

if (typeof module !== 'undefined') module.exports = WorldMap;
```

- [ ] **Step 4: Run test to confirm it passes**

Run: `npx jest tests/worldmap.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/worldmap.js tests/worldmap.test.js
git commit -m "feat: add WorldMap module with 陸行鳥 DC world list"
```

---

## Task 3: Alert Grouping Module

**Files:**
- Create: `src/grouping.js`
- Create: `tests/grouping.test.js`

This is the most important pure-logic module. `normalizeTrigger` produces a canonical JSON key for grouping equality checks. `groupAlerts` reduces a flat alert array into logical groups.

- [ ] **Step 1: Write the failing tests**

```js
// tests/grouping.test.js
const Grouping = require('../src/grouping');
const { normalizeTrigger, groupAlerts } = Grouping;

// --- normalizeTrigger ---
describe('normalizeTrigger', () => {
  const validTrigger = {
    reducer: 'min',
    comparison: { lt: { target: 130 } },
    filters: [],
    mapper: 'pricePerUnit',
  };

  test('returns keys in canonical order regardless of input order', () => {
    const result = normalizeTrigger(validTrigger);
    expect(Object.keys(JSON.parse(result))).toEqual(['filters', 'mapper', 'reducer', 'comparison']);
  });

  test('two triggers with same values but different key order produce identical string', () => {
    const t2 = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
    expect(normalizeTrigger(validTrigger)).toBe(normalizeTrigger(t2));
  });

  test('returns null for trigger with unknown extra keys', () => {
    const bad = { ...validTrigger, unknownKey: 'value' };
    expect(normalizeTrigger(bad)).toBeNull();
  });

  test('different comparison targets produce different strings', () => {
    const t200 = { ...validTrigger, comparison: { lt: { target: 200 } } };
    expect(normalizeTrigger(validTrigger)).not.toBe(normalizeTrigger(t200));
  });
});

// --- groupAlerts ---
describe('groupAlerts', () => {
  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };

  const makeAlert = (overrides) => ({
    id: 'alert1',
    itemId: 44015,
    worldId: 4030,
    name: 'Test alert',
    discordWebhook: 'https://discord.com/wh',
    triggerVersion: 0,
    trigger,
    ...overrides,
  });

  test('two alerts for same item and trigger merge into one group', () => {
    const alerts = [makeAlert(), makeAlert({ id: 'alert2', worldId: 4031 })];
    const groups = groupAlerts(alerts);
    expect(groups).toHaveLength(1);
    expect(groups[0].worlds).toHaveLength(2);
  });

  test('two alerts for same item but different triggers produce two groups', () => {
    const alerts = [
      makeAlert(),
      makeAlert({ id: 'alert2', trigger: { ...trigger, comparison: { lt: { target: 200 } } } }),
    ];
    const groups = groupAlerts(alerts);
    expect(groups).toHaveLength(2);
  });

  test('alerts for different itemIds produce separate groups', () => {
    const alerts = [makeAlert(), makeAlert({ id: 'alert2', itemId: 99999 })];
    const groups = groupAlerts(alerts);
    expect(groups).toHaveLength(2);
  });

  test('group name is taken from the first alert in the group', () => {
    const alerts = [makeAlert({ name: 'First' }), makeAlert({ id: 'alert2', worldId: 4031, name: 'Second' })];
    const groups = groupAlerts(alerts);
    expect(groups[0].name).toBe('First');
  });

  test('alert with unknown trigger keys is a standalone single-world group', () => {
    const bad = makeAlert({ trigger: { ...trigger, extra: 'x' } });
    const groups = groupAlerts([bad]);
    expect(groups).toHaveLength(1);
    expect(groups[0].worlds).toHaveLength(1);
  });

  test('worlds include worldId and alertId from original alert', () => {
    const alert = makeAlert({ id: 'abc', worldId: 4030 });
    const groups = groupAlerts([alert]);
    expect(groups[0].worlds[0]).toMatchObject({ worldId: 4030, alertId: 'abc' });
  });

  test('empty array returns empty array', () => {
    expect(groupAlerts([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx jest tests/grouping.test.js`
Expected: FAIL — `Cannot find module '../src/grouping'`

- [ ] **Step 3: Implement `src/grouping.js`**

```js
const Grouping = (() => {
  const TRIGGER_KEY_ORDER = ['filters', 'mapper', 'reducer', 'comparison'];

  function normalizeTrigger(trigger) {
    const triggerKeys = Object.keys(trigger).sort();
    const allowedKeys = [...TRIGGER_KEY_ORDER].sort();
    if (JSON.stringify(triggerKeys) !== JSON.stringify(allowedKeys)) return null;

    const normalized = {};
    for (const key of TRIGGER_KEY_ORDER) {
      normalized[key] = trigger[key];
    }
    return JSON.stringify(normalized);
  }

  function groupAlerts(alerts) {
    const groups = new Map(); // key: `${itemId}::${normalizedTrigger}` → group object

    for (const alert of alerts) {
      const normalized = normalizeTrigger(alert.trigger);
      // Use alert id as a unique fallback key for ungroupable alerts
      const key = normalized !== null
        ? `${alert.itemId}::${normalized}`
        : `ungroupable::${alert.id}`;

      if (!groups.has(key)) {
        groups.set(key, {
          itemId: alert.itemId,
          name: alert.name,
          trigger: alert.trigger,
          worlds: [],
        });
      }

      groups.get(key).worlds.push({
        worldId: alert.worldId,
        alertId: alert.id,
        worldName: null, // filled in by callers who have WorldMap access
      });
    }

    return Array.from(groups.values());
  }

  return { normalizeTrigger, groupAlerts };
})();

if (typeof module !== 'undefined') module.exports = Grouping;
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx jest tests/grouping.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/grouping.js tests/grouping.test.js
git commit -m "feat: add Grouping module with normalizeTrigger and groupAlerts"
```

---

## Task 4: API Layer

**Files:**
- Create: `src/api.js`
- Create: `tests/api.test.js`

Thin `fetch` wrappers. Tests mock `global.fetch` with `jest.spyOn`. Each wrapper throws on non-ok HTTP status so callers can catch errors uniformly.

- [ ] **Step 1: Write the failing tests**

```js
// tests/api.test.js
const API = require('../src/api');

beforeEach(() => {
  jest.resetAllMocks();
});

function mockFetch(body, status = 200) {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('getAlerts', () => {
  test('GETs /api/web/alerts and returns parsed JSON', async () => {
    const alerts = [{ id: '1', itemId: 44015 }];
    mockFetch(alerts);
    const result = await API.getAlerts();
    expect(global.fetch).toHaveBeenCalledWith('/api/web/alerts');
    expect(result).toEqual(alerts);
  });

  test('throws on non-ok response', async () => {
    mockFetch({ error: 'Unauthorized' }, 401);
    await expect(API.getAlerts()).rejects.toThrow('HTTP 401');
  });
});

describe('createAlert', () => {
  test('POSTs payload to /api/web/alerts with JSON headers', async () => {
    mockFetch({ id: 'new-id' });
    const payload = { itemId: 44015, worldId: 4030, name: 'Test' };
    await API.createAlert(payload);
    expect(global.fetch).toHaveBeenCalledWith('/api/web/alerts', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    }));
  });

  test('throws on non-ok response', async () => {
    mockFetch({}, 400);
    await expect(API.createAlert({})).rejects.toThrow('HTTP 400');
  });
});

describe('deleteAlert', () => {
  test('sends DELETE to /api/web/alerts/{id}', async () => {
    // ⚠ DEVIATION: plan had `mockFetch({}, 204)` here followed by an immediate override —
    // the first call was dead code (mockFetch already sets ok correctly for 204). Removed.
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 204 });
    await API.deleteAlert('alert-abc');
    expect(global.fetch).toHaveBeenCalledWith('/api/web/alerts/alert-abc', { method: 'DELETE' });
  });

  test('throws on non-ok response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404 });
    await expect(API.deleteAlert('bad-id')).rejects.toThrow('HTTP 404');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx jest tests/api.test.js`
Expected: FAIL — `Cannot find module '../src/api'`

- [ ] **Step 3: Implement `src/api.js`**

```js
const API = (() => {
  async function getAlerts() {
    const res = await fetch('/api/web/alerts');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function createAlert(payload) {
    const res = await fetch('/api/web/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function deleteAlert(alertId) {
    const res = await fetch(`/api/web/alerts/${alertId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  return { getAlerts, createAlert, deleteAlert };
})();

if (typeof module !== 'undefined') module.exports = API;
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx jest tests/api.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/api.js tests/api.test.js
git commit -m "feat: add API layer with getAlerts, createAlert, deleteAlert"
```

---

## Task 5: Save Operations

**Files:**
- Create: `src/save-ops.js`
- Create: `tests/save-ops.test.js`

`computeSaveOps` is a pure function — no side effects, easy to test exhaustively. `executeSaveOps` calls the API in POST-first order; tests mock API to verify ordering and partial-failure behavior.

- [ ] **Step 1: Write the failing tests**

```js
// tests/save-ops.test.js
const SaveOps = require('../src/save-ops');
const API = require('../src/api');
const WorldMap = require('../src/worldmap');
const { computeSaveOps, executeSaveOps } = SaveOps;
const { WORLDS } = WorldMap;

// --- computeSaveOps ---
describe('computeSaveOps', () => {
  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
  const formState = (selectedWorldIds, overrideTrigger) => ({
    name: 'My Alert',
    webhook: 'https://discord.com/wh',
    trigger: overrideTrigger || trigger,
    selectedWorldIds: new Set(selectedWorldIds),
  });

  const existingGroup = {
    itemId: 44015,
    name: 'My Alert', // ⚠ DEVIATION: plan omitted this field; without it, group.name is undefined and
                      // formState.name !== group.name → nameChanged = true → the no-op test fails.
                      // Intentionally added. Do not remove.
    trigger,
    worlds: [{ worldId: 4030, alertId: 'alert-4030' }],
  };

  test('newly checked world not in existing group → in postsNeeded', () => {
    const ops = computeSaveOps(existingGroup, formState([4030, 4031]), WORLDS);
    expect(ops.postsNeeded.map(w => w.worldId)).toContain(4031);
  });

  test('unchecked world that had existing alert → in deletesAfterSuccess', () => {
    const ops = computeSaveOps(existingGroup, formState([4031]), WORLDS); // 4030 unchecked
    expect(ops.deletesAfterSuccess).toContain('alert-4030');
    expect(ops.postsNeeded.map(w => w.worldId)).not.toContain(4030);
  });

  test('checked world with identical existing alert → no-op (not in either list)', () => {
    const ops = computeSaveOps(existingGroup, formState([4030]), WORLDS);
    expect(ops.postsNeeded.map(w => w.worldId)).not.toContain(4030);
    expect(ops.deletesAfterSuccess).not.toContain('alert-4030');
  });

  test('checked world with different trigger → in both postsNeeded and deletesAfterSuccess', () => {
    const newTrigger = { ...trigger, comparison: { lt: { target: 200 } } };
    const ops = computeSaveOps(existingGroup, formState([4030], newTrigger), WORLDS);
    expect(ops.postsNeeded.map(w => w.worldId)).toContain(4030);
    expect(ops.deletesAfterSuccess).toContain('alert-4030');
  });

  test('null group (no existing alerts) → all selected worlds in postsNeeded', () => {
    const ops = computeSaveOps(null, formState([4028, 4029]), WORLDS);
    expect(ops.postsNeeded.map(w => w.worldId)).toEqual([4028, 4029]);
    expect(ops.deletesAfterSuccess).toHaveLength(0);
  });

  test('name change on otherwise identical alert → world is in postsNeeded and deletesAfterSuccess', () => {
    const state = { ...formState([4030]), name: 'New Name' };
    const ops = computeSaveOps(existingGroup, state, WORLDS);
    expect(ops.postsNeeded.map(w => w.worldId)).toContain(4030);
    expect(ops.deletesAfterSuccess).toContain('alert-4030');
  });
});

// --- executeSaveOps ---
describe('executeSaveOps', () => {
  beforeEach(() => jest.resetAllMocks());

  const ops = {
    postsNeeded: [
      { worldId: 4030, worldName: '利維坦' },
      { worldId: 4031, worldName: '鳳凰' },
    ],
    deletesAfterSuccess: ['old-alert-1'],
  };
  const formState = {
    name: 'Test',
    webhook: 'https://discord.com/wh',
    trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } },
    selectedWorldIds: new Set([4030, 4031]),
  };

  test('calls createAlert for each world in postsNeeded', async () => {
    jest.spyOn(API, 'createAlert').mockResolvedValue({ id: 'new' });
    jest.spyOn(API, 'deleteAlert').mockResolvedValue();
    await executeSaveOps(ops, 44015, formState);
    expect(API.createAlert).toHaveBeenCalledTimes(2);
    expect(API.createAlert).toHaveBeenCalledWith(expect.objectContaining({ worldId: 4030, itemId: 44015 }));
  });

  test('calls deleteAlert only after all POSTs succeed', async () => {
    const callOrder = [];
    jest.spyOn(API, 'createAlert').mockImplementation(async () => { callOrder.push('post'); return { id: 'x' }; });
    jest.spyOn(API, 'deleteAlert').mockImplementation(async () => { callOrder.push('delete'); });
    await executeSaveOps(ops, 44015, formState);
    const firstDelete = callOrder.indexOf('delete');
    const lastPost = callOrder.lastIndexOf('post');
    expect(firstDelete).toBeGreaterThan(lastPost);
  });

  test('throws and skips deletes if any POST fails', async () => {
    jest.spyOn(API, 'createAlert').mockRejectedValue(new Error('Network error'));
    jest.spyOn(API, 'deleteAlert').mockResolvedValue();
    await expect(executeSaveOps(ops, 44015, formState)).rejects.toThrow();
    expect(API.deleteAlert).not.toHaveBeenCalled();
  });

  test('no-op when postsNeeded and deletesAfterSuccess are both empty', async () => {
    jest.spyOn(API, 'createAlert').mockResolvedValue({});
    jest.spyOn(API, 'deleteAlert').mockResolvedValue();
    await executeSaveOps({ postsNeeded: [], deletesAfterSuccess: [] }, 44015, formState);
    expect(API.createAlert).not.toHaveBeenCalled();
    expect(API.deleteAlert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx jest tests/save-ops.test.js`
Expected: FAIL — `Cannot find module '../src/save-ops'`

- [ ] **Step 3: Implement `src/save-ops.js`**

```js
const SaveOps = (() => {
  // Requires: Grouping (for normalizeTrigger), API — injected via globals in TM context
  // In test context, required via module.exports
  // ⚠ DEVIATION: plan had a _WorldMap import here but it was never used (worlds is passed
  // as a parameter). The unused import was removed.
  const _Grouping = typeof Grouping !== 'undefined' ? Grouping : require('./grouping');
  const _API = typeof API !== 'undefined' ? API : require('./api');

  /**
   * Pure function. Returns { postsNeeded, deletesAfterSuccess }.
   * @param {object|null} group  - existing logical alert group, or null
   * @param {object} formState   - { name, webhook, trigger, selectedWorldIds: Set<number> }
   * @param {Array}  worlds      - full world list (WORLDS)
   */
  function computeSaveOps(group, formState, worlds) {
    const postsNeeded = [];
    const deletesAfterSuccess = [];

    const existingByWorldId = new Map();
    if (group) {
      for (const w of group.worlds) {
        existingByWorldId.set(w.worldId, w);
      }
    }

    const newTriggerKey = _Grouping.normalizeTrigger(formState.trigger);

    for (const world of worlds) {
      const existing = existingByWorldId.get(world.worldId);
      const isSelected = formState.selectedWorldIds.has(world.worldId);

      if (isSelected && !existing) {
        // Newly checked, no existing alert → POST
        postsNeeded.push(world);
      } else if (!isSelected && existing) {
        // Unchecked, had existing alert → DELETE after success
        deletesAfterSuccess.push(existing.alertId);
      } else if (isSelected && existing) {
        const existingTriggerKey = _Grouping.normalizeTrigger(group.trigger);
        const triggerChanged = newTriggerKey !== existingTriggerKey;
        const nameChanged = formState.name !== group.name;
        if (triggerChanged || nameChanged) {
          // Rule or name changed → POST new, DELETE old
          postsNeeded.push(world);
          deletesAfterSuccess.push(existing.alertId);
        }
        // else: identical — no-op
      }
    }

    return { postsNeeded, deletesAfterSuccess };
  }

  /**
   * Executes save ops: all POSTs first, then DELETEs only if all POSTs succeed.
   * Throws if any POST fails (no deletes will have run).
   */
  async function executeSaveOps(ops, itemId, formState) {
    if (ops.postsNeeded.length > 0) {
      const results = await Promise.allSettled(
        ops.postsNeeded.map(world =>
          _API.createAlert({
            name: formState.name,
            itemId,
            worldId: world.worldId,
            discordWebhook: formState.webhook,
            triggerVersion: 0,
            trigger: formState.trigger,
          })
        )
      );

      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        throw new Error(`Failed to create ${failures.length} alert(s). No deletions performed.`);
      }
    }

    if (ops.deletesAfterSuccess.length > 0) {
      // ⚠ DEVIATION: plan used Promise.all here. Changed to Promise.allSettled so partial
      // delete failures are counted and reported, symmetric with the POST phase above.
      const deleteResults = await Promise.allSettled(ops.deletesAfterSuccess.map(id => _API.deleteAlert(id)));
      const deleteFailures = deleteResults.filter(r => r.status === 'rejected');
      if (deleteFailures.length > 0) {
        throw new Error(`Failed to delete ${deleteFailures.length} alert(s). Some alerts may need manual cleanup.`);
      }
    }
  }

  return { computeSaveOps, executeSaveOps };
})();

if (typeof module !== 'undefined') module.exports = SaveOps;
```

> **Note on dependency injection pattern:** In the TM context, `Grouping`, `API`, and `WorldMap` are globals from concatenated scripts above. In test context, `typeof Grouping` is `'undefined'`, so it falls back to `require()`. This lets each module be tested in isolation.

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx jest tests/save-ops.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/save-ops.js tests/save-ops.test.js
git commit -m "feat: add SaveOps with POST-first safety and computeSaveOps pure function"
```

---

## Task 6: Modal Component

**Files:**
- Create: `src/modal.js`
- Create: `tests/modal.test.js`

The modal is shared by both pages. It builds a DOM overlay, handles the webhook field with auto-populate priority, disables Save when webhook is empty, and calls an `onSave` callback with the form state.

- [ ] **Step 1: Write the failing tests**

```js
// tests/modal.test.js
const Modal = require('../src/modal');

// GM stubs are in tests/setup.js
// Re-assign per test as needed
beforeEach(() => {
  document.body.innerHTML = '';
  GM_getValue.mockReset();
  GM_setValue.mockReset();
});

describe('openModal — DOM structure', () => {
  test('injects a modal overlay into document.body', () => {
    Modal.openModal({ itemId: 44015, itemName: '木棉原木', group: null, onSave: jest.fn() });
    expect(document.querySelector('#univ-alert-modal')).not.toBeNull();
  });

  test('renders checkboxes for all 8 陸行鳥 worlds', () => {
    Modal.openModal({ itemId: 44015, itemName: '木棉原木', group: null, onSave: jest.fn() });
    const checkboxes = document.querySelectorAll('#univ-alert-modal input[type="checkbox"][data-world-id]');
    expect(checkboxes).toHaveLength(8);
  });

  test('Save button is disabled when webhook field is empty', () => {
    GM_getValue.mockReturnValue(undefined);
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn() });
    const saveBtn = document.querySelector('#univ-alert-modal [data-action="save"]');
    expect(saveBtn.disabled).toBe(true);
  });
});

describe('openModal — webhook auto-populate', () => {
  const makeGroup = (webhook) => ({
    itemId: 44015, name: 'Test', trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } },
    worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦', discordWebhook: webhook }],
    discordWebhook: webhook,
  });

  test('priority 1: uses webhook from existing group when present', () => {
    GM_getValue.mockReturnValue('https://gm-stored.com');
    const group = makeGroup('https://from-alert.com');
    Modal.openModal({ itemId: 44015, itemName: 'Item', group, onSave: jest.fn() });
    const webhookInput = document.querySelector('#univ-alert-modal input[data-field="webhook"]');
    expect(webhookInput.value).toBe('https://from-alert.com');
  });

  test('priority 2: falls back to GM_getValue when group has no webhook', () => {
    GM_getValue.mockReturnValue('https://gm-stored.com');
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn() });
    const webhookInput = document.querySelector('#univ-alert-modal input[data-field="webhook"]');
    expect(webhookInput.value).toBe('https://gm-stored.com');
  });

  test('priority 3: empty when no group and no GM value', () => {
    GM_getValue.mockReturnValue(undefined);
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn() });
    const webhookInput = document.querySelector('#univ-alert-modal input[data-field="webhook"]');
    expect(webhookInput.value).toBe('');
  });
});

describe('openModal — pre-population from group', () => {
  const group = {
    itemId: 44015, name: 'My Alert',
    trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } },
    discordWebhook: 'https://wh.com',
    worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
  };

  test('pre-checks world checkboxes for worlds in existing group', () => {
    Modal.openModal({ itemId: 44015, itemName: 'Item', group, onSave: jest.fn() });
    const cb4030 = document.querySelector('#univ-alert-modal input[data-world-id="4030"]');
    const cb4031 = document.querySelector('#univ-alert-modal input[data-world-id="4031"]');
    expect(cb4030.checked).toBe(true);
    expect(cb4031.checked).toBe(false);
  });

  test('pre-fills alert name with group name', () => {
    Modal.openModal({ itemId: 44015, itemName: 'Item', group, onSave: jest.fn() });
    const nameInput = document.querySelector('#univ-alert-modal input[data-field="name"]');
    expect(nameInput.value).toBe('My Alert');
  });

  test('falls back to itemName for alert name when group is null', () => {
    Modal.openModal({ itemId: 44015, itemName: '木棉原木', group: null, onSave: jest.fn() });
    const nameInput = document.querySelector('#univ-alert-modal input[data-field="name"]');
    expect(nameInput.value).toBe('木棉原木');
  });
});

describe('openModal — multi-group notice', () => {
  test('shows multi-group notice when multipleGroups flag is true', () => {
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn(), multipleGroups: true });
    expect(document.querySelector('#univ-alert-modal [data-notice="multiple-groups"]')).not.toBeNull();
  });

  test('no multi-group notice when flag is false', () => {
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn(), multipleGroups: false });
    expect(document.querySelector('#univ-alert-modal [data-notice="multiple-groups"]')).toBeNull();
  });
});

describe('closeModal', () => {
  test('removes modal from DOM', () => {
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn() });
    Modal.closeModal();
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx jest tests/modal.test.js`
Expected: FAIL — `Cannot find module '../src/modal'`

- [ ] **Step 3: Implement `src/modal.js`**

```js
const Modal = (() => {
  const _WorldMap = typeof WorldMap !== 'undefined' ? WorldMap : require('./worldmap');

  const METRIC_LABELS = { pricePerUnit: 'Price Per Unit', quantity: 'Quantity', total: 'Total' };
  const MAPPER_VALUES = ['pricePerUnit', 'quantity', 'total'];
  const REDUCER_VALUES = ['min', 'max', 'mean'];
  const COMPARATOR_VALUES = ['lt', 'gt'];

  function buildTriggerFromForm(form) {
    const mapper = form.querySelector('[data-field="mapper"]').value;
    const reducer = form.querySelector('[data-field="reducer"]').value;
    const comparatorKey = form.querySelector('[data-field="comparator"]').value;
    const target = Number(form.querySelector('[data-field="target"]').value);
    const hq = form.querySelector('[data-field="hq"]').checked;
    return {
      filters: hq ? ['hq'] : [],
      mapper,
      reducer,
      comparison: { [comparatorKey]: { target } },
    };
  }

  function openModal({ itemId, itemName, group, onSave, multipleGroups = false }) {
    const existingWorldIds = new Set((group?.worlds || []).map(w => w.worldId));
    const existingTrigger = group?.trigger || { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 0 } } };
    const existingComparator = Object.keys(existingTrigger.comparison)[0]; // 'lt' or 'gt'
    const existingTarget = existingTrigger.comparison[existingComparator].target;
    const isHQ = existingTrigger.filters.includes('hq');

    // Webhook auto-populate: 1) from alert, 2) GM_getValue, 3) empty
    const webhookFromAlert = group?.discordWebhook || '';
    const webhookFromGM = GM_getValue('discordWebhook') || '';
    const initialWebhook = webhookFromAlert || webhookFromGM;

    const overlay = document.createElement('div');
    overlay.id = 'univ-alert-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999';

    const worldCheckboxes = _WorldMap.WORLDS.map(w => `
      <label style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;${existingWorldIds.has(w.worldId) ? 'background:#1a3a5c;' : ''}">
        <input type="checkbox" data-world-id="${w.worldId}" ${existingWorldIds.has(w.worldId) ? 'checked' : ''}/>
        ${w.worldName}
      </label>`).join('');

    const multiNotice = multipleGroups
      ? `<div data-notice="multiple-groups" style="background:#3a2a00;border:1px solid #ff9800;padding:8px;border-radius:4px;margin-bottom:12px;font-size:12px">
           Multiple alert rules exist for this item. Editing here will only affect this rule. Use the <a href="/account/alerts" style="color:#ff9800">Alerts page</a> to manage all rules.
         </div>` : '';

    overlay.innerHTML = `
      <div style="background:#1a1a2e;border-radius:8px;padding:24px;width:480px;max-height:80vh;overflow-y:auto;color:#fff">
        <h3 style="margin:0 0 16px">Set Alerts — ${itemName}</h3>
        ${multiNotice}
        <form id="univ-alert-form">
          <div style="margin-bottom:12px">
            <label style="display:block;margin-bottom:4px;font-size:13px">Alert Name</label>
            <input data-field="name" type="text" value="${group?.name || itemName}"
              style="width:100%;box-sizing:border-box;background:#2a2a4e;border:1px solid #444;color:#fff;padding:6px 8px;border-radius:4px"/>
          </div>
          <div style="margin-bottom:12px">
            <label style="display:block;margin-bottom:4px;font-size:13px">Discord Webhook</label>
            <input data-field="webhook" type="text" value="${initialWebhook}" placeholder="https://discord.com/api/webhooks/..."
              style="width:100%;box-sizing:border-box;background:#2a2a4e;border:1px solid #444;color:#fff;padding:6px 8px;border-radius:4px"/>
          </div>
          <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
            <select data-field="mapper" style="background:#2a2a4e;border:1px solid #444;color:#fff;padding:6px 8px;border-radius:4px">
              ${MAPPER_VALUES.map(v => `<option value="${v}" ${existingTrigger.mapper === v ? 'selected' : ''}>${METRIC_LABELS[v]}</option>`).join('')}
            </select>
            <select data-field="reducer" style="background:#2a2a4e;border:1px solid #444;color:#fff;padding:6px 8px;border-radius:4px">
              ${REDUCER_VALUES.map(v => `<option value="${v}" ${existingTrigger.reducer === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
            <select data-field="comparator" style="background:#2a2a4e;border:1px solid #444;color:#fff;padding:6px 8px;border-radius:4px">
              ${COMPARATOR_VALUES.map(v => `<option value="${v}" ${existingComparator === v ? 'selected' : ''}>${v === 'lt' ? '<' : '>'}</option>`).join('')}
            </select>
            <input data-field="target" type="number" value="${existingTarget}" min="0"
              style="width:80px;background:#2a2a4e;border:1px solid #444;color:#fff;padding:6px 8px;border-radius:4px"/>
          </div>
          <div style="margin-bottom:12px">
            <label style="display:flex;align-items:center;gap:6px">
              <input data-field="hq" type="checkbox" ${isHQ ? 'checked' : ''}/>
              HQ Only
            </label>
          </div>
          <div style="margin-bottom:12px">
            <div style="font-size:13px;margin-bottom:6px">Worlds</div>
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <button type="button" data-action="select-all" style="background:#2a4a2a;border:1px solid #4a8a4a;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer">Select All</button>
              <button type="button" data-action="clear-all" style="background:#4a2a2a;border:1px solid #8a4a4a;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer">Clear</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">${worldCheckboxes}</div>
          </div>
          <div data-error-area style="display:none;background:#4a1a1a;border:1px solid #c00;padding:8px;border-radius:4px;margin-bottom:12px;font-size:13px"></div>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button type="button" data-action="cancel" style="background:#2a2a4e;border:1px solid #444;color:#fff;padding:8px 16px;border-radius:4px;cursor:pointer">Cancel</button>
            <button type="button" data-action="save" style="background:#1a5a8a;border:none;color:#fff;padding:8px 16px;border-radius:4px;cursor:pointer" ${initialWebhook ? '' : 'disabled'}>Save</button>
          </div>
        </form>
      </div>`;

    document.body.appendChild(overlay);

    const form = overlay.querySelector('#univ-alert-form');
    const webhookInput = overlay.querySelector('[data-field="webhook"]');
    const saveBtn = overlay.querySelector('[data-action="save"]');
    const errorArea = overlay.querySelector('[data-error-area]');

    // Enable/disable Save based on webhook
    webhookInput.addEventListener('input', () => {
      saveBtn.disabled = !webhookInput.value.trim();
    });

    overlay.querySelector('[data-action="select-all"]').addEventListener('click', () => {
      overlay.querySelectorAll('input[data-world-id]').forEach(cb => { cb.checked = true; });
    });
    overlay.querySelector('[data-action="clear-all"]').addEventListener('click', () => {
      overlay.querySelectorAll('input[data-world-id]').forEach(cb => { cb.checked = false; });
    });
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', closeModal);

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      errorArea.style.display = 'none';

      const webhook = webhookInput.value.trim();
      const selectedWorldIds = new Set(
        [...overlay.querySelectorAll('input[data-world-id]:checked')].map(cb => Number(cb.dataset.worldId))
      );
      const trigger = buildTriggerFromForm(form);
      const name = form.querySelector('[data-field="name"]').value.trim();

      GM_setValue('discordWebhook', webhook);

      try {
        await onSave({ name, webhook, trigger, selectedWorldIds });
        closeModal();
      } catch (err) {
        errorArea.textContent = err.message;
        errorArea.style.display = 'block';
        saveBtn.disabled = false;
      }
    });
  }

  function closeModal() {
    const existing = document.getElementById('univ-alert-modal');
    if (existing) existing.remove();
  }

  return { openModal, closeModal };
})();

if (typeof module !== 'undefined') module.exports = Modal;
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx jest tests/modal.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/modal.js tests/modal.test.js
git commit -m "feat: add Modal component with webhook auto-populate and world checkboxes"
```

---

## Task 7: Market Page Injection

**Files:**
- Create: `src/market-page.js`
- Create: `tests/market-page.test.js`

Waits for the button bar (`div.box_flex.form`) to appear in DOM, appends a custom "Set Alerts" button to it (native buttons are left untouched), opens modal on click pre-populated from first group. **Note:** The code snippets below reflect the original plan; the implementation now uses `findButtonBar()` instead of `findNativeAlertsButton()` — see the spec doc and source for the current approach.

- [ ] **Step 1: Write the failing tests**

```js
// tests/market-page.test.js
const MarketPage = require('../src/market-page');

// Stub globals used by market-page
global.Modal = { openModal: jest.fn(), closeModal: jest.fn() };
global.API = { getAlerts: jest.fn() };
global.Grouping = require('../src/grouping');
global.SaveOps = { computeSaveOps: jest.fn(), executeSaveOps: jest.fn() };

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
});

describe('injectMarketButton', () => {
  function setupDOM(hasNativeButton = true) {
    document.body.innerHTML = `
      <h1 class="item-name">木棉原木</h1>
      ${hasNativeButton ? '<button>Alerts</button>' : ''}
    `;
  }

  test('hides native Alerts button', () => {
    setupDOM();
    MarketPage.injectMarketButton(44015);
    const native = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Alerts'));
    // Should be hidden (display:none or visibility:hidden) or removed
    expect(native?.style.display).toBe('none');
  });

  test('injects custom button with id univ-alert-btn', () => {
    setupDOM();
    MarketPage.injectMarketButton(44015);
    expect(document.querySelector('#univ-alert-btn')).not.toBeNull();
  });

  test('does nothing if already injected (idempotent)', () => {
    setupDOM();
    MarketPage.injectMarketButton(44015);
    MarketPage.injectMarketButton(44015);
    expect(document.querySelectorAll('#univ-alert-btn')).toHaveLength(1);
  });
});

describe('handleAlertButtonClick', () => {
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0,
    trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };

  test('calls API.getAlerts and opens modal on click', async () => {
    API.getAlerts.mockResolvedValue([alert1]);
    await MarketPage.handleAlertButtonClick(44015, '木棉原木');
    expect(API.getAlerts).toHaveBeenCalled();
    expect(Modal.openModal).toHaveBeenCalled();
  });

  test('passes multipleGroups=true when item has 2+ distinct groups', async () => {
    const alert2 = { ...alert1, id: 'a2', trigger: { ...alert1.trigger, comparison: { lt: { target: 200 } } } };
    API.getAlerts.mockResolvedValue([alert1, alert2]);
    await MarketPage.handleAlertButtonClick(44015, '木棉原木');
    const callArgs = Modal.openModal.mock.calls[0][0];
    expect(callArgs.multipleGroups).toBe(true);
  });

  test('shows error message when getAlerts fails', async () => {
    API.getAlerts.mockRejectedValue(new Error('Network error'));
    // Must include #univ-alert-btn so the error element can be inserted after it
    document.body.innerHTML = '<button id="univ-alert-btn">🔔 Set Alerts</button>';
    await MarketPage.handleAlertButtonClick(44015, '木棉原木');
    expect(Modal.openModal).not.toHaveBeenCalled();
    const errorEl = document.getElementById('univ-alert-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toBe('Failed to load existing alerts — check your connection');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx jest tests/market-page.test.js`
Expected: FAIL — `Cannot find module '../src/market-page'`

- [ ] **Step 3: Implement `src/market-page.js`**

```js
const MarketPage = (() => {
  const _API = typeof API !== 'undefined' ? API : require('./api');
  const _Modal = typeof Modal !== 'undefined' ? Modal : require('./modal');
  const _Grouping = typeof Grouping !== 'undefined' ? Grouping : require('./grouping');
  const _SaveOps = typeof SaveOps !== 'undefined' ? SaveOps : require('./save-ops');
  const _WorldMap = typeof WorldMap !== 'undefined' ? WorldMap : require('./worldmap');

  function findNativeAlertsButton() {
    const byText = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Alerts'));
    return byText || null;
  }

  function readItemName() {
    const heading = document.querySelector('h1');
    return heading ? heading.textContent.trim() : '';
  }

  function injectMarketButton(itemId) {
    if (document.getElementById('univ-alert-btn')) return; // idempotent

    const native = findNativeAlertsButton();
    if (native) native.style.display = 'none';

    const btn = document.createElement('button');
    btn.id = 'univ-alert-btn';
    btn.textContent = '🔔 Set Alerts';
    btn.style.cssText = 'background:#1a5a8a;border:none;color:#fff;padding:8px 16px;border-radius:4px;cursor:pointer';

    btn.addEventListener('click', () => handleAlertButtonClick(itemId, readItemName()));

    const insertAfter = native || document.querySelector('button');
    if (insertAfter) {
      insertAfter.insertAdjacentElement('afterend', btn);
    } else {
      document.body.appendChild(btn);
    }
  }

  async function handleAlertButtonClick(itemId, itemName) {
    let allAlerts;
    try {
      allAlerts = await _API.getAlerts();
    } catch (err) {
      // Show inline error — modal not opened
      const errorEl = document.getElementById('univ-alert-error') || document.createElement('div');
      errorEl.id = 'univ-alert-error';
      errorEl.style.cssText = 'color:#ff6b6b;font-size:13px;margin-top:4px';
      errorEl.textContent = 'Failed to load existing alerts — check your connection';
      const btn = document.getElementById('univ-alert-btn');
      if (btn) btn.insertAdjacentElement('afterend', errorEl);
      return;
    }

    const itemAlerts = allAlerts.filter(a => a.itemId === itemId);
    const groups = _Grouping.groupAlerts(itemAlerts);

    // Enrich worlds with worldName
    groups.forEach(g => {
      g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap.worldById(w.worldId)?.worldName || '' }));
    });

    const group = groups[0] || null;
    const multipleGroups = groups.length > 1;

    _Modal.openModal({
      itemId,
      itemName,
      group,
      multipleGroups,
      onSave: async (formState) => {
        const ops = _SaveOps.computeSaveOps(group, formState, _WorldMap.WORLDS);
        await _SaveOps.executeSaveOps(ops, itemId, formState);
      },
    });
  }

  function init() {
    // Wait for item name heading (React render signal)
    const observer = new MutationObserver(() => {
      if (document.querySelector('h1')) {
        observer.disconnect();
        const pathParts = window.location.pathname.split('/');
        if (pathParts.length !== 3) return; // guard: only /market/{id}
        const itemId = Number(pathParts[2]);
        if (!isNaN(itemId)) injectMarketButton(itemId);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  return { init, injectMarketButton, handleAlertButtonClick };
})();

if (typeof module !== 'undefined') module.exports = MarketPage;
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx jest tests/market-page.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/market-page.js tests/market-page.test.js
git commit -m "feat: add MarketPage injection with native button replacement and modal integration"
```

---

## Task 8: Alerts Page Injection

**Files:**
- Create: `src/alerts-page.js`
- Create: `tests/alerts-page.test.js`

Scrapes item names from native DOM, renders grouped table, handles Edit (re-opens modal) and Delete (parallel delete all group alerts).

- [ ] **Step 1: Write the failing tests**

```js
// tests/alerts-page.test.js
const AlertsPage = require('../src/alerts-page');

global.API = { getAlerts: jest.fn(), deleteAlert: jest.fn() };
global.Modal = { openModal: jest.fn(), closeModal: jest.fn() };
global.Grouping = require('../src/grouping');
global.SaveOps = { computeSaveOps: jest.fn(), executeSaveOps: jest.fn() };
global.WorldMap = require('../src/worldmap');

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
});

function setupNativeDOM(items = [{ itemId: 44015, name: '木棉原木' }]) {
  document.body.innerHTML = items.map(i =>
    `<a href="/market/${i.itemId}">${i.name}</a>`
  ).join('');
}

describe('scrapeItemNames', () => {
  test('extracts itemId→name from native anchor elements', () => {
    setupNativeDOM([{ itemId: 44015, name: '木棉原木' }, { itemId: 99, name: 'Other' }]);
    const map = AlertsPage.scrapeItemNames();
    expect(map.get(44015)).toBe('木棉原木');
    expect(map.get(99)).toBe('Other');
  });

  test('returns empty map when no anchors present', () => {
    const map = AlertsPage.scrapeItemNames();
    expect(map.size).toBe(0);
  });
});

describe('renderAlertsPanel', () => {
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'My Alert', discordWebhook: 'https://wh.com',
    triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };

  test('injects panel with id univ-alert-panel', () => {
    setupNativeDOM();
    const nameMap = new Map([[44015, '木棉原木']]);
    AlertsPage.renderAlertsPanel([alert1], nameMap);
    expect(document.getElementById('univ-alert-panel')).not.toBeNull();
  });

  test('renders one row per logical alert group', () => {
    setupNativeDOM();
    const alert2 = { ...alert1, id: 'a2', worldId: 4031 }; // same group
    const nameMap = new Map([[44015, '木棉原木']]);
    AlertsPage.renderAlertsPanel([alert1, alert2], nameMap);
    const rows = document.querySelectorAll('#univ-alert-panel [data-group-row]');
    expect(rows).toHaveLength(1);
  });

  test('displays "Item #44015" for items not in nameMap', () => {
    setupNativeDOM([]);
    AlertsPage.renderAlertsPanel([alert1], new Map());
    expect(document.getElementById('univ-alert-panel').textContent).toContain('Item #44015');
  });

  test('removes existing panel before re-rendering (stale panel cleanup)', () => {
    setupNativeDOM();
    const nameMap = new Map([[44015, '木棉原木']]);
    AlertsPage.renderAlertsPanel([alert1], nameMap);
    AlertsPage.renderAlertsPanel([alert1], nameMap);
    expect(document.querySelectorAll('#univ-alert-panel')).toHaveLength(1);
  });
});

describe('init — GET failure', () => {
  test('shows full-width error and no panel when getAlerts rejects', async () => {
    API.getAlerts.mockRejectedValue(new Error('Server error'));
    // Seed native DOM with a market anchor so the observer fires immediately
    document.body.innerHTML = '<a href="/market/44015">木棉原木</a>';

    // Invoke the init-level error path directly via the exported helper
    await AlertsPage.handleInitError();

    expect(document.getElementById('univ-alert-panel')).toBeNull();
    const errorEl = document.querySelector('[data-init-error]');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('Failed to load existing alerts');
  });
});

describe('deleteGroup', () => {
  test('calls deleteAlert for each alertId in group in parallel', async () => {
    API.deleteAlert.mockResolvedValue();
    const group = { worlds: [{ alertId: 'a1' }, { alertId: 'a2' }] };
    await AlertsPage.deleteGroup(group);
    expect(API.deleteAlert).toHaveBeenCalledTimes(2);
    expect(API.deleteAlert).toHaveBeenCalledWith('a1');
    expect(API.deleteAlert).toHaveBeenCalledWith('a2');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx jest tests/alerts-page.test.js`
Expected: FAIL — `Cannot find module '../src/alerts-page'`

- [ ] **Step 3: Implement `src/alerts-page.js`**

```js
const AlertsPage = (() => {
  const _API = typeof API !== 'undefined' ? API : require('./api');
  const _Modal = typeof Modal !== 'undefined' ? Modal : require('./modal');
  const _Grouping = typeof Grouping !== 'undefined' ? Grouping : require('./grouping');
  const _SaveOps = typeof SaveOps !== 'undefined' ? SaveOps : require('./save-ops');
  const _WorldMap = typeof WorldMap !== 'undefined' ? WorldMap : require('./worldmap');

  function scrapeItemNames() {
    const map = new Map();
    document.querySelectorAll('a[href^="/market/"]').forEach(a => {
      const parts = a.getAttribute('href').split('/');
      const itemId = Number(parts[2]);
      if (!isNaN(itemId)) map.set(itemId, a.textContent.trim());
    });
    return map;
  }

  function formatRule(trigger) {
    const comparator = 'lt' in trigger.comparison ? '<' : '>';
    const target = trigger.comparison[Object.keys(trigger.comparison)[0]].target;
    const metricLabels = { pricePerUnit: 'Min price', quantity: 'Quantity', total: 'Total' };
    const reducerLabels = { min: 'Min', max: 'Max', mean: 'Avg' };
    const label = `${reducerLabels[trigger.reducer] || trigger.reducer} ${metricLabels[trigger.mapper] || trigger.mapper} ${comparator} ${target}`;
    return trigger.filters.includes('hq') ? `${label} <span style="background:#4a8a4a;border-radius:3px;padding:0 4px;font-size:11px">HQ</span>` : label;
  }

  function renderAlertsPanel(alerts, nameMap) {
    // Remove stale panel if present
    const existing = document.getElementById('univ-alert-panel');
    if (existing) existing.remove();

    const groups = _Grouping.groupAlerts(alerts);
    // Enrich groups with worldName
    groups.forEach(g => {
      g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap.worldById(w.worldId)?.worldName || '' }));
    });

    const panel = document.createElement('div');
    panel.id = 'univ-alert-panel';
    panel.style.cssText = 'color:#fff;font-family:sans-serif;padding:16px';

    const rows = groups.map((g, idx) => {
      const itemName = nameMap.has(g.itemId) ? nameMap.get(g.itemId) : `Item #${g.itemId}`;
      const worldPills = g.worlds.map(w => `<span style="background:#1a3a5c;border-radius:12px;padding:2px 8px;font-size:12px;margin:2px">${w.worldName || w.worldId}</span>`).join('');
      return `
        <tr data-group-row="${idx}" style="border-bottom:1px solid #333">
          <td style="padding:10px 8px">${itemName}<br/><span style="font-size:11px;color:#888">#${g.itemId}</span></td>
          <td style="padding:10px 8px">${formatRule(g.trigger)}</td>
          <td style="padding:10px 8px">${worldPills}</td>
          <td style="padding:10px 8px;white-space:nowrap">
            <button data-action="edit" data-group-idx="${idx}" style="background:#1a4a7a;border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;margin-right:6px">Edit</button>
            <button data-action="delete" data-group-idx="${idx}" style="background:#6a1a1a;border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer">Delete</button>
          </td>
        </tr>`;
    }).join('');

    panel.innerHTML = `
      <h2 style="margin:0 0 16px">Alerts Manager</h2>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid #555;font-size:13px;color:#aaa">
            <th style="text-align:left;padding:8px">Item</th>
            <th style="text-align:left;padding:8px">Rule</th>
            <th style="text-align:left;padding:8px">Worlds</th>
            <th style="text-align:left;padding:8px">Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    // Event delegation for Edit / Delete
    panel.querySelector('tbody').addEventListener('click', async (e) => {
      const action = e.target.dataset.action;
      const idx = Number(e.target.dataset.groupIdx);
      const group = groups[idx];
      if (!group) return;

      if (action === 'delete') {
        e.target.disabled = true;
        await deleteGroup(group);
        e.target.closest('tr').remove();
      } else if (action === 'edit') {
        // Re-fetch to get fresh state
        let freshAlerts;
        try {
          freshAlerts = await _API.getAlerts();
        } catch {
          alert('Failed to load alerts — check your connection');
          return;
        }
        const freshItemAlerts = freshAlerts.filter(a => a.itemId === group.itemId);
        const freshGroups = _Grouping.groupAlerts(freshItemAlerts);
        freshGroups.forEach(g => {
          g.worlds = g.worlds.map(w => ({ ...w, worldName: _WorldMap.worldById(w.worldId)?.worldName || '' }));
        });
        // Find the matching group by trigger
        const { normalizeTrigger } = _Grouping;
        const targetKey = normalizeTrigger(group.trigger);
        const freshGroup = freshGroups.find(g => normalizeTrigger(g.trigger) === targetKey) || null;
        const itemName = nameMap.get(group.itemId) || `Item #${group.itemId}`;

        _Modal.openModal({
          itemId: group.itemId,
          itemName,
          group: freshGroup,
          multipleGroups: false,
          onSave: async (formState) => {
            const ops = _SaveOps.computeSaveOps(freshGroup, formState, _WorldMap.WORLDS);
            await _SaveOps.executeSaveOps(ops, group.itemId, formState);
            // Refresh panel after save
            const updatedAlerts = await _API.getAlerts();
            const updatedNames = scrapeItemNames();
            // Merge in persisted nameMap entries (native DOM may be hidden)
            nameMap.forEach((v, k) => { if (!updatedNames.has(k)) updatedNames.set(k, v); });
            renderAlertsPanel(updatedAlerts, updatedNames);
          },
        });
      }
    });

    // Hide native content, inject panel
    document.body.prepend(panel);
  }

  async function deleteGroup(group) {
    await Promise.all(group.worlds.map(w => _API.deleteAlert(w.alertId)));
  }

  function init() {
    // Remove stale panel if user re-navigated
    const stale = document.getElementById('univ-alert-panel');
    if (stale) stale.remove();

    const TIMEOUT_MS = 10000;
    const startedAt = Date.now();

    const observer = new MutationObserver(async () => {
      if (!document.querySelector('a[href^="/market/"]')) {
        if (Date.now() - startedAt > TIMEOUT_MS) {
          observer.disconnect(); // no alerts — leave native page intact
        }
        return;
      }
      observer.disconnect();

      const nameMap = scrapeItemNames();

      // Hide native content
      document.querySelectorAll('body > *:not(#univ-alert-panel)').forEach(el => {
        if (el.tagName !== 'SCRIPT' && el.id !== 'univ-alert-panel') el.style.display = 'none';
      });

      let alerts;
      try {
        alerts = await _API.getAlerts();
      } catch {
        await handleInitError();
        // Restore native content
        document.querySelectorAll('body > *:not(#univ-alert-panel)').forEach(el => { el.style.display = ''; });
        return;
      }

      renderAlertsPanel(alerts, nameMap);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Exported so it can be tested directly without triggering MutationObserver
  async function handleInitError() {
    const errorEl = document.createElement('div');
    errorEl.dataset.initError = '';
    errorEl.style.cssText = 'color:#ff6b6b;padding:24px;font-size:16px;width:100%';
    errorEl.textContent = 'Failed to load existing alerts — check your connection';
    document.body.prepend(errorEl);
  }

  return { init, scrapeItemNames, renderAlertsPanel, deleteGroup, handleInitError };
})();

if (typeof module !== 'undefined') module.exports = AlertsPage;
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx jest tests/alerts-page.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/alerts-page.js tests/alerts-page.test.js
git commit -m "feat: add AlertsPage with grouped panel, edit, and delete"
```

---

## Task 9: SPA Navigation & Entry Point

**Files:**
- Create: `src/header.js`
- Create: `src/init.js`

`init.js` sets up a single `MutationObserver` that watches for URL changes (Next.js SPA navigation) and routes to the appropriate page module. No test file — this is pure wiring/DOM side-effects.

- [ ] **Step 1: Create `src/header.js`** (TamperMonkey metadata block — no JS, no tests)

```js
// ==UserScript==
// @name         Universalis Alert Manager
// @namespace    https://universalis.app/
// @version      1.0.0
// @description  Multi-world bulk alert creation and management for Universalis
// @author       You
// @match        https://universalis.app/market/*
// @match        https://universalis.app/account/alerts
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==
```

- [ ] **Step 2: Create `src/init.js`**

```js
const Init = (() => {
  function route(pathname) {
    if (pathname.startsWith('/market/')) {
      if (pathname.split('/').length === 3) { // /market/{id} only, not sub-paths
        MarketPage.init();
      }
    } else if (pathname === '/account/alerts') {
      AlertsPage.init();
    }
  }

  function setupNavigationObserver() {
    let lastPath = window.location.pathname;

    const observer = new MutationObserver(() => {
      const currentPath = window.location.pathname;
      if (currentPath === lastPath) return;
      lastPath = currentPath;
      route(currentPath);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function main() {
    setupNavigationObserver();
    route(window.location.pathname);
  }

  main();

  return { main, route, setupNavigationObserver };
})();

if (typeof module !== 'undefined') module.exports = Init;
```

- [ ] **Step 3: Commit**

```bash
git add src/header.js src/init.js
git commit -m "feat: add TM header and SPA navigation entry point"
```

---

## Task 10: Build Script

**Files:**
- Create: `build.js`

Concatenates source files in dependency order → `universalis-alert.user.js`. Run with `npm run build`.

- [ ] **Step 1: Create `build.js`**

```js
const fs = require('fs');
const path = require('path');

const SRC_ORDER = [
  'src/header.js',
  'src/worldmap.js',
  'src/grouping.js',
  'src/api.js',
  'src/save-ops.js',
  'src/modal.js',
  'src/market-page.js',
  'src/alerts-page.js',
  'src/init.js',
];

const OUT = 'universalis-alert.user.js';

const combined = SRC_ORDER.map(f => {
  const content = fs.readFileSync(path.join(__dirname, f), 'utf8');
  return `// ===== ${f} =====\n${content}`;
}).join('\n\n');

fs.writeFileSync(path.join(__dirname, OUT), combined, 'utf8');
console.log(`Built ${OUT} (${combined.length} bytes)`);
```

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: `universalis-alert.user.js` created with no errors

- [ ] **Step 3: Verify the output has the TM header as first line**

Run: `head -3 universalis-alert.user.js`
Expected:
```
// ===== src/header.js =====
// ==UserScript==
// @name         Universalis Alert Manager
```

- [ ] **Step 4: Run full test suite to confirm everything still passes**

Run: `npm test`
Expected: All test suites PASS

- [ ] **Step 5: Commit**

```bash
git add build.js universalis-alert.user.js
git commit -m "feat: add build script and initial built output"
```

---

## Pre-Ship Checklist

Before first installation:

- [ ] Verify 陸行鳥 world IDs against `GET https://universalis.app/api/v3/game/data-centers` — compare against `src/worldmap.js` WORLDS list
- [ ] Install `universalis-alert.user.js` in TamperMonkey
- [ ] Navigate to any `/market/[itemId]` page — confirm 🔔 button appears and modal opens
- [ ] Create alerts for 2+ worlds, verify they appear in `/account/alerts` panel
- [ ] Edit an alert group — change price target — confirm old alert deleted, new one created
- [ ] Delete an alert group — confirm all world alerts removed
- [ ] Navigate away from market page and back via Next.js SPA nav — confirm button re-injects
