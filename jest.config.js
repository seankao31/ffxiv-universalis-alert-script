module.exports = {
  testEnvironment: 'jsdom',
  setupFiles: ['./tests/setup.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/header.js',
  ],
};
