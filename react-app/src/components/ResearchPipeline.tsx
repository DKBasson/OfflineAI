import { useCallback } from 'react';

/* ── Types ────────────────────────────────────────────────────────── */

export interface ResearchQuery {
  id: string;
  text: string;
  enabled: boolean;
}

export interface ResearchSource {
  url: string;
  title: string;
  snippet: string;
  included: boolean;
}

export type PipelinePhase =
  | 'plan'
  | 'searching'
  | 'reading'
  | 'extracting'
  | 'synthesizing'
  | 'done';

export interface ResearchPipelineProps {
  isOpen: boolean;
  topic: string;
  depth: 'quick' | 'standard' | 'deep';
  queries: ResearchQuery[];
  sources: ResearchSource[];
  phase: PipelinePhase;
  progress: string;
  onUpdateQueries: (queries: ResearchQuery[]) => void;
  onToggleSource: (url: string) => void;
  onStart: () => void;
  onClose: () => void;
}

/* ── Constants ────────────────────────────────────────────────────── */

const PHASES: PipelinePhase[] = [
  'plan',
  'searching',
  'reading',
  'extracting',
  'synthesizing',
  'done',
];

const PHASE_LABELS: Record<PipelinePhase, string> = {
  plan: 'Plan',
  searching: 'Search',
  reading: 'Read',
  extracting: 'Extract',
  synthesizing: 'Synthesize',
  done: 'Done',
};

const DEPTH_STYLES: Record<
  'quick' | 'standard' | 'deep',
  { bg: string; border: string; text: string }
> = {
  quick: {
    bg: 'rgba(93,232,152,0.10)',
    border: 'rgba(93,232,152,0.30)',
    text: '#5de898',
  },
  standard: {
    bg: 'rgba(143,202,231,0.10)',
    border: 'rgba(143,202,231,0.30)',
    text: '#8FCAE7',
  },
  deep: {
    bg: 'rgba(231,183,143,0.10)',
    border: 'rgba(231,183,143,0.30)',
    text: '#e7b78f',
  },
};

/* ── Helpers ──────────────────────────────────────────────────────── */

function phaseIndex(phase: PipelinePhase): number {
  return PHASES.indexOf(phase);
}

/* ── Sub-components ──────────────────────────────────────────────── */

