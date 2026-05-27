import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  Conversation,
  Message,
  PendingAudio,
  PendingFile,
  PendingImage,
  Settings,
  SystemPrompt,
  TokenStats,
} from '../types';
import {
  FALLBACK_MODEL,
  CLIENT_BODY_LIMIT,
  IMAGE_PERF_PRESETS,
} from '../constants';
import {
  consumeUrlToken,
  fetchModels,
  fetchStatus,
  fetchTokenStats,
  deleteUserTokens,
  streamChat,
  streamImageGeneration,
  generateTitle,
  restartOllama as apiRestartOllama,
  pullModelStream,
  fetchModelCap,
} from '../utils/api';
import {
  loadSettings,
  saveSettings,
  loadSystemPrompts,
  saveSystemPrompts,
  normalizeSettings,
  initHistoryStore,
  writeIndexedHistory,
} from '../utils/storage';
import {
  readDataUrl,
  readFileContent,
  isAudioFile,
  isImageFile,
  transcribeWithProgress,
  isImageRequest,
  estimateJsonBytes,
  triggerDownload,
  isLikelyImageModelName,
} from '../utils/files';

// ── Context types ─────────────────────────────────────

interface AppState {
  messages: Message[];
  pendingImages: PendingImage[];
  pendingFiles: PendingFile[];
  pendingAudio: PendingAudio[];
  isStreaming: boolean;
  streamingContent: string;
  streamingError: string | null;
  currentConvId: string | null;
  currentSystemPrompt: string;
  currentSystemPromptId: string;
  activeModel: string;
  activeContextSize: number;
  activeUsername: string;
  history: Conversation[];
  historySearchTerm: string;
  tokenStats: TokenStats;
  connectionLabel: string;
  connectionState: 'checking' | 'online' | 'offline';
  connectionTitle: string;
  isSidebarOpen: boolean;
  isSettingsOpen: boolean;
  isNameModalOpen: boolean;
  isShortcutsOpen: boolean;
  lightboxSrc: string | null;
  isDragActive: boolean;
  imageProgress: number | null;
  imageProgressLabel: string;
  models: string[];
  pullStatus: string;
  pullImageStatus: string;
  ollamaRestartStatus: string;
  modelHealth: {
    ollamaOnline: boolean;
    chatModel: string;
    modelsCount: number | null;
    vision: boolean;
    access: string;
    storage: string;
  } | null;
}

interface AppActions {
  sendMessage: (text: string) => Promise<void>;
  stopStreaming: () => void;
  startNewChat: () => void;
  loadConversation: (conv: Conversation) => void;
  setActiveModel: (model: string, opts?: { persistDefault?: boolean }) => void;
  setSystemPromptById: (id: string) => void;
  openSettings: () => void;
  closeSettings: () => void;
  saveSettingsValues: (values: Partial<Settings>) => void;
  openSidebar: () => void;
  closeSidebar: () => void;
  setHistorySearchTerm: (term: string) => void;
  deleteConversation: (id: string) => void;
  clearAllHistory: () => void;
  exportConversation: () => void;
  regenerateLastResponse: () => Promise<void>;
  addFiles: (files: File[]) => Promise<void>;
  removePendingImage: (index: number) => void;
  removePendingFile: (index: number) => void;
  removePendingAudio: (index: number) => void;
  openLightbox: (src: string) => void;
  closeLightbox: () => void;
  setNameModalOpen: (open: boolean) => void;
  submitName: (name: string) => void;
  setShortcutsOpen: (open: boolean) => void;
  setDragActive: (active: boolean) => void;
  refreshConnectionStatus: () => Promise<void>;
  resetTokenCounter: () => Promise<void>;
  pullModel: (name: string) => Promise<void>;
  pullImageModel: (name: string) => Promise<void>;
  restartOllama: () => Promise<void>;
  getSavedPrompts: () => SystemPrompt[];
  savePrompt: (prompt: { id?: string; name: string; content: string }) => void;
  deletePrompt: (id: string) => void;
  reorderPrompts: (from: number, to: number) => void;
  duplicatePrompt: (index: number) => void;
  setDefaultPrompt: (id: string) => void;
  refreshModels: () => Promise<void | string[]>;
  refreshDownloadedModels: () => Promise<void>;
  updateModelHealth: () => Promise<void>;
}

