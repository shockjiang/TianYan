import { useRef, useEffect, useState } from 'react';

interface DepthViewerProps {
  src: string;
  name: string;
}

const COLORMAP: [number, number, number][] = [
  [68, 1, 84], [72, 35, 116], [64, 67, 135], [52, 94, 141],
  [33, 145, 140], [53, 183, 121], [143, 215, 68], [253, 231, 37],
];

function viridis(t: number): [number, number, number] {
  const idx = t * (COLORMAP.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, COLORMAP.length - 1);
  const f = idx - lo;
  return [
    Math.round(COLORMAP[lo][0] * (1 - f) + COLORMAP[hi][0] * f),
    Math.round(COLORMAP[lo][1] * (1 - f) + COLORMAP[hi][1] * f),
    Math.round(COLORMAP[lo][2] * (1 - f) + COLORMAP[hi][2] * f),
  ];
}

export function DepthViewer({ src, name }: DepthViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const data = imageData.data;

      let min = 255, max = 0;
      for (let i = 0; i < data.length; i += 4) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const range = max - min || 1;

      for (let i = 0; i < data.length; i += 4) {
        const t = (data[i] - min) / range;
        const [r, g, b] = viridis(t);
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
    };
    img.onerror = () => setError('Failed to load depth image');
    img.src = src;
  }, [src]);

  if (error) return <div style={{ padding: 24, color: '#f44' }}>{error}</div>;

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
    </div>
  );
}
