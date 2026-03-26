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
  });

  test('Cancel navigates from form back to list when opened from list', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="new-alert"]').click();
    modal.querySelector('[data-action="cancel"]').click();
    expect(modal.querySelector('[data-action="new-alert"]')).not.toBeNull();
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
  });

  test('Cancel preserves capacity display when returning to list', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 12 });
    const modal = document.querySelector('#univ-alert-modal');
    expect(modal.textContent).toContain('Alert slots: 12 / 40 used');
    modal.querySelector('[data-action="new-alert"]').click();
    modal.querySelector('[data-action="cancel"]').click();
    expect(modal.textContent).toContain('Alert slots: 12 / 40 used');
  });

  test('Edit button navigates to form pre-filled with group data', () => {
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    const nameInput = modal.querySelector('[data-field="name"]');
    expect(nameInput.value).toBe('Alert');
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
    SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [{ worldId: 4031 }], deletesAfterSuccess: [] });
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
    modal.querySelector('[data-action="cancel"]').click();
    modal.querySelector('[data-action="delete"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(API.deleteAlert).toHaveBeenCalledTimes(1);
  });
});

describe('openBulkModal — duplicate alert detection', () => {
  test('shows "already exists" error when no ops are needed', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockResolvedValue([]);
    SaveOps.computeSaveOps.mockReturnValue({
      postsNeeded: [],
      deletesAfterSuccess: [],
      netChange: 0,
      capacityError: null,
    });

    Modal.openBulkModal({ groups: [], nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="save"]').click();
    await new Promise(r => setTimeout(r, 10));

    const errorArea = modal.querySelector('[data-error-area]');
    expect(errorArea.style.display).toBe('block');
    expect(errorArea.textContent).toContain('already exists on selected worlds');
    expect(errorArea.textContent).toContain('Min Price <');

    const saveBtn = modal.querySelector('[data-action="save"]');
    expect(saveBtn.disabled).toBe(false);
    expect(saveBtn.textContent).toBe('Save');

    expect(SaveOps.executeSaveOps).not.toHaveBeenCalled();
  });

  test('"New Alert" strips deletes so existing alerts are not removed', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockResolvedValue([]);
    // computeSaveOps returns both posts and deletes (as if editing)
    SaveOps.computeSaveOps.mockReturnValue({
      postsNeeded: [{ worldId: 4031 }],
      deletesAfterSuccess: [{ alertId: 'a1', worldId: 4030, worldName: '利維坦' }],
      netChange: 0,
      capacityError: null,
    });
    SaveOps.executeSaveOps.mockResolvedValue();
    API.getAlerts.mockResolvedValue([]);

    // Open with existing group, then click "New Alert" (not Edit)
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];
    Modal.openBulkModal({ groups, nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 1 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="new-alert"]').click();
    modal.querySelector('[data-action="save"]').click();
    await new Promise(r => setTimeout(r, 10));

    // executeSaveOps should have been called with deletes stripped
    const opsArg = SaveOps.executeSaveOps.mock.calls[0][0];
    expect(opsArg.postsNeeded).toHaveLength(1);
    expect(opsArg.deletesAfterSuccess).toHaveLength(0);
  });

  test('"New Alert" shows status banner when some worlds were skipped', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockResolvedValue([]);
    SaveOps.computeSaveOps.mockReturnValue({
      postsNeeded: [{ worldId: 4031 }],
      deletesAfterSuccess: [],
      skippedWorlds: [{ worldId: 4030, worldName: '利維坦' }],
      netChange: 1,
      capacityError: null,
    });
    SaveOps.executeSaveOps.mockResolvedValue();

    Modal.openBulkModal({ groups: [], nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="save"]').click();
    await new Promise(r => setTimeout(r, 10));

    const banner = modal.querySelector('[data-status-banner]');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('Skipped 1 world(s)');
    expect(banner.textContent).toContain('利維坦');
  });

  test('status banner is dismissed when cross is clicked', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockResolvedValue([]);
    SaveOps.computeSaveOps.mockReturnValue({
      postsNeeded: [{ worldId: 4031 }],
      deletesAfterSuccess: [],
      skippedWorlds: [{ worldId: 4030, worldName: '利維坦' }],
      netChange: 1,
      capacityError: null,
    });
    SaveOps.executeSaveOps.mockResolvedValue();

    Modal.openBulkModal({ groups: [], nameMap, currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="save"]').click();
    await new Promise(r => setTimeout(r, 10));

    expect(modal.querySelector('[data-status-banner]')).not.toBeNull();
    modal.querySelector('[data-action="dismiss-banner"]').click();
    expect(modal.querySelector('[data-status-banner]')).toBeNull();
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

describe('openBulkModal — item name resolution after save', () => {
  test('list view shows correct item name even when h1 was absent at open time', async () => {
    // Simulate SPA: <h1> is NOT rendered yet when modal opens
    // currentItemName is empty because detectPageContext found no <h1>
    GM_getValue.mockReturnValue('https://wh.com');

    const updatedAlert = {
      id: 'a1', itemId: 99999, worldId: 4030, name: 'NewAlert',
      discordWebhook: 'https://wh.com', triggerVersion: 0,
      trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 100 } } },
    };
    API.getAlerts.mockResolvedValue([updatedAlert]);
    SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [{ worldId: 4030 }], deletesAfterSuccess: [] });
    SaveOps.executeSaveOps.mockResolvedValue();

    // Open modal with empty currentItemName (h1 not rendered yet)
    const emptyNameMap = new Map();
    Modal.openBulkModal({ groups: [], nameMap: emptyNameMap, currentItemId: 99999, currentItemName: '', alertCount: 0 });

    // SPA now renders the <h1> (happens while user fills the form)
    document.body.insertAdjacentHTML('beforeend', '<h1>新アイテム</h1>');

    // User clicks Save
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="save"]').click();
    await new Promise(r => setTimeout(r, 0));

    // List view should show item name from the now-rendered <h1>, not "Item #99999"
    const listText = modal.textContent;
    expect(listText).toContain('新アイテム');
    expect(listText).not.toContain('Item #99999');
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
    // Cancel closes modal when there's no list to return to
    modal.querySelector('[data-action="cancel"]').click();
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
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
