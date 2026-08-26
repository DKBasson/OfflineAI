import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

marked.use({ breaks: true, gfm: true });

export function renderMarkdown(text: string): string {
  const raw = marked.parse(text) as string;
  return DOMPurify.sanitize(raw);
}

export function highlightCodeBlocks(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('pre code').forEach((block) => {
    hljs.highlightElement(block);

    const pre = block.parentElement;
    if (!pre || pre.querySelector('.code-actions')) return;

    // Detect language from class for file extension
    const langClass = Array.from(block.classList).find(c => c.startsWith('language-'));
    const lang = langClass?.replace('language-', '') || 'txt';

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'code-actions';
    actionsDiv.style.cssText = 'position:absolute;top:6px;right:6px;display:flex;gap:4px;opacity:0;transition:opacity 0.15s;';

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy code';
    copyBtn.style.cssText = 'font-size:11px;padding:2px 7px;border-radius:4px;border:1px solid var(--border);background:var(--surface-md);color:var(--text-2);cursor:pointer;';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(block.textContent || '');
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    };

    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.title = 'Save code to file';
    saveBtn.style.cssText = 'font-size:11px;padding:2px 7px;border-radius:4px;border:1px solid var(--border);background:var(--surface-md);color:var(--text-2);cursor:pointer;';
    saveBtn.onclick = () => {
      const code = block.textContent || '';
      const extMap: Record<string, string> = {
        javascript: 'js', typescript: 'ts', python: 'py', ruby: 'rb',
        rust: 'rs', golang: 'go', go: 'go', java: 'java', cpp: 'cpp',
        c: 'c', csharp: 'cs', swift: 'swift', kotlin: 'kt', php: 'php',
        bash: 'sh', shell: 'sh', zsh: 'sh', html: 'html', css: 'css',
        scss: 'scss', json: 'json', yaml: 'yaml', yml: 'yml', xml: 'xml',
        sql: 'sql', markdown: 'md', toml: 'toml', lua: 'lua', dart: 'dart',
        jsx: 'jsx', tsx: 'tsx', vue: 'vue', svelte: 'svelte',
      };
      const ext = extMap[lang] || lang || 'txt';
      const filename = `code.${ext}`;
      const blob = new Blob([code], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      saveBtn.textContent = 'Saved!';
      setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
    };

    actionsDiv.appendChild(copyBtn);
    actionsDiv.appendChild(saveBtn);

    pre.style.position = 'relative';
    pre.appendChild(actionsDiv);

    pre.addEventListener('mouseenter', () => { actionsDiv.style.opacity = '1'; });
    pre.addEventListener('mouseleave', () => { actionsDiv.style.opacity = '0'; });
  });
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
