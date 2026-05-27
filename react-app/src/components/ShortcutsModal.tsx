import { useApp } from '../context/AppContext';

export function ShortcutsModal() {
  const { isShortcutsOpen, setShortcutsOpen } = useApp();

  if (!isShortcutsOpen) return null;

  function close() { setShortcutsOpen(false); }

  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  const mod = isMac ? '⌘' : 'Ctrl';

  const shortcuts = [
    { keys: `${mod} + Enter`, label: 'Send message' },
    { keys: 'Enter', label: 'Send message' },
    { keys: 'Shift + Enter', label: 'New line' },
    { keys: `${mod} + K`, label: 'New chat' },
    { keys: `${mod} + L`, label: 'Toggle history sidebar' },
    { keys: `${mod} + E`, label: 'Export conversation' },
    { keys: `${mod} + /`, label: 'Focus input' },
    { keys: `${mod} + Shift + F`, label: 'Toggle focus mode' },
    { keys: '?', label: 'Show shortcuts' },
    { keys: 'Esc', label: 'Close modals / sidebars' },
  ];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="w-full max-w-sm rounded-[14px] overflow-hidden"
        style={{
          background: 'rgba(10,11,20,0.96)',
          border: '1px solid var(--border-hi)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.07)',
          backdropFilter: 'blur(30px) saturate(160%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-[15px] font-semibold text-text-primary tracking-tight">Keyboard shortcuts</h2>
          <button
            className="w-[26px] h-[26px] rounded-full text-[13px] flex items-center justify-center transition-colors"
            style={{ background: 'var(--glass-md)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
            onClick={close}
            aria-label="Close shortcuts"
          >
            ✕
          </button>
        </div>
        <table className="w-full px-2">
          <tbody>
            {shortcuts.map(({ keys, label }) => (
              <tr key={keys} style={{ borderBottom: '1px solid var(--border)' }} className="last:border-0">
                <td className="py-2.5 pl-6 pr-4 w-[140px]">
                  <kbd
                    className="text-[11px] font-mono whitespace-nowrap px-2 py-0.5 rounded"
                    style={{
                      background: 'var(--glass-md)',
                      border: '1px solid var(--border-blue)',
                      color: 'var(--accent)',
                      boxShadow: 'var(--edge-blue)',
                    }}
                  >
                    {keys}
                  </kbd>
                </td>
                <td className="py-2.5 pr-6 text-[13px]" style={{ color: 'var(--text-2)' }}>{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
