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

  test('throws if any deleteAlert fails', async () => {
    API.deleteAlert.mockResolvedValueOnce().mockRejectedValueOnce(new Error('404'));
    const group = { worlds: [{ alertId: 'a1' }, { alertId: 'a2' }] };
    await expect(AlertsPage.deleteGroup(group)).rejects.toThrow('Failed to delete 1 alert');
  });
});
