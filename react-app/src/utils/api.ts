import { AUTH_TOKEN_KEY } from '../constants';
import type { Project, ProjectFile, ResearchEvent, Tool } from '../types';

export function getAuthToken(): string | null {
  return sessionStorage.getItem(AUTH_TOKEN_KEY);
}

export function consumeUrlToken(): void {
  const urlToken = new URLSearchParams(location.search).get('token');
  if (urlToken) {
    sessionStorage.setItem(AUTH_TOKEN_KEY, urlToken);
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getAuthToken();
  return token ? { ...extra, 'X-OfflineAI-Token': token } : extra;
}

export async function fetchModels(signal?: AbortSignal): Promise<string[]> {
  try {
    const r = await fetch('/api/models', { headers: authHeaders(), signal });
    const data = await r.json();
    return (data.models || []).map((m: { name: string }) => m.name).filter(Boolean) as string[];
  } catch {
    return [];
  }
}

export async function fetchStatus(): Promise<Record<string, unknown>> {
  const r = await fetch('/api/status', { cache: 'no-store', headers: authHeaders() });
  return r.json().catch(() => ({}));
}

export async function fetchModelCap(model: string): Promise<{ vision: boolean }> {
  try {
    const r = await fetch('/api/show', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: model }),
    });
    if (!r.ok) return { vision: false };
    const data = await r.json();
    if (data.error) return { vision: false };
    const caps: string[] = data.capabilities || [];
    const fams: string[] = data.details?.families || [];
    return { vision: caps.includes('vision') || fams.includes('clip') };
  } catch {
    return { vision: false };
  }
}

export async function fetchTokenStats(): Promise<Record<string, [number, number]>> {
  try {
    const r = await fetch('/api/tokens', { headers: authHeaders() });
    if (!r.ok) return {};
    return r.json();
  } catch {
    return {};
  }
}

