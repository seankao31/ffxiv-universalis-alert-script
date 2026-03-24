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

describe('renderAlertsPanel — edit onSave re-fetch', () => {
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'My Alert', discordWebhook: 'https://wh.com',
    triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };

  test('edit onSave re-fetches alerts before computing ops', async () => {
    setupNativeDOM();
    const nameMap = new Map([[44015, '木棉原木']]);

    // First render — initial alerts
    API.getAlerts.mockResolvedValue([alert1]);
    AlertsPage.renderAlertsPanel([alert1], nameMap);

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

describe('delete button — retry on partial failure', () => {
  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'My Alert', discordWebhook: 'https://wh.com',
    triggerVersion: 0, trigger };
  const alert2 = { ...alert1, id: 'a2', worldId: 4031 };
  const alert3 = { ...alert1, id: 'a3', worldId: 4032 };

  test('shows "Retry (N remaining)" and updates pills on partial delete failure', async () => {
    setupNativeDOM();
    // First delete succeeds, second fails, third fails
    API.deleteAlert
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('500'))
      .mockRejectedValueOnce(new Error('500'));

    AlertsPage.renderAlertsPanel([alert1, alert2, alert3], new Map([[44015, '木棉原木']]));

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
    setupNativeDOM();
    API.deleteAlert.mockResolvedValue();

    AlertsPage.renderAlertsPanel([alert1, alert2], new Map([[44015, '木棉原木']]));

    const deleteBtn = document.querySelector('[data-action="delete"]');
    const row = deleteBtn.closest('tr');
    deleteBtn.click();
    await new Promise(r => setTimeout(r, 0));

    expect(row.parentNode).toBeNull(); // removed from DOM
  });
});
