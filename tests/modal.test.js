// tests/modal.test.js
const Modal = require('../src/modal');

// GM stubs are in tests/setup.js
// Re-assign per test as needed
beforeEach(() => {
  document.body.innerHTML = '';
  jest.resetAllMocks();
  GM_getValue.mockReset();
  GM_setValue.mockReset();
});

global.API = { getAlerts: jest.fn(), deleteAlert: jest.fn(), createAlert: jest.fn() };
global.Grouping = require('../src/grouping');
global.SaveOps = { computeSaveOps: jest.fn(), executeSaveOps: jest.fn() };
global.WorldMap = require('../src/worldmap');

describe('openBulkModal — DOM structure', () => {
  test('injects a modal overlay into document.body', () => {
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, '木棉原木']]), currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    expect(document.querySelector('#univ-alert-modal')).not.toBeNull();
  });

  test('renders chips for all 8 陸行鳥 worlds', () => {
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, '木棉原木']]), currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const chips = document.querySelectorAll('#univ-alert-modal [data-world-id]');
    expect(chips).toHaveLength(8);
  });

  test('Save button is disabled when webhook field is empty', () => {
    GM_getValue.mockReturnValue(undefined);
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const saveBtn = document.querySelector('#univ-alert-modal [data-action="save"]');
    expect(saveBtn.disabled).toBe(true);
  });
});

describe('openBulkModal — webhook auto-populate', () => {
  const makeGroup = (webhook) => ({
    itemId: 44015, name: 'Test', trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } },
    worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦', discordWebhook: webhook }],
    discordWebhook: webhook,
  });

  test('priority 1: uses webhook from existing group when present', () => {
    GM_getValue.mockReturnValue('https://gm-stored.com');
    const group = makeGroup('https://from-alert.com');
    Modal.openBulkModal({ groups: [group], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    const webhookInput = document.querySelector('#univ-alert-modal input[data-field="webhook"]');
    expect(webhookInput.value).toBe('https://from-alert.com');
  });

  test('priority 2: falls back to GM_getValue when group has no webhook', () => {
    GM_getValue.mockReturnValue('https://gm-stored.com');
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const webhookInput = document.querySelector('#univ-alert-modal input[data-field="webhook"]');
    expect(webhookInput.value).toBe('https://gm-stored.com');
  });

  test('priority 3: empty when no group and no GM value', () => {
    GM_getValue.mockReturnValue(undefined);
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const webhookInput = document.querySelector('#univ-alert-modal input[data-field="webhook"]');
    expect(webhookInput.value).toBe('');
  });
});

describe('openBulkModal — pre-population from group', () => {
  const group = {
    itemId: 44015, name: 'My Alert',
    trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } },
    discordWebhook: 'https://wh.com',
    worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
  };

  test('pre-selects world chips for worlds in existing group', () => {
    Modal.openBulkModal({ groups: [group], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    const chip4030 = document.querySelector('#univ-alert-modal [data-world-id="4030"]');
    const chip4031 = document.querySelector('#univ-alert-modal [data-world-id="4031"]');
    expect(chip4030.dataset.selected).toBe('true');
    expect(chip4031.dataset.selected).toBe('false');
  });

  test('pre-fills alert name with group name', () => {
    Modal.openBulkModal({ groups: [group], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    const nameInput = document.querySelector('#univ-alert-modal input[data-field="name"]');
    expect(nameInput.value).toBe('My Alert');
  });

  test('falls back to itemName for alert name when group is null', () => {
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, '木棉原木']]), currentItemId: 44015, currentItemName: '木棉原木', alertCount: 0 });
    const nameInput = document.querySelector('#univ-alert-modal input[data-field="name"]');
    expect(nameInput.value).toBe('木棉原木');
  });
});


