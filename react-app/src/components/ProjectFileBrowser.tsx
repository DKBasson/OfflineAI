import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import type { ProjectFile } from '../types';
import { readProjectFile, getProjectDownloadUrl } from '../utils/api';

export function ProjectFileBrowser() {
  const { activeProject, projectFiles, refreshProjectFiles } = useApp();
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset preview when project changes
  useEffect(() => {
    setPreviewPath(null);
    setPreviewContent(null);
  }, [activeProject?.id]);

  const handleFileClick = useCallback(async (filePath: string) => {
    if (!activeProject) return;
    setPreviewPath(filePath);
    setLoading(true);
    const content = await readProjectFile(activeProject.id, filePath);
    setPreviewContent(content);
    setLoading(false);
  }, [activeProject]);

  const handleRefresh = useCallback(() => {
    if (activeProject) refreshProjectFiles(activeProject.id);
  }, [activeProject, refreshProjectFiles]);

  if (!activeProject) return null;

  // Group files by directory
  const grouped = groupByDirectory(projectFiles);

  return (
    <div className="flex flex-col border-t border-border">
      {/* File browser header */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Files</span>
        <button
          className="text-[11px] text-text-dim hover:text-text-muted transition-colors"
          onClick={handleRefresh}
          title="Refresh file list"
        >
          ↻
        </button>
      </div>

      {/* File list */}
      <div className="overflow-y-auto max-h-[240px] px-2 pb-2 scrollbar-thin">
        {projectFiles.length === 0 ? (
          <p className="text-[11px] text-text-dim text-center py-4">No files yet</p>
        ) : (
          Object.entries(grouped).map(([dir, files]) => (
            <DirectoryGroup
              key={dir}
              dir={dir}
              files={files}
              onFileClick={handleFileClick}
              projectId={activeProject.id}
            />
          ))
        )}
      </div>

      {/* File preview modal */}
      {previewPath && (
        <FilePreviewModal
          path={previewPath}
          content={previewContent}
          loading={loading}
          projectId={activeProject.id}
          onClose={() => { setPreviewPath(null); setPreviewContent(null); }}
        />
      )}
    </div>
  );
}

function DirectoryGroup({
  dir,
  files,
  onFileClick,
  projectId,
}: {
  dir: string;
  files: ProjectFile[];
  onFileClick: (path: string) => void;
  projectId: string;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-1">
      {dir !== '.' && (
        <button
          className="flex items-center gap-1 text-[11px] text-text-dim hover:text-text-muted w-full text-left px-1 py-0.5"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="text-[9px]">{expanded ? '▼' : '▶'}</span>
          <span className="font-medium">{dir}/</span>
        </button>
      )}
      {expanded && (
        <div className={dir !== '.' ? 'ml-3' : ''}>
          {files.map((f) => (
            <div
              key={f.path}
              className="flex items-center gap-1.5 px-1.5 py-1 rounded-sm hover:bg-surface-md cursor-pointer group text-[11px]"
            >
              <span
                className="flex-1 text-text-muted truncate hover:text-text-primary"
                onClick={() => onFileClick(f.path)}
                title={f.path}
              >
                {f.path.split('/').pop()}
              </span>
              <span className="text-[9px] text-text-dim shrink-0">
                {formatFileSize(f.size)}
              </span>
              <a
                href={getProjectDownloadUrl(projectId, f.path)}
                className="opacity-0 group-hover:opacity-100 text-[10px] text-accent shrink-0"
                title="Download"
                download
              >
                ⤓
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilePreviewModal({
  path,
  content,
  loading,
  projectId,
  onClose,
}: {
  path: string;
  content: string | null;
  loading: boolean;
  projectId: string;
  onClose: () => void;
}) {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const isMarkdown = ext === 'md';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-[rgba(14,14,19,0.98)] border border-border-hi rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-[13px] text-text-primary font-medium truncate">{path}</span>
          <div className="flex items-center gap-2">
            <a
              href={getProjectDownloadUrl(projectId, path)}
              className="text-[11px] text-accent hover:underline"
              download
            >
              Download
            </a>
            <button
              className="text-text-dim hover:text-text-primary text-[13px]"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-text-dim text-[13px]">Loading…</p>
          ) : content === null ? (
            <p className="text-text-dim text-[13px]">Unable to load file (binary or too large)</p>
          ) : (
            <pre className={`text-[12px] leading-relaxed whitespace-pre-wrap break-words ${
              isMarkdown ? 'text-text-primary' : 'text-text-muted font-mono'
            }`}>
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function groupByDirectory(files: ProjectFile[]): Record<string, ProjectFile[]> {
  const groups: Record<string, ProjectFile[]> = {};
  for (const f of files) {
    const parts = f.path.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(f);
  }
  // Sort: root files first, then directories alphabetically
  const sorted: Record<string, ProjectFile[]> = {};
  const keys = Object.keys(groups).sort((a, b) => {
    if (a === '.') return -1;
    if (b === '.') return 1;
    return a.localeCompare(b);
  });
  for (const k of keys) sorted[k] = groups[k];
  return sorted;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
