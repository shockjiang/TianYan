import { useRef, useEffect, useState } from 'react';

interface MaskViewerProps {
  src: string;
  name: string;
}

export function MaskViewer({ src, name }: MaskViewerProps) {
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

      for (let i = 0; i < data.length; i += 4) {
        const v = data[i] | data[i + 1] | data[i + 2];
        if (v > 0) {
          data[i] = 79;
          data[i + 1] = 195;
          data[i + 2] = 247;
          data[i + 3] = 200;
        } else {
          data[i] = 26;
          data[i + 1] = 26;
          data[i + 2] = 46;
          data[i + 3] = 255;
        }
      }
      ctx.putImageData(imageData, 0, 0);
    };
    img.onerror = () => setError('Failed to load mask image');
    img.src = src;
  }, [src]);

  if (error) return <div style={{ padding: 24, color: '#f44' }}>{error}</div>;

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
    </div>
  );
}
