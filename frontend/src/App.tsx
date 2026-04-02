import { useState, useEffect, useCallback, useRef } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import { TopPanel } from './components/TopPanel';
import { FileTree } from './components/FileTree';
import { MainPanel } from './components/MainPanel';
import { useTheme } from './hooks/useTheme';
import { getUrlState, useUrlStateSync, useResolveAlias } from './hooks/useUrlState';
import { useDirectoryHistory } from './hooks/useDirectoryHistory';
import { useRecentFiles } from './hooks/useRecentFiles';
import type { FileNode, VizMode } from './types';
import './App.css';

const API_BASE = '';

function mergeChildren(tree: FileNode, targetPath: string, children: FileNode[]): FileNode {
  if (tree.path === targetPath) {
    return { ...tree, children };
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
      setTreeData(null);
    }
  }, [addToHistory]);

  // Load children for a directory node and merge into tree
  const loadChildren = useCallback(async (dirPath: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/directory?path=${encodeURIComponent(dirPath)}&depth=1`);
      if (!res.ok) return;
      const data: FileNode = await res.json();
      // Merge children into existing tree
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
    const parts = relative.split('/');
    const keysToExpand: string[] = [normRoot];

    // Load each ancestor directory
    let currentTree = treeData;
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = normRoot + '/' + parts.slice(0, i + 1).join('/');
      keysToExpand.push(dirPath);
      const node = findNodeByPath(currentTree, dirPath);
      if (node && (!node.children || node.children.length === 0)) {
        // Need to load this directory
        try {
          const res = await fetch(`${API_BASE}/api/directory?path=${encodeURIComponent(dirPath)}&depth=1`);
          if (res.ok) {
            const data: FileNode = await res.json();
            setTreeData(prev => {
              if (!prev) return prev;
              const updated = mergeChildren(prev, dirPath, data.children || []);
              currentTree = updated;
              return updated;
            });
            // Wait for state to settle
            await new Promise(r => setTimeout(r, 50));
          }
        } catch { /* ignore */ }
      }
    }

    setExpandedKeys(prev => [...new Set([...prev, ...keysToExpand])]);

    // Select the file
    const fileName = parts[parts.length - 1];
    const ext = fileName.includes('.') ? '.' + fileName.split('.').pop()!.toLowerCase() : '';
    const fileNode = findNodeByPath(treeData, filePath) || {
      name: fileName, path: filePath, type: 'file' as const, extension: ext,
    };
    handleSelect(fileNode);
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
    setRootDir(path);
    setSelectedPath(undefined);
    setSelectedNode(undefined);
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
    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.min(500, Math.max(200, startWidth + ev.clientX - startX));
      setLeftWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem('tianyan-left-width', String(leftWidth));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [leftWidth]);

  return (
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
            selectedFile={selectedPath}
            onRootSubmit={handleRootSubmit}
            onVizChange={setVizMode}
            onThemeToggle={toggleTheme}
            onAutoplayChange={handleAutoplayChange}
            onFullscreenToggle={() => setFullscreen(f => !f)}
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
              onNavigate={(path: string) => {
                const node = findNodeByPath(treeData, path);
                if (node) handleSelect(node);
              }}
            />
          </div>
        </div>
      </div>
    </ConfigProvider>
  );
}

export default App;
