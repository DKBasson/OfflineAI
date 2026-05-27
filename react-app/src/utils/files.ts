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

/** Formats Ollama vision accepts natively. */
const OLLAMA_NATIVE_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);

/**
 * Returns a data-URL for the image, converting unsupported formats (GIF, WebP,
 * BMP, TIFF, AVIF, …) to PNG via an offscreen canvas so Ollama doesn't reject them.
 * For GIFs only the first frame is captured.
 */
export function normalizeImageForOllama(file: File): Promise<string> {
  if (OLLAMA_NATIVE_IMAGE_TYPES.has(file.type)) {
    return readDataUrl(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas 2D not available')); return; }
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
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

  // Explicit slash commands: /image, /img, /draw, /paint, /photo, /generate, /gen, /render
  if (/^\/(?:image|img|draw|paint|photo|generate|gen|render|illustrate|sketch|art)\b/i.test(t)) return true;

  // "generate / create / make / draw / … + visual noun"
  if (
    /\b(?:generate|create|make|draw|paint|render|illustrate|design|visualize|visualise|depict|photograph|sketch|produce|forge|craft|build|compose|output|give\s+me)\b.{0,120}\b(?:image|picture|photo|illustration|painting|drawing|artwork|portrait|wallpaper|scene|landscape|logo|banner|graphic|thumbnail|avatar|icon|meme|anime|cartoon|animation|photograph|poster|concept\s+art|digital\s+art|pixel\s+art|realistic\s+photo|3d\s+render|oil\s+painting|watercolor|sketch)\b/i.test(t)
  ) return true;

  // "<visual noun> of …"
  if (/\b(?:an?\s+)?(?:image|photo|picture|illustration|painting|drawing|artwork|portrait|sketch|render)\s+of\b/i.test(t)) return true;

  // "draw / paint / illustrate / render / design / sketch me a …"
  if (/\b(?:draw|paint|illustrate|render|design|sketch|photograph)\s+(?:me\s+)?(?:a\s+|an\s+)/i.test(t)) return true;

  // "generate me a photo / image / picture"
  if (/\bgenerate\s+(?:me\s+)?(?:a\s+|an\s+)?(?:image|picture|photo|visual|render)\b/i.test(t)) return true;

  // "show me a picture / image / photo"
  if (/\bshow\s+me\s+(?:a\s+|an\s+)?(?:picture|image|photo|illustration|visual|render)\b/i.test(t)) return true;

  // "can you draw / make / …"
  if (/\bcan\s+you\s+(?:draw|paint|create|make|generate|illustrate|render|design|sketch|photograph)\b/i.test(t)) return true;

  // "I want (to see) a picture / image / …"
  if (/\bI\s+want\s+(?:to\s+see\s+)?(?:a\s+|an\s+)?(?:picture|image|photo|illustration|drawing|painting|render|visual)\b/i.test(t)) return true;

  // "create / make / generate a visual"
  if (/\b(?:create|make|generate|build|produce)\s+(?:a\s+|an\s+)?(?:visual|render|graphic|design|mockup|poster|thumbnail)\b/i.test(t)) return true;

  // "what does X look like" — intent to visualize
  if (/\bwhat\s+(?:does|would|do|did)\s+.{1,80}\blook\s+like\b/i.test(t)) return true;

  // "imagine / visualize [me/for me] a [visual noun]" — requires an explicit visual noun to avoid
  // false positives such as "I can't imagine how this works" or "imagine running the server".
  if (/\b(?:imagine|visualize|visualise)\s+(?:(?:for\s+)?me\s+)?(?:a\s+|an\s+)?(?:image|picture|photo|illustration|painting|drawing|artwork|portrait|scene|render|sketch|visual|graphic)\b/i.test(t)) return true;

  // "photo of", "pic of", "snapshot of"
  if (/\b(?:photo|pic|snapshot|shot|render)\s+of\b/i.test(t)) return true;

  // "make it look like …" / "make it more …" in visual context
  if (/\bmake\s+(?:it\s+)?look\s+like\b/i.test(t)) return true;

  // Flux / Stable Diffusion / DALL-E style prompts: leading descriptive noun phrases without a verb
  // e.g. "a majestic dragon flying over a city, photorealistic, 8k"
  if (/^(?:a\s+|an\s+)?.{10,}\b(?:photorealistic|hyperrealistic|cinematic|8k|4k|hdr|digital\s+art|concept\s+art|artstation|unreal\s+engine|octane\s+render|ray\s+tracing)\b/i.test(t)) return true;

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
