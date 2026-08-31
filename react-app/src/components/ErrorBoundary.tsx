import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackMessage?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React error boundary that catches render errors without crashing the whole app.
 * Shows a recovery UI with a "Reload" button.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  handleFullReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center p-8 text-center gap-4"
          role="alert"
          aria-live="assertive"
        >
          <div className="text-4xl">⚠️</div>
          <h2 className="text-lg font-semibold text-text-primary">
            {this.props.fallbackMessage || 'Something went wrong'}
          </h2>
          <p className="text-sm text-text-secondary max-w-md">
            {this.state.error?.message || 'An unexpected error occurred. Your data is safe.'}
          </p>
          <div className="flex gap-3 mt-2">
            <button
              onClick={this.handleReload}
              className="px-4 py-2 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors text-sm"
            >
              Try Again
            </button>
            <button
              onClick={this.handleFullReload}
              className="px-4 py-2 rounded-lg bg-surface-2 text-text-secondary hover:bg-surface-3 transition-colors text-sm"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
