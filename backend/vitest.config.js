const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.js'],
    testTimeout: 20000,
    hookTimeout: 20000,
    pool: 'forks', // isolate each test file in its own process (fresh require cache -> fresh SQLite file per file)
  },
});
