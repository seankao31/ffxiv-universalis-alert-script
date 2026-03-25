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

function createContainer() {
  const container = document.createElement('div');
  container.id = 'test-container';
  document.body.appendChild(container);
  return container;
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
    const container = createContainer();
    const nameMap = new Map([[44015, '木棉原木']]);
    AlertsPage.renderAlertsPanel([alert1], nameMap, container);
    expect(document.getElementById('univ-alert-panel')).not.toBeNull();
  });

  test('renders one row per logical alert group', () => {
    const container = createContainer();
    const alert2 = { ...alert1, id: 'a2', worldId: 4031 }; // same group
    const nameMap = new Map([[44015, '木棉原木']]);
    AlertsPage.renderAlertsPanel([alert1, alert2], nameMap, container);
    const rows = document.querySelectorAll('#univ-alert-panel [data-group-row]');
    expect(rows).toHaveLength(1);
  });

  test('displays "Item #44015" for items not in nameMap', () => {
    const container = createContainer();
    AlertsPage.renderAlertsPanel([alert1], new Map(), container);
    expect(document.getElementById('univ-alert-panel').textContent).toContain('Item #44015');
  });

  test('clears container before re-rendering (stale panel cleanup)', () => {
    const container = createContainer();
    const nameMap = new Map([[44015, '木棉原木']]);
    AlertsPage.renderAlertsPanel([alert1], nameMap, container);
    AlertsPage.renderAlertsPanel([alert1], nameMap, container);
    expect(document.querySelectorAll('#univ-alert-panel')).toHaveLength(1);
  });
});

describe('handleInitError', () => {
  test('renders error message into container', async () => {
    const container = createContainer();
    await AlertsPage.handleInitError(container);

    expect(document.getElementById('univ-alert-panel')).toBeNull();
    const errorEl = container.querySelector('[data-init-error]');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('Failed to load existing alerts');
  });
});

describe('renderAlertsPanel — edit onSave re-fetch', () => {
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'My Alert', discordWebhook: 'https://wh.com',
    triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };

  test('edit onSave re-fetches alerts before computing ops', async () => {
    const container = createContainer();
    const nameMap = new Map([[44015, '木棉原木']]);

    // First render — initial alerts
    API.getAlerts.mockResolvedValue([alert1]);
    AlertsPage.renderAlertsPanel([alert1], nameMap, container);

    // Click the edit button
    const editBtn = document.querySelector('#univ-alert-panel [data-action="edit"]');
    API.getAlerts.mockResolvedValue([alert1]); // re-fetch inside edit click handler
    editBtn.click();
    await new Promise(r => setTimeout(r, 0));

    // Modal.openModal should have been called
    expect(Modal.openModal).toHaveBeenCalled();
    const { onSave } = Modal.openModal.mock.calls[0][0];

    // Set up mocks for onSave
    const onProgress = jest.fn();
    const formState = { name: 'Test', webhook: 'https://wh.com', trigger: alert1.trigger, selectedWorldIds: new Set([4030]) };
    SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [], deletesAfterSuccess: [] });
    SaveOps.executeSaveOps.mockResolvedValue();

    // Return fresh data on onSave re-fetch
    const alert2 = { ...alert1, id: 'a2', worldId: 4031 };
    const getAlertsCallCount = API.getAlerts.mock.calls.length;
    API.getAlerts.mockResolvedValue([alert1, alert2]);

    await onSave(formState, onProgress);

    // Should have called getAlerts again inside onSave (for re-fetch before computeSaveOps)
    expect(API.getAlerts.mock.calls.length).toBeGreaterThan(getAlertsCallCount);
    // onProgress should have been called with 'refreshing' phase
    expect(onProgress).toHaveBeenCalledWith({ phase: 'refreshing' });
    // computeSaveOps should have been called
    expect(SaveOps.computeSaveOps).toHaveBeenCalled();
    // Panel should have re-rendered in the same container
    expect(container.querySelector('#univ-alert-panel')).not.toBeNull();
  });
});

