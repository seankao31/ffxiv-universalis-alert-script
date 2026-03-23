// tests/market-page.test.js
const MarketPage = require('../src/market-page');

// Stub globals used by market-page
global.Modal = { openModal: jest.fn(), closeModal: jest.fn() };
global.API = { getAlerts: jest.fn() };
global.Grouping = require('../src/grouping');
global.SaveOps = { computeSaveOps: jest.fn(), executeSaveOps: jest.fn() };

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
});

describe('injectMarketButton', () => {
  function setupDOM(hasNativeButton = true) {
    document.body.innerHTML = `
      <h1 class="item-name">木棉原木</h1>
      ${hasNativeButton ? '<button>Alerts</button>' : ''}
    `;
  }

  test('hides native Alerts button', () => {
    setupDOM();
    MarketPage.injectMarketButton(44015);
    const native = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Alerts'));
    // Should be hidden (display:none or visibility:hidden) or removed
    expect(native?.style.display).toBe('none');
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
});

describe('handleAlertButtonClick', () => {
  const alert1 = { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0,
    trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } };

  test('calls API.getAlerts and opens modal on click', async () => {
    API.getAlerts.mockResolvedValue([alert1]);
    await MarketPage.handleAlertButtonClick(44015, '木棉原木');
    expect(API.getAlerts).toHaveBeenCalled();
    expect(Modal.openModal).toHaveBeenCalled();
  });

  test('passes multipleGroups=true when item has 2+ distinct groups', async () => {
    const alert2 = { ...alert1, id: 'a2', trigger: { ...alert1.trigger, comparison: { lt: { target: 200 } } } };
    API.getAlerts.mockResolvedValue([alert1, alert2]);
    await MarketPage.handleAlertButtonClick(44015, '木棉原木');
    const callArgs = Modal.openModal.mock.calls[0][0];
    expect(callArgs.multipleGroups).toBe(true);
  });

  test('shows error message when getAlerts fails', async () => {
    API.getAlerts.mockRejectedValue(new Error('Network error'));
    // Must include #univ-alert-btn so the error element can be inserted after it
    document.body.innerHTML = '<button id="univ-alert-btn">🔔 Set Alerts</button>';
    await MarketPage.handleAlertButtonClick(44015, '木棉原木');
    expect(Modal.openModal).not.toHaveBeenCalled();
    const errorEl = document.getElementById('univ-alert-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toBe('Failed to load existing alerts — check your connection');
  });
});
