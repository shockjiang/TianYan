import { useState, useEffect, useCallback, useRef } from 'react';
import { ConfigProvider, theme as antdTheme, message } from 'antd';
import { TopPanel } from './components/TopPanel';
import { FileTree } from './components/FileTree';
import { MainPanel } from './components/MainPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useTheme } from './hooks/useTheme';
import { getUrlState, useUrlStateSync, useResolveAlias } from './hooks/useUrlState';
import { useDirectoryHistory } from './hooks/useDirectoryHistory';
import { useRecentFiles } from './hooks/useRecentFiles';
import { useTreeStream } from './hooks/useTreeStream';
import type { FileNode, VizMode } from './types';
import './App.css';

const API_BASE = '';

function mergeChildren(tree: FileNode, targetPath: string, children: FileNode[]): FileNode {
  if (tree.path === targetPath) {
    return { ...tree, children, hasChildren: children.length > 0 };
  }
  if (tree.children) {
    return {
      ...tree,
      children: tree.children.map(child => mergeChildren(child, targetPath, children)),
    };
  }
  return tree;
}

function findNodeByPath(tree: FileNode | null, path: string): FileNode | undefined {
  if (!tree) return undefined;
  if (tree.path === path) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findNodeByPath(child, path);
      if (found) return found;
    }
  }
  return undefined;
}

