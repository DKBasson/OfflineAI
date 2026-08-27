import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { MessageBubble } from './MessageBubble';
import { WelcomeScreen } from './WelcomeScreen';

export function ChatArea() {
  const {
    messages,
    isStreaming,
    streamingContent,
    streamingError,
    imageProgress,
    imageProgressLabel,
    regenerateLastResponse,
    openLightbox,
  } = useApp();

  const bottomRef = useRef<HTMLDivElement>(null);
  const [chatSearch, setChatSearch] = useState('');
  const [chatSearchOpen, setChatSearchOpen] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = /Mac/.test(navigator.userAgent) ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 'f' && messages.length > 0) {
        e.preventDefault();
        setChatSearchOpen(true);
      }
      if (e.key === 'Escape' && chatSearchOpen) {
        setChatSearchOpen(false);
        setChatSearch('');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [messages.length, chatSearchOpen]);

  useEffect(() => {
    setChatSearchOpen(false);
    setChatSearch('');
  }, [messages.length === 0]);

  const matchCount = chatSearch
    ? messages.filter(m => m.content.toLowerCase().includes(chatSearch.toLowerCase())).length
    : 0;

  const showWelcome = messages.length === 0 && !isStreaming;

  return (
    <main
      className="flex-1 overflow-y-auto px-4 py-4 flex flex-col"
      id="messages"
      aria-label="Chat messages"
    >
      {showWelcome ? (
        <WelcomeScreen />
      ) : (
        <>
          {chatSearchOpen && (
            <div className="sticky top-0 z-10 px-4 py-2 bg-bg/90 backdrop-blur-sm border-b border-border">
              <div className="flex items-center gap-2 max-w-3xl mx-auto">
                <input
                  type="search"
                  autoFocus
                  placeholder="Search in conversation…"
                  value={chatSearch}
                  onChange={(e) => setChatSearch(e.target.value)}
                  className="flex-1 bg-surface border border-border rounded-sm px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-border-hi placeholder:text-text-dim"
                />
                <span className="text-[11px] text-text-dim">
                  {chatSearch ? `${matchCount} match${matchCount !== 1 ? 'es' : ''}` : ''}
                </span>
                <button
                  className="text-text-dim hover:text-text-primary text-[13px]"
                  onClick={() => { setChatSearchOpen(false); setChatSearch(''); }}
                  aria-label="Close search"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={chatSearch && !msg.content.toLowerCase().includes(chatSearch.toLowerCase()) ? 'opacity-30 transition-opacity' : 'transition-opacity'}
            >
              <MessageBubble
              message={msg}
              index={idx}
              isLast={idx === messages.length - 1}
              onImageClick={openLightbox}
              onRegenerate={idx === messages.length - 1 && msg.role === 'assistant' && !isStreaming ? regenerateLastResponse : undefined}
            />
            </div>
          ))}

          {/* Streaming assistant bubble */}
          {isStreaming && (
            <div className="message assistant flex gap-3 mb-4 max-w-3xl items-start">
              <div className="avatar streaming mt-[1px]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C12 7 17 12 22 12C17 12 12 17 12 22C12 17 7 12 2 12C7 12 12 7 12 2Z" />
                </svg>
              </div>
              <div className="message-body flex-1 min-w-0">
                {imageProgress != null ? (
                  /* Image generation progress */
                  <div className="image-gen-progress">
                    <span className="image-gen-label text-text-muted text-[13px]">
                      {imageProgressLabel}
                    </span>
                    <div className="image-gen-bar-wrap mt-1.5 h-1 bg-surface-md rounded-full overflow-hidden w-full">
                      <div
                        className="image-gen-bar h-full bg-accent rounded-full transition-all duration-300"
                        style={{ width: `${imageProgress}%` }}
                      />
                    </div>
                  </div>
                ) : streamingContent ? (
                  <StreamingMessage content={streamingContent} />
                ) : (
                  /* Thinking dots */
                  <div className="thinking" aria-label="AI is thinking">
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Persistent error bubble after failed streaming */}
          {!isStreaming && streamingError && (
            <div className="message assistant flex gap-3 mb-4 max-w-3xl items-start">
              <div className="avatar mt-[1px]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C12 7 17 12 22 12C17 12 12 17 12 22C12 17 7 12 2 12C7 12 12 7 12 2Z" />
                </svg>
              </div>
              <div className="message-body flex-1 min-w-0">
                <div className="msg-text error">{streamingError}</div>
              </div>
            </div>
          )}

        </>
      )}
      <div ref={bottomRef} />
    </main>
  );
}

function StreamingMessage({ content }: { content: string }) {
  const lines = content.split('\n');
  const isProgress = lines.length > 1 && lines.some(l => l.startsWith('✔') || l.startsWith('📄') || l.startsWith('📋') || l.startsWith('🔍'));

  if (isProgress) {
    return (
      <div className="msg-text streaming space-y-1">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`text-[13px] ${
              line.startsWith('✔') ? 'text-green-400' :
              line.startsWith('📄') ? 'text-blue-400' :
              line.startsWith('📋') ? 'text-purple-400' :
              line.startsWith('🔍') ? 'text-yellow-400' :
              'text-text-muted'
            }`}
          >
            {line}
          </div>
        ))}
        <div className="thinking mt-1" aria-label="Working">
          <span /><span /><span />
        </div>
      </div>
    );
  }

  return (
    <div className="msg-text streaming prose-msg">
      {content}
    </div>
  );
}
