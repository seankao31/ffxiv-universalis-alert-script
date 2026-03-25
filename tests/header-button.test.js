const HeaderButton = require('../src/header-button');

global.Modal = { openBulkModal: jest.fn(), closeModal: jest.fn() };
global.API = { getAlerts: jest.fn() };
global.Grouping = require('../src/grouping');
global.WorldMap = require('../src/worldmap');

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
  fetch.mockReset();
});

function setupHeader() {
  document.body.innerHTML = `
    <header><div>
      <div class="header-home"><a href="/"><img src="/logo.png" /></a></div>
      <div class="header-nav"><input type="text" placeholder="search" /></div>
      <div>
        <div><a href="/account">帳號</a><span class="username">testuser</span></div>
        <div><button class="btn-settings">⚙️</button></div>
      </div>
    </div></header>
  `;
}

describe('injectButton', () => {
  test('inserts button as first child of account section', () => {
    setupHeader();
    HeaderButton.injectButton();
    const accountSection = document.querySelector('header a[href="/account"]').closest('header > div > div:last-child');
    expect(accountSection.firstElementChild.id).toBe('univ-alert-btn');
  });

  test('button has correct text', () => {
    setupHeader();
    HeaderButton.injectButton();
    expect(document.getElementById('univ-alert-btn').textContent).toBe('🔔 Bulk Alerts');
  });

  test('is idempotent — does not duplicate', () => {
    setupHeader();
    HeaderButton.injectButton();
    HeaderButton.injectButton();
    expect(document.querySelectorAll('#univ-alert-btn')).toHaveLength(1);
  });

  test('no-op when header account section is absent (logged out)', () => {
    document.body.innerHTML = '<header><div><div class="header-home"></div></div></header>';
    HeaderButton.injectButton();
    expect(document.getElementById('univ-alert-btn')).toBeNull();
  });
});

describe('handleClick', () => {
  const alert1 = {
    id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0,
    trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } },
  };

  test('fetches alerts and item names, opens bulk modal', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/market/44015' };
    document.body.insertAdjacentHTML('beforeend', '<h1>木棉原木</h1>');

    API.getAlerts.mockResolvedValue([alert1]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<a href="/market/44015">木棉原木</a>') });

    await HeaderButton.handleClick();

    expect(API.getAlerts).toHaveBeenCalled();
    expect(Modal.openBulkModal).toHaveBeenCalled();
    const callArgs = Modal.openBulkModal.mock.calls[0][0];
    expect(callArgs.currentItemId).toBe(44015);
    expect(callArgs.currentItemName).toBe('木棉原木');
    expect(callArgs.groups).toHaveLength(1);
    expect(callArgs.nameMap).toBeInstanceOf(Map);
  });

  test('passes null currentItemId when not on market item page', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/' };

    API.getAlerts.mockResolvedValue([]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });

    await HeaderButton.handleClick();

    const callArgs = Modal.openBulkModal.mock.calls[0][0];
    expect(callArgs.currentItemId).toBeNull();
    expect(callArgs.currentItemName).toBeNull();
  });

  test('shows inline error when getAlerts fails', async () => {
    setupHeader();
    HeaderButton.injectButton();
    API.getAlerts.mockRejectedValue(new Error('Network error'));
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });

    await HeaderButton.handleClick();

    expect(Modal.openBulkModal).not.toHaveBeenCalled();
    const errorEl = document.getElementById('univ-alert-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('Failed to load');
  });

  test('degrades gracefully when fetchItemNames fails', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/market/44015' };
    document.body.insertAdjacentHTML('beforeend', '<h1>木棉原木</h1>');

    API.getAlerts.mockResolvedValue([alert1]);
    fetch.mockRejectedValue(new Error('Network error'));

    await HeaderButton.handleClick();

    expect(Modal.openBulkModal).toHaveBeenCalled();
    const callArgs = Modal.openBulkModal.mock.calls[0][0];
    expect(callArgs.nameMap).toBeInstanceOf(Map);
    // nameMap may be empty but modal still opens
  });

  test('enriches groups with worldName', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/market/44015' };
    document.body.insertAdjacentHTML('beforeend', '<h1>木棉原木</h1>');

    API.getAlerts.mockResolvedValue([alert1]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });

    await HeaderButton.handleClick();

    const callArgs = Modal.openBulkModal.mock.calls[0][0];
    const world = callArgs.groups[0].worlds.find(w => w.worldId === 4030);
    expect(world.worldName).toBe('利維坦');
  });
});

describe('init', () => {
  test('injects button when header account section exists', () => {
    setupHeader();
    HeaderButton.init();
    expect(document.getElementById('univ-alert-btn')).not.toBeNull();
  });

  test('uses MutationObserver when header not yet rendered', async () => {
    document.body.innerHTML = '';
    HeaderButton.init();
    expect(document.getElementById('univ-alert-btn')).toBeNull();

    // Simulate header appearing
    const header = document.createElement('header');
    header.innerHTML = '<div><div class="header-home"></div><div><div><a href="/account">帳號</a></div><div><button class="btn-settings">⚙️</button></div></div></div>';
    document.body.appendChild(header);
    await new Promise(r => setTimeout(r, 0));

    expect(document.getElementById('univ-alert-btn')).not.toBeNull();
  });
});
