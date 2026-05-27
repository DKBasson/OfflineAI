import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../context/AppContext', () => ({
  useApp: vi.fn(),
}));
vi.mock('../../utils/storage', () => ({
  loadSystemPrompts: vi.fn(() => []),
}));

import { useApp } from '../../context/AppContext';
import { MessageInput } from '../../components/MessageInput';

function mockAppValue(overrides: Record<string, unknown> = {}) {
  return {
    isStreaming: false,
    pendingImages: [],
    pendingFiles: [],
    pendingAudio: [],
    sendMessage: vi.fn(),
    stopStreaming: vi.fn(),
    addFiles: vi.fn(),
    removePendingImage: vi.fn(),
    removePendingFile: vi.fn(),
    removePendingAudio: vi.fn(),
    activeModel: 'gemma4:e4b',
    currentSystemPromptId: '',
    setSystemPromptById: vi.fn(),
    ...overrides,
  };
}

// Mock the dynamic import in MessageInput
vi.mock('../../utils/api', () => ({
  fetchModelCap: vi.fn().mockResolvedValue({ vision: false }),
}));

describe('MessageInput', () => {
  beforeEach(() => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockAppValue());
  });

  it('renders textarea and send button', () => {
    render(<MessageInput />);
    expect(screen.getByRole('textbox', { name: /message input/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument();
  });

  it('send button is disabled when input is empty', () => {
    render(<MessageInput />);
    expect(screen.getByRole('button', { name: /send message/i })).toBeDisabled();
  });

  it('send button becomes enabled after typing', async () => {
    const user = userEvent.setup();
    render(<MessageInput />);
    await user.type(screen.getByRole('textbox', { name: /message input/i }), 'Hello');
    expect(screen.getByRole('button', { name: /send message/i })).not.toBeDisabled();
  });

  it('calls sendMessage and clears input on send button click', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockAppValue({ sendMessage }));

    render(<MessageInput />);
    const textarea = screen.getByRole('textbox', { name: /message input/i });
    await user.type(textarea, 'Hello world');
    await user.click(screen.getByRole('button', { name: /send message/i }));

    expect(sendMessage).toHaveBeenCalledWith('Hello world');
  });

  it('calls sendMessage on Enter key (not Shift+Enter)', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockAppValue({ sendMessage }));

    render(<MessageInput />);
    const textarea = screen.getByRole('textbox', { name: /message input/i });
    await user.type(textarea, 'test{Enter}');
    expect(sendMessage).toHaveBeenCalledWith('test');
  });

  it('does NOT send on Shift+Enter (should add newline)', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockAppValue({ sendMessage }));

    render(<MessageInput />);
    const textarea = screen.getByRole('textbox', { name: /message input/i });
    await user.type(textarea, 'line1');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('disables textarea while streaming', () => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockAppValue({ isStreaming: true }));
    render(<MessageInput />);
    expect(screen.getByRole('textbox', { name: /message input/i })).toBeDisabled();
  });

  it('shows stop button while streaming', () => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockAppValue({ isStreaming: true }));
    render(<MessageInput />);
    expect(screen.getByRole('button', { name: /stop generating/i })).toBeInTheDocument();
  });

  it('calls stopStreaming when stop button clicked', async () => {
    const user = userEvent.setup();
    const stopStreaming = vi.fn();
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(
      mockAppValue({ isStreaming: true, stopStreaming }),
    );
    render(<MessageInput />);
    await user.click(screen.getByRole('button', { name: /stop generating/i }));
    expect(stopStreaming).toHaveBeenCalled();
  });

  it('renders image previews for pending images', () => {
    const pendingImages = [{ dataUrl: 'data:image/png;base64,abc', base64: 'abc' }];
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockAppValue({ pendingImages }));
    render(<MessageInput />);
    const img = screen.getByAltText('preview');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc');
  });

  it('renders file chips for pending files', () => {
    const pendingFiles = [{ name: 'document.pdf', file: new File([], 'document.pdf') }];
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockAppValue({ pendingFiles }));
    render(<MessageInput />);
    expect(screen.getByText('document.pdf')).toBeInTheDocument();
  });

  it('calls removePendingImage when image remove button clicked', async () => {
    const user = userEvent.setup();
    const removePendingImage = vi.fn();
    const pendingImages = [{ dataUrl: 'data:image/png;base64,abc', base64: 'abc' }];
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(
      mockAppValue({ pendingImages, removePendingImage }),
    );
    render(<MessageInput />);
    await user.click(screen.getByRole('button', { name: /remove image/i }));
    expect(removePendingImage).toHaveBeenCalledWith(0);
  });
});
