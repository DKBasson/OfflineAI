const { test, expect } = require('@playwright/test');

// ── Shared helpers ─────────────────────────────────────────────────────────────

async function setupRoutes(page, {
  ollamaOnline = true,
  lan = false,
  models = ['gemma4:e4b'],
  tokens = {}
} = {}) {
  await page.route('**/api/status', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(ollamaOnline
      ? { ollama: true, models_count: models.length, lan, auth_required: false }
      : { ollama: false, error: 'Ollama is not reachable' })
  }));
  await page.route('**/api/show', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ capabilities: ['completion'], details: { families: [] } })
  }));
  await page.route('**/api/models', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ models: models.map(n => ({ name: n })) })
  }));
  await page.route('**/api/tokens', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(tokens)
  }));
}

async function dismissNameModal(page, name = 'TestUser') {
  const modal = page.locator('#name-modal');
  // init() is async (awaits indexedDB + fetch) so the modal may appear slightly
  // after page.goto returns. Use waitFor instead of a single isVisible() snapshot.
  try {
    await modal.waitFor({ state: 'visible', timeout: 3000 });
    await page.locator('#name-modal-input').fill(name);
    await page.locator('#name-modal-btn').click();
    await expect(modal).toBeHidden();
  } catch {
    // Modal not shown — username already saved in localStorage
  }
}

async function loadApp(page, opts = {}) {
  await setupRoutes(page, opts);
  await page.goto('/');
  await dismissNameModal(page, opts.username ?? 'TestUser');
}

/** Returns NDJSON body that simulates a single streaming assistant reply. */
function chatReply(content) {
  return (
    JSON.stringify({ message: { content }, done: false }) + '\n' +
    JSON.stringify({ message: { content: '' }, done: true }) + '\n'
  );
}

async function sendMessage(page, text) {
  await page.locator('#input').fill(text);
  await page.locator('#send-btn').click();
  await expect(page.locator('.message.assistant .msg-text')).toBeVisible();
}

// ── 1. Smoke test ──────────────────────────────────────────────────────────────

test('loads the local UI and renders runtime status', async ({ page }) => {
  await setupRoutes(page);
  await page.goto('/');

  const nameModal = page.locator('#name-modal');
  if (await nameModal.isVisible()) {
    await page.locator('#name-modal-input').fill('TestUser');
    await page.locator('#name-modal-btn').click();
    await expect(nameModal).toBeHidden();
  }

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

// ── 2. Name modal ──────────────────────────────────────────────────────────────

test.describe('Name modal', () => {
  test('shows on first visit', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/');
    await expect(page.locator('#name-modal')).toBeVisible();
  });

  test('does not submit with blank name', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/');
    await page.locator('#name-modal-btn').click();
    await expect(page.locator('#name-modal')).toBeVisible();
  });

  test('dismisses and personalises welcome after name entry', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/');
    await page.locator('#name-modal-input').fill('Alice');
    await page.locator('#name-modal-btn').click();
    await expect(page.locator('#name-modal')).toBeHidden();
    await expect(page.locator('#welcome h2')).toContainText('Alice');
  });

  test('submits with Enter key', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/');
    await page.locator('#name-modal-input').fill('Bob');
    await page.locator('#name-modal-input').press('Enter');
    await expect(page.locator('#name-modal')).toBeHidden();
  });

  test('Escape does not close modal when no username is saved', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/');
    await page.keyboard.press('Escape');
    // Modal must stay visible — no username set yet
    await expect(page.locator('#name-modal')).toBeVisible();
  });

  test('truncates name at 32 characters', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/');
    const long = 'A'.repeat(40);
    await page.locator('#name-modal-input').fill(long);
    await page.locator('#name-modal-btn').click();
    await expect(page.locator('#welcome h2')).toContainText('A'.repeat(32));
  });
});

// ── 3. Connection status ───────────────────────────────────────────────────────

