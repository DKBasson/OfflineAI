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

  // Slash commands
  if (/^\/(?:image|img|draw|paint|photo|generate|gen|render|illustrate|sketch|art|visualize|vis|pic)\.?\b/i.test(t)) return true;

  // "generate / create / make / draw / … + visual noun"
  if (
    /\b(?:generate|create|make|draw|paint|render|illustrate|design|visualize|visualise|depict|photograph|sketch|produce|forge|craft|build|compose|output|give\s+me|show\s+me)\b.{0,120}\b(?:image|picture|photo|illustration|painting|drawing|artwork|portrait|wallpaper|scene|landscape|logo|banner|graphic|thumbnail|avatar|icon|meme|anime|cartoon|animation|photograph|poster|concept\s+art|digital\s+art|pixel\s+art|realistic\s+photo|3d\s+render|oil\s+painting|watercolor|sketch|sticker|sprite|texture|background|cover\s+art|album\s+art|book\s+cover|infographic|diagram|flowchart|wireframe|mockup|ui\s+design)\b/i.test(t)
  ) return true;

  // "<visual noun> of …"
  if (/\b(?:an?\s+)?(?:image|photo|picture|illustration|painting|drawing|artwork|portrait|sketch|render|photograph|screenshot|infographic|diagram|flowchart)\s+of\b/i.test(t)) return true;

  // "draw / paint / illustrate / render / design / sketch me a …"
  if (/\b(?:draw|paint|illustrate|render|design|sketch|photograph|visualize|visualise)\s+(?:me\s+)?(?:a\s+|an\s+)/i.test(t)) return true;

  // "generate / show / give me a photo / image / picture"
  if (/\b(?:generate|give\s+me|show\s+me)\s+(?:me\s+)?(?:a\s+|an\s+)?(?:image|picture|photo|visual|render|graphic|illustration|wallpaper|thumbnail|banner)\b/i.test(t)) return true;

  // "can you draw / make / …"
  if (/\bcan\s+you\s+(?:draw|paint|create|make|generate|illustrate|render|design|sketch|photograph|visualize)\b/i.test(t)) return true;

  // "I want (to see) a picture / image / …"
  if (/\bI\s+(?:want|need)\s+(?:to\s+see\s+)?(?:a\s+|an\s+)?(?:picture|image|photo|illustration|drawing|painting|render|visual|graphic|thumbnail)\b/i.test(t)) return true;

  // "create / make / generate a visual / mockup / wireframe"
  if (/\b(?:create|make|generate|build|produce)\s+(?:a\s+|an\s+)?(?:visual|render|graphic|design|mockup|poster|thumbnail|wireframe|prototype|storyboard|moodboard)\b/i.test(t)) return true;

  // "what does X look like" — intent to visualize
  if (/\bwhat\s+(?:does|would|do|did)\s+.{1,80}\blook\s+like\b/i.test(t)) return true;

  // "imagine / visualize [me/for me] a [visual noun]"
  if (/\b(?:imagine|visualize|visualise)\s+(?:(?:for\s+)?me\s+)?(?:a\s+|an\s+)?(?:image|picture|photo|illustration|painting|drawing|artwork|portrait|scene|render|sketch|visual|graphic|landscape|character)\b/i.test(t)) return true;

  // "photo of", "pic of", "snapshot of", "render of"
  if (/\b(?:photo|pic|snapshot|shot|render|portrait|illustration)\s+of\b/i.test(t)) return true;

  // "make it look like …"
  if (/\bmake\s+(?:it\s+)?look\s+like\b/i.test(t)) return true;

  // Artistic style keywords used as standalone prompts (Stable Diffusion / FLUX style)
  if (/^(?:a\s+|an\s+)?.{10,}\b(?:photorealistic|hyperrealistic|cinematic|8k|4k|hdr|digital\s+art|concept\s+art|artstation|unreal\s+engine|octane\s+render|ray\s+tracing|bokeh|depth\s+of\s+field|surrealism|impressionism|cyberpunk|steampunk|fantasy\s+art|sci-fi|oil\s+on\s+canvas|ink\s+wash|charcoal\s+drawing|low\s+poly|isometric|voxel\s+art|synthwave|neon\s+noir)\b/i.test(t)) return true;

  // "turn X into an image / illustration / painting"
  if (/\bturn\s+.{1,60}\binto\s+(?:a\s+|an\s+)?(?:image|picture|painting|illustration|artwork|cartoon|anime|sketch|render)\b/i.test(t)) return true;

  // "style: X" or "in the style of X" for artistic requests
  if (/\bin\s+the\s+style\s+of\b/i.test(t) && /\b(?:paint|draw|render|illustrate|image|picture|art)\b/i.test(t)) return true;

  return false;
}