export async function deleteUserTokens(username: string): Promise<void> {
  await fetch(`/api/tokens?user=${encodeURIComponent(username)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }).catch(() => {});
}

export async function restartOllama(): Promise<{ ok: boolean; message?: string; error?: string }> {
  const resp = await fetch('/api/ollama/restart', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
  });
  return resp.json().catch(() => ({}));
}

export async function pullModelStream(
  name: string,
  onStatus: (text: string) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  const resp = await fetch('/api/pull', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, stream: true }),
    signal,
  });

  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line);
        if (d.error) {
          onStatus(`Error: ${d.error}`);
          return false;
        }
        if (d.status) {
          onStatus(
            d.total && d.completed != null
              ? `${d.status} — ${Math.round((d.completed / d.total) * 100)}%`
              : d.status,
          );
        }
      } catch { /* ignore */ }
    }
  }
  return true;
}

export type ChatMessage = { role: string; content: string; images?: string[] };

export async function* streamChat(
  body: Record<string, unknown>,
  signal: AbortSignal,
): AsyncGenerator<{ content?: string; done?: boolean; error?: string; tokens?: number }> {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    yield { error: `Server error ${resp.status}: ${errText}` };
    return;
  }

  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line);
        if (d.error) { yield { error: d.error }; return; }
        if (d.done) yield { done: true, tokens: d.eval_count || 0 };
        if (d.message?.content) yield { content: d.message.content };
      } catch { /* ignore */ }
    }
  }
}

export async function classifyIntent(
  text: string,
  model: string,
  signal: AbortSignal,
): Promise<'image' | 'code' | 'text' | 'search' | 'research' | 'document'> {
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model,
        think: false,
        messages: [
          {
            role: 'system',
            content:
              'Classify the user message. Reply with exactly one word: image, code, search, research, document, or text.\n' +
              'image = requests to generate, draw, or create pictures/artwork/photos\n' +
              'code = any programming task: write, generate, fix, debug, explain, implement code/functions/scripts/algorithms\n' +
              'search = simple questions about current events, recent news, real-time data, live prices, weather, sports scores\n' +
              'research = deep research requests: investigate, analyze, compare, study, explore a topic in depth, find out everything about something\n' +
              'document = requests to write a report, essay, article, summary document, whitepaper, guide, tutorial, or analysis document\n' +
              'text = everything else: general questions, chat, quick explanations, casual conversation\n\n' +
              'Examples:\n' +
              '"draw a cat" → image\n' +
              '"generate javascript for fibonacci" → code\n' +
              '"what is the bitcoin price right now?" → search\n' +
              '"research the history of quantum computing" → research\n' +
              '"investigate the latest AI safety developments" → research\n' +
              '"compare React vs Vue in depth" → research\n' +
              '"write a report on climate change" → document\n' +
              '"create a guide on Python best practices" → document\n' +
              '"write an analysis of the EV market" → document\n' +
              '"what is the capital of France?" → text\n' +
              '"explain how black holes work" → text\n' +
              '"create a landscape painting" → image\n\n' +
              'Reply with only one word.',
          },
          { role: 'user', content: text.slice(0, 300) },
        ],
        stream: false,
        options: { temperature: 0, num_predict: 16 },
      }),
      signal,
    });
    const raw = await resp.text();
    const d = JSON.parse(raw.trim().split('\n')[0]);
    const word = (d?.message?.content || d?.message?.thinking || d?.error || '').toLowerCase().trim().split(/\s+/)[0];
    if (word === 'image') return 'image';
    if (word === 'code') return 'code';
    if (word === 'search') return 'search';
    if (word === 'research') return 'research';
    if (word === 'document') return 'document';
    return 'text';
  } catch (err) {
    console.warn('[intent] classifyIntent error — falling back to text', err);
    return 'text';
  }
}

export async function generateTitle(
  model: string,
  messages: ChatMessage[],
  username?: string,
): Promise<string | null> {
  const excerpt = messages
    .slice(0, 2)
    .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
    .join('\n');
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: `Give this conversation a short title of 4 words or less. Reply with the title only — no punctuation, no quotes, no explanation:\n\n${excerpt}`,
          },
        ],
        stream: false,
        options: { temperature: 0.2, top_p: 0.9, num_predict: 16 },
        ...(username ? { user: username } : {}),
      }),
    });
    const text = await resp.text();
    const d = JSON.parse(text.trim().split('\n')[0]);
    const title = d.message?.content
      ?.trim()
      .replace(/^["']+|["']+$/g, '')
      .slice(0, 72);
    return title || null;
  } catch {
    return null;
  }
}

export async function* streamImageGeneration(
  body: Record<string, unknown>,
  signal: AbortSignal,
): AsyncGenerator<{ error?: string; progress?: number; image?: string; status?: string }> {
  const resp = await fetch('/api/generate-image', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    yield { error: `Image generation failed (${resp.status}): ${errText}` };
    return;
  }

  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let accumulatedResponse = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line);
        if (d.error) { yield { error: d.error }; return; }

        if (d.total && d.completed != null) {
          yield { progress: Math.min(99, Math.round((d.completed / d.total) * 100)) };
        }

        if (typeof d.response === 'string' && d.response) {
          accumulatedResponse += d.response;
        }

        const directImage = extractImagePayload(d);
        if (directImage) { yield { image: directImage, progress: 100 }; return; }

        if (d.done) {
          if (accumulatedResponse) {
            const cleaned = accumulatedResponse.replace(/\s+/g, '');
            if (cleaned.length > 100 && /^[A-Za-z0-9+/=]+$/.test(cleaned)) {
              yield { image: cleaned, progress: 100 };
              return;
            }
          }
        }
      } catch { /* ignore malformed JSON lines */ }
    }
  }

  if (accumulatedResponse) {
    const cleaned = accumulatedResponse.replace(/\s+/g, '');
    if (cleaned.length > 100 && /^[A-Za-z0-9+/=]+$/.test(cleaned)) {
      yield { image: cleaned, progress: 100 };
      return;
    }
  }
}

function extractImagePayload(payload: Record<string, unknown>): string | null {
  const raw =
    (payload.image as string | undefined) ||
    (Array.isArray(payload.images) ? (payload.images[0] as string) : null) ||
    (typeof payload.images === 'string' ? payload.images : null);
  if (!raw || typeof raw !== 'string') return null;
  return raw.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').replace(/\s+/g, '');
}

export async function extractDocument(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file, file.name);
  const r = await fetch('/api/extract', { method: 'POST', headers: authHeaders(), body: form });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Extraction failed (${r.status})`);
  }
  const data = await r.json();
  return (data as { text: string }).text;
}

export interface WebSearchResult {
  title: string;
  href: string;
  body: string;
}

