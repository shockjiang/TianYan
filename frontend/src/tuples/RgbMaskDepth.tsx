import { useRef, useEffect, useState } from 'react';
import { DepthViewer } from '../components/viewers/DepthViewer';
import type { TupleViewerProps } from '../types';

function MaskOverlayCanvas({ rgbSrc, maskSrc, opacity }: { rgbSrc: string; maskSrc: string; opacity: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const rgbImg = new Image();
    const maskImg = new Image();
    rgbImg.crossOrigin = 'anonymous';
    maskImg.crossOrigin = 'anonymous';
    let loaded = 0;
    const onLoad = () => {
      loaded++;
      if (loaded < 2) return;
      canvas.width = rgbImg.width;
      canvas.height = rgbImg.height;
      ctx.drawImage(rgbImg, 0, 0);
      const tmp = document.createElement('canvas');
      tmp.width = maskImg.width;
      tmp.height = maskImg.height;
      const tmpCtx = tmp.getContext('2d')!;
      tmpCtx.drawImage(maskImg, 0, 0);
      const d = tmpCtx.getImageData(0, 0, tmp.width, tmp.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const v = d.data[i] | d.data[i + 1] | d.data[i + 2];
        if (v > 0) { d.data[i] = 79; d.data[i + 1] = 195; d.data[i + 2] = 247; d.data[i + 3] = Math.round(opacity * 255); }
        else { d.data[i + 3] = 0; }
      }
      tmpCtx.putImageData(d, 0, 0);
      ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    };
    rgbImg.onload = onLoad;
    maskImg.onload = onLoad;
    rgbImg.src = rgbSrc;
    maskImg.src = maskSrc;
  }, [rgbSrc, maskSrc, opacity]);

  return <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />;
}

export function RgbMaskDepthViewer({ match, apiBase }: TupleViewerProps) {
  const [opacity, setOpacity] = useState(0.4);
  const rgbSrc = `${apiBase}/api/file?path=${encodeURIComponent(match.files.rgb)}`;
  const maskSrc = `${apiBase}/api/file?path=${encodeURIComponent(match.files.mask)}`;
  const depthSrc = `${apiBase}/api/file?path=${encodeURIComponent(match.files.depth)}`;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border-color)', fontSize: 12 }}>
        <span style={{ color: 'var(--text-secondary)' }}>RGB + Mask + Depth: {match.label}</span>
        <label style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
          Mask Opacity:
          <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={e => setOpacity(parseFloat(e.target.value))} style={{ width: 80 }} />
        </label>
      </div>
      <div style={{ flex: 1, display: 'flex', gap: 2, overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-color)' }}>
          <div style={{ padding: '2px 8px', fontSize: 11, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>RGB + Mask</div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
            <MaskOverlayCanvas rgbSrc={rgbSrc} maskSrc={maskSrc} opacity={opacity} />
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '2px 8px', fontSize: 11, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>Depth</div>
          <DepthViewer src={depthSrc} name="depth" />
        </div>
      </div>
    </div>
  );
}
