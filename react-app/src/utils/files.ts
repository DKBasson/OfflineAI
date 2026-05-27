import { DOC_FILE_RE } from '../constants';
import { extractDocument, transcribeAudio } from './api';

export function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target!.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target!.result as string);
    r.onerror = reject;
    r.readAsText(file);
  });
}

export async function readFileContent(name: string, file: File): Promise<string> {
  if (DOC_FILE_RE.test(name)) {
    return extractDocument(file);
  }
  return readTextFile(file);
}

export function isAudioFile(file: File): boolean {
  return (
    file.type.startsWith('audio/') ||
    /\.(mp3|wav|ogg|opus|m4a|flac|aac|webm)$/i.test(file.name)
  );
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export async function transcribeWithProgress(
  file: File,
  onProgress: (pct: number) => void,
): Promise<string | null> {
  for await (const evt of transcribeAudio(file)) {
    if (evt.type === 'progress') onProgress(evt.percent);
    if (evt.type === 'done') return evt.transcript;
    if (evt.type === 'error') throw new Error(evt.error);
  }
  return null;
}

export function isLikelyImageModelName(name: string): boolean {
  if (!name) return false;
  const n = String(name)
    .toLowerCase()
    .replace(/:latest$/, '');
  return (
    /^x\/(?:z-image-turbo|flux2-klein)$/.test(n) ||
    /(?:^|\/|\b)(?:image|flux|sdxl|stable[-_ ]?diffusion|diffusion)(?:$|\b)/i.test(n)
  );
}

export function modelNamesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const norm = (n: string) => n.toLowerCase().replace(/:latest$/, '');
  return norm(a) === norm(b);
}

export function isImageRequest(text: string): boolean {
  const t = text.trim();
  if (/^\/(?:image|img|draw|paint)\s+/i.test(t)) return true;
  if (
    /\b(?:generate|create|make|draw|paint|render|illustrate|design|visualize|visualise|depict|photograph|sketch|produce)\b.{0,80}\b(?:image|picture|photo|illustration|painting|drawing|artwork|portrait|wallpaper|scene|landscape|sketch|logo|banner|graphic|thumbnail|avatar|icon|meme|anime|cartoon|animation|photograph)\b/i.test(
      t,
    )
  )
    return true;
  if (/\b(?:an?\s+)?(?:image|photo|picture|illustration|painting|drawing|artwork)\s+of\b/i.test(t))
    return true;
  if (/\b(?:draw|paint|illustrate|render|design|sketch)\s+(?:me\s+)?(?:a\s+|an\s+)/i.test(t))
    return true;
  if (/\bgenerate\s+(?:me\s+)?(?:a\s+|an\s+)?(?:image|picture|photo)\b/i.test(t)) return true;
  if (/\bshow\s+me\s+(?:a\s+|an\s+)?(?:picture|image|photo|illustration)\b/i.test(t)) return true;
  if (/\bcan\s+you\s+(?:draw|paint|create|make|generate|illustrate|render|design|sketch)\b/i.test(t))
    return true;
  if (
    /\bI\s+want\s+(?:to\s+see\s+)?(?:a\s+|an\s+)?(?:picture|image|photo|illustration|drawing|painting)\b/i.test(
      t,
    )
  )
    return true;
  if (/\b(?:create|make|generate)\s+(?:a\s+|an\s+)?visual\b/i.test(t)) return true;
  return false;
}

export function estimateJsonBytes(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}

export function triggerDownload(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
