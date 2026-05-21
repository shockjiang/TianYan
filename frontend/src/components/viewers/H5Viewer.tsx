import { useState, useEffect, useMemo } from 'react';
import { exportSequenceToMp4 } from '../../lib/exportMp4';

interface H5ViewerProps {
  path: string;
  name: string;
  apiBase: string;
  /** Notify the parent whenever the user picks a different dataset, or null
   *  on unmount, so cross-cutting actions (e.g. file-tree right-click
   *  Export MP4) can target the chosen sequence. */
  onCurrentKeyChange?: (key: string | null) => void;
}

interface H5Dataset {
  key: string;
  shape: number[];
  dtype: string;
  ndim: number;
  size: number;
  attrs: Record<string, unknown>;
  visualizable: boolean;
  is_frames: boolean;
  num_frames: number | null;
}

interface H5Info {
  attrs: Record<string, unknown>;
  datasets: H5Dataset[];
  num_datasets: number;
}

interface H5Preview {
  key: string;
  shape: number[];
  dtype: string;
  attrs: Record<string, unknown>;
  data?: unknown;
  data_preview?: unknown;
  min?: number;
  max?: number;
  mean?: number;
  truncated?: boolean;
}

function formatAttrs(attrs: Record<string, unknown>): string {
  const entries = Object.entries(attrs);
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => {
      let s = JSON.stringify(v);
      if (s && s.length > 80) s = s.slice(0, 77) + '...';
      return `${k}: ${s}`;
    })
    .join('  •  ');
}

function DatasetRow({
  ds,
  selected,
  onClick,
}: {
  ds: H5Dataset;
  selected: boolean;
  onClick: () => void;
}) {
  const isImg = ds.is_frames || (ds.visualizable && ds.ndim >= 2);
  return (
    <div
      onClick={onClick}
      style={{
        padding: '6px 10px',
        cursor: 'pointer',
        borderBottom: '1px solid var(--border-color)',
        background: selected ? 'var(--accent)' : 'transparent',
        color: selected ? '#fff' : 'var(--text-primary)',
        fontFamily: 'monospace',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ opacity: 0.6, fontSize: 10 }}>{isImg ? '🖼' : '∑'}</span>
        <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {ds.key}
        </span>
      </div>
      <div style={{ fontSize: 11, opacity: selected ? 0.85 : 0.7, marginTop: 2 }}>
        {ds.shape.join(' × ') || 'scalar'} · {ds.dtype}
        {ds.is_frames && ds.num_frames != null && ` · ${ds.num_frames} frames`}
      </div>
    </div>
  );
}