describe('deleteGroup', () => {
  test('calls deleteAlert for each alertId in group', async () => {
    API.deleteAlert.mockResolvedValue();
    const group = { worlds: [
      { alertId: 'a1', worldId: 4030, worldName: '利維坦' },
      { alertId: 'a2', worldId: 4031, worldName: '鳳凰' },
    ] };
    const result = await AlertsPage.deleteGroup(group);
    expect(API.deleteAlert).toHaveBeenCalledTimes(2);
    expect(API.deleteAlert).toHaveBeenCalledWith('a1');
    expect(API.deleteAlert).toHaveBeenCalledWith('a2');
    expect(result.failures).toEqual([]);
  });

  test('returns failures with world info on partial failure', async () => {
    API.deleteAlert.mockResolvedValueOnce().mockRejectedValueOnce(new Error('500'));
    const group = { worlds: [
      { alertId: 'a1', worldId: 4030, worldName: '利維坦' },
      { alertId: 'a2', worldId: 4031, worldName: '鳳凰' },
    ] };
    const result = await AlertsPage.deleteGroup(group);
    expect(result.failures).toEqual([
      { alertId: 'a2', worldId: 4031, worldName: '鳳凰' },
    ]);
  });

  test('calls onProgress after each deletion', async () => {
    API.deleteAlert.mockResolvedValue();
    const group = { worlds: [
      { alertId: 'a1', worldId: 4030, worldName: '利維坦' },
      { alertId: 'a2', worldId: 4031, worldName: '鳳凰' },
      { alertId: 'a3', worldId: 4032, worldName: '奧汀' },
    ] };
    const progressCalls = [];
    await AlertsPage.deleteGroup(group, (p) => progressCalls.push(p));
    expect(progressCalls).toEqual([
      { completed: 1, total: 3 },
      { completed: 2, total: 3 },
      { completed: 3, total: 3 },
    ]);
  });
});

describe('renderAlertsPanel — edit re-fetch failure', () => {
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'My Alert', discordWebhook: 'https://wh.com',
    triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };

  test('shows native alert when re-fetch fails on edit click', async () => {
    const container = createContainer();
    const nameMap = new Map([[44015, '木棉原木']]);
    AlertsPage.renderAlertsPanel([alert1], nameMap, container);

    // First getAlerts (edit click re-fetch) fails
    API.getAlerts.mockRejectedValue(new Error('Network error'));
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

    const editBtn = document.querySelector('#univ-alert-panel [data-action="edit"]');
    editBtn.click();
    await new Promise(r => setTimeout(r, 0));

    expect(alertSpy).toHaveBeenCalledWith('Failed to load alerts — check your connection');
    expect(Modal.openModal).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe('renderAlertsPanel — formatRule in table', () => {
  test('displays HQ badge for triggers with hq filter', () => {
    const container = createContainer();
    const hqAlert = { id: 'a1', itemId: 44015, worldId: 4030, name: 'HQ Alert', discordWebhook: 'https://wh.com',
      triggerVersion: 0, trigger: { filters: ['hq'], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 100 } } } };
    AlertsPage.renderAlertsPanel([hqAlert], new Map([[44015, '木棉原木']]), container);
    const panel = document.getElementById('univ-alert-panel');
    expect(panel.innerHTML).toContain('HQ');
  });

  test('displays gt comparator as >', () => {
    const container = createContainer();
    const gtAlert = { id: 'a1', itemId: 44015, worldId: 4030, name: 'GT Alert', discordWebhook: 'https://wh.com',
      triggerVersion: 0, trigger: { filters: [], mapper: 'quantity', reducer: 'max', comparison: { gt: { target: 500 } } } };
    AlertsPage.renderAlertsPanel([gtAlert], new Map([[44015, '木棉原木']]), container);
    const panel = document.getElementById('univ-alert-panel');
    expect(panel.textContent).toContain('>');
    expect(panel.textContent).toContain('500');
  });
});

describe('renderAlertsPanel — world name enrichment', () => {
  test('enriches group worlds with worldName from WorldMap', () => {
    const container = createContainer();
    const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com',
      triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };
    AlertsPage.renderAlertsPanel([alert1], new Map([[44015, '木棉原木']]), container);
    const panel = document.getElementById('univ-alert-panel');
    expect(panel.textContent).toContain('利維坦');
  });
});