test.describe('Connection status', () => {
  test('shows Local when Ollama is online', async ({ page }) => {
    await loadApp(page, { ollamaOnline: true });
    await expect(page.locator('#connection-pill')).toContainText('Local');
    await expect(page.locator('#connection-pill')).toHaveClass(/online/);
  });

  test('shows Ollama off when Ollama is offline', async ({ page }) => {
    await setupRoutes(page, { ollamaOnline: false });
    await page.goto('/');
    await dismissNameModal(page);
    await expect(page.locator('#connection-pill')).toContainText('Ollama off');
    await expect(page.locator('#connection-pill')).toHaveClass(/offline/);
  });

  test('shows LAN live in LAN mode', async ({ page }) => {
    await loadApp(page, { ollamaOnline: true, lan: true });
    await expect(page.locator('#connection-pill')).toContainText('LAN live');
  });

  test('tooltip is attached to connection pill', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('#connection-tooltip')).toBeAttached();
  });
});

// ── 4. Token counter ───────────────────────────────────────────────────────────

test.describe('Token counter', () => {
  test('starts at 0 on fresh load', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('#token-count')).toHaveText('0');
  });

  test('shows formatted k-value from API', async ({ page }) => {
    await setupRoutes(page, { tokens: { TestUser: [1200, 800] } });
    await page.goto('/');
    await dismissNameModal(page);
    // 1200 + 800 = 2000 → "2k"
    await expect(page.locator('#token-count')).toHaveText('2k');
  });

  test('token counter element is visible in header', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('#token-counter')).toBeVisible();
  });
});

// ── 5. Welcome screen ──────────────────────────────────────────────────────────

test.describe('Welcome screen', () => {
  test('shows greeting with entered username', async ({ page }) => {
    await loadApp(page, { username: 'Charlie' });
    await expect(page.locator('#welcome h2')).toContainText('Charlie');
  });

  test('shows current model name in welcome', async ({ page }) => {
    // The default/active model from settings (gemma4:e4b) is always shown
    await loadApp(page);
    await expect(page.locator('#welcome')).toContainText('gemma4:e4b');
  });

  test('disappears once a message is sent', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('Hello!')
    }));
    await page.locator('#input').fill('Hi');
    await page.locator('#send-btn').click();
    await expect(page.locator('#welcome')).toHaveCount(0);
  });

  test('reappears after starting a new chat', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('ok')
    }));
    await sendMessage(page, 'Hello');
    await page.locator('#clear-btn').click();
    await expect(page.locator('#welcome')).toBeVisible();
  });
});

// ── 6. Chat ────────────────────────────────────────────────────────────────────

test.describe('Chat', () => {
  test('renders user bubble after sending', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('Hi back!')
    }));
    await page.locator('#input').fill('Hello');
    await page.locator('#send-btn').click();
    await expect(page.locator('.message.user .msg-text').first()).toContainText('Hello');
  });

  test('renders assistant reply', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('Hello back!')
    }));
    await page.locator('#input').fill('Hello');
    await page.locator('#send-btn').click();
    await expect(page.locator('.message.assistant .msg-text')).toContainText('Hello back!');
  });

  test('clears input after sending', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('ok')
    }));
    await page.locator('#input').fill('Test message');
    await page.locator('#send-btn').click();
    await expect(page.locator('#input')).toHaveValue('');
  });

  test('Enter key sends the message', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('reply')
    }));
    await page.locator('#input').fill('Keyboard send');
    await page.locator('#input').press('Enter');
    await expect(page.locator('.message.user .msg-text').first()).toContainText('Keyboard send');
  });

  test('Shift+Enter inserts newline without sending', async ({ page }) => {
    await loadApp(page);
    await page.locator('#input').fill('Line one');
    await page.locator('#input').press('Shift+Enter');
    await page.locator('#input').type('Line two');
    await expect(page.locator('.message.user')).toHaveCount(0);
  });

  test('empty input does not send', async ({ page }) => {
    await loadApp(page);
    await page.locator('#send-btn').click();
    await expect(page.locator('.message')).toHaveCount(0);
  });

  test('shows error bubble on 500 server error', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 500, contentType: 'application/json',
      body: JSON.stringify({ error: 'Model not found' })
    }));
    await page.locator('#input').fill('Hello');
    await page.locator('#send-btn').click();
    await expect(page.locator('.message.assistant .msg-text.error')).toBeVisible();
  });

  test('copy button appears on user and assistant messages', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('Copy me!')
    }));
    await sendMessage(page, 'Hi');
    const copyBtns = page.locator('.message-actions .msg-action-btn');
    await expect(copyBtns.first()).toBeVisible();
  });

  test('regenerate button appears after assistant reply', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('First reply')
    }));
    await sendMessage(page, 'Hi');
    await expect(page.locator('.regen-msg-btn')).toBeVisible();
  });

  test('user avatar shows first letter of name', async ({ page }) => {
    await loadApp(page, { username: 'Dave' });
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('ok')
    }));
    await sendMessage(page, 'Hi');
    await expect(page.locator('.message.user .avatar').first()).toContainText('D');
  });

  test('assistant avatar is the lightning bolt', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('ok')
    }));
    await sendMessage(page, 'Hi');
    await expect(page.locator('.message.assistant .avatar').first()).toContainText('⚡');
  });

  test('multiple messages accumulate in chat', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('ok')
    }));
    await sendMessage(page, 'First');
    await sendMessage(page, 'Second');
    await expect(page.locator('.message.user')).toHaveCount(2);
    await expect(page.locator('.message.assistant')).toHaveCount(2);
  });
});

