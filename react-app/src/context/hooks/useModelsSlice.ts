import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import type { Settings } from '../../types';
import { FALLBACK_MODEL } from '../../constants';
import {
  fetchModels,
  fetchStatus,
  fetchModelCap,
  pullModelStream,
  restartOllama as apiRestartOllama,
} from '../../utils/api';
import { saveSettings, normalizeSettings } from '../../utils/storage';
import { isLikelyImageModelName } from '../../utils/files';

type ModelHealth = {
  ollamaOnline: boolean;
  chatModel: string;
  modelsCount: number | null;
  vision: boolean;
  access: string;
  storage: string;
} | null;

export interface ModelsSliceDeps {
  activeModel: string;
  settingsRef: MutableRefObject<Settings>;
  ollamaStatusRef: MutableRefObject<Record<string, unknown>>;
  modelCapsRef: MutableRefObject<Record<string, { vision: boolean }>>;
  historyDbRef: MutableRefObject<IDBDatabase | null>;
  setConnectionState: React.Dispatch<React.SetStateAction<'checking' | 'online' | 'offline'>>;
  setConnectionLabel: React.Dispatch<React.SetStateAction<string>>;
  setConnectionTitle: React.Dispatch<React.SetStateAction<string>>;
  setModels: React.Dispatch<React.SetStateAction<string[]>>;
  setPullStatus: React.Dispatch<React.SetStateAction<string>>;
  setPullImageStatus: React.Dispatch<React.SetStateAction<string>>;
  setOllamaRestartStatus: React.Dispatch<React.SetStateAction<string>>;
  setModelHealth: React.Dispatch<React.SetStateAction<ModelHealth>>;
  setActiveModelState: React.Dispatch<React.SetStateAction<string>>;
}

export function useModelsSlice({
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
}: ModelsSliceDeps) {
  const getSettings = useCallback(() => settingsRef.current, [settingsRef]);

  const getModelCap = useCallback(
    async (model: string) => {
      if (modelCapsRef.current[model]) return modelCapsRef.current[model];
      const cap = await fetchModelCap(model);
      modelCapsRef.current[model] = cap;
      return cap;
    },
    [modelCapsRef],
  );

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
  }, [activeModel, getModelCap, ollamaStatusRef, historyDbRef, setModelHealth]);

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
  }, [
    ollamaStatusRef,
    setConnectionState,
    setConnectionLabel,
    setConnectionTitle,
    updateModelHealth,
  ]);

  const refreshModels = useCallback(async () => {
    const fetched = await fetchModels();
    const list = fetched.length ? fetched : [activeModel || FALLBACK_MODEL];
    setModels(list);
    return list;
  }, [activeModel, setModels]);

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
      delete modelCapsRef.current[next];
    },
    [getSettings, settingsRef, modelCapsRef, setActiveModelState],
  );

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
      }
    },
    [setPullStatus, refreshConnectionStatus, refreshModels],
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
    [
      setPullImageStatus,
      refreshConnectionStatus,
      refreshDownloadedModels,
      getSettings,
      settingsRef,
    ],
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
  }, [
    activeModel,
    modelCapsRef,
    setOllamaRestartStatus,
    refreshConnectionStatus,
    refreshModels,
  ]);

  return {
    getModelCap,
    updateModelHealth,
    refreshConnectionStatus,
    refreshModels,
    refreshDownloadedModels,
    setActiveModel,
    pullModel,
    pullImageModel,
    restartOllama,
  };
}
