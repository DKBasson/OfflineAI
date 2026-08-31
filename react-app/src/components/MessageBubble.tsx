import { useEffect, useRef, useState } from 'react';
import type { Message, SearchResult } from '../types';
import { renderMarkdown, highlightCodeBlocks } from '../utils/markdown';
import { getProjectViewUrl, getProjectDownloadUrl } from '../utils/api';
import { useApp } from '../context/AppContext';

interface MessageBubbleProps {
  message: Message;
  index: number;
  isLast: boolean;
  onImageClick: (src: string) => void;
  onRegenerate?: () => void;
  onEdit?: (newContent: string) => void;
}

export function MessageBubble({
  message,
  index: _index,
  isLast,
  onImageClick,
  onRegenerate,
  onEdit,
}: MessageBubbleProps) {
  const { activeUsername } = useApp();

  if (message.role === 'user') {
    return (
      <UserBubble
        message={message}
        username={activeUsername}
        onImageClick={onImageClick}
        onEdit={onEdit}
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
  onEdit,
}: {
  message: Message;
  username: string;
  onImageClick: (src: string) => void;
  onEdit?: (newContent: string) => void;
}) {
  const initial = username ? username[0].toUpperCase() : 'U';
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);

  return (
    <div className="message user flex gap-3 mb-4 max-w-3xl self-end ml-auto flex-row-reverse items-start group" data-role="user">
      <div className="avatar mt-[1px]">{initial}</div>
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
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              className="w-full bg-surface border border-border rounded-sm px-2.5 py-2 text-[13px] text-text-primary outline-none focus:border-border-hi resize-y min-h-[60px]"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              autoFocus
            />
            <div className="flex gap-1.5">
              <button
                className="px-3 py-1 bg-accent text-[#07080f] text-[11px] font-semibold rounded-sm disabled:opacity-50"
                disabled={!editText.trim()}
                onClick={() => { setIsEditing(false); onEdit?.(editText.trim()); }}
              >
                Save &amp; Resend
              </button>
              <button
                className="px-3 py-1 bg-surface border border-border text-[11px] text-text-muted rounded-sm"
                onClick={() => { setIsEditing(false); setEditText(message.content); }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {message.content && (
              <div className="msg-text user-msg">{message.content}</div>
            )}
            <MessageActions
              content={message.content}
              onEdit={onEdit ? () => { setEditText(message.content); setIsEditing(true); } : undefined}
            />
          </>
        )}
        {message.timestamp && !isEditing && (
          <div className="text-[10px] text-text-dim mt-1 opacity-0 group-hover:opacity-60 transition-opacity">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
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
  const { activeProject } = useApp();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState('');

  useEffect(() => {
    if (!message.generatedImage && message.content) {
      let cleanContent = message.content;
      cleanContent = cleanContent.replace(/<<TOOL:\w+\([^>]*?\)>>/g, '');
      cleanContent = cleanContent.replace(/<<BUILD_TOOL:.+?>>/g, '');
      cleanContent = cleanContent.replace(/<｜tool▁calls▁begin｜>[\s\S]*?<｜tool▁calls▁end｜>/g, '');
      cleanContent = cleanContent.replace(/<｜tool▁outputs▁begin｜>[\s\S]*?<｜tool▁outputs▁end｜>/g, '');
      cleanContent = cleanContent.replace(/<\|tool_calls?\|>[\s\S]*?(?:<\|\/tool_calls?\|>|$)/g, '');
      cleanContent = cleanContent.replace(/<\|tool_outputs?\|>[\s\S]*?(?:<\|\/tool_outputs?\|>|$)/g, '');
      cleanContent = cleanContent.replace(/\n{3,}/g, '\n\n').trim();
      setRendered(renderMarkdown(cleanContent));
    }
  }, [message.content, message.generatedImage]);

  useEffect(() => {
    if (bodyRef.current && rendered) {
      highlightCodeBlocks(bodyRef.current);
    }
  }, [rendered]);

  return (
    <div className="message assistant flex gap-3 mb-4 max-w-3xl items-start group" data-role="assistant">
      <div className="avatar mt-[1px]">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2C12 7 17 12 22 12C17 12 12 17 12 22C12 17 7 12 2 12C7 12 12 7 12 2Z" />
        </svg>
      </div>
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
        {message.intent && (
          <div className="mt-3 flex items-center gap-1.5 text-[11px] select-none opacity-40 hover:opacity-75 transition-opacity cursor-default">
            <span className="text-text-dim">↳</span>
            <span className="font-mono text-accent">
              {message.intent === 'code' ? '</>' : message.intent === 'image' ? '◆' : message.intent === 'search' ? '🔍' : '◇'}
            </span>
            <span className="text-text-dim">
              {message.intent}
              {message.modelUsed && (
                <> &middot; <span className="font-mono text-text-primary opacity-70">{message.modelUsed}</span></>
              )}
            </span>
          </div>
        )}
        {message.searchResults && message.searchResults.length > 0 && (
          <SearchSources results={message.searchResults} />
        )}
        {message.generatedFiles && message.generatedFiles.length > 0 && activeProject && (
          <GeneratedFiles files={message.generatedFiles} projectId={activeProject.id} />
        )}
        <MessageActions
          content={message.content}
          showRegenerate={isLast && !!onRegenerate}
          onRegenerate={onRegenerate}
        />
        {(message.timestamp || message.tokens) && (
          <div className="text-[10px] text-text-dim mt-1 opacity-0 group-hover:opacity-60 transition-opacity flex gap-2">
            {message.timestamp && (
              <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            )}
            {message.tokens && message.tokens > 0 && (
              <span>{message.tokens} tokens</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageActions({
  content,
  showRegenerate = false,
  onRegenerate,
  onEdit,
}: {
  content: string;
  showRegenerate?: boolean;
  onRegenerate?: () => void;
  onEdit?: () => void;
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
      {onEdit && (
        <button className="msg-action-btn" onClick={onEdit} aria-label="Edit message">Edit</button>
      )}
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

function SearchSources({ results }: { results: SearchResult[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 border-t border-border/50 pt-2">
      <button
        className="flex items-center gap-1.5 text-[11px] text-text-dim hover:text-text-muted transition-colors cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label="Toggle search sources"
      >
        <span>🔍</span>
        <span>{results.length} web source{results.length !== 1 ? 's' : ''}</span>
        <span className="text-[9px]">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1.5">
          {results.map((r, i) => (
            <div key={i} className="text-[11px] leading-relaxed">
              <a
                href={r.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline font-medium"
              >
                {r.title}
              </a>
              <p className="text-text-dim mt-0.5 line-clamp-2">{r.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GeneratedFiles({ files, projectId }: { files: string[]; projectId: string }) {
  const unique = [...new Set(files)];
  const pdfs = unique.filter(f => f.endsWith('.pdf'));
  const others = unique.filter(f => !f.endsWith('.pdf'));

  if (pdfs.length === 0 && others.length === 0) return null;

  return (
    <div className="mt-2 border-t border-border/50 pt-2">
      <div className="text-[11px] text-text-dim mb-1.5">Generated files:</div>
      <div className="flex flex-wrap gap-1.5">
        {pdfs.map((f) => (
          <a
            key={f}
            href={getProjectViewUrl(projectId, f)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm text-[11px] font-medium bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
            title={`Open ${f}`}
          >
            <span>📕</span>
            <span>Open PDF</span>
            <span className="text-[9px] text-red-400/60 max-w-[100px] truncate">{f.split('/').pop()}</span>
          </a>
        ))}
        {others.map((f) => (
          <a
            key={f}
            href={getProjectDownloadUrl(projectId, f)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm text-[11px] font-medium bg-surface-md border border-border text-text-muted hover:bg-surface-hi transition-colors"
            title={`Download ${f}`}
            download
          >
            <span>📄</span>
            <span className="max-w-[120px] truncate">{f.split('/').pop()}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
