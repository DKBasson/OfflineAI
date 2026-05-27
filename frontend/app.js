// ── Config / Defaults ─────────────────────────────────
  const FALLBACK_MODEL = 'gemma4:e4b';
  const SETTINGS_KEY   = 'offlineai_settings';
  const PROMPTS_KEY    = 'offlineai_prompts';
  const AUTH_TOKEN_KEY = 'offlineai_auth_token';
  const HISTORY_KEY    = 'offlineai_history';
  const HISTORY_DB     = 'offlineai_history_db';
  const HISTORY_STORE  = 'conversations';
  const DEFAULT_SETTINGS = {
    model: FALLBACK_MODEL,
    contextSize: 20,
    username: '',
    defaultPromptId: '',
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 0,
    numCtx: 0,
    historyLimit: 60,
    autoTitle: true,
    imageModel: 'x/z-image-turbo',
    imagePerfProfile: 'eco'
  };

  const IMAGE_PERF_PRESETS = {
    eco: { width: 640, height: 640, steps: 6 },
    balanced: { width: 768, height: 768, steps: 10 },
    quality: { width: 1024, height: 1024, steps: 16 }
  };

  const urlToken = new URLSearchParams(location.search).get('token');
  if (urlToken) {
    sessionStorage.setItem(AUTH_TOKEN_KEY, urlToken);
    const cleanUrl = location.pathname + location.hash;
    history.replaceState(null, '', cleanUrl);
  }

  function authHeaders(headers = {}) {
    const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
    return token ? { ...headers, 'X-OfflineAI-Token': token } : headers;
  }

  // File-type constants
  const IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';
  const TEXT_ACCEPT  = '.txt,.md,.py,.js,.ts,.jsx,.tsx,.json,.csv,.xml,.yaml,.yml,.sh,.bash,.html,.css,.java,.c,.cpp,.h,.rs,.go,.rb,.php,.swift,.kt,.sql,.toml,.ini,.conf,.env,.log,.tex,.rst,.adoc,.diff,.patch,.properties,.cfg,.vue,.svelte,.cs,.vb,.fs,.r,.lua,.ps1,.ex,.exs,.hs,.nim,.zig,.proto';
  const DOC_ACCEPT   = '.docx,.odt,.ods,.odp,.pdf';
  const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.opus,.m4a,.webm,.flac,.aac,.wma,.aiff,.alac';
  const CLIENT_BODY_LIMIT = 45 * 1024 * 1024;
  // Capability cache: modelName → { vision: bool }
  const modelCaps = {};

  // Configure marked once at startup
  marked.use({ breaks: true, gfm: true });

  // ── Settings ──────────────────────────────────────────
  function clampNumber(value, min, max, fallback) {
    if (value === '' || value === null || value === undefined) return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function clampInt(value, min, max, fallback) {
    return Math.round(clampNumber(value, min, max, fallback));
  }

  function normalizeSettings(settings = {}) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    return {
      ...s,
      model: String(s.model || FALLBACK_MODEL),
      username: String(s.username || '').slice(0, 32),
      defaultPromptId: String(s.defaultPromptId || ''),
      contextSize: clampInt(s.contextSize, 4, 100, DEFAULT_SETTINGS.contextSize),
      temperature: Number(clampNumber(s.temperature, 0, 2, DEFAULT_SETTINGS.temperature).toFixed(2)),
      topP: Number(clampNumber(s.topP, 0.1, 1, DEFAULT_SETTINGS.topP).toFixed(2)),
      maxTokens: clampInt(s.maxTokens, 0, 8192, DEFAULT_SETTINGS.maxTokens),
      numCtx: clampInt(s.numCtx, 0, 32768, DEFAULT_SETTINGS.numCtx),
      historyLimit: clampInt(s.historyLimit, 10, 200, DEFAULT_SETTINGS.historyLimit),
      autoTitle: s.autoTitle !== false,
      imageModel: String(s.imageModel || 'x/z-image-turbo'),
      imagePerfProfile: Object.prototype.hasOwnProperty.call(IMAGE_PERF_PRESETS, s.imagePerfProfile)
        ? s.imagePerfProfile
        : DEFAULT_SETTINGS.imagePerfProfile
    };
  }

  function getImagePerfConfig() {
    const key = getSettings().imagePerfProfile;
    return IMAGE_PERF_PRESETS[key] || IMAGE_PERF_PRESETS.eco;
  }

  function getSettings() {
    try {
      return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
    } catch { return normalizeSettings(); }
  }
  function persistSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(s))); } catch {}
  }
  function getHistoryLimit() {
    return getSettings().historyLimit;
  }
  function getGenerationOptions() {
    const s = getSettings();
    const options = {
      temperature: s.temperature,
      top_p: s.topP
    };
    if (s.maxTokens > 0) options.num_predict = s.maxTokens;
    if (s.numCtx > 0) options.num_ctx = s.numCtx;
    return options;
  }

  // ── Token tracking ────────────────────────────────────
  function fmtTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }
  function renderTokenCounter(t) {
    const total = (t.input || 0) + (t.output || 0);
    tokenCountEl.textContent = fmtTokens(total);
    tokenCounterEl.title = `Tokens used\nInput: ${t.input.toLocaleString()}\nOutput: ${t.output.toLocaleString()}\nTotal: ${total.toLocaleString()}`;
  }
  async function fetchAndRenderTokens() {
    if (!activeUsername) return;
    try {
      const r = await fetch('/api/tokens', { headers: authHeaders() });
      if (!r.ok) return;
      const stats = await r.json();
      const entry = stats[activeUsername] || [0, 0];
      renderTokenCounter({ input: entry[0], output: entry[1] });
    } catch {}
  }

  // ── Active config (loaded from settings at init) ──────
  let activeModel       = FALLBACK_MODEL;
  let activeContextSize = 20;
  let activeUsername    = '';

  // ── State ─────────────────────────────────────────────
  let messages            = [];
  let pendingImages       = [];
  let pendingFiles        = []; // { name, content (text) }
  let pendingAudio        = []; // { name, file }
  let isStreaming         = false;
  let abortCtrl           = null;
  let streamEl            = null;
  let streamText          = '';
  let currentConvId       = null;
  let currentSystemPrompt   = '';
  let currentSystemPromptId = '';
  let historyCache        = [];
  let historyDb           = null;
  let historySearchTerm   = '';

  // ── DOM ───────────────────────────────────────────────
  const messagesEl    = document.getElementById('messages');
  const inputEl       = document.getElementById('input');
  const sendBtn       = document.getElementById('send-btn');
  const stopBtn       = document.getElementById('stop-btn');
  const attachBtn     = document.getElementById('attach-btn');
  const fileInput     = document.getElementById('file-input');
  const previewsEl    = document.getElementById('img-previews');
  const clearBtn      = document.getElementById('clear-btn');
  const historyBtn    = document.getElementById('history-btn');
  const sidebar       = document.getElementById('sidebar');
  const sidebarOver   = document.getElementById('sidebar-overlay');
  const sidebarClose  = document.getElementById('sidebar-close-btn');
  const newChatBtn    = document.getElementById('new-chat-btn');
  const historyList   = document.getElementById('history-list');
  const historySearch = document.getElementById('history-search');
  const lightbox      = document.getElementById('lightbox');
  const lightboxImg   = document.getElementById('lightbox-img');
  const settingsBtn   = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const settingsOver  = document.getElementById('settings-overlay');
  const settingsClose = document.getElementById('settings-close-btn');
  const settingsSave  = document.getElementById('settings-save-btn');
  const settingsName  = document.getElementById('settings-name');
  const settingsCtx   = document.getElementById('settings-context');
  const settingsTemp  = document.getElementById('settings-temperature');
  const settingsTopP  = document.getElementById('settings-top-p');
  const settingsMaxTokens = document.getElementById('settings-max-tokens');
  const settingsNumCtx = document.getElementById('settings-num-ctx');
  const settingsHistoryLimit = document.getElementById('settings-history-limit');
  const settingsAutoTitle = document.getElementById('settings-auto-title');
  const modelHealth   = document.getElementById('model-health');
  const restartOllamaBtn = document.getElementById('restart-ollama-btn');
  const restartStatus = document.getElementById('ollama-restart-status');
  const resetTokensBtn = document.getElementById('reset-tokens-btn');
  const clearHistBtn  = document.getElementById('clear-history-btn');
  const nameModal     = document.getElementById('name-modal');
  const nameInput     = document.getElementById('name-modal-input');
  const nameBtn       = document.getElementById('name-modal-btn');
  const spSelect        = document.getElementById('sp-select');
  const tokenCountEl    = document.getElementById('token-count');
  const tokenCounterEl  = document.getElementById('token-counter');
  const connectionPill  = document.getElementById('connection-pill');
  const connectionText  = document.getElementById('connection-text');
  const connectionTip   = document.getElementById('connection-tooltip');
  const spSavedList     = document.getElementById('sp-saved-list');
  const spAddBtn        = document.getElementById('sp-add-btn');
  const spNewForm       = document.getElementById('sp-new-form');
  const spNewName       = document.getElementById('sp-new-name');
  const spNewContent    = document.getElementById('sp-new-content');
  const spNewSave       = document.getElementById('sp-new-save');
  const spNewCancel     = document.getElementById('sp-new-cancel');
  const pullInput       = document.getElementById('pull-model-input');
  const pullBtn         = document.getElementById('pull-btn');
  const pullStatus      = document.getElementById('pull-status');
  const downloadedModelsList = document.getElementById('downloaded-models-list');
  const chatModelSelect = document.getElementById('chat-model-select');
  const exportBtn       = document.getElementById('export-btn');
  const shortcutsBtn    = document.getElementById('shortcuts-btn');
  const shortcutsModal  = document.getElementById('shortcuts-modal');
  const shortcutsClose  = document.getElementById('shortcuts-close-btn');
  const settingsImageModel    = document.getElementById('settings-image-model');
  const pullImageModelBtn      = document.getElementById('pull-image-model-btn');
  const pullImageModelStatus   = document.getElementById('pull-image-model-status');
  const imageModelSelect       = document.getElementById('image-model-select');
  const settingsImagePerf      = document.getElementById('settings-image-perf');

  // Detect modifier key for display
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  if (!isMac) document.querySelectorAll('.sc-mod').forEach(el => el.textContent = 'Ctrl');

  // ── Local history store (IndexedDB) ───────────────────
  function readLegacyHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch { return []; }
  }

  function openHistoryDb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(HISTORY_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(HISTORY_STORE)) {
          const store = db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txStore(mode = 'readonly') {
    return historyDb.transaction(HISTORY_STORE, mode).objectStore(HISTORY_STORE);
  }

  function idbRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function readIndexedHistory() {
    if (!historyDb) return [];
    const items = await idbRequest(txStore().getAll());
    return items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  async function persistHistoryCache() {
    const items = historyCache.slice(0, getHistoryLimit());
    historyCache = items;
    if (!historyDb) {
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); } catch {}
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = historyDb.transaction(HISTORY_STORE, 'readwrite');
      const store = tx.objectStore(HISTORY_STORE);
      store.clear();
      for (const item of items) store.put(item);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).catch(() => {
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); } catch {}
    });
  }

  async function initHistoryStore() {
    const legacy = readLegacyHistory();
    try {
      historyDb = await openHistoryDb();
      historyCache = historyDb ? await readIndexedHistory() : legacy;
      if (legacy.length) {
        const merged = new Map(historyCache.map(item => [item.id, item]));
        for (const item of legacy) merged.set(item.id, item);
        historyCache = [...merged.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        await persistHistoryCache();
        localStorage.removeItem(HISTORY_KEY);
      }
    } catch {
      historyDb = null;
      historyCache = legacy;
    }
  }

  function getHistory() {
    return historyCache;
  }

  function setHistory(items) {
    historyCache = items.slice(0, getHistoryLimit());
    persistHistoryCache();
  }

  // ── Init ──────────────────────────────────────────────
  async function init() {
    const s = getSettings();
    activeModel       = s.model;
    activeContextSize = s.contextSize;
    activeUsername    = s.username;
    await initHistoryStore();
    setupListeners();
    applyDefaultSystemPrompt();
    renderTokenCounter({ input: 0, output: 0 });
    await refreshChatModelSelect(activeModel);
    refreshConnectionStatus();
    setInterval(refreshConnectionStatus, 30000);
    updateAttachForModel(activeModel);
    showWelcome();
    if (!activeUsername) {
      showNameModal();
    } else {
      fetchAndRenderTokens();
      inputEl.focus();
    }
  }

  // ── Name modal ────────────────────────────────────────
  function showNameModal() {
    nameModal.classList.remove('hidden');
    setTimeout(() => nameInput.focus(), 50);
  }
  function submitName() {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    activeUsername = name;
    const s = getSettings();
    s.username = name;
    persistSettings(s);
    nameModal.classList.add('hidden');
    document.getElementById('welcome')?.remove();
    showWelcome();
    fetchAndRenderTokens();
    inputEl.focus();
  }

  // ── Model capabilities ────────────────────────────────
  async function fetchModelCaps(model) {
    if (modelCaps[model]) return modelCaps[model];
    try {
      const r    = await fetch('/api/show', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ name: model }) });
      if (!r.ok) throw new Error(`Model metadata unavailable (${r.status})`);
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      // Newer Ollama: data.capabilities = ["completion","tools","vision",...]
      // Older Ollama: data.details.families includes "clip"
      const caps = data.capabilities || [];
      const fams = data.details?.families || [];
      const vision = caps.includes('vision') || fams.includes('clip');
      modelCaps[model] = { vision };
    } catch {
      modelCaps[model] = { vision: false };
    }
    return modelCaps[model];
  }

  async function updateAttachForModel(model) {
    // Set text/doc/audio types synchronously so the picker is correct before
    // the model-caps fetch resolves (avoids image-only window on slow start).
    const base = TEXT_ACCEPT + ',' + DOC_ACCEPT + ',' + AUDIO_ACCEPT;
    fileInput.accept = base;
    const caps = await fetchModelCaps(model);
    fileInput.accept = (caps.vision ? IMAGE_ACCEPT + ',' : '') + base;
  }

  async function fetchModelNames(selectedModel = activeModel) {
    const fallback = selectedModel || FALLBACK_MODEL;
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch('/api/models', { headers: authHeaders(), signal: ctrl.signal });
      const data = await r.json();
      const models = (data.models || []).map(m => m.name).filter(Boolean);
      if (!models.includes(fallback)) models.unshift(fallback);
      return models.length ? models : [fallback];
    } catch {
      return [fallback];
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function setChatModelOptions(models, selectedModel = activeModel) {
    if (!chatModelSelect) return;
    const selected = selectedModel || FALLBACK_MODEL;
    chatModelSelect.innerHTML = '';
    const uniqueModels = [...new Set(models.length ? models : [selected])];
    if (!uniqueModels.includes(selected)) uniqueModels.unshift(selected);
    for (const name of uniqueModels) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === selected) opt.selected = true;
      chatModelSelect.appendChild(opt);
    }
  }

  async function refreshChatModelSelect(selectedModel = activeModel) {
    const selected = selectedModel || FALLBACK_MODEL;
    const models = await fetchModelNames(selected);
    setChatModelOptions(models, selected);
  }

  // Returns true if two model names refer to the same model, ignoring :latest tag
  function modelNamesMatch(a, b) {
    if (!a || !b) return false;
    const norm = n => n.toLowerCase().replace(/:latest$/, '');
    return norm(a) === norm(b);
  }

  function isLikelyImageModelName(name) {
    if (!name) return false;
    const n = String(name).toLowerCase().replace(/:latest$/, '');
    return /^x\/(?:z-image-turbo|flux2-klein)$/.test(n)
      || /(?:^|\/|\b)(?:image|flux|sdxl|stable[-_ ]?diffusion|diffusion)(?:$|\b)/i.test(n);
  }

  async function refreshDownloadedModelsList() {
    if (!downloadedModelsList) return;
    downloadedModelsList.innerHTML = '<div class="downloaded-models-empty">Checking models…</div>';
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch('/api/models', { headers: authHeaders(), signal: ctrl.signal });
      const data = await r.json();
      if (!r.ok || data.offline) {
        downloadedModelsList.innerHTML = `<div class="downloaded-models-empty">${escHtml(data.error || 'Ollama is not reachable')}</div>`;
        if (imageModelSelect) imageModelSelect.innerHTML = '<option value="">— no image model selected —</option>';
        return;
      }
      const models = (data.models || []).map(m => m.name).filter(Boolean);

      // Resolve configured image model to exact Ollama name (handles :latest tag differences)
      const currentImageModel = getSettings().imageModel;
      const resolvedImageModel = models.find(m => modelNamesMatch(m, currentImageModel)) || '';

      // Auto-normalize: persist exact Ollama model name so future lookups are exact-match
      if (resolvedImageModel && resolvedImageModel !== currentImageModel) {
        persistSettings({ ...getSettings(), imageModel: resolvedImageModel });
      }

      // Populate image model selector with all downloaded models
      if (imageModelSelect) {
        imageModelSelect.innerHTML = '<option value="">— no image model selected —</option>' +
          models.map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
        imageModelSelect.value = resolvedImageModel;
      }

      // Show only non-image-model chat models in the downloaded list
      const effectiveImageModel = resolvedImageModel || currentImageModel;
      const chatModels = effectiveImageModel
        ? models.filter(m => !modelNamesMatch(m, effectiveImageModel))
        : models;

      if (!chatModels.length && !models.length) {
        downloadedModelsList.innerHTML = '<div class="downloaded-models-empty">No downloaded models found</div>';
        return;
      }
      if (!chatModels.length) {
        downloadedModelsList.innerHTML = '<div class="downloaded-models-empty">No chat models (only image model downloaded)</div>';
        return;
      }
      downloadedModelsList.innerHTML = chatModels
        .map(name => `<span class="downloaded-model-pill">${escHtml(name)}</span>`)
        .join('');
    } catch (e) {
      const message = e.name === 'AbortError' ? 'Timed out while checking models' : (e.message || 'Unable to load models');
      downloadedModelsList.innerHTML = `<div class="downloaded-models-empty">${escHtml(message)}</div>`;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function setActiveModel(model, { persistDefault = false, saveConversationModel = false, renderWelcome = true } = {}) {
    const nextModel = String(model || FALLBACK_MODEL);
    const changed = nextModel !== activeModel;
    activeModel = nextModel;
    if (chatModelSelect && chatModelSelect.value !== activeModel) {
      if (![...chatModelSelect.options].some(opt => opt.value === activeModel)) {
        chatModelSelect.appendChild(new Option(activeModel, activeModel));
      }
      chatModelSelect.value = activeModel;
    }
    if (persistDefault) persistSettings({ ...getSettings(), model: activeModel });
    if (saveConversationModel && currentConvId) updateConversationModel(currentConvId, activeModel);
    updateAttachForModel(activeModel);
    updateModelHealth();
    if (changed && renderWelcome) {
      document.getElementById('welcome')?.remove();
      if (!messages.length) showWelcome();
    }
  }

  function updateConversationModel(id, model) {
    const history = getHistory();
    const idx = history.findIndex(h => h.id === id);
    if (idx < 0) return;
    history[idx] = { ...history[idx], model };
    setHistory(history);
    if (sidebar.classList.contains('open')) renderHistoryList();
  }

  // ── Connection status ─────────────────────────────────
  function setConnectionState(state, label, title) {
    connectionPill.className = `connection-pill ${state}`;
    connectionText.textContent = label;
    connectionTip.textContent = title;
    connectionPill.setAttribute('aria-label', title);
  }

  async function refreshConnectionStatus() {
    setConnectionState('checking', 'Checking', 'Checking Ollama status');
    try {
      const resp = await fetch('/api/status', { cache: 'no-store', headers: authHeaders() });
      const data = await resp.json().catch(() => ({}));
      window.__offlineAiStatus = data;
      if (resp.ok && data.ollama) {
        const mode = data.lan ? 'LAN live' : 'Local';
        const exposure = data.lan ? 'Network access enabled' : 'Local-only mode';
        setConnectionState('online', mode, `${data.models_count || 0} Ollama model(s) available - ${exposure}`);
      } else {
        setConnectionState('offline', 'Ollama off', data.error || 'Ollama is not reachable');
      }
      updateModelHealth();
    } catch (e) {
      window.__offlineAiStatus = { ollama: false, error: e.message };
      setConnectionState('offline', 'Ollama off', e.message || 'Ollama is not reachable');
      updateModelHealth();
    }
  }

  async function updateModelHealth() {
    if (!modelHealth) return;
    const status = window.__offlineAiStatus || {};
    const displayedModel = activeModel;
    const caps = status.ollama ? await fetchModelCaps(displayedModel) : { vision: false };
    const storage = historyDb ? 'IndexedDB' : 'localStorage fallback';
    const access = status.lan
      ? (status.auth_required ? 'LAN + token' : 'LAN')
      : 'Local only';
    modelHealth.innerHTML = `
      <div class="health-row"><span>Ollama</span><strong>${status.ollama ? 'Online' : 'Offline'}</strong></div>
      <div class="health-row"><span>Chat model</span><strong>${escHtml(displayedModel)}</strong></div>
      <div class="health-row"><span>Models</span><strong>${status.models_count ?? '—'}</strong></div>
      <div class="health-row"><span>Vision</span><strong>${caps.vision ? 'Supported' : 'Text only'}</strong></div>
      <div class="health-row"><span>Access</span><strong>${escHtml(access)}</strong></div>
      <div class="health-row"><span>History</span><strong>${storage}</strong></div>`;
  }

  // ── Settings panel ────────────────────────────────────
  async function openSettings() {
    const s = getSettings();
    settingsName.value = s.username;
    settingsCtx.value  = s.contextSize;
    settingsTemp.value = s.temperature;
    settingsTopP.value = s.topP;
    settingsMaxTokens.value = s.maxTokens;
    settingsNumCtx.value = s.numCtx;
    settingsHistoryLimit.value = s.historyLimit;
    settingsAutoTitle.checked = s.autoTitle;
    if (settingsImagePerf) settingsImagePerf.value = s.imagePerfProfile;
    // imageModelSelect is populated by refreshDownloadedModelsList (called below)
    renderSpSavedList();
    renderSpSelect();
    updateModelHealth();
    refreshDownloadedModelsList();
    settingsPanel.classList.add('open');
    settingsOver.classList.add('open');
  }
  function closeSettings() {
    settingsPanel.classList.remove('open');
    settingsOver.classList.remove('open');
  }
  function saveSettingsUI() {
    const name  = settingsName.value.trim();
    const ctx   = clampInt(settingsCtx.value, 4, 100, DEFAULT_SETTINGS.contextSize);
    const nextSettings = normalizeSettings({
      ...getSettings(),
      username: name,
      contextSize: ctx,
      temperature: settingsTemp.value,
      topP: settingsTopP.value,
      maxTokens: settingsMaxTokens.value,
      numCtx: settingsNumCtx.value,
      historyLimit: settingsHistoryLimit.value,
      autoTitle: settingsAutoTitle.checked,
      imageModel: (imageModelSelect?.value) || getSettings().imageModel,
      imagePerfProfile: settingsImagePerf?.value || getSettings().imagePerfProfile
    });
    const nameChanged = name !== activeUsername;
    persistSettings(nextSettings);
    activeContextSize = nextSettings.contextSize;
    activeUsername    = nextSettings.username;
    setHistory(historyCache);
    if (nameChanged) {
      document.getElementById('welcome')?.remove();
      if (!messages.length) showWelcome();
    }
    updateModelHealth();
    closeSettings();
  }

  // ── Saved prompts ─────────────────────────────────────
  function getSavedPrompts() {
    try { return JSON.parse(localStorage.getItem(PROMPTS_KEY) || '[]'); }
    catch { return []; }
  }
  function persistSavedPrompts(arr) {
    try { localStorage.setItem(PROMPTS_KEY, JSON.stringify(arr)); } catch {}
  }
  function renderSpSavedList() {
    const items = getSavedPrompts();
    const defaultId = getSettings().defaultPromptId;
    if (!items.length) {
      spSavedList.innerHTML = '<div class="sp-saved-empty">No saved prompts yet</div>';
      return;
    }
    spSavedList.innerHTML = '';
    items.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'sp-saved-item';
      row.innerHTML = `
        <span class="sp-saved-name">${escHtml(p.name)}</span>
        <button class="sp-saved-default ${p.id === defaultId ? 'active' : ''}" title="Default prompt" aria-label="Default prompt">★</button>
        <button class="sp-saved-up" title="Move up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="sp-saved-down" title="Move down" aria-label="Move down" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="sp-saved-copy" title="Duplicate" aria-label="Duplicate">⧉</button>
        <button class="sp-saved-edit" title="Edit" aria-label="Edit">✎</button>
        <button class="sp-saved-del" title="Delete" aria-label="Delete">✕</button>`;
      row.querySelector('.sp-saved-default').addEventListener('click', () => {
        const s = getSettings();
        s.defaultPromptId = s.defaultPromptId === p.id ? '' : p.id;
        persistSettings(s);
        if (!currentConvId) applyDefaultSystemPrompt();
        renderSpSavedList();
        renderSpSelect();
      });
      row.querySelector('.sp-saved-up').addEventListener('click', () => movePrompt(i, -1));
      row.querySelector('.sp-saved-down').addEventListener('click', () => movePrompt(i, 1));
      row.querySelector('.sp-saved-copy').addEventListener('click', () => duplicatePrompt(i));
      row.querySelector('.sp-saved-edit').addEventListener('click', () => openSpEditForm(i));
      row.querySelector('.sp-saved-del').addEventListener('click', () => {
        const updated = getSavedPrompts().filter((_, j) => j !== i);
        persistSavedPrompts(updated);
        if (getSettings().defaultPromptId === p.id) persistSettings({ ...getSettings(), defaultPromptId: '' });
        if (currentSystemPromptId === p.id) resetSystemPrompt(false);
        renderSpSavedList();
        renderSpSelect();
      });
      spSavedList.appendChild(row);
    });
  }

  function movePrompt(idx, delta) {
    const prompts = getSavedPrompts();
    const next = idx + delta;
    if (next < 0 || next >= prompts.length) return;
    [prompts[idx], prompts[next]] = [prompts[next], prompts[idx]];
    persistSavedPrompts(prompts);
    renderSpSavedList();
    renderSpSelect();
  }

  function duplicatePrompt(idx) {
    const prompts = getSavedPrompts();
    const p = prompts[idx];
    if (!p) return;
    prompts.splice(idx + 1, 0, { id: String(Date.now()), name: `${p.name} copy`, content: p.content });
    persistSavedPrompts(prompts);
    renderSpSavedList();
    renderSpSelect();
  }
  function renderSpSelect() {
    const active = currentSystemPromptId;
    const defaultId = getSettings().defaultPromptId;
    spSelect.innerHTML = '<option value="">— none —</option>';
    for (const p of getSavedPrompts()) {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.id === defaultId ? `${p.name} ★` : p.name;
      if (p.id === active) opt.selected = true;
      spSelect.appendChild(opt);
    }
    spSelect.classList.toggle('active', !!active);
  }

  // editing index (-1 = new prompt)
  let editingSpIdx = -1;

  function openSpEditForm(idx) {
    const p = getSavedPrompts()[idx];
    editingSpIdx = idx;
    spNewName.value    = p.name;
    spNewContent.value = p.content;
    spNewForm.classList.remove('hidden');
    spAddBtn.classList.add('hidden');
    spNewSave.textContent = 'Update prompt';
    spNewName.focus();
  }

  // ── System prompt ─────────────────────────────────────
  function resetSystemPrompt(useDefault = true) {
    if (useDefault && applyDefaultSystemPrompt()) return;
    currentSystemPrompt   = '';
    currentSystemPromptId = '';
    renderSpSelect();
  }

  function applyDefaultSystemPrompt() {
    const id = getSettings().defaultPromptId;
    if (!id) { renderSpSelect(); return false; }
    const p = getSavedPrompts().find(x => x.id === id);
    if (!p) {
      persistSettings({ ...getSettings(), defaultPromptId: '' });
      renderSpSelect();
      return false;
    }
    currentSystemPrompt = p.content;
    currentSystemPromptId = p.id;
    renderSpSelect();
    return true;
  }
  function setSystemPromptById(id) {
    const p = getSavedPrompts().find(x => x.id === id);
    if (p) {
      currentSystemPrompt   = p.content;
      currentSystemPromptId = p.id;
    } else {
      currentSystemPrompt   = '';
      currentSystemPromptId = '';
    }
    renderSpSelect();
  }

  // ── Export conversation ───────────────────────────────
  function exportConversation() {
    if (!messages.length) return;
    const history = getHistory();
    const conv    = history.find(h => h.id === currentConvId);
    const title   = conv?.title || 'Conversation';
    const date    = new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
    let md = `# ${title}\n\n**Model:** ${activeModel}  \n**Date:** ${date}\n\n---\n\n`;
    for (const msg of messages) {
      if (msg.role === 'user')      md += `**You:** ${msg.content}\n\n`;
      else if (msg.role === 'assistant') md += `**AI:** ${msg.content}\n\n`;
    }
    const blob = new Blob([md], { type: 'text/markdown' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = title.replace(/[^a-z0-9]/gi, '_').slice(0, 60) + '.md';
    a.click(); URL.revokeObjectURL(url);
  }

  // ── Keyboard shortcuts modal ──────────────────────────
  function showShortcuts() { shortcutsModal.classList.remove('hidden'); }
  function closeShortcuts() { shortcutsModal.classList.add('hidden'); }

  function toggleFocusMode() {
    document.body.classList.toggle('focus-mode');
  }

  // ── Model pull ────────────────────────────────────────
  async function _doPull(name, btnEl, statusEl) {
    btnEl.disabled = true;
    statusEl.classList.remove('hidden', 'success', 'error');
    statusEl.textContent = 'Connecting…';
    try {
      const resp = await fetch('/api/pull', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name, stream: true })
      });
      const reader = resp.body.getReader();
      const dec    = new TextDecoder();
      let   buf    = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const d = JSON.parse(line);
            if (d.error) {
              statusEl.textContent = `Error: ${d.error}`;
              statusEl.classList.add('error');
              return false;
            }
            if (d.status) {
              statusEl.textContent = (d.total && d.completed)
                ? `${d.status} — ${Math.round((d.completed / d.total) * 100)}%`
                : d.status;
            }
          } catch { /* malformed */ }
        }
      }
      statusEl.textContent = `✓ ${name} ready`;
      statusEl.classList.add('success');
      return true;
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
      statusEl.classList.add('error');
      return false;
    } finally {
      btnEl.disabled = false;
    }
  }

  async function pullModel(modelName) {
    const name = modelName.trim();
    if (!name) { pullInput.focus(); return; }
    const ok = await _doPull(name, pullBtn, pullStatus);
    if (ok) {
      pullInput.value = '';
      refreshConnectionStatus();
      await refreshChatModelSelect(activeModel);
      await refreshDownloadedModelsList();
    }
  }

  async function pullImageModel() {
    const name = (settingsImageModel?.value || '').trim();
    if (!name) { settingsImageModel?.focus(); return; }
    const ok = await _doPull(name, pullImageModelBtn, pullImageModelStatus);
    if (ok) {
      if (settingsImageModel) settingsImageModel.value = '';
      refreshConnectionStatus();
      await refreshDownloadedModelsList();
      // Auto-select the newly pulled model (Ollama may have added :latest)
      if (imageModelSelect) {
        const match = [...imageModelSelect.options].find(o => modelNamesMatch(o.value, name));
        if (match) {
          imageModelSelect.value = match.value;
          persistSettings({ ...getSettings(), imageModel: match.value });
        }
      }
    }
  }

  async function restartOllama() {
    restartOllamaBtn.disabled = true;
    restartStatus.classList.remove('hidden', 'success', 'error');
    restartStatus.textContent = 'Restarting Ollama…';
    try {
      const resp = await fetch('/api/ollama/restart', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) {
        throw new Error(data.error || data.message || `Restart failed (${resp.status})`);
      }
      restartStatus.textContent = data.message || 'Ollama restarted';
      restartStatus.classList.add('success');
      delete modelCaps[activeModel];
      await refreshConnectionStatus();
      await refreshChatModelSelect(activeModel);
      await refreshDownloadedModelsList();
      updateAttachForModel(activeModel);
    } catch (e) {
      restartStatus.textContent = `Error: ${e.message}`;
      restartStatus.classList.add('error');
      refreshConnectionStatus();
    } finally {
      restartOllamaBtn.disabled = false;
    }
  }

  // ── Listeners ─────────────────────────────────────────
  function setupListeners() {
    sendBtn.addEventListener('click', sendMessage);
    stopBtn.addEventListener('click', () => abortCtrl?.abort());
    clearBtn.addEventListener('click', startNewChat);
    newChatBtn.addEventListener('click', () => { startNewChat(); closeSidebar(); });
    historyBtn.addEventListener('click', toggleSidebar);
    historySearch.addEventListener('input', () => {
      historySearchTerm = historySearch.value.trim().toLowerCase();
      renderHistoryList();
    });
    sidebarClose.addEventListener('click', closeSidebar);
    sidebarOver.addEventListener('click', closeSidebar);
    settingsBtn.addEventListener('click', openSettings);
    settingsClose.addEventListener('click', closeSettings);
    settingsOver.addEventListener('click', closeSettings);
    settingsSave.addEventListener('click', saveSettingsUI);
    restartOllamaBtn.addEventListener('click', restartOllama);
    // Reset token counter is only meaningful on the host machine; hide it for network clients.
    const isLocalhost = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
    if (!isLocalhost) resetTokensBtn.style.display = 'none';
    resetTokensBtn.addEventListener('click', async () => {
      if (!activeUsername) return;
      await fetch(`/api/tokens?user=${encodeURIComponent(activeUsername)}`, {
        method: 'DELETE', headers: authHeaders()
      }).catch(() => {});
      renderTokenCounter({ input: 0, output: 0 });
    });
    clearHistBtn.addEventListener('click', () => {
      if (!confirm('Clear all conversation history? This cannot be undone.')) return;
      setHistory([]);
      if (currentConvId) startNewChat();
      closeSettings();
    });
    nameBtn.addEventListener('click', submitName);
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitName(); });
    chatModelSelect.addEventListener('change', () => {
      if (isStreaming) {
        chatModelSelect.value = activeModel;
        return;
      }
      const persistDefault = !currentConvId && !messages.length;
      setActiveModel(chatModelSelect.value, { persistDefault, saveConversationModel: true });
    });
    spSelect.addEventListener('change', () => setSystemPromptById(spSelect.value));
    spAddBtn.addEventListener('click', () => {
      editingSpIdx = -1;
      spNewName.value = ''; spNewContent.value = '';
      spNewSave.textContent = 'Save prompt';
      spNewForm.classList.remove('hidden');
      spAddBtn.classList.add('hidden');
      spNewName.focus();
    });
    spNewCancel.addEventListener('click', () => {
      spNewForm.classList.add('hidden');
      spAddBtn.classList.remove('hidden');
      spNewName.value = ''; spNewContent.value = '';
      editingSpIdx = -1;
      spNewSave.textContent = 'Save prompt';
    });
    spNewSave.addEventListener('click', () => {
      const name    = spNewName.value.trim();
      const content = spNewContent.value.trim();
      if (!name || !content) { (name ? spNewContent : spNewName).focus(); return; }
      const prompts = getSavedPrompts();
      if (editingSpIdx >= 0) {
        const existingId = prompts[editingSpIdx].id;
        prompts[editingSpIdx] = { id: existingId, name, content };
        // If this prompt is active, refresh currentSystemPrompt
        if (currentSystemPromptId === existingId) currentSystemPrompt = content;
      } else {
        prompts.push({ id: String(Date.now()), name, content });
      }
      persistSavedPrompts(prompts);
      editingSpIdx = -1;
      spNewSave.textContent = 'Save prompt';
      renderSpSavedList();
      renderSpSelect();
      spNewForm.classList.add('hidden');
      spAddBtn.classList.remove('hidden');
      spNewName.value = ''; spNewContent.value = '';
    });

    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      const files = [...e.target.files];
      if (files.length) addFiles(files);
      e.target.value = '';
    });

    exportBtn.addEventListener('click', exportConversation);
    shortcutsBtn.addEventListener('click', showShortcuts);
    shortcutsClose.addEventListener('click', closeShortcuts);
    shortcutsModal.addEventListener('click', e => { if (e.target === shortcutsModal) closeShortcuts(); });
    pullBtn.addEventListener('click', () => pullModel(pullInput.value));
    pullInput.addEventListener('keydown', e => { if (e.key === 'Enter') pullModel(pullInput.value); });
    if (pullImageModelBtn) pullImageModelBtn.addEventListener('click', pullImageModel);
    if (settingsImageModel) settingsImageModel.addEventListener('keydown', e => { if (e.key === 'Enter') pullImageModel(); });

    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    inputEl.addEventListener('input', () => autoResize(inputEl));

    // Drag & drop
    let dragCount = 0;
    document.addEventListener('dragenter', e => {
      const hasFile = [...(e.dataTransfer?.items || [])].some(i => i.kind === 'file');
      if (hasFile) { dragCount++; document.body.classList.add('drag-active'); }
    });
    document.addEventListener('dragleave', () => {
      dragCount = Math.max(0, dragCount - 1);
      if (!dragCount) document.body.classList.remove('drag-active');
    });
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => {
      e.preventDefault(); dragCount = 0;
      document.body.classList.remove('drag-active');
      const files = [...e.dataTransfer.files];
      if (files.length) addFiles(files);
    });

    // Paste
    document.addEventListener('paste', e => {
      const items = [...e.clipboardData.items];
      const imgs = items.filter(i => i.type.startsWith('image/'));
      if (imgs.length) { e.preventDefault(); addFiles(imgs.map(i => i.getAsFile())); }
    });

    // Lightbox
    messagesEl.addEventListener('click', e => {
      if (e.target.matches('.msg-images img')) {
        lightboxImg.src = e.target.src;
        lightbox.classList.add('open');
      }
    });
    lightbox.addEventListener('click', () => lightbox.classList.remove('open'));

    document.addEventListener('keydown', e => {
      const inInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
      const mod     = isMac ? e.metaKey : e.ctrlKey;

      if (e.key === 'Escape') {
        lightbox.classList.remove('open');
        closeSidebar();
        closeSettings();
        closeShortcuts();
        if (!nameModal.classList.contains('hidden') && activeUsername) nameModal.classList.add('hidden');
      }
      if (!inInput && e.key === '?')       { e.preventDefault(); showShortcuts(); }
      if (mod && e.key === 'k')            { e.preventDefault(); startNewChat(); }
      if (mod && e.key === 'l')            { e.preventDefault(); toggleSidebar(); }
      if (mod && e.key === 'e')            { e.preventDefault(); exportConversation(); }
      if (mod && e.key === '/')            { e.preventDefault(); inputEl.focus(); }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFocusMode(); }
    });
  }

  // ── Sidebar ───────────────────────────────────────────
  function toggleSidebar() {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  }
  function openSidebar() {
    renderHistoryList();
    sidebar.classList.add('open');
    sidebarOver.classList.add('open');
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOver.classList.remove('open');
  }

  function renderHistoryList() {
    const allItems = getHistory();
    const items = historySearchTerm
      ? allItems.filter(item => {
          const haystack = [
            item.title,
            item.model || FALLBACK_MODEL,
            ...(item.messages || []).map(m => m.content)
          ].join(' ').toLowerCase();
          return haystack.includes(historySearchTerm);
        })
      : allItems;
    if (!allItems.length) {
      historyList.innerHTML = '<div class="history-empty">No conversations yet</div>';
      return;
    }
    if (!items.length) {
      historyList.innerHTML = '<div class="history-empty">No matches</div>';
      return;
    }
    historyList.innerHTML = '';
    for (const item of items) {
      const div = document.createElement('div');
      div.className = 'history-item' + (item.id === currentConvId ? ' active' : '');
      div.innerHTML = `
        <div class="history-item-main">
          <div class="history-title">${escHtml(item.title)}</div>
          <div class="history-meta">
            <span>${escHtml(formatDate(item.timestamp))}</span>
            <span>${escHtml(item.model || FALLBACK_MODEL)}</span>
          </div>
        </div>
        <button class="history-del-btn" title="Delete conversation" aria-label="Delete">✕</button>`;
      div.querySelector('.history-item-main').addEventListener('click', () => loadConversation(item));
      div.querySelector('.history-del-btn').addEventListener('click', e => {
        e.stopPropagation();
        const h = getHistory().filter(x => x.id !== item.id);
        setHistory(h);
        if (currentConvId === item.id) { startNewChat(); closeSidebar(); return; }
        renderHistoryList();
      });
      historyList.appendChild(div);
    }
  }

  function loadConversation(item) {
    if (isStreaming) return;
    messages = (item.messages || []).map(m => ({ ...m }));
    currentConvId = item.id;
    setActiveModel(item.model || getSettings().model || FALLBACK_MODEL);
    setSystemPromptById(item.systemPromptId || '');
    messagesEl.innerHTML = '';
    messages.forEach((msg, idx) => {
      if (msg.role === 'user') {
        appendUserBubble(msg, [], idx);
      } else if (msg.role === 'assistant') {
        appendAssistantBubble(msg, idx);
      }
    });
    closeSidebar();
    scrollBottom();
  }

  // ── History persistence ───────────────────────────────
  function saveToHistory() {
    if (!messages.length) return;
    const history = getHistory();
    const isNew = !currentConvId;
    const id = currentConvId || String(Date.now());
    currentConvId = id;
    // Strip base64 images to avoid localStorage bloat
    const stripped = messages.map(({ images, generatedImage, ...rest }) => rest);
    const existing = history.find(h => h.id === id);
    const title = existing?.title || stripped[0]?.content?.trim().slice(0, 72) || 'Image conversation';
    const entry = { id, title, timestamp: Date.now(), model: activeModel, messages: stripped, systemPrompt: currentSystemPrompt, systemPromptId: currentSystemPromptId };
    const idx = history.findIndex(h => h.id === id);
    if (idx >= 0) history[idx] = entry; else history.unshift(entry);
    setHistory(history);
    // Generate an AI title only once, after the first full exchange
    if (getSettings().autoTitle && isNew && stripped.length >= 2) {
      generateTitle(stripped).then(title => {
        if (!title) return;
        const h = getHistory();
        const i = h.findIndex(x => x.id === id);
        if (i >= 0) { h[i].title = title; }
        setHistory(h);
        if (sidebar.classList.contains('open')) renderHistoryList();
      });
    }
  }

  async function generateTitle(stripped) {
    const excerpt = stripped.slice(0, 2)
      .map(m => `${m.role}: ${m.content.slice(0, 400)}`).join('\n');
    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: activeModel,
          messages: [{
            role: 'user',
            content: `Give this conversation a short title of 4 words or less. Reply with the title only — no punctuation, no quotes, no explanation:\n\n${excerpt}`
          }],
          stream: false,
          options: { temperature: 0.2, top_p: 0.9, num_predict: 16 },
          ...(activeUsername ? { user: activeUsername } : {})
        })
      });
      const text = await resp.text();
      // stream:false returns one JSON line
      const d = JSON.parse(text.trim().split('\n')[0]);
      fetchAndRenderTokens();
      const title = d.message?.content?.trim().replace(/^["']+|["']+$/g, '').slice(0, 72);
      return title || null;
    } catch {
      return null;
    }
  }

  function formatDate(ts) {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // ── File helpers ──────────────────────────────────────
  async function addFiles(files) {
    const caps = await fetchModelCaps(activeModel);
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        if (caps.vision) {
          const dataUrl = await readImageDataUrl(file);
          pendingImages.push({ dataUrl, base64: dataUrl.split(',')[1] });
        }
      } else if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|opus|m4a|flac|aac|webm)$/i.test(file.name)) {
        pendingAudio.push({ name: file.name, file });
      } else {
        pendingFiles.push({ name: file.name, file });
      }
    }
    renderPreviews();
  }

  // Convenience alias kept for drag/paste image paths
  async function addImages(files) { await addFiles(files); }

  async function readImageDataUrl(file) {
    return await readDataUrl(file);
  }

  function readDataUrl(file) {
    return new Promise(resolve => {
      const r = new FileReader();
      r.onload = e => resolve(e.target.result);
      r.readAsDataURL(file);
    });
  }

  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = e => resolve(e.target.result);
      r.onerror = reject;
      r.readAsText(file);
    });
  }

  const DOC_FILE_RE = /\.(docx|odt|ods|odp|pdf)$/i;

  function readFileContent(f) {
    return DOC_FILE_RE.test(f.name) ? extractDocText(f.file, f.name) : readTextFile(f.file);
  }

  async function extractDocText(file, name) {
    const form = new FormData();
    form.append('file', file, name);
    const r = await fetch('/api/extract', { method: 'POST', headers: authHeaders(), body: form });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || `Extraction failed (${r.status})`);
    }
    const data = await r.json();
    return data.text;
  }

  async function transcribeWithProgress({ file, name }, chipEl) {
    // Inject a progress bar into the chip and update it via SSE.
    const label = chipEl?.querySelector('.file-thumb-name');
    let bar = null;
    if (chipEl) {
      bar = document.createElement('div');
      bar.className = 'transcribe-bar';
      chipEl.appendChild(bar);
      if (label) label.textContent = '\uD83C\uDF99\uFE0F 0%';
    }

    const form = new FormData();
    form.append('file', file, name);
    const r = await fetch('/api/transcribe', { method: 'POST', headers: authHeaders(), body: form });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || `Transcription failed (${r.status})`);
    }

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let transcript = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let evt;
        try { evt = JSON.parse(line.slice(6)); } catch { continue; }
        if (evt.type === 'progress') {
          if (label) label.textContent = `\uD83C\uDF99\uFE0F ${evt.percent}%`;
          if (bar) bar.style.width = `${evt.percent}%`;
        } else if (evt.type === 'done') {
          transcript = evt.transcript;
          if (label) label.textContent = '\u2713 Done';
          if (bar) bar.style.width = '100%';
        } else if (evt.type === 'error') {
          throw new Error(evt.error);
        }
      }
    }
    return transcript;
  }

  function renderPreviews() {
    previewsEl.innerHTML = '';
    if (!pendingImages.length && !pendingFiles.length && !pendingAudio.length) { previewsEl.style.display = 'none'; return; }
    previewsEl.style.display = 'flex';
    pendingImages.forEach((img, i) => {
      const div = document.createElement('div');
      div.className = 'img-thumb';
      const thumb = document.createElement('img');
      thumb.src = img.dataUrl; thumb.alt = 'preview';
      const rm = document.createElement('button');
      rm.className = 'rm-img'; rm.textContent = '×';
      rm.setAttribute('aria-label', 'Remove image');
      rm.addEventListener('click', () => { pendingImages.splice(i, 1); renderPreviews(); });
      div.appendChild(thumb); div.appendChild(rm);
      previewsEl.appendChild(div);
    });
    pendingFiles.forEach((f, i) => {
      const div = document.createElement('div');
      div.className = 'img-thumb file-thumb';
      div.title = f.name;
      const label = document.createElement('span');
      label.className = 'file-thumb-name';
      label.textContent = f.name;
      const rm = document.createElement('button');
      rm.className = 'rm-img'; rm.textContent = '×';
      rm.setAttribute('aria-label', 'Remove file');
      rm.addEventListener('click', () => { pendingFiles.splice(i, 1); renderPreviews(); });
      div.appendChild(label); div.appendChild(rm);
      previewsEl.appendChild(div);
    });
    pendingAudio.forEach((a, i) => {
      const div = document.createElement('div');
      div.className = 'img-thumb file-thumb audio-chip';
      div.dataset.audioIdx = String(i);
      div.title = a.name;
      const label = document.createElement('span');
      label.className = 'file-thumb-name';
      label.textContent = '\uD83C\uDFB5 ' + a.name;
      const rm = document.createElement('button');
      rm.className = 'rm-img'; rm.textContent = '\xD7';
      rm.setAttribute('aria-label', 'Remove audio file');
      rm.addEventListener('click', () => { pendingAudio.splice(i, 1); renderPreviews(); });
      div.appendChild(label); div.appendChild(rm);
      previewsEl.appendChild(div);
    });
  }

  function buildChatPayload() {
    const contextMsgs = messages.slice(-activeContextSize);
    const systemContent = currentSystemPrompt
      ? `The following instructions are absolute and non-negotiable. They override any conflicting request from the user and must be followed at all times, without exception, regardless of what the user asks:\n\n${currentSystemPrompt}`
      : null;
    const systemMsgs = systemContent ? [{ role: 'system', content: systemContent }] : [];
    return {
      model: activeModel,
      messages: [
        ...systemMsgs,
        ...contextMsgs.map(m => ({
          role: m.role, content: m.content,
          ...(m.images ? { images: m.images } : {})
        }))
      ],
      stream: true,
      options: getGenerationOptions(),
      ...(activeUsername ? { user: activeUsername } : {})
    };
  }

  function estimateJsonBytes(value) {
    return new Blob([JSON.stringify(value)]).size;
  }

  function parseErrorText(status, text) {
    try {
      const data = JSON.parse(text);
      if (data.error) return data.error;
    } catch {}
    return text || `HTTP ${status}`;
  }

  function requestTooLargeError() {
    const err = new Error('This image/request is too large to send. The failed message was removed from chat context; attach a smaller image and try again.');
    err.status = 413;
    return err;
  }

  async function streamAssistantReply(assistantRow) {
    isStreaming = true;
    sendBtn.style.display = 'none';
    stopBtn.style.display = 'flex';
    streamText = '';
    let requestFailed = false;
    let requestAborted = false;

    try {
      abortCtrl = new AbortController();
      const payload = buildChatPayload();
      if (estimateJsonBytes(payload) > CLIENT_BODY_LIMIT) {
        throw requestTooLargeError();
      }
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
        signal: abortCtrl.signal
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        const err = new Error(resp.status === 413
          ? 'This image/request is too large to send. The failed message was removed from chat context; attach a smaller image and try again.'
          : `Server error ${resp.status}: ${parseErrorText(resp.status, errText)}`);
        err.status = resp.status;
        throw err;
      }
      assistantRow.querySelector('.thinking')?.remove();
      streamEl = document.createElement('div');
      streamEl.className = 'msg-text streaming';
      assistantRow.querySelector('.message-body').appendChild(streamEl);

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const d = JSON.parse(line);
            if (d.error) {
              streamEl.textContent = `⚠️ ${d.error}`;
              streamEl.classList.add('error');
              streamText = '';
              requestFailed = true;
              return;
            }
            if (d.done) fetchAndRenderTokens();
            if (d.message?.content) {
              streamText += d.message.content;
              streamEl.appendChild(document.createTextNode(d.message.content));
              scrollBottom();
            }
          } catch { /* malformed chunk */ }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        requestAborted = true;
        if (!streamText) assistantRow.remove();
      } else {
        requestFailed = true;
        const errMsg = `⚠️ ${err.message}`;
        if (streamEl) {
          streamText = errMsg;
          streamEl.textContent = errMsg;
          streamEl.classList.add('error');
        } else {
          assistantRow.querySelector('.thinking')?.remove();
          const el = document.createElement('div');
          el.className = 'msg-text error';
          el.textContent = errMsg;
          assistantRow.querySelector('.message-body').appendChild(el);
        }
        streamText = '';
      }
    } finally {
      isStreaming = false;
      sendBtn.style.display = 'flex';
      stopBtn.style.display = 'none';

      let assistantSaved = false;
      if (streamEl && streamText && !streamEl.classList.contains('error')) {
        streamEl.classList.remove('streaming');
        streamEl.innerHTML = DOMPurify.sanitize(renderMd(streamText));
        streamEl.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
        streamEl.querySelectorAll('pre').forEach(addCopyBtn);
        messages.push({ role: 'assistant', content: streamText });
        assistantRow.dataset.msgIndex = String(messages.length - 1);
        addMessageActions(assistantRow, messages[messages.length - 1]);
        saveToHistory();
        assistantSaved = true;
      } else if (streamText && !streamEl?.classList.contains('error')) {
        messages.push({ role: 'assistant', content: streamText });
        assistantRow.dataset.msgIndex = String(messages.length - 1);
        addMessageActions(assistantRow, messages[messages.length - 1]);
        saveToHistory();
        assistantSaved = true;
      }

      if (!assistantSaved && messages[messages.length - 1]?.role === 'user') {
        if (requestFailed && !requestAborted) {
          messages.pop();
        } else {
          saveToHistory();
        }
      }

      if (requestFailed && currentConvId && messages.length) {
        saveToHistory();
      }

      abortCtrl = null;
      streamEl = null;
      streamText = '';
      scrollBottom();
      inputEl.focus();
    }
  }

  // ── Image generation ──────────────────────────────────
  function isImageRequest(text) {
    const t = text.trim();
    // Explicit slash commands
    if (/^\/(?:image|img|draw|paint)\s+/i.test(t)) return true;
    // Action verb + image noun (extended)
    if (/\b(?:generate|create|make|draw|paint|render|illustrate|design|visualize|visualise|depict|photograph|sketch|produce)\b.{0,80}\b(?:image|picture|photo|illustration|painting|drawing|artwork|portrait|wallpaper|scene|landscape|sketch|logo|banner|graphic|thumbnail|avatar|icon|meme|anime|cartoon|animation|photograph)\b/i.test(t)) return true;
    // "a/an image/photo/picture of"
    if (/\b(?:an?\s+)?(?:image|photo|picture|illustration|painting|drawing|artwork)\s+of\b/i.test(t)) return true;
    // "draw/paint/illustrate/render/design (me) a/an ..."
    if (/\b(?:draw|paint|illustrate|render|design|sketch)\s+(?:me\s+)?(?:a\s+|an\s+)/i.test(t)) return true;
    // "generate (me) a/an image/picture/photo"
    if (/\bgenerate\s+(?:me\s+)?(?:a\s+|an\s+)?(?:image|picture|photo)\b/i.test(t)) return true;
    // "show me a/an picture/image/photo of"
    if (/\bshow\s+me\s+(?:a\s+|an\s+)?(?:picture|image|photo|illustration)\b/i.test(t)) return true;
    // "can you draw/paint/create/make/generate/design ..."
    if (/\bcan\s+you\s+(?:draw|paint|create|make|generate|illustrate|render|design|sketch)\b/i.test(t)) return true;
    // "I want (to see) a picture/image"
    if (/\bI\s+want\s+(?:to\s+see\s+)?(?:a\s+|an\s+)?(?:picture|image|photo|illustration|drawing|painting)\b/i.test(t)) return true;
    // "create/make/generate a visual"
    if (/\b(?:create|make|generate)\s+(?:a\s+|an\s+)?visual\b/i.test(t)) return true;
    return false;
  }

  function parseFirstNdjsonObject(raw) {
    const firstLine = String(raw || '').trim().split('\n').find(Boolean) || '{}';
    try { return JSON.parse(firstLine); }
    catch { return {}; }
  }

  function extractImagePayload(payload) {
    const raw = payload?.image
      || (Array.isArray(payload?.images) ? payload.images[0] : null)
      || (typeof payload?.images === 'string' ? payload.images : null)
      || (typeof payload?.response === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(payload.response) ? payload.response : null);
    if (!raw || typeof raw !== 'string') return null;
    return raw.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').replace(/\s+/g, '');
  }

  function buildImageRefinementContext(currentText) {
    const contextMsgs = messages
      .slice(-activeContextSize)
      .map(m => ({ role: m.role, content: String(m.content || '').trim() }))
      .filter(m => m.content);

    // Avoid duplicating the current request if it was already appended to messages.
    if (!contextMsgs.length || contextMsgs[contextMsgs.length - 1].content !== currentText.trim()) {
      contextMsgs.push({ role: 'user', content: currentText.trim() });
    }

    // Keep context compact to prevent prompt bloat during refinement.
    const compact = contextMsgs
      .map(m => `${m.role.toUpperCase()}: ${m.content.replace(/\s+/g, ' ')}`)
      .join('\n')
      .slice(-6000);

    return compact;
  }

  async function refineImagePrompt(text, signal) {
    const contextSummary = buildImageRefinementContext(text);
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model: activeModel,
        messages: [
          { role: 'system', content: 'You are an expert image prompt engineer. Use the recent conversation context to infer references, subjects, style, and constraints. Convert the latest user image request into one detailed, vivid image-generation prompt. Reply with ONLY the final prompt text: no explanations, no bullets, no quotes, no preamble. Keep it under 200 words.' },
          {
            role: 'user',
            content: `Recent conversation context (latest ${activeContextSize} messages):\n${contextSummary}\n\nLatest image request:\n${text}`
          }
        ],
        stream: true,
        options: { temperature: 0.7, top_p: 0.9, num_predict: 200 },
        ...(activeUsername ? { user: activeUsername } : {})
      }),
      signal
    });

    if (!resp.ok) throw new Error(`Text model "${activeModel}" returned HTTP ${resp.status}`);

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let content = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let chunk;
        try { chunk = JSON.parse(line); } catch { continue; }
        if (chunk.error) throw new Error(`Text model error during prompt enhancement: ${chunk.error}`);
        if (chunk.message?.content) content += chunk.message.content;
      }
    }
    if (buf.trim()) {
      try {
        const chunk = JSON.parse(buf.trim());
        if (chunk.message?.content) content += chunk.message.content;
      } catch {}
    }

    const refined = content.trim();
    if (!refined) throw new Error(`Text model "${activeModel}" returned empty content for prompt enhancement`);

    fetchAndRenderTokens();
    return refined;
  }

  async function resolveImageGenerationModel(preferredModel, signal) {
    if (!preferredModel || isLikelyImageModelName(preferredModel)) return preferredModel;
    try {
      const mr = await fetch('/api/models', { headers: authHeaders(), signal });
      const md = await mr.json();
      if (!mr.ok || md.offline) return preferredModel;
      const modelNames = (md.models || []).map(m => m.name).filter(Boolean);
      const fallbackImageModel = modelNames.find(isLikelyImageModelName);
      if (!fallbackImageModel) return preferredModel;

      persistSettings({ ...getSettings(), imageModel: fallbackImageModel });
      if (imageModelSelect && [...imageModelSelect.options].some(o => o.value === fallbackImageModel)) {
        imageModelSelect.value = fallbackImageModel;
      }
      return fallbackImageModel;
    } catch {
      return preferredModel;
    }
  }

  function createImageProgressUI(assistantRow, generationModel) {
    assistantRow.querySelector('.thinking')?.remove();
    const msgBody = assistantRow.querySelector('.message-body');

    const progressWrap = document.createElement('div');
    progressWrap.className = 'image-gen-progress';
    const labelEl = document.createElement('span');
    labelEl.className = 'image-gen-label';
    labelEl.textContent = `Generating image with ${generationModel}…`;
    const barWrap = document.createElement('div');
    barWrap.className = 'image-gen-bar-wrap';
    const barEl = document.createElement('div');
    barEl.className = 'image-gen-bar';
    barWrap.appendChild(barEl);
    progressWrap.appendChild(labelEl);
    progressWrap.appendChild(barWrap);
    msgBody.appendChild(progressWrap);
    scrollBottom();

    return { progressWrap, labelEl, barEl, msgBody };
  }

  async function generateImageBase64({ model, prompt, signal, onProgress, onStatus }) {
    let generatedB64 = null;
    let textOnlyOutput = '';
    let lastPayloadKeys = '';

    const applyPayload = (payload) => {
      if (!payload || typeof payload !== 'object') return;
      if (payload.error) throw new Error(payload.error);
      lastPayloadKeys = Object.keys(payload).join(', ');

      const imagePayload = extractImagePayload(payload);
      if (typeof payload.response === 'string' && !imagePayload && payload.response) {
        textOnlyOutput += payload.response;
      }
      if (payload.total && payload.completed != null) {
        const pct = Math.min(99, Math.round((payload.completed / payload.total) * 100));
        onProgress?.(pct);
      }
      if (imagePayload) {
        generatedB64 = imagePayload;
        onProgress?.(100);
      }
    };

    const perf = getImagePerfConfig();
    const buildImageRequestBody = (stream) => ({
      model,
      prompt,
      stream,
      width: perf.width,
      height: perf.height,
      steps: perf.steps
    });

    const streamResp = await fetch('/api/generate-image', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(buildImageRequestBody(true)),
      signal
    });
    if (!streamResp.ok) {
      const errText = await streamResp.text().catch(() => streamResp.statusText);
      throw new Error(`Image generation failed (${streamResp.status}): ${parseErrorText(streamResp.status, errText)}`);
    }

    const reader = streamResp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed;
        try { parsed = JSON.parse(line); }
        catch { continue; }
        applyPayload(parsed);
      }
    }

    if (buf.trim()) applyPayload(parseFirstNdjsonObject(buf));

    if (!generatedB64) {
      onStatus?.('Finalizing image…');
      const singleResp = await fetch('/api/generate-image', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(buildImageRequestBody(false)),
        signal
      });
      if (singleResp.ok) {
        applyPayload(parseFirstNdjsonObject(await singleResp.text()));
      }
    }

    return { generatedB64, textOnlyOutput, lastPayloadKeys };
  }

  async function handleImageRequest(text) {
    isStreaming = true;
    sendBtn.style.display = 'none';
    stopBtn.style.display = 'flex';
    abortCtrl = new AbortController();
    const assistantRow = appendThinking();

    try {
      let refinedPrompt = text;
      try {
        refinedPrompt = await refineImagePrompt(text, abortCtrl.signal);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        // Show a visible warning but still proceed with the original prompt
        assistantRow.querySelector('.thinking')?.replaceWith((() => {
          const w = document.createElement('div');
          w.className = 'msg-text';
          w.style.cssText = 'color:var(--warn,#e5a000);font-size:12px;margin-bottom:4px';
          w.textContent = `⚠️ Prompt enhancement failed (${e.message}). Using original prompt.`;
          return w;
        })());
      }

      const imageModel = getSettings().imageModel;
      if (!imageModel) throw new Error('No image model configured. Go to Settings → Image generation model and select or pull one (e.g. x/z-image-turbo).');
      const generationModel = await resolveImageGenerationModel(imageModel, abortCtrl.signal);
      const { progressWrap, labelEl, barEl, msgBody } = createImageProgressUI(assistantRow, generationModel);

      const { generatedB64, textOnlyOutput, lastPayloadKeys } = await generateImageBase64({
        model: generationModel,
        prompt: refinedPrompt,
        signal: abortCtrl.signal,
        onProgress: (pct) => {
          barEl.style.width = `${pct}%`;
          labelEl.textContent = pct >= 100 ? 'Done!' : `Generating image… ${pct}%`;
        },
        onStatus: (textStatus) => {
          labelEl.textContent = textStatus;
        }
      });

      if (!generatedB64) {
        const textOut = textOnlyOutput.trim();
        if (textOut) {
          throw new Error(`Model '${generationModel}' returned text instead of image. Select an image model in Settings (e.g. x/z-image-turbo:latest).`);
        }
        const details = lastPayloadKeys ? ` Last payload keys: ${lastPayloadKeys}.` : '';
        throw new Error(`No image was returned. Make sure the image model is pulled and supports image generation.${details}`);
      }

      // Replace progress indicator with the generated image
      progressWrap.remove();
      const imgWrap = document.createElement('div');
      imgWrap.className = 'msg-generated-image';
      const img = document.createElement('img');
      img.className = 'generated-image';
      img.alt = refinedPrompt;
      img.src = `data:image/png;base64,${generatedB64}`;
      img.addEventListener('click', () => { lightboxImg.src = img.src; lightbox.classList.add('open'); });
      imgWrap.appendChild(img);
      msgBody.appendChild(imgWrap);
      const captionEl = document.createElement('div');
      captionEl.className = 'msg-text image-gen-caption';
      captionEl.textContent = `Prompt: ${refinedPrompt}`;
      msgBody.appendChild(captionEl);

      const assistantMsg = {
        role: 'assistant',
        content: `Prompt: ${refinedPrompt}`,
        generatedImage: generatedB64,
        imagePrompt: refinedPrompt,
        imageModel: generationModel
      };
      messages.push(assistantMsg);
      assistantRow.dataset.msgIndex = String(messages.length - 1);
      addMessageActions(assistantRow, assistantMsg);
      saveToHistory();

    } catch (err) {
      if (err.name === 'AbortError') {
        assistantRow.remove();
        if (messages.length && messages[messages.length - 1]?.role === 'user') {
          messages.pop();
        }
      } else {
        assistantRow.querySelector('.thinking')?.remove();
        assistantRow.querySelector('.image-gen-progress')?.remove();
        const errEl = document.createElement('div');
        errEl.className = 'msg-text error';
        errEl.textContent = `⚠️ ${err.message}`;
        assistantRow.querySelector('.message-body').appendChild(errEl);
        if (messages.length && messages[messages.length - 1]?.role === 'user') {
          saveToHistory();
        }
      }
    } finally {
      isStreaming = false;
      sendBtn.style.display = 'flex';
      stopBtn.style.display = 'none';
      abortCtrl = null;
      scrollBottom();
      inputEl.focus();
    }
  }

  // ── Send ──────────────────────────────────────────────
  async function sendMessage() {
    if (isStreaming) return;
    const text = inputEl.value.trim();
    if (!text && !pendingImages.length && !pendingFiles.length && !pendingAudio.length) return;

    // Intercept image generation requests (text-only, no file attachments)
    if (text && !pendingImages.length && !pendingFiles.length && !pendingAudio.length && isImageRequest(text)) {
      const userMsg = { role: 'user', content: text };
      messages.push(userMsg);
      inputEl.value = '';
      autoResize(inputEl);
      appendUserBubble(userMsg, [], messages.length - 1);
      await handleImageRequest(text);
      return;
    }

    // Prepend attached text files as code blocks in the message content
    let fullContent = text;
    if (pendingFiles.length) {
      const fileContents = await Promise.all(
        pendingFiles.map(f => readFileContent(f).catch(() => ''))
      );
      const fileBlocks = pendingFiles.map((f, i) =>
        `**${f.name}**\n\`\`\`\n${fileContents[i]}\n\`\`\``
      ).join('\n\n');
      fullContent = fileBlocks + (fullContent ? '\n\n' + fullContent : '');
    }

    if (pendingAudio.length) {
      // Grab chip elements now (they'll be cleared by renderPreviews after send).
      const chipEls = [...previewsEl.querySelectorAll('.audio-chip')];
      // Block the UI while transcribing.
      sendBtn.disabled = true;
      attachBtn.disabled = true;
      inputEl.disabled = true;
      try {
        const transcripts = await Promise.all(
          pendingAudio.map((a, i) =>
            transcribeWithProgress(a, chipEls[i] ?? null).catch(() => null)
          )
        );
        const audioBlocks = pendingAudio.map((a, i) =>
          transcripts[i] != null
            ? `**[Audio transcript: ${a.name}]**\n${transcripts[i]}`
            : `**[Audio file attached: ${a.name}]** *(transcription unavailable)*`
        ).join('\n\n');
        fullContent = audioBlocks + (fullContent ? '\n\n' + fullContent : '');
      } finally {
        sendBtn.disabled = false;
        attachBtn.disabled = false;
        inputEl.disabled = false;
      }
    }

    const imgs    = [...pendingImages];
    const userMsg = {
      role: 'user', content: fullContent,
      ...(imgs.length ? { images: imgs.map(i => i.base64) } : {})
    };
    messages.push(userMsg);

    inputEl.value = '';
    autoResize(inputEl);
    pendingImages = [];
    pendingFiles  = [];
    pendingAudio  = [];
    renderPreviews();

    appendUserBubble(userMsg, imgs, messages.length - 1);
    const assistantRow = appendThinking();
    await streamAssistantReply(assistantRow);
  }

  // ── DOM helpers ───────────────────────────────────────
  function appendUserBubble(msg, imgs, msgIndex = -1) {
    document.querySelectorAll('.regen-msg-btn').forEach(btn => btn.remove());
    document.getElementById('welcome')?.remove();
    const el = document.createElement('div');
    el.className = 'message user';
    if (msgIndex >= 0) el.dataset.msgIndex = String(msgIndex);
    const imagesHtml = imgs.length
      ? `<div class="msg-images">${imgs.map(i => `<img src="${escHtml(i.dataUrl)}" alt="attached image">`).join('')}</div>`
      : '';
    const textHtml = msg.content
      ? `<div class="msg-text">${escHtml(msg.content)}</div>`
      : '';
    const initial = activeUsername ? escHtml(activeUsername[0].toUpperCase()) : 'U';
    el.innerHTML = `<div class="avatar">${initial}</div><div class="message-body">${imagesHtml}${textHtml}</div>`;
    addMessageActions(el, msg);
    messagesEl.appendChild(el);
    scrollBottom();
  }

  function appendAssistantBubble(msg, msgIndex = -1) {
    document.getElementById('welcome')?.remove();
    const el = document.createElement('div');
    el.className = 'message assistant';
    if (msgIndex >= 0) el.dataset.msgIndex = String(msgIndex);

    if (msg.generatedImage) {
      el.innerHTML = '<div class="avatar">⚡</div><div class="message-body"></div>';
      const body = el.querySelector('.message-body');
      const imgWrap = document.createElement('div');
      imgWrap.className = 'msg-generated-image';
      const img = document.createElement('img');
      img.className = 'generated-image';
      img.alt = msg.imagePrompt || 'Generated image';
      img.src = `data:image/png;base64,${msg.generatedImage}`;
      img.addEventListener('click', () => { lightboxImg.src = img.src; lightbox.classList.add('open'); });
      imgWrap.appendChild(img);
      body.appendChild(imgWrap);
      if (msg.content) {
        const caption = document.createElement('div');
        caption.className = 'msg-text image-gen-caption';
        caption.textContent = msg.content;
        body.appendChild(caption);
      }
    } else {
      el.innerHTML = `
        <div class="avatar">⚡</div>
        <div class="message-body">
          <div class="msg-text">${DOMPurify.sanitize(renderMd(msg.content))}</div>
        </div>`;
      el.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
      el.querySelectorAll('pre').forEach(addCopyBtn);
    }

    addMessageActions(el, msg);
    messagesEl.appendChild(el);
    scrollBottom();
    return el;
  }

  function appendThinking() {
    document.getElementById('welcome')?.remove();
    const el = document.createElement('div');
    el.className = 'message assistant';
    el.innerHTML = `
      <div class="avatar">⚡</div>
      <div class="message-body">
        <div class="thinking"><span></span><span></span><span></span></div>
      </div>`;
    messagesEl.appendChild(el);
    scrollBottom();
    return el;
  }

  function renderMd(text) { return marked.parse(text); }

  function copyText(text, btn) {
    navigator.clipboard.writeText(text || '').then(() => {
      const prev = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => btn.textContent = prev, 1400);
    });
  }

  function addMessageActions(el, msg) {
    const body = el.querySelector('.message-body');
    if (!body || body.querySelector('.message-actions')) return;
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => copyText(msg.content, copyBtn));
    actions.appendChild(copyBtn);
    const idx = Number(el.dataset.msgIndex);
    if (msg.role === 'assistant' && idx === messages.length - 1) {
      const regenBtn = document.createElement('button');
      regenBtn.className = 'msg-action-btn regen-msg-btn';
      regenBtn.textContent = 'Regenerate';
      regenBtn.addEventListener('click', regenerateLastResponse);
      actions.appendChild(regenBtn);
    }
    body.appendChild(actions);
  }

  function addCopyBtn(pre) {
    const btn = document.createElement('button');
    btn.className = 'copy-code-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code')?.textContent || pre.textContent;
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = '✓ Copied';
        setTimeout(() => btn.textContent = 'Copy', 2000);
      });
    });
    pre.appendChild(btn);
  }

  function scrollBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Chat management ───────────────────────────────────
  function startNewChat() {
    if (isStreaming) return;
    messages = [];
    currentConvId = null;
    setActiveModel(getSettings().model || FALLBACK_MODEL, { renderWelcome: false });
    resetSystemPrompt();
    messagesEl.innerHTML = '';
    showWelcome();
    inputEl.focus();
  }

  function renderMessages() {
    messagesEl.innerHTML = '';
    if (!messages.length) { showWelcome(); return; }
    messages.forEach((msg, idx) => {
      if (msg.role === 'user') appendUserBubble(msg, [], idx);
      else if (msg.role === 'assistant') appendAssistantBubble(msg, idx);
    });
  }

  async function regenerateLastResponse() {
    if (isStreaming || messages[messages.length - 1]?.role !== 'assistant') return;
    messages.pop();
    saveToHistory();
    renderMessages();
    const assistantRow = appendThinking();
    await streamAssistantReply(assistantRow);
  }

  function showWelcome() {
    const el = document.createElement('div');
    el.id = 'welcome';
    const greeting = activeUsername ? `Hello, ${escHtml(activeUsername)}` : 'OfflineAI';
    el.innerHTML = `
      <div class="welcome-glyph">⚡</div>
      <h2>${greeting}</h2>
      <p>Chat privately with <strong>${escHtml(activeModel)}</strong> running locally.<br>No cloud calls.</p>`;
    messagesEl.appendChild(el);
  }

  window.setPrompt = function(text) {
    inputEl.value = text;
    autoResize(inputEl);
    inputEl.focus();
  };

  init();