// ── 7. New chat ────────────────────────────────────────────────────────────────

test.describe('New chat', () => {
  test('clear button wipes messages and shows welcome', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('ok')
    }));
    await sendMessage(page, 'Hello');
    await page.locator('#clear-btn').click();
    await expect(page.locator('.message')).toHaveCount(0);
    await expect(page.locator('#welcome')).toBeVisible();
  });

  test('Cmd+K starts new chat', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('ok')
    }));
    await sendMessage(page, 'Hello');
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#welcome')).toBeVisible();
    await expect(page.locator('.message')).toHaveCount(0);
  });
});

// ── 8. Settings panel ──────────────────────────────────────────────────────────

test.describe('Settings panel', () => {
  test('opens via settings button', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await expect(page.locator('#settings-panel')).toHaveClass(/open/);
  });

  test('closes via close button', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#settings-close-btn').click();
    await expect(page.locator('#settings-panel')).not.toHaveClass(/open/);
  });

  test('closes via overlay click', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#settings-overlay').click();
    await expect(page.locator('#settings-panel')).not.toHaveClass(/open/);
  });

  test('closes via Escape key', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-panel')).not.toHaveClass(/open/);
  });

  test('saves updated username and reflects in welcome', async ({ page }) => {
    await loadApp(page, { username: 'TestUser' });
    await page.locator('#settings-btn').click();
    await page.locator('#settings-name').fill('NewName');
    await page.locator('#settings-save-btn').click();
    await expect(page.locator('#welcome h2')).toContainText('NewName');
  });

  test('saves updated temperature and persists across reopen', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#settings-temperature').fill('1.2');
    await page.locator('#settings-save-btn').click();
    await page.locator('#settings-btn').click();
    await expect(page.locator('#settings-temperature')).toHaveValue('1.2');
  });

  test('saves updated Top P', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#settings-top-p').fill('0.5');
    await page.locator('#settings-save-btn').click();
    await page.locator('#settings-btn').click();
    await expect(page.locator('#settings-top-p')).toHaveValue('0.5');
  });

  test('saves updated context window size', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#settings-context').fill('30');
    await page.locator('#settings-save-btn').click();
    await page.locator('#settings-btn').click();
    await expect(page.locator('#settings-context')).toHaveValue('30');
  });

  test('disabling auto-title is persisted', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#settings-auto-title').uncheck();
    await page.locator('#settings-save-btn').click();
    await page.locator('#settings-btn').click();
    await expect(page.locator('#settings-auto-title')).not.toBeChecked();
  });

  test('shows model health section with Ollama Online', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await expect(page.locator('#model-health')).toContainText('Online');
  });

  test('shows model health section with Ollama Offline', async ({ page }) => {
    await setupRoutes(page, { ollamaOnline: false });
    await page.goto('/');
    await dismissNameModal(page);
    await page.locator('#settings-btn').click();
    await expect(page.locator('#model-health')).toContainText('Offline');
  });

  test('restart Ollama button shows success status', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/ollama/restart', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: 'Ollama restarted' })
    }));
    await page.locator('#settings-btn').click();
    await page.locator('#restart-ollama-btn').click();
    await expect(page.locator('#ollama-restart-status')).toContainText('Ollama restarted');
  });

  test('restart Ollama button shows error on failure', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/ollama/restart', route => route.fulfill({
      status: 500, contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'Permission denied' })
    }));
    await page.locator('#settings-btn').click();
    await page.locator('#restart-ollama-btn').click();
    await expect(page.locator('#ollama-restart-status')).toContainText('Error');
  });
});

