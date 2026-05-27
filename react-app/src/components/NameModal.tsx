import { useState } from 'react';
import { useApp } from '../context/AppContext';

export function NameModal() {
  const { isNameModalOpen, submitName } = useApp();
  const [value, setValue] = useState('');

  if (!isNameModalOpen) return null;

  function handleSubmit() {
    const name = value.trim();
    if (!name) return;
    submitName(name);
    setValue('');
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Enter your name"
    >
      <div
        className="w-full max-w-sm rounded-[14px] overflow-hidden"
        style={{
          background: 'rgba(10,11,20,0.96)',
          border: '1px solid var(--border-hi)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.07)',
          backdropFilter: 'blur(30px) saturate(160%)',
        }}
      >
        <div className="px-7 pt-8 pb-6 text-center">
          <div className="welcome-glyph mx-auto mb-5" style={{ animationDuration: '3.2s' }}>⚡</div>
          <h2 className="text-[19px] font-semibold text-text-primary tracking-tight">Welcome to OfflineAI</h2>
          <p className="text-[13px] mt-1.5" style={{ color: 'var(--text-2)' }}>What should I call you?</p>
        </div>
        <div className="px-7 pb-7">
          <input
            type="text"
            className="settings-input mb-3"
            placeholder="Your name…"
            maxLength={32}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            autoFocus
            id="name-modal-input"
          />
          <button
            className="w-full font-semibold text-[14px] py-2.5 rounded-sm transition-opacity hover:opacity-90 active:scale-[0.99]"
            style={{ background: 'var(--accent)', color: '#07080f' }}
            onClick={handleSubmit}
            id="name-modal-btn"
          >
            Get started
          </button>
        </div>
      </div>
    </div>
  );
}
