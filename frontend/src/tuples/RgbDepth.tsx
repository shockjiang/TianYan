import { ImageViewer } from '../components/viewers/ImageViewer';
import { DepthViewer } from '../components/viewers/DepthViewer';
import type { TupleViewerProps } from '../types';

export function RgbDepthViewer({ match, apiBase }: TupleViewerProps) {
  const rgbSrc = `${apiBase}/api/file?path=${encodeURIComponent(match.files.rgb)}`;
  const depthSrc = `${apiBase}/api/file?path=${encodeURIComponent(match.files.depth)}`;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 16px', borderBottom: '1px solid var(--border-color)', fontSize: 12, color: 'var(--text-secondary)' }}>
        RGB + Depth: {match.label}
      </div>
      <div style={{ flex: 1, display: 'flex', gap: 2, overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-color)' }}>
          <div style={{ padding: '2px 8px', fontSize: 11, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>RGB</div>
          <ImageViewer src={rgbSrc} name="rgb" />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '2px 8px', fontSize: 11, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>Depth</div>
          <DepthViewer src={depthSrc} name="depth" />
        </div>
      </div>
    </div>
  );
}