// ── 9. Model selection ─────────────────────────────────────────────────────────

test.describe('Model selection', () => {
  test('populates select with available models', async ({ page }) => {
    await loadApp(page, { models: ['gemma4:e4b', 'llama3:8b', 'mistral:7b'] });
    await expect(page.locator('#chat-model-select option')).toHaveCount(3);
  });

  test('defaults to first model in the list', async ({ page }) => {
    await loadApp(page, { models: ['gemma4:e4b', 'llama3:8b'] });
    await expect(page.locator('#chat-model-select')).toHaveValue('gemma4:e4b');
  });

  test('changing model updates the select value', async ({ page }) => {
    await loadApp(page, { models: ['gemma4:e4b', 'llama3:8b'] });
    await page.locator('#chat-model-select').selectOption('llama3:8b');
    await expect(page.locator('#chat-model-select')).toHaveValue('llama3:8b');
  });

  test('changing model updates welcome message', async ({ page }) => {
    await loadApp(page, { models: ['gemma4:e4b', 'llama3:8b'] });
    await page.locator('#chat-model-select').selectOption('llama3:8b');
    await expect(page.locator('#welcome')).toContainText('llama3:8b');
  });
});

// ── 10. History sidebar ────────────────────────────────────────────────────────

test.describe('History sidebar', () => {
  test('opens on history button click', async ({ page }) => {
    await loadApp(page);
    await page.locator('#history-btn').click();
    await expect(page.locator('#sidebar')).toHaveClass(/open/);
  });

  test('shows empty state when no conversations', async ({ page }) => {
    await loadApp(page);
    await page.locator('#history-btn').click();
    await expect(page.locator('#history-list')).toContainText('No conversations yet');
  });

  test('closes via close button', async ({ page }) => {
    await loadApp(page);
    await page.locator('#history-btn').click();
    await page.locator('#sidebar-close-btn').click();
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
  });

  test('closes via overlay click', async ({ page }) => {
    await loadApp(page);
    await page.locator('#history-btn').click();
    await page.locator('#sidebar-overlay').click();
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
  });

  test('closes via Escape key', async ({ page }) => {
    await loadApp(page);
    await page.locator('#history-btn').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
  });

  test('Cmd+L toggles history sidebar', async ({ page }) => {
    await loadApp(page);
    await page.keyboard.press('Meta+l');
    await expect(page.locator('#sidebar')).toHaveClass(/open/);
    await page.keyboard.press('Meta+l');
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
  });

  test('new chat button in sidebar closes sidebar and shows welcome', async ({ page }) => {
    await loadApp(page);
    await page.locator('#history-btn').click();
    await page.locator('#new-chat-btn').click();
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
    await expect(page.locator('#welcome')).toBeVisible();
  });

  test('shows sent conversation in history list', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('I am fine!')
    }));
    await sendMessage(page, 'How are you?');
    await page.locator('#history-btn').click();
    await expect(page.locator('#history-list .history-item')).toHaveCount(1);
  });

  test('can delete a conversation from history', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('ok')
    }));
    await sendMessage(page, 'Test');
    await page.locator('#history-btn').click();
    await page.locator('#history-list .history-del-btn').click();
    // Deleting the active conversation auto-closes the sidebar; reopen to verify
    await page.locator('#history-btn').click();
    await expect(page.locator('#history-list')).toContainText('No conversations yet');
  });

  test('can load a conversation from history', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('remembered reply')
    }));
    await sendMessage(page, 'Remember this');
    await page.locator('#clear-btn').click();
    await expect(page.locator('.message')).toHaveCount(0);
    await page.locator('#history-btn').click();
    await page.locator('#history-list .history-item-main').first().click();
    await expect(page.locator('.message.user .msg-text').first()).toContainText('Remember this');
  });

  test('search filters conversations by title', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/');
    await dismissNameModal(page);
    // Seed two conversations via localStorage, then reload so app migrates them
    await page.evaluate(() => {
      const convs = [
        { id: '1', title: 'Banana recipe', timestamp: Date.now() - 1000, model: 'gemma4:e4b', messages: [{ role: 'user', content: 'Banana' }] },
        { id: '2', title: 'Apple facts',   timestamp: Date.now(),         model: 'gemma4:e4b', messages: [{ role: 'user', content: 'Apple' }] }
      ];
      localStorage.setItem('offlineai_history', JSON.stringify(convs));
    });
    await page.reload();
    await page.locator('#history-btn').click();
    await page.locator('#history-search').fill('banana');
    await expect(page.locator('#history-list .history-item')).toHaveCount(1);
    await expect(page.locator('#history-list')).toContainText('Banana recipe');
  });

  test('search shows no-matches message when nothing found', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/');
    await dismissNameModal(page);
    await page.evaluate(() => {
      localStorage.setItem('offlineai_history', JSON.stringify([
        { id: '1', title: 'Cats', timestamp: Date.now(), model: 'gemma4:e4b', messages: [{ role: 'user', content: 'Cats' }] }
      ]));
    });
    await page.reload();
    await page.locator('#history-btn').click();
    await page.locator('#history-search').fill('zzznomatch');
    await expect(page.locator('#history-list')).toContainText('No matches');
  });
});

