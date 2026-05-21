interface HtmlViewerProps {
  path: string;
  name: string;
  apiBase: string;
}

/** Build /api/raw/<encoded-but-slash-preserving absolute path>. */
function rawUrl(apiBase: string, absolutePath: string): string {
  const enc = absolutePath.split('/').map(encodeURIComponent).join('/');
  return `${apiBase}/api/raw${enc}`;
}

export function HtmlViewer({ path, name, apiBase }: HtmlViewerProps) {
  const src = rawUrl(apiBase, path);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '4px 12px',
        fontSize: 11,
        color: 'var(--text-secondary)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <span>Rendered HTML — relative assets resolve via /api/raw</span>
        <a href={src} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto' }}>
          Open in new tab
        </a>
      </div>
      <iframe
        title={name}
        src={src}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
      />
    </div>
  );
}
