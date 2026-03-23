// Stub TamperMonkey globals so tests don't throw on import
global.GM_getValue = jest.fn(() => undefined);
global.GM_setValue = jest.fn();

// Stub fetch so tests can spy on it
global.fetch = jest.fn();