/** Horizontal stepper showing pipeline phases */
function PhaseStepper({ phase }: { phase: PipelinePhase }) {
  const current = phaseIndex(phase);

  return (
    <div className="flex items-center gap-1 w-full" role="list" aria-label="Research pipeline phases">
      {PHASES.map((p, i) => {
        const isPast = i < current;
        const isCurrent = i === current;

        return (
          <div
            key={p}
            className="flex items-center gap-1 flex-1"
            role="listitem"
            aria-current={isCurrent ? 'step' : undefined}
          >
            {/* Dot / check */}
            <div className="flex items-center gap-1.5 shrink-0">
              {isPast ? (
                <span
                  className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[11px]"
                  style={{ background: 'rgba(93,232,152,0.15)', color: 'var(--ok)' }}
                  aria-label={`${PHASE_LABELS[p]} complete`}
                >
                  ✓
                </span>
              ) : isCurrent ? (
                <span
                  className="w-[18px] h-[18px] rounded-full animate-pulse"
                  style={{
                    background: 'var(--accent)',
                    boxShadow: '0 0 8px rgba(143,202,231,0.5)',
                  }}
                  aria-label={`${PHASE_LABELS[p]} in progress`}
                />
              ) : (
                <span
                  className="w-[18px] h-[18px] rounded-full"
                  style={{ background: 'var(--glass-md)', border: '1px solid var(--border)' }}
                  aria-label={`${PHASE_LABELS[p]} pending`}
                />
              )}
              <span
                className="text-[11px] font-medium whitespace-nowrap"
                style={{
                  color: isPast
                    ? 'var(--ok)'
                    : isCurrent
                      ? 'var(--accent)'
                      : 'var(--text-3)',
                }}
              >
                {PHASE_LABELS[p]}
              </span>
            </div>

            {/* Connector line (skip after last) */}
            {i < PHASES.length - 1 && (
              <div
                className="flex-1 h-px mx-1"
                style={{
                  background: isPast
                    ? 'rgba(93,232,152,0.30)'
                    : 'var(--border)',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Single query row in the plan */
function QueryRow({
  query,
  readOnly,
  onToggle,
  onChange,
  onDelete,
}: {
  query: ResearchQuery;
  readOnly: boolean;
  onToggle: () => void;
  onChange: (text: string) => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 group"
      style={{
        opacity: query.enabled ? 1 : 0.45,
      }}
    >
      {/* Checkbox */}
      <label className="flex items-center shrink-0 cursor-pointer">
        <input
          type="checkbox"
          checked={query.enabled}
          onChange={onToggle}
          disabled={readOnly}
          className="sr-only peer"
          aria-label={`Toggle query: ${query.text || 'empty'}`}
        />
        <span
          className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center text-[11px] transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
          style={{
            background: query.enabled ? 'var(--accent-b)' : 'var(--glass)',
            border: `1px solid ${query.enabled ? 'var(--border-blue)' : 'var(--border)'}`,
            color: query.enabled ? 'var(--accent)' : 'transparent',
          }}
        >
          {query.enabled && '✓'}
        </span>
      </label>

      {/* Text input */}
      {readOnly ? (
        <span
          className="flex-1 text-[13px] truncate"
          style={{ color: 'var(--text-2)' }}
        >
          {query.text}
        </span>
      ) : (
        <input
          type="text"
          value={query.text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter search query…"
          className="flex-1 text-[13px] bg-transparent outline-none px-2 py-1.5 rounded-sm transition-colors"
          style={{
            color: 'var(--text)',
            border: '1px solid var(--border)',
            background: 'var(--glass)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-blue)';
            e.currentTarget.style.background = 'var(--glass-md)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.background = 'var(--glass)';
          }}
          aria-label="Search query text"
        />
      )}

      {/* Delete button */}
      {!readOnly && (
        <button
          onClick={onDelete}
          className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-[12px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          style={{
            background: 'rgba(255,76,66,0.10)',
            border: '1px solid rgba(255,76,66,0.25)',
            color: 'var(--err)',
          }}
          aria-label={`Delete query: ${query.text || 'empty'}`}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** Single source row */
function SourceRow({
  source,
  onToggle,
}: {
  source: ResearchSource;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-start gap-2 py-2"
      style={{
        borderBottom: '1px solid var(--border)',
        opacity: source.included ? 1 : 0.5,
      }}
    >
      {/* Checkbox */}
      <label className="flex items-center shrink-0 mt-0.5 cursor-pointer">
        <input
          type="checkbox"
          checked={source.included}
          onChange={onToggle}
          className="sr-only peer"
          aria-label={`Include source: ${source.title}`}
        />
        <span
          className="w-[16px] h-[16px] rounded-[4px] flex items-center justify-center text-[10px] transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
          style={{
            background: source.included ? 'var(--accent-b)' : 'var(--glass)',
            border: `1px solid ${source.included ? 'var(--border-blue)' : 'var(--border)'}`,
            color: source.included ? 'var(--accent)' : 'transparent',
          }}
        >
          {source.included && '✓'}
        </span>
      </label>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] font-medium truncate block transition-colors hover:underline"
          style={{
            color: source.included ? 'var(--accent)' : 'var(--text-3)',
            textDecoration: source.included ? 'none' : 'line-through',
          }}
          title={source.url}
        >
          {source.title}
        </a>
        <p
          className="text-[11px] mt-0.5 line-clamp-2"
          style={{
            color: 'var(--text-3)',
            textDecoration: source.included ? 'none' : 'line-through',
          }}
        >
          {source.snippet}
        </p>
      </div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────── */

export function ResearchPipeline({
  isOpen,
  topic,
  depth,
  queries,
  sources,
  phase,
  progress,
  onUpdateQueries,
  onToggleSource,
  onStart,
  onClose,
}: ResearchPipelineProps) {
  const isPlan = phase === 'plan';
  const isDone = phase === 'done';
  const depthStyle = DEPTH_STYLES[depth];
  const enabledCount = queries.filter((q) => q.enabled).length;
  const includedCount = sources.filter((s) => s.included).length;

  /* ── Query mutations ──────────────────────────────────────────── */

  const toggleQuery = useCallback(
    (id: string) => {
      onUpdateQueries(
        queries.map((q) => (q.id === id ? { ...q, enabled: !q.enabled } : q)),
      );
    },
    [queries, onUpdateQueries],
  );

  const updateQueryText = useCallback(
    (id: string, text: string) => {
      onUpdateQueries(
        queries.map((q) => (q.id === id ? { ...q, text } : q)),
      );
    },
    [queries, onUpdateQueries],
  );

  const deleteQuery = useCallback(
    (id: string) => {
      onUpdateQueries(queries.filter((q) => q.id !== id));
    },
    [queries, onUpdateQueries],
  );

  const addQuery = useCallback(() => {
    onUpdateQueries([
      ...queries,
      { id: crypto.randomUUID(), text: '', enabled: true },
    ]);
  }, [queries, onUpdateQueries]);

  /* ── Render ───────────────────────────────────────────────────── */

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center pt-[10vh] px-4 bg-black/55 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Research pipeline"
    >
      <div
        className="w-full max-w-[640px] max-h-[80vh] flex flex-col overflow-hidden rounded-[var(--r)]"
        style={{
          background: 'rgba(10,11,20,0.96)',
          border: '1px solid var(--border-hi)',
          boxShadow:
            '0 32px 80px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.07)',
          backdropFilter: 'blur(30px) saturate(160%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2.5">
            <h2
              className="text-[15px] font-semibold tracking-tight"
              style={{ color: 'var(--text)' }}
            >
              Research Plan
            </h2>
            <span
              className="text-[11px] font-medium px-2 py-0.5 rounded-full capitalize"
              style={{
                background: depthStyle.bg,
                border: `1px solid ${depthStyle.border}`,
                color: depthStyle.text,
              }}
            >
              {depth}
            </span>
          </div>

          <button
            className="w-[26px] h-[26px] rounded-full text-[13px] flex items-center justify-center transition-colors"
            style={{
              background: 'var(--glass-md)',
              border: '1px solid var(--border)',
              color: 'var(--text-3)',
            }}
            onClick={onClose}
            aria-label="Close research pipeline"
          >
            ✕
          </button>
        </div>

        {/* ── Scrollable body ───────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Topic */}
          <div>
            <span
              className="text-[11px] uppercase tracking-wide font-medium"
              style={{ color: 'var(--text-3)' }}
            >
              Topic
            </span>
            <p
              className="text-[14px] mt-1 font-medium"
              style={{ color: 'var(--text)' }}
            >
              {topic}
            </p>
          </div>

          {/* ── Phase stepper (execution mode) ──────────────────── */}
          {!isPlan && (
            <div className="space-y-3">
              <PhaseStepper phase={phase} />
              {progress && (
                <p
                  className="text-[12px] text-center animate-pulse"
                  style={{ color: 'var(--accent)' }}
                >
                  {progress}
                </p>
              )}
            </div>
          )}

          {/* ── Done banner ─────────────────────────────────────── */}
          {isDone && (
            <div
              className="flex items-center gap-2.5 px-4 py-3 rounded-sm"
              style={{
                background: 'rgba(93,232,152,0.08)',
                border: '1px solid rgba(93,232,152,0.25)',
              }}
            >
              <span
                className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[12px] shrink-0"
                style={{ background: 'rgba(93,232,152,0.18)', color: 'var(--ok)' }}
              >
                ✓
              </span>
              <span className="text-[13px] font-medium" style={{ color: 'var(--ok)' }}>
                Research complete — report saved to project.
              </span>
            </div>
          )}

          {/* ── Queries section ─────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-[12px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text-2)' }}
              >
                Queries
                <span
                  className="ml-1.5 text-[11px] font-normal"
                  style={{ color: 'var(--text-3)' }}
                >
                  {enabledCount}/{queries.length} enabled
                </span>
              </span>
            </div>

            <div
              className="space-y-2 p-3 rounded-sm"
              style={{
                background: 'var(--glass)',
                border: '1px solid var(--border)',
              }}
            >
              {queries.map((q) => (
                <QueryRow
                  key={q.id}
                  query={q}
                  readOnly={!isPlan}
                  onToggle={() => toggleQuery(q.id)}
                  onChange={(text) => updateQueryText(q.id, text)}
                  onDelete={() => deleteQuery(q.id)}
                />
              ))}

              {isPlan && (
                <button
                  onClick={addQuery}
                  className="flex items-center gap-1.5 text-[12px] font-medium mt-1 px-2 py-1.5 rounded-sm transition-colors"
                  style={{
                    color: 'var(--accent)',
                    background: 'transparent',
                    border: '1px dashed var(--border-blue)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--accent-lo)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span className="text-[14px]">+</span> Add query
                </button>
              )}
            </div>
          </div>

          {/* ── Sources section (appears during/after execution) ── */}
          {sources.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span
                  className="text-[12px] font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--text-2)' }}
                >
                  Sources
                  <span
                    className="ml-1.5 text-[11px] font-normal"
                    style={{ color: 'var(--text-3)' }}
                  >
                    {includedCount}/{sources.length} included
                  </span>
                </span>
              </div>

              <div
                className="p-3 rounded-sm"
                style={{
                  background: 'var(--glass)',
                  border: '1px solid var(--border)',
                }}
              >
                {sources.map((s) => (
                  <SourceRow
                    key={s.url}
                    source={s}
                    onToggle={() => onToggleSource(s.url)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer actions ────────────────────────────────────── */}
        <div
          className="flex items-center justify-end gap-2.5 px-5 py-3.5 shrink-0"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {isPlan && (
            <>
              <button
                onClick={onClose}
                className="text-[13px] font-medium px-4 py-2 rounded-sm transition-colors"
                style={{
                  background: 'var(--glass-md)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-2)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--glass-hi)';
                  e.currentTarget.style.color = 'var(--text)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--glass-md)';
                  e.currentTarget.style.color = 'var(--text-2)';
                }}
              >
                Cancel
              </button>
              <button
                onClick={onStart}
                disabled={enabledCount === 0}
                className="text-[13px] font-semibold px-5 py-2 rounded-sm transition-all"
                style={{
                  background:
                    enabledCount > 0
                      ? 'linear-gradient(135deg, rgba(143,202,231,0.22), rgba(143,202,231,0.12))'
                      : 'var(--glass)',
                  border: `1px solid ${enabledCount > 0 ? 'var(--border-blue)' : 'var(--border)'}`,
                  color: enabledCount > 0 ? 'var(--accent)' : 'var(--text-3)',
                  boxShadow:
                    enabledCount > 0
                      ? '0 0 16px rgba(143,202,231,0.12), inset 0 1px 0 rgba(143,202,231,0.14)'
                      : 'none',
                  cursor: enabledCount > 0 ? 'pointer' : 'not-allowed',
                  opacity: enabledCount > 0 ? 1 : 0.5,
                }}
              >
                Start Research
              </button>
            </>
          )}

          {isDone && (
            <>
              <button
                onClick={onClose}
                className="text-[13px] font-medium px-4 py-2 rounded-sm transition-colors"
                style={{
                  background: 'var(--glass-md)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-2)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--glass-hi)';
                  e.currentTarget.style.color = 'var(--text)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--glass-md)';
                  e.currentTarget.style.color = 'var(--text-2)';
                }}
              >
                Close
              </button>
              <button
                onClick={onClose}
                className="text-[13px] font-semibold px-5 py-2 rounded-sm transition-all"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(93,232,152,0.20), rgba(93,232,152,0.08))',
                  border: '1px solid rgba(93,232,152,0.30)',
                  color: 'var(--ok)',
                  boxShadow:
                    '0 0 16px rgba(93,232,152,0.10), inset 0 1px 0 rgba(93,232,152,0.14)',
                }}
              >
                View Report
              </button>
            </>
          )}

          {!isPlan && !isDone && (
            <button
              onClick={onClose}
              className="text-[13px] font-medium px-4 py-2 rounded-sm transition-colors"
              style={{
                background: 'var(--glass-md)',
                border: '1px solid var(--border)',
                color: 'var(--text-2)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--glass-hi)';
                e.currentTarget.style.color = 'var(--text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--glass-md)';
                e.currentTarget.style.color = 'var(--text-2)';
              }}
            >
              Minimize
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
