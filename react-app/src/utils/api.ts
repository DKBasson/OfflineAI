import { AUTH_TOKEN_KEY } from '../constants';
import type { Project, ProjectFile, ResearchEvent } from '../types';

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

// ── API calls ────────────────────────────────────────

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

// ── Intent classification ─────────────────────────────
// Sends a fast single-token request to a small model to determine whether the
// user's message is an image request, a code request, or plain text.
// Returns 'image' | 'code' | 'text'.  Never throws — falls back to 'text'.
export async function classifyIntent(
  text: string,
  model: string,
  signal: AbortSignal,
): Promise<'image' | 'code' | 'text' | 'search'> {
  console.log('[intent] classifyIntent called', { model, text: text.slice(0, 100) });
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model,
        think: false, // disable chain-of-thought for thinking models (e.g. Qwen3)
        messages: [
          {
            role: 'system',
            content:
              'Classify the user message. Reply with exactly one word: image, code, search, or text.\n' +
              'image = requests to generate, draw, or create pictures/artwork/photos\n' +
              'code = any programming task: write, generate, fix, debug, explain, implement code/functions/scripts/algorithms\n' +
              'search = questions about current events, recent news, real-time data, live prices, weather, sports scores, or anything that requires up-to-date internet information\n' +
              'text = everything else: questions answerable from general knowledge, chat, analysis, summaries\n\n' +
              'Examples:\n' +
              '"draw a cat" → image\n' +
              '"generate javascript for fibonacci" → code\n' +
              '"what is the latest news about AI?" → search\n' +
              '"what is the current bitcoin price?" → search\n' +
              '"who won the game last night?" → search\n' +
              '"what is the weather in Tokyo?" → search\n' +
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
    console.log('[intent] HTTP status:', resp.status, resp.ok);
    const raw = await resp.text();
    console.log('[intent] raw response:', raw.slice(0, 500));
    const d = JSON.parse(raw.trim().split('\n')[0]);
    console.log('[intent] parsed:', d);
    // thinking models (e.g. Qwen3) may return content:"" with the actual text in thinking
    const word = (d?.message?.content || d?.message?.thinking || d?.error || '').toLowerCase().trim().split(/\s+/)[0];
    console.log('[intent] extracted word:', JSON.stringify(word));
    if (word === 'image') return 'image';
    if (word === 'code') return 'code';
    if (word === 'search') return 'search';
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
  // Ollama streams image data across many NDJSON lines, each with a partial
  // base64 string in the `response` field. Accumulate until `done: true`.
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

        // Track diffusion step progress
        if (d.total && d.completed != null) {
          yield { progress: Math.min(99, Math.round((d.completed / d.total) * 100)) };
        }

        // Accumulate the response field (base64 image data comes in chunks)
        if (typeof d.response === 'string' && d.response) {
          accumulatedResponse += d.response;
        }

        // Check for explicit `image` or `images` fields (some models may use these)
        const directImage = extractImagePayload(d);
        if (directImage) { yield { image: directImage, progress: 100 }; return; }

        // When done, the accumulated response IS the base64 image
        if (d.done) {
          if (accumulatedResponse) {
            const cleaned = accumulatedResponse.replace(/\s+/g, '');
            // Verify it looks like base64 data
            if (cleaned.length > 100 && /^[A-Za-z0-9+/=]+$/.test(cleaned)) {
              yield { image: cleaned, progress: 100 };
              return;
            }
          }
        }
      } catch { /* ignore malformed JSON lines */ }
    }
  }

  // If we exit the loop without finding an image, check what we accumulated
  if (accumulatedResponse) {
    const cleaned = accumulatedResponse.replace(/\s+/g, '');
    if (cleaned.length > 100 && /^[A-Za-z0-9+/=]+$/.test(cleaned)) {
      yield { image: cleaned, progress: 100 };
      return;
    }
  }
}

function extractImagePayload(payload: Record<string, unknown>): string | null {
  // Check explicit image fields (not the streaming `response` field — that's handled by accumulation)
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

// ── Projects API ─────────────────────────────────────

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
