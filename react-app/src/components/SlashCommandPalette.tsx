import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ── Types ──────────────────────────────────────────────────────── */

interface SlashCommandPaletteProps {
  inputText: string;
  isVisible: boolean;
  hasActiveProject: boolean;
  onSelect: (command: string, options?: { depth?: string; format?: string; type?: string }) => void;
  onClose: () => void;
}

interface SubOption {
  key: string;
  label: string;
  optionField: 'depth' | 'format' | 'type';
  defaultValue: string;
  choices: string[];
}

interface CommandDef {
  name: string;
  icon: string;
  description: string;
  projectOnly: boolean;
  subOption?: SubOption;
}

/* ── Command definitions ────────────────────────────────────────── */

const COMMANDS: CommandDef[] = [
  {
    name: 'research',
    icon: '🔍',
    description: 'Autonomous multi-step web research',
    projectOnly: true,
    subOption: {
      key: 'depth',
      label: 'Depth',
      optionField: 'depth',
      defaultValue: 'standard',
      choices: ['quick', 'standard', 'deep'],
    },
  },
  {
    name: 'document',
    icon: '📄',
    description: 'Generate a Markdown report',
    projectOnly: true,
    subOption: {
      key: 'type',
      label: 'Type',
      optionField: 'type',
      defaultValue: 'report',
      choices: ['report', 'summary', 'analysis'],
    },
  },
  {
    name: 'code',
    icon: '💻',
    description: 'Generate code (plan → generate) or import existing project',
    projectOnly: true,
  },
  {
    name: 'data',
    icon: '📊',
    description: 'Generate structured data (CSV/JSON)',
    projectOnly: true,
    subOption: {
      key: 'format',
      label: 'Format',
      optionField: 'format',
      defaultValue: 'csv',
      choices: ['csv', 'json'],
    },
  },
  {
    name: 'workflow',
    icon: '⚡',
    description: 'Chain multiple steps autonomously',
    projectOnly: true,
  },
  {
    name: 'build',
    icon: '🔨',
    description: 'Build a custom AI tool',
    projectOnly: false,
  },
];

/* ── Component ──────────────────────────────────────────────────── */

export function SlashCommandPalette({
  inputText,
  isVisible,
  hasActiveProject,
  onSelect,
  onClose,
}: SlashCommandPaletteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeSubPicker, setActiveSubPicker] = useState<string | null>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  /* ── Derive the filter query from input text ────────────────── */
  const query = useMemo(() => {
    const trimmed = inputText.trim();
    if (!trimmed.startsWith('/')) return '';
    // Extract the command part (first word after /)
    const firstSpace = trimmed.indexOf(' ');
    const cmd = firstSpace > 0 ? trimmed.slice(1, firstSpace) : trimmed.slice(1);
    return cmd.toLowerCase();
  }, [inputText]);

  /* ── Filter commands based on project state and query ────────── */
  const filteredCommands = useMemo(() => {
    const available = hasActiveProject
      ? COMMANDS
      : COMMANDS.filter((c) => !c.projectOnly);

    if (!query) return available;
    return available.filter((c) => c.name.startsWith(query));
  }, [hasActiveProject, query]);

  /* ── Reset selection when filtered list changes ─────────────── */
  useEffect(() => {
    setSelectedIndex(0);
    setActiveSubPicker(null);
  }, [filteredCommands.length, isVisible]);

  /* ── Scroll selected item into view ─────────────────────────── */
  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  /* ── Select a command (handle sub-options) ──────────────────── */
  const selectCommand = useCallback(
    (cmd: CommandDef) => {
      if (cmd.subOption) {
        setActiveSubPicker(cmd.name);
      } else {
        onSelect(cmd.name);
      }
    },
    [onSelect],
  );

  /* ── Select a sub-option pill ───────────────────────────────── */
  const selectSubOption = useCallback(
    (cmd: CommandDef, value: string) => {
      const opts: { depth?: string; format?: string; type?: string } = {};
      opts[cmd.subOption!.optionField] = value;
      onSelect(cmd.name, opts);
      setActiveSubPicker(null);
    },
    [onSelect],
  );

  /* ── Keyboard handler ───────────────────────────────────────── */
  useEffect(() => {
    if (!isVisible) return;

    function handleKey(e: KeyboardEvent) {
      // If a sub-picker is active, only Escape closes
      if (activeSubPicker) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setActiveSubPicker(null);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : 0,
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredCommands.length - 1,
          );
          break;
        case 'Enter':
          e.preventDefault();
          e.stopPropagation();
          if (filteredCommands[selectedIndex]) {
            selectCommand(filteredCommands[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }
    }

    // Use capture to intercept before textarea
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [isVisible, selectedIndex, filteredCommands, activeSubPicker, selectCommand, onClose]);

  /* ── Click outside to close ─────────────────────────────────── */
  useEffect(() => {
    if (!isVisible) return;

    function handleClickOutside(e: MouseEvent) {
      if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVisible, onClose]);

  /* ── Don't render when hidden or no matches ─────────────────── */
  if (!isVisible || filteredCommands.length === 0) return null;

  return (
    <div
      ref={paletteRef}
      className="absolute bottom-full left-0 mb-2 z-50"
      style={{
        width: '340px',
        maxWidth: 'calc(100vw - 32px)',
        background: 'var(--glass-md)',
        border: '1px solid var(--border-hi)',
        borderRadius: 'var(--r)',
        boxShadow: '0 20px 56px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.07)',
        backdropFilter: 'blur(30px) saturate(160%)',
        animation: 'slash-slide-up 0.18s cubic-bezier(0.34, 1.2, 0.64, 1) both',
        overflow: 'hidden',
      }}
      role="listbox"
      aria-label="Slash commands"
    >
      {/* Header */}
      <div
        className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}
      >
        Commands
      </div>

      {/* Command list */}
      <div className="py-1 max-h-[280px] overflow-y-auto">
        {filteredCommands.map((cmd, i) => {
          const isSelected = i === selectedIndex;
          const isSubPickerOpen = activeSubPicker === cmd.name;

          return (
            <div
              key={cmd.name}
              ref={(el) => {
                if (el) itemRefs.current.set(i, el);
                else itemRefs.current.delete(i);
              }}
            >
              {/* Command row */}
              <div
                className="flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors duration-100"
                style={{
                  background: isSelected ? 'var(--glass-hi)' : 'transparent',
                  borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                }}
                onClick={() => {
                  setSelectedIndex(i);
                  selectCommand(cmd);
                }}
                onMouseEnter={() => setSelectedIndex(i)}
                role="option"
                aria-selected={isSelected}
                aria-label={`/${cmd.name} — ${cmd.description}`}
              >
                {/* Icon */}
                <span className="text-[16px] shrink-0 w-6 text-center leading-none">
                  {cmd.icon}
                </span>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <span
                    className="text-[13px] font-semibold"
                    style={{ color: 'var(--accent)' }}
                  >
                    /{cmd.name}
                  </span>
                  <span
                    className="text-[12px] ml-2"
                    style={{ color: 'var(--text-2)' }}
                  >
                    {cmd.description}
                  </span>
                </div>

                {/* Chevron for sub-options */}
                {cmd.subOption && (
                  <span
                    className="text-[10px] shrink-0 transition-transform duration-150"
                    style={{
                      color: 'var(--text-3)',
                      transform: isSubPickerOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}
                  >
                    ▸
                  </span>
                )}
              </div>

              {/* Sub-picker (inline, below the command row) */}
              {isSubPickerOpen && cmd.subOption && (
                <div
                  className="flex items-center gap-1.5 px-4 py-2"
                  style={{
                    background: 'var(--glass)',
                    borderTop: '1px solid var(--border)',
                    borderBottom: '1px solid var(--border)',
                    animation: 'slash-sub-in 0.14s ease-out both',
                  }}
                >
                  <span
                    className="text-[11px] font-medium mr-1 shrink-0"
                    style={{ color: 'var(--text-3)' }}
                  >
                    {cmd.subOption.label}:
                  </span>
                  {cmd.subOption.choices.map((choice) => {
                    const isDefault = choice === cmd.subOption!.defaultValue;
                    return (
                      <button
                        key={choice}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-full cursor-pointer transition-all duration-100"
                        style={{
                          background: isDefault ? 'var(--accent-lo)' : 'var(--glass-md)',
                          border: `1px solid ${isDefault ? 'var(--border-blue)' : 'var(--border)'}`,
                          color: isDefault ? 'var(--accent)' : 'var(--text-2)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--accent-lo)';
                          e.currentTarget.style.borderColor = 'var(--border-blue)';
                          e.currentTarget.style.color = 'var(--accent)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isDefault) {
                            e.currentTarget.style.background = 'var(--glass-md)';
                            e.currentTarget.style.borderColor = 'var(--border)';
                            e.currentTarget.style.color = 'var(--text-2)';
                          }
                        }}
                        onClick={() => selectSubOption(cmd, choice)}
                        aria-label={`${cmd.subOption!.label}: ${choice}${isDefault ? ' (default)' : ''}`}
                      >
                        {choice}
                        {isDefault && (
                          <span
                            className="ml-1 text-[9px]"
                            style={{ color: 'var(--text-3)' }}
                          >
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer hint */}
      <div
        className="flex items-center gap-3 px-3 py-1.5 text-[10px]"
        style={{ color: 'var(--text-3)', borderTop: '1px solid var(--border)' }}
      >
        <span>
          <kbd
            className="px-1 py-0.5 rounded text-[9px] font-mono"
            style={{
              background: 'var(--glass-md)',
              border: '1px solid var(--border)',
            }}
          >
            ↑↓
          </kbd>{' '}
          navigate
        </span>
        <span>
          <kbd
            className="px-1 py-0.5 rounded text-[9px] font-mono"
            style={{
              background: 'var(--glass-md)',
              border: '1px solid var(--border)',
            }}
          >
            ↵
          </kbd>{' '}
          select
        </span>
        <span>
          <kbd
            className="px-1 py-0.5 rounded text-[9px] font-mono"
            style={{
              background: 'var(--glass-md)',
              border: '1px solid var(--border)',
            }}
          >
            esc
          </kbd>{' '}
          close
        </span>
      </div>

      {/* Inline keyframes */}
      <style>{`
        @keyframes slash-slide-up {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes slash-sub-in {
          from { opacity: 0; max-height: 0; }
          to   { opacity: 1; max-height: 60px; }
        }
      `}</style>
    </div>
  );
}
