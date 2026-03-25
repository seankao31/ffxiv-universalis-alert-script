// tests/init.test.js
// init.js calls main() at module load, so we must set up globals before each require().
// We use jest.isolateModules to get a fresh copy per test.

global.MarketPage = { init: jest.fn() };
global.AlertsPage = { init: jest.fn() };

function requireInit() {
  let Init;
  jest.isolateModules(() => {
    Init = require('../src/init');
  });
  return Init;
}

beforeEach(() => {
  // Reset location BEFORE DOM mutation to prevent stale MutationObservers
  // from previous tests from re-routing on the innerHTML change.
  delete window.location;
  window.location = { pathname: '/' };
  document.body.innerHTML = '<div></div>';
  MarketPage.init.mockReset();
  AlertsPage.init.mockReset();
});

describe('route — market page dispatch', () => {
  test('routes /market/{id} to MarketPage.init()', () => {
    delete window.location;
    window.location = { pathname: '/market/44015' };
    requireInit();
    expect(MarketPage.init).toHaveBeenCalled();
    expect(AlertsPage.init).not.toHaveBeenCalled();
  });

  test('does not route /market (no item id)', () => {
    delete window.location;
    window.location = { pathname: '/market' };
    requireInit();
    expect(MarketPage.init).not.toHaveBeenCalled();
  });

  test('does not route /market/{id}/history (sub-path)', () => {
    delete window.location;
    window.location = { pathname: '/market/44015/history' };
    requireInit();
    expect(MarketPage.init).not.toHaveBeenCalled();
  });
});

describe('route — alerts page dispatch', () => {
  test('routes /account/alerts to AlertsPage.init()', () => {
    delete window.location;
    window.location = { pathname: '/account/alerts' };
    requireInit();
    expect(AlertsPage.init).toHaveBeenCalled();
    expect(MarketPage.init).not.toHaveBeenCalled();
  });
});

describe('route — no-op paths', () => {
  test('does nothing for root path', () => {
    delete window.location;
    window.location = { pathname: '/' };
    requireInit();
    expect(MarketPage.init).not.toHaveBeenCalled();
    expect(AlertsPage.init).not.toHaveBeenCalled();
  });

  test('does nothing for unrelated path', () => {
    delete window.location;
    window.location = { pathname: '/about' };
    requireInit();
    expect(MarketPage.init).not.toHaveBeenCalled();
    expect(AlertsPage.init).not.toHaveBeenCalled();
  });

  test('does nothing for /account/alerts/sub-path', () => {
    delete window.location;
    window.location = { pathname: '/account/settings' };
    requireInit();
    expect(MarketPage.init).not.toHaveBeenCalled();
    expect(AlertsPage.init).not.toHaveBeenCalled();
  });
});

describe('route — exported function direct calls', () => {
  test('route() can be called directly after module load', () => {
    delete window.location;
    window.location = { pathname: '/' };
    const Init = requireInit();

    MarketPage.init.mockReset();
    Init.route('/market/12345');
    expect(MarketPage.init).toHaveBeenCalledTimes(1);
  });

  test('route() to /account/alerts calls AlertsPage.init()', () => {
    delete window.location;
    window.location = { pathname: '/' };
    const Init = requireInit();

    AlertsPage.init.mockReset();
    Init.route('/account/alerts');
    expect(AlertsPage.init).toHaveBeenCalledTimes(1);
  });
});

describe('setupNavigationObserver', () => {
  test('calls route when pathname changes and DOM mutates', async () => {
    delete window.location;
    window.location = { pathname: '/' };
    const Init = requireInit();
    MarketPage.init.mockReset();

    // Simulate SPA navigation: change pathname and trigger a DOM mutation
    window.location.pathname = '/market/44015';
    document.body.appendChild(document.createElement('div'));

    // MutationObserver fires asynchronously
    await new Promise(r => setTimeout(r, 0));

    expect(MarketPage.init).toHaveBeenCalled();
  });

  test('does not re-route when pathname has not changed', async () => {
    delete window.location;
    window.location = { pathname: '/' };
    const Init = requireInit();
    MarketPage.init.mockReset();

    // DOM mutates but pathname stays the same
    document.body.appendChild(document.createElement('span'));
    await new Promise(r => setTimeout(r, 0));

    expect(MarketPage.init).not.toHaveBeenCalled();
  });
});