function AttrsPanel({ attrs, title }: { attrs: Record<string, unknown>; title: string }) {
  const entries = Object.entries(attrs || {});
  if (entries.length === 0) return null;
  return (
    <details style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 4, marginBottom: 8 }}>
      <summary style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
        {title} ({entries.length})
      </summary>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace', width: '100%' }}>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} style={{ borderTop: '1px solid var(--border-color)' }}>
              <td style={{ padding: '3px 10px', color: 'var(--accent)', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{k}</td>
              <td style={{ padding: '3px 10px', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                <pre style={{ margin: 0, fontFamily: 'inherit', whiteSpace: 'pre-wrap' }}>{JSON.stringify(v, null, 2)}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function FrameViewer({
  path,
  apiBase,
  ds,
}: {
  path: string;
  apiBase: string;
  ds: H5Dataset;
}) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const numFrames = ds.num_frames ?? 0;
  const isSequence = ds.is_frames && numFrames > 1;

  useEffect(() => {
    setFrame(0);
    setPlaying(false);
  }, [ds.key]);

  useEffect(() => {
    if (!playing || !isSequence) return;
    const id = setInterval(() => setFrame(f => (f + 1) % numFrames), 500);
    return () => clearInterval(id);
  }, [playing, isSequence, numFrames]);

  const imgSrc = `${apiBase}/api/h5/frame?path=${encodeURIComponent(path)}&key=${encodeURIComponent(ds.key)}&frame=${frame}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {isSequence && (
        <div style={{
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 12,
          color: 'var(--text-secondary)',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}>
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
          <span style={{ fontWeight: 600, color: 'var(--text-primary)', minWidth: 80 }}>
            Frame {frame} / {numFrames - 1}
          </span>
          <input
            type="range"
            min={0}
            max={numFrames - 1}
            value={frame}
            onChange={e => { setFrame(Number(e.target.value)); setPlaying(false); }}
            style={{ flex: 1, minWidth: 100 }}
          />
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', background: '#1a1a1a' }}>
        <img
          key={imgSrc}
          src={imgSrc}
          alt={`${ds.key} frame ${frame}`}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
        />
      </div>
    </div>
  );
}

function DataPreview({ path, apiBase, ds }: { path: string; apiBase: string; ds: H5Dataset }) {
  const [preview, setPreview] = useState<H5Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    setError(null);
    setLoading(true);
    fetch(`${apiBase}/api/h5/preview?path=${encodeURIComponent(path)}&key=${encodeURIComponent(ds.key)}`)
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.detail || 'Failed'))))
      .then(setPreview)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [path, ds.key, apiBase]);

  if (loading) return <div style={{ padding: 16, color: 'var(--text-secondary)' }}>Loading…</div>;
  if (error) return <div style={{ padding: 16, color: '#ff6b6b' }}>Error: {error}</div>;
  if (!preview) return null;

  const data = preview.data ?? preview.data_preview;
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
      <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
        shape: <span style={{ color: 'var(--accent)' }}>{preview.shape.join(' × ') || 'scalar'}</span>
        {'  '}dtype: {preview.dtype}
        {preview.min != null && (
          <>  range: [{preview.min.toFixed(4)}, {preview.max?.toFixed(4)}]  mean: {preview.mean?.toFixed(4)}</>
        )}
        {preview.truncated && <span style={{ color: '#e6a23c' }}>  (truncated)</span>}
      </div>
      <pre style={{
        margin: 0, padding: 10,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 4,
        fontSize: 12, fontFamily: 'monospace',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        color: 'var(--text-primary)',
      }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export function H5Viewer({ path, name, apiBase, onCurrentKeyChange }: H5ViewerProps) {
  const [info, setInfo] = useState<H5Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setInfo(null);
    setSelectedKey(null);
    fetch(`${apiBase}/api/h5/info?path=${encodeURIComponent(path)}`)
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.detail || 'Failed'))))
      .then((d: H5Info) => {
        setInfo(d);
        // Auto-select first frame-like dataset, else first dataset
        const firstFrames = d.datasets.find(x => x.is_frames);
        const first = firstFrames ?? d.datasets[0];
        if (first) setSelectedKey(first.key);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [path, apiBase]);

  // Bubble the current dataset key to the parent (file-tree menu, etc.).
  useEffect(() => {
    onCurrentKeyChange?.(selectedKey);
  }, [selectedKey, onCurrentKeyChange]);

  // Clear on unmount so the parent doesn't keep a stale key when the user
  // navigates to a non-H5 file.
  useEffect(() => () => onCurrentKeyChange?.(null), [onCurrentKeyChange]);

  const selected = useMemo(
    () => info?.datasets.find(d => d.key === selectedKey) ?? null,
    [info, selectedKey]
  );

  if (loading) return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading {name}…</div>;
  if (error) return <div style={{ padding: 24, color: '#ff6b6b' }}>Error: {error}</div>;
  if (!info) return null;

  const summary = formatAttrs(info.attrs);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {summary && (
        <div style={{
          padding: '4px 12px',
          fontSize: 11,
          color: 'var(--text-secondary)',
          borderBottom: '1px solid var(--border-color)',
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }} title={summary}>
          {summary}
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Left: dataset list */}
        <div style={{
          width: 260,
          borderRight: '1px solid var(--border-color)',
          background: 'var(--bg-primary)',
          overflow: 'auto',
          flexShrink: 0,
        }}>
          <div style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            {info.num_datasets} datasets
          </div>
          {info.datasets.map(ds => (
            <DatasetRow
              key={ds.key}
              ds={ds}
              selected={ds.key === selectedKey}
              onClick={() => setSelectedKey(ds.key)}
            />
          ))}
        </div>

        {/* Right: detail */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {selected ? (
            <>
              <div style={{
                padding: '6px 12px', fontSize: 12, color: 'var(--text-secondary)',
                borderBottom: '1px solid var(--border-color)', fontFamily: 'monospace',
                flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{selected.key}</span>
                <span style={{ color: 'var(--accent)' }}>{selected.shape.join(' × ') || 'scalar'}</span>
                <span>{selected.dtype}</span>
                {selected.is_frames && (
                  <button
                    onClick={() => exportSequenceToMp4({ apiBase, path, key: selected.key, fps: 10 })}
                    style={{
                      marginLeft: 'auto',
                      padding: '2px 10px',
                      cursor: 'pointer',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                    title="Encode this dataset as an H.264 mp4 and download"
                  >
                    Export MP4
                  </button>
                )}
              </div>
              {Object.keys(selected.attrs || {}).length > 0 && (
                <div style={{ padding: 8, flexShrink: 0 }}>
                  <AttrsPanel attrs={selected.attrs} title="Dataset attrs" />
                </div>
              )}
              {selected.visualizable || selected.is_frames ? (
                <FrameViewer path={path} apiBase={apiBase} ds={selected} />
              ) : (
                <DataPreview path={path} apiBase={apiBase} ds={selected} />
              )}
            </>
          ) : (
            <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Select a dataset</div>
          )}
        </div>
      </div>
    </div>
  );
}
