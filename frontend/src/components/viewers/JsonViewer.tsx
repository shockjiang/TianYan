import { useState, useEffect } from 'react';
import { JsonView, darkStyles, defaultStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';

interface JsonViewerProps {
  src: string;
  name: string;
  theme?: 'dark' | 'light';
}

export function JsonViewer({ src, name, theme = 'dark' }: JsonViewerProps) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(src)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
