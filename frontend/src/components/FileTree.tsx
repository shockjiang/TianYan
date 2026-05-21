import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Tree, Input, message, Modal } from 'antd';
import { FolderOutlined, FileOutlined, FileImageOutlined, FileTextOutlined, VideoCameraOutlined, TableOutlined, CopyOutlined, DownloadOutlined, LoadingOutlined, EllipsisOutlined, EditOutlined, PlayCircleOutlined } from '@ant-design/icons';
import type { FileNode } from '../types';
import type { DataNode, EventDataNode } from 'antd/es/tree';
import { IMAGE_EXTS, VIDEO_EXTS, TEXT_EXTS, TABULAR_EXTS } from '../constants';
import { exportSequenceToMp4 } from '../lib/exportMp4';

interface FileTreeProps {
  treeData: FileNode | null;
  selectedPath?: string;
  /** The dataset key currently chosen inside the viewer (H5 / NPZ).
   *  Passed through so right-click "Export as MP4" honors that pick
   *  instead of letting the backend auto-select the first sequence. */
  currentDatasetKey?: string;
  recentFiles: string[];
  expandedKeys: string[];
  onExpandedKeysChange: (keys: string[]) => void;
  onSelect: (node: FileNode) => void;
  onLoadChildren: (path: string) => Promise<void>;
  onNavigateToFile: (path: string) => void;
  onRenamed?: (oldPath: string, newPath: string, parent: string) => void;
  apiBase: string;
  scanning?: boolean;
  scanProgress?: { scanned: number };
}

const MAX_VISIBLE_CHILDREN = 500;

function getFileIcon(node: FileNode) {
  if (node.type === 'directory') return <FolderOutlined style={{ color: '#f0c040' }} />;
  if (node.extension && IMAGE_EXTS.has(node.extension)) return <FileImageOutlined style={{ color: '#4fc3f7' }} />;
  if (node.extension && VIDEO_EXTS.has(node.extension)) return <VideoCameraOutlined style={{ color: '#ff8a65' }} />;
  if (node.extension && TABULAR_EXTS.has(node.extension)) return <TableOutlined style={{ color: '#ce93d8' }} />;
  if (node.extension && (TEXT_EXTS.has(node.extension) || node.extension === '.json')) return <FileTextOutlined style={{ color: '#81c784' }} />;
  return <FileOutlined />;
}

function matchesFilter(name: string, filter: string): boolean {
  const f = filter.toLowerCase();
  const n = name.toLowerCase();
  if (f.includes('*') || f.includes('?')) {
    try {
      const escaped = f.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
      return new RegExp(`^${escaped}$`).test(n);
    } catch {
      return n.includes(f);
    }
  }
  return n.includes(f);
}

function buildTreeData(node: FileNode, filter: string): DataNode | null {
  if (node.type === 'file') {
    if (filter && !matchesFilter(node.name, filter)) return null;
    return {
      key: node.path,
      title: node.name,
      icon: getFileIcon(node),
      isLeaf: true,
    };
  }

  // children: undefined → not loaded; children: [] → loaded but may or may not be empty
  // Use hasChildren from backend to determine if directory truly has no children
  const hasRealChildren = node.children && node.children.length > 0;
  let children = hasRealChildren
    ? (node.children!.map(child => buildTreeData(child, filter)).filter(Boolean) as DataNode[])
    : undefined;

  if (filter && children && children.length === 0 && !matchesFilter(node.name, filter)) {
    return null;
  }

  // Truncate large directories in the tree view (filter still searches all)
  if (!filter && children && children.length > MAX_VISIBLE_CHILDREN) {
    const remaining = children.length - MAX_VISIBLE_CHILDREN;
    children = [
      ...children.slice(0, MAX_VISIBLE_CHILDREN),
      {
        key: `${node.path}/__more__`,
        title: `... ${remaining} more items (use filter to find)`,
        isLeaf: true,
        selectable: false,
        icon: <EllipsisOutlined style={{ color: 'var(--text-secondary)' }} />,
      },
    ];
  }

  // Only mark as leaf if backend explicitly says no children
  const isLeaf = node.hasChildren === false;

  return {
    key: node.path,
    title: node.name,
    icon: getFileIcon(node),
    children,
    isLeaf,
  };
}

