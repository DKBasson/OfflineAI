import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import type { Settings } from '../../types';
import {
  loadSystemPrompts,
  saveSystemPrompts,
  saveSettings,
  normalizeSettings,
} from '../../utils/storage';

export interface PromptsSliceDeps {
  currentSystemPromptId: string;
  currentConvId: string | null;
  settingsRef: MutableRefObject<Settings>;
  setCurrentSystemPrompt: (s: string) => void;
  setCurrentSystemPromptId: (id: string) => void;
  setSavedPromptsVersion: React.Dispatch<React.SetStateAction<number>>;
}

export function usePromptsSlice({
  currentSystemPromptId,
  currentConvId,
  settingsRef,
  setCurrentSystemPrompt,
  setCurrentSystemPromptId,
  setSavedPromptsVersion,
}: PromptsSliceDeps) {
  const getSettings = useCallback(() => settingsRef.current, [settingsRef]);

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
  }, [getSettings, settingsRef, setCurrentSystemPrompt, setCurrentSystemPromptId]);

  const setSystemPromptById = useCallback(
    (id: string) => {
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
    },
    [setCurrentSystemPrompt, setCurrentSystemPromptId],
  );

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
      setSavedPromptsVersion((v) => v + 1);
    },
    [currentSystemPromptId, setCurrentSystemPrompt, setSavedPromptsVersion],
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
      setSavedPromptsVersion((v) => v + 1);
    },
    [
      getSettings,
      settingsRef,
      currentSystemPromptId,
      setCurrentSystemPrompt,
      setCurrentSystemPromptId,
      setSavedPromptsVersion,
    ],
  );

  const reorderPrompts = useCallback(
    (from: number, to: number) => {
      const prompts = loadSystemPrompts();
      if (to < 0 || to >= prompts.length) return;
      [prompts[from], prompts[to]] = [prompts[to], prompts[from]];
      saveSystemPrompts(prompts);
      setSavedPromptsVersion((v) => v + 1);
    },
    [setSavedPromptsVersion],
  );

  const duplicatePrompt = useCallback(
    (index: number) => {
      const prompts = loadSystemPrompts();
      const p = prompts[index];
      if (!p) return;
      prompts.splice(index + 1, 0, {
        id: String(Date.now()),
        name: `${p.name} copy`,
        content: p.content,
      });
      saveSystemPrompts(prompts);
      setSavedPromptsVersion((v) => v + 1);
    },
    [setSavedPromptsVersion],
  );

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
    [
      getSettings,
      settingsRef,
      currentConvId,
      setSystemPromptById,
      setCurrentSystemPrompt,
      setCurrentSystemPromptId,
    ],
  );

  return {
    applyDefaultSystemPrompt,
    setSystemPromptById,
    getSavedPrompts,
    savePrompt,
    deletePrompt,
    reorderPrompts,
    duplicatePrompt,
    setDefaultPrompt,
  };
}
