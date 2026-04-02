const HeaderButton = require('../src/header-button');

global.Modal = { openBulkModal: jest.fn(), closeModal: jest.fn(), openErrorModal: jest.fn(), openLoadingModal: jest.fn() };
global.API = { getAlerts: jest.fn() };
global.Grouping = require('../src/grouping');
global.WorldMap = require('../src/worldmap');

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
  fetch.mockReset();
  HeaderButton._resetNameCache();
});

function setupHeader() {
  // Matches real universalis.app: account section is a direct child of <header>,
  // sibling to the main wrapper div (not nested inside it)
  document.body.innerHTML = `
    <header>
      <div>
        <div class="header-home"><a href="/"><img src="/logo.png" /></a></div>
        <div class="header-nav"><input type="text" placeholder="search" /></div>
      </div>
      <div>
        <div><a href="/account">帳號</a><span class="username">testuser</span></div>
        <div><button class="btn-settings">⚙️</button></div>
      </div>
    </header>
  `;
}

describe('injectButton', () => {
  test('inserts button as first child of account section', () => {
    setupHeader();
    HeaderButton.injectButton();
    const btn = document.getElementById('univ-alert-btn');
    // Button is inside the account div (contains the account link), within the account section
    const accountDiv = btn.parentElement;
    expect(accountDiv.querySelector('a[href="/account"]')).not.toBeNull();
    expect(accountDiv.parentElement.parentElement.tagName).toBe('HEADER');
  });

  test('button has correct text', () => {
    setupHeader();
    HeaderButton.injectButton();
    expect(document.getElementById('univ-alert-btn').textContent).toBe('Bulk Alerts');
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

  test('shows loading modal immediately on click', async () => {
    setupHeader();
    let resolveAlerts;
    API.getAlerts.mockImplementation(() => new Promise(r => { resolveAlerts = r; }));

    const promise = HeaderButton.handleClick();

    // Loading modal shown before getAlerts resolves
    expect(Modal.openLoadingModal).toHaveBeenCalled();
    expect(Modal.openBulkModal).not.toHaveBeenCalled();

    resolveAlerts([]);
    await promise;
  });

  test('fetches alerts and item names, opens bulk modal', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/market/44015' };
    document.body.insertAdjacentHTML('beforeend', '<h1>木棉原木</h1>');

    API.getAlerts.mockResolvedValue([alert1]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<html><body><h1>653 木棉原木</h1></body></html>') });

    await HeaderButton.handleClick();

    expect(API.getAlerts).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/market/44015');
    expect(Modal.openBulkModal).toHaveBeenCalled();
    const callArgs = Modal.openBulkModal.mock.calls[0][0];
    expect(callArgs.currentItemId).toBe(44015);
    expect(callArgs.currentItemName).toBe('木棉原木');
    expect(callArgs.groups).toHaveLength(1);
    expect(callArgs.nameMap.get(44015)).toBe('木棉原木');
  });

  test('resolves names for multiple distinct items', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/' };

    const alert2 = {
      ...alert1, id: 'a2', itemId: 42934, worldId: 4030,
      trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 200 } } },
    };
    API.getAlerts.mockResolvedValue([alert1, alert2]);
    fetch.mockImplementation((url) => {
      if (url === '/market/44015') {
        return Promise.resolve({ ok: true, text: () => Promise.resolve('<html><body><h1>653 木棉原木</h1></body></html>') });
      }
      if (url === '/market/42934') {
        return Promise.resolve({ ok: true, text: () => Promise.resolve('<html><body><h1>710 某裝備</h1></body></html>') });
      }
      return Promise.resolve({ ok: false });
    });

    await HeaderButton.handleClick();

    const callArgs = Modal.openBulkModal.mock.calls[0][0];
    expect(callArgs.nameMap.get(44015)).toBe('木棉原木');
    expect(callArgs.nameMap.get(42934)).toBe('某裝備');
  });

  test('persists fetched names to GM storage', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/' };

    API.getAlerts.mockResolvedValue([alert1]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<html><body><h1>653 木棉原木</h1></body></html>') });

    await HeaderButton.handleClick();

    expect(GM_setValue).toHaveBeenCalledWith('nameCache', JSON.stringify({ 44015: '木棉原木' }));
  });

  test('loads names from GM storage and skips fetch', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/' };

    // Seed GM storage as if a previous page load cached this name
    GM_getValue.mockReturnValue(JSON.stringify({ 44015: '木棉原木' }));
    HeaderButton._resetNameCache(); // re-load from GM storage

    API.getAlerts.mockResolvedValue([alert1]);

    await HeaderButton.handleClick();

    expect(fetch).not.toHaveBeenCalled();
    expect(Modal.openBulkModal.mock.calls[0][0].nameMap.get(44015)).toBe('木棉原木');
  });

  test('fetches only uncached items when alerts grow', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/' };

    // Seed GM storage with one known name
    GM_getValue.mockReturnValue(JSON.stringify({ 44015: '木棉原木' }));
    HeaderButton._resetNameCache();

    const alert2 = { ...alert1, id: 'a2', itemId: 42934 };
    API.getAlerts.mockResolvedValue([alert1, alert2]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<html><body><h1>710 某裝備</h1></body></html>') });

    await HeaderButton.handleClick();

    // Only the new item was fetched
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/market/42934');
    // Both names present in map
    const nameMap = Modal.openBulkModal.mock.calls[0][0].nameMap;
    expect(nameMap.get(44015)).toBe('木棉原木');
    expect(nameMap.get(42934)).toBe('某裝備');
    // GM storage updated with both
    expect(GM_setValue).toHaveBeenCalledWith('nameCache', JSON.stringify({ 44015: '木棉原木', 42934: '某裝備' }));
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

  test('opens error modal when getAlerts fails (loading shown first)', async () => {
    setupHeader();
    HeaderButton.injectButton();
    // openLoadingModal must create the real DOM element so handleClick sees the
    // modal is still open and proceeds to show the error
    Modal.openLoadingModal.mockImplementation(() => {
      const el = document.createElement('div');
      el.id = 'univ-alert-modal';
      document.body.appendChild(el);
    });
    API.getAlerts.mockRejectedValue(new Error('Network error'));

    await HeaderButton.handleClick();

    expect(Modal.openLoadingModal).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(Modal.openBulkModal).not.toHaveBeenCalled();
    expect(Modal.openErrorModal).toHaveBeenCalledWith(
      expect.stringContaining('Universalis alerts API')
    );
  });

  test('silently ignores error when user closes modal before getAlerts responds', async () => {
    setupHeader();
    HeaderButton.injectButton();
    // openLoadingModal creates the modal DOM element
    Modal.openLoadingModal.mockImplementation(() => {
      const el = document.createElement('div');
      el.id = 'univ-alert-modal';
      document.body.appendChild(el);
    });

    let rejectAlerts;
    API.getAlerts.mockImplementation(() => new Promise((_, reject) => { rejectAlerts = reject; }));

    const promise = HeaderButton.handleClick();

    // User closes the modal while getAlerts is in flight
    const modal = document.getElementById('univ-alert-modal');
    modal.remove();

    // Now the API responds with an error
    rejectAlerts(new Error('Network error'));
    await promise;

    expect(Modal.openErrorModal).not.toHaveBeenCalled();
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

  test('passes alertCount to openBulkModal', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/' };

    const alerts = [
      { id: 'a1', itemId: 44015, worldId: 4030, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } },
      { id: 'a2', itemId: 44015, worldId: 4031, name: 'Alert', discordWebhook: 'https://wh.com', triggerVersion: 0, trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } } },
    ];
    API.getAlerts.mockResolvedValue(alerts);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<html><body><h1>653 木棉原木</h1></body></html>') });

    await HeaderButton.handleClick();

    const callArgs = Modal.openBulkModal.mock.calls[0][0];
    expect(callArgs.alertCount).toBe(2);
  });

  test('seeds current page item name into nameMap even when no alerts exist for it', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/market/99999' };
    document.body.insertAdjacentHTML('beforeend', '<h1>新アイテム</h1>');

    // User has alerts for item 44015, but NOT for 99999
    API.getAlerts.mockResolvedValue([alert1]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<html><body><h1>653 木棉原木</h1></body></html>') });

    await HeaderButton.handleClick();

    const callArgs = Modal.openBulkModal.mock.calls[0][0];
    // The current page item should be in nameMap so list view can display it
    expect(callArgs.nameMap.get(99999)).toBe('新アイテム');
  });

  test('seeds current page item name into nameMap when user has zero alerts', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/market/99999' };
    document.body.insertAdjacentHTML('beforeend', '<h1>新アイテム</h1>');

    API.getAlerts.mockResolvedValue([]);

    await HeaderButton.handleClick();

    const callArgs = Modal.openBulkModal.mock.calls[0][0];
    expect(callArgs.nameMap.get(99999)).toBe('新アイテム');
    // No fetch needed — name comes from the page's own <h1>
    expect(fetch).not.toHaveBeenCalled();
  });

  test('enriches groups with worldName', async () => {
    setupHeader();
    delete window.location;
    window.location = { pathname: '/market/44015' };
    document.body.insertAdjacentHTML('beforeend', '<h1>木棉原木</h1>');

    API.getAlerts.mockResolvedValue([alert1]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<html><body><h1>653 木棉原木</h1></body></html>') });

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
    header.innerHTML = '<div><div class="header-home"></div></div><div><div><a href="/account">帳號</a></div><div><button class="btn-settings">⚙️</button></div></div>';
    document.body.appendChild(header);
    await new Promise(r => setTimeout(r, 0));

    expect(document.getElementById('univ-alert-btn')).not.toBeNull();
  });

  test('does not create duplicate observers when called multiple times', async () => {
    document.body.innerHTML = '';
    HeaderButton.init();
    HeaderButton.init();
    HeaderButton.init();

    // Simulate header appearing
    const header = document.createElement('header');
    header.innerHTML = '<div><div class="header-home"></div></div><div><div><a href="/account">帳號</a></div><div><button>⚙️</button></div></div>';
    document.body.appendChild(header);
    await new Promise(r => setTimeout(r, 0));

    // Should only have one button (no duplicates from multiple observers)
    expect(document.querySelectorAll('#univ-alert-btn')).toHaveLength(1);
  });

  test('re-injects button after React re-render wipes it', async () => {
    setupHeader();
    HeaderButton.init();
    expect(document.getElementById('univ-alert-btn')).not.toBeNull();

    // Simulate React re-render wiping the button
    document.getElementById('univ-alert-btn').remove();
    expect(document.getElementById('univ-alert-btn')).toBeNull();

    // Trigger a DOM mutation so the observer fires
    document.body.appendChild(document.createElement('span'));
    await new Promise(r => setTimeout(r, 0));

    expect(document.getElementById('univ-alert-btn')).not.toBeNull();
  });
});
