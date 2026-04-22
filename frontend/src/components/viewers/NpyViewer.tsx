import { useState, useEffect } from 'react';

interface NpyViewerProps {
  path: string;
  name: string;
  apiBase: string;
}

interface NpyInfo {
  shape: number[];
  dtype: string;
  ndim: number;
  size: number;
  min: number | null;
  max: number | null;
  visualizable: boolean;
  num_frames: number | null;
  // npz fields
  keys?: string[];
  arrays?: Record<string, { shape: number[]; dtype: string }>;
  num_keys?: number;
}

export function NpyViewer({ path, name, apiBase }: NpyViewerProps) {
  const [info, setInfo] = useState<NpyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [npzKey, setNpzKey] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setFrame(0);
    setPlaying(false);
    fetch(`${apiBase}/api/npy/info?path=${encodeURIComponent(path)}`)
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Failed'); });
        return r.json();
      })
      .then(d => {
        setInfo(d);
        if (d.keys?.length) setNpzKey(d.keys[0]);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [path, apiBase]);

  // Auto-play
  useEffect(() => {
    if (!playing || !info?.num_frames) return;
    const interval = setInterval(() => {
      setFrame(f => (f + 1) % info.num_frames!);
    }, 100);
    return () => clearInterval(interval);
  }, [playing, info?.num_frames]);

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading array info...</div>;
  }
  if (error) {
    return <div style={{ padding: 24, color: '#ff6b6b' }}>Error: {error}</div>;
  }
  if (!info) return null;

  const numFrames = info.num_frames;
  const isSequence = numFrames != null && numFrames > 1;
  const imgSrc = `${apiBase}/api/npy/frame?path=${encodeURIComponent(path)}&frame=${frame}${npzKey ? `&key=${encodeURIComponent(npzKey)}` : ''}`;

  // NPZ file with multiple arrays — show metadata table
  if (info.keys && !info.visualizable) {
    return (
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <InfoBar info={info} />
        </div>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
          <thead>
            <tr>
              <th style={{ padding: '6px 12px', textAlign: 'left', borderBottom: '2px solid var(--border-color)', color: 'var(--accent)' }}>Key</th>
              <th style={{ padding: '6px 12px', textAlign: 'left', borderBottom: '2px solid var(--border-color)', color: 'var(--accent)' }}>Shape</th>
              <th style={{ padding: '6px 12px', textAlign: 'left', borderBottom: '2px solid var(--border-color)', color: 'var(--accent)' }}>Dtype</th>
            </tr>
          </thead>
          <tbody>
            {info.keys.map(k => (
              <tr key={k} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ padding: '4px 12px' }}>{k}</td>
                <td style={{ padding: '4px 12px', color: '#b5cea8' }}>{info.arrays?.[k]?.shape?.join(' x ') || '?'}</td>
                <td style={{ padding: '4px 12px', color: 'var(--text-secondary)' }}>{info.arrays?.[k]?.dtype || '?'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Info + controls bar */}
      <div style={{
        padding: '6px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 12,
        color: 'var(--text-secondary)',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        <InfoBar info={info} />
        {isSequence && (
          <>
            <button
              onClick={() => setPlaying(p => !p)}
              style={{
                padding: '2px 10px', cursor: 'pointer',
                background: playing ? 'var(--accent)' : 'var(--bg-secondary)',
                color: playing ? '#fff' : 'var(--text-primary)',
                border: '1px solid var(--border-color)', borderRadius: 4, fontSize: 12,
              }}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', minWidth: 70 }}>
              Frame {frame} / {numFrames! - 1}
            </span>
            <input
              type="range"
              min={0}
              max={numFrames! - 1}
              value={frame}
              onChange={e => { setFrame(Number(e.target.value)); setPlaying(false); }}
              style={{ flex: 1, minWidth: 100, maxWidth: 400 }}
            />
          </>
        )}
      </div>

      {/* Image display */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', background: '#1a1a1a' }}>
        {info.visualizable || isSequence ? (
          <img
            key={imgSrc}
            src={imgSrc}
            alt={`${name} frame ${frame}`}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
          />
        ) : (
          <div style={{ color: 'var(--text-secondary)', padding: 24, textAlign: 'center' }}>
            <div>Cannot visualize this array as an image</div>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              {info.shape ? `Shape: ${info.shape.join(' x ')} | ` : ''}Dtype: {info.dtype || 'unknown'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoBar({ info }: { info: NpyInfo }) {
  return (
    <>
      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
        {info.shape ? info.shape.join(' x ') : `${info.num_keys ?? 0} arrays`}
      </span>
      <span>{info.dtype}</span>
      {info.min != null && <span>range: [{info.min.toFixed(2)}, {info.max?.toFixed(2)}]</span>}
      {info.num_keys != null && <span>{info.num_keys} arrays</span>}
    </>
  );
}
