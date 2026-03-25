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

describe('openBulkModal — routing', () => {
  test('opens to form view when groups is empty', () => {
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups: [] });
    const modal = document.querySelector('#univ-alert-modal');
    expect(modal).not.toBeNull();
    // Form view has a form with data-field="name"
    expect(modal.querySelector('[data-field="name"]')).not.toBeNull();
    // Should NOT have the list view elements
    expect(modal.querySelector('[data-action="new-alert"]')).toBeNull();
  });

  test('opens to list view when groups is non-empty', () => {
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const modal = document.querySelector('#univ-alert-modal');
    expect(modal).not.toBeNull();
    // List view has "New Alert" button
    expect(modal.querySelector('[data-action="new-alert"]')).not.toBeNull();
    // Should NOT have the form fields
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
  });
});

describe('openBulkModal — navigation', () => {
  const groups = [{
    itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
    worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
  }];

  test('"New Alert" navigates from list to blank form', () => {
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="new-alert"]').click();
    // Should now show form
    expect(modal.querySelector('[data-field="name"]')).not.toBeNull();
    // Should have back link
    expect(modal.querySelector('[data-action="back"]')).not.toBeNull();
  });

  test('"← Back to alerts" navigates from form to list', () => {
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const modal = document.querySelector('#univ-alert-modal');
    // Navigate to form
    modal.querySelector('[data-action="new-alert"]').click();
    expect(modal.querySelector('[data-field="name"]')).not.toBeNull();
    // Click back
    modal.querySelector('[data-action="back"]').click();
    // Should show list again
    expect(modal.querySelector('[data-action="new-alert"]')).not.toBeNull();
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
  });

  test('Edit button navigates to form pre-filled with group data', () => {
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    // Should show form with group's name pre-filled
    const nameInput = modal.querySelector('[data-field="name"]');
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('Alert');
    // Should have back link
    expect(modal.querySelector('[data-action="back"]')).not.toBeNull();
  });

  test('close button dismisses the modal', () => {
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="close"]').click();
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('Escape dismisses the modal', () => {
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    expect(document.querySelector('#univ-alert-modal')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('overlay background click dismisses the modal', () => {
    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const overlay = document.querySelector('#univ-alert-modal');
    expect(overlay).not.toBeNull();
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });
});

describe('openBulkModal — form save returns to list', () => {
  test('after save, re-fetches and shows updated list view', async () => {
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];

    // After save, getAlerts returns updated alerts
    const updatedAlert = { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0, trigger };
    const newAlert = { id: 'a3', itemId: 44015, worldId: 4031, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0, trigger };
    API.getAlerts.mockResolvedValue([updatedAlert, newAlert]);
    SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [], deletesAfterSuccess: [] });
    SaveOps.executeSaveOps.mockResolvedValue();
    GM_getValue.mockReturnValue('https://wh.com');

    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const modal = document.querySelector('#univ-alert-modal');

    // Navigate to form via "New Alert"
    modal.querySelector('[data-action="new-alert"]').click();

    // Click save
    const saveBtn = modal.querySelector('[data-action="save"]');
    saveBtn.click();
    await new Promise(r => setTimeout(r, 0));

    // Should return to list view with updated data
    expect(modal.querySelector('[data-action="new-alert"]')).not.toBeNull();
    expect(modal.querySelector('[data-field="name"]')).toBeNull();
  });
});

describe('openBulkModal — delete last group transitions to form', () => {
  test('transitions to blank form when last group is deleted', async () => {
    API.deleteAlert.mockResolvedValue();
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];

    Modal.openBulkModal({ itemId: 44015, itemName: '木棉原木', groups });
    const modal = document.querySelector('#univ-alert-modal');

    // Delete the only group
    modal.querySelector('[data-action="delete"]').click();
    await new Promise(r => setTimeout(r, 0));

    // Should transition to form view (blank)
    expect(modal.querySelector('[data-field="name"]')).not.toBeNull();
    // Should NOT have back link (no list to go back to)
    expect(modal.querySelector('[data-action="back"]')).toBeNull();
  });
});
