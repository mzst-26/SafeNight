module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/src/osm-ingestion/tests'],
  testMatch: ['**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/coverage/'],
  // flatbush 4.x is ESM-only ("type": "module", exports -> index.js), which Jest's CJS
  // runtime cannot load. Map the bare import to its UMD build, which ships in the package.
  moduleNameMapper: {
    '^flatbush$': '<rootDir>/node_modules/flatbush/flatbush.js',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.js'],
  clearMocks: true,
  restoreMocks: true,
  silent: true,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/server.js',
    '!src/**/migrations/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    global: {
      statements: 70,
      lines: 70,
      functions: 75,
      branches: 50,
    },
  },
};
