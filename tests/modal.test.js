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

describe('closeModal', () => {
  test('removes modal from DOM', () => {
    Modal.openModal({ itemId: 44015, itemName: 'Item', group: null, onSave: jest.fn() });
    Modal.closeModal();
    expect(document.querySelector('#univ-alert-modal')).toBeNull();
  });
});
