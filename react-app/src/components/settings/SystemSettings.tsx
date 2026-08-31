import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '../../types';
import { MemoryPanel } from '../memory/MemoryPanel';
import {
  fetchHealth,
  downloadExportArchive,
  uploadImportArchive,
  type HealthData,
  type ImportResult,
} from '../../utils/api';

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

/* ── helpers ────────────────────────────────────────────────────── */

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

type IndicatorColor = 'green' | 'yellow' | 'red';

function dot(color: IndicatorColor): string {
  if (color === 'green') return '🟢';
  if (color === 'yellow') return '🟡';
  return '🔴';
}

function serviceIndicator(
  svc: { available: boolean; reason?: string } | undefined,
  greenLabel: string,
  missingHint: string,
): { color: IndicatorColor; label: string; hint: string | null } {
  if (!svc) return { color: 'red', label: 'Unknown', hint: null };
  if (svc.available) return { color: 'green', label: greenLabel, hint: null };
  return { color: 'yellow', label: 'Unavailable', hint: missingHint };
}

/* ── component ──────────────────────────────────────────────────── */

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
  /* health data */
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const healthFetched = useRef(false);

  useEffect(() => {
    if (healthFetched.current) return;
    healthFetched.current = true;
    setHealthLoading(true);
    fetchHealth()
      .then((d) => setHealth(d))
      .finally(() => setHealthLoading(false));
  }, []);

  /* export / import */
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await downloadExportArchive();
    } finally {
      setExporting(false);
    }
  }, []);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await uploadImportArchive(file);
      setImportResult(result);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  /* derive service indicators */
  const ollamaColor: IndicatorColor = health?.ollama.status === 'online' ? 'green' : 'red';
  const whisper = health ? serviceIndicator(health.services.whisper, 'Ready', 'Install faster-whisper for audio transcription') : null;
  const imageGen = health ? serviceIndicator(health.services.diffusers, 'Ready', 'Install torch for image generation') : null;
  const pdfExport = health ? serviceIndicator(health.services.weasyprint, 'Ready', 'Install weasyprint for PDF export (HTML fallback available)') : null;

  /* recovery suggestions */
  const suggestions: string[] = [];
  if (health) {
    if (!health.services.whisper?.available) suggestions.push('pip install faster-whisper — enables audio transcription');
    if (!health.services.diffusers?.available) suggestions.push('pip install torch — enables local image generation');
    if (!health.services.weasyprint?.available) suggestions.push('pip install weasyprint — enables styled PDF export');
    if (!health.services.docx?.available) suggestions.push('pip install python-docx — enables .docx document reading');
  }

  /* RAM bar */
  const ramUsed = health ? health.system.ram_total_gb - health.system.ram_available_gb : 0;
  const ramPct = health && health.system.ram_total_gb > 0
    ? Math.round((ramUsed / health.system.ram_total_gb) * 100)
    : 0;

  return (
    <>
      <MemoryPanel />

      {/* ════ SYSTEM HEALTH ════ */}
      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">System health</span>
        </div>
        <div className="settings-card-body">
          {healthLoading && !health && (
            <span className="text-[12px] text-text-dim">Loading diagnostics…</span>
          )}

          {health && (
            <>
              {/* service grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px 16px',
                  marginBottom: 12,
                }}
              >
                <div className="health-row" style={{ justifyContent: 'flex-start', gap: 6 }}>
                  <span>{dot(ollamaColor)}</span>
                  <span>Ollama</span>
                  <strong style={{ marginLeft: 'auto', color: ollamaColor === 'green' ? 'var(--ok)' : 'var(--err-text)' }}>
                    {health.ollama.status === 'online' ? 'Online' : 'Offline'}
                  </strong>
                </div>

                {whisper && (
                  <div className="health-row" style={{ justifyContent: 'flex-start', gap: 6 }}>
                    <span>{dot(whisper.color)}</span>
                    <span>Whisper</span>
                    <strong style={{ marginLeft: 'auto' }}>{whisper.label}</strong>
                  </div>
                )}

                {imageGen && (
                  <div className="health-row" style={{ justifyContent: 'flex-start', gap: 6 }}>
                    <span>{dot(imageGen.color)}</span>
                    <span>Image Gen</span>
                    <strong style={{ marginLeft: 'auto' }}>{imageGen.label}</strong>
                  </div>
                )}

                {pdfExport && (
                  <div className="health-row" style={{ justifyContent: 'flex-start', gap: 6 }}>
                    <span>{dot(pdfExport.color)}</span>
                    <span>PDF Export</span>
                    <strong style={{ marginLeft: 'auto' }}>{pdfExport.label}</strong>
                  </div>
                )}
              </div>

              {/* system stats */}
              <div style={{ marginBottom: 12 }}>
                <div className="health-row" style={{ marginBottom: 4 }}>
                  <span>RAM</span>
                  <strong>{ramUsed.toFixed(1)} / {health.system.ram_total_gb} GB</strong>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: 'rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                    marginBottom: 8,
                  }}
                  role="progressbar"
                  aria-valuenow={ramPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`RAM usage ${ramPct}%`}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${ramPct}%`,
                      borderRadius: 3,
                      background: ramPct > 85 ? 'var(--err-text)' : 'var(--accent)',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>

                <div className="health-row">
                  <span>Disk free</span>
                  <strong>{health.system.disk_free_gb} GB</strong>
                </div>
                <div className="health-row">
                  <span>Uptime</span>
                  <strong>{formatUptime(health.uptime_seconds)}</strong>
                </div>
                <div className="health-row">
                  <span>Platform</span>
                  <strong>{health.system.platform} · Python {health.system.python}</strong>
                </div>
                <div className="health-row">
                  <span>Projects</span>
                  <strong>{health.projects.count} ({health.projects.disk_usage_mb} MB)</strong>
                </div>
                <div className="health-row">
                  <span>Tools</span>
                  <strong>
                    {health.tools.count} ({health.tools.enabled} enabled, {health.tools.disabled} disabled)
                  </strong>
                </div>
                <div className="health-row">
                  <span>Memories</span>
                  <strong>{health.memory.count}</strong>
                </div>
              </div>

              {/* recovery suggestions */}
              {suggestions.length > 0 && (
                <div
                  style={{
                    background: 'rgba(255,191,0,0.06)',
                    border: '1px solid rgba(255,191,0,0.18)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    marginBottom: 4,
                  }}
                >
                  <p className="text-[11.5px] text-text-muted" style={{ marginBottom: 4, fontWeight: 600 }}>
                    Optional enhancements
                  </p>
                  {suggestions.map((s) => (
                    <p key={s} className="text-[11px] text-text-dim" style={{ margin: '2px 0' }}>
                      • <code style={{ fontSize: 11 }}>{s}</code>
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

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

      {/* ════ DATA PORTABILITY ════ */}
      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Data portability</span>
        </div>
        <div className="settings-card-body">
          <p className="text-[12px] text-text-muted mb-3">
            Export all your data (projects, tools, memory, token stats) as a ZIP archive, or import
            a previously exported archive. Imports merge data — existing entries are not overwritten.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="settings-secondary-btn"
              onClick={handleExport}
              disabled={exporting}
              type="button"
              aria-label="Export all data as ZIP archive"
            >
              {exporting ? 'Exporting…' : 'Export All Data'}
            </button>
            <button
              className="settings-secondary-btn"
              onClick={handleImportClick}
              disabled={importing}
              type="button"
              aria-label="Import data from ZIP archive"
            >
              {importing ? 'Importing…' : 'Import Data'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              style={{ display: 'none' }}
              onChange={handleFileChange}
              aria-hidden="true"
            />
          </div>

          {importResult && (
            <div
              style={{
                marginTop: 10,
                background: importResult.errors.length
                  ? 'rgba(255,76,66,0.06)'
                  : 'rgba(76,217,100,0.06)',
                border: `1px solid ${importResult.errors.length ? 'rgba(255,76,66,0.18)' : 'rgba(76,217,100,0.18)'}`,
                borderRadius: 8,
                padding: '8px 10px',
              }}
            >
              <p className="text-[12px] text-text-muted" style={{ fontWeight: 600, marginBottom: 4 }}>
                Import results
              </p>
              <p className="text-[11.5px] text-text-dim">
                Projects imported: {importResult.projects_imported}
                {importResult.projects_skipped > 0 && ` (${importResult.projects_skipped} skipped)`}
              </p>
              <p className="text-[11.5px] text-text-dim">Plugins imported: {importResult.plugins_imported}</p>
              <p className="text-[11.5px] text-text-dim">Memories merged: {importResult.memory_merged}</p>
              <p className="text-[11.5px] text-text-dim">
                Token stats: {importResult.token_stats_merged ? 'Merged' : 'Unchanged'}
              </p>
              {importResult.errors.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {importResult.errors.map((err, i) => (
                    <p key={i} className="text-[11px] text-err-text">{err}</p>
                  ))}
                </div>
              )}
            </div>
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
