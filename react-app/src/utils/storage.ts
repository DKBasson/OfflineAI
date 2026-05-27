import type { Settings, SystemPrompt, Conversation } from '../types';
import {
  SETTINGS_KEY,
  PROMPTS_KEY,
  HISTORY_KEY,
  HISTORY_DB,
  HISTORY_STORE,
  DEFAULT_SETTINGS,
  IMAGE_PERF_PRESETS,
  FALLBACK_MODEL,
} from '../constants';

// ── Settings ─────────────────────────────────────────

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampNumber(value, min, max, fallback));
}

export function normalizeSettings(settings: Partial<Settings> = {}): Settings {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return {
    ...s,
    model: String(s.model || FALLBACK_MODEL),
    username: String(s.username || '').slice(0, 32),
    defaultPromptId: String(s.defaultPromptId || ''),
    contextSize: clampInt(s.contextSize, 4, 100, DEFAULT_SETTINGS.contextSize),
    temperature: Number(
      clampNumber(s.temperature, 0, 2, DEFAULT_SETTINGS.temperature).toFixed(2),
    ),
    topP: Number(clampNumber(s.topP, 0.1, 1, DEFAULT_SETTINGS.topP).toFixed(2)),
    maxTokens: clampInt(s.maxTokens, 0, 8192, DEFAULT_SETTINGS.maxTokens),
    numCtx: clampInt(s.numCtx, 0, 32768, DEFAULT_SETTINGS.numCtx),
    historyLimit: clampInt(s.historyLimit, 10, 200, DEFAULT_SETTINGS.historyLimit),
    autoTitle: s.autoTitle !== false,
    imageModel: String(s.imageModel || 'x/z-image-turbo'),
    imagePerfProfile: Object.prototype.hasOwnProperty.call(IMAGE_PERF_PRESETS, s.imagePerfProfile)
      ? s.imagePerfProfile
      : DEFAULT_SETTINGS.imagePerfProfile,
  };
}

export function loadSettings(): Settings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
  } catch {
    return normalizeSettings();
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(s)));
  } catch { /* ignore */ }
}

// ── System prompts ────────────────────────────────────

export function loadSystemPrompts(): SystemPrompt[] {
  try {
    return JSON.parse(localStorage.getItem(PROMPTS_KEY) || '[]') as SystemPrompt[];
  } catch {
    return [];
  }
}

export function saveSystemPrompts(prompts: SystemPrompt[]): void {
  try {
    localStorage.setItem(PROMPTS_KEY, JSON.stringify(prompts));
  } catch { /* ignore */ }
}

// ── IndexedDB history ─────────────────────────────────

function readLegacyHistory(): Conversation[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as Conversation[];
  } catch {
    return [];
  }
}

function openHistoryDb(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HISTORY_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        const store = db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readIndexedHistory(db: IDBDatabase): Promise<Conversation[]> {
  const tx = db.transaction(HISTORY_STORE, 'readonly');
  const store = tx.objectStore(HISTORY_STORE);
  const items = await idbRequest<Conversation[]>(store.getAll());
  return items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export async function writeIndexedHistory(
  db: IDBDatabase | null,
  items: Conversation[],
): Promise<void> {
  if (!db) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
    } catch { /* ignore */ }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    const store = tx.objectStore(HISTORY_STORE);
    store.clear();
    for (const item of items) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).catch(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
    } catch { /* ignore */ }
  });
}

export async function initHistoryStore(): Promise<{
  db: IDBDatabase | null;
  history: Conversation[];
}> {
  const legacy = readLegacyHistory();
  try {
    const db = await openHistoryDb();
    let history: Conversation[] = db ? await readIndexedHistory(db) : legacy;
    if (legacy.length) {
      const merged = new Map(history.map((item) => [item.id, item]));
      for (const item of legacy) merged.set(item.id, item);
      history = [...merged.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      await writeIndexedHistory(db, history);
      localStorage.removeItem(HISTORY_KEY);
    }
    return { db, history };
  } catch {
    return { db: null, history: legacy };
  }
}
