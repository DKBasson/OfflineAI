import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NameModal } from '../../components/NameModal';
import { WelcomeScreen } from '../../components/WelcomeScreen';
import { ShortcutsModal } from '../../components/ShortcutsModal';

// Minimal mock context
function mockContextValue(overrides: Record<string, unknown> = {}) {
  return {
    isNameModalOpen: true,
    submitName: vi.fn(),
    activeUsername: '',
    activeModel: 'gemma4:e4b',
    isShortcutsOpen: false,
    setShortcutsOpen: vi.fn(),
    ...overrides,
  };
}

// Wrap component with context mock
vi.mock('../../context/AppContext', () => ({
  useApp: vi.fn(),
}));

import { useApp } from '../../context/AppContext';

describe('NameModal', () => {
  beforeEach(() => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockContextValue());
  });

  it('renders welcome message and input when open', () => {
    render(<NameModal />);
    expect(screen.getByText('Welcome to OfflineAI')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Your name…')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockContextValue({ isNameModalOpen: false }));
    const { container } = render(<NameModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it('calls submitName with trimmed input on button click', async () => {
    const user = userEvent.setup();
    const submitName = vi.fn();
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockContextValue({ submitName }));

    render(<NameModal />);
    await user.type(screen.getByPlaceholderText('Your name…'), 'Alice');
    await user.click(screen.getByRole('button', { name: /get started/i }));
    expect(submitName).toHaveBeenCalledWith('Alice');
  });

  it('calls submitName on Enter key press', async () => {
    const user = userEvent.setup();
    const submitName = vi.fn();
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockContextValue({ submitName }));

    render(<NameModal />);
    const input = screen.getByPlaceholderText('Your name…');
    await user.type(input, 'Bob{Enter}');
    expect(submitName).toHaveBeenCalledWith('Bob');
  });

  it('does not call submitName with empty input', async () => {
    const user = userEvent.setup();
    const submitName = vi.fn();
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockContextValue({ submitName }));

    render(<NameModal />);
    await user.click(screen.getByRole('button', { name: /get started/i }));
    expect(submitName).not.toHaveBeenCalled();
  });
});

describe('WelcomeScreen', () => {
  it('shows generic greeting when no username', () => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockContextValue({ activeUsername: '' }));
    render(<WelcomeScreen />);
    expect(screen.getByText('OfflineAI')).toBeInTheDocument();
  });

  it('shows personalised greeting when username provided', () => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockContextValue({ activeUsername: 'Alice' }));
    render(<WelcomeScreen />);
    expect(screen.getByText('Hello, Alice')).toBeInTheDocument();
  });

  it('shows active model name', () => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockContextValue({ activeModel: 'llama3:8b', activeUsername: '' }));
    render(<WelcomeScreen />);
    expect(screen.getByText('llama3:8b')).toBeInTheDocument();
  });
});

describe('ShortcutsModal', () => {
  it('renders nothing when closed', () => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockContextValue({ isShortcutsOpen: false }));
    const { container } = render(<ShortcutsModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders shortcuts table when open', () => {
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(mockContextValue({ isShortcutsOpen: true }));
    render(<ShortcutsModal />);
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
    expect(screen.getByText('New chat')).toBeInTheDocument();
  });

  it('calls setShortcutsOpen(false) when close button clicked', async () => {
    const user = userEvent.setup();
    const setShortcutsOpen = vi.fn();
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue(
      mockContextValue({ isShortcutsOpen: true, setShortcutsOpen }),
    );
    render(<ShortcutsModal />);
    await user.click(screen.getByRole('button', { name: /close shortcuts/i }));
    expect(setShortcutsOpen).toHaveBeenCalledWith(false);
  });
});
