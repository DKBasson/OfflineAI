import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import type { Conversation, Message, Settings } from '../../types';
import { FALLBACK_MODEL } from '../../constants';
import { generateTitle } from '../../utils/api';
import { writeIndexedHistory } from '../../utils/storage';
import { triggerDownload } from '../../utils/files';

export interface HistorySliceDeps {
  history: Conversation[];
  currentConvId: string | null;
  isStreaming: boolean;
  activeModel: string;
  activeUsername: string;
  messages: Message[];
  historyDbRef: MutableRefObject<IDBDatabase | null>;
  settingsRef: MutableRefObject<Settings>;
  setHistoryState: React.Dispatch<React.SetStateAction<Conversation[]>>;
  setCurrentConvId: React.Dispatch<React.SetStateAction<string | null>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveModelState: React.Dispatch<React.SetStateAction<string>>;
  setCurrentSystemPrompt: React.Dispatch<React.SetStateAction<string>>;
  setCurrentSystemPromptId: React.Dispatch<React.SetStateAction<string>>;
  setIsSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  // Cross-slice deps
  applyDefaultSystemPrompt: () => boolean;
  setSystemPromptById: (id: string) => void;
  fetchAndSetTokens: (username?: string) => Promise<void>;
}

export function useHistorySlice({
  history,
  currentConvId,
  isStreaming,
  activeModel,
  activeUsername,
  messages,
  historyDbRef,
  settingsRef,
  setHistoryState,
  setCurrentConvId,
  setMessages,
  setIsSidebarOpen,
  setActiveModelState,
  setCurrentSystemPrompt,
  setCurrentSystemPromptId,
  setIsSettingsOpen,
  applyDefaultSystemPrompt,
  setSystemPromptById,
  fetchAndSetTokens,
}: HistorySliceDeps) {
  const getSettings = useCallback(() => settingsRef.current, [settingsRef]);

  const persistHistory = useCallback(
    async (items: Conversation[]) => {
      const limit = getSettings().historyLimit;
      const trimmed = items.slice(0, limit);
      setHistoryState(trimmed);
      await writeIndexedHistory(historyDbRef.current, trimmed);
    },
    [getSettings, historyDbRef, setHistoryState],
  );

  const saveConversationToHistory = useCallback(
    async (
      msgs: Message[],
      convId: string | null,
      model: string,
      systemPrompt: string,
      systemPromptId: string,
    ) => {
      if (!msgs.length) return convId;
      const allHistory = [...history];
      const isNew = !convId;
      const id = convId || String(Date.now());
      const stripped = msgs.map(({ images: _i, generatedImage: _g, ...rest }) => rest);
      const existing = allHistory.find((h) => h.id === id);
      const title =
        existing?.title || stripped[0]?.content?.trim().slice(0, 72) || 'Image conversation';
      const entry: Conversation = {
        id,
        title,
        timestamp: Date.now(),
        model,
        messages: stripped,
        systemPrompt,
        systemPromptId,
      };
      const idx = allHistory.findIndex((h) => h.id === id);
      if (idx >= 0) allHistory[idx] = entry;
      else allHistory.unshift(entry);
      await persistHistory(allHistory);

      if (getSettings().autoTitle && isNew && stripped.length >= 2) {
        generateTitle(model, stripped, activeUsername)
          .then(async (genTitle) => {
            if (!genTitle) return;
            setHistoryState((prev) => {
              const updated = [...prev];
              const i = updated.findIndex((x) => x.id === id);
              if (i >= 0) updated[i] = { ...updated[i], title: genTitle };
              return updated;
            });
            const latest = history;
            const i = latest.findIndex((x) => x.id === id);
            if (i >= 0) {
              const updated = [...latest];
              updated[i] = { ...updated[i], title: genTitle };
              await writeIndexedHistory(historyDbRef.current, updated);
            }
          })
          .then(() => fetchAndSetTokens());
      }
      return id;
    },
    [
      history,
      getSettings,
      activeUsername,
      persistHistory,
      fetchAndSetTokens,
      historyDbRef,
      setHistoryState,
    ],
  );

  const startNewChat = useCallback(() => {
    if (isStreaming) return;
    setMessages([]);
    setCurrentConvId(null);
    setActiveModelState(getSettings().model || FALLBACK_MODEL);
    if (!applyDefaultSystemPrompt()) {
      setCurrentSystemPrompt('');
      setCurrentSystemPromptId('');
    }
  }, [
    isStreaming,
    getSettings,
    applyDefaultSystemPrompt,
    setMessages,
    setCurrentConvId,
    setActiveModelState,
    setCurrentSystemPrompt,
    setCurrentSystemPromptId,
  ]);

  const loadConversation = useCallback(
    (conv: Conversation) => {
      if (isStreaming) return;
      setMessages((conv.messages || []).map((m) => ({ ...m })));
      setCurrentConvId(conv.id);
      setActiveModelState(conv.model || getSettings().model || FALLBACK_MODEL);
      if (conv.systemPromptId) {
        setSystemPromptById(conv.systemPromptId);
      } else {
        setCurrentSystemPrompt(conv.systemPrompt || '');
        setCurrentSystemPromptId('');
      }
      setIsSidebarOpen(false);
    },
    [
      isStreaming,
      getSettings,
      setSystemPromptById,
      setMessages,
      setCurrentConvId,
      setActiveModelState,
      setCurrentSystemPrompt,
      setCurrentSystemPromptId,
      setIsSidebarOpen,
    ],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      const updated = history.filter((h) => h.id !== id);
      await persistHistory(updated);
      if (currentConvId === id) {
        startNewChat();
        setIsSidebarOpen(false);
      }
    },
    [history, persistHistory, currentConvId, startNewChat, setIsSidebarOpen],
  );

  const clearAllHistory = useCallback(async () => {
    await persistHistory([]);
    if (currentConvId) startNewChat();
    setIsSettingsOpen(false);
  }, [persistHistory, currentConvId, startNewChat, setIsSettingsOpen]);

  const exportConversation = useCallback(() => {
    if (!messages.length) return;
    const conv = history.find((h) => h.id === currentConvId);
    const title = conv?.title || 'Conversation';
    const date = new Date().toLocaleDateString([], {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    let md = `# ${title}\n\n**Model:** ${activeModel}  \n**Date:** ${date}\n\n---\n\n`;
    for (const msg of messages) {
      if (msg.role === 'user') md += `**You:** ${msg.content}\n\n`;
      else if (msg.role === 'assistant') md += `**AI:** ${msg.content}\n\n`;
    }
    triggerDownload(
      md,
      title.replace(/[^a-z0-9]/gi, '_').slice(0, 60) + '.md',
      'text/markdown',
    );
  }, [messages, history, currentConvId, activeModel]);

  return {
    persistHistory,
    saveConversationToHistory,
    startNewChat,
    loadConversation,
    deleteConversation,
    clearAllHistory,
    exportConversation,
  };
}