describe('openBulkModal — save progress', () => {
  test('shows status element and updates button text during save', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockResolvedValue([]);
    SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [{ worldId: 4028 }], deletesAfterSuccess: [] });
    SaveOps.executeSaveOps.mockReturnValue(new Promise(() => {})); // never resolves — keeps modal open

    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });

    const saveBtn = document.querySelector('#univ-alert-modal [data-action="save"]');
    const statusEl = document.querySelector('#univ-alert-modal [data-status]');

    // Trigger the full save chain: getAlerts → computeSaveOps → executeSaveOps
    // executeSaveOps never resolves so the modal stays open
    // But onProgress is passed to executeSaveOps — we call it manually via mockImplementation
    SaveOps.executeSaveOps.mockImplementation(async (ops, itemId, formState, { onProgress }) => {
      onProgress({ phase: 'creating', completed: 1, total: 3 });
      return new Promise(() => {}); // never resolves
    });

    saveBtn.click();
    await new Promise(r => setTimeout(r, 0)); // flush microtasks

    expect(saveBtn.textContent).toBe('Saving...');
    expect(saveBtn.disabled).toBe(true);

    await new Promise(r => setTimeout(r, 0)); // allow onProgress to fire

    expect(statusEl.style.display).toBe('block');
    expect(statusEl.textContent).toBe('Creating alert 1 of 3...');
  });

  test('displays "Refreshing state..." for refreshing phase', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockImplementation(() => new Promise(() => {})); // stalls at refreshing phase

    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });

    const saveBtn = document.querySelector('#univ-alert-modal [data-action="save"]');
    const statusEl = document.querySelector('#univ-alert-modal [data-status]');
    saveBtn.click();
    await new Promise(r => setTimeout(r, 0)); // flush — onProgress({ phase: 'refreshing' }) fires immediately

    expect(statusEl.style.display).toBe('block');
    expect(statusEl.textContent).toBe('Refreshing state...');
  });

  test('hides status and restores button on save error', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockResolvedValue([]);
    SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [{ worldId: 4028 }], deletesAfterSuccess: [] });
    SaveOps.executeSaveOps.mockRejectedValue(new Error('Save failed'));

    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });

    const saveBtn = document.querySelector('#univ-alert-modal [data-action="save"]');
    saveBtn.click();
    await new Promise(r => setTimeout(r, 10));

    const statusEl = document.querySelector('#univ-alert-modal [data-status]');
    const errorArea = document.querySelector('#univ-alert-modal [data-error-area]');

    expect(statusEl.style.display).toBe('none');
    expect(errorArea.style.display).toBe('block');
    expect(errorArea.textContent).toBe('Save failed');
    expect(saveBtn.textContent).toBe('Retry');
    expect(saveBtn.disabled).toBe(false);
  });
});

