import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { renderMarkdown, highlightCodeBlocks } from '../utils/markdown';
import { writeProjectFile, authHeaders } from '../utils/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ArtifactCanvasProps {
  isOpen: boolean;
  content: string;
  contentType: 'markdown' | 'code' | 'csv' | 'json' | 'text';
  title: string;
  isStreaming: boolean;
  generatedFiles: string[];
  activeProjectId: string | null;
  filePath?: string;
  onContentUpdate?: (newContent: string) => void;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const BADGE_LABELS: Record<ArtifactCanvasProps['contentType'], string> = {
  markdown: 'Markdown',
  code: 'Code',
  csv: 'CSV',
  json: 'JSON',
  text: 'Text',
};

const MIME_TYPES: Record<ArtifactCanvasProps['contentType'], string> = {
  markdown: 'text/markdown',
  code: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  text: 'text/plain',
};

const FILE_EXTENSIONS: Record<ArtifactCanvasProps['contentType'], string> = {
  markdown: '.md',
  code: '.txt',
  csv: '.csv',
  json: '.json',
  text: '.txt',
};

/** Sanitize a title into a safe filename. */
function toFilename(title: string, ext: string): string {
  const safe = title
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60);
  return (safe || 'artifact') + ext;
}

/** Parse CSV text into a 2-D array of strings. */
function parseCsv(raw: string): string[][] {
  return raw
    .trim()
    .split('\n')
    .map((line) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '')));
}

