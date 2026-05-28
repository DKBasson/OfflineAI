import type { Settings } from '../../types';

type ModelHealth = {
  ollamaOnline: boolean;
  chatModel: string;
  modelsCount: number | null;
  vision: boolean;
  access: string;
  storage: string;
} | null;

interface SystemSettingsProps {
  form: Settings;
  setField: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  modelHealth: ModelHealth;
  ollamaRestartStatus: string;
  isLocalhost: boolean;
  onRestartOllama: () => void;
  onResetTokenCounter: () => void;
  onClearHistory: () => void;
}

export function SystemSettings({
  form,
  setField,
  modelHealth,
  ollamaRestartStatus,
  isLocalhost,
  onRestartOllama,
  onResetTokenCounter,
  onClearHistory,
}: SystemSettingsProps) {
  return (
    <>
      {/* ════ RUNTIME STATUS ════ */}
      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Runtime status</span>
        </div>
        <div className="settings-card-body">
          <div id="model-health" className="mb-3">
            {modelHealth ? (
              (
                [
                  ['Ollama', modelHealth.ollamaOnline ? '● Online' : '○ Offline'],
                  ['Chat model', modelHealth.chatModel],
                  ['Models', String(modelHealth.modelsCount ?? '—')],
                  ['Vision', modelHealth.vision ? 'Supported' : 'Text only'],
                  ['Access', modelHealth.access],
                  ['History', modelHealth.storage],
                ] as [string, string][]
              ).map(([label, val]) => (
                <div key={label} className="health-row">
                  <span>{label}</span>
                  <strong
                    style={
                      label === 'Ollama'
                        ? { color: modelHealth.ollamaOnline ? 'var(--ok)' : 'var(--err-text)' }
                        : {}
                    }
                  >
                    {val}
                  </strong>
                </div>
              ))
            ) : (
              <span className="text-[12px] text-text-dim">Checking…</span>
            )}
          </div>
          <button
            id="restart-ollama-btn"
            className="settings-secondary-btn mb-2"
            onClick={onRestartOllama}
            type="button"
          >
            Restart Ollama
          </button>
          <p
            id="ollama-restart-status"
            className={`text-[12px] mb-2 ${
              !ollamaRestartStatus
                ? 'hidden'
                : ollamaRestartStatus.startsWith('Error')
                  ? 'text-err-text'
                  : 'text-ok'
            }`}
          >
            {ollamaRestartStatus}
          </p>
          {isLocalhost && (
            <button
              className="settings-secondary-btn"
              onClick={onResetTokenCounter}
              type="button"
            >
              Reset token counter
            </button>
          )}
        </div>
      </div>

      {/* ════ STORAGE ════ */}
      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Storage</span>
        </div>
        <div className="settings-card-body">
          <div>
            <label className="settings-label">
              Saved conversations
              <span className="ml-1.5 font-normal text-text-dim">10 – 200</span>
            </label>
            <input
              id="settings-history-limit"
              className="settings-input"
              type="number"
              min={10}
              max={200}
              step={10}
              inputMode="numeric"
              value={form.historyLimit}
              onChange={(e) => setField('historyLimit', Number(e.target.value))}
            />
            <p className="text-[11.5px] text-text-dim mt-1">
              Older chats are trimmed when this limit is reached.
            </p>
          </div>
        </div>
      </div>

      {/* ════ DANGER ZONE ════ */}
      <div className="settings-card" style={{ borderColor: 'rgba(255,76,66,0.22)' }}>
        <div
          className="settings-card-header"
          style={{
            background: 'rgba(255,76,66,0.05)',
            borderBottomColor: 'rgba(255,76,66,0.15)',
          }}
        >
          <span className="settings-card-title" style={{ color: 'var(--err-text)' }}>
            Danger zone
          </span>
        </div>
        <div className="settings-card-body">
          <p className="text-[12px] text-text-muted">
            Permanently deletes all saved conversations. System prompts and settings are not
            affected.
          </p>
          <button
            id="clear-history-btn"
            className="settings-danger-btn"
            onClick={onClearHistory}
          >
            Clear all history
          </button>
        </div>
      </div>
    </>
  );
}