describe('modal dismiss — Escape and overlay click', () => {
  test('closes modal on Escape key press', () => {
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    expect(document.querySelector('#univ-alert-modal')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('closes modal when clicking overlay background', () => {
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const overlay = document.querySelector('#univ-alert-modal');
    expect(overlay).not.toBeNull();
    // Click the overlay itself (not the inner container)
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('does NOT close modal when clicking inside the form container', () => {
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const innerContainer = document.querySelector('#univ-alert-modal > div');
    innerContainer.dispatchEvent(new MouseEvent('click', { bubbles: false }));
    expect(document.querySelector('#univ-alert-modal')).not.toBeNull();
  });
});

describe('formatRule', () => {
  test('formats a basic trigger with lt comparator', () => {
    const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
    const result = Modal.formatRule(trigger);
    expect(result).toContain('Min');
    expect(result).toContain('Price');
    expect(result).toContain('<');
    expect(result).toContain('130');
  });

  test('formats a trigger with gt comparator', () => {
    const trigger = { filters: [], mapper: 'quantity', reducer: 'max', comparison: { gt: { target: 500 } } };
    const result = Modal.formatRule(trigger);
    expect(result).toContain('Max');
    expect(result).toContain('>');
    expect(result).toContain('500');
  });

  test('includes HQ badge when filters contain hq', () => {
    const trigger = { filters: ['hq'], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
    const result = Modal.formatRule(trigger);
    expect(result).toContain('HQ');
  });
});

describe('renderListView', () => {
  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
  const trigger2 = { filters: [], mapper: 'quantity', reducer: 'max', comparison: { gt: { target: 500 } } };
  const nameMap = new Map([[44015, '木棉原木'], [12345, '鐵礦石']]);

  const groups = [{
    itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
    worlds: [
      { worldId: 4030, alertId: 'a1', worldName: '利維坦' },
      { worldId: 4031, alertId: 'a2', worldName: '鳳凰' },
    ],
  }];

  test('renders one row per alert group', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    expect(container.querySelectorAll('[data-group-row]')).toHaveLength(1);
  });

  test('renders world pills for each group', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    const pills = container.querySelectorAll('[data-group-row="0"] [data-world-pill]');
    expect(pills).toHaveLength(2);
    expect(pills[0].textContent).toBe('利維坦');
    expect(pills[1].textContent).toBe('鳳凰');
  });

  test('renders Edit and Delete buttons per group', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    expect(container.querySelector('[data-action="edit"]')).not.toBeNull();
    expect(container.querySelector('[data-action="delete"]')).not.toBeNull();
  });

  test('renders item name and ID from nameMap', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    const row = container.querySelector('[data-group-row="0"]');
    expect(row.textContent).toContain('木棉原木');
    expect(row.textContent).toContain('#44015');
  });

  test('falls back to Item #ID when nameMap has no entry', () => {
    const container = document.createElement('div');
    const unknownGroups = [{ ...groups[0], itemId: 99999 }];
    Modal.renderListView(container, { groups: unknownGroups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    const row = container.querySelector('[data-group-row="0"]');
    expect(row.textContent).toContain('Item #99999');
  });

  test('sorts groups by itemId so same-item alerts cluster together', () => {
    const container = document.createElement('div');
    const mixedGroups = [
      { itemId: 44015, name: 'A2', discordWebhook: 'https://wh.com', trigger: trigger2, worlds: [{ worldId: 4030, alertId: 'a3', worldName: '利維坦' }] },
      { itemId: 12345, name: 'A1', discordWebhook: 'https://wh.com', trigger, worlds: [{ worldId: 4030, alertId: 'a4', worldName: '利維坦' }] },
      { itemId: 44015, name: 'A3', discordWebhook: 'https://wh.com', trigger, worlds: [{ worldId: 4031, alertId: 'a5', worldName: '鳳凰' }] },
    ];
    Modal.renderListView(container, { groups: mixedGroups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    const rows = container.querySelectorAll('[data-group-row]');
    expect(rows).toHaveLength(3);
    // itemId 12345 first, then two 44015 rows
    expect(rows[0].textContent).toContain('鐵礦石');
    expect(rows[1].textContent).toContain('木棉原木');
    expect(rows[2].textContent).toContain('木棉原木');
  });

  test('header says "Bulk Alerts" without item-specific suffix', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    const header = container.querySelector('h3');
    expect(header.textContent).toBe('Bulk Alerts');
  });

  test('"New Alert" button is enabled when newAlertDisabled is false', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    const btn = container.querySelector('[data-action="new-alert"]');
    expect(btn.disabled).toBe(false);
  });

  test('"New Alert" button is disabled with tooltip when newAlertDisabled is true', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: true });
    const btn = container.querySelector('[data-action="new-alert"]');
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Navigate to an item page to create alerts');
  });

  test('renders formatted rule text', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    expect(container.textContent).toContain('Min');
    expect(container.textContent).toContain('<');
    expect(container.textContent).toContain('130');
  });

  test('"New Alert" button calls onNew callback', () => {
    const container = document.createElement('div');
    const onNew = jest.fn();
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew, onClose: jest.fn(), newAlertDisabled: false });
    container.querySelector('[data-action="new-alert"]').click();
    expect(onNew).toHaveBeenCalled();
  });

  test('"New Alert" button does not call onNew when newAlertDisabled is true', () => {
    const container = document.createElement('div');
    const onNew = jest.fn();
    Modal.renderListView(container, { groups, nameMap, onEdit: jest.fn(), onDelete: jest.fn(), onNew, onClose: jest.fn(), newAlertDisabled: true });
    container.querySelector('[data-action="new-alert"]').click();
    expect(onNew).not.toHaveBeenCalled();
  });

  test('Edit button calls onEdit with the group', () => {
    const container = document.createElement('div');
    const onEdit = jest.fn();
    Modal.renderListView(container, { groups, nameMap, onEdit, onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });
    container.querySelector('[data-action="edit"]').click();
    expect(onEdit).toHaveBeenCalledWith(groups[0]);
  });
});

