import type { Settings } from '../../types';

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
          </div>
        </div>
      </div>
    </>
  );
}
