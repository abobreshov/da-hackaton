/**
 * Jest integration test config — separate from default unit config.
 *
 * - testMatch: *.int-spec.ts
 * - globalSetup / globalTeardown boot Testcontainers once per run
 * - Longer timeout (containers take ~5–15s to pull & start)
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.int-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  globalSetup: '<rootDir>/src/test/global-setup.ts',
  globalTeardown: '<rootDir>/src/test/global-teardown.ts',
  testTimeout: 60_000,
  // Serialize — containers are shared per worker; parallel workers would
  // each spin their own. For the smoke suite single worker is plenty.
  maxWorkers: 1,
};