export async function webSearch(
  query: string,
  maxResults = 5,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  try {
    const r = await fetch('/api/search', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ query, max_results: maxResults }),
      signal,
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      console.warn('[webSearch] error:', (data as { error?: string }).error);
      return [];
    }
    const data = await r.json();
    return (data as { results: WebSearchResult[] }).results || [];
  } catch (err) {
    console.warn('[webSearch] failed:', err);
    return [];
  }
}

export async function* transcribeAudio(
  file: File,
): AsyncGenerator<{ type: 'progress'; percent: number } | { type: 'done'; transcript: string } | { type: 'error'; error: string }> {
  const form = new FormData();
  form.append('file', file, file.name);
  const r = await fetch('/api/transcribe', { method: 'POST', headers: authHeaders(), body: form });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    yield { type: 'error', error: (d as { error?: string }).error || `Transcription failed (${r.status})` };
    return;
  }

  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        yield evt;
        if (evt.type === 'done' || evt.type === 'error') return;
      } catch { /* ignore */ }
    }
  }
}

export async function fetchProjects(): Promise<Project[]> {
  try {
    const r = await fetch('/api/projects', { headers: authHeaders() });
    if (!r.ok) return [];
    const data = await r.json();
    return (data as { projects: Project[] }).projects || [];
  } catch {
    return [];
  }
}

export async function createProject(
  name: string,
  description: string,
): Promise<Project | null> {
  try {
    const r = await fetch('/api/projects', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name, description }),
    });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

export async function deleteProject(id: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function fetchProjectFiles(id: string): Promise<ProjectFile[]> {
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(id)}/files`, {
      headers: authHeaders(),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data as { files: ProjectFile[] }).files || [];
  } catch {
    return [];
  }
}

export async function readProjectFile(projectId: string, filePath: string): Promise<string | null> {
  try {
    const r = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/files/${filePath}`,
      { headers: authHeaders() },
    );
    if (!r.ok) return null;
    const data = await r.json();
    return (data as { content: string }).content ?? null;
  } catch {
    return null;
  }
}

export async function writeProjectFile(
  projectId: string,
  filePath: string,
  content: string,
): Promise<boolean> {
  try {
    const r = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/files/${filePath}`,
      {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ content }),
      },
    );
    return r.ok;
  } catch {
    return false;
  }
}

export async function deleteProjectFile(projectId: string, filePath: string): Promise<boolean> {
  try {
    const r = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/files/${filePath}`,
      { method: 'DELETE', headers: authHeaders() },
    );
    return r.ok;
  } catch {
    return false;
  }
}

export function getProjectDownloadUrl(projectId: string, filePath: string): string {
  const token = getAuthToken();
  const base = `/api/projects/${encodeURIComponent(projectId)}/download/${filePath}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export function getProjectViewUrl(projectId: string, filePath: string): string {
  const token = getAuthToken();
  const base = `/api/projects/${encodeURIComponent(projectId)}/view/${filePath}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export async function* streamResearch(
  projectId: string,
  topic: string,
  depth: 'quick' | 'standard' | 'deep' = 'standard',
  signal?: AbortSignal,
): AsyncGenerator<ResearchEvent> {
  const r = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/research`,
    {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ topic, depth }),
      signal,
    },
  );
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    yield { type: 'error', error: (d as { error?: string }).error || `Research failed (${r.status})` };
    return;
  }

  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const evt = JSON.parse(line.slice(6)) as ResearchEvent;
        yield evt;
        if (evt.type === 'done' || evt.type === 'error') return;
      } catch { /* ignore */ }
    }
  }
}

export async function fetchTools(): Promise<Tool[]> {
  try {
    const r = await fetch('/api/tools', { headers: authHeaders() });
    if (!r.ok) return [];
    const data = await r.json();
    return (data as { tools: Tool[] }).tools || [];
  } catch {
    return [];
  }
}

export async function deleteTool(name: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/tools/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function toggleTool(name: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/tools/${encodeURIComponent(name)}/toggle`, {
      method: 'POST',
      headers: authHeaders(),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function buildToolApi(
  description: string,
  model: string,
): Promise<{ ok: boolean; name?: string; error?: string }> {
  try {
    const r = await fetch('/api/tools/build', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ description, model }),
    });
    return r.json();
  } catch {
    return { ok: false, error: 'Request failed' };
  }
}