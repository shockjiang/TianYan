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
  return (
    <div style={{ height: 48, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12 }}>
      <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 16 }}>TianYan</span>
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Stub — will be replaced</span>
    </div>
  );
}