describe('list view — delete behavior', () => {
  beforeAll(() => {
    global.API = { getAlerts: jest.fn(), deleteAlert: jest.fn(), createAlert: jest.fn() };
  });

  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };

  test('removes row on successful delete', async () => {
    API.deleteAlert.mockResolvedValue();
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];
    const container = document.createElement('div');
    const onDelete = jest.fn();
    Modal.renderListView(container, { groups, nameMap: new Map([[44015, 'Item']]), onEdit: jest.fn(), onDelete: (group, idx, btn) => {
      Modal.handleListDelete(group, idx, btn, container, jest.fn());
    }, onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });

    const deleteBtn = container.querySelector('[data-action="delete"]');
    deleteBtn.click();
    await new Promise(r => setTimeout(r, 0));

    expect(container.querySelector('[data-group-row="0"]')).toBeNull();
  });

  test('shows retry text on partial failure', async () => {
    API.deleteAlert.mockResolvedValueOnce().mockRejectedValueOnce(new Error('500'));
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [
        { worldId: 4030, alertId: 'a1', worldName: '利維坦' },
        { worldId: 4031, alertId: 'a2', worldName: '鳳凰' },
      ],
    }];
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap: new Map([[44015, 'Item']]), onEdit: jest.fn(), onDelete: (group, idx, btn) => {
      Modal.handleListDelete(group, idx, btn, container, jest.fn());
    }, onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });

    const deleteBtn = container.querySelector('[data-action="delete"]');
    deleteBtn.click();
    await new Promise(r => setTimeout(r, 0));

    expect(deleteBtn.textContent).toBe('Retry (1 remaining)');
    expect(deleteBtn.disabled).toBe(false);
    // World pills should only show the failed world
    const pills = container.querySelectorAll('[data-group-row="0"] [data-world-pill]');
    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toBe('鳳凰');
  });
});

describe('list view — queued state', () => {
  beforeAll(() => {
    global.API = { getAlerts: jest.fn(), deleteAlert: jest.fn(), createAlert: jest.fn() };
  });

  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };

  test('shows "Queued…" with reduced opacity immediately on delete click', () => {
    API.deleteAlert.mockReturnValue(new Promise(() => {})); // never resolves
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap: new Map([[44015, 'Item']]), onEdit: jest.fn(), onDelete: (group, idx, btn) => {
      Modal.handleListDelete(group, idx, btn, container, jest.fn());
    }, onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });

    const deleteBtn = container.querySelector('[data-action="delete"]');
    deleteBtn.click();

    expect(deleteBtn.textContent).toBe('Queued\u2026');
    expect(deleteBtn.disabled).toBe(true);
    expect(deleteBtn.style.opacity).toBe('0.7');
  });

  // Opacity restore on the success path can't be asserted because the row is removed
  // before the intermediate opacity='1' state is observable. The partial-failure test
  // below covers the opacity restore logic.
  test('opacity restores on retry after partial failure', async () => {
    API.deleteAlert.mockRejectedValue(new Error('500'));
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];
    const container = document.createElement('div');
    Modal.renderListView(container, { groups, nameMap: new Map([[44015, 'Item']]), onEdit: jest.fn(), onDelete: (group, idx, btn) => {
      Modal.handleListDelete(group, idx, btn, container, jest.fn());
    }, onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false });

    const deleteBtn = container.querySelector('[data-action="delete"]');
    deleteBtn.click();
    await new Promise(r => setTimeout(r, 0));

    expect(deleteBtn.textContent).toBe('Retry (1 remaining)');
    expect(deleteBtn.style.opacity).toBe('1');
  });
});

