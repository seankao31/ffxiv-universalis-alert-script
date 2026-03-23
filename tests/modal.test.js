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
