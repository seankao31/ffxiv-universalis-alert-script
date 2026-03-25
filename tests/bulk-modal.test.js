const Modal = require('../src/modal');

global.API = { getAlerts: jest.fn(), deleteAlert: jest.fn(), createAlert: jest.fn() };
global.Grouping = require('../src/grouping');
global.SaveOps = { computeSaveOps: jest.fn(), executeSaveOps: jest.fn() };
global.WorldMap = require('../src/worldmap');

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
  GM_getValue.mockReset();
  GM_setValue.mockReset();
});

const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
const nameMap = new Map([[44015, '木棉原木']]);

describe('openBulkModal — routing', () => {
  test('opens to form view when groups is empty and currentItemId is set', () => {
    Modal.openBulkModal({ groups: [], nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    expect(modal.querySelector('[data-field="name"]')).not.toBeNull();
    expect(modal.querySelector('[data-action="new-alert"]')).toBeNull();
  });

  test('opens to list view with empty state when groups is empty and no currentItemId', () => {
    Modal.openBulkModal({ groups: [], nameMap, currentItemId: null, currentItemName: null, alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
    expect(modal.textContent).toContain('No alerts yet');
  });

  test('opens to list view when groups is non-empty', () => {
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    expect(modal.querySelector('[data-action="new-alert"]')).not.toBeNull();
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
  });
});

describe('openBulkModal — navigation', () => {
  const groups = [{
    itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
    worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
  }];

  test('"New Alert" navigates from list to blank form', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="new-alert"]').click();
    expect(modal.querySelector('[data-field="name"]')).not.toBeNull();
    expect(modal.querySelector('[data-action="back"]')).not.toBeNull();
  });

  test('"← Back to alerts" navigates from form to list', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="new-alert"]').click();
    modal.querySelector('[data-action="back"]').click();
    expect(modal.querySelector('[data-action="new-alert"]')).not.toBeNull();
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
  });

  test('Edit button navigates to form pre-filled with group data', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    const nameInput = modal.querySelector('[data-field="name"]');
    expect(nameInput.value).toBe('Alert');
    expect(modal.querySelector('[data-action="back"]')).not.toBeNull();
  });

  test('Edit resolves itemId/itemName from the group via nameMap', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: null, currentItemName: null, alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    // Form header should show item name from nameMap
    expect(modal.querySelector('h3').textContent).toContain('木棉原木');
  });

  test('close button dismisses the modal', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    document.querySelector('#univ-alert-modal [data-action="close"]').click();
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('Escape dismisses the modal', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('overlay background click dismisses the modal', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const overlay = document.querySelector('#univ-alert-modal');
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });
});

describe('openBulkModal — form save returns to list', () => {
  test('after save, re-fetches all alerts and shows updated list view', async () => {
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];

    const updatedAlert = { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0, trigger };
    const newAlert = { id: 'a3', itemId: 44015, worldId: 4031, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0, trigger };
    API.getAlerts.mockResolvedValue([updatedAlert, newAlert]);
    SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [], deletesAfterSuccess: [] });
    SaveOps.executeSaveOps.mockResolvedValue();
    GM_getValue.mockReturnValue('https://wh.com');

    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="new-alert"]').click();
    modal.querySelector('[data-action="save"]').click();
    await new Promise(r => setTimeout(r, 0));

    expect(modal.querySelector('[data-action="new-alert"]')).not.toBeNull();
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
  });
});

describe('openBulkModal — no duplicate deletes after navigation', () => {
  test('delete after list→form→back does not fire duplicate API calls', async () => {
    API.deleteAlert.mockResolvedValue();
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];

    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="new-alert"]').click();
    modal.querySelector('[data-action="back"]').click();
    modal.querySelector('[data-action="delete"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(API.deleteAlert).toHaveBeenCalledTimes(1);
  });
});

describe('openBulkModal — capacity error on save', () => {
  test('shows capacityError and keeps Save enabled when capacity exceeded', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockResolvedValue([]);
    SaveOps.computeSaveOps.mockReturnValue({
      postsNeeded: [{ worldId: 4028 }],
      deletesAfterSuccess: [],
      netChange: 1,
      capacityError: 'Not enough alert slots (need 1, only 0 available)',
    });

    Modal.openBulkModal({ groups: [], nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="save"]').click();
    await new Promise(r => setTimeout(r, 10));

    const errorArea = modal.querySelector('[data-error-area]');
    expect(errorArea.style.display).toBe('block');
    expect(errorArea.textContent).toContain('Not enough alert slots');

    const saveBtn = modal.querySelector('[data-action="save"]');
    expect(saveBtn.disabled).toBe(false);
    expect(saveBtn.textContent).toBe('Save');

    // executeSaveOps should NOT have been called
    expect(SaveOps.executeSaveOps).not.toHaveBeenCalled();
  });
});

describe('openBulkModal — Retry on execution failure', () => {
  test('changes Save button to Retry after executeSaveOps failure', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockResolvedValue([]);
    SaveOps.computeSaveOps.mockReturnValue({
      postsNeeded: [{ worldId: 4028 }],
      deletesAfterSuccess: [],
      netChange: 1,
      capacityError: null,
    });
    SaveOps.executeSaveOps.mockRejectedValue(new Error('Failed to save alerts for: 伊弗利特'));

    Modal.openBulkModal({ groups: [], nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="save"]').click();
    await new Promise(r => setTimeout(r, 10));

    const saveBtn = modal.querySelector('[data-action="save"]');
    expect(saveBtn.textContent).toBe('Retry');
    expect(saveBtn.disabled).toBe(false);

    const errorArea = modal.querySelector('[data-error-area]');
    expect(errorArea.textContent).toContain('Failed to save alerts');
  });
});

describe('openBulkModal — delete last group', () => {
  test('transitions to form view when last group deleted and currentItemId set', async () => {
    API.deleteAlert.mockResolvedValue();
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];

    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="delete"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(modal.querySelector('[data-field="name"]')).not.toBeNull();
    expect(modal.querySelector('[data-action="back"]')).toBeNull();
  });

  test('shows empty state when last group deleted and no currentItemId', async () => {
    API.deleteAlert.mockResolvedValue();
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];

    Modal.openBulkModal({ groups, nameMap, currentItemId: null, currentItemName: null, alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="delete"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
    expect(modal.textContent).toContain('No alerts yet');
  });
});
