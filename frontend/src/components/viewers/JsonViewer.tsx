import { useState, useEffect, useMemo } from 'react';
import { JsonView, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';

interface JsonViewerProps {
  src: string;
  name: string;
  theme?: 'dark' | 'light';
}

const MAX_TEXT_SIZE = 10 * 1024 * 1024; // 10MB
// Threshold: parse JSON interactively only for files <= this size
const INTERACTIVE_THRESHOLD = 500 * 1024; // 500KB

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface PreviewData {
  total_lines: number;
  head: string[];
  tail: string[];
  gap: number;
  full: boolean;
  file_size: number;
}

export function JsonViewer({ src, name }: JsonViewerProps) {
  const [data, setData] = useState<any>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);

  const filePath = useMemo(() => {
    try {
      const url = new URL(src, window.location.origin);
      return url.searchParams.get('path') || '';
    } catch {
      return '';
    }
  }, [src]);

  useEffect(() => {
    setData(null);
    setPreview(null);
    setError(null);

    // First, get preview to check file size
    if (!filePath) return;
    fetch(`/api/text-preview?path=${encodeURIComponent(filePath)}&head_n=10&tail_n=10`)
      .then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d.detail); }))
      .then((p: PreviewData) => {
        setPreview(p);
        // Small file: load and parse JSON interactively
        if (p.file_size <= INTERACTIVE_THRESHOLD) {
          return fetch(src)
            .then(r => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              return r.json();
            })
            .then(setData);
        }
      })
      .catch(e => setError(e.message));
  }, [src, filePath]);

  const loadFull = () => {
    if (loadingFull || data !== null) return;
    setLoadingFull(true);
    fetch(src)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const size = parseInt(res.headers.get('content-length') || '0');
        if (size > MAX_TEXT_SIZE) throw new Error(`File too large (${formatSize(size)})`);
        return res.json();
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoadingFull(false));
  };

  if (error) return <div style={{ padding: 24, color: '#f44' }}>Error: {error}</div>;
  if (!preview) return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading...</div>;

  // Interactive JSON tree view for small/loaded files
  if (data !== null) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '4px 16px', fontSize: 12, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{formatSize(preview.file_size)}</span>
          <span style={{ marginLeft: 12, color: 'var(--accent)' }}>interactive</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <JsonView data={data} style={darkStyles} />
        </div>
      </div>
    );
  }

  // Large file: show head/tail text preview
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 12,
        fontSize: 12, color: 'var(--text-secondary)',
        borderBottom: '1px solid var(--border-color)', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {preview.total_lines.toLocaleString()} lines
        </span>
        <span>{formatSize(preview.file_size)}</span>
        <span>showing first 10 + last 10</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ borderLeft: '3px solid var(--accent)' }}>
          {preview.head.map((line, i) => (
            <div key={`h${i}`} style={{ display: 'flex', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }}>
              <span style={{ width: 55, minWidth: 55, textAlign: 'right', paddingRight: 12, color: 'var(--text-secondary)', fontSize: 11, userSelect: 'none', opacity: 0.5 }}>{i + 1}</span>
              <span style={{ whiteSpace: 'pre', color: '#9cdcfe' }}>{line}</span>
            </div>
          ))}
        </div>
        {preview.gap > 0 && (
          <div
            onClick={loadFull}
            style={{
              padding: '10px 16px', textAlign: 'center', color: 'var(--accent)',
              background: 'var(--bg-secondary)', cursor: loadingFull ? 'wait' : 'pointer', fontSize: 12,
              borderTop: '1px dashed var(--border-color)', borderBottom: '1px dashed var(--border-color)',
            }}
          >
            {loadingFull
              ? 'Loading & parsing JSON...'
              : `... ${preview.gap.toLocaleString()} lines hidden — click to load interactive view (${formatSize(preview.file_size)})`}
          </div>
        )}
        {preview.tail.length > 0 && (
          <div style={{ borderLeft: '3px solid #ce93d8' }}>
            {preview.tail.map((line, i) => {
              const lineNum = preview.total_lines - preview.tail.length + i + 1;
              return (
                <div key={`t${i}`} style={{ display: 'flex', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }}>
                  <span style={{ width: 55, minWidth: 55, textAlign: 'right', paddingRight: 12, color: 'var(--text-secondary)', fontSize: 11, userSelect: 'none', opacity: 0.5 }}>{lineNum}</span>
                  <span style={{ whiteSpace: 'pre', color: '#9cdcfe' }}>{line}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
