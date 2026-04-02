import { useState, useEffect } from 'react';
import { JsonView, darkStyles, defaultStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';

interface JsonViewerProps {
  src: string;
  name: string;
  theme?: 'dark' | 'light';
}

const MAX_TEXT_SIZE = 10 * 1024 * 1024; // 10MB

export function JsonViewer({ src, name, theme = 'dark' }: JsonViewerProps) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(src)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const size = parseInt(res.headers.get('content-length') || '0');
        if (size > MAX_TEXT_SIZE) throw new Error(`File too large to preview (${(size / 1024 / 1024).toFixed(1)} MB). Max: 10 MB`);
        return res.json();
      })
      .then(setData)
      .catch(e => setError(e.message));
  }, [src]);

  if (error) return <div style={{ padding: 24, color: '#f44' }}>Error: {error}</div>;
  if (data === null) return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading...</div>;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <JsonView data={data} style={theme === 'dark' ? darkStyles : defaultStyles} />
    </div>
  );
}
