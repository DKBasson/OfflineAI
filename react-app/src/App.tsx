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
  } = useApp();

  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

  // Keyboard shortcuts
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
  ]);

  // Drag-and-drop
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
      <NameModal />
      <ShortcutsModal />
      <Lightbox />
      <DragOverlay />
      <Header />
      <ChatArea />
      <MessageInput />
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
