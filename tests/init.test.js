// tests/init.test.js
global.HeaderButton = { init: jest.fn() };

function requireInit() {
  let Init;
  jest.isolateModules(() => {
    Init = require('../src/init');
  });
  return Init;
}

beforeEach(() => {
  delete window.location;
  window.location = { pathname: '/' };
  document.body.innerHTML = '<div></div>';
  HeaderButton.init.mockReset();
});

describe('route — always calls HeaderButton.init', () => {
  test('calls HeaderButton.init on root path', () => {
    requireInit();
    expect(HeaderButton.init).toHaveBeenCalled();
  });

  test('calls HeaderButton.init on market page', () => {
    delete window.location;
    window.location = { pathname: '/market/44015' };
    requireInit();
    expect(HeaderButton.init).toHaveBeenCalled();
  });

  test('calls HeaderButton.init on account page', () => {
    delete window.location;
    window.location = { pathname: '/account/alerts' };
    requireInit();
    expect(HeaderButton.init).toHaveBeenCalled();
  });

  test('calls HeaderButton.init on any page', () => {
    delete window.location;
    window.location = { pathname: '/about' };
    requireInit();
    expect(HeaderButton.init).toHaveBeenCalled();
  });
});

describe('route — exported function', () => {
  test('route() calls HeaderButton.init()', () => {
    const Init = requireInit();
    HeaderButton.init.mockReset();
    Init.route();
    expect(HeaderButton.init).toHaveBeenCalledTimes(1);
  });
});

describe('setupNavigationObserver', () => {
  test('calls route when pathname changes and DOM mutates', async () => {
    delete window.location;
    window.location = { pathname: '/' };
    const Init = requireInit();
    HeaderButton.init.mockReset();

    window.location.pathname = '/market/44015';
    document.body.appendChild(document.createElement('div'));
    await new Promise(r => setTimeout(r, 0));

    expect(HeaderButton.init).toHaveBeenCalled();
  });

  test('does not re-route when pathname has not changed', async () => {
    delete window.location;
    window.location = { pathname: '/' };
    const Init = requireInit();
    HeaderButton.init.mockReset();

    document.body.appendChild(document.createElement('span'));
    await new Promise(r => setTimeout(r, 0));

    expect(HeaderButton.init).not.toHaveBeenCalled();
  });
});