/** Pretty-print JSON with fallback to raw text. */
function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Add line numbers to a code string. */
function addLineNumbers(code: string): { numbered: string; count: number } {
  const lines = code.split('\n');
  const pad = String(lines.length).length;
  const numbered = lines
    .map((l, i) => `${String(i + 1).padStart(pad)}  ${l}`)
    .join('\n');
  return { numbered, count: lines.length };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ArtifactCanvas({
  isOpen,
  content,
  contentType,
  title,
  isStreaming,
  generatedFiles,
  activeProjectId,
  filePath,
  onContentUpdate,
  onClose,
}: ArtifactCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const markdownRef = useRef<HTMLDivElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  /* ---- Auto-scroll while streaming ---- */
  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, isStreaming]);

  /* ---- Highlight code blocks after Markdown render ---- */
  useEffect(() => {
    if (contentType === 'markdown' && markdownRef.current) {
      highlightCodeBlocks(markdownRef.current);
    }
  }, [content, contentType]);

  /* ---- Download handler ---- */
  const handleDownload = useCallback(() => {
    const mime = MIME_TYPES[contentType];
    const ext = FILE_EXTENSIONS[contentType];
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = toFilename(title, ext);
    a.click();
    URL.revokeObjectURL(url);
  }, [content, contentType, title]);

  /* ---- Copy code handler ---- */
  const handleCopyCode = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  }, [content]);

  /* ---- Edit mode handlers ---- */
  const handleEditToggle = useCallback(() => {
    if (isStreaming) return;
    setEditContent(content);
    setEditMode(true);
    // Focus the textarea after render
    setTimeout(() => editTextareaRef.current?.focus(), 50);
  }, [content, isStreaming]);

  const handleEditCancel = useCallback(() => {
    setEditMode(false);
    setEditContent('');
  }, []);

  const handleEditSave = useCallback(async () => {
    setSaving(true);
    try {
      // If project + file path available, save to backend
      if (activeProjectId && filePath) {
        const ok = await writeProjectFile(activeProjectId, filePath, editContent);
        if (!ok) {
          console.warn('[ArtifactCanvas] Failed to save file to backend');
        }
      }
      // Update the canvas content via callback
      onContentUpdate?.(editContent);
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  }, [activeProjectId, filePath, editContent, onContentUpdate]);

  /* ---- Exit edit mode when canvas closes ---- */
  useEffect(() => {
    if (!isOpen) {
      setEditMode(false);
      setEditContent('');
    }
  }, [isOpen]);

  /* ---- Export format handler ---- */
  const handleExportFormat = useCallback(async (format: 'pdf' | 'docx' | 'html') => {
    // Find the first .md file in generatedFiles to use as file_path
    const mdFile = generatedFiles.find((f) => f.toLowerCase().endsWith('.md'));
    if (!mdFile || !activeProjectId) return;

    try {
      const resp = await fetch(`/api/projects/${activeProjectId}/export-${format}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ file_path: mdFile }),
      });
      if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stem = mdFile.split('/').pop()?.replace(/\.md$/i, '') || 'document';
      const ext = format === 'docx' ? '.docx' : format === 'pdf' ? '.pdf' : '.html';
      a.download = stem + ext;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(`Export to ${format} failed:`, err);
    }
  }, [generatedFiles, activeProjectId]);

  /** Show export-format buttons when viewing Markdown with a project active and a .md source file available. */
  const showExportButtons = contentType === 'markdown'
    && !!activeProjectId
    && generatedFiles.some((f) => f.toLowerCase().endsWith('.md'));

  /* ---- Rendered markdown (memoised) ---- */
  const renderedHtml = useMemo(() => {
    if (contentType === 'markdown') return renderMarkdown(content);
    return '';
  }, [content, contentType]);

  /* ---- CSV table rows ---- */
  const csvRows = useMemo(() => {
    if (contentType === 'csv') return parseCsv(content);
    return [];
  }, [content, contentType]);

  /* ---- Formatted JSON ---- */
  const formattedJson = useMemo(() => {
    if (contentType === 'json') return prettyJson(content);
    return '';
  }, [content, contentType]);

  /* ---- Code with line numbers ---- */
  const codeData = useMemo(() => {
    if (contentType === 'code') return addLineNumbers(content);
    return { numbered: '', count: 0 };
  }, [content, contentType]);

  /* ---- Close on Escape ---- */
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editMode) {
          handleEditCancel();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, editMode, handleEditCancel]);

  /* ---- Pulsing cursor element ---- */
  const streamingCursor = isStreaming ? (
    <span
      aria-label="Streaming in progress"
      style={{
        display: 'inline-block',
        width: 8,
        height: 18,
        marginLeft: 2,
        background: 'var(--accent)',
        borderRadius: 2,
        animation: 'artifact-pulse 1s ease-in-out infinite',
        verticalAlign: 'text-bottom',
      }}
    />
  ) : null;

  /* ---- Render content body ---- */
  const renderContent = () => {
    switch (contentType) {
      case 'markdown':
        return (
          <div
            ref={markdownRef}
            className="prose-msg"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        );

      case 'code':
        return (
          <div style={{ position: 'relative' }}>
            <button
              onClick={handleCopyCode}
              aria-label="Copy code"
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'var(--glass)',
                color: 'var(--text-2)',
                cursor: 'pointer',
                zIndex: 2,
              }}
            >
              {codeCopied ? 'Copied!' : 'Copy'}
            </button>
            <pre
              style={{
                margin: 0,
                padding: 16,
                fontSize: 13,
                lineHeight: 1.6,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                overflowX: 'auto',
                background: 'var(--glass)',
                borderRadius: 'var(--r-sm)',
                color: 'var(--text)',
              }}
            >
              <code>{codeData.numbered}</code>
            </pre>
          </div>
        );

      case 'csv':
        return (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              }}
            >
              {csvRows.length > 0 && (
                <thead>
                  <tr>
                    {csvRows[0].map((cell, i) => (
                      <th
                        key={i}
                        style={{
                          textAlign: 'left',
                          padding: '8px 12px',
                          borderBottom: '2px solid var(--border-hi)',
                          color: 'var(--accent)',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {csvRows.slice(1).map((row, ri) => (
                  <tr
                    key={ri}
                    style={{
                      background: ri % 2 === 0 ? 'transparent' : 'var(--glass)',
                    }}
                  >
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        style={{
                          padding: '6px 12px',
                          borderBottom: '1px solid var(--border)',
                          color: 'var(--text)',
                        }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      case 'json':
        return (
          <pre
            style={{
              margin: 0,
              padding: 16,
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              overflowX: 'auto',
              background: 'var(--glass)',
              borderRadius: 'var(--r-sm)',
              color: 'var(--text)',
            }}
          >
            <code>{formattedJson}</code>
          </pre>
        );

      case 'text':
      default:
        return (
          <pre
            style={{
              margin: 0,
              padding: 16,
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--text)',
            }}
          >
            {content}
          </pre>
        );
    }
  };

  /* ---- Generated files list ---- */
  const renderFiles = () => {
    if (!generatedFiles.length || !activeProjectId) return null;

    return (
      <div
        style={{
          borderTop: '1px solid var(--border)',
          padding: '12px 20px 16px',
        }}
      >
        <h3
          style={{
            margin: '0 0 8px',
            fontSize: 12,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-2)',
          }}
        >
          Files
        </h3>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {generatedFiles.map((filePath) => {
            const fileName = filePath.split('/').pop() || filePath;
            const isPdf = fileName.toLowerCase().endsWith('.pdf');
            const downloadUrl = `/api/projects/${activeProjectId}/download/${encodeURIComponent(filePath)}`;
            const viewUrl = `/api/projects/${activeProjectId}/view/${encodeURIComponent(filePath)}`;

            return (
              <li
                key={filePath}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  borderRadius: 'var(--r-sm)',
                  background: 'var(--glass)',
                  fontSize: 13,
                }}
              >
                <span
                  style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                  title={filePath}
                >
                  {fileName}
                </span>
                <span style={{ display: 'flex', gap: 8, marginLeft: 12, flexShrink: 0 }}>
                  {isPdf && (
                    <a
                      href={viewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 11,
                        color: 'var(--accent)',
                        textDecoration: 'none',
                        cursor: 'pointer',
                      }}
                      aria-label={`View ${fileName}`}
                    >
                      View
                    </a>
                  )}
                  <a
                    href={downloadUrl}
                    download
                    style={{
                      fontSize: 11,
                      color: 'var(--accent)',
                      textDecoration: 'none',
                      cursor: 'pointer',
                    }}
                    aria-label={`Download ${fileName}`}
                  >
                    Download
                  </a>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <>
      {/* Keyframe for pulsing cursor */}
      <style>{`
        @keyframes artifact-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        @keyframes artifact-slide-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        @keyframes artifact-slide-out {
          from { transform: translateX(0); }
          to   { transform: translateX(100%); }
        }
      `}</style>

      <aside
        role="complementary"
        aria-label="Artifact preview"
        aria-hidden={!isOpen}
        style={{
          position: 'fixed',
          top: 50,
          right: 0,
          bottom: 0,
          width: '50vw',
          maxWidth: '100vw',
          zIndex: 200,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--panel)',
          borderLeft: '1px solid var(--border)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
          animation: isOpen ? 'artifact-slide-in 0.25s ease-out forwards' : 'artifact-slide-out 0.2s ease-in forwards',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
        {/* ---- Header ---- */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            minHeight: 44,
            flexShrink: 0,
          }}
        >
          {/* Title */}
          <h2
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
            title={title}
          >
            {title}
          </h2>

          {/* Content-type badge */}
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: '2px 8px',
              borderRadius: 9999,
              background: 'var(--glass-md)',
              color: 'var(--accent)',
              border: '1px solid var(--border)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {BADGE_LABELS[contentType]}
          </span>

          {/* Streaming indicator */}
          {isStreaming && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                color: 'var(--text-3)',
                flexShrink: 0,
              }}
              aria-label="Streaming"
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  animation: 'artifact-pulse 1s ease-in-out infinite',
                }}
              />
              Streaming
            </span>
          )}

          {/* Export format buttons */}
          {showExportButtons && !isStreaming && (
            <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {(['DOCX', 'HTML', 'PDF'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => handleExportFormat(fmt.toLowerCase() as 'docx' | 'html' | 'pdf')}
                  aria-label={`Export as ${fmt}`}
                  title={`Export as ${fmt}`}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text-2)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--glass-md)';
                    e.currentTarget.style.color = 'var(--accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-2)';
                  }}
                >
                  {fmt}
                </button>
              ))}
            </span>
          )}

          {/* Edit toggle button */}
          <button
            onClick={editMode ? handleEditCancel : handleEditToggle}
            aria-label={editMode ? 'Cancel editing' : 'Edit content'}
            title={editMode ? 'Cancel edit' : 'Edit'}
            disabled={isStreaming}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 'var(--r-sm)',
              border: editMode ? '1px solid var(--accent)' : '1px solid var(--border)',
              background: editMode ? 'var(--accent-lo)' : 'transparent',
              color: editMode ? 'var(--accent)' : 'var(--text-2)',
              cursor: isStreaming ? 'not-allowed' : 'pointer',
              fontSize: 14,
              flexShrink: 0,
              opacity: isStreaming ? 0.4 : 1,
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!isStreaming && !editMode) {
                e.currentTarget.style.background = 'var(--glass-md)';
                e.currentTarget.style.color = 'var(--text)';
              }
            }}
            onMouseLeave={(e) => {
              if (!editMode) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-2)';
              }
            }}
          >
            ✎
          </button>

          {/* Download button */}
          <button
            onClick={handleDownload}
            aria-label="Download artifact"
            title="Download"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-2)',
              cursor: 'pointer',
              fontSize: 15,
              flexShrink: 0,
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--glass-md)';
              e.currentTarget.style.color = 'var(--text)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-2)';
            }}
          >
            ↓
          </button>

          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="Close artifact panel"
            title="Close"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-2)',
              cursor: 'pointer',
              fontSize: 16,
              flexShrink: 0,
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--glass-md)';
              e.currentTarget.style.color = 'var(--text)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-2)';
            }}
          >
            ✕
          </button>
        </header>

        {/* ---- Scrollable content area ---- */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: editMode ? 0 : 20,
            position: 'relative',
          }}
        >
          {editMode ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Line numbers */}
                <div
                  aria-hidden="true"
                  style={{
                    padding: '16px 0',
                    minWidth: 44,
                    textAlign: 'right',
                    paddingRight: 12,
                    paddingLeft: 12,
                    fontSize: 13,
                    lineHeight: '1.6',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    color: 'var(--text-3, #555)',
                    background: 'var(--glass)',
                    borderRight: '1px solid var(--border)',
                    overflowY: 'hidden',
                    userSelect: 'none',
                    flexShrink: 0,
                  }}
                >
                  {editContent.split('\n').map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
                {/* Textarea */}
                <textarea
                  ref={editTextareaRef}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  spellCheck={false}
                  style={{
                    flex: 1,
                    resize: 'none',
                    border: 'none',
                    outline: 'none',
                    padding: 16,
                    fontSize: 13,
                    lineHeight: '1.6',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    background: 'transparent',
                    color: 'var(--text)',
                    overflowY: 'auto',
                    tabSize: 2,
                  }}
                  onKeyDown={(e) => {
                    // Ctrl/Cmd+S to save
                    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                      e.preventDefault();
                      handleEditSave();
                    }
                  }}
                  aria-label="Edit artifact content"
                />
              </div>
              {/* Floating toolbar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 8,
                  padding: '10px 16px',
                  borderTop: '1px solid var(--border)',
                  background: 'var(--panel)',
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--text-3)', marginRight: 'auto' }}>
                  {editContent.split('\n').length} lines · {editContent.length} chars
                  {activeProjectId && filePath ? '' : ' · Local only (no project file)'}
                </span>
                <button
                  onClick={handleEditCancel}
                  style={{
                    padding: '5px 14px',
                    fontSize: 12,
                    fontWeight: 500,
                    borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text-2)',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--glass-md)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditSave}
                  disabled={saving}
                  style={{
                    padding: '5px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--accent)',
                    background: 'var(--accent)',
                    color: '#07080f',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.6 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {renderContent()}
              {streamingCursor}
            </>
          )}
        </div>

        {/* ---- Generated files list ---- */}
        {renderFiles()}
      </aside>
    </>
  );
}
