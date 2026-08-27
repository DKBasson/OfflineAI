import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import type { PendingAudio, PendingFile, PendingImage, Settings, TokenStats } from '../../types';
import { fetchTokenStats, deleteUserTokens } from '../../utils/api';
import { saveSettings, normalizeSettings } from '../../utils/storage';
import {
  normalizeImageForOllama,
  isAudioFile,
  isImageFile,
} from '../../utils/files';

export interface UISliceDeps {
  activeModel: string;
  activeUsername: string;
  settingsRef: MutableRefObject<Settings>;
  modelCapsRef: MutableRefObject<Record<string, { vision: boolean }>>;
  setIsSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsNameModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsShortcutsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setLightboxSrc: React.Dispatch<React.SetStateAction<string | null>>;
  setIsDragActive: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingImages: React.Dispatch<React.SetStateAction<PendingImage[]>>;
  setPendingFiles: React.Dispatch<React.SetStateAction<PendingFile[]>>;
  setPendingAudio: React.Dispatch<React.SetStateAction<PendingAudio[]>>;
  setTokenStats: React.Dispatch<React.SetStateAction<TokenStats>>;
  setActiveUsername: React.Dispatch<React.SetStateAction<string>>;
  setActiveContextSize: React.Dispatch<React.SetStateAction<number>>;
  setActiveModelState: React.Dispatch<React.SetStateAction<string>>;
  getModelCap: (model: string) => Promise<{ vision: boolean }>;
}

export function useUISlice({
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
  getModelCap,
}: UISliceDeps) {
  const getSettings = useCallback(() => settingsRef.current, [settingsRef]);

  const fetchAndSetTokens = useCallback(
    async (username?: string) => {
      const name = username ?? activeUsername;
      if (!name) return;
      const stats = await fetchTokenStats();
      const entry = stats[name] || [0, 0];
      setTokenStats({ input: entry[0], output: entry[1] });
    },
    [activeUsername, setTokenStats],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      const caps = await getModelCap(activeModel);
      for (const file of files) {
        if (isImageFile(file)) {
          if (caps.vision) {
            const dataUrl = await normalizeImageForOllama(file);
            setPendingImages((prev) => [...prev, { dataUrl, base64: dataUrl.split(',')[1] }]);
          }
        } else if (isAudioFile(file)) {
          setPendingAudio((prev) => [...prev, { name: file.name, file }]);
        } else {
          setPendingFiles((prev) => [...prev, { name: file.name, file }]);
        }
      }
    },
    [activeModel, getModelCap, setPendingImages, setPendingAudio, setPendingFiles],
  );

  const removePendingImage = useCallback(
    (index: number) => {
      setPendingImages((prev) => prev.filter((_, i) => i !== index));
    },
    [setPendingImages],
  );

  const removePendingFile = useCallback(
    (index: number) => {
      setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    },
    [setPendingFiles],
  );

  const removePendingAudio = useCallback(
    (index: number) => {
      setPendingAudio((prev) => prev.filter((_, i) => i !== index));
    },
    [setPendingAudio],
  );

  const openSettings = useCallback(() => setIsSettingsOpen(true), [setIsSettingsOpen]);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), [setIsSettingsOpen]);
  const openSidebar = useCallback(() => setIsSidebarOpen(true), [setIsSidebarOpen]);
  const closeSidebar = useCallback(() => setIsSidebarOpen(false), [setIsSidebarOpen]);
  const openLightbox = useCallback(
    (src: string) => setLightboxSrc(src),
    [setLightboxSrc],
  );
  const closeLightbox = useCallback(() => setLightboxSrc(null), [setLightboxSrc]);
  const setNameModalOpen = useCallback(
    (open: boolean) => setIsNameModalOpen(open),
    [setIsNameModalOpen],
  );
  const setShortcutsOpen = useCallback(
    (open: boolean) => setIsShortcutsOpen(open),
    [setIsShortcutsOpen],
  );
  const setDragActive = useCallback(
    (active: boolean) => setIsDragActive(active),
    [setIsDragActive],
  );

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
    [
      getSettings,
      settingsRef,
      activeUsername,
      modelCapsRef,
      setActiveContextSize,
      setActiveUsername,
      setActiveModelState,
    ],
  );

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
    [getSettings, settingsRef, setActiveUsername, setIsNameModalOpen, fetchAndSetTokens],
  );

  const resetTokenCounter = useCallback(async () => {
    if (!activeUsername) return;
    await deleteUserTokens(activeUsername);
    setTokenStats({ input: 0, output: 0 });
  }, [activeUsername, setTokenStats]);

  return {
    fetchAndSetTokens,
    addFiles,
    removePendingImage,
    removePendingFile,
    removePendingAudio,
    openSettings,
    closeSettings,
    openSidebar,
    closeSidebar,
    openLightbox,
    closeLightbox,
    setNameModalOpen,
    setShortcutsOpen,
    setDragActive,
    saveSettingsValues,
    submitName,
    resetTokenCounter,
  };
}
