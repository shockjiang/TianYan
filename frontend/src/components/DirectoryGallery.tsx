import type { FileNode } from '../types';

interface DirectoryGalleryProps {
  node: FileNode;
  apiBase: string;
  onFileSelect: (node: FileNode) => void;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp']);

export function DirectoryGallery({ node, apiBase, onFileSelect }: DirectoryGalleryProps) {
  const files = (node.children || []).filter(c => c.type === 'file');
  const imageFiles = files.filter(f => f.extension && IMAGE_EXTS.has(f.extension));
  const otherFiles = files.filter(f => !f.extension || !IMAGE_EXTS.has(f.extension));

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
        {node.name} ({files.length} files)
      </div>
      {imageFiles.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Images ({imageFiles.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginBottom: 16 }}>
            {imageFiles.map(f => (
              <div
                key={f.path}
                onClick={() => onFileSelect(f)}
                style={{
                  cursor: 'pointer',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  overflow: 'hidden',
                  background: 'var(--bg-primary)',
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
              >
                <img
                  src={`${apiBase}/api/thumbnail?path=${encodeURIComponent(f.path)}&size=120`}
                  alt={f.name}
                  style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }}
                  loading="lazy"
                />
                <div style={{ padding: '4px 6px', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                  {f.name}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {otherFiles.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Other Files ({otherFiles.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {otherFiles.map(f => (
              <div
                key={f.path}
                onClick={() => onFileSelect(f)}
                style={{
                  padding: '6px 10px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  background: 'var(--bg-secondary)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--hover-bg)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
              >
                {f.name}
                {f.size != null && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                    ({(f.size / 1024).toFixed(1)} KB)
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {files.length === 0 && (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Empty directory</div>
      )}
    </div>
  );
}
