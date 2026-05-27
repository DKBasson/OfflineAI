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
    stopStreaming,
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
            <div className="message assistant flex gap-3 mb-4 max-w-3xl">
              <div className="avatar streaming">⚡</div>
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
                ) : streamingError ? (
                  <p className="text-err-text text-[14px]">{streamingError}</p>
                ) : (
                  /* Thinking dots */
                  <div className="thinking" aria-label="AI is thinking">
                    <span />
                    <span />
                    <span />
                  </div>
                )}
                {streamingError && (
                  <p className="text-err-text text-[14px] mt-1">{streamingError}</p>
                )}
              </div>
            </div>
          )}

          {/* Stop streaming button */}
          {isStreaming && (
            <div className="flex justify-center mt-2 mb-4">
              <button
                className="px-4 py-1.5 bg-surface-md border border-border rounded-full text-text-muted text-[13px] hover:bg-surface-hi hover:text-text-primary transition-colors"
                onClick={stopStreaming}
              >
                Stop generating
              </button>
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
