import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import type { Settings, SystemPrompt } from '../types';
import { loadSettings } from '../utils/storage';

export function SettingsPanel() {
  const {
    isSettingsOpen,
    closeSettings,
    saveSettingsValues,
    pullStatus,
    pullImageStatus,
    ollamaRestartStatus,
    modelHealth,
    pullModel,
    pullImageModel,
    restartOllama,
    clearAllHistory,
    resetTokenCounter,
    getSavedPrompts,
    savePrompt,
    deletePrompt,
    reorderPrompts,
    duplicatePrompt,
    setDefaultPrompt,
    refreshDownloadedModels,
    updateModelHealth,
  } = useApp();

  const [form, setForm] = useState<Settings>(loadSettings);
  const [pullModelInput, setPullModelInput] = useState('');
  const [pullImageInput, setPullImageInput] = useState('');
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const [imageModels, setImageModels] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [showNewPromptForm, setShowNewPromptForm] = useState(false);
  const [editingPromptIdx, setEditingPromptIdx] = useState(-1);
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');
  const isLocalhost =
    typeof window !== 'undefined' &&
    (location.hostname === '127.0.0.1' || location.hostname === 'localhost');

  const panelRef = useRef<HTMLDivElement>(null);

  const refreshState = useCallback(async () => {
    setForm(loadSettings());
    setPrompts(getSavedPrompts());
    await refreshDownloadedModels();
    await updateModelHealth();

    import('../utils/api').then(({ fetchModels }) =>
      fetchModels().then((all) => {
        const imageOnlyRe = /^x\/(?:z-image-turbo|flux2-klein)$|(?:image|flux|sdxl|stable|diffusion)/i;
        const chatModels = all.filter((m) => !imageOnlyRe.test(m.replace(/:latest$/, '')));
        const imgModels = all.filter((m) => imageOnlyRe.test(m.replace(/:latest$/, '')));
        setDownloadedModels(chatModels.length ? chatModels : all);
        setImageModels(imgModels);
      }),
    );
  }, [getSavedPrompts, refreshDownloadedModels, updateModelHealth]);

  useEffect(() => {
    if (isSettingsOpen) refreshState();
  }, [isSettingsOpen, refreshState]);

  // Clear pull input after successful pull
  useEffect(() => {
    if (pullStatus.includes('ready')) {
      setPullModelInput('');
    }
  }, [pullStatus]);

  function setField<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveSettingsValues(form);
    closeSettings();
  }

  function resetPromptForm() {
    setNewPromptName('');
    setNewPromptContent('');
    setEditingPromptIdx(-1);
    setShowNewPromptForm(false);
  }

  function handleSavePrompt() {
    const name = newPromptName.trim();
    const content = newPromptContent.trim();
    if (!name || !content) return;
    if (editingPromptIdx >= 0) {
      const existing = prompts[editingPromptIdx];
      savePrompt({ id: existing.id, name, content });
    } else {
      savePrompt({ name, content });
    }
    setPrompts(getSavedPrompts());
    resetPromptForm();
  }

  function openEditPrompt(idx: number) {
    const p = prompts[idx];
    setNewPromptName(p.name);
    setNewPromptContent(p.content);
    setEditingPromptIdx(idx);
    setShowNewPromptForm(true);
  }

  const pullStatusClass = !pullStatus
    ? 'hidden'
    : pullStatus.startsWith('✓')
      ? 'success'
      : pullStatus.startsWith('Error') || pullStatus.toLowerCase().includes('error')
        ? 'error'
        : '';

  return (
    <>
      {/* Backdrop — only rendered when open */}
      {isSettingsOpen && (
        <div
          id="settings-overlay"
          className="fixed inset-0 bg-black/55 backdrop-blur-sm z-40"
          onClick={closeSettings}
          aria-hidden="true"
        />
      )}

      {/* Panel — always in DOM; 'open' class + translate-x-0 when visible */}
      <div
        id="settings-panel"
        ref={panelRef}
        className={`fixed top-0 right-0 bottom-0 w-[380px] z-50 flex flex-col overflow-hidden transition-transform duration-300 ${isSettingsOpen ? 'open translate-x-0' : 'translate-x-full'}`}
        style={{
          background: 'rgba(9,10,18,0.97)',
          backdropFilter: 'blur(28px) saturate(160%)',
          borderLeft: '1px solid var(--border-hi)',
          boxShadow: '-20px 0 60px rgba(0,0,0,0.5), inset 1px 0 0 rgba(255,255,255,0.04)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        {/* ── Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-0 shrink-0">
          <span className="text-[15px] font-semibold text-text-primary tracking-tight">Settings</span>
          <button
            id="settings-close-btn"
            className="w-[26px] h-[26px] flex items-center justify-center rounded-full text-text-dim text-[13px] transition-all hover:text-text-muted"
            style={{ background: 'var(--glass-md)', border: '1px solid var(--border)', boxShadow: 'var(--edge)' }}
            onClick={closeSettings}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        {/* ── All sections — always rendered, no tab gating */}
        <div className="flex-1 overflow-y-auto px-5 py-5">

          {/* ════ GENERAL ════ */}
          <div className="settings-card">
            <div className="settings-card-header"><span className="settings-card-title">Profile</span></div>
            <div className="settings-card-body">
              <div>
                <label className="settings-label">Your name</label>
                <input
                  id="settings-name"
                  className="settings-input"
                  type="text"
                  placeholder="Enter your name…"
                  maxLength={32}
                  value={form.username}
                  onChange={(e) => setField('username', e.target.value)}
                />
                <p className="text-[11.5px] text-text-dim mt-1">Shown in greetings and as your avatar initial.</p>
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header"><span className="settings-card-title">Context</span></div>
            <div className="settings-card-body">
              <div>
                <label className="settings-label">
                  Context window
                  <span className="ml-1.5 font-normal text-text-dim">4 – 100 messages</span>
                </label>
                <input
                  id="settings-context"
                  className="settings-input"
                  type="number" min={4} max={100} step={1}
                  value={form.contextSize}
                  onChange={(e) => setField('contextSize', Number(e.target.value))}
                />
                <p className="text-[11.5px] text-text-dim mt-1">Recent messages sent with each request.</p>
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header"><span className="settings-card-title">Generation</span></div>
            <div className="settings-card-body">
              <p className="text-[11.5px] text-text-dim">Set to 0 to use Ollama defaults.</p>
              <div className="grid grid-cols-2 gap-3">
                <TipField label="Temperature" tip="Randomness. 0 = deterministic, 2 = very creative.">
                  <input id="settings-temperature" className="settings-input" type="number" min={0} max={2} step={0.1} inputMode="decimal"
                    value={form.temperature} onChange={(e) => setField('temperature', Number(e.target.value))} />
                </TipField>
                <TipField label="Top P" tip="Nucleus sampling. Lower = more focused replies.">
                  <input id="settings-top-p" className="settings-input" type="number" min={0.1} max={1} step={0.05} inputMode="decimal"
                    value={form.topP} onChange={(e) => setField('topP', Number(e.target.value))} />
                </TipField>
                <TipField label="Max reply tokens" tip="Caps one reply. 0 = model default.">
                  <input className="settings-input" type="number" min={0} max={8192} step={64} inputMode="numeric"
                    value={form.maxTokens} onChange={(e) => setField('maxTokens', Number(e.target.value))} />
                </TipField>
                <TipField label="Context tokens" tip="num_ctx passed to Ollama. Higher = more memory.">
                  <input className="settings-input" type="number" min={0} max={32768} step={512} inputMode="numeric"
                    value={form.numCtx} onChange={(e) => setField('numCtx', Number(e.target.value))} />
                </TipField>
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header"><span className="settings-card-title">Behavior</span></div>
            <div className="settings-card-body">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  id="settings-auto-title"
                  type="checkbox"
                  className="mt-0.5 accent-accent shrink-0"
                  checked={form.autoTitle}
                  onChange={(e) => setField('autoTitle', e.target.checked)}
                />
                <div>
                  <span className="text-[13px] text-text-muted">Auto-title conversations</span>
                  <p className="text-[11.5px] text-text-dim mt-0.5">
                    Generates a short title after the first reply using the active model.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* ════ MODELS ════ */}
          <div className="settings-card">
            <div className="settings-card-header"><span className="settings-card-title">Download model</span></div>
            <div className="settings-card-body">
              <div className="flex gap-2">
                <input
                  id="pull-model-input"
                  className="settings-input flex-1"
                  type="text" placeholder="e.g. gemma4:e4b"
                  autoComplete="off" spellCheck={false}
                  value={pullModelInput}
                  onChange={(e) => setPullModelInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') pullModel(pullModelInput); }}
                />
                <button
                  id="pull-btn"
                  className="settings-secondary-btn shrink-0"
                  style={{ width: 'auto', padding: '7px 16px' }}
                  onClick={() => pullModel(pullModelInput)}
                >Pull</button>
              </div>
              <p
                id="pull-status"
                className={`text-[12px] mt-1.5 ${pullStatusClass} ${!pullStatus ? '' : pullStatus.startsWith('✓') ? 'text-ok' : pullStatus.startsWith('Error') || pullStatus.toLowerCase().includes('error') ? 'text-err-text' : 'text-text-muted'}`}
              >
                {pullStatus}
              </p>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header"><span className="settings-card-title">Available models</span></div>
            <div className="settings-card-body">
              <div id="downloaded-models-list" className="flex flex-wrap gap-1.5">
                {downloadedModels.length === 0
                  ? <span className="text-[12px] text-text-dim">Checking…</span>
                  : downloadedModels.map((m) => <span key={m} className="downloaded-model-pill">{m}</span>)
                }
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header"><span className="settings-card-title">Image generation</span></div>
            <div className="settings-card-body">
              <div>
                <label className="settings-label">Model <span className="font-normal text-text-dim ml-1">triggered by "draw / generate"</span></label>
                <select
                  className="settings-input"
                  value={form.imageModel}
                  onChange={(e) => setField('imageModel', e.target.value)}
                >
                  <option value="">— no image model —</option>
                  {imageModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="settings-label">Performance profile</label>
                <select
                  className="settings-input"
                  value={form.imagePerfProfile}
                  onChange={(e) => setField('imagePerfProfile', e.target.value as Settings['imagePerfProfile'])}
                >
                  <option value="eco">Eco — 640 px · 6 steps · fast</option>
                  <option value="balanced">Balanced — 768 px · 10 steps</option>
                  <option value="quality">Quality — 1024 px · 16 steps · slow</option>
                </select>
              </div>
              <div>
                <label className="settings-label">Download image model</label>
                <div className="flex gap-2">
                  <input
                    className="settings-input flex-1"
                    type="text" placeholder="e.g. x/z-image-turbo"
                    autoComplete="off" spellCheck={false}
                    value={pullImageInput}
                    onChange={(e) => setPullImageInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') pullImageModel(pullImageInput); }}
                  />
                  <button
                    className="settings-secondary-btn shrink-0"
                    style={{ width: 'auto', padding: '7px 16px' }}
                    onClick={() => pullImageModel(pullImageInput)}
                  >Pull</button>
                </div>
                {pullImageStatus && <p className={`text-[12px] mt-1.5 ${pullImageStatus.startsWith('✓') ? 'text-ok' : pullImageStatus.startsWith('Error') ? 'text-err-text' : 'text-text-muted'}`}>{pullImageStatus}</p>}
              </div>
            </div>
          </div>

          {/* ════ PROMPTS ════ */}
          <div className="settings-card">
            <div className="settings-card-header">
              <span className="settings-card-title">System prompts</span>
              <span className="ml-auto text-[11px] text-text-dim">★ = default for new chats</span>
            </div>
            <div className="settings-card-body">
              <div id="sp-saved-list">
                {prompts.length === 0 ? (
                  <p className="text-[12px] text-text-dim">No saved prompts yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {prompts.map((p, i) => (
                      <div key={p.id} className="sp-saved-item">
                        <span className="sp-saved-name flex-1 text-[13px] text-text-muted truncate">{p.name}</span>
                        <button
                          className={`sp-saved-default sp-btn text-[14px] ${p.id === form.defaultPromptId ? 'text-yellow-400 active' : 'text-text-dim hover:text-yellow-400'}`}
                          title="Set as default"
                          onClick={() => { setDefaultPrompt(p.id); setPrompts(getSavedPrompts()); setField('defaultPromptId', p.id); }}
                        >★</button>
                        <button className="sp-btn" title="Move up" disabled={i === 0}
                          onClick={() => { reorderPrompts(i, i - 1); setPrompts(getSavedPrompts()); }}>↑</button>
                        <button className="sp-btn" title="Move down" disabled={i === prompts.length - 1}
                          onClick={() => { reorderPrompts(i, i + 1); setPrompts(getSavedPrompts()); }}>↓</button>
                        <button className="sp-saved-copy sp-btn" title="Duplicate"
                          onClick={() => { duplicatePrompt(i); setPrompts(getSavedPrompts()); }}>⧉</button>
                        <button className="sp-saved-edit sp-btn" title="Edit" onClick={() => openEditPrompt(i)}>✎</button>
                        <button className="sp-saved-del sp-btn hover:text-err-text" title="Delete"
                          onClick={() => { deletePrompt(p.id); setPrompts(getSavedPrompts()); }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-3">
                <button
                  id="sp-add-btn"
                  className={`flex items-center gap-1.5 text-[13px] font-medium transition-colors ${showNewPromptForm ? 'hidden' : ''}`}
                  style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  onClick={() => setShowNewPromptForm(true)}
                >
                  <span style={{ fontSize: 16 }}>+</span> Add prompt
                </button>
                <div id="sp-new-form" className={`space-y-2 ${!showNewPromptForm ? 'hidden' : ''}`}>
                  <input
                    id="sp-new-name"
                    className="settings-input"
                    type="text" placeholder="Prompt name…"
                    maxLength={48}
                    value={newPromptName}
                    onChange={(e) => setNewPromptName(e.target.value)}
                  />
                  <textarea
                    id="sp-new-content"
                    className="settings-input resize-none"
                    placeholder="Prompt instructions…"
                    rows={5}
                    value={newPromptContent}
                    onChange={(e) => setNewPromptContent(e.target.value)}
                  />
                  <div className="flex gap-2 justify-end">
                    <button id="sp-new-cancel" className="settings-secondary-btn" style={{ width: 'auto', padding: '7px 14px' }} onClick={resetPromptForm}>
                      Cancel
                    </button>
                    <button id="sp-new-save" className="settings-save-btn-inline" onClick={handleSavePrompt}>
                      {editingPromptIdx >= 0 ? 'Update' : 'Save prompt'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ════ SYSTEM ════ */}
          <div className="settings-card">
            <div className="settings-card-header"><span className="settings-card-title">Runtime status</span></div>
            <div className="settings-card-body">
              <div id="model-health" className="mb-3">
                {modelHealth ? (
                  ([
                    ['Ollama',     modelHealth.ollamaOnline ? '● Online' : '○ Offline'],
                    ['Chat model', modelHealth.chatModel],
                    ['Models',     String(modelHealth.modelsCount ?? '—')],
                    ['Vision',     modelHealth.vision ? 'Supported' : 'Text only'],
                    ['Access',     modelHealth.access],
                    ['History',    modelHealth.storage],
                  ] as [string, string][]).map(([label, val]) => (
                    <div key={label} className="health-row">
                      <span>{label}</span>
                      <strong style={label === 'Ollama' ? { color: modelHealth.ollamaOnline ? 'var(--ok)' : 'var(--err-text)' } : {}}>
                        {val}
                      </strong>
                    </div>
                  ))
                ) : (
                  <span className="text-[12px] text-text-dim">Checking…</span>
                )}
              </div>
              <button id="restart-ollama-btn" className="settings-secondary-btn mb-2" onClick={restartOllama} type="button">
                Restart Ollama
              </button>
              <p
                id="ollama-restart-status"
                className={`text-[12px] mb-2 ${!ollamaRestartStatus ? 'hidden' : ollamaRestartStatus.startsWith('Error') ? 'text-err-text' : 'text-ok'}`}
              >
                {ollamaRestartStatus}
              </p>
              {isLocalhost && (
                <button className="settings-secondary-btn" onClick={resetTokenCounter} type="button">
                  Reset token counter
                </button>
              )}
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header"><span className="settings-card-title">Storage</span></div>
            <div className="settings-card-body">
              <div>
                <label className="settings-label">
                  Saved conversations
                  <span className="ml-1.5 font-normal text-text-dim">10 – 200</span>
                </label>
                <input
                  id="settings-history-limit"
                  className="settings-input"
                  type="number" min={10} max={200} step={10} inputMode="numeric"
                  value={form.historyLimit}
                  onChange={(e) => setField('historyLimit', Number(e.target.value))}
                />
                <p className="text-[11.5px] text-text-dim mt-1">Older chats are trimmed when this limit is reached.</p>
              </div>
            </div>
          </div>

          <div className="settings-card" style={{ borderColor: 'rgba(255,76,66,0.22)' }}>
            <div className="settings-card-header" style={{ background: 'rgba(255,76,66,0.05)', borderBottomColor: 'rgba(255,76,66,0.15)' }}>
              <span className="settings-card-title" style={{ color: 'var(--err-text)' }}>Danger zone</span>
            </div>
            <div className="settings-card-body">
              <p className="text-[12px] text-text-muted">
                Permanently deletes all saved conversations. System prompts and settings are not affected.
              </p>
              <button
                id="clear-history-btn"
                className="settings-danger-btn"
                onClick={() => {
                  if (confirm('Clear all conversation history? This cannot be undone.')) {
                    clearAllHistory();
                    closeSettings();
                  }
                }}
              >
                Clear all history
              </button>
            </div>
          </div>
        </div>

        {/* ── Save button */}
        <div className="shrink-0 px-5 py-4 border-t border-border">
          <button
            id="settings-save-btn"
            className="w-full font-semibold text-[14px] py-2.5 rounded-sm transition-opacity hover:opacity-90 active:scale-[0.99]"
            style={{ background: 'var(--accent)', color: '#07080f' }}
            onClick={handleSave}
          >
            Save settings
          </button>
        </div>
      </div>
    </>
  );
}

function TipField({
  label,
  tip,
  children,
}: {
  label: string;
  tip: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="settings-label mb-0">{label}</span>
        <SettingsTip tip={tip} />
      </div>
      {children}
    </div>
  );
}

function SettingsTip({ tip }: { tip: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center cursor-help transition-colors"
        style={{ background: 'var(--glass-md)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        tabIndex={0}
        aria-label={tip}
        type="button"
      >
        i
      </button>
      {visible && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-sm p-2.5 text-[11.5px] z-[300] pointer-events-none leading-relaxed"
          style={{
            background: 'rgba(12,13,22,0.97)',
            border: '1px solid var(--border-hi)',
            color: 'var(--text-2)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {tip}
        </div>
      )}
    </span>
  );
}
