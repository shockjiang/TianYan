import { useState } from 'react';
import type { FileNode } from '../types';
import { IMAGE_EXTS, VIDEO_EXTS } from '../constants';

interface DirectoryGalleryProps {
  node: FileNode;
  apiBase: string;
  autoplay?: boolean;
  gridScale?: number;
  onFileSelect: (node: FileNode) => void;
}

const DEFAULT_PREVIEW = 10;

/** Return head + tail slice of an array, with gap info. */
function headTail<T>(arr: T[], n: number): { head: T[]; tail: T[]; total: number; gap: number } {
  if (arr.length <= n * 2) return { head: arr, tail: [], total: arr.length, gap: 0 };
  return {
    head: arr.slice(0, n),
    tail: arr.slice(-n),
    total: arr.length,
    gap: arr.length - n * 2,
  };
}

function GapIndicator({ gap, total, expanded, onToggle }: { gap: number; total: number; expanded: boolean; onToggle: () => void }) {
  if (gap <= 0) return null;
  return (
    <div
      onClick={onToggle}
      style={{
        gridColumn: '1 / -1',
        padding: '8px 16px',
        textAlign: 'center',
        color: 'var(--accent)',
        background: 'var(--bg-secondary)',
        borderRadius: 6,
        fontSize: 12,
        cursor: 'pointer',
        border: '1px dashed var(--border-color)',
      }}
    >
      {expanded
        ? 'Show less'
        : `... ${gap} more items hidden (${total} total) — click to show all`}
    </div>
  );
}

export function DirectoryGallery({ node, apiBase, autoplay = false, gridScale = 0.3, onFileSelect }: DirectoryGalleryProps) {
  const files = (node.children || []).filter(c => c.type === 'file');
  const dirs = (node.children || []).filter(c => c.type === 'directory');
  const imageFiles = files.filter(f => f.extension && IMAGE_EXTS.has(f.extension));
  const videoFiles = files.filter(f => f.extension && VIDEO_EXTS.has(f.extension));
  const otherFiles = files.filter(f => !f.extension || (!IMAGE_EXTS.has(f.extension) && !VIDEO_EXTS.has(f.extension)));

  const [showAllImages, setShowAllImages] = useState(false);
  const [showAllVideos, setShowAllVideos] = useState(false);
  const [showAllOther, setShowAllOther] = useState(false);
  const [showAllDirs, setShowAllDirs] = useState(false);

  const images = showAllImages ? { head: imageFiles, tail: [] as FileNode[], total: imageFiles.length, gap: 0 } : headTail(imageFiles, DEFAULT_PREVIEW);
  const videos = showAllVideos ? { head: videoFiles, tail: [] as FileNode[], total: videoFiles.length, gap: 0 } : headTail(videoFiles, DEFAULT_PREVIEW);
  const others = showAllOther ? { head: otherFiles, tail: [] as FileNode[], total: otherFiles.length, gap: 0 } : headTail(otherFiles, DEFAULT_PREVIEW);
  const dirSlice = showAllDirs ? { head: dirs, tail: [] as FileNode[], total: dirs.length, gap: 0 } : headTail(dirs, DEFAULT_PREVIEW);

  const displayImages = [...images.head, ...images.tail];
  const displayVideos = [...videos.head, ...videos.tail];

  const hasMultipleMedia = displayImages.length + displayVideos.length > 1;
  const gridColTemplate = hasMultipleMedia
    ? `repeat(auto-fill, minmax(${Math.round(gridScale * 100)}%, 1fr))`
    : '1fr';

  const renderImageCard = (f: FileNode) => (
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
        src={`${apiBase}/api/thumbnail?path=${encodeURIComponent(f.path)}&size=400`}
        alt={f.name}
        style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }}
        loading="lazy"
      />
      <div style={{ padding: '4px 6px', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
        {f.name}
      </div>
    </div>
  );

  const renderVideoCard = (f: FileNode) => (
    <div
      key={f.path}
      onClick={() => onFileSelect(f)}
      style={{
        cursor: 'pointer',
        border: '1px solid var(--border-color)',
        borderRadius: 6,
        overflow: 'hidden',
        background: '#000',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
    >
      <video
        controls
        autoPlay={autoplay}
        muted={autoplay}
        style={{ width: '100%', aspectRatio: '16/9', objectFit: 'contain', display: 'block' }}
        key={f.path}
      >
        <source src={`${apiBase}/api/video?path=${encodeURIComponent(f.path)}`} />
      </video>
      <div style={{ padding: '4px 6px', fontSize: 11, color: 'var(--accent)', cursor: 'pointer', background: 'var(--bg-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {f.name}
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
        {node.name} ({files.length} files{dirs.length > 0 ? `, ${dirs.length} folders` : ''})
      </div>

      {/* Media grid (images + videos together) */}
      {(imageFiles.length > 0 || videoFiles.length > 0) && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Media ({imageFiles.length + videoFiles.length})
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: gridColTemplate,
            gap: 8,
            marginBottom: 16,
          }}>
            {images.head.map(renderImageCard)}
            {images.gap > 0 && (
              <GapIndicator gap={images.gap} total={images.total} expanded={showAllImages} onToggle={() => setShowAllImages(v => !v)} />
            )}
            {images.tail.map(renderImageCard)}
            {videos.head.map(renderVideoCard)}
            {videos.gap > 0 && (
              <GapIndicator gap={videos.gap} total={videos.total} expanded={showAllVideos} onToggle={() => setShowAllVideos(v => !v)} />
            )}
            {videos.tail.map(renderVideoCard)}
          </div>
        </>
      )}

      {/* Sub-directories */}
      {dirs.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Folders ({dirs.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {dirSlice.head.map(d => (
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
                {d.name}
              </div>
            ))}
            {dirSlice.gap > 0 && (
              <GapIndicator gap={dirSlice.gap} total={dirSlice.total} expanded={showAllDirs} onToggle={() => setShowAllDirs(v => !v)} />
            )}
            {dirSlice.tail.map(d => (
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
                {d.name}
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
            {others.head.map(f => (
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
              </div>
            ))}
            {others.gap > 0 && (
              <GapIndicator gap={others.gap} total={others.total} expanded={showAllOther} onToggle={() => setShowAllOther(v => !v)} />
            )}
            {others.tail.map(f => (
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