// ── 11. Keyboard shortcuts modal ───────────────────────────────────────────────

test.describe('Keyboard shortcuts modal', () => {
  test('opens via shortcuts button', async ({ page }) => {
    await loadApp(page);
    await page.locator('#shortcuts-btn').click();
    await expect(page.locator('#shortcuts-modal')).not.toHaveClass(/hidden/);
  });

  test('opens with ? key when not typing in input', async ({ page }) => {
    await loadApp(page);
    await page.locator('#messages').click(); // move focus off input
    await page.keyboard.press('?');
    await expect(page.locator('#shortcuts-modal')).not.toHaveClass(/hidden/);
  });

  test('closes via close button', async ({ page }) => {
    await loadApp(page);
    await page.locator('#shortcuts-btn').click();
    await page.locator('#shortcuts-close-btn').click();
    await expect(page.locator('#shortcuts-modal')).toHaveClass(/hidden/);
  });

  test('closes via Escape key', async ({ page }) => {
    await loadApp(page);
    await page.locator('#shortcuts-btn').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#shortcuts-modal')).toHaveClass(/hidden/);
  });

  test('closing backdrop click closes modal', async ({ page }) => {
    await loadApp(page);
    await page.locator('#shortcuts-btn').click();
    // Click top-left corner of modal (backdrop area outside card)
    await page.locator('#shortcuts-modal').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#shortcuts-modal')).toHaveClass(/hidden/);
  });

  test('lists multiple shortcut rows', async ({ page }) => {
    await loadApp(page);
    await page.locator('#shortcuts-btn').click();
    const rows = page.locator('.shortcuts-grid .sc-row');
    await expect(rows).not.toHaveCount(0);
    expect(await rows.count()).toBeGreaterThan(4);
  });
});

// ── 12. System prompts ─────────────────────────────────────────────────────────