describe('init — renders into <main> content div', () => {
  function setupAccountDOM() {
    document.body.innerHTML = `
      <main>
        <div><button>Account</button></div>
        <div id="content-div"><p>Native content</p></div>
      </main>`;
  }

  test('renders alerts panel into second div of <main>', async () => {
    setupAccountDOM();
    const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com',
      triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };
    API.getAlerts.mockResolvedValue([alert1]);
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body><a href="/market/44015">木棉原木</a></body></html>'),
    });

    AlertsPage.init();
    await new Promise(r => setTimeout(r, 0));

    const contentDiv = document.querySelector('main > div:nth-child(2)');
    expect(contentDiv.querySelector('#univ-alert-panel')).not.toBeNull();
    expect(contentDiv.textContent).toContain('木棉原木');
  });

  test('renders error into content div when getAlerts fails', async () => {
    setupAccountDOM();
    API.getAlerts.mockRejectedValue(new Error('fail'));
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body></body></html>'),
    });

    AlertsPage.init();
    await new Promise(r => setTimeout(r, 0));

    const contentDiv = document.querySelector('main > div:nth-child(2)');
    const errorEl = contentDiv.querySelector('[data-init-error]');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('Failed to load existing alerts');
  });

  test('does not hide native body content', async () => {
    setupAccountDOM();
    API.getAlerts.mockResolvedValue([]);
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body></body></html>'),
    });

    AlertsPage.init();
    await new Promise(r => setTimeout(r, 0));

    const navDiv = document.querySelector('main > div:first-child');
    expect(navDiv.style.display).not.toBe('none');
  });

  test('injectTab click triggers init — renders panel into content div', async () => {
    setupAccountDOM();
    window.history.pushState = jest.fn();
    const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com',
      triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body><a href="/market/44015">木棉原木</a></body></html>'),
    });
    API.getAlerts.mockResolvedValue([alert1]);

    AlertsPage.injectTab();
    const btn = document.querySelector('#univ-bulk-alerts-tab');
    btn.click();
    await new Promise(r => setTimeout(r, 0));

    const contentDiv = document.querySelector('main > div:nth-child(2)');
    expect(contentDiv.querySelector('#univ-alert-panel')).not.toBeNull();
  });

  test('waits for <main> with 2 child divs via MutationObserver', async () => {
    document.body.innerHTML = '<div>Loading...</div>';
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body></body></html>'),
    });
    API.getAlerts.mockResolvedValue([]);

    AlertsPage.init();

    // No panel yet
    expect(document.querySelector('#univ-alert-panel')).toBeNull();

    // Simulate SPA render — add <main> with 2 child divs
    const main = document.createElement('main');
    main.innerHTML = '<div><button>Account</button></div><div></div>';
    document.body.appendChild(main);

    await new Promise(r => setTimeout(r, 0));

    const contentDiv = main.querySelector(':scope > div:nth-child(2)');
    expect(contentDiv.querySelector('#univ-alert-panel')).not.toBeNull();
  });
});

describe('fetchItemNames', () => {
  test('parses item names from fetched /account/alerts HTML', async () => {
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body><a href="/market/44015">木棉原木</a><a href="/market/99">Other</a></body></html>'),
    });
    const map = await AlertsPage.fetchItemNames();
    expect(map.get(44015)).toBe('木棉原木');
    expect(map.get(99)).toBe('Other');
    expect(fetch).toHaveBeenCalledWith('/account/alerts');
  });

  test('returns empty Map when fetch fails', async () => {
    fetch.mockRejectedValue(new Error('Network error'));
    const map = await AlertsPage.fetchItemNames();
    expect(map.size).toBe(0);
  });

  test('returns empty Map when response has no market links', async () => {
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body><p>No alerts</p></body></html>'),
    });
    const map = await AlertsPage.fetchItemNames();
    expect(map.size).toBe(0);
  });

  test('returns empty Map when response is not ok', async () => {
    fetch.mockResolvedValue({ ok: false, status: 403 });
    const map = await AlertsPage.fetchItemNames();
    expect(map.size).toBe(0);
  });
});

