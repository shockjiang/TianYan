import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error?: Error; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: 18, marginBottom: 12, color: '#ff6b6b' }}>Something went wrong</div>
          <div style={{ fontSize: 13, marginBottom: 16, fontFamily: 'monospace', maxWidth: 600, margin: '0 auto' }}>
            {this.state.error?.message}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: undefined })}
            style={{ padding: '8px 16px', cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6 }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
