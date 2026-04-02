import { useState } from 'react';
import { AutoComplete, Select, Button, Space } from 'antd';
import { SunOutlined, MoonOutlined } from '@ant-design/icons';
import { getTupleTypes } from '../tuples/registry';
import type { VizMode } from '../types';
import type { Theme } from '../hooks/useTheme';

interface TopPanelProps {
  rootDir: string;
  dirHistory: string[];
  vizMode: VizMode;
  theme: Theme;
  onRootSubmit: (path: string) => void;
  onVizChange: (mode: VizMode) => void;
  onThemeToggle: () => void;
}

export function TopPanel({ rootDir, dirHistory, vizMode, theme, onRootSubmit, onVizChange, onThemeToggle }: TopPanelProps) {
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
      <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap' }}>
        TianYan
      </span>
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
