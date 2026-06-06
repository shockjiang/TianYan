import { useState, useRef, useCallback, useEffect } from 'react';

interface ImageViewerProps {
  src: string;
  name: string;
}

export function ImageViewer({ src, name }: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => { setLoading(true); setError(false); }, [src]);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  // Live mirrors of scale/offset so the wheel handler can read current values
  // without stale-closure deps. The image is flex-centred, so its transform
  // origin sits at the container centre regardless of letterboxing.
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const apply = (s: number, o: { x: number; y: number }) => {
    scaleRef.current = s; offsetRef.current = o;
    setScale(s); setOffset(o);
  };

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = scaleRef.current;
    const o = offsetRef.current;
    const ns = Math.max(0.1, Math.min(20, s * (e.deltaY > 0 ? 0.9 : 1.1)));
    const ratio = ns / s;
    // Cursor position relative to the container centre (= transform origin).
    const vx = e.clientX - rect.left - rect.width / 2;
    const vy = e.clientY - rect.top - rect.height / 2;
    // Keep the content point under the cursor fixed across the scale change.
    apply(ns, { x: vx - ratio * (vx - o.x), y: vy - ratio * (vy - o.y) });
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const o = offsetRef.current;
    apply(scaleRef.current, {
      x: o.x + e.clientX - lastPos.current.x,
      y: o.y + e.clientY - lastPos.current.y,
    });
    lastPos.current = { x: e.clientX, y: e.clientY };
  };
  const handleMouseUp = () => { dragging.current = false; };

  const resetView = () => { apply(1, { x: 0, y: 0 }); };

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: dragging.current ? 'grabbing' : 'grab' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', gap: 4 }}>
        <button onClick={resetView} style={{ padding: '2px 8px', fontSize: 12, cursor: 'pointer', background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4 }}>
          Reset
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '2px 6px', background: 'var(--bg-panel)', borderRadius: 4 }}>
          {Math.round(scale * 100)}%
        </span>
      </div>
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {loading && !error && (
          <div style={{ position: 'absolute', color: 'var(--text-secondary)', fontSize: 13 }}>Loading image...</div>
        )}
        {error && (
          <div style={{ position: 'absolute', color: '#ff6b6b', fontSize: 13 }}>Failed to load image</div>
        )}
        <img
          src={src}
          alt={name}
          draggable={false}
          onLoad={() => setLoading(false)}
          onError={() => { setLoading(false); setError(true); }}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            userSelect: 'none',
            opacity: loading || error ? 0 : 1,
          }}
        />
      </div>
    </div>
  );
}
