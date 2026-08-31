const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/ui',
  webServer: {
    command: '../.venv/bin/python ../app.py',
    url: 'http://127.0.0.1:8080',
    reuseExistingServer: true,
    timeout: 10000
  },
  use: {
    baseURL: 'http://127.0.0.1:8080'
  }
});