test.describe('System prompts', () => {
  test('add prompt form is hidden by default', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await expect(page.locator('#sp-new-form')).toHaveClass(/hidden/);
  });

  test('+ Add prompt shows the form', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#sp-add-btn').click();
    await expect(page.locator('#sp-new-form')).not.toHaveClass(/hidden/);
  });

  test('cancel hides the form', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#sp-add-btn').click();
    await page.locator('#sp-new-cancel').click();
    await expect(page.locator('#sp-new-form')).toHaveClass(/hidden/);
  });

  test('saving a new prompt shows it in the list', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#sp-add-btn').click();
    await page.locator('#sp-new-name').fill('Test Prompt');
    await page.locator('#sp-new-content').fill('You are a helpful assistant.');
    await page.locator('#sp-new-save').click();
    await expect(page.locator('#sp-saved-list .sp-saved-name')).toContainText('Test Prompt');
  });

  test('saved prompt appears in the sp-select dropdown', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#sp-add-btn').click();
    await page.locator('#sp-new-name').fill('My Prompt');
    await page.locator('#sp-new-content').fill('Be concise.');
    await page.locator('#sp-new-save').click();
    await expect(page.locator('#sp-select option:not([value=""])')).toHaveCount(1);
    await expect(page.locator('#sp-select')).toContainText('My Prompt');
  });

  test('form requires both name and content before saving', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#sp-add-btn').click();
    await page.locator('#sp-new-name').fill('Name only');
    // leave content blank
    await page.locator('#sp-new-save').click();
    await expect(page.locator('#sp-new-form')).not.toHaveClass(/hidden/);
  });

  test('can delete a saved prompt', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#sp-add-btn').click();
    await page.locator('#sp-new-name').fill('Delete me');
    await page.locator('#sp-new-content').fill('Content to delete.');
    await page.locator('#sp-new-save').click();
    await page.locator('.sp-saved-del').click();
    await expect(page.locator('#sp-saved-list')).toContainText('No saved prompts yet');
  });

  test('can duplicate a saved prompt', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#sp-add-btn').click();
    await page.locator('#sp-new-name').fill('Original');
    await page.locator('#sp-new-content').fill('Some content.');
    await page.locator('#sp-new-save').click();
    await page.locator('.sp-saved-copy').click();
    await expect(page.locator('#sp-saved-list .sp-saved-name')).toHaveCount(2);
    await expect(page.locator('#sp-saved-list')).toContainText('Original copy');
  });

  test('can star a prompt as default', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#sp-add-btn').click();
    await page.locator('#sp-new-name').fill('Default Prompt');
    await page.locator('#sp-new-content').fill('Always be helpful.');
    await page.locator('#sp-new-save').click();
    await page.locator('.sp-saved-default').click();
    await expect(page.locator('.sp-saved-default')).toHaveClass(/active/);
  });

  test('can edit an existing prompt', async ({ page }) => {
    await loadApp(page);
    await page.locator('#settings-btn').click();
    await page.locator('#sp-add-btn').click();
    await page.locator('#sp-new-name').fill('Old Name');
    await page.locator('#sp-new-content').fill('Old content.');
    await page.locator('#sp-new-save').click();
    await page.locator('.sp-saved-edit').click();
    await page.locator('#sp-new-name').fill('New Name');
    await page.locator('#sp-new-save').click();
    await expect(page.locator('#sp-saved-list .sp-saved-name')).toContainText('New Name');
  });
});

// ── 13. Model pull ─────────────────────────────────────────────────────────────

