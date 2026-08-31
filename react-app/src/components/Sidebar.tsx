import { useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import type { Conversation } from '../types';
import { formatDate } from '../utils/markdown';
import { FALLBACK_MODEL } from '../constants';
import { parseMarkdownConversation } from '../utils/files';

export function Sidebar() {
  const {
    isSidebarOpen,
    closeSidebar,
    history,
    historySearchTerm,
    setHistorySearchTerm,
    currentConvId,
    loadConversation,
    deleteConversation,
    startNewChat,
    isStreaming,
    activeModel,
  } = useApp();

  const importRef = useRef<HTMLInputElement>(null);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseMarkdownConversation(text);
    if (parsed) {
      const conv: Conversation = {
        id: String(Date.now()),
        title: parsed.title,
        timestamp: Date.now(),
        model: activeModel,
        messages: parsed.messages,
      };
      loadConversation(conv);
    }
    e.target.value = '';
  }, [activeModel, loadConversation]);

  const filtered = historySearchTerm
    ? history.filter((item) => {
        if (item.projectId) return false; // Project chats only show in Projects panel
        const haystack = [
          item.title,
          item.model || FALLBACK_MODEL,
          ...(item.messages || []).map((m) => m.content),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(historySearchTerm.toLowerCase());
      })
    : history.filter((item) => !item.projectId);

  return (
    <>
      {/* Overlay */}
      {isSidebarOpen && (
        <div
          id="sidebar-overlay"
          className="fixed inset-0 bg-black/55 backdrop-blur-sm z-40"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel */}
      <aside
        id="sidebar"
        className={`fixed top-0 left-0 bottom-0 w-[292px] bg-[rgba(14,14,19,0.96)] backdrop-blur-lg border-r border-border-hi z-50 flex flex-col shadow transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0 open' : '-translate-x-full'}`}
        aria-label="Conversation history"
        role="navigation"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3.5 pt-[18px] pb-3 border-b border-border shrink-0">
          <span className="text-[13px] font-semibold text-text-primary tracking-tight">History</span>
          <button
            id="sidebar-close-btn"
            className="w-[26px] h-[26px] bg-surface-md border border-border rounded-full text-text-muted text-[13px] flex items-center justify-center cursor-pointer hover:bg-surface-hi hover:text-text-primary transition-colors"
            onClick={closeSidebar}
            aria-label="Close history"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-2.5 pt-2.5 pb-1.5 border-b border-border shrink-0">
          <input
            id="history-search"
            type="search"
            placeholder="Search conversations…"
            autoComplete="off"
            spellCheck={false}
            value={historySearchTerm}
            onChange={(e) => setHistorySearchTerm(e.target.value)}
            className="w-full bg-transparent border border-border rounded-[9px] text-text-primary font-[inherit] text-[13px] px-2.5 py-2 outline-none focus:border-border-hi focus:bg-surface placeholder:text-text-dim"
          />
          {historySearchTerm && (
            <span className="text-[11px] text-text-dim mt-1 block">
              {filtered.length} of {history.length} conversation{history.length !== 1 ? 's' : ''} matched
            </span>
          )}
        </div>

        {/* List */}
        <div id="history-list" className="flex-1 overflow-y-auto px-2 py-1.5 scrollbar-thin">
          {history.length === 0 ? (
            <p className="text-center text-text-dim text-[13px] py-8 px-4">
              No conversations yet
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-text-dim text-[13px] py-8 px-4">No matches</p>
          ) : (
            filtered.map((item) => (
              <HistoryItem
                key={item.id}
                item={item}
                isActive={item.id === currentConvId}
                onSelect={() => { if (!isStreaming) { loadConversation(item); } }}
                onDelete={() => deleteConversation(item.id)}
              />
            ))
          )}
        </div>

        {/* New chat button */}
        <div className="m-2.5 flex gap-2 shrink-0">
          <button
            id="new-chat-btn"
            className="flex-1 py-2.5 bg-surface-md border border-border-hi rounded-[9px] text-accent text-[13px] font-semibold cursor-pointer text-center hover:bg-accent-lo hover:border-accent-b transition-colors"
            onClick={() => { startNewChat(); closeSidebar(); }}
          >
            + New Chat
          </button>
          <button
            className="py-2.5 px-3 bg-surface-md border border-border-hi rounded-[9px] text-text-muted text-[13px] font-semibold cursor-pointer text-center hover:bg-surface-hi hover:border-border-hi hover:text-text-primary transition-colors"
            onClick={() => importRef.current?.click()}
            title="Import conversation from Markdown file"
            aria-label="Import conversation"
          >
            ↑ Import
          </button>
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".md,.markdown,.txt"
          className="hidden"
          onChange={handleImport}
        />
      </aside>
    </>
  );
}

function HistoryItem({
  item,
  isActive,
  onSelect,
  onDelete,
}: {
  item: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`history-item group flex items-center gap-1.5 px-3 py-2.5 rounded-[9px] border transition-colors mb-0.5 cursor-pointer ${isActive ? 'bg-accent-lo border-accent-b' : 'border-transparent hover:bg-surface-md hover:border-border'}`}
    >
      <div className="history-item-main flex-1 min-w-0" onClick={onSelect}>
        <div className="text-[13px] font-medium text-text-primary truncate mb-0.5">
          {item.title}
        </div>
        <div className="flex gap-2 text-[11px] text-text-dim">
          <span>{formatDate(item.timestamp)}</span>
          <span>{item.model || FALLBACK_MODEL}</span>
        </div>
      </div>
      <button
        className="history-del-btn shrink-0 opacity-0 group-hover:opacity-100 w-[22px] h-[22px] rounded-full bg-transparent border border-transparent text-text-dim text-[11px] flex items-center justify-center cursor-pointer hover:bg-surface-hi hover:border-border-hi hover:text-text-primary transition-all"
        title="Delete conversation"
        aria-label="Delete conversation"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      >
        ✕
      </button>
    </div>
  );
}
