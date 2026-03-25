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

describe('openModal — save progress', () => {
  test('shows status element and updates button text during save', async () => {
    let resolveOnSave;
    const onSave = jest.fn(() => new Promise(r => { resolveOnSave = r; }));
    GM_getValue.mockReturnValue('https://wh.com');
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave });

    const saveBtn = document.querySelector('#univ-alert-modal [data-action="save"]');
    const statusEl = document.querySelector('#univ-alert-modal [data-status]');
    saveBtn.click();
    await new Promise(r => setTimeout(r, 0)); // flush microtasks

    expect(saveBtn.textContent).toBe('Saving...');
    expect(saveBtn.disabled).toBe(true);

    // Simulate onProgress callback
    const onProgress = onSave.mock.calls[0][1];
    expect(typeof onProgress).toBe('function');
    onProgress({ phase: 'creating', completed: 1, total: 3 });
    expect(statusEl.style.display).toBe('block');
    expect(statusEl.textContent).toBe('Creating alert 1 of 3...');

    resolveOnSave();
    await new Promise(r => setTimeout(r, 0));
    // Modal should be closed after successful save
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('displays "Refreshing state..." for refreshing phase', async () => {
    let resolveOnSave;
    const onSave = jest.fn(() => new Promise(r => { resolveOnSave = r; }));
    GM_getValue.mockReturnValue('https://wh.com');
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave });

    const saveBtn = document.querySelector('#univ-alert-modal [data-action="save"]');
    const statusEl = document.querySelector('#univ-alert-modal [data-status]');
    saveBtn.click();
    await new Promise(r => setTimeout(r, 0));

    const onProgress = onSave.mock.calls[0][1];
    onProgress({ phase: 'refreshing' });
    expect(statusEl.style.display).toBe('block');
    expect(statusEl.textContent).toBe('Refreshing state...');

    resolveOnSave();
    await new Promise(r => setTimeout(r, 0));
  });

  test('hides status and restores button on save error', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('Save failed'));
    GM_getValue.mockReturnValue('https://wh.com');
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave });

    const saveBtn = document.querySelector('#univ-alert-modal [data-action="save"]');
    saveBtn.click();
    await new Promise(r => setTimeout(r, 0));

    const statusEl = document.querySelector('#univ-alert-modal [data-status]');
    const errorArea = document.querySelector('#univ-alert-modal [data-error-area]');

    expect(statusEl.style.display).toBe('none');
    expect(errorArea.style.display).toBe('block');
    expect(errorArea.textContent).toBe('Save failed');
    expect(saveBtn.textContent).toBe('Save');
    expect(saveBtn.disabled).toBe(false);
  });
});

describe('modal dismiss — Escape and overlay click', () => {
  test('closes modal on Escape key press', () => {
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn() });
    expect(document.querySelector('#univ-alert-modal')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('closes modal when clicking overlay background', () => {
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn() });
    const overlay = document.querySelector('#univ-alert-modal');
    expect(overlay).not.toBeNull();
    // Click the overlay itself (not the inner container)
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });

  test('does NOT close modal when clicking inside the form container', () => {
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn() });
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
    expect(result).toContain('price');
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
  const groups = [{
    itemId: 44015, name: 'Alert', discordWebhook: 'https://wh.com', trigger,
    worlds: [
      { worldId: 4030, alertId: 'a1', worldName: '利維坦' },
      { worldId: 4031, alertId: 'a2', worldName: '鳳凰' },
    ],
  }];

  test('renders one row per alert group', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { itemId: 44015, itemName: '木棉原木', groups, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn() });
    const rows = container.querySelectorAll('[data-group-row]');
    expect(rows).toHaveLength(1);
  });

  test('renders world pills for each group', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { itemId: 44015, itemName: '木棉原木', groups, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn() });
    const pills = container.querySelectorAll('[data-group-row="0"] [data-world-pill]');
    expect(pills).toHaveLength(2);
    expect(pills[0].textContent).toBe('利維坦');
    expect(pills[1].textContent).toBe('鳳凰');
  });

  test('renders Edit and Delete buttons per group', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { itemId: 44015, itemName: '木棉原木', groups, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn() });
    expect(container.querySelector('[data-action="edit"]')).not.toBeNull();
    expect(container.querySelector('[data-action="delete"]')).not.toBeNull();
  });

  test('renders "New Alert" button', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { itemId: 44015, itemName: '木棉原木', groups, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn() });
    expect(container.querySelector('[data-action="new-alert"]')).not.toBeNull();
  });

  test('"New Alert" button calls onNew callback', () => {
    const container = document.createElement('div');
    const onNew = jest.fn();
    Modal.renderListView(container, { itemId: 44015, itemName: '木棉原木', groups, onEdit: jest.fn(), onDelete: jest.fn(), onNew, onClose: jest.fn() });
    container.querySelector('[data-action="new-alert"]').click();
    expect(onNew).toHaveBeenCalled();
  });

  test('Edit button calls onEdit with the group', () => {
    const container = document.createElement('div');
    const onEdit = jest.fn();
    Modal.renderListView(container, { itemId: 44015, itemName: '木棉原木', groups, onEdit, onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn() });
    container.querySelector('[data-action="edit"]').click();
    expect(onEdit).toHaveBeenCalledWith(groups[0]);
  });

  test('renders formatted rule text', () => {
    const container = document.createElement('div');
    Modal.renderListView(container, { itemId: 44015, itemName: '木棉原木', groups, onEdit: jest.fn(), onDelete: jest.fn(), onNew: jest.fn(), onClose: jest.fn() });
    expect(container.textContent).toContain('Min');
    expect(container.textContent).toContain('<');
    expect(container.textContent).toContain('130');
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
    Modal.renderListView(container, { itemId: 44015, itemName: 'Item', groups, onEdit: jest.fn(), onDelete: (group, idx, btn) => {
      Modal.handleListDelete(group, idx, btn, container, jest.fn());
    }, onNew: jest.fn(), onClose: jest.fn() });

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
    Modal.renderListView(container, { itemId: 44015, itemName: 'Item', groups, onEdit: jest.fn(), onDelete: (group, idx, btn) => {
      Modal.handleListDelete(group, idx, btn, container, jest.fn());
    }, onNew: jest.fn(), onClose: jest.fn() });

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

describe('closeModal', () => {
  test('removes modal from DOM', () => {
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn() });
    Modal.closeModal();
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });
});
