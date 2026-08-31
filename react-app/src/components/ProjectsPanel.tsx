import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import type { Project } from '../types';
import type { CreationTemplate } from '../constants';
import { CREATION_TEMPLATES } from '../constants';
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
    sendMessage,
    specPhase,
    resumeSpec,
  } = useApp();

  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<CreationTemplate | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [importing, setImporting] = useState(false);
  const [showHooks, setShowHooks] = useState(false);
  const [hooks, setHooks] = useState<import('../types').Hook[]>([]);
  const [hookName, setHookName] = useState('');
  const [hookEvent, setHookEvent] = useState('file_saved');
  const [hookPattern, setHookPattern] = useState('');
  const [hookInstructions, setHookInstructions] = useState('');
  const [creatingHook, setCreatingHook] = useState(false);
  const [activeSpec, setActiveSpec] = useState<{ phase: string; description?: string } | null>(null);

  // Check for active spec session when project changes
  useEffect(() => {
    if (!activeProject) { setActiveSpec(null); return; }
    import('../utils/api').then(({ fetchSpecState }) =>
      fetchSpecState(activeProject.id).then((spec) => {
        if (spec && spec.phase && spec.phase !== 'active') {
          setActiveSpec({ phase: spec.phase });
        } else {
          setActiveSpec(null);
        }
      }).catch(() => setActiveSpec(null))
    );
  }, [activeProject, specPhase]); // re-check when specPhase changes

  const filtered = search
    ? projects.filter((p) =>
        (p.name + ' ' + p.description).toLowerCase().includes(search.toLowerCase()),
      )
    : projects;

  const handleSelectTemplate = useCallback((template: CreationTemplate) => {
    setSelectedTemplate(template);
    if (!newName.trim()) {
      setNewName(template.name);
    }
    setShowCreate(true);
  }, [newName]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const project = await createNewProject(newName.trim(), newDesc.trim());
    const template = selectedTemplate;
    setNewName('');
    setNewDesc('');
    setShowCreate(false);
    setSelectedTemplate(null);
    setCreating(false);
    if (project && template) {
      const workflowCmd = `/workflow ${template.workflow.replace(/\{topic\}/g, newName.trim())}`;
      closeProjectsPanel();
      // Allow state to settle before sending the workflow command
      setTimeout(() => {
        sendMessage(workflowCmd);
      }, 300);
    }
  }, [newName, newDesc, createNewProject, selectedTemplate, closeProjectsPanel, sendMessage]);

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
            {activeSpec && (
              <button
                className="mt-1.5 w-full py-1.5 bg-accent/10 border border-accent/30 rounded-[7px] text-[11px] font-semibold text-accent hover:bg-accent/20 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                onClick={() => { resumeSpec(); closeProjectsPanel(); }}
              >
                <span>📋</span>
                <span>
                  Resume Spec — {activeSpec.phase.replace('_review', ' Review').replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </span>
              </button>
            )}
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
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setShowCreate(false); setSelectedTemplate(null); } }}
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="w-full bg-transparent border border-border rounded-sm text-text-primary text-[13px] px-2.5 py-1.5 outline-none focus:border-border-hi"
              maxLength={200}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setShowCreate(false); setSelectedTemplate(null); } }}
            />
            {selectedTemplate && (
              <div className="flex items-center gap-2 px-2 py-1.5 bg-accent-lo/30 border border-accent-b rounded-sm">
                <span className="text-[14px]">{selectedTemplate.icon}</span>
                <span className="text-[12px] text-accent font-medium flex-1 truncate">{selectedTemplate.name} template</span>
                <button
                  className="text-[11px] text-text-dim hover:text-text-primary"
                  onClick={() => setSelectedTemplate(null)}
                  aria-label="Remove template"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <button
                className="flex-1 py-1.5 bg-accent text-[#07080f] text-[12px] font-semibold rounded-sm disabled:opacity-50"
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
              >
                {creating ? 'Creating…' : selectedTemplate ? `Create & Run ${selectedTemplate.name}` : 'Create'}
              </button>
              <button
                className="flex-1 py-1.5 bg-surface-md border border-border text-text-muted text-[12px] rounded-sm"
                onClick={() => { setShowCreate(false); setSelectedTemplate(null); }}
              >
                Cancel
              </button>
            </div>

            {/* Template cards */}
            <div className="pt-1">
              <div className="text-[11px] text-text-dim font-medium mb-1.5">Or start from a template:</div>
              <div className="flex flex-col gap-1.5">
                {CREATION_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    className={`flex items-start gap-2 px-2.5 py-2 rounded-[7px] border text-left transition-colors cursor-pointer ${
                      selectedTemplate?.id === tpl.id
                        ? 'bg-accent-lo border-accent-b'
                        : 'bg-surface border-border hover:bg-surface-md hover:border-border-hi'
                    }`}
                    onClick={() => handleSelectTemplate(tpl)}
                    aria-label={`Use ${tpl.name} template`}
                  >
                    <span className="text-[16px] mt-0.5 shrink-0">{tpl.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-text-primary truncate">{tpl.name}</div>
                      <div className="text-[11px] text-text-dim leading-tight">{tpl.description}</div>
                    </div>
                  </button>
                ))}
              </div>
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
        <div className="m-2.5 grid grid-cols-2 gap-2 shrink-0">
          <button
            className="py-2 bg-surface-md border border-border-hi rounded-[9px] text-accent text-[12px] font-semibold cursor-pointer text-center hover:bg-accent-lo hover:border-accent-b transition-colors"
            onClick={() => { setShowCreate(true); setShowImport(false); setShowHooks(false); }}
          >
            + New Project
          </button>
          <button
            className="py-2 bg-surface-md border border-border-hi rounded-[9px] text-accent text-[12px] font-semibold cursor-pointer text-center hover:bg-accent-lo hover:border-accent-b transition-colors"
            onClick={() => { setShowImport(!showImport); setShowCreate(false); setShowHooks(false); }}
          >
            📂 Import Code
          </button>
          <button
            className="py-2 bg-surface-md border border-border-hi rounded-[9px] text-accent text-[12px] font-semibold cursor-pointer text-center hover:bg-accent-lo hover:border-accent-b transition-colors disabled:opacity-40"
            onClick={() => {
              if (activeProject) {
                closeProjectsPanel();
                sendMessage('/steering generate');
              }
            }}
            disabled={!activeProject}
          >
            📋 Steering
          </button>
          <button
            className="py-2 bg-surface-md border border-border-hi rounded-[9px] text-accent text-[12px] font-semibold cursor-pointer text-center hover:bg-accent-lo hover:border-accent-b transition-colors disabled:opacity-40"
            onClick={() => {
              setShowHooks(!showHooks);
              setShowCreate(false);
              setShowImport(false);
              if (!showHooks && activeProject) {
                import('../utils/api').then(({ fetchHooks }) =>
                  fetchHooks(activeProject.id).then(setHooks)
                );
              }
            }}
            disabled={!activeProject}
          >
            🔗 Hooks
          </button>
        </div>

        {/* Import code form */}
        {showImport && activeProject && (
          <div className="mx-2.5 mb-2.5 px-3 py-3 border border-border rounded-[9px] bg-surface shrink-0 space-y-2">
            <div className="text-[12px] font-medium text-text-primary">Import existing code</div>
            <div className="text-[11px] text-text-dim">Enter the full path to a folder on your machine. The AI will scan and analyze the codebase.</div>
            <input
              type="text"
              placeholder="/path/to/your/project"
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
              className="w-full bg-transparent border border-border rounded-sm text-text-primary text-[13px] px-2.5 py-1.5 outline-none focus:border-border-hi font-mono"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && importPath.trim()) {
                  setImporting(true);
                  closeProjectsPanel();
                  sendMessage(`/code import ${importPath.trim()}`);
                  setImportPath('');
                  setShowImport(false);
                  setImporting(false);
                }
                if (e.key === 'Escape') setShowImport(false);
              }}
            />
            <div className="flex gap-2">
              <button
                className="flex-1 py-1.5 bg-accent text-[#07080f] text-[12px] font-semibold rounded-sm disabled:opacity-50"
                onClick={() => {
                  if (!importPath.trim()) return;
                  setImporting(true);
                  closeProjectsPanel();
                  sendMessage(`/code import ${importPath.trim()}`);
                  setImportPath('');
                  setShowImport(false);
                  setImporting(false);
                }}
                disabled={!importPath.trim() || importing}
              >
                {importing ? 'Importing…' : 'Import & Analyze'}
              </button>
              <button
                className="flex-1 py-1.5 bg-surface-md border border-border text-text-muted text-[12px] rounded-sm"
                onClick={() => setShowImport(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {showImport && !activeProject && (
          <div className="mx-2.5 mb-2.5 px-3 py-2 border border-border rounded-[9px] bg-surface shrink-0">
            <div className="text-[12px] text-text-dim text-center">Select or create a project first to import code into.</div>
          </div>
        )}

        {/* Hooks management */}
        {showHooks && activeProject && (
          <div className="mx-2.5 mb-2.5 px-3 py-3 border border-border rounded-[9px] bg-surface shrink-0 space-y-2 max-h-[300px] overflow-y-auto">
            <div className="text-[12px] font-medium text-text-primary">Agent Hooks</div>
            <div className="text-[11px] text-text-dim">Automate actions when files change or tasks complete.</div>
            <input type="text" placeholder="Hook name" value={hookName} onChange={(e) => setHookName(e.target.value)}
              className="w-full bg-transparent border border-border rounded-sm text-text-primary text-[12px] px-2 py-1 outline-none focus:border-border-hi" />
            <select value={hookEvent} onChange={(e) => setHookEvent(e.target.value)}
              className="w-full bg-transparent border border-border rounded-sm text-text-primary text-[12px] px-2 py-1 outline-none">
              <option value="file_saved">On file saved</option>
              <option value="file_created">On file created</option>
              <option value="task_completed">On task completed</option>
              <option value="manual">Manual trigger</option>
            </select>
            <input type="text" placeholder="File pattern (e.g. src/**/*.tsx)" value={hookPattern} onChange={(e) => setHookPattern(e.target.value)}
              className="w-full bg-transparent border border-border rounded-sm text-text-primary text-[12px] px-2 py-1 outline-none focus:border-border-hi font-mono" />
            <textarea placeholder="Instructions (e.g. Update the test file for this component)" value={hookInstructions}
              onChange={(e) => setHookInstructions(e.target.value)} rows={2}
              className="w-full bg-transparent border border-border rounded-sm text-text-primary text-[12px] px-2 py-1 outline-none focus:border-border-hi resize-none" />
            <button
              className="w-full py-1.5 bg-accent text-[#07080f] text-[11px] font-semibold rounded-sm disabled:opacity-50"
              disabled={!hookName.trim() || !hookInstructions.trim() || creatingHook}
              onClick={async () => {
                setCreatingHook(true);
                const { createHookApi } = await import('../utils/api');
                const hook = await createHookApi(activeProject.id, { name: hookName, event_type: hookEvent, file_pattern: hookPattern, instructions: hookInstructions });
                if (hook) setHooks((prev) => [...prev, hook]);
                setHookName(''); setHookPattern(''); setHookInstructions('');
                setCreatingHook(false);
              }}
            >{creatingHook ? 'Creating…' : 'Create Hook'}</button>
            {hooks.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-border">
                {hooks.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 text-[11px] py-1">
                    <button onClick={async () => {
                      const { toggleHookApi } = await import('../utils/api');
                      const updated = await toggleHookApi(activeProject.id, h.id);
                      if (updated) setHooks((prev) => prev.map((x) => x.id === h.id ? updated : x));
                    }} className={`w-4 h-4 rounded-sm border ${h.enabled ? 'bg-accent border-accent' : 'border-border'} flex items-center justify-center text-[8px] text-white cursor-pointer`}>
                      {h.enabled ? '✓' : ''}
                    </button>
                    <span className={`flex-1 truncate ${h.enabled ? 'text-text-primary' : 'text-text-dim line-through'}`}>{h.name}</span>
                    <span className="text-text-dim">{h.event_type}</span>
                    <button onClick={async () => {
                      const { deleteHookApi } = await import('../utils/api');
                      await deleteHookApi(activeProject.id, h.id);
                      setHooks((prev) => prev.filter((x) => x.id !== h.id));
                    }} className="text-text-dim hover:text-text-primary">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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
