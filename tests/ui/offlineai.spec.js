const { test, expect } = require('@playwright/test');

test('loads the local UI and renders runtime status', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ollama: true,
      models_count: 1,
      lan: false,
      auth_required: false,
      host: '127.0.0.1',
      port: 8080
    })
  }));
  await page.route('**/api/show', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ capabilities: ['completion'], details: { families: [] } })
  }));
  await page.route('**/api/models', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ models: [{ name: 'gemma4:e4b' }] })
  }));

  await page.goto('/');

  await expect(page.locator('.brand')).toContainText('OfflineAI');
  await expect(page.locator('#connection-pill')).toContainText('Local');
  await expect(page.locator('#input')).toBeVisible();
  await expect(page.locator('#chat-model-select')).toHaveValue('gemma4:e4b');

  await page.locator('#settings-btn').click();
  await expect(page.locator('#settings-temperature')).toHaveValue('0.7');
  await expect(page.locator('#settings-top-p')).toHaveValue('0.9');
  await expect(page.locator('#settings-history-limit')).toHaveValue('60');
  await expect(page.locator('#settings-auto-title')).toBeChecked();
  await expect(page.locator('#restart-ollama-btn')).toBeVisible();
  await expect(page.locator('#downloaded-models-list')).toContainText('gemma4:e4b');
});
