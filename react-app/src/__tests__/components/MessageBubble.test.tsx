import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../context/AppContext', () => ({
  useApp: vi.fn(),
}));

import { useApp } from '../../context/AppContext';
import { MessageBubble } from '../../components/MessageBubble';
import type { Message } from '../../types';

// Suppress act warnings for useEffect
vi.mock('../../utils/markdown', () => ({
  renderMarkdown: vi.fn((t: string) => `<p>${t}</p>`),
  highlightCodeBlocks: vi.fn(),
}));

function mockAppValue(overrides: Record<string, unknown> = {}) {
  return {
    activeUsername: 'Alice',
    ...overrides,
  };
}

function makeMsg(overrides: Partial<Message> = {}): Message {
  return { role: 'assistant', content: 'Hello world', ...overrides };
}

describe('MessageBubble', () => {
  const onImageClick = vi.fn();
  const onRegenerate = vi.fn();

  beforeEach(() => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockAppValue());
  });

  it('renders user message text', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'user', content: 'Hello!' })}
        index={0}
        isLast={true}
        onImageClick={onImageClick}
      />,
    );
    expect(screen.getByText('Hello!')).toBeInTheDocument();
  });

  it('renders user initial avatar from username', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'user', content: 'Hi' })}
        index={0}
        isLast={true}
        onImageClick={onImageClick}
      />,
    );
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('renders ⚡ avatar for assistant', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', content: 'Hi' })}
        index={0}
        isLast={true}
        onImageClick={onImageClick}
      />,
    );
    expect(screen.getByText('⚡')).toBeInTheDocument();
  });

  it('renders Copy button for messages', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', content: 'Hi' })}
        index={0}
        isLast={true}
        onImageClick={onImageClick}
      />,
    );
    expect(screen.getByRole('button', { name: /copy message/i })).toBeInTheDocument();
  });

  it('renders Regenerate button for last assistant message', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', content: 'Hi' })}
        index={0}
        isLast={true}
        onImageClick={onImageClick}
        onRegenerate={onRegenerate}
      />,
    );
    expect(screen.getByRole('button', { name: /regenerate response/i })).toBeInTheDocument();
  });

  it('does not render Regenerate for non-last message', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', content: 'Hi' })}
        index={0}
        isLast={false}
        onImageClick={onImageClick}
        onRegenerate={onRegenerate}
      />,
    );
    expect(screen.queryByRole('button', { name: /regenerate response/i })).not.toBeInTheDocument();
  });

  it('calls onRegenerate when Regenerate button clicked', async () => {
    const user = userEvent.setup();
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', content: 'Hi' })}
        index={0}
        isLast={true}
        onImageClick={onImageClick}
        onRegenerate={onRegenerate}
      />,
    );
    await user.click(screen.getByRole('button', { name: /regenerate response/i }));
    expect(onRegenerate).toHaveBeenCalled();
  });

  it('renders generated image when message has generatedImage', () => {
    render(
      <MessageBubble
        message={makeMsg({
          role: 'assistant',
          generatedImage: 'base64data',
          content: 'Prompt: a cat',
          imagePrompt: 'a cat',
        })}
        index={0}
        isLast={true}
        onImageClick={onImageClick}
      />,
    );
    const img = screen.getByRole('img', { name: 'a cat' });
    expect(img).toHaveAttribute('src', 'data:image/png;base64,base64data');
  });

  it('calls onImageClick when generated image is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MessageBubble
        message={makeMsg({
          role: 'assistant',
          generatedImage: 'abc123',
          content: 'Prompt: a dog',
          imagePrompt: 'a dog',
        })}
        index={0}
        isLast={true}
        onImageClick={onImageClick}
      />,
    );
    await user.click(screen.getByRole('img'));
    expect(onImageClick).toHaveBeenCalledWith('data:image/png;base64,abc123');
  });
});
