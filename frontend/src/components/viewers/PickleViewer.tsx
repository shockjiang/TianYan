import { useEffect, useState } from 'react';
import { JsonView, defaultStyles, darkStyles } from 'react-json-view-lite';
import { useTheme } from '../../hooks/useTheme';

interface PickleViewerProps {
  path: string;
  name: string;
  apiBase: string;
}

interface PickleResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
  error_type?: string;
  source_type?: string;
  warnings?: string[] | null;
}

export function PickleViewer({ path, name: _name, apiBase }: PickleViewerProps) {
  const [resp, setResp] = useState<PickleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme] = useTheme();

  useEffect(() => {
    setLoading(true);
    setResp(null);
    fetch(`${apiBase}/api/pickle?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then(setResp)
      .catch((e) => setResp({ ok: false, error: String(e) }))
      .finally(() => setLoading(false));
  }, [path, apiBase]);

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading pickle...</div>;
  }

  if (!resp || !resp.ok) {
    return (
      <div style={{ padding: 24, color: '#ff6b6b' }}>
        Failed to read pickle: {resp?.error || 'unknown error'}
      </div>
    );
  }

  const styles = theme === 'dark' ? darkStyles : defaultStyles;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
      {resp.warnings && resp.warnings.length > 0 && (
        <div style={{
          background: 'rgba(255, 200, 0, 0.1)', border: '1px solid rgba(255, 200, 0, 0.3)',
          padding: 8, borderRadius: 4, marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)',
        }}>
          {resp.warnings.length} warning(s): {resp.warnings.slice(0, 3).join('; ')}
          {resp.warnings.length > 3 && ` (+${resp.warnings.length - 3} more)`}
        </div>
      )}
      <JsonView data={resp.data as object} style={styles} shouldExpandNode={(level) => level < 2} />
    </div>
  );
}
