module.exports = {
  testEnvironment: 'node',
  globalSetup: './jest.global-setup.js',
  maxWorkers: 1,
  testPathIgnorePatterns: ['/node_modules/'],
  collectCoverageFrom: ['src/**/*.js'],
};
