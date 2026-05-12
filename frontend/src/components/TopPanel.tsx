import { useState, useEffect } from 'react';
import { AutoComplete, Select, Button, message } from 'antd';
import { getTupleTypes } from '../tuples/registry';
import type { VizMode } from '../types';

interface TopPanelProps {
  rootDir: string;
  selectedPath?: string;
  dirHistory: string[];
  vizMode: VizMode;
  onRootSubmit: (path: string) => void;
  onVizChange: (mode: VizMode) => void;
}

export function TopPanel({ rootDir, selectedPath, dirHistory, vizMode, onRootSubmit, onVizChange }: TopPanelProps) {
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

  const handleOpenClipboard = async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      message.error('Could not read clipboard — paste the path into the input instead');
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      message.warning('Clipboard is empty');
      return;
    }
    // Keep only the first line — guards against multi-line copies.
    const oneLine = trimmed.split(/\r?\n/, 1)[0].trim();
    setInputValue(oneLine);
    onRootSubmit(oneLine);
  };

  const handleNewTab = () => {
    // Build a fresh URL that mirrors *this* side only — root, file, viz —
    // so the new tab opens in single-side mode with the same selection.
    const params = new URLSearchParams();
    if (rootDir) params.set('root', rootDir);
    if (selectedPath) params.set('file', selectedPath);
    if (vizMode && vizMode !== 'single') params.set('viz', vizMode);
    const qs = params.toString();
    const href = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.open(href, '_blank', 'noopener');
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
      <Button
        size="small"
        onClick={handleOpenClipboard}
        title="Read a path from the clipboard and load it"
      >Open path in clipboard</Button>
      <Button
        size="small"
        onClick={handleNewTab}
        disabled={!rootDir}
        title="Open the current root + selection in a new tab"
      >New Tab</Button>
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
