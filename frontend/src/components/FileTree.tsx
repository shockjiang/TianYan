import type { FileNode } from '../types';

interface FileTreeProps {
  treeData: FileNode | null;
  selectedPath?: string;
  recentFiles: string[];
  onSelect: (node: FileNode) => void;
  onLoadChildren: (path: string) => void;
  apiBase: string;
}

export function FileTree({ treeData }: FileTreeProps) {
  return (
    <div style={{ padding: 16, color: 'var(--text-secondary)' }}>
      {treeData ? `Tree loaded: ${treeData.name}` : 'No directory loaded'}
    </div>
  );
}
