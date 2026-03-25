// tests/market-page.test.js
const MarketPage = require('../src/market-page');

// Stub globals used by market-page
global.Modal = { openModal: jest.fn(), closeModal: jest.fn(), openBulkModal: jest.fn() };
global.API = { getAlerts: jest.fn() };
global.Grouping = require('../src/grouping');
global.SaveOps = { computeSaveOps: jest.fn(), executeSaveOps: jest.fn() };
global.WorldMap = require('../src/worldmap');

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
});

describe('injectMarketButton', () => {
  function setupDOM({ buttonBar = true } = {}) {
    document.body.innerHTML = `
      <h1 class="item-name">木棉原木</h1>
      ${buttonBar ? '<div class="box_flex form"><button class="btn_addto_list">提醒</button></div>' : ''}
    `;
  }

  test('appends button to the button bar', () => {
    setupDOM();
    MarketPage.injectMarketButton(44015);
    const bar = document.querySelector('.box_flex.form');
    expect(bar.querySelector('#univ-alert-btn')).not.toBeNull();
  });

  test('injects custom button with id univ-alert-btn', () => {
    setupDOM();
    MarketPage.injectMarketButton(44015);
    expect(document.querySelector('#univ-alert-btn')).not.toBeNull();
  });

  test('does nothing if already injected (idempotent)', () => {
    setupDOM();
    MarketPage.injectMarketButton(44015);
    MarketPage.injectMarketButton(44015);
    expect(document.querySelectorAll('#univ-alert-btn')).toHaveLength(1);
  });

  test('falls back to document.body when button bar is absent', () => {
    setupDOM({ buttonBar: false });
    MarketPage.injectMarketButton(44015);
    expect(document.getElementById('univ-alert-btn')).not.toBeNull();
  });
});

describe('handleAlertButtonClick', () => {
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0,
    trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };

  test('calls API.getAlerts and opens bulk modal on click', async () => {
    API.getAlerts.mockResolvedValue([alert1]);
    await MarketPage.handleAlertButtonClick(44015, '木棉原木');
    expect(API.getAlerts).toHaveBeenCalled();
    expect(Modal.openBulkModal).toHaveBeenCalled();
  });

  test('passes grouped alerts to openBulkModal', async () => {
    const alert2 = { ...alert1, id: 'a2', trigger: { ...alert1.trigger, comparison: { lt: { target: 200 } } } };
    API.getAlerts.mockResolvedValue([alert1, alert2]);
    await MarketPage.handleAlertButtonClick(44015, '木棉原木');
    const callArgs = Modal.openBulkModal.mock.calls[0][0];
    expect(callArgs.groups).toHaveLength(2);
  });

  test('shows error message when getAlerts fails', async () => {
    API.getAlerts.mockRejectedValue(new Error('Network error'));
    // Must include #univ-alert-btn so the error element can be inserted after it
    document.body.innerHTML = '<button id="univ-alert-btn">🔔 Bulk Alerts</button>';
    await MarketPage.handleAlertButtonClick(44015, '木棉原木');
    expect(Modal.openBulkModal).not.toHaveBeenCalled();
    const errorEl = document.getElementById('univ-alert-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toBe('Failed to load existing alerts — check your connection');
  });
});
