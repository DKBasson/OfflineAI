import type { Settings } from '../../types';

interface GeneralSettingsProps {
  form: Settings;
  setField: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export function GeneralSettings({ form, setField }: GeneralSettingsProps) {
  return (
    <>
      {/* ════ PROFILE ════ */}
      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Profile</span>
        </div>
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
            <p className="text-[11.5px] text-text-dim mt-1">
              Shown in greetings and as your avatar initial.
            </p>
          </div>
        </div>
      </div>

      {/* ════ CONTEXT ════ */}
      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Context</span>
        </div>
        <div className="settings-card-body">
          <div>
            <label className="settings-label">
              Message history
              <span className="ml-1.5 font-normal text-text-dim">4 – 100 messages</span>
            </label>
            <input
              id="settings-context"
              className="settings-input"
              type="number"
              min={4}
              max={100}
              step={1}
              value={form.contextSize}
              onChange={(e) => setField('contextSize', Number(e.target.value))}
            />
            <p className="text-[11.5px] text-text-dim mt-1">
              Number of recent messages included with each request. Not the same as model token context.
            </p>
          </div>
        </div>
      </div>

      {/* ════ GENERATION ════ */}
      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Generation</span>
        </div>
        <div className="settings-card-body">
          <p className="text-[11.5px] text-text-dim">Set to 0 to use Ollama defaults.</p>
          <div className="grid grid-cols-2 gap-3">
            <TipField label="Temperature" tip="Randomness. 0 = deterministic, 2 = very creative.">
              <input
                id="settings-temperature"
                className="settings-input"
                type="number"
                min={0}
                max={2}
                step={0.1}
                inputMode="decimal"
                value={form.temperature}
                onChange={(e) => setField('temperature', Number(e.target.value))}
              />
            </TipField>
            <TipField label="Top P" tip="Nucleus sampling. Lower = more focused replies.">
              <input
                id="settings-top-p"
                className="settings-input"
                type="number"
                min={0.1}
                max={1}
                step={0.05}
                inputMode="decimal"
                value={form.topP}
                onChange={(e) => setField('topP', Number(e.target.value))}
              />
            </TipField>
            <TipField label="Max reply tokens" tip="Caps one reply. 0 = model default.">
              <input
                className="settings-input"
                type="number"
                min={0}
                max={8192}
                step={64}
                inputMode="numeric"
                value={form.maxTokens}
                onChange={(e) => setField('maxTokens', Number(e.target.value))}
              />
            </TipField>
            <TipField label="Context tokens" tip="num_ctx: total tokens the model can see (input + output). Higher = more memory but slower. 0 = model default (usually 8192). Increase to 16384+ when using web search or project knowledge.">
              <input
                className="settings-input"
                type="number"
                min={0}
                max={32768}
                step={512}
                inputMode="numeric"
                value={form.numCtx}
                onChange={(e) => setField('numCtx', Number(e.target.value))}
              />
            </TipField>
          </div>
        </div>
      </div>

      {/* ════ BEHAVIOR ════ */}
      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-title">Behavior</span>
        </div>
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

          <label className="flex items-start gap-2.5 cursor-pointer mt-3">
            <input
              id="settings-web-search"
              type="checkbox"
              className="mt-0.5 accent-accent shrink-0"
              checked={form.webSearch}
              onChange={(e) => setField('webSearch', e.target.checked)}
            />
            <div>
              <span className="text-[13px] text-text-muted">Web search</span>
              <p className="text-[11.5px] text-text-dim mt-0.5">
                Let the AI search the internet for up-to-date information. When an intent
                model is set, search triggers automatically for relevant queries. Without
                an intent model, every message gets a web search.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer mt-3">
            <input
              id="settings-image-generation"
              type="checkbox"
              className="mt-0.5 accent-accent shrink-0"
              checked={form.imageGeneration}
              onChange={(e) => setField('imageGeneration', e.target.checked)}
            />
            <div>
              <span className="text-[13px] text-text-muted">Image generation</span>
              <p className="text-[11.5px] text-text-dim mt-0.5">
                Enable image generation via Ollama. Requires Ollama v0.32.5 or earlier
                with an image model (e.g. x/z-image-turbo). Disabled by default since
                Ollama v0.32.6+ removed this feature.
              </p>
            </div>
          </label>
        </div>
      </div>
    </>
  );
}

// ── Shared helpers ────────────────────────────────────

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

import { useState } from 'react';
import React from 'react';

function SettingsTip({ tip }: { tip: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center cursor-help transition-colors"
        style={{
          background: 'var(--glass-md)',
          border: '1px solid var(--border)',
          color: 'var(--text-3)',
        }}
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
