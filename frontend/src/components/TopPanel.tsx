import { useState, useEffect } from 'react';
import { AutoComplete, Select, Button } from 'antd';
import { getTupleTypes } from '../tuples/registry';
import type { VizMode } from '../types';

interface TopPanelProps {
  rootDir: string;
  dirHistory: string[];
  vizMode: VizMode;
  onRootSubmit: (path: string) => void;
  onVizChange: (mode: VizMode) => void;
}

export function TopPanel({ rootDir, dirHistory, vizMode, onRootSubmit, onVizChange }: TopPanelProps) {
  const [inputValue, setInputValue] = useState(rootDir);
  useEffect(() => { setInputValue(rootDir); }, [rootDir]);
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
      height: 44,
      background: 'var(--bg-panel)',
      borderBottom: '1px solid var(--border-color)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 8,
      flexShrink: 0,
    }}>
      <AutoComplete
        style={{ flex: 1, minWidth: 200 }}
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
      <Button type="primary" size="small" onClick={handleSubmit}>Load</Button>
      <Select
        style={{ width: 160 }}
        value={vizMode}
        onChange={onVizChange}
        options={vizOptions}
        size="small"
      />
    </div>
  );
}
