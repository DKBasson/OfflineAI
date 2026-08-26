import { fmtTokens } from '../utils/markdown';
import { useApp } from '../context/AppContext';

export function Header() {
  const {
    activeModel,
    models,
    isStreaming,
    setActiveModel,
    tokenStats,
    connectionState,
    connectionLabel,
    connectionTitle,
    openSidebar,
    openSettings,
    startNewChat,
    exportConversation,
    setShortcutsOpen,
    messages,
    activeProject,
    openProjectsPanel,
  } = useApp();

  const total = tokenStats.input + tokenStats.output;

  return (
    <header className="flex items-center gap-2 px-3.5 py-2 shrink-0 relative z-10" style={{ background: 'rgba(7,8,15,0.88)', backdropFilter: 'blur(18px) saturate(140%)', borderBottom: '1px solid var(--border)', boxShadow: '0 1px 0 rgba(255,255,255,0.035), inset 0 1px 0 rgba(143,202,231,0.04)' }}>
      {/* History toggle */}
      <button
        className="hdr-icon-btn"
        id="history-btn"
        title="History (⌘L)"
        onClick={openSidebar}
        aria-label="Open history"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Projects */}
      <button
        className="hdr-icon-btn"
        title="Projects (⌘P)"
        onClick={openProjectsPanel}
        aria-label="Open projects"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {/* New chat */}
      <button
        className="hdr-icon-btn"
        id="clear-btn"
        title="New chat (⌘K)"
        onClick={startNewChat}
        aria-label="New chat"
        disabled={isStreaming}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {/* Brand */}
      <span className="brand text-[13px] font-semibold text-text-primary tracking-tight select-none">OfflineAI</span>

      {/* Active project badge */}
      {activeProject && (
        <button
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-accent-lo border border-accent-b text-accent cursor-pointer hover:bg-accent-lo/70 transition-colors"
          onClick={openProjectsPanel}
          title={`Project: ${activeProject.name}`}
        >
          <span>📂</span>
          <span className="max-w-[120px] truncate">{activeProject.name}</span>
        </button>
      )}

      {/* Model selector */}
      <select
        id="chat-model-select"
        className="flex-1 min-w-0 bg-transparent border border-transparent rounded-sm text-text-primary text-xs font-medium px-2 py-1.5 outline-none cursor-pointer hover:border-border hover:bg-surface-md transition-colors truncate max-w-[220px]"
        value={activeModel}
        onChange={(e) => {
          if (!isStreaming) setActiveModel(e.target.value, { persistDefault: !messages.length });
        }}
        disabled={isStreaming}
        aria-label="Select model"
      >
        {models.map((m) => (
          <option key={m} value={m} className="bg-panel">
            {m}
          </option>
        ))}
      </select>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Connection pill */}
      <ConnectionPill state={connectionState} label={connectionLabel} title={connectionTitle} />

      {/* Token counter — always rendered so #token-counter and #token-count are always in DOM */}
      <div
        id="token-counter"
        className={`flex items-center gap-1 px-2 py-1 rounded-full bg-transparent border border-border text-text-dim text-[11px] font-semibold tracking-wide cursor-default shrink-0 ${total === 0 ? 'opacity-0 pointer-events-none' : ''}`}
        title={`Tokens used\nInput: ${tokenStats.input.toLocaleString()}\nOutput: ${tokenStats.output.toLocaleString()}\nTotal: ${total.toLocaleString()}`}
        aria-label={`${fmtTokens(total)} tokens used`}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-60 shrink-0">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
        <span id="token-count">{fmtTokens(total)}</span>
      </div>

      {/* Export — always in DOM, hidden when no messages */}
      <button
        id="export-btn"
        className={`hdr-icon-btn ${messages.length === 0 ? 'opacity-0 pointer-events-none' : ''}`}
        title="Export conversation (⌘E)"
        onClick={exportConversation}
        aria-label="Export conversation"
        tabIndex={messages.length === 0 ? -1 : 0}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>

      {/* Shortcuts */}
      <button
        className="hdr-icon-btn"
        id="shortcuts-btn"
        title="Keyboard shortcuts (?)"
        onClick={() => setShortcutsOpen(true)}
        aria-label="Keyboard shortcuts"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M7 15h10M9 11l-2 2 2 2M15 11l2 2-2 2" />
        </svg>
      </button>

      {/* Settings */}
      <button
        className="hdr-icon-btn"
        id="settings-btn"
        title="Settings"
        onClick={openSettings}
        aria-label="Open settings"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </button>
    </header>
  );
}

function ConnectionPill({
  state,
  label,
  title,
}: {
  state: 'checking' | 'online' | 'offline';
  label: string;
  title: string;
}) {
  const dotClass =
    state === 'online'
      ? 'bg-[#78d28b]'
      : state === 'offline'
        ? 'bg-[rgba(255,69,58,0.9)]'
        : 'bg-[rgba(255,255,255,0.34)]';

  const textClass =
    state === 'online'
      ? 'text-[#78d28b]'
      : state === 'offline'
        ? 'text-[rgba(255,160,150,0.95)]'
        : 'text-text-dim';

  return (
    <div
      id="connection-pill"
      className={`relative flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-semibold whitespace-nowrap cursor-default shrink-0 ${state} ${textClass} ${state === 'checking' ? 'conn-checking' : ''}`}
      style={{ background: 'var(--glass-sm)', borderColor: 'var(--border)' }}
      title={title}
      aria-label={title}
      role="status"
    >
      <span className={`w-[6px] h-[6px] rounded-full ${dotClass} ${state === 'checking' ? 'animate-pulse' : ''}`} />
      {label}
      {/* Hidden tooltip anchor for tests */}
      <span id="connection-tooltip" className="sr-only">{title}</span>
    </div>
  );
}
