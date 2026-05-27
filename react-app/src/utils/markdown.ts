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