test.describe('Model pull', () => {
  test('pull button shows status immediately', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/pull', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: JSON.stringify({ status: 'pulling manifest' }) + '\n' +
            JSON.stringify({ status: 'success' }) + '\n'
    }));
    await page.locator('#settings-btn').click();
    await page.locator('#pull-model-input').fill('llama3:8b');
    await page.locator('#pull-btn').click();
    await expect(page.locator('#pull-status')).not.toHaveClass(/hidden/);
  });

  test('shows ready message after successful pull', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/pull', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: JSON.stringify({ status: 'pulling manifest' }) + '\n' +
            JSON.stringify({ status: 'success' }) + '\n'
    }));
    await page.locator('#settings-btn').click();
    await page.locator('#pull-model-input').fill('llama3:8b');
    await page.locator('#pull-btn').click();
    await expect(page.locator('#pull-status')).toContainText('ready');
    await expect(page.locator('#pull-status')).toHaveClass(/success/);
  });

  test('shows error when pull fails', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/pull', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: JSON.stringify({ error: 'model not found' }) + '\n'
    }));
    await page.locator('#settings-btn').click();
    await page.locator('#pull-model-input').fill('badmodel');
    await page.locator('#pull-btn').click();
    await expect(page.locator('#pull-status')).toHaveClass(/error/);
  });

  test('Enter key in pull input triggers pull', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/pull', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: JSON.stringify({ status: 'success' }) + '\n'
    }));
    await page.locator('#settings-btn').click();
    await page.locator('#pull-model-input').fill('phi3:mini');
    await page.locator('#pull-model-input').press('Enter');
    await expect(page.locator('#pull-status')).not.toHaveClass(/hidden/);
  });

  test('clears input after successful pull', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/pull', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: JSON.stringify({ status: 'success' }) + '\n'
    }));
    await page.locator('#settings-btn').click();
    await page.locator('#pull-model-input').fill('phi3:mini');
    await page.locator('#pull-btn').click();
    await expect(page.locator('#pull-status')).toContainText('ready');
    await expect(page.locator('#pull-model-input')).toHaveValue('');
  });
});

// ── 14. Danger zone ────────────────────────────────────────────────────────────

test.describe('Danger zone', () => {
  test('clear history with cancel keeps settings open', async ({ page }) => {
    await loadApp(page);
    page.on('dialog', dialog => dialog.dismiss());
    await page.locator('#settings-btn').click();
    await page.locator('#clear-history-btn').click();
    await expect(page.locator('#settings-panel')).toHaveClass(/open/);
  });

  test('confirming clear history closes settings', async ({ page }) => {
    await loadApp(page);
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#settings-btn').click();
    await page.locator('#clear-history-btn').click();
    await expect(page.locator('#settings-panel')).not.toHaveClass(/open/);
  });

  test('confirming clear history removes all conversations', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('ok')
    }));
    await sendMessage(page, 'Test');
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#settings-btn').click();
    await page.locator('#clear-history-btn').click();
    await page.locator('#history-btn').click();
    await expect(page.locator('#history-list')).toContainText('No conversations yet');
  });
});

// ── 15. Export ─────────────────────────────────────────────────────────────────

test.describe('Export', () => {
  test('export button is visible in header', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('#export-btn')).toBeVisible();
  });

  test('Cmd+E triggers markdown download after chat', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('Exported!')
    }));
    await sendMessage(page, 'Export test');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.keyboard.press('Meta+e')
    ]);
    expect(download.suggestedFilename()).toMatch(/\.md$/);
  });

  test('export button click triggers download when chat has messages', async ({ page }) => {
    await loadApp(page);
    await page.route('**/api/chat', route => route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      body: chatReply('Some reply')
    }));
    await sendMessage(page, 'Hello');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#export-btn').click()
    ]);
    expect(download.suggestedFilename()).toMatch(/\.md$/);
  });
});

// ── 16. Focus mode ─────────────────────────────────────────────────────────────

test.describe('Focus mode', () => {
  test('Cmd+Shift+F toggles focus-mode class on body', async ({ page }) => {
    await loadApp(page);
    await page.keyboard.press('Meta+Shift+F');
    await expect(page.locator('body')).toHaveClass(/focus-mode/);
    await page.keyboard.press('Meta+Shift+F');
    await expect(page.locator('body')).not.toHaveClass(/focus-mode/);
  });
});

// ── 17. Keyboard focus shortcuts ───────────────────────────────────────────────

test('Cmd+/ focuses the message input', async ({ page }) => {
  await loadApp(page);
  await page.locator('#messages').click(); // move focus away
  await page.keyboard.press('Meta+/');
  await expect(page.locator('#input')).toBeFocused();
});

