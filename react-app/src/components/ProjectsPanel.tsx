import { useCallback, useState } from 'react';
import { useApp } from '../context/AppContext';
import type { Project } from '../types';
import { ProjectFileBrowser } from './ProjectFileBrowser';

export function ProjectsPanel() {
  const {
    isProjectsPanelOpen,
    closeProjectsPanel,
    projects,
    activeProject,
    createNewProject,
    removeProject,
    openProject,
  } = useApp();

  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const filtered = search
    ? projects.filter((p) =>
        (p.name + ' ' + p.description).toLowerCase().includes(search.toLowerCase()),
      )
    : projects;

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    await createNewProject(newName.trim(), newDesc.trim());
    setNewName('');
    setNewDesc('');
    setShowCreate(false);
    setCreating(false);
  }, [newName, newDesc, createNewProject]);

  return (
    <>
      {isProjectsPanelOpen && (
        <div
          className="fixed inset-0 bg-black/55 backdrop-blur-sm z-40"
          onClick={closeProjectsPanel}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed top-0 left-0 bottom-0 w-[320px] bg-[rgba(14,14,19,0.96)] backdrop-blur-lg border-r border-border-hi z-50 flex flex-col shadow transition-transform duration-300 ease-in-out ${
          isProjectsPanelOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Research Projects"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3.5 pt-[18px] pb-3 border-b border-border shrink-0">
          <span className="text-[13px] font-semibold text-text-primary tracking-tight">Research Projects</span>
          <button
            className="w-[26px] h-[26px] bg-surface-md border border-border rounded-full text-text-muted text-[13px] flex items-center justify-center cursor-pointer hover:bg-surface-hi hover:text-text-primary transition-colors"
            onClick={closeProjectsPanel}
            aria-label="Close projects"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-2.5 pt-2.5 pb-1.5 border-b border-border shrink-0">
          <input
            type="search"
            placeholder="Search projects…"
            autoComplete="off"
            spellCheck={false}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent border border-border rounded-[9px] text-text-primary font-[inherit] text-[13px] px-2.5 py-2 outline-none focus:border-border-hi focus:bg-surface placeholder:text-text-dim"
          />
        </div>

        {/* Active project indicator */}
        {activeProject && (
          <div className="px-3 py-2 border-b border-border bg-accent-lo/30 shrink-0">
            <div className="text-[11px] text-accent font-medium">Active project</div>
            <div className="text-[13px] text-text-primary truncate">{activeProject.name}</div>
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <div className="px-3 py-3 border-b border-border shrink-0 space-y-2">
            <input
              type="text"
              placeholder="Project name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full bg-transparent border border-border rounded-sm text-text-primary text-[13px] px-2.5 py-1.5 outline-none focus:border-border-hi"
              maxLength={64}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="w-full bg-transparent border border-border rounded-sm text-text-primary text-[13px] px-2.5 py-1.5 outline-none focus:border-border-hi"
              maxLength={200}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
            />
            <div className="flex gap-2">
              <button
                className="flex-1 py-1.5 bg-accent text-[#07080f] text-[12px] font-semibold rounded-sm disabled:opacity-50"
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button
                className="flex-1 py-1.5 bg-surface-md border border-border text-text-muted text-[12px] rounded-sm"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Project list */}
        <div className="flex-1 overflow-y-auto px-2 py-1.5 scrollbar-thin">
          {projects.length === 0 ? (
            <p className="text-center text-text-dim text-[13px] py-8 px-4">
              No research projects yet
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-text-dim text-[13px] py-8 px-4">No matches</p>
          ) : (
            filtered.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                isActive={project.id === activeProject?.id}
                onSelect={() => openProject(project)}
                onDelete={() => {
                  if (confirm(`Delete project "${project.name}"? This cannot be undone.`)) {
                    removeProject(project.id);
                  }
                }}
              />
            ))
          )}
        </div>

        {/* File browser (shown when project is active) */}
        <ProjectFileBrowser />

        {/* New project button */}
        <button
          className="m-2.5 py-2.5 bg-surface-md border border-border-hi rounded-[9px] text-accent text-[13px] font-semibold cursor-pointer text-center hover:bg-accent-lo hover:border-accent-b transition-colors shrink-0"
          onClick={() => setShowCreate(true)}
        >
          + New Project
        </button>
      </aside>
    </>
  );
}

function ProjectItem({
  project,
  isActive,
  onSelect,
  onDelete,
}: {
  project: Project;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-1.5 px-3 py-2.5 rounded-[9px] border transition-colors mb-0.5 cursor-pointer ${
        isActive
          ? 'bg-accent-lo border-accent-b'
          : 'border-transparent hover:bg-surface-md hover:border-border'
      }`}
    >
      <div className="flex-1 min-w-0" onClick={onSelect}>
        <div className="text-[13px] font-medium text-text-primary truncate mb-0.5">
          {project.name}
        </div>
        <div className="text-[11px] text-text-dim truncate">
          {project.description || 'No description'}
        </div>
        <div className="flex gap-2 text-[10px] text-text-dim mt-1">
          <span>{project.sources_count} sources</span>
          <span>{project.findings_count} findings</span>
          <span>{project.files_count} files</span>
        </div>
      </div>
      <button
        className="shrink-0 opacity-0 group-hover:opacity-100 w-[22px] h-[22px] rounded-full bg-transparent border border-transparent text-text-dim text-[11px] flex items-center justify-center cursor-pointer hover:bg-surface-hi hover:border-border-hi hover:text-text-primary transition-all"
        title="Delete project"
        aria-label="Delete project"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      >
        ✕
      </button>
    </div>
  );
}
