import { useState, useEffect, useMemo } from 'react';
import { Tooltip, Spin } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Breadcrumb } from './Breadcrumb';
import { DirectoryGallery } from './DirectoryGallery';
import { ImageViewer } from './viewers/ImageViewer';
import { DepthViewer } from './viewers/DepthViewer';
import { MaskViewer } from './viewers/MaskViewer';
import { JsonViewer } from './viewers/JsonViewer';
import { TextViewer } from './viewers/TextViewer';
import { VideoViewer } from './viewers/VideoViewer';
import { getTupleByKey } from '../tuples/registry';
import type { FileNode, VizMode, FileInfo } from '../types';
import { IMAGE_EXTS, VIDEO_EXTS, TEXT_EXTS, TEXT_NAMES } from '../constants';

interface MainPanelProps {
  selectedNode?: FileNode;
  vizMode: VizMode;
  treeData: FileNode | null;
  apiBase: string;
  rootDir?: string;
  autoplay?: boolean;
  gridScale?: number;
  onNavigate?: (path: string) => void;
}

type FileType = 'image' | 'depth' | 'mask' | 'json' | 'text' | 'video' | 'unknown';

function detectFileType(node: FileNode): FileType {
  const ext = node.extension || '';
  const path = node.path.toLowerCase();
  const nameLower = node.name.toLowerCase();

  // Video
  if (VIDEO_EXTS.has(ext)) return 'video';

  // Depth/mask by naming convention (must be image extension)
  if (path.includes('depth') && IMAGE_EXTS.has(ext)) return 'depth';
  if (path.includes('mask') && IMAGE_EXTS.has(ext)) return 'mask';

  // Image
  if (IMAGE_EXTS.has(ext)) return 'image';

  // JSON
  if (ext === '.json') return 'json';

  // Text by extension
  if (TEXT_EXTS.has(ext)) return 'text';

  // Text by filename (no extension or known text filename)
  if (!ext && TEXT_NAMES.has(nameLower)) return 'text';

  // Heuristic: files with no extension or common code-like extensions → treat as text
  if (!ext || ext === '.') return 'text';

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

/**
 * Hook to lazy-load directory children when a directory node has no children loaded.
 */
function useLazyDirectoryChildren(node: FileNode | undefined, apiBase: string): [FileNode | undefined, boolean] {
  const [enrichedNode, setEnrichedNode] = useState<FileNode | undefined>(node);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!node || node.type !== 'directory') {
      setEnrichedNode(node);
      return;
    }

    // If children are already loaded, use as-is
    if (node.children && node.children.length > 0) {
      setEnrichedNode(node);
      return;
    }

    // Need to fetch children
    setLoading(true);
    fetch(`${apiBase}/api/directory?path=${encodeURIComponent(node.path)}&depth=1`)
      .then(r => r.json())
      .then((data: FileNode) => {
        setEnrichedNode(data);
      })
      .catch(() => {
        setEnrichedNode(node);
      })
      .finally(() => setLoading(false));
  }, [node?.path, node?.type, apiBase]);

  return [enrichedNode, loading];
}

export function MainPanel({ selectedNode, vizMode, treeData, apiBase, rootDir, autoplay, gridScale = 0.3, onNavigate }: MainPanelProps) {
  const [dirNode, dirLoading] = useLazyDirectoryChildren(
    selectedNode?.type === 'directory' ? selectedNode : undefined,
    apiBase
  );

  const allFiles = useMemo(() => treeData ? collectFiles(treeData) : [], [treeData]);

  // Tuple mode
  if (vizMode !== 'single' && treeData) {
    const tupleType = getTupleByKey(vizMode);
    if (tupleType) {
      const matches = tupleType.matcher(allFiles, selectedNode);
      if (matches.length > 0) {
        const TupleComponent = tupleType.component;
        // Single match → full view; multiple → grid
        if (matches.length === 1) {
          return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {rootDir && onNavigate && (
                <Breadcrumb path={selectedNode?.path} rootDir={rootDir} onNavigate={onNavigate} />
              )}
              <TupleComponent match={matches[0]} apiBase={apiBase} />
            </div>
          );
        }
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {rootDir && onNavigate && (
              <Breadcrumb path={selectedNode?.path} rootDir={rootDir} onNavigate={onNavigate} />
            )}
            <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(gridScale * 100)}%, 1fr))`,
                gap: 8,
              }}>
                {matches.map((match, i) => (
                  <div key={match.label + i} style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: 6,
                    overflow: 'hidden',
                    background: 'var(--bg-secondary)',
                    minHeight: 200,
                    display: 'flex',
                    flexDirection: 'column',
                  }}>
                    <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                      {match.label}
                    </div>
                    <div style={{ flex: 1, position: 'relative' }}>
                      <TupleComponent match={match} apiBase={apiBase} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
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

  // Directory → gallery (with lazy loading)
  if (selectedNode.type === 'directory') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {rootDir && onNavigate && (
          <Breadcrumb path={selectedNode.path} rootDir={rootDir} onNavigate={onNavigate} />
        )}
        {dirLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin tip="Loading directory..." />
          </div>
        ) : (
          <DirectoryGallery node={dirNode || selectedNode} apiBase={apiBase} autoplay={autoplay} gridScale={gridScale} onFileSelect={(f) => onNavigate?.(f.path)} />
        )}
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
      {fileType === 'video' && <VideoViewer src={fileSrc} name={selectedNode.name} autoplay={autoplay} />}
      {fileType === 'unknown' && (
        <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
          Preview not available for this file type ({selectedNode.extension || 'unknown'})
        </div>
      )}
    </div>
  );
}
