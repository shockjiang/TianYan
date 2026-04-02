import { useState } from 'react';
import { AutoComplete, Select, Button, Space, message } from 'antd';
import { SunOutlined, MoonOutlined, FullscreenOutlined, ShareAltOutlined } from '@ant-design/icons';
import { getTupleTypes } from '../tuples/registry';
import { buildShareUrl } from '../hooks/useUrlState';
import type { VizMode } from '../types';
import type { Theme } from '../hooks/useTheme';

interface TopPanelProps {
  rootDir: string;
  dirHistory: string[];
  vizMode: VizMode;
  theme: Theme;
  autoplay: boolean;
  fullscreen: boolean;
  selectedFile?: string;
  onRootSubmit: (path: string) => void;
  onVizChange: (mode: VizMode) => void;
  onThemeToggle: () => void;
  onAutoplayChange: (val: boolean) => void;
  onFullscreenToggle: () => void;
}

export function TopPanel({ rootDir, dirHistory, vizMode, theme, autoplay, fullscreen, selectedFile, onRootSubmit, onVizChange, onThemeToggle, onAutoplayChange, onFullscreenToggle }: TopPanelProps) {
  const [inputValue, setInputValue] = useState(rootDir);
  const tupleTypes = getTupleTypes();

  const vizOptions = [
    { value: 'single', label: 'Single File' },
    ...tupleTypes.map(t => ({ value: t.key, label: t.name })),
  ];

  const historyOptions = dirHistory.map(h => ({ value: h, label: h }));

  const handleSubmit = () => {
    const trimmed = inputValue.trim();
    if (trimmed) onRootSubmit(trimmed);
  };

  return (
    <div style={{
      height: 48,
      background: 'var(--bg-panel)',
      borderBottom: '1px solid var(--border-color)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 12,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
        <img src="/favicon.svg" alt="TianYan" style={{ width: 24, height: 24 }} />
        <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 16 }}>TianYan</span>
      </div>
      <AutoComplete
        style={{ flex: 1, maxWidth: 500 }}
        value={inputValue}
        options={historyOptions}
        onChange={setInputValue}
        onSelect={(val: string) => { setInputValue(val); onRootSubmit(val); }}
        placeholder="Enter root directory path..."
        onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
        filterOption={(input, option) =>
          (option?.value as string)?.toLowerCase().includes(input.toLowerCase())
        }
      />
      <Button type="primary" size="small" onClick={handleSubmit}>
        Load
      </Button>
      <Select
        style={{ width: 180 }}
        value={vizMode}
        onChange={onVizChange}
        options={vizOptions}
        size="small"
      />
      <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={autoplay} onChange={e => onAutoplayChange(e.target.checked)} />
        Autoplay
      </label>
      <Button
        type="text"
        size="small"
        icon={<ShareAltOutlined />}
        title="Copy share link"
        style={{ color: 'var(--text-primary)' }}
        onClick={() => {
          // Use ClipboardItem with async blob — works on HTTP because
          // the ClipboardItem is created synchronously within user gesture
          const blobPromise = fetch('/api/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ root: rootDir, file: selectedFile || null, viz: vizMode || null }),
          })
            .then(r => r.json())
            .then(data => {
              const url = `${window.location.origin}?s=${data.code}`;
              (window as any).__lastShareUrl = url;
              return new Blob([url], { type: 'text/plain' });
            });

          try {
            navigator.clipboard.write([
              new ClipboardItem({ 'text/plain': blobPromise })
            ]).then(() => {
              message.success(`Copied: ${(window as any).__lastShareUrl}`);
            }).catch(() => {
              // Final fallback: show in prompt
              blobPromise.then(blob => blob.text()).then(url => {
                window.prompt('Copy this link:', url);
              });
            });
          } catch {
            // Browser doesn't support ClipboardItem
            blobPromise.then(blob => blob.text()).then(url => {
              window.prompt('Copy this link:', url);
            });
          }
        }}
      />
      <Button
        type="text"
        size="small"
        icon={<FullscreenOutlined />}
        onClick={onFullscreenToggle}
        title="Fullscreen (F)"
        style={{ color: 'var(--text-primary)' }}
      />
      <Button
        type="text"
        size="small"
        icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        onClick={onThemeToggle}
        style={{ color: 'var(--text-primary)' }}
      />
    </div>
  );
}
