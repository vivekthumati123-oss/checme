/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Report untested files at 0% instead of leaving them out of lcov.
  collectCoverageFrom: ["src/**/*.{ts,js}", "!src/**/__tests__/**", "!src/**/*.d.ts"],
};
