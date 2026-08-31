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
  Project,
  ProjectFile,
  Settings,
  SystemPrompt,
  TokenStats,
} from '../types';
import { FALLBACK_MODEL } from '../constants';
import { consumeUrlToken, fetchModels } from '../utils/api';
import { loadSettings, initHistoryStore } from '../utils/storage';

import { usePromptsSlice } from './hooks/usePromptsSlice';
import { useModelsSlice } from './hooks/useModelsSlice';
import { useHistorySlice } from './hooks/useHistorySlice';
import { useUISlice } from './hooks/useUISlice';
import { useStreamingSlice } from './hooks/useStreamingSlice';
import { useProjectsSlice } from './hooks/useProjectsSlice';

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
  projects: Project[];
  activeProject: Project | null;
  projectFiles: ProjectFile[];
  isProjectsPanelOpen: boolean;
  artifactCanvas: {
    isOpen: boolean;
    content: string;
    contentType: 'markdown' | 'code' | 'csv' | 'json' | 'text';
    title: string;
    isStreaming: boolean;
    generatedFiles: string[];
  };
}

interface AppActions {
  sendMessage: (text: string) => Promise<void>;
  stopStreaming: () => void;
  startNewChat: () => void;
  editAndResend: (messageIndex: number, newContent: string) => Promise<void>;
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
  savedPromptsVersion: number;
  refreshProjects: () => Promise<Project[]>;
  createNewProject: (name: string, description: string) => Promise<Project | null>;
  removeProject: (id: string) => Promise<boolean>;
  openProject: (project: Project) => Promise<void>;
  closeProject: () => void;
  refreshProjectFiles: (projectId: string) => Promise<ProjectFile[]>;
  openProjectsPanel: () => void;
  closeProjectsPanel: () => void;
  openArtifactCanvas: (opts: { title: string; contentType: AppState['artifactCanvas']['contentType'] }) => void;
  updateArtifactContent: (content: string) => void;
  updateArtifactFiles: (files: string[]) => void;
  closeArtifactCanvas: () => void;
  finalizeArtifact: () => void;
}

