import { useState, useEffect } from 'react';
import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Breadcrumb } from './Breadcrumb';
import { DirectoryGallery } from './DirectoryGallery';
import { ImageViewer } from './viewers/ImageViewer';
import { DepthViewer } from './viewers/DepthViewer';
import { MaskViewer } from './viewers/MaskViewer';
import { JsonViewer } from './viewers/JsonViewer';
import { TextViewer } from './viewers/TextViewer';
import { getTupleByKey } from '../tuples/registry';
import type { FileNode, VizMode, FileInfo } from '../types';

interface MainPanelProps {
  selectedNode?: FileNode;
  vizMode: VizMode;
  treeData: FileNode | null;
  apiBase: string;
  rootDir?: string;
  onNavigate?: (path: string) => void;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp']);
const TEXT_EXTS = new Set(['.txt', '.log', '.csv', '.yaml', '.yml', '.xml', '.md']);

function detectFileType(node: FileNode): 'image' | 'depth' | 'mask' | 'json' | 'text' | 'unknown' {
  const ext = node.extension || '';
  const path = node.path.toLowerCase();
  if (path.includes('depth') && IMAGE_EXTS.has(ext)) return 'depth';
  if (path.includes('mask') && IMAGE_EXTS.has(ext)) return 'mask';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === '.json') return 'json';
  if (TEXT_EXTS.has(ext)) return 'text';
  return 'unknown';
}

function FileInfoTooltip({ path, apiBase }: { path: string; apiBase: string }) {
  const [info, setInfo] = useState<FileInfo | null>(null);
  useEffect(() => {
    fetch(`${apiBase}/api/file-info?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(setInfo)
      .catch(() => {});
  }, [path, apiBase]);

  if (!info) return null;
  const sizeStr = info.size > 1024 * 1024
    ? `${(info.size / 1024 / 1024).toFixed(1)} MB`
    : `${(info.size / 1024).toFixed(1)} KB`;

  return (
    <Tooltip title={
      <div style={{ fontSize: 12 }}>
        <div>Size: {sizeStr}</div>
        {info.dimensions && <div>Dimensions: {info.dimensions[0]} x {info.dimensions[1]}</div>}
        <div>Modified: {new Date(info.modified).toLocaleString()}</div>
      </div>
    }>
      <InfoCircleOutlined style={{ color: 'var(--text-secondary)', cursor: 'help', marginLeft: 8 }} />
    </Tooltip>
  );
}

function collectFiles(node: FileNode): FileNode[] {
  if (node.type === 'file') return [node];
  return (node.children || []).flatMap(collectFiles);
}

export function MainPanel({ selectedNode, vizMode, treeData, apiBase, rootDir, onNavigate }: MainPanelProps) {
  // Tuple mode
  if (vizMode !== 'single' && treeData) {
    const tupleType = getTupleByKey(vizMode);
    if (tupleType) {
      const allFiles = collectFiles(treeData);
      const matches = tupleType.matcher(allFiles, selectedNode);
      const activeMatch = selectedNode
        ? matches.find(m => Object.values(m.files).includes(selectedNode.path))
        : matches[0];
      if (activeMatch) {
        const TupleComponent = tupleType.component;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {rootDir && onNavigate && (
              <Breadcrumb path={selectedNode?.path} rootDir={rootDir} onNavigate={onNavigate} />
            )}
            <TupleComponent match={activeMatch} apiBase={apiBase} />
          </div>
        );
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {rootDir && onNavigate && (
            <Breadcrumb path={selectedNode?.path} rootDir={rootDir} onNavigate={onNavigate} />
          )}
          <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
            No matching {tupleType.name} tuple found for the selected file. Select an image file to find matches.
          </div>
        </div>
      );
    }
  }

  // No selection
  if (!selectedNode) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>&#128065;</div>
          <div>Select a file or directory to preview</div>
        </div>
      </div>
    );
  }

  // Directory → gallery
  if (selectedNode.type === 'directory') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {rootDir && onNavigate && (
          <Breadcrumb path={selectedNode.path} rootDir={rootDir} onNavigate={onNavigate} />
        )}
        <DirectoryGallery node={selectedNode} apiBase={apiBase} onFileSelect={(f) => onNavigate?.(f.path)} />
      </div>
    );
  }

  // Single file
  const fileType = detectFileType(selectedNode);
  const fileSrc = `${apiBase}/api/file?path=${encodeURIComponent(selectedNode.path)}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {rootDir && onNavigate && (
        <Breadcrumb path={selectedNode.path} rootDir={rootDir} onNavigate={onNavigate} />
      )}
      <div style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
        <span>{selectedNode.name}</span>
        <FileInfoTooltip path={selectedNode.path} apiBase={apiBase} />
        <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}>{fileType}</span>
      </div>
      {fileType === 'image' && <ImageViewer src={fileSrc} name={selectedNode.name} />}
      {fileType === 'depth' && <DepthViewer src={fileSrc} name={selectedNode.name} />}
      {fileType === 'mask' && <MaskViewer src={fileSrc} name={selectedNode.name} />}
      {fileType === 'json' && <JsonViewer src={fileSrc} name={selectedNode.name} />}
      {fileType === 'text' && <TextViewer src={fileSrc} name={selectedNode.name} />}
      {fileType === 'unknown' && (
        <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
          Preview not available for this file type ({selectedNode.extension || 'unknown'})
        </div>
      )}
    </div>
  );
}