describe('list view — no duplicate handlers after re-render', () => {
  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };

  test('re-rendering list view on same container does not stack click handlers', () => {
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];
    const container = document.createElement('div');
    const onDelete = jest.fn();
    const opts = { groups, nameMap: new Map([[44015, 'Item']]), onEdit: jest.fn(), onDelete, onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false };

    // Render twice on same container (simulates list → form → back → list)
    Modal.renderListView(container, opts);
    Modal.renderListView(container, opts);

    container.querySelector('[data-action="delete"]').click();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  test('three renders still produces single handler', () => {
    const groups = [{
      itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
      worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
    }];
    const container = document.createElement('div');
    const onDelete = jest.fn();
    const opts = { groups, nameMap: new Map([[44015, 'Item']]), onEdit: jest.fn(), onDelete, onNew: jest.fn(), onClose: jest.fn(), newAlertDisabled: false };

    Modal.renderListView(container, opts);
    Modal.renderListView(container, opts);
    Modal.renderListView(container, opts);

    container.querySelector('[data-action="delete"]').click();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('closeModal', () => {
  test('removes modal from DOM', () => {
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    Modal.closeModal();
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('cleans up Escape keydown listener after close', () => {
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    Modal.closeModal();
    // Pressing Escape after close should not throw or cause issues
    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }).not.toThrow();
  });
});

describe('renderFormView — Select All / Clear All buttons', () => {
  test('Select All selects all world chips', () => {
    GM_getValue.mockReturnValue('https://wh.com');
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    // Clear all first so we can verify Select All works
    document.querySelector('#univ-alert-modal [data-action="clear-all"]').click();
    const chips = document.querySelectorAll('#univ-alert-modal [data-world-id]');
    chips.forEach(chip => expect(chip.dataset.selected).toBe('false'));

    document.querySelector('#univ-alert-modal [data-action="select-all"]').click();
    chips.forEach(chip => expect(chip.dataset.selected).toBe('true'));
  });

  test('Clear All deselects all world chips', () => {
    GM_getValue.mockReturnValue('https://wh.com');
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    // All should be selected by default for new alerts
    const chips = document.querySelectorAll('#univ-alert-modal [data-world-id]');
    chips.forEach(chip => expect(chip.dataset.selected).toBe('true'));

    document.querySelector('#univ-alert-modal [data-action="clear-all"]').click();
    chips.forEach(chip => expect(chip.dataset.selected).toBe('false'));
  });
});

describe('renderFormView — webhook input toggles Save button', () => {
  test('typing a webhook enables the Save button', () => {
    GM_getValue.mockReturnValue(undefined); // no saved webhook
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const saveBtn = document.querySelector('#univ-alert-modal [data-action="save"]');
    const webhookInput = document.querySelector('#univ-alert-modal [data-field="webhook"]');
    expect(saveBtn.disabled).toBe(true);

    webhookInput.value = 'https://discord.com/api/webhooks/123';
    webhookInput.dispatchEvent(new Event('input'));
    expect(saveBtn.disabled).toBe(false);
  });

  test('clearing the webhook disables the Save button', () => {
    GM_getValue.mockReturnValue('https://wh.com');
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const saveBtn = document.querySelector('#univ-alert-modal [data-action="save"]');
    const webhookInput = document.querySelector('#univ-alert-modal [data-field="webhook"]');
    expect(saveBtn.disabled).toBe(false);

    webhookInput.value = '';
    webhookInput.dispatchEvent(new Event('input'));
    expect(saveBtn.disabled).toBe(true);
  });
});

describe('renderFormView — Cancel button', () => {
  test('Cancel button closes the modal', () => {
    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    expect(document.querySelector('#univ-alert-modal')).not.toBeNull();
    document.querySelector('#univ-alert-modal [data-action="cancel"]').click();
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });
});

describe('renderFormView — trigger field pre-population from group', () => {
  const group = {
    itemId: 44015, name: 'My Alert',
    trigger: { filters: ['hq'], mapper: 'quantity', reducer: 'max', comparison: { gt: { target: 500 } } },
    discordWebhook: 'https://wh.com',
    worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
  };

  test('pre-selects mapper from existing group trigger', () => {
    Modal.openBulkModal({ groups: [group], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    const mapper = document.querySelector('#univ-alert-modal [data-field="mapper"]');
    expect(mapper.value).toBe('quantity');
  });

  test('pre-selects reducer from existing group trigger', () => {
    Modal.openBulkModal({ groups: [group], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    const reducer = document.querySelector('#univ-alert-modal [data-field="reducer"]');
    expect(reducer.value).toBe('max');
  });

  test('pre-selects comparator from existing group trigger', () => {
    Modal.openBulkModal({ groups: [group], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    const comparator = document.querySelector('#univ-alert-modal [data-field="comparator"]');
    expect(comparator.value).toBe('gt');
  });

  test('pre-fills target value from existing group trigger', () => {
    Modal.openBulkModal({ groups: [group], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    const target = document.querySelector('#univ-alert-modal [data-field="target"]');
    expect(target.value).toBe('500');
  });

  test('pre-checks HQ checkbox when trigger has hq filter', () => {
    Modal.openBulkModal({ groups: [group], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    const hq = document.querySelector('#univ-alert-modal [data-field="hq"]');
    expect(hq.checked).toBe(true);
  });

  test('HQ checkbox is unchecked when trigger has no hq filter', () => {
    const noHqGroup = {
      ...group,
      trigger: { ...group.trigger, filters: [] },
    };
    Modal.openBulkModal({ groups: [noHqGroup], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });
    const modal = document.querySelector('#univ-alert-modal');
    modal.querySelector('[data-action="edit"]').click();
    const hq = document.querySelector('#univ-alert-modal [data-field="hq"]');
    expect(hq.checked).toBe(false);
  });
});

describe('renderFormView — Save builds trigger from form and saves webhook', () => {
  test('SaveOps.computeSaveOps receives trigger built from form fields', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockResolvedValue([]);
    SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [{ worldId: 4028 }], deletesAfterSuccess: [] });
    SaveOps.executeSaveOps.mockResolvedValue();
    API.getAlerts.mockResolvedValue([]); // called again after save

    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });

    // Set form fields
    document.querySelector('#univ-alert-modal [data-field="mapper"]').value = 'total';
    document.querySelector('#univ-alert-modal [data-field="reducer"]').value = 'mean';
    document.querySelector('#univ-alert-modal [data-field="comparator"]').value = 'gt';
    document.querySelector('#univ-alert-modal [data-field="target"]').value = '999';
    document.querySelector('#univ-alert-modal [data-field="hq"]').checked = true;

    document.querySelector('#univ-alert-modal [data-action="save"]').click();
    await new Promise(r => setTimeout(r, 10));

    const formState = SaveOps.computeSaveOps.mock.calls[0][1];
    expect(formState.trigger).toEqual({
      filters: ['hq'],
      mapper: 'total',
      reducer: 'mean',
      comparison: { gt: { target: 999 } },
    });
  });

  test('SaveOps.computeSaveOps receives alert name and selected world IDs', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockResolvedValue([]);
    SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [{ worldId: 4028 }], deletesAfterSuccess: [] });
    SaveOps.executeSaveOps.mockResolvedValue();

    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });

    document.querySelector('#univ-alert-modal [data-field="name"]').value = 'Custom Name';
    // Clear all, then select just one world
    document.querySelector('#univ-alert-modal [data-action="clear-all"]').click();
    document.querySelector('#univ-alert-modal [data-world-id="4030"]').dataset.selected = 'true';

    document.querySelector('#univ-alert-modal [data-action="save"]').click();
    await new Promise(r => setTimeout(r, 10));

    const formState = SaveOps.computeSaveOps.mock.calls[0][1];
    expect(formState.name).toBe('Custom Name');
    expect(formState.selectedWorldIds).toEqual(new Set([4030]));
    expect(formState.webhook).toBe('https://wh.com');
  });

  test('GM_setValue is called with the webhook on save', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockResolvedValue([]);
    SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [{ worldId: 4028 }], deletesAfterSuccess: [] });
    SaveOps.executeSaveOps.mockResolvedValue();

    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });

    document.querySelector('#univ-alert-modal [data-action="save"]').click();
    await new Promise(r => setTimeout(r, 10));

    expect(GM_setValue).toHaveBeenCalledWith('discordWebhook', 'https://wh.com');
  });
});