type AppContextValue = AppState & AppActions;

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

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
  const [savedPromptsVersion, setSavedPromptsVersion] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [isProjectsPanelOpen, setIsProjectsPanelOpen] = useState(false);
  const [artifactCanvas, setArtifactCanvas] = useState<AppState['artifactCanvas']>({
    isOpen: false,
    content: '',
    contentType: 'text',
    title: '',
    isStreaming: false,
    generatedFiles: [],
  });

  const historyDbRef = useRef<IDBDatabase | null>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const streamTextRef = useRef('');
  const ollamaStatusRef = useRef<Record<string, unknown>>({});
  const modelCapsRef = useRef<Record<string, { vision: boolean }>>({});
  const settingsRef = useRef<Settings>(initialSettings);

  const prompts = usePromptsSlice({
    currentSystemPromptId,
    currentConvId,
    settingsRef,
    setCurrentSystemPrompt,
    setCurrentSystemPromptId,
    setSavedPromptsVersion,
  });

  const models_ = useModelsSlice({
    activeModel,
    settingsRef,
    ollamaStatusRef,
    modelCapsRef,
    historyDbRef,
    setConnectionState,
    setConnectionLabel,
    setConnectionTitle,
    setModels,
    setPullStatus,
    setPullImageStatus,
    setOllamaRestartStatus,
    setModelHealth,
    setActiveModelState,
  });

  const ui = useUISlice({
    activeModel,
    activeUsername,
    settingsRef,
    modelCapsRef,
    setIsSettingsOpen,
    setIsSidebarOpen,
    setIsNameModalOpen,
    setIsShortcutsOpen,
    setLightboxSrc,
    setIsDragActive,
    setPendingImages,
    setPendingFiles,
    setPendingAudio,
    setTokenStats,
    setActiveUsername,
    setActiveContextSize,
    setActiveModelState,
    getModelCap: models_.getModelCap,
  });

  const hist = useHistorySlice({
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
    applyDefaultSystemPrompt: prompts.applyDefaultSystemPrompt,
    setSystemPromptById: prompts.setSystemPromptById,
    fetchAndSetTokens: ui.fetchAndSetTokens,
  });

  const openArtifactCanvas = useCallback((opts: { title: string; contentType: AppState['artifactCanvas']['contentType'] }) => {
    setArtifactCanvas({ isOpen: true, content: '', contentType: opts.contentType, title: opts.title, isStreaming: true, generatedFiles: [] });
  }, []);
  const updateArtifactContent = useCallback((content: string) => {
    setArtifactCanvas((prev) => ({ ...prev, content }));
  }, []);
  const updateArtifactFiles = useCallback((files: string[]) => {
    setArtifactCanvas((prev) => ({ ...prev, generatedFiles: files }));
  }, []);
  const closeArtifactCanvas = useCallback(() => {
    setArtifactCanvas((prev) => ({ ...prev, isOpen: false }));
  }, []);
  const finalizeArtifact = useCallback(() => {
    setArtifactCanvas((prev) => ({ ...prev, isStreaming: false }));
  }, []);

  const streaming = useStreamingSlice({
    isStreaming,
    messages,
    pendingImages,
    pendingFiles,
    pendingAudio,
    activeModel,
    activeContextSize,
    activeUsername,
    activeProjectId: activeProject?.id ?? null,
    currentSystemPrompt,
    currentSystemPromptId,
    currentConvId,
    settingsRef,
    abortCtrlRef,
    streamTextRef,
    setIsStreaming,
    setStreamingContent,
    setStreamingError,
    setMessages,
    setPendingImages,
    setPendingFiles,
    setPendingAudio,
    setImageProgress,
    setImageProgressLabel,
    setCurrentConvId,
    saveConversationToHistory: hist.saveConversationToHistory,
    fetchAndSetTokens: ui.fetchAndSetTokens,
    openArtifactCanvas,
    updateArtifactContent,
    updateArtifactFiles,
    finalizeArtifact,
  });

  const projectsSlice = useProjectsSlice({
    setProjects,
    setActiveProject,
    setProjectFiles,
    setIsProjectsPanelOpen,
  });

  useEffect(() => {
    consumeUrlToken();

    initHistoryStore().then(({ db, history: h }) => {
      historyDbRef.current = db;
      setHistoryState(h);
    });

    models_.refreshConnectionStatus();
    const interval = setInterval(models_.refreshConnectionStatus, 30000);

    fetchModels().then((list) => {
      const m = list.length ? list : [initialSettings.model || FALLBACK_MODEL];
      setModels(m);
    });

    if (!initialSettings.username) {
      setIsNameModalOpen(true);
    } else {
      ui.fetchAndSetTokens(initialSettings.username);
    }

    prompts.applyDefaultSystemPrompt();

    projectsSlice.refreshProjects();

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
    savedPromptsVersion,
    projects,
    activeProject,
    projectFiles,
    isProjectsPanelOpen,
    artifactCanvas,
    sendMessage: streaming.sendMessage,
    stopStreaming: streaming.stopStreaming,
    regenerateLastResponse: streaming.regenerateLastResponse,
    editAndResend: streaming.editAndResend,
    startNewChat: hist.startNewChat,
    loadConversation: hist.loadConversation,
    deleteConversation: hist.deleteConversation,
    clearAllHistory: hist.clearAllHistory,
    exportConversation: hist.exportConversation,
    setHistorySearchTerm,
    setActiveModel: models_.setActiveModel,
    refreshConnectionStatus: models_.refreshConnectionStatus,
    refreshModels: models_.refreshModels,
    refreshDownloadedModels: models_.refreshDownloadedModels,
    updateModelHealth: models_.updateModelHealth,
    pullModel: models_.pullModel,
    pullImageModel: models_.pullImageModel,
    restartOllama: models_.restartOllama,
    setSystemPromptById: prompts.setSystemPromptById,
    getSavedPrompts: prompts.getSavedPrompts,
    savePrompt: prompts.savePrompt,
    deletePrompt: prompts.deletePrompt,
    reorderPrompts: prompts.reorderPrompts,
    duplicatePrompt: prompts.duplicatePrompt,
    setDefaultPrompt: prompts.setDefaultPrompt,
    openSettings: ui.openSettings,
    closeSettings: ui.closeSettings,
    saveSettingsValues: ui.saveSettingsValues,
    openSidebar: ui.openSidebar,
    closeSidebar: ui.closeSidebar,
    addFiles: ui.addFiles,
    removePendingImage: ui.removePendingImage,
    removePendingFile: ui.removePendingFile,
    removePendingAudio: ui.removePendingAudio,
    openLightbox: ui.openLightbox,
    closeLightbox: ui.closeLightbox,
    setNameModalOpen: ui.setNameModalOpen,
    submitName: ui.submitName,
    setShortcutsOpen: ui.setShortcutsOpen,
    setDragActive: ui.setDragActive,
    resetTokenCounter: ui.resetTokenCounter,
    refreshProjects: projectsSlice.refreshProjects,
    createNewProject: projectsSlice.createNewProject,
    removeProject: projectsSlice.removeProject,
    openProject: projectsSlice.openProject,
    closeProject: projectsSlice.closeProject,
    refreshProjectFiles: projectsSlice.refreshProjectFiles,
    openProjectsPanel: projectsSlice.openProjectsPanel,
    closeProjectsPanel: projectsSlice.closeProjectsPanel,
    openArtifactCanvas,
    updateArtifactContent,
    updateArtifactFiles,
    closeArtifactCanvas,
    finalizeArtifact,
  } as AppContextValue;

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
