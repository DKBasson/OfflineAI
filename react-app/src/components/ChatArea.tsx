import { useEffect, useRef } from 'react';
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

  // Scroll to bottom on new messages/streaming content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

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
          {messages.map((msg, idx) => (
            <MessageBubble
              key={idx}
              message={msg}
              index={idx}
              isLast={idx === messages.length - 1}
              onImageClick={openLightbox}
              onRegenerate={idx === messages.length - 1 && msg.role === 'assistant' && !isStreaming ? regenerateLastResponse : undefined}
            />
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
  return (
    <div className="msg-text streaming prose-msg">
      {content}
    </div>
  );
}