describe('renderFormView — removing progress phase', () => {
  test('displays removing phase message correctly', async () => {
    GM_getValue.mockReturnValue('https://wh.com');
    API.getAlerts.mockResolvedValue([]);
    SaveOps.computeSaveOps.mockReturnValue({ postsNeeded: [{ worldId: 4028 }], deletesAfterSuccess: [] });
    SaveOps.executeSaveOps.mockImplementation(async (ops, itemId, formState, { onProgress }) => {
      onProgress({ phase: 'removing', completed: 1, total: 2 });
      return new Promise(() => {}); // never resolves — keeps modal open
    });

    Modal.openBulkModal({ groups: [], nameMap: new Map([[44015, 'Item']]), currentItemId: 44015, currentItemName: 'Item', alertCount: 0 });

    document.querySelector('#univ-alert-modal [data-action="save"]').click();
    await new Promise(r => setTimeout(r, 10));

    const statusEl = document.querySelector('#univ-alert-modal [data-status]');
    expect(statusEl.textContent).toBe('Removing old alert 1 of 2...');
  });
});

describe('renderListView — capacity display', () => {
  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
  const groups = [{
    itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
    worlds: [{ worldId: 4030, alertId: 'a1', worldName: '利維坦' }],
  }];

  test('displays alert slot usage when alertCount is provided', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, {
      groups, nameMap: new Map([[44015, 'Item']]),
      onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(),
      newAlertDisabled: false, alertCount: 24,
    });
    expect(container.textContent).toContain('Alert slots: 24 / 40 used');
  });

  test('displays 0 / 40 when alertCount is 0', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, {
      groups, nameMap: new Map([[44015, 'Item']]),
      onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn(),
      newAlertDisabled: false, alertCount: 0,
    });
    expect(container.textContent).toContain('Alert slots: 0 / 40 used');
  });
});

