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
import { PickleViewer } from './viewers/PickleViewer';
import { TabularViewer } from './viewers/TabularViewer';
import { NpyViewer } from './viewers/NpyViewer';
import { PlyViewer } from './viewers/PlyViewer';
import { UsdViewer } from './viewers/UsdViewer';
import { H5Viewer } from './viewers/H5Viewer';
import { HtmlViewer } from './viewers/HtmlViewer';
import { getTupleByKey } from '../tuples/registry';
import type { FileNode, VizMode, FileInfo } from '../types';
import { IMAGE_EXTS, VIDEO_EXTS, TEXT_EXTS, TEXT_NAMES, TABULAR_EXTS, PLY_EXTS, USD_EXTS, H5_EXTS, HTML_EXTS } from '../constants';

interface MainPanelProps {
  selectedNode?: FileNode;
  vizMode: VizMode;
  treeData: FileNode | null;
  apiBase: string;
  rootDir?: string;
  autoplay?: boolean;
  gridScale?: number;
  onNavigate?: (path: string) => void;
  onCurrentDatasetKeyChange?: (key: string | null) => void;
}

const PICKLE_EXTS = new Set(['.pkl', '.pickle', '.pth']);
const NPY_EXTS = new Set(['.npy', '.npz']);

type FileType = 'image' | 'depth' | 'mask' | 'json' | 'text' | 'video' | 'pickle' | 'tabular' | 'npy' | 'ply' | 'usd' | 'h5' | 'html' | 'unknown';

function detectFileType(node: FileNode): FileType {
  const ext = node.extension || '';
  const path = node.path.toLowerCase();
  const nameLower = node.name.toLowerCase();

  // 3D point cloud / mesh
  if (PLY_EXTS.has(ext)) return 'ply';
  if (USD_EXTS.has(ext)) return 'usd';

  // HDF5
  if (H5_EXTS.has(ext)) return 'h5';

  // HTML (rendered) — checked before TEXT_EXTS so .html doesn't fall to text
  if (HTML_EXTS.has(ext)) return 'html';

  // Video
  if (VIDEO_EXTS.has(ext)) return 'video';

  // Tabular (jsonl, parquet) — check before text/json
  if (TABULAR_EXTS.has(ext)) return 'tabular';

  // Depth/mask by naming convention (must be image extension)
  if (path.includes('depth') && IMAGE_EXTS.has(ext)) return 'depth';
  if (path.includes('mask') && IMAGE_EXTS.has(ext)) return 'mask';

  // Image
  if (IMAGE_EXTS.has(ext)) return 'image';

  // Numpy arrays
  if (NPY_EXTS.has(ext)) return 'npy';

  // Pickle
  if (PICKLE_EXTS.has(ext)) return 'pickle';

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

/** Prefetch sibling file URLs so the browser caches them for instant display */
function usePrefetchSiblings(selectedNode: FileNode | undefined, treeData: FileNode | null, apiBase: string) {
  useEffect(() => {
    if (!selectedNode || selectedNode.type !== 'file' || !treeData) return;
    const ext = selectedNode.extension || '';
    if (!IMAGE_EXTS.has(ext)) return;

    // Find parent directory
    const parentPath = selectedNode.path.substring(0, selectedNode.path.lastIndexOf('/'));
    const parent = findNode(treeData, parentPath);
    if (!parent?.children) return;

    const siblings = parent.children.filter(c => c.type === 'file' && c.extension && IMAGE_EXTS.has(c.extension));
    const idx = siblings.findIndex(s => s.path === selectedNode.path);
    if (idx < 0) return;

    // Prefetch next 3 siblings
    const toPrefetch = siblings.slice(idx + 1, idx + 4);
    for (const s of toPrefetch) {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = `${apiBase}/api/file?path=${encodeURIComponent(s.path)}`;
      link.as = 'image';
      document.head.appendChild(link);
      // Clean up after 30s
      setTimeout(() => link.remove(), 30000);
    }
  }, [selectedNode?.path]);
}

function findNode(node: FileNode, path: string): FileNode | undefined {
  if (node.path === path) return node;
  if (node.children) {
    for (const c of node.children) {
      const found = findNode(c, path);
      if (found) return found;
    }
  }
  return undefined;
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

export function MainPanel({ selectedNode, vizMode, treeData, apiBase, rootDir, autoplay, gridScale = 0.3, onNavigate, onCurrentDatasetKeyChange }: MainPanelProps) {
  const [dirNode, dirLoading] = useLazyDirectoryChildren(
    selectedNode?.type === 'directory' ? selectedNode : undefined,
    apiBase
  );

  // Prefetch next sibling images for instant navigation
  usePrefetchSiblings(selectedNode, treeData, apiBase);

  const allFiles = useMemo(() => treeData ? collectFiles(treeData) : [], [treeData]);

  const tupleType = vizMode !== 'single' ? getTupleByKey(vizMode) : undefined;
  const tupleMatches = useMemo(() => {
    if (!tupleType || !allFiles.length) return [];
    return tupleType.matcher(allFiles, selectedNode);
  }, [tupleType, allFiles, selectedNode]);

  // Tuple mode
  if (vizMode !== 'single' && treeData) {
    if (tupleType) {
      const matches = tupleMatches;
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
      {fileType === 'pickle' && <PickleViewer path={selectedNode.path} name={selectedNode.name} apiBase={apiBase} />}
      {fileType === 'npy' && <NpyViewer path={selectedNode.path} name={selectedNode.name} apiBase={apiBase} onCurrentKeyChange={onCurrentDatasetKeyChange} />}
      {fileType === 'ply' && <PlyViewer src={fileSrc} name={selectedNode.name} />}
      {fileType === 'usd' && <UsdViewer src={fileSrc} name={selectedNode.name} apiBase={apiBase} path={selectedNode.path} />}
      {fileType === 'h5' && <H5Viewer path={selectedNode.path} name={selectedNode.name} apiBase={apiBase} onCurrentKeyChange={onCurrentDatasetKeyChange} />}
      {fileType === 'html' && <HtmlViewer path={selectedNode.path} name={selectedNode.name} apiBase={apiBase} />}
      {fileType === 'tabular' && <TabularViewer path={selectedNode.path} name={selectedNode.name} apiBase={apiBase} />}
      {fileType === 'video' && <VideoViewer src={`${apiBase}/api/video?path=${encodeURIComponent(selectedNode.path)}`} name={selectedNode.name} autoplay={autoplay} />}
      {fileType === 'unknown' && (
        <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
          Preview not available for this file type ({selectedNode.extension || 'unknown'})
        </div>
      )}
    </div>
  );
}
