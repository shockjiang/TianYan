import { useState, useMemo } from 'react';
import { Tree, Input } from 'antd';
import { FolderOutlined, FileOutlined, FileImageOutlined, FileTextOutlined } from '@ant-design/icons';
import type { FileNode } from '../types';
import type { DataNode, EventDataNode } from 'antd/es/tree';

interface FileTreeProps {
  treeData: FileNode | null;
  selectedPath?: string;
  recentFiles: string[];
  onSelect: (node: FileNode) => void;
  onLoadChildren: (path: string) => void;
  apiBase: string;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp']);
const TEXT_EXTS = new Set(['.txt', '.log', '.csv', '.yaml', '.yml', '.xml', '.md']);

function getFileIcon(node: FileNode) {
  if (node.type === 'directory') return <FolderOutlined style={{ color: '#f0c040' }} />;
  if (node.extension && IMAGE_EXTS.has(node.extension)) return <FileImageOutlined style={{ color: '#4fc3f7' }} />;
  if (node.extension && (TEXT_EXTS.has(node.extension) || node.extension === '.json')) return <FileTextOutlined style={{ color: '#81c784' }} />;
  return <FileOutlined />;
}

function buildTreeData(node: FileNode, filter: string): DataNode | null {
  if (node.type === 'file') {
    if (filter && !node.name.toLowerCase().includes(filter.toLowerCase())) return null;
    return {
      key: node.path,
      title: node.name,
      icon: getFileIcon(node),
      isLeaf: true,
    };
  }
  const children = (node.children || [])
    .map(child => buildTreeData(child, filter))
    .filter(Boolean) as DataNode[];
  if (filter && children.length === 0 && !node.name.toLowerCase().includes(filter.toLowerCase())) {
    return null;
  }
  return {
    key: node.path,
    title: node.name,
    icon: getFileIcon(node),
    children,
    isLeaf: false,
  };
}

function buildNodeMap(node: FileNode, map: Map<string, FileNode>) {
  map.set(node.path, node);
  if (node.children) {
    for (const child of node.children) buildNodeMap(child, map);
  }
}

export function FileTree({ treeData, selectedPath, recentFiles, onSelect, onLoadChildren, apiBase }: FileTreeProps) {
  const [filter, setFilter] = useState('');

  const nodeMap = useMemo(() => {
    const map = new Map<string, FileNode>();
    if (treeData) buildNodeMap(treeData, map);
    return map;
  }, [treeData]);

  const antTreeData = useMemo(() => {
    if (!treeData) return [];
    const root = buildTreeData(treeData, filter);
    return root ? (root.children || [root]) : [];
  }, [treeData, filter]);

  const handleSelect = (_: any, info: { node: EventDataNode<DataNode> }) => {
    const node = nodeMap.get(info.node.key as string);
    if (node) onSelect(node);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 8px 4px' }}>
        <Input.Search
          placeholder="Filter files..."
          size="small"
          allowClear
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 4px' }}>
        {antTreeData.length > 0 ? (
          <Tree
            treeData={antTreeData}
            selectedKeys={selectedPath ? [selectedPath] : []}
            onSelect={(_, info) => handleSelect(_, info)}
            showIcon
            blockNode
            defaultExpandAll={false}
            autoExpandParent
            style={{ background: 'transparent' }}
          />
        ) : (
          <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 13 }}>
            {treeData ? 'No matching files' : 'Enter a directory path above'}
          </div>
        )}
      </div>
      {recentFiles.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-color)', padding: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>
            Recent Files
          </div>
          {recentFiles.slice(0, 5).map(f => {
            const name = f.split('/').pop() || f;
            return (
              <div
                key={f}
                onClick={() => {
                  const node = nodeMap.get(f);
                  if (node) onSelect(node);
                }}
                style={{
                  fontSize: 12,
                  padding: '2px 4px',
                  cursor: 'pointer',
                  color: 'var(--accent)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={f}
              >
                {name}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