describe('openErrorModal', () => {
  test('opens modal with error message', () => {
    Modal.openErrorModal('Something went wrong');
    const overlay = document.getElementById('univ-alert-modal');
    expect(overlay).not.toBeNull();
    expect(overlay.textContent).toContain('Bulk Alerts');
    expect(overlay.textContent).toContain('Something went wrong');
  });

  test('error message is styled in red', () => {
    Modal.openErrorModal('Network failure');
    const p = document.querySelector('#univ-alert-modal p');
    expect(p.style.color).toBe('rgb(255, 107, 107)');
  });

  test('close button dismisses modal', () => {
    Modal.openErrorModal('fail');
    document.querySelector('[data-action="close-error"]').click();
    expect(document.getElementById('univ-alert-modal')).toBeNull();
  });

  test('Escape key dismisses modal', () => {
    Modal.openErrorModal('fail');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('univ-alert-modal')).toBeNull();
  });

  test('renders HTML links in message', () => {
    Modal.openErrorModal('Check <a href="https://example.com">here</a>');
    const link = document.querySelector('#univ-alert-modal p a');
    expect(link).not.toBeNull();
    expect(link.href).toBe('https://example.com/');
    expect(link.textContent).toBe('here');
  });
});

describe('openLoadingModal', () => {
  test('opens modal with spinner and title', () => {
    Modal.openLoadingModal();
    const overlay = document.getElementById('univ-alert-modal');
    expect(overlay).not.toBeNull();
    expect(overlay.textContent).toContain('Bulk Alerts');
    expect(overlay.querySelector('[data-spinner]')).not.toBeNull();
  });

  test('spinner has CSS animation', () => {
    Modal.openLoadingModal();
    const spinner = document.querySelector('#univ-alert-modal [data-spinner]');
    expect(spinner.style.animation).toContain('spin');
  });

  test('close button dismisses modal', () => {
    Modal.openLoadingModal();
    document.querySelector('[data-action="close-loading"]').click();
    expect(document.getElementById('univ-alert-modal')).toBeNull();
  });

  test('Escape key dismisses modal', () => {
    Modal.openLoadingModal();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('univ-alert-modal')).toBeNull();
  });

  test('is replaced when openBulkModal is called after', () => {
    Modal.openLoadingModal();
    expect(document.querySelector('#univ-alert-modal [data-spinner]')).not.toBeNull();
    Modal.openBulkModal({ groups: [], nameMap: new Map(), currentItemId: null, currentItemName: null, alertCount: 0 });
    expect(document.querySelector('#univ-alert-modal [data-spinner]')).toBeNull();
  });

  test('is replaced when openErrorModal is called after', () => {
    Modal.openLoadingModal();
    Modal.openErrorModal('Oops');
    expect(document.querySelector('#univ-alert-modal [data-spinner]')).toBeNull();
    expect(document.querySelector('#univ-alert-modal').textContent).toContain('Oops');
  });
});
