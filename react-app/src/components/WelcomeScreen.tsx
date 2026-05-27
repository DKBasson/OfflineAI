import { useApp } from '../context/AppContext';

export function WelcomeScreen() {
  const { activeUsername, activeModel } = useApp();

  const greeting = activeUsername ? `Hello, ${activeUsername}` : 'OfflineAI';

  return (
    <div
      id="welcome"
      className="flex flex-col items-center justify-center flex-1 text-center py-12 select-none"
    >
      <div className="welcome-glyph mb-6">⚡</div>
      <h2 className="text-[22px] font-semibold text-text-primary mb-1">{greeting}</h2>
      <p className="text-[13px] leading-relaxed max-w-xs" style={{ color: 'var(--text-2)' }}>
        Chatting with <strong style={{ color: 'var(--accent)' }}>{activeModel}</strong>
      </p>
      <p className="text-[11px] mt-2 tracking-widest uppercase" style={{ color: 'var(--text-3)' }}>
        Local · Private · No cloud
      </p>
    </div>
  );
}
