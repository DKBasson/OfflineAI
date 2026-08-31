import { useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { MessageInput } from './components/MessageInput';
import { SettingsPanel } from './components/SettingsPanel';
import { NameModal } from './components/NameModal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { Lightbox } from './components/Lightbox';
import { DragOverlay } from './components/DragOverlay';
import { ProjectsPanel } from './components/ProjectsPanel';
import ArtifactCanvas from './components/ArtifactCanvas';

function AppInner() {
  const {
    addFiles,
    setDragActive,
    startNewChat,
    openSidebar,
    closeSidebar,
    isSidebarOpen,
    exportConversation,
    setShortcutsOpen,
    closeLightbox,
    closeSettings,
    isNameModalOpen,
    setNameModalOpen,
    activeUsername,
    messages,
    isProjectsPanelOpen,
    openProjectsPanel,
    closeProjectsPanel,
    artifactCanvas,
    closeArtifactCanvas,
    activeProject,
  } = useApp();

  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const inInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName);
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (e.key === 'Escape') {
        closeLightbox();
        closeSidebar();
        closeSettings();
        setShortcutsOpen(false);
        if (!isNameModalOpen || activeUsername) setNameModalOpen(false);
      }
      if (!inInput && e.key === '?') { e.preventDefault(); setShortcutsOpen(true); }
      if (mod && e.key === 'k') { e.preventDefault(); startNewChat(); }
      if (mod && e.key === 'l') { e.preventDefault(); isSidebarOpen ? closeSidebar() : openSidebar(); }
      if (mod && e.key === 'e') { e.preventDefault(); if (messages.length) exportConversation(); }
      if (mod && e.key === '/') { e.preventDefault(); document.getElementById('input')?.focus(); }
      if (mod && e.key === 'p') { e.preventDefault(); isProjectsPanelOpen ? closeProjectsPanel() : openProjectsPanel(); }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        document.body.classList.toggle('focus-mode');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isMac,
    closeLightbox,
    closeSidebar,
    closeSettings,
    setShortcutsOpen,
    isNameModalOpen,
    setNameModalOpen,
    activeUsername,
    startNewChat,
    openSidebar,
    isSidebarOpen,
    exportConversation,
    messages.length,
    isProjectsPanelOpen,
    openProjectsPanel,
    closeProjectsPanel,
  ]);

  useEffect(() => {
    let dragCount = 0;

    function onDragEnter(e: DragEvent) {
      const hasFile = [...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file');
      if (hasFile) { dragCount++; setDragActive(true); }
    }
    function onDragLeave() {
      dragCount = Math.max(0, dragCount - 1);
      if (!dragCount) setDragActive(false);
    }
    function onDragOver(e: DragEvent) { e.preventDefault(); }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      dragCount = 0;
      setDragActive(false);
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) addFiles(files);
    }

    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [addFiles, setDragActive]);

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-bg text-text-primary font-sans">
      <Sidebar />
      <SettingsPanel />
      <ProjectsPanel />
      <NameModal />
      <ShortcutsModal />
      <Lightbox />
      <DragOverlay />
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <div className={`flex flex-col flex-1 min-w-0 transition-all duration-300 ${artifactCanvas.isOpen ? 'mr-[50vw]' : ''}`}>
          <ChatArea />
          <MessageInput />
        </div>
      </div>
      <ArtifactCanvas
        isOpen={artifactCanvas.isOpen}
        content={artifactCanvas.content}
        contentType={artifactCanvas.contentType}
        title={artifactCanvas.title}
        isStreaming={artifactCanvas.isStreaming}
        generatedFiles={artifactCanvas.generatedFiles}
        activeProjectId={activeProject?.id ?? null}
        onClose={closeArtifactCanvas}
      />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}
