import { useRef, useEffect, useState } from 'react';
import type { TupleViewerProps } from '../types';

export function RgbMaskViewer({ match, apiBase }: TupleViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [opacity, setOpacity] = useState(0.4);

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
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = maskImg.width;
      tmpCanvas.height = maskImg.height;
      const tmpCtx = tmpCanvas.getContext('2d')!;
      tmpCtx.drawImage(maskImg, 0, 0);
      const maskData = tmpCtx.getImageData(0, 0, maskImg.width, maskImg.height);
      for (let i = 0; i < maskData.data.length; i += 4) {
        const v = maskData.data[i] | maskData.data[i + 1] | maskData.data[i + 2];
        if (v > 0) {
          maskData.data[i] = 79;
          maskData.data[i + 1] = 195;
          maskData.data[i + 2] = 247;
          maskData.data[i + 3] = Math.round(opacity * 255);
        } else {
          maskData.data[i + 3] = 0;
        }
      }
      tmpCtx.putImageData(maskData, 0, 0);
      ctx.drawImage(tmpCanvas, 0, 0, canvas.width, canvas.height);
    };

    rgbImg.onload = onLoad;
    maskImg.onload = onLoad;
    rgbImg.src = `${apiBase}/api/file?path=${encodeURIComponent(match.files.rgb)}`;
    maskImg.src = `${apiBase}/api/file?path=${encodeURIComponent(match.files.mask)}`;
  }, [match, apiBase, opacity]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border-color)', fontSize: 12 }}>
        <span style={{ color: 'var(--text-secondary)' }}>RGB + Mask: {match.label}</span>
        <label style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
          Opacity:
          <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={e => setOpacity(parseFloat(e.target.value))} style={{ width: 80 }} />
          {Math.round(opacity * 100)}%
        </label>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
        <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      </div>
    </div>
  );
}
