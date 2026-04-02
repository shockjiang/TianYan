import type { FileNode, VizMode } from '../types';

interface MainPanelProps {
  selectedNode?: FileNode;
  vizMode: VizMode;
  treeData: FileNode | null;
  apiBase: string;
  rootDir?: string;
  onNavigate?: (path: string) => void;
}

export function MainPanel({ selectedNode }: MainPanelProps) {
  return (
    <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
      {selectedNode ? `Selected: ${selectedNode.path}` : 'Select a file to preview'}
    </div>
  );
}
