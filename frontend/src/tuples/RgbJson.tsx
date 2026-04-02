import { useRef, useEffect, useState } from 'react';
import type { TupleViewerProps } from '../types';

interface Annotation {
  bbox?: number[][];
  mask?: number[][][];
  affordance?: any[];
  [key: string]: any;
}

const COLORS = [
  '#4fc3f7', '#f06292', '#aed581', '#ffb74d', '#ba68c8',
  '#4dd0e1', '#ff8a65', '#a1887f', '#90a4ae', '#e6ee9c',
];

export function RgbJsonViewer({ match, apiBase }: TupleViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [annotation, setAnnotation] = useState<Annotation | null>(null);
  const [showBbox, setShowBbox] = useState(true);
  const [showMask, setShowMask] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/api/file?path=${encodeURIComponent(match.files.json)}`)
      .then(r => r.json())
      .then(setAnnotation)
      .catch(e => setError(e.message));
  }, [match.files.json, apiBase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !annotation) return;
    const ctx = canvas.getContext('2d')!;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      if (showBbox && annotation.bbox) {
        annotation.bbox.forEach((box, i) => {
          const [x, y, w, h] = box;
          const color = COLORS[i % COLORS.length];
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, w, h);
          ctx.fillStyle = color;
          ctx.font = '12px sans-serif';
          ctx.fillText(`#${i}`, x + 2, y - 4);
        });
      }

      if (showMask && annotation.mask) {
        annotation.mask.forEach((maskItem: any, i: number) => {
          const color = COLORS[i % COLORS.length];
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;

          if (Array.isArray(maskItem) && Array.isArray(maskItem[0])) {
            ctx.beginPath();
            const points = maskItem as number[][];
            if (points.length > 0) {
              ctx.moveTo(points[0][0], points[0][1]);
              for (let j = 1; j < points.length; j++) {
                ctx.lineTo(points[j][0], points[j][1]);
              }
              ctx.closePath();
              ctx.globalAlpha = 0.3;
              ctx.fillStyle = color;
              ctx.fill();
              ctx.globalAlpha = 1;
              ctx.stroke();
            }
          }
        });
      }

      if (annotation.affordance) {
        annotation.affordance.forEach((aff: any, i: number) => {
          if (aff && typeof aff === 'object') {
            const { x, y, label } = aff;
            if (x != null && y != null && label) {
              const color = COLORS[i % COLORS.length];
              ctx.fillStyle = 'rgba(0,0,0,0.6)';
              ctx.fillRect(x - 2, y - 14, ctx.measureText(label).width + 8, 18);
              ctx.fillStyle = color;
              ctx.font = 'bold 12px sans-serif';
              ctx.fillText(label, x + 2, y);
            }
          }
        });
      }
    };
    img.onerror = () => setError('Failed to load image');
    img.src = `${apiBase}/api/file?path=${encodeURIComponent(match.files.rgb)}`;
  }, [match, apiBase, annotation, showBbox, showMask]);

  if (error) return <div style={{ padding: 24, color: '#f44' }}>Error: {error}</div>;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 16, borderBottom: '1px solid var(--border-color)', fontSize: 12 }}>
        <span style={{ color: 'var(--text-secondary)' }}>RGB + JSON: {match.label}</span>
        <label style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showBbox} onChange={e => setShowBbox(e.target.checked)} />
          BBox
        </label>
        <label style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showMask} onChange={e => setShowMask(e.target.checked)} />
          Mask
        </label>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
        <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      </div>
    </div>
  );
}