function App() {
  const [theme, toggleTheme] = useTheme();
  const { history: dirHistory, addToHistory } = useDirectoryHistory();
  const { recentFiles, addRecentFile } = useRecentFiles();

  const urlState = getUrlState();
  const [rootDir, setRootDir] = useState(urlState.root || '');
  const [vizMode, setVizMode] = useState<VizMode>(urlState.viz || 'single');
  const [selectedPath, setSelectedPath] = useState<string | undefined>(urlState.file);
  const [selectedNode, setSelectedNode] = useState<FileNode | undefined>();
  const [treeData, setTreeData] = useState<FileNode | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [leftWidth, setLeftWidth] = useState(() => {
    return parseInt(localStorage.getItem('tianyan-left-width') || '280');
  });
  const [autoplay, setAutoplay] = useState(() => {
    return localStorage.getItem('tianyan-video-autoplay') === 'true';
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [gridScale, setGridScale] = useState(() => {
    return parseFloat(localStorage.getItem('tianyan-grid-scale') || '0.3');
  });

  const handleGridScaleChange = (val: number) => {
    setGridScale(val);
    localStorage.setItem('tianyan-grid-scale', String(val));
  };

  const treeDataRef = useRef(treeData);
  useEffect(() => { treeDataRef.current = treeData; }, [treeData]);

  const { scanning, scanProgress } = useTreeStream(rootDir, treeData, setTreeData);

  const handleAutoplayChange = (val: boolean) => {
    setAutoplay(val);
    localStorage.setItem('tianyan-video-autoplay', String(val));
  };

  useUrlStateSync({ root: rootDir, viz: vizMode, file: selectedPath });

  // Resolve alias from URL on first load (e.g., ?a=ph7k|data/out)
  useResolveAlias((resolved) => {
    if (resolved.root) {
      setRootDir(resolved.root);
      if (resolved.viz) setVizMode(resolved.viz);
      if (resolved.file) {
        setSelectedPath(resolved.file);
        pendingFileNav.current = resolved.file;
      }
      loadDirectory(resolved.root);
    }
  });

  // 'f' key toggles fullscreen (only when not typing in an input)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setFullscreen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const loadDirectory = useCallback(async (path: string) => {
    if (!path) return;
    try {
      const res = await fetch(`${API_BASE}/api/directory?path=${encodeURIComponent(path)}&depth=2`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setTreeData(data);
      addToHistory(path);
    } catch (err: any) {
      console.error('Failed to load directory:', err);
      message.error(`Failed to load directory: ${err.message || 'Unknown error'}`);
      setTreeData(null);
    }
  }, [addToHistory]);

  // Load children for a directory node and merge into tree
  const loadChildren = useCallback(async (dirPath: string) => {
    // If children already loaded by background stream, just force a re-render
    // so Ant Design Tree picks up the existing children in the DataNode
    const existing = findNodeByPath(treeDataRef.current, dirPath);
    if (existing?.children && existing.children.length > 0) {
      setTreeData(prev => prev ? { ...prev } : prev);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/directory?path=${encodeURIComponent(dirPath)}&depth=1`);
      if (!res.ok) return;
      const data: FileNode = await res.json();
      setTreeData(prev => {
        if (!prev) return prev;
        return mergeChildren(prev, dirPath, data.children || []);
      });
    } catch (err) {
      console.error('Failed to load children:', err);
    }
  }, []);

  // Navigate to a file path: load ancestor dirs, expand tree, select file
  const navigateToFile = useCallback(async (filePath: string) => {
    if (!rootDir || !treeData) return;
    const normRoot = rootDir.replace(/\/+$/, '');
    if (!filePath.startsWith(normRoot)) return;

    const relative = filePath.slice(normRoot.length).replace(/^\//, '');
    if (!relative) return;
    const parts = relative.split('/');
    const keysToExpand: string[] = [normRoot];

    // Load each segment (ancestors + target itself if it's a directory)
    let currentTree = treeData;
    for (let i = 0; i < parts.length; i++) {
      const dirPath = normRoot + '/' + parts.slice(0, i + 1).join('/');
      keysToExpand.push(dirPath);
      const node = findNodeByPath(currentTree, dirPath);
      if (!node || (node.type === 'directory' && (!node.children || node.children.length === 0))) {
        try {
          const parentPath = i === 0 ? normRoot : normRoot + '/' + parts.slice(0, i).join('/');
          // Load the parent so this segment appears in the tree
          const res = await fetch(`${API_BASE}/api/directory?path=${encodeURIComponent(parentPath)}&depth=1`);
          if (res.ok) {
            const data: FileNode = await res.json();
            setTreeData(prev => {
              if (!prev) return prev;
              const updated = mergeChildren(prev, parentPath, data.children || []);
              currentTree = updated;
              return updated;
            });
            await new Promise(r => setTimeout(r, 50));
          }
        } catch { /* ignore */ }
      }
    }

    setExpandedKeys(prev => [...new Set([...prev, ...keysToExpand])]);

    // Select the target — look it up from the now-updated tree
    const found = findNodeByPath(treeDataRef.current, filePath);
    if (found) {
      handleSelect(found);
    } else {
      // Fallback: construct a node (detect type by presence of extension)
      const name = parts[parts.length - 1];
      const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
      const hasExt = name.includes('.');
      handleSelect({
        name, path: filePath,
        type: hasExt ? 'file' : 'directory',
        extension: hasExt ? ext : undefined,
      });
    }
  }, [rootDir, treeData]);

  const pendingFileNav = useRef<string | undefined>(urlState.file);

  useEffect(() => {
    if (rootDir) loadDirectory(rootDir);
  }, []);

  // After treeData loads, restore file from URL if pending
  useEffect(() => {
    if (treeData && pendingFileNav.current) {
      const filePath = pendingFileNav.current;
      pendingFileNav.current = undefined;
      navigateToFile(filePath);
    }
  }, [treeData]);

  const handleRootSubmit = (path: string) => {
    pendingFileNav.current = undefined;
    setRootDir(path);
    setSelectedPath(undefined);
    setSelectedNode(undefined);
    setExpandedKeys([]);
    loadDirectory(path);
  };

  const handleSelect = (node: FileNode) => {
    setSelectedPath(node.path);
    setSelectedNode(node);
    if (node.type === 'file') {
      addRecentFile(node.path);
    }
  };

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftWidth;
    let currentWidth = startWidth;
    const onMove = (ev: MouseEvent) => {
      currentWidth = Math.min(500, Math.max(200, startWidth + ev.clientX - startX));
      setLeftWidth(currentWidth);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem('tianyan-left-width', String(currentWidth));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [leftWidth]);

  return (
    <ErrorBoundary>
    <ConfigProvider
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: '#4fc3f7' },
      }}
    >
      <div className="app">
        {!fullscreen && (
          <TopPanel
            rootDir={rootDir}
            dirHistory={dirHistory}
            vizMode={vizMode}
            theme={theme}
            autoplay={autoplay}
            fullscreen={fullscreen}
            gridScale={gridScale}
            selectedFile={selectedPath}
            onRootSubmit={handleRootSubmit}
            onVizChange={setVizMode}
            onThemeToggle={toggleTheme}
            onAutoplayChange={handleAutoplayChange}
            onFullscreenToggle={() => setFullscreen(f => !f)}
            onGridScaleChange={handleGridScaleChange}
          />
        )}
        <div className="app-body">
          {!fullscreen && (
            <>
              <div className="left-panel" style={{ width: leftWidth }}>
                <FileTree
                  treeData={treeData}
                  selectedPath={selectedPath}
                  recentFiles={recentFiles}
                  expandedKeys={expandedKeys}
                  onExpandedKeysChange={setExpandedKeys}
                  onSelect={handleSelect}
                  onLoadChildren={loadChildren}
                  onNavigateToFile={navigateToFile}
                  apiBase={API_BASE}
                  scanning={scanning}
                  scanProgress={scanProgress}
                />
              </div>
              <div className="panel-divider" onMouseDown={handleDragStart} />
            </>
          )}
          <div className="main-panel">
            <MainPanel
              selectedNode={selectedNode}
              vizMode={vizMode}
              treeData={treeData}
              apiBase={API_BASE}
              rootDir={rootDir}
              autoplay={autoplay}
              gridScale={gridScale}
              onNavigate={(path: string) => {
                const node = findNodeByPath(treeData, path);
                if (node) {
                  handleSelect(node);
                  // Expand the tree to this node's path
                  if (rootDir) {
                    const normRoot = rootDir.replace(/\/+$/, '');
                    const keysToExpand: string[] = [normRoot];
                    const relative = path.slice(normRoot.length).replace(/^\//, '');
                    if (relative) {
                      const parts = relative.split('/');
                      for (let i = 0; i < parts.length; i++) {
                        keysToExpand.push(normRoot + '/' + parts.slice(0, i + 1).join('/'));
                      }
                    }
                    setExpandedKeys(prev => [...new Set([...prev, ...keysToExpand])]);
                  }
                } else {
                  navigateToFile(path);
                }
              }}
            />
          </div>
        </div>
      </div>
    </ConfigProvider>
    </ErrorBoundary>
  );
}

export default App;