describe('injectTab', () => {
  function setupAccountDOM() {
    document.body.innerHTML = `
      <main>
        <div id="nav-div"><button>Account</button><button>Alerts</button></div>
        <div id="content-div"><p>Page content</p></div>
      </main>`;
  }

  test('appends Bulk Alerts button to first div of <main>', () => {
    setupAccountDOM();
    AlertsPage.injectTab();
    const navDiv = document.querySelector('main > div:first-child');
    const btn = navDiv.querySelector('#univ-bulk-alerts-tab');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('Bulk Alerts');
  });

  test('is idempotent — second call does not duplicate button', () => {
    setupAccountDOM();
    AlertsPage.injectTab();
    AlertsPage.injectTab();
    const buttons = document.querySelectorAll('#univ-bulk-alerts-tab');
    expect(buttons).toHaveLength(1);
  });

  test('click calls history.pushState to /account/bulk-alerts', () => {
    setupAccountDOM();
    window.history.pushState = jest.fn();
    // Mock fetch and API.getAlerts so the init() triggered by click doesn't error
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<html><body></body></html>') });
    API.getAlerts.mockResolvedValue([]);

    AlertsPage.injectTab();
    const btn = document.querySelector('#univ-bulk-alerts-tab');
    btn.click();

    expect(window.history.pushState).toHaveBeenCalledWith({}, '', '/account/bulk-alerts');
  });

  test('waits for <main> via MutationObserver when not yet in DOM', async () => {
    document.body.innerHTML = '<div>Loading...</div>';
    AlertsPage.injectTab();
    // Not yet injected
    expect(document.querySelector('#univ-bulk-alerts-tab')).toBeNull();

    // Simulate SPA render — add <main> to DOM
    const main = document.createElement('main');
    main.innerHTML = '<div><button>Account</button></div><div></div>';
    document.body.appendChild(main);

    await new Promise(r => setTimeout(r, 0));

    expect(document.querySelector('#univ-bulk-alerts-tab')).not.toBeNull();
  });
});

describe('delete button — retry on partial failure', () => {
  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'My Alert', discordWebhook: 'https://wh.com',
    triggerVersion: 0, trigger };
  const alert2 = { ...alert1, id: 'a2', worldId: 4031 };
  const alert3 = { ...alert1, id: 'a3', worldId: 4032 };

  test('shows "Queued…" with reduced opacity immediately on delete click', () => {
    const container = createContainer();
    API.deleteAlert.mockReturnValue(new Promise(() => {})); // never resolves
    AlertsPage.renderAlertsPanel([alert1, alert2], new Map([[44015, '木棉原木']]), container);

    const deleteBtn = document.querySelector('[data-action="delete"]');
    deleteBtn.click();

    expect(deleteBtn.textContent).toBe('Queued\u2026');
    expect(deleteBtn.disabled).toBe(true);
    expect(deleteBtn.style.opacity).toBe('0.7');
  });

  test('shows "Retry (N remaining)" and updates pills on partial delete failure', async () => {
    const container = createContainer();
    // First delete succeeds, second fails, third fails
    API.deleteAlert
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('500'))
      .mockRejectedValueOnce(new Error('500'));

    AlertsPage.renderAlertsPanel([alert1, alert2, alert3], new Map([[44015, '木棉原木']]), container);

    const deleteBtn = document.querySelector('[data-action="delete"]');
    deleteBtn.click();
    await new Promise(r => setTimeout(r, 0));

    // Button should show retry text and be re-enabled
    expect(deleteBtn.textContent).toBe('Retry (2 remaining)');
    expect(deleteBtn.disabled).toBe(false);

    // World pills should only show the 2 failed worlds
    const row = deleteBtn.closest('tr');
    const pills = row.querySelectorAll('td:nth-child(3) span');
    expect(pills).toHaveLength(2);
  });

  test('removes row when all deletes succeed', async () => {
    const container = createContainer();
    API.deleteAlert.mockResolvedValue();

    AlertsPage.renderAlertsPanel([alert1, alert2], new Map([[44015, '木棉原木']]), container);

    const deleteBtn = document.querySelector('[data-action="delete"]');
    const row = deleteBtn.closest('tr');
    deleteBtn.click();
    await new Promise(r => setTimeout(r, 0));

    expect(row.parentNode).toBeNull(); // removed from DOM
  });
});
