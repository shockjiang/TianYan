import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props { children: ReactNode; resetKey?: string; }
interface State { hasError: boolean; error?: Error; resetKey?: string; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Auto-reset when resetKey changes (e.g., user selects a different file)
    if (props.resetKey !== undefined && props.resetKey !== state.resetKey) {
      return { hasError: false, error: undefined, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: 18, marginBottom: 12, color: '#ff6b6b' }}>Preview failed</div>
          <div style={{ fontSize: 13, marginBottom: 16, fontFamily: 'monospace', maxWidth: 600, margin: '0 auto 16px', wordBreak: 'break-word' }}>
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
