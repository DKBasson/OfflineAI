import { useEffect, useRef, useState } from 'react';
import type { Message } from '../types';
import { renderMarkdown, highlightCodeBlocks } from '../utils/markdown';
import { useApp } from '../context/AppContext';

interface MessageBubbleProps {
  message: Message;
  index: number;
  isLast: boolean;
  onImageClick: (src: string) => void;
  onRegenerate?: () => void;
}

export function MessageBubble({
  message,
  index: _index,
  isLast,
  onImageClick,
  onRegenerate,
}: MessageBubbleProps) {
  const { activeUsername } = useApp();

  if (message.role === 'user') {
    return (
      <UserBubble
        message={message}
        username={activeUsername}
        onImageClick={onImageClick}
      />
    );
  }

  return (
    <AssistantBubble
      message={message}
      isLast={isLast}
      onImageClick={onImageClick}
      onRegenerate={onRegenerate}
    />
  );
}

function UserBubble({
  message,
  username,
  onImageClick,
}: {
  message: Message;
  username: string;
  onImageClick: (src: string) => void;
}) {
  const initial = username ? username[0].toUpperCase() : 'U';

  return (
    <div className="message user flex gap-3 mb-4 max-w-3xl self-end ml-auto flex-row-reverse" data-role="user">
      <div className="avatar">{initial}</div>
      <div className="message-body flex-1 min-w-0">
        {message.images && message.images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {message.images.map((b64, i) => (
              <img
                key={i}
                src={`data:image/jpeg;base64,${b64}`}
                alt="attached image"
                className="max-h-48 rounded-sm cursor-pointer border border-border hover:opacity-90 transition-opacity"
                onClick={() => onImageClick(`data:image/jpeg;base64,${b64}`)}
              />
            ))}
          </div>
        )}
        {message.content && (
          <div className="msg-text user-msg">{message.content}</div>
        )}
        <MessageActions content={message.content} />
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  isLast,
  onImageClick,
  onRegenerate,
}: {
  message: Message;
  isLast: boolean;
  onImageClick: (src: string) => void;
  onRegenerate?: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState('');

  useEffect(() => {
    if (!message.generatedImage && message.content) {
      setRendered(renderMarkdown(message.content));
    }
  }, [message.content, message.generatedImage]);

  useEffect(() => {
    if (bodyRef.current && rendered) {
      highlightCodeBlocks(bodyRef.current);
    }
  }, [rendered]);

  return (
    <div className="message assistant flex gap-3 mb-4 max-w-3xl" data-role="assistant">
      <div className="avatar">⚡</div>
      <div className="message-body flex-1 min-w-0" ref={bodyRef}>
        {message.generatedImage ? (
          <>
            <div className="msg-generated-image mb-2">
              <img
                src={`data:image/png;base64,${message.generatedImage}`}
                alt={message.imagePrompt || 'Generated image'}
                className="max-w-full rounded-sm cursor-pointer border border-border hover:opacity-90 transition-opacity"
                onClick={() => onImageClick(`data:image/png;base64,${message.generatedImage!}`)}
              />
            </div>
            {message.content && (
              <div className="image-gen-caption text-text-muted text-[12px] mt-1">
                {message.content}
              </div>
            )}
          </>
        ) : (
          <div
            className="msg-text prose-msg"
            dangerouslySetInnerHTML={{ __html: rendered }}
          />
        )}
        <MessageActions
          content={message.content}
          showRegenerate={isLast && !!onRegenerate}
          onRegenerate={onRegenerate}
        />
      </div>
    </div>
  );
}

function MessageActions({
  content,
  showRegenerate = false,
  onRegenerate,
}: {
  content: string;
  showRegenerate?: boolean;
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyText() {
    navigator.clipboard.writeText(content || '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }

  return (
    <div className="message-actions flex gap-1.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        className="msg-action-btn"
        onClick={copyText}
        aria-label="Copy message"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      {showRegenerate && onRegenerate && (
        <button
          className="msg-action-btn regen-msg-btn"
          onClick={onRegenerate}
          aria-label="Regenerate response"
        >
          Regenerate
        </button>
      )}
    </div>
  );
}