function buildNodeMap(node: FileNode, map: Map<string, FileNode>) {
  map.set(node.path, node);
  if (node.children) {
    for (const child of node.children) buildNodeMap(child, map);
  }
}

export function FileTree({ treeData, selectedPath, currentDatasetKey, recentFiles, expandedKeys, onExpandedKeysChange, onSelect, onLoadChildren, onNavigateToFile, onRenamed, apiBase, scanning, scanProgress }: FileTreeProps) {
  const [filter, setFilter] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const [treeHeight, setTreeHeight] = useState(400);

  // Debounce filter to avoid rebuilding tree on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilter(filter), 200);
    return () => clearTimeout(t);
  }, [filter]);

  // Measure tree container height for virtual scrolling
  useEffect(() => {
    const el = treeContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setTreeHeight(Math.floor(entry.contentRect.height));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string; isFile: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [renameTarget, setRenameTarget] = useState<{ path: string; currentName: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Forward the dataset key the viewer has selected so multi-dataset files
  // (.h5 / .npz) export the user's chosen sequence rather than the
  // backend's auto-pick. Only applied when right-clicking the same file
  // that's currently selected in the tree.
  const exportMp4 = useCallback((path: string) => {
    const key = (selectedPath && path === selectedPath) ? currentDatasetKey : undefined;
    return exportSequenceToMp4({ apiBase, path, key, fps: 10 });
  }, [apiBase, selectedPath, currentDatasetKey]);

  const doRename = useCallback(async () => {
    if (!renameTarget) return;
    const next = renameValue.trim();
    if (!next || next === renameTarget.currentName) { setRenameTarget(null); return; }
    if (next.includes('/') || next.includes('\\') || next === '.' || next === '..') {
      message.error('Name must be a plain basename (no slashes)');
      return;
    }
    setRenaming(true);
    try {
      const res = await fetch(`${apiBase}/api/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: renameTarget.path, new_name: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      message.success(`Renamed to ${data.name}`);
      onRenamed?.(data.old_path, data.new_path, data.parent);
      setRenameTarget(null);
    } catch (e: any) {
      message.error(`Rename failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setRenaming(false);
    }
  }, [apiBase, renameTarget, renameValue, onRenamed]);

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [contextMenu]);

  const handleRightClick = ({ event, node }: { event: React.MouseEvent; node: EventDataNode<DataNode> }) => {
    event.preventDefault();
    event.stopPropagation();
    const fileNode = nodeMap.get(node.key as string);
    setContextMenu({ x: event.clientX, y: event.clientY, path: node.key as string, isFile: fileNode?.type === 'file' });
  };

  const copyPath = () => {
    if (!contextMenu) return;
    const path = contextMenu.path;
    try {
      const blob = new Blob([path], { type: 'text/plain' });
      navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': blob })
      ]).then(() => {
        message.success('Path copied');
      }).catch(() => {
        fallbackCopy(path);
      });
    } catch {
      fallbackCopy(path);
    }
    setContextMenu(null);
  };

  const fallbackCopy = (text: string) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    message.success('Path copied');
  };

  const nodeMap = useMemo(() => {
    const map = new Map<string, FileNode>();
    if (treeData) buildNodeMap(treeData, map);
    return map;
  }, [treeData]);

  const antTreeData = useMemo(() => {
    if (!treeData) return [];
    const root = buildTreeData(treeData, debouncedFilter);
    return root ? (root.children || [root]) : [];
  }, [treeData, debouncedFilter]);

  const handleSelect = (_: any, info: { node: EventDataNode<DataNode> }) => {
    const key = info.node.key as string;
    const node = nodeMap.get(key);
    if (node) {
      onSelect(node);
      // Toggle expand/collapse for directories (onSelect fires on label click,
      // onExpand fires on triangle click — they are separate events, no conflict)
      if (node.type === 'directory') {
        if (expandedKeys.includes(key)) {
          onExpandedKeysChange(expandedKeys.filter(k => k !== key));
        } else {
          onExpandedKeysChange([...expandedKeys, key]);
        }
      }
    }
  };

  const handleLoadData = useCallback((treeNode: DataNode): Promise<void> => {
    return onLoadChildren(treeNode.key as string);
  }, [onLoadChildren]);

  const handleExpand = (keys: any) => {
    onExpandedKeysChange(keys as string[]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 8px 4px' }}>
        <Input.Search
          placeholder="Filter files... (supports *.mp4)"
          size="small"
          allowClear
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>
      {scanning && (
        <div style={{ padding: '2px 8px', fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <LoadingOutlined spin /> Scanning... {scanProgress?.scanned ?? 0} entries
        </div>
      )}
      <div ref={treeContainerRef} style={{ flex: 1, overflow: 'hidden', padding: '0 4px' }}>
        {antTreeData.length > 0 ? (
          <Tree
            treeData={antTreeData}
            selectedKeys={selectedPath ? [selectedPath] : []}
            expandedKeys={expandedKeys}
            onExpand={handleExpand}
            onSelect={(_, info) => handleSelect(_, info)}
            onRightClick={handleRightClick}
            loadData={handleLoadData}
            showIcon
            blockNode
            autoExpandParent={false}
            height={treeHeight}
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
                onClick={() => onNavigateToFile(f)}
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
      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 1000,
            padding: '4px 0',
            minWidth: 160,
          }}
        >
          <div
            onClick={copyPath}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--text-primary)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--hover-bg)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <CopyOutlined /> Copy Path
          </div>
          <div
            onClick={() => {
              const url = `${apiBase}/api/download?path=${encodeURIComponent(contextMenu.path)}`;
              const a = document.createElement('a');
              a.href = url;
              const name = contextMenu.path.split('/').pop() || 'download';
              a.download = contextMenu.isFile ? name : name + '.zip';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setContextMenu(null);
            }}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--text-primary)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--hover-bg)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <DownloadOutlined /> {contextMenu.isFile ? 'Download' : 'Download as ZIP'}
          </div>
          <div
            onClick={() => {
              const name = contextMenu.path.split('/').pop() || '';
              setRenameTarget({ path: contextMenu.path, currentName: name });
              setRenameValue(name);
              setContextMenu(null);
            }}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--text-primary)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--hover-bg)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <EditOutlined /> Rename
          </div>
          {contextMenu.isFile && (() => {
            const lower = contextMenu.path.toLowerCase();
            const exportable = lower.endsWith('.h5') || lower.endsWith('.hdf5')
                            || lower.endsWith('.npy') || lower.endsWith('.npz');
            if (!exportable) return null;
            const target = contextMenu.path;
            return (
              <div
                onClick={() => { setContextMenu(null); exportMp4(target); }}
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  color: 'var(--text-primary)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--hover-bg)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <PlayCircleOutlined /> Export as MP4
              </div>
            );
          })()}
        </div>
      )}
      <Modal
        title="Rename"
        open={renameTarget !== null}
        onOk={doRename}
        onCancel={() => setRenameTarget(null)}
        okButtonProps={{ disabled: !renameValue.trim() || renameValue.trim() === renameTarget?.currentName }}
        confirmLoading={renaming}
        okText="Rename"
        destroyOnClose
      >
        <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
          {renameTarget?.path}
        </div>
        <Input
          autoFocus
          value={renameValue}
          onChange={e => setRenameValue(e.target.value)}
          onPressEnter={doRename}
          placeholder="New name"
        />
      </Modal>
    </div>
  );
}
