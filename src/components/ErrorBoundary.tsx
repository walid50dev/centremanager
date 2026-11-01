import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import i18n from '../i18n';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional label shown in the console to locate the failing screen. */
  scope?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Keeps a rendering error inside one screen.
 *
 * The SQLite data is untouched by a React crash, so the fallback only offers a
 * reload; the message itself is only shown in development, where it helps.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept on the console: the desktop build has no remote reporting.
    console.error(`[ErrorBoundary${this.props.scope ? ` · ${this.props.scope}` : ''}]`, error, info.componentStack);
  }

  private reload = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const t = i18n.t.bind(i18n);

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6" data-testid="error-boundary">
        <div className="w-full max-w-md rounded-lg border border-border bg-white p-6 text-center shadow-card">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-h2 text-foreground">{t('error.title')}</h1>
          <p className="mt-1 text-[13px] text-muted">{t('error.message')}</p>
          {import.meta.env.DEV ? (
            <pre
              className="mt-3 max-h-32 overflow-auto rounded-md bg-background px-3 py-2 text-start text-[11px] leading-5 text-destructive"
              data-testid="error-boundary-detail"
            >
              {error.message}
            </pre>
          ) : null}
          <button
            type="button"
            onClick={this.reload}
            data-testid="error-boundary-reload"
            className="btn btn-primary btn-press mx-auto mt-4 h-9 px-4"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t('error.reload')}
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
