import type { FileNode } from '../types';
import { IMAGE_EXTS, VIDEO_EXTS } from '../constants';

interface DirectoryGalleryProps {
  node: FileNode;
  apiBase: string;
  autoplay?: boolean;
  onFileSelect: (node: FileNode) => void;
}

export function DirectoryGallery({ node, apiBase, autoplay = false, onFileSelect }: DirectoryGalleryProps) {
  // Only direct children files (exclude sub-directory contents)
  const files = (node.children || []).filter(c => c.type === 'file');
  const dirs = (node.children || []).filter(c => c.type === 'directory');
  const imageFiles = files.filter(f => f.extension && IMAGE_EXTS.has(f.extension));
  const videoFiles = files.filter(f => f.extension && VIDEO_EXTS.has(f.extension));
  const otherFiles = files.filter(f => !f.extension || (!IMAGE_EXTS.has(f.extension) && !VIDEO_EXTS.has(f.extension)));

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
        {node.name} ({files.length} files{dirs.length > 0 ? `, ${dirs.length} folders` : ''})
      </div>

      {/* Images grid */}
      {imageFiles.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Images ({imageFiles.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 16 }}>
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
                  src={`${apiBase}/api/thumbnail?path=${encodeURIComponent(f.path)}&size=160`}
                  alt={f.name}
                  style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }}
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

      {/* Videos inline */}
      {videoFiles.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Videos ({videoFiles.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            {videoFiles.map(f => (
              <div key={f.path} style={{ border: '1px solid var(--border-color)', borderRadius: 6, overflow: 'hidden', background: '#000' }}>
                <video
                  controls
                  autoPlay={autoplay}
                  muted={autoplay}
                  style={{ width: '100%', maxHeight: 360, display: 'block' }}
                  key={f.path}
                >
                  <source src={`${apiBase}/api/file?path=${encodeURIComponent(f.path)}`} />
                </video>
                <div
                  onClick={() => onFileSelect(f)}
                  style={{ padding: '6px 10px', fontSize: 12, color: 'var(--accent)', cursor: 'pointer', background: 'var(--bg-secondary)' }}
                >
                  {f.name}
                  {f.size != null && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                      ({(f.size / 1024 / 1024).toFixed(1)} MB)
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Sub-directories */}
      {dirs.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Folders ({dirs.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {dirs.map(d => (
              <div
                key={d.path}
                onClick={() => onFileSelect(d)}
                style={{
                  padding: '8px 14px',
                  cursor: 'pointer',
                  borderRadius: 6,
                  fontSize: 13,
                  color: '#f0c040',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
              >
                📁 {d.name}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Other files */}
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

      {files.length === 0 && dirs.length === 0 && (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Empty directory</div>
      )}
    </div>
  );
}
