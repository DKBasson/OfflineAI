import { AUTH_TOKEN_KEY } from '../constants';

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
): AsyncGenerator<{ content?: string; done?: boolean; error?: string }> {
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
        if (d.done) yield { done: true };
        if (d.message?.content) yield { content: d.message.content };
      } catch { /* ignore */ }
    }
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
        const imageB64 = extractImagePayload(d);
        if (imageB64) { yield { image: imageB64, progress: 100 }; return; }
        if (typeof d.response === 'string' && d.response && !imageB64) {
          yield { status: d.response };
        }
      } catch { /* ignore */ }
    }
  }
}

function extractImagePayload(payload: Record<string, unknown>): string | null {
  const raw =
    (payload.image as string | undefined) ||
    (Array.isArray(payload.images) ? (payload.images[0] as string) : null) ||
    (typeof payload.images === 'string' ? payload.images : null) ||
    (typeof payload.response === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(payload.response as string)
      ? (payload.response as string)
      : null);
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
