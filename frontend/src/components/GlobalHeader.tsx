import { Button, message } from 'antd';
import { SunOutlined, MoonOutlined, FullscreenOutlined, ShareAltOutlined } from '@ant-design/icons';
import type { Theme } from '../hooks/useTheme';
import type { SideState } from '../types';

interface GlobalHeaderProps {
  theme: Theme;
  autoplay: boolean;
  gridScale: number;
  sideA: SideState;
  sideB: SideState | null;
  onThemeToggle: () => void;
  onFullscreenToggle: () => void;
  onAutoplayChange: (val: boolean) => void;
  onGridScaleChange: (val: number) => void;
  onCompareToggle: () => void;
  onExitKeepLeft: () => void;
  onExitKeepRight: () => void;
}

export function GlobalHeader({
  theme, autoplay, gridScale, sideA, sideB,
  onThemeToggle, onFullscreenToggle, onAutoplayChange, onGridScaleChange,
  onCompareToggle, onExitKeepLeft, onExitKeepRight,
}: GlobalHeaderProps) {
  const compareMode = sideB !== null;

  const buildSharePayload = () => {
    const a = { root: sideA.rootDir, file: sideA.selectedPath || null, viz: sideA.vizMode || null };
    return sideB
      ? { a, b: { root: sideB.rootDir, file: sideB.selectedPath || null, viz: sideB.vizMode || null } }
      : { a };
  };

  const handleShare = () => {
    if (!sideA.rootDir) {
      message.warning('No state to share yet');
      return;
    }
    const blobPromise = fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSharePayload()),
    })
      .then(r => r.json())
      .then(data => {
        const url = `${window.location.origin}?s=${data.code}`;
        (window as any).__lastShareUrl = url;
        return new Blob([url], { type: 'text/plain' });
      });
    try {
      navigator.clipboard.write([new ClipboardItem({ 'text/plain': blobPromise })])
        .then(() => message.success(`Copied: ${(window as any).__lastShareUrl}`))
        .catch(() => blobPromise.then(b => b.text()).then(url => window.prompt('Copy this link:', url)));
    } catch {
      blobPromise.then(b => b.text()).then(url => window.prompt('Copy this link:', url));
    }
  };

  return (
    <div style={{
      height: 36,
      background: 'var(--bg-panel)',
      borderBottom: '1px solid var(--border-color)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 8,
      flexShrink: 0,
      fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <img src="/favicon.svg" alt="鹰眼" style={{ width: 20, height: 20 }} />
        <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 14 }}>鹰眼</span>
      </div>

      <div style={{ flex: 1 }} />

      {!compareMode && (
        <Button size="small" onClick={onCompareToggle} disabled={!sideA.rootDir}>
          Compare
        </Button>
      )}
      {compareMode && (
        <>
          <Button size="small" onClick={onExitKeepLeft}>Exit ← Keep Left</Button>
          <Button size="small" onClick={onExitKeepRight}>Exit Keep Right →</Button>
        </>
      )}

      <label style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={autoplay} onChange={e => onAutoplayChange(e.target.checked)} />
        Autoplay
      </label>

      <label style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
        Scale:
        <input type="range" min="0.05" max="1" step="0.05" value={gridScale}
          onChange={e => onGridScaleChange(parseFloat(e.target.value))}
          style={{ width: 70 }} />
        {Math.round(gridScale * 100)}%
      </label>

      <Button type="text" size="small" icon={<ShareAltOutlined />} title="Copy share link"
        style={{ color: 'var(--text-primary)' }} onClick={handleShare} />
      <Button type="text" size="small" icon={<FullscreenOutlined />} title="Fullscreen (F)"
        style={{ color: 'var(--text-primary)' }} onClick={onFullscreenToggle} />
      <Button type="text" size="small" icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        style={{ color: 'var(--text-primary)' }} onClick={onThemeToggle} />
    </div>
  );
}
