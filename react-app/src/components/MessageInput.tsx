import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { loadSystemPrompts } from '../utils/storage';
import {
  IMAGE_ACCEPT,
  TEXT_ACCEPT,
  DOC_ACCEPT,
  AUDIO_ACCEPT,
} from '../constants';

export function MessageInput() {
  const {
    isStreaming,
    pendingImages,
    pendingFiles,
    pendingAudio,
    sendMessage,
    stopStreaming,
    addFiles,
    removePendingImage,
    removePendingFile,
    removePendingAudio,
    activeModel,
    currentSystemPromptId,
    setSystemPromptById,
  } = useApp();

  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileAccept, setFileAccept] = useState<string>(TEXT_ACCEPT + ',' + DOC_ACCEPT + ',' + AUDIO_ACCEPT);

  const hasPending = pendingImages.length > 0 || pendingFiles.length > 0 || pendingAudio.length > 0;
  const canSend = !isStreaming && (text.trim().length > 0 || hasPending);

  // Update file accept based on model caps  
  useEffect(() => {
    const base = TEXT_ACCEPT + ',' + DOC_ACCEPT + ',' + AUDIO_ACCEPT;
    import('../utils/api').then(({ fetchModelCap }) =>
      fetchModelCap(activeModel).then((cap) => {
        setFileAccept(cap.vision ? IMAGE_ACCEPT + ',' + base : base);
      }),
    );
  }, [activeModel]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [text]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, isStreaming, hasPending],
  );

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const msg = text;
    setText('');
    await sendMessage(msg);
  }, [canSend, text, sendMessage]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = [...(e.target.files || [])];
      if (files.length) await addFiles(files);
      e.target.value = '';
    },
    [addFiles],
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = [...e.clipboardData.items];
      const imgs = items.filter((i) => i.type.startsWith('image/'));
      if (imgs.length) {
        e.preventDefault();
        await addFiles(imgs.map((i) => i.getAsFile()!).filter(Boolean));
      }
    },
    [addFiles],
  );

  const savedPrompts = loadSystemPrompts();

  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      {/* Attachment previews */}
      {hasPending && (
        <div className="flex flex-wrap gap-2 mb-2">
          {pendingImages.map((img, i) => (
            <div key={i} className="relative">
              <img
                src={img.dataUrl}
                alt="preview"
                className="h-14 w-14 object-cover rounded-sm border border-border"
              />
              <button
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-panel border border-border rounded-full text-text-muted text-[10px] flex items-center justify-center hover:text-text-primary hover:border-border-hi transition-colors"
                onClick={() => removePendingImage(i)}
                aria-label="Remove image"
              >
                ×
              </button>
            </div>
          ))}
          {pendingFiles.map((f, i) => (
            <div key={i} className="relative flex items-center gap-1.5 bg-surface border border-border rounded-sm px-2.5 py-1.5 max-w-[160px]">
              <span className="text-[12px] text-text-muted truncate">{f.name}</span>
              <button
                className="shrink-0 text-text-dim hover:text-text-primary text-[11px]"
                onClick={() => removePendingFile(i)}
                aria-label="Remove file"
              >
                ×
              </button>
            </div>
          ))}
          {pendingAudio.map((a, i) => (
            <div key={i} className="relative flex items-center gap-1.5 bg-surface border border-border rounded-sm px-2.5 py-1.5 max-w-[160px]">
              <span className="text-[12px] text-text-muted truncate">🎵 {a.name}</span>
              <button
                className="shrink-0 text-text-dim hover:text-text-primary text-[11px]"
                onClick={() => removePendingAudio(i)}
                aria-label="Remove audio"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="input-container flex flex-col gap-2">
        {/* System prompt selector (if there are saved prompts) */}
        {savedPrompts.length > 0 && (
          <div className="flex items-center gap-2 px-1">
            <span className="text-[11px] text-text-dim shrink-0">Prompt:</span>
            <select
              className={`flex-1 bg-transparent border border-transparent rounded-sm text-[12px] outline-none cursor-pointer hover:border-border transition-colors ${currentSystemPromptId ? 'text-accent' : 'text-text-dim'}`}
              value={currentSystemPromptId}
              onChange={(e) => setSystemPromptById(e.target.value)}
              aria-label="Select system prompt"
            >
              <option value="">— none —</option>
              {savedPrompts.map((p) => (
                <option key={p.id} value={p.id} className="bg-panel">
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Textarea row */}
        <div className="flex items-end gap-2">
          <button
            className="shrink-0 w-8 h-8 rounded-sm bg-transparent border border-transparent text-text-muted hover:bg-surface-md hover:border-border hover:text-text-primary transition-colors flex items-center justify-center mb-0.5"
            title="Attach file"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
            disabled={isStreaming}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={fileAccept}
            multiple
            onChange={handleFileChange}
          />

          <textarea
            ref={textareaRef}
            id="input"
            className="flex-1 bg-transparent border-none outline-none text-text-primary text-[14px] resize-none leading-relaxed placeholder:text-text-dim min-h-[36px] max-h-[180px] overflow-y-auto"
            placeholder="Message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            disabled={isStreaming}
            aria-label="Message input"
          />

          {isStreaming ? (
            <button
              className="send-btn stop shrink-0 mb-0.5"
              onClick={stopStreaming}
              aria-label="Stop generating"
              title="Stop generating"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" />
              </svg>
            </button>
          ) : (
            <button
              className={`send-btn shrink-0 mb-0.5 ${!canSend ? 'opacity-35 cursor-not-allowed' : ''}`}
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
              title="Send (Enter)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