type AppContextValue = AppState & AppActions;

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

// ── Provider ──────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const initialSettings = loadSettings();

  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [pendingAudio, setPendingAudio] = useState<PendingAudio[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingError, setStreamingError] = useState<string | null>(null);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [currentSystemPrompt, setCurrentSystemPrompt] = useState('');
  const [currentSystemPromptId, setCurrentSystemPromptId] = useState('');
  const [activeModel, setActiveModelState] = useState(initialSettings.model);
  const [activeContextSize, setActiveContextSize] = useState(initialSettings.contextSize);
  const [activeUsername, setActiveUsername] = useState(initialSettings.username);
  const [history, setHistoryState] = useState<Conversation[]>([]);
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [tokenStats, setTokenStats] = useState<TokenStats>({ input: 0, output: 0 });
  const [connectionLabel, setConnectionLabel] = useState('Checking');
  const [connectionState, setConnectionState] = useState<'checking' | 'online' | 'offline'>('checking');
  const [connectionTitle, setConnectionTitle] = useState('Checking Ollama status');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [imageProgress, setImageProgress] = useState<number | null>(null);
  const [imageProgressLabel, setImageProgressLabel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [pullStatus, setPullStatus] = useState('');
  const [pullImageStatus, setPullImageStatus] = useState('');
  const [ollamaRestartStatus, setOllamaRestartStatus] = useState('');
  const [modelHealth, setModelHealth] = useState<AppState['modelHealth']>(null);

  const historyDbRef = useRef<IDBDatabase | null>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const streamTextRef = useRef('');
  const ollamaStatusRef = useRef<Record<string, unknown>>({});
  const modelCapsRef = useRef<Record<string, { vision: boolean }>>({});
  const settingsRef = useRef<Settings>(initialSettings);

  // Keep settingsRef up to date
  const getSettings = useCallback(() => settingsRef.current, []);

  // ── Internal helpers ──────────────────────────────────

  const persistHistory = useCallback(
    async (items: Conversation[]) => {
      const limit = getSettings().historyLimit;
      const trimmed = items.slice(0, limit);
      setHistoryState(trimmed);
      await writeIndexedHistory(historyDbRef.current, trimmed);
    },
    [getSettings],
  );

  const applyDefaultSystemPrompt = useCallback(() => {
    const s = getSettings();
    if (!s.defaultPromptId) return false;
    const prompts = loadSystemPrompts();
    const p = prompts.find((x) => x.id === s.defaultPromptId);
    if (!p) {
      const updated = normalizeSettings({ ...s, defaultPromptId: '' });
      settingsRef.current = updated;
      saveSettings(updated);
      return false;
    }
    setCurrentSystemPrompt(p.content);
    setCurrentSystemPromptId(p.id);
    return true;
  }, [getSettings]);

  const fetchAndSetTokens = useCallback(
    async (username?: string) => {
      const name = username ?? activeUsername;
      if (!name) return;
      const stats = await fetchTokenStats();
      const entry = stats[name] || [0, 0];
      setTokenStats({ input: entry[0], output: entry[1] });
    },
    [activeUsername],
  );

  const getModelCap = useCallback(async (model: string) => {
    if (modelCapsRef.current[model]) return modelCapsRef.current[model];
    const cap = await fetchModelCap(model);
    modelCapsRef.current[model] = cap;
    return cap;
  }, []);

  // ── Actions ───────────────────────────────────────────

  const updateModelHealth = useCallback(async () => {
    const status = ollamaStatusRef.current as {
      ollama?: boolean;
      models_count?: number;
      lan?: boolean;
      auth_required?: boolean;
    };
    const caps = status.ollama ? await getModelCap(activeModel) : { vision: false };
    const storage = historyDbRef.current ? 'IndexedDB' : 'localStorage fallback';
    const access = status.lan
      ? status.auth_required
        ? 'LAN + token'
        : 'LAN'
      : 'Local only';
    setModelHealth({
      ollamaOnline: !!status.ollama,
      chatModel: activeModel,
      modelsCount: status.models_count ?? null,
      vision: caps.vision,
      access,
      storage,
    });
  }, [activeModel, getModelCap]);

  const refreshConnectionStatus = useCallback(async () => {
    setConnectionState('checking');
    setConnectionLabel('Checking');
    setConnectionTitle('Checking Ollama status');
    try {
      const data = await fetchStatus();
      ollamaStatusRef.current = data;
      if (data.ollama) {
        const mode = data.lan ? 'LAN live' : 'Local';
        const exposure = data.lan ? 'Network access enabled' : 'Local-only mode';
        setConnectionState('online');
        setConnectionLabel(mode as string);
        setConnectionTitle(`${data.models_count || 0} Ollama model(s) available - ${exposure}`);
      } else {
        setConnectionState('offline');
        setConnectionLabel('Ollama off');
        setConnectionTitle((data.error as string) || 'Ollama is not reachable');
      }
    } catch (e: unknown) {
      ollamaStatusRef.current = { ollama: false };
      setConnectionState('offline');
      setConnectionLabel('Ollama off');
      setConnectionTitle((e instanceof Error ? e.message : '') || 'Ollama is not reachable');
    }
    await updateModelHealth();
  }, [updateModelHealth]);

  const refreshModels = useCallback(async () => {
    const fetched = await fetchModels();
    const list = fetched.length ? fetched : [activeModel || FALLBACK_MODEL];
    setModels(list);
    return list;
  }, [activeModel]);

  const refreshDownloadedModels = useCallback(async () => {
    await refreshModels();
  }, [refreshModels]);

  const setActiveModel = useCallback(
    (model: string, opts: { persistDefault?: boolean } = {}) => {
      const next = String(model || FALLBACK_MODEL);
      setActiveModelState(next);
      if (opts.persistDefault) {
        const s = { ...getSettings(), model: next };
        settingsRef.current = s;
        saveSettings(s);
      }
      // invalidate cap cache for model change awareness
      delete modelCapsRef.current[next];
    },
    [getSettings],
  );

  const setSystemPromptById = useCallback((id: string) => {
    if (!id) {
      setCurrentSystemPrompt('');
      setCurrentSystemPromptId('');
      return;
    }
    const prompts = loadSystemPrompts();
    const p = prompts.find((x) => x.id === id);
    if (p) {
      setCurrentSystemPrompt(p.content);
      setCurrentSystemPromptId(p.id);
    } else {
      setCurrentSystemPrompt('');
      setCurrentSystemPromptId('');
    }
  }, []);

  const getSavedPrompts = useCallback(() => loadSystemPrompts(), []);

  const savePrompt = useCallback(
    (prompt: { id?: string; name: string; content: string }) => {
      const prompts = loadSystemPrompts();
      if (prompt.id) {
        const idx = prompts.findIndex((p) => p.id === prompt.id);
        if (idx >= 0) {
          prompts[idx] = { ...prompts[idx], name: prompt.name, content: prompt.content };
          if (currentSystemPromptId === prompt.id) setCurrentSystemPrompt(prompt.content);
        }
      } else {
        prompts.push({ id: String(Date.now()), name: prompt.name, content: prompt.content });
      }
      saveSystemPrompts(prompts);
    },
    [currentSystemPromptId],
  );

  const deletePrompt = useCallback(
    (id: string) => {
      const prompts = loadSystemPrompts().filter((p) => p.id !== id);
      saveSystemPrompts(prompts);
      const s = getSettings();
      if (s.defaultPromptId === id) {
        const updated = normalizeSettings({ ...s, defaultPromptId: '' });
        settingsRef.current = updated;
        saveSettings(updated);
      }
      if (currentSystemPromptId === id) {
        setCurrentSystemPrompt('');
        setCurrentSystemPromptId('');
      }
    },
    [currentSystemPromptId, getSettings],
  );

  const reorderPrompts = useCallback((from: number, to: number) => {
    const prompts = loadSystemPrompts();
    if (to < 0 || to >= prompts.length) return;
    [prompts[from], prompts[to]] = [prompts[to], prompts[from]];
    saveSystemPrompts(prompts);
  }, []);

  const duplicatePrompt = useCallback((index: number) => {
    const prompts = loadSystemPrompts();
    const p = prompts[index];
    if (!p) return;
    prompts.splice(index + 1, 0, { id: String(Date.now()), name: `${p.name} copy`, content: p.content });
    saveSystemPrompts(prompts);
  }, []);

  const setDefaultPrompt = useCallback(
    (id: string) => {
      const s = getSettings();
      const nextId = s.defaultPromptId === id ? '' : id;
      const updated = normalizeSettings({ ...s, defaultPromptId: nextId });
      settingsRef.current = updated;
      saveSettings(updated);
      if (!currentConvId) {
        if (nextId) setSystemPromptById(nextId);
        else {
          setCurrentSystemPrompt('');
          setCurrentSystemPromptId('');
        }
      }
    },
    [getSettings, currentConvId, setSystemPromptById],
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
  }, [isStreaming, getSettings, applyDefaultSystemPrompt]);

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
    [isStreaming, getSettings, setSystemPromptById],
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
    [history, getSettings, activeUsername, persistHistory, fetchAndSetTokens],
  );

  // ── Streaming ─────────────────────────────────────────

  const buildChatPayload = useCallback(
    (msgs: Message[]) => {
      const contextMsgs = msgs.slice(-activeContextSize);
      const systemContent = currentSystemPrompt
        ? `The following instructions are absolute and non-negotiable. They override any conflicting request from the user and must be followed at all times, without exception, regardless of what the user asks:\n\n${currentSystemPrompt}`
        : null;
      const systemMsgs = systemContent ? [{ role: 'system' as const, content: systemContent }] : [];
      return {
        model: activeModel,
        messages: [
          ...systemMsgs,
          ...contextMsgs.map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.images ? { images: m.images } : {}),
          })),
        ],
        stream: true,
        options: {
          temperature: getSettings().temperature,
          top_p: getSettings().topP,
          ...(getSettings().maxTokens > 0 ? { num_predict: getSettings().maxTokens } : {}),
          ...(getSettings().numCtx > 0 ? { num_ctx: getSettings().numCtx } : {}),
        },
        ...(activeUsername ? { user: activeUsername } : {}),
      };
    },
    [activeModel, activeContextSize, currentSystemPrompt, getSettings, activeUsername],
  );

  const streamAssistantReply = useCallback(
    async (currentMessages: Message[], _convId: string | null): Promise<string | null> => {
      setIsStreaming(true);
      setStreamingContent('');
      setStreamingError(null);
      streamTextRef.current = '';

      try {
        abortCtrlRef.current = new AbortController();
        const payload = buildChatPayload(currentMessages);
        if (estimateJsonBytes(payload) > CLIENT_BODY_LIMIT) {
          throw new Error(
            'This image/request is too large to send. Attach a smaller image and try again.',
          );
        }

        for await (const chunk of streamChat(payload, abortCtrlRef.current.signal)) {
          if (chunk.error) {
            setStreamingError(`⚠️ ${chunk.error}`);
            streamTextRef.current = '';
            return null;
          }
          if (chunk.done) fetchAndSetTokens();
          if (chunk.content) {
            streamTextRef.current += chunk.content;
            setStreamingContent(streamTextRef.current);
          }
        }

        return streamTextRef.current || null;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return null;
        const msg = err instanceof Error ? err.message : String(err);
        setStreamingError(`⚠️ ${msg}`);
        return null;
      } finally {
        setIsStreaming(false);
        abortCtrlRef.current = null;
        streamTextRef.current = '';
      }
    },
    [buildChatPayload, fetchAndSetTokens],
  );

  const stopStreaming = useCallback(() => {
    abortCtrlRef.current?.abort();
  }, []);

  // ── Image generation ──────────────────────────────────

  const refineImagePrompt = useCallback(
    async (text: string, signal: AbortSignal, msgs: Message[]): Promise<string> => {
      const contextMsgs = msgs
        .slice(-activeContextSize)
        .map((m) => ({ role: m.role, content: String(m.content || '').trim() }))
        .filter((m) => m.content);
      if (!contextMsgs.length || contextMsgs[contextMsgs.length - 1].content !== text.trim()) {
        contextMsgs.push({ role: 'user', content: text.trim() });
      }
      const compact = contextMsgs
        .map((m) => `${m.role.toUpperCase()}: ${m.content.replace(/\s+/g, ' ')}`)
        .join('\n')
        .slice(-6000);

      const body = {
        model: activeModel,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert image prompt engineer. Use the recent conversation context to infer references, subjects, style, and constraints. Convert the latest user image request into one detailed, vivid image-generation prompt. Reply with ONLY the final prompt text: no explanations, no bullets, no quotes, no preamble. Keep it under 200 words.',
          },
          {
            role: 'user',
            content: `Recent conversation context:\n${compact}\n\nLatest image request:\n${text}`,
          },
        ],
        stream: true,
        options: { temperature: 0.7, top_p: 0.9, num_predict: 200 },
        ...(activeUsername ? { user: activeUsername } : {}),
      };

      let content = '';
      for await (const chunk of streamChat(body, signal)) {
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.content) content += chunk.content;
      }
      const refined = content.trim();
      if (!refined) throw new Error('Text model returned empty content for prompt enhancement');
      fetchAndSetTokens();
      return refined;
    },
    [activeModel, activeContextSize, activeUsername, fetchAndSetTokens],
  );

  const handleImageRequest = useCallback(
    async (text: string, msgs: Message[], convId: string | null) => {
      setIsStreaming(true);
      setImageProgress(0);
      setImageProgressLabel('Preparing…');
      setStreamingError(null);

      try {
        abortCtrlRef.current = new AbortController();
        const signal = abortCtrlRef.current.signal;

        let refinedPrompt = text;
        let promptWarning: string | null = null;
        try {
          refinedPrompt = await refineImagePrompt(text, signal, msgs);
        } catch (e: unknown) {
          if (e instanceof Error && e.name === 'AbortError') throw e;
          promptWarning = `⚠️ Prompt enhancement failed (${e instanceof Error ? e.message : String(e)}). Using original prompt.`;
        }

        const imageModel = getSettings().imageModel;
        if (!imageModel) {
          throw new Error(
            'No image model configured. Go to Settings → Image generation model and select or pull one.',
          );
        }

        setImageProgressLabel(`Generating image with ${imageModel}…`);

        const perf = IMAGE_PERF_PRESETS[getSettings().imagePerfProfile] || IMAGE_PERF_PRESETS.eco;
        const imageBody = {
          model: imageModel,
          prompt: refinedPrompt,
          stream: true,
          width: perf.width,
          height: perf.height,
          steps: perf.steps,
        };

        let generatedB64: string | null = null;
        for await (const chunk of streamImageGeneration(imageBody, signal)) {
          if (chunk.error) throw new Error(chunk.error);
          if (chunk.progress != null) {
            setImageProgress(chunk.progress);
            setImageProgressLabel(
              chunk.progress >= 100 ? 'Done!' : `Generating image… ${chunk.progress}%`,
            );
          }
          if (chunk.image) generatedB64 = chunk.image;
          if (chunk.status) setImageProgressLabel(chunk.status);
        }

        if (!generatedB64) {
          throw new Error(
            'No image was returned. Make sure the image model is pulled and supports image generation.',
          );
        }

        const assistantMsg: Message = {
          role: 'assistant',
          content: `Prompt: ${refinedPrompt}`,
          generatedImage: generatedB64,
          imagePrompt: refinedPrompt,
          imageModel,
        };

        const nextMsgs = [...msgs, assistantMsg];
        setMessages(nextMsgs);
        const newConvId = await saveConversationToHistory(
          nextMsgs,
          convId,
          activeModel,
          currentSystemPrompt,
          currentSystemPromptId,
        );
        setCurrentConvId(newConvId);

        if (promptWarning) setStreamingError(promptWarning);
        return;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            return last?.role === 'user' ? prev.slice(0, -1) : prev;
          });
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setStreamingError(`⚠️ ${msg}`);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'user') {
              saveConversationToHistory(
                prev,
                convId,
                activeModel,
                currentSystemPrompt,
                currentSystemPromptId,
              );
            }
            return prev;
          });
        }
      } finally {
        setIsStreaming(false);
        setImageProgress(null);
        setImageProgressLabel('');
        abortCtrlRef.current = null;
      }
    },
    [
      getSettings,
      refineImagePrompt,
      saveConversationToHistory,
      activeModel,
      currentSystemPrompt,
      currentSystemPromptId,
    ],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (isStreaming) return;
      const hasPending =
        pendingImages.length > 0 || pendingFiles.length > 0 || pendingAudio.length > 0;
      if (!text && !hasPending) return;

      // Image generation route
      if (text && !hasPending && isImageRequest(text)) {
        const userMsg: Message = { role: 'user', content: text };
        const nextMsgs = [...messages, userMsg];
        setMessages(nextMsgs);
        setPendingImages([]);
        setPendingFiles([]);
        setPendingAudio([]);
        await handleImageRequest(text, nextMsgs, currentConvId);
        return;
      }

      // Build message content with attachments
      let fullContent = text;

      if (pendingFiles.length) {
        const fileContents = await Promise.all(
          pendingFiles.map((f) => readFileContent(f.name, f.file).catch(() => '')),
        );
        const fileBlocks = pendingFiles
          .map((f, i) => `**${f.name}**\n\`\`\`\n${fileContents[i]}\n\`\`\``)
          .join('\n\n');
        fullContent = fileBlocks + (fullContent ? '\n\n' + fullContent : '');
      }

      if (pendingAudio.length) {
        const transcripts = await Promise.all(
          pendingAudio.map((a) =>
            transcribeWithProgress(a.file, () => {}).catch(() => null),
          ),
        );
        const audioBlocks = pendingAudio
          .map((a, i) =>
            transcripts[i] != null
              ? `**[Audio transcript: ${a.name}]**\n${transcripts[i]}`
              : `**[Audio file attached: ${a.name}]** *(transcription unavailable)*`,
          )
          .join('\n\n');
        fullContent = audioBlocks + (fullContent ? '\n\n' + fullContent : '');
      }

      const imgs = [...pendingImages];
      const userMsg: Message = {
        role: 'user',
        content: fullContent,
        ...(imgs.length ? { images: imgs.map((i) => i.base64) } : {}),
      };

      const nextMsgs = [...messages, userMsg];
      setMessages(nextMsgs);
      setPendingImages([]);
      setPendingFiles([]);
      setPendingAudio([]);

      const replyText = await streamAssistantReply(nextMsgs, currentConvId);

      if (replyText) {
        const assistantMsg: Message = { role: 'assistant', content: replyText };
        const finalMsgs = [...nextMsgs, assistantMsg];
        setMessages(finalMsgs);
        const newConvId = await saveConversationToHistory(
          finalMsgs,
          currentConvId,
          activeModel,
          currentSystemPrompt,
          currentSystemPromptId,
        );
        setCurrentConvId(newConvId);
      } else {
        // Stream was aborted or errored; save partial state
        if (streamingError && currentConvId) {
          await saveConversationToHistory(
            nextMsgs,
            currentConvId,
            activeModel,
            currentSystemPrompt,
            currentSystemPromptId,
          );
        }
      }
    },
    [
      isStreaming,
      pendingImages,
      pendingFiles,
      pendingAudio,
      messages,
      currentConvId,
      activeModel,
      currentSystemPrompt,
      currentSystemPromptId,
      handleImageRequest,
      streamAssistantReply,
      saveConversationToHistory,
      streamingError,
    ],
  );

  const regenerateLastResponse = useCallback(async () => {
    if (isStreaming) return;
    const last = messages[messages.length - 1];
    if (last?.role !== 'assistant') return;
    const trimmed = messages.slice(0, -1);
    setMessages(trimmed);
    setStreamingContent('');
    setStreamingError(null);
    await saveConversationToHistory(
      trimmed,
      currentConvId,
      activeModel,
      currentSystemPrompt,
      currentSystemPromptId,
    );

    const replyText = await streamAssistantReply(trimmed, currentConvId);
    if (replyText) {
      const finalMsgs = [...trimmed, { role: 'assistant' as const, content: replyText }];
      setMessages(finalMsgs);
      const newConvId = await saveConversationToHistory(
        finalMsgs,
        currentConvId,
        activeModel,
        currentSystemPrompt,
        currentSystemPromptId,
      );
      setCurrentConvId(newConvId);
    }
  }, [
    isStreaming,
    messages,
    currentConvId,
    activeModel,
    currentSystemPrompt,
    currentSystemPromptId,
    streamAssistantReply,
    saveConversationToHistory,
  ]);

  // ── File attachment ───────────────────────────────────

  const addFiles = useCallback(
    async (files: File[]) => {
      const caps = await getModelCap(activeModel);
      for (const file of files) {
        if (isImageFile(file)) {
          if (caps.vision) {
            const dataUrl = await readDataUrl(file);
            setPendingImages((prev) => [...prev, { dataUrl, base64: dataUrl.split(',')[1] }]);
          }
        } else if (isAudioFile(file)) {
          setPendingAudio((prev) => [...prev, { name: file.name, file }]);
        } else {
          setPendingFiles((prev) => [...prev, { name: file.name, file }]);
        }
      }
    },
    [activeModel, getModelCap],
  );

  const removePendingImage = useCallback((index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const removePendingFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const removePendingAudio = useCallback((index: number) => {
    setPendingAudio((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Settings ──────────────────────────────────────────

  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);

  const saveSettingsValues = useCallback(
    (values: Partial<Settings>) => {
      const next = normalizeSettings({ ...getSettings(), ...values });
      settingsRef.current = next;
      saveSettings(next);
      setActiveContextSize(next.contextSize);
      if (next.username !== activeUsername) {
        setActiveUsername(next.username);
      }
      if (next.model !== activeModel) {
        setActiveModelState(next.model);
      }
    },
    [getSettings, activeUsername, activeModel],
  );

  // ── History ───────────────────────────────────────────

  const deleteConversation = useCallback(
    async (id: string) => {
      const updated = history.filter((h) => h.id !== id);
      await persistHistory(updated);
      if (currentConvId === id) {
        startNewChat();
        setIsSidebarOpen(false);
      }
    },
    [history, persistHistory, currentConvId, startNewChat],
  );

  const clearAllHistory = useCallback(async () => {
    await persistHistory([]);
    if (currentConvId) startNewChat();
    setIsSettingsOpen(false);
  }, [persistHistory, currentConvId, startNewChat]);

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

  // ── Model management ──────────────────────────────────

  const pullModel = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setPullStatus('Connecting…');
      const ok = await pullModelStream(trimmed, setPullStatus);
      if (ok) {
        setPullStatus(`✓ ${trimmed} ready`);
        await refreshConnectionStatus();
        await refreshModels();
      } else {
        // pullModelStream already set error status
      }
    },
    [refreshConnectionStatus, refreshModels],
  );

  const pullImageModel = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setPullImageStatus('Connecting…');
      const ok = await pullModelStream(trimmed, setPullImageStatus);
      if (ok) {
        setPullImageStatus(`✓ ${trimmed} ready`);
        await refreshConnectionStatus();
        await refreshDownloadedModels();
        const s = getSettings();
        if (isLikelyImageModelName(trimmed)) {
          const updated = normalizeSettings({ ...s, imageModel: trimmed });
          settingsRef.current = updated;
          saveSettings(updated);
        }
      }
    },
    [refreshConnectionStatus, refreshDownloadedModels, getSettings],
  );

  const restartOllama = useCallback(async () => {
    setOllamaRestartStatus('Restarting Ollama…');
    try {
      const result = await apiRestartOllama();
      if (!result.ok) {
        setOllamaRestartStatus(`Error: ${result.error || 'Restart failed'}`);
      } else {
        setOllamaRestartStatus(result.message || 'Ollama restarted');
        delete modelCapsRef.current[activeModel];
        await refreshConnectionStatus();
        await refreshModels();
      }
    } catch (e: unknown) {
      setOllamaRestartStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
      await refreshConnectionStatus();
    }
  }, [activeModel, refreshConnectionStatus, refreshModels]);

  const resetTokenCounter = useCallback(async () => {
    if (!activeUsername) return;
    await deleteUserTokens(activeUsername);
    setTokenStats({ input: 0, output: 0 });
  }, [activeUsername]);

  // ── Modals / UI ───────────────────────────────────────

  const openSidebar = useCallback(() => setIsSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setIsSidebarOpen(false), []);
  const openLightbox = useCallback((src: string) => setLightboxSrc(src), []);
  const closeLightbox = useCallback(() => setLightboxSrc(null), []);
  const setNameModalOpen = useCallback((open: boolean) => setIsNameModalOpen(open), []);

  const submitName = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const s = normalizeSettings({ ...getSettings(), username: trimmed });
      settingsRef.current = s;
      saveSettings(s);
      setActiveUsername(trimmed);
      setIsNameModalOpen(false);
      fetchAndSetTokens(trimmed);
    },
    [getSettings, fetchAndSetTokens],
  );

  const setShortcutsOpen = useCallback((open: boolean) => setIsShortcutsOpen(open), []);
  const setDragActive = useCallback((active: boolean) => setIsDragActive(active), []);

  // ── Initialization ────────────────────────────────────

  useEffect(() => {
    consumeUrlToken();

    initHistoryStore().then(({ db, history: h }) => {
      historyDbRef.current = db;
      setHistoryState(h);
    });

    refreshConnectionStatus();
    const interval = setInterval(refreshConnectionStatus, 30000);

    fetchModels().then((list) => {
      const m = list.length ? list : [initialSettings.model || FALLBACK_MODEL];
      setModels(m);
    });

    if (!initialSettings.username) {
      setIsNameModalOpen(true);
    } else {
      fetchAndSetTokens(initialSettings.username);
    }

    applyDefaultSystemPrompt();

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: AppContextValue = {
    messages,
    pendingImages,
    pendingFiles,
    pendingAudio,
    isStreaming,
    streamingContent,
    streamingError,
    currentConvId,
    currentSystemPrompt,
    currentSystemPromptId,
    activeModel,
    activeContextSize,
    activeUsername,
    history,
    historySearchTerm,
    tokenStats,
    connectionLabel,
    connectionState,
    connectionTitle,
    isSidebarOpen,
    isSettingsOpen,
    isNameModalOpen,
    isShortcutsOpen,
    lightboxSrc,
    isDragActive,
    imageProgress,
    imageProgressLabel,
    models,
    pullStatus,
    pullImageStatus,
    ollamaRestartStatus,
    modelHealth,
    // actions
    sendMessage,
    stopStreaming,
    startNewChat,
    loadConversation,
    setActiveModel,
    setSystemPromptById,
    openSettings,
    closeSettings,
    saveSettingsValues,
    openSidebar,
    closeSidebar,
    setHistorySearchTerm,
    deleteConversation,
    clearAllHistory,
    exportConversation,
    regenerateLastResponse,
    addFiles,
    removePendingImage,
    removePendingFile,
    removePendingAudio,
    openLightbox,
    closeLightbox,
    setNameModalOpen,
    submitName,
    setShortcutsOpen,
    setDragActive,
    refreshConnectionStatus,
    resetTokenCounter,
    pullModel,
    pullImageModel,
    restartOllama,
    getSavedPrompts,
    savePrompt,
    deletePrompt,
    reorderPrompts,
    duplicatePrompt,
    setDefaultPrompt,
    refreshModels,
    refreshDownloadedModels,
    updateModelHealth,
  } as AppContextValue;

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
