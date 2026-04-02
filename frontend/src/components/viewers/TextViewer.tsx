import { useState, useEffect } from 'react';

interface TextViewerProps {
  src: string;
  name: string;
}

export function TextViewer({ src, name }: TextViewerProps) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(src)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(setText)
      .catch(e => setError(e.message));
  }, [src]);

  if (error) return <div style={{ padding: 24, color: '#f44' }}>Error: {error}</div>;
  if (text === null) return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading...</div>;

  const lines = text.split('\n');

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <pre style={{ margin: 0, fontFamily: "'Fira Code', 'Cascadia Code', monospace", fontSize: 13, lineHeight: 1.5 }}>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex' }}>
            <span style={{ color: 'var(--text-secondary)', minWidth: 50, textAlign: 'right', paddingRight: 16, userSelect: 'none', opacity: 0.5 }}>
              {i + 1}
            </span>
            <span>{line}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