export function isCodeRequest(text: string): boolean {
  const t = text.trim();

  // Slash command
  if (/^\/code\b/i.test(t)) return true;

  // All recognised programming languages / frameworks / runtimes
  const LANG =
    '(?:javascript|js|typescript|ts|python|java(?!\\s*script)|c#|csharp|c\\+\\+|cpp|\\bc\\b|rust|golang?|php|ruby|swift|kotlin|scala|haskell|clojure|elixir|erlang|dart|lua|perl|r\\b|matlab|groovy|f#|fsharp|fortran|cobol|assembly|asm|wasm|webassembly|bash|zsh|fish|sh\\b|powershell|ps1|sql|mysql|postgres|postgresql|sqlite|mongodb|cassandra|redis|html|css|scss|sass|less|jsx|tsx|svelte|vue|react|angular|next\\.?js|nuxt|astro|remix|solid(?:js)?|qwik|nest(?:js)?|express|fastapi|django|flask|spring|laravel|rails|sinatra|gin|echo|fiber|actix|axum|rocket\\b|deno|bun\\b|node(?:\\.js)?|webpack|vite|rollup|esbuild|parcel)';
  const langRe = new RegExp(`\\b${LANG}\\b`, 'i');

  // Action verb + any language
  if (
    /\b(?:write|generate|create|make|build|implement|show|give\s+me|help\s+(?:me\s+)?(?:with|write|build|implement|create)|develop|code\s+up|scaffold)\b.{0,120}/i.test(t) &&
    langRe.test(t)
  ) return true;

  // Language + programming noun
  if (
    langRe.test(t) &&
    /\b(?:function|script|program|class|method|module|component|hook|route|endpoint|middleware|handler|decorator|interface|type|enum|struct|schema|migration|query|snippet|solution|algorithm|test|spec|config|setup|boilerplate|starter|template|code)\b/i.test(t)
  ) return true;

  // Explicit programming concept nouns (no language needed)
  if (
    /\b(?:fibonacci|binary\s+search|quicksort|mergesort|bubble\s+sort|heapsort|bfs|dfs|dijkstra['']?s?|a\*\s+algorithm|dynamic\s+programming|memoization|recursion|linked\s+list|doubly\s+linked|circular\s+list|stack\s+overflow|call\s+stack|hash\s+(?:map|table|set)|binary\s+tree|avl\s+tree|red[-\s]black\s+tree|trie|graph\s+algorithm|topological\s+sort|union[-\s]find|sliding\s+window|two\s+pointer|bit\s+manipulation|regex|regular\s+expression|sql\s+(?:query|join|index|trigger|view)|rest\s+api|graphql\s+(?:query|mutation|schema)|grpc|websocket|oauth|jwt|csrf|cors|docker(?:file|\s+compose)?|kubernetes|k8s|ci\/cd|github\s+action|gitlab\s+ci|cron\s+(?:job|expression)|lambda\s+function|serverless|microservice|monorepo|design\s+pattern|singleton|observer|factory|strategy|decorator\s+pattern|dependency\s+injection|unit\s+test|integration\s+test|mock(?:ing)?|stub(?:bing)?|snapshot\s+test)\b/i.test(t)
  ) return true;

  // "write / implement / create a <code artifact>"
  if (
    /\b(?:write|implement|create|build|make|generate|code|develop|design)\b.{0,80}\b(?:function|class|method|module|component|hook|script|program|algorithm|snippet|loop|parser|formatter|validator|sanitizer|middleware|handler|decorator|type|interface|schema|migration|controller|service|repository|util(?:ity)?|helper|mixin|plugin|extension|macro|shader|kernel|daemon|worker|thread|coroutine|stream|pipeline|cli|repl|linter|bundler|transpiler|compiler|interpreter|vm\b|emulator|simulator)\b/i.test(t)
  ) return true;

  // Debug / fix / refactor / review / explain / optimize code
  if (
    /\b(?:debug|fix|patch|refactor|optimis|optimiz|review|explain|improve|rewrite|convert|transpile|lint|profile|benchmark|test|mock|stub|clean\s+up|simplify|modernize|upgrade|port)\b.{0,80}\b(?:code|function|script|class|method|bug|error|exception|issue|crash|loop|query|component|module|app|program|logic|test|suite|pipeline|build|config)\b/i.test(t)
  ) return true;

  // "how do I / how to / how can I … in <language>"
  if (
    /\bhow\s+(?:do\s+I|to|can\s+I)\b.{0,120}/i.test(t) &&
    langRe.test(t)
  ) return true;

  // "in <language>" + verb suggesting code task
  if (
    /\bin\s+/i.test(t) &&
    langRe.test(t) &&
    /\b(?:write|build|implement|create|make|develop|do|use|call|return|loop|sort|filter|map|reduce|fetch|parse|format|validate|connect|query|insert|update|delete|render|import|export|declare|define|extend|inherit|override|async|await|promise|callback|event|emit|subscribe|publish|inject|mock|test|deploy|configure|initialise|initialize)\b/i.test(t)
  ) return true;

  // Build / package / devtool names + task context
  if (
    /\b(?:webpack|vite|rollup|esbuild|parcel|turbopack|babel|swc|eslint|prettier|biome|jest|vitest|mocha|chai|jasmine|cypress|playwright|puppeteer|prisma|drizzle|mongoose|sequelize|typeorm|knex|sqlalchemy|alembic|celery|pydantic|zod|yup|joi|axios|fetch\s+api|swr|react\s+query|redux|zustand|mobx|jotai|recoil|valtio|pinia|vuex|rxjs|lodash|ramda|immutable|moment|dayjs|date-fns|sharp|ffmpeg|opencv|tensorflow|pytorch|sklearn|numpy|pandas|matplotlib)\b/i.test(t) &&
    /\b(?:config|setup|install|run|build|deploy|test|fix|help|how|error|issue|problem|import|use|integrate|connect|configure|migrate|upgrade|scaffold|initialise|initialize)\b/i.test(t)
  ) return true;

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

/**
 * Parse an exported Markdown conversation back into a title and messages array.
 * Returns null if the file doesn't contain any parseable messages.
 */
export function parseMarkdownConversation(md: string): { title: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } | null {
  const lines = md.split('\n');
  const title = lines[0]?.replace(/^#+\s*/, '').trim() || 'Imported';

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let currentRole: 'user' | 'assistant' | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith('**You:**')) {
      if (currentRole && currentContent.length) {
        messages.push({ role: currentRole, content: currentContent.join('\n').trim() });
      }
      currentRole = 'user';
      currentContent = [line.replace('**You:**', '').trim()];
    } else if (line.startsWith('**AI:**')) {
      if (currentRole && currentContent.length) {
        messages.push({ role: currentRole, content: currentContent.join('\n').trim() });
      }
      currentRole = 'assistant';
      currentContent = [line.replace('**AI:**', '').trim()];
    } else if (currentRole) {
      currentContent.push(line);
    }
  }
  if (currentRole && currentContent.length) {
    messages.push({ role: currentRole, content: currentContent.join('\n').trim() });
  }

  return messages.length > 0 ? { title, messages } : null;
}
