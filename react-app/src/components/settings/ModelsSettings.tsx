import { useState } from 'react';
import type { Settings } from '../../types';

/** Extract percentage from pull status text like "pulling abc — 45%" */
function parsePullProgress(status: string): number | null {
  const match = status.match(/(\d+)%/);
  return match ? parseInt(match[1], 10) : null;
}

/** Extract the downloading model name from the input field */
function extractPullingModel(_status: string, inputName: string): string {
  return inputName.trim() || 'model';
}

interface ModelsSettingsProps {
  form: Settings;
  setField: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  downloadedModels: string[];
  imageModels: string[];
  pullModelInput: string;
  setPullModelInput: (v: string) => void;
  pullImageInput: string;
  setPullImageInput: (v: string) => void;
  pullStatus: string;
  pullImageStatus: string;
  onPullModel: (name: string) => void;
  onPullImageModel: (name: string) => void;
}

export function ModelsSettings({
  form,
  setField,
  downloadedModels,
  imageModels,
  pullModelInput,
  setPullModelInput,
  pullImageInput,
  setPullImageInput,
  pullStatus,
  pullImageStatus,
  onPullModel,
  onPullImageModel,
}: ModelsSettingsProps) {
  const pullStatusClass = !pullStatus
    ? 'hidden'
    : pullStatus.startsWith('✓')
      ? 'success'
      : pullStatus.startsWith('Error') || pullStatus.toLowerCase().includes('error')
        ? 'error'
        : '';

  const pullProgress = parsePullProgress(pullStatus);
  const pullImageProgress = parsePullProgress(pullImageStatus);
  const [showImageAdvanced, setShowImageAdvanced] = useState(false);

  return (
    <>
      {/* ════ DOWNLOAD MODEL ════ */}
      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Download model</span>
        </div>
        <div className="settings-card-body">
          <div className="flex gap-2">
            <input
              id="pull-model-input"
              className="settings-input flex-1"
              type="text"
              placeholder="e.g. gemma4:e4b"
              autoComplete="off"
              spellCheck={false}
              value={pullModelInput}
              onChange={(e) => setPullModelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onPullModel(pullModelInput);
              }}
            />
            <button
              id="pull-btn"
              className="settings-secondary-btn shrink-0"
              style={{ width: 'auto', padding: '7px 16px' }}
              onClick={() => onPullModel(pullModelInput)}
            >
              Pull
            </button>
          </div>
          <p
            id="pull-status"
            className={`text-[12px] mt-1.5 ${pullStatusClass} ${
              !pullStatus
                ? ''
                : pullStatus.startsWith('✓')
                  ? 'text-ok'
                  : pullStatus.startsWith('Error') || pullStatus.toLowerCase().includes('error')
                    ? 'text-err-text'
                    : 'text-text-muted'
            }`}
          >
            {pullStatus}
          </p>
          {pullProgress != null && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[11px] text-text-muted mb-1">
                <span>Downloading {extractPullingModel(pullStatus, pullModelInput)}…</span>
                <span>{pullProgress}%</span>
              </div>
              <div className="h-1.5 bg-surface-md rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-300"
                  style={{ width: `${pullProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ════ AVAILABLE MODELS ════ */}
      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Available models</span>
        </div>
        <div className="settings-card-body">
          <div id="downloaded-models-list" className="flex flex-wrap gap-1.5">
            {downloadedModels.length === 0 ? (
              <span className="text-[12px] text-text-dim">Checking…</span>
            ) : (
              downloadedModels.map((m) => (
                <span key={m} className="downloaded-model-pill">
                  {m}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ════ MODEL ROUTING ════ */}
      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Model routing</span>
        </div>
        <div className="settings-card-body">
          <p className="text-[11.5px] text-text-dim">
            When an intent model is set, each message is first classified as{' '}
            <strong className="text-text-muted">image</strong>,{' '}
            <strong className="text-text-muted">code</strong>, or{' '}
            <strong className="text-text-muted">text</strong> — then the matching model is used
            automatically. Leave empty to disable.
          </p>

          <div>
            <label className="settings-label">
              Intent model{' '}
              <span className="font-normal text-text-dim ml-1">classifies each request</span>
            </label>
            <select
              className="settings-input"
              value={form.intentModel}
              onChange={(e) => setField('intentModel', e.target.value)}
            >
              <option value="">— disabled —</option>
              {downloadedModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <p className="text-[11.5px] text-text-dim mt-1">
              Use a small, fast model (e.g. gemma3:1b). Adds one quick call before each reply.
            </p>
          </div>

          <div>
            <label className="settings-label">
              Text model{' '}
              <span className="font-normal text-text-dim ml-1">used for chat &amp; questions</span>
            </label>
            <select
              className="settings-input"
              value={form.model}
              onChange={(e) => setField('model', e.target.value)}
            >
              <option value="">— none —</option>
              {downloadedModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="settings-label">
              Code model{' '}
              <span className="font-normal text-text-dim ml-1">used for code requests</span>
            </label>
            <select
              className="settings-input"
              value={form.codeModel}
              onChange={(e) => setField('codeModel', e.target.value)}
            >
              <option value="">— same as text model —</option>
              {downloadedModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <p className="text-[11.5px] text-text-dim mt-1">
              Falls back to the text model when empty.
            </p>
          </div>
        </div>
      </div>

      {/* ════ IMAGE GENERATION ════ */}
      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Image generation</span>
        </div>
        <div className="settings-card-body">
          <div>
            <label className="settings-label">
              Model{' '}
              <span className="font-normal text-text-dim ml-1">triggered by "draw / generate"</span>
            </label>
            <select
              className="settings-input"
              value={form.imageModel}
              onChange={(e) => setField('imageModel', e.target.value)}
            >
              <option value="">— no image model —</option>
              {imageModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <button
              type="button"
              className="flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              onClick={() => setShowImageAdvanced(!showImageAdvanced)}
            >
              <span className={`inline-block transition-transform duration-150 ${showImageAdvanced ? 'rotate-90' : ''}`}>▸</span>
              Advanced image settings
            </button>
            {showImageAdvanced && (
              <div className="mt-2">
                <label className="settings-label">Performance profile</label>
                <select
                  className="settings-input"
                  value={form.imagePerfProfile}
                  onChange={(e) =>
                    setField('imagePerfProfile', e.target.value as Settings['imagePerfProfile'])
                  }
                >
                  <option value="eco">Eco — 640 px · 6 steps · fast</option>
                  <option value="balanced">Balanced — 768 px · 10 steps</option>
                  <option value="quality">Quality — 1024 px · 16 steps · slow</option>
                </select>
              </div>
            )}
          </div>
          <div>
            <label className="settings-label">Download image model</label>
            <div className="flex gap-2">
              <input
                className="settings-input flex-1"
                type="text"
                placeholder="e.g. x/z-image-turbo"
                autoComplete="off"
                spellCheck={false}
                value={pullImageInput}
                onChange={(e) => setPullImageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onPullImageModel(pullImageInput);
                }}
              />
              <button
                className="settings-secondary-btn shrink-0"
                style={{ width: 'auto', padding: '7px 16px' }}
                onClick={() => onPullImageModel(pullImageInput)}
              >
                Pull
              </button>
            </div>
            {pullImageStatus && (
              <p
                className={`text-[12px] mt-1.5 ${
                  pullImageStatus.startsWith('✓')
                    ? 'text-ok'
                    : pullImageStatus.startsWith('Error')
                      ? 'text-err-text'
                      : 'text-text-muted'
                }`}
              >
                {pullImageStatus}
              </p>
            )}
            {pullImageProgress != null && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[11px] text-text-muted mb-1">
                  <span>Downloading {extractPullingModel(pullImageStatus, pullImageInput)}…</span>
                  <span>{pullImageProgress}%</span>
                </div>
                <div className="h-1.5 bg-surface-md rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-300"
                    style={{ width: `${pullImageProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
