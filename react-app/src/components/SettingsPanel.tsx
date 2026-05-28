import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import type { Settings, SystemPrompt } from '../types';
import { loadSettings } from '../utils/storage';
import { GeneralSettings } from './settings/GeneralSettings';
import { ModelsSettings } from './settings/ModelsSettings';
import { PromptsSettings } from './settings/PromptsSettings';
import { SystemSettings } from './settings/SystemSettings';

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
        const imageOnlyRe =
          /^x\/(?:z-image-turbo|flux2-klein)$|(?:image|flux|sdxl|stable|diffusion)/i;
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

  return (
    <>
      {/* Backdrop */}
      {isSettingsOpen && (
        <div
          id="settings-overlay"
          className="fixed inset-0 bg-black/55 backdrop-blur-sm z-40"
          onClick={closeSettings}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <div
        id="settings-panel"
        ref={panelRef}
        className={`fixed top-0 right-0 bottom-0 w-[380px] z-50 flex flex-col overflow-hidden transition-transform duration-300 ${
          isSettingsOpen ? 'open translate-x-0' : 'translate-x-full'
        }`}
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
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-0 shrink-0">
          <span className="text-[15px] font-semibold text-text-primary tracking-tight">
            Settings
          </span>
          <button
            id="settings-close-btn"
            className="w-[26px] h-[26px] flex items-center justify-center rounded-full text-text-dim text-[13px] transition-all hover:text-text-muted"
            style={{
              background: 'var(--glass-md)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--edge)',
            }}
            onClick={closeSettings}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <GeneralSettings form={form} setField={setField} />

          <ModelsSettings
            form={form}
            setField={setField}
            downloadedModels={downloadedModels}
            imageModels={imageModels}
            pullModelInput={pullModelInput}
            setPullModelInput={setPullModelInput}
            pullImageInput={pullImageInput}
            setPullImageInput={setPullImageInput}
            pullStatus={pullStatus}
            pullImageStatus={pullImageStatus}
            onPullModel={pullModel}
            onPullImageModel={pullImageModel}
          />

          <PromptsSettings
            prompts={prompts}
            defaultPromptId={form.defaultPromptId}
            onSetDefault={setDefaultPrompt}
            onReorder={reorderPrompts}
            onDuplicate={duplicatePrompt}
            onDelete={deletePrompt}
            onSave={savePrompt}
            onPromptsChanged={() => setPrompts(getSavedPrompts())}
            form={form}
            setField={setField}
          />

          <SystemSettings
            form={form}
            setField={setField}
            modelHealth={modelHealth}
            ollamaRestartStatus={ollamaRestartStatus}
            isLocalhost={isLocalhost}
            onRestartOllama={restartOllama}
            onResetTokenCounter={resetTokenCounter}
            onClearHistory={() => {
              if (confirm('Clear all conversation history? This cannot be undone.')) {
                clearAllHistory();
                closeSettings();
              }
            }}
          />
        </div>

        {/* Save button */}
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
