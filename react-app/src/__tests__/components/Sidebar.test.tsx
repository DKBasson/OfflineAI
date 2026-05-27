import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../context/AppContext', () => ({
  useApp: vi.fn(),
}));

import { useApp } from '../../context/AppContext';
import { Sidebar } from '../../components/Sidebar';
import type { Conversation } from '../../types';

function makeConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: '1',
    title: 'Test conversation',
    timestamp: Date.now() - 1000 * 60 * 60, // 1 hour ago
    model: 'llama3',
    messages: [],
    ...overrides,
  };
}

function mockAppValue(overrides: Record<string, unknown> = {}) {
  return {
    isSidebarOpen: true,
    closeSidebar: vi.fn(),
    history: [],
    historySearchTerm: '',
    setHistorySearchTerm: vi.fn(),
    currentConvId: null,
    loadConversation: vi.fn(),
    deleteConversation: vi.fn(),
    startNewChat: vi.fn(),
    isStreaming: false,
    ...overrides,
  };
}

describe('Sidebar', () => {
  beforeEach(() => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockAppValue());
  });

  it('renders navigation landmark when open', () => {
    render(<Sidebar />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('hides panel when closed (translate-x-full)', () => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockAppValue({ isSidebarOpen: false }));
    render(<Sidebar />);
    const aside = screen.getByRole('navigation');
    expect(aside.className).toContain('-translate-x-full');
  });

  it('shows history entries', () => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(
      mockAppValue({
        history: [
          makeConv({ id: '1', title: 'First chat' }),
          makeConv({ id: '2', title: 'Second chat' }),
        ],
      }),
    );
    render(<Sidebar />);
    expect(screen.getByText('First chat')).toBeInTheDocument();
    expect(screen.getByText('Second chat')).toBeInTheDocument();
  });

  it('shows empty state when no history', () => {
    render(<Sidebar />);
    expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument();
  });

  it('calls loadConversation when history item is clicked', async () => {
    const user = userEvent.setup();
    const loadConversation = vi.fn();
    const conv = makeConv({ id: '1', title: 'My Chat' });
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(
      mockAppValue({ history: [conv], loadConversation }),
    );
    render(<Sidebar />);
    await user.click(screen.getByText('My Chat'));
    expect(loadConversation).toHaveBeenCalledWith(conv);
  });

  it('calls deleteConversation when delete button clicked', async () => {
    const user = userEvent.setup();
    const deleteConversation = vi.fn();
    const conv = makeConv({ id: '42', title: 'To delete' });
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(
      mockAppValue({ history: [conv], deleteConversation }),
    );
    render(<Sidebar />);
    await user.click(screen.getByRole('button', { name: /delete conversation/i }));
    expect(deleteConversation).toHaveBeenCalledWith('42');
  });

  it('calls closeSidebar when overlay is clicked', async () => {
    const user = userEvent.setup();
    const closeSidebar = vi.fn();
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockAppValue({ closeSidebar }));
    render(<Sidebar />);
    // The overlay div is before the aside
    const overlay = document.querySelector('[aria-hidden="true"]');
    if (overlay) await user.click(overlay as HTMLElement);
    expect(closeSidebar).toHaveBeenCalled();
  });

  it('filters history by search term', () => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(
      mockAppValue({
        history: [
          makeConv({ id: '1', title: 'Python basics' }),
          makeConv({ id: '2', title: 'JavaScript tips' }),
        ],
        historySearchTerm: 'python',
      }),
    );
    render(<Sidebar />);
    expect(screen.getByText('Python basics')).toBeInTheDocument();
    expect(screen.queryByText('JavaScript tips')).not.toBeInTheDocument();
  });

  it('shows no matches message when filtered result is empty', () => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(
      mockAppValue({
        history: [makeConv({ id: '1', title: 'Python basics' })],
        historySearchTerm: 'xyz',
      }),
    );
    render(<Sidebar />);
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
});
