import { useState, useEffect, useCallback } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import { TopPanel } from './components/TopPanel';
import { FileTree } from './components/FileTree';
import { MainPanel } from './components/MainPanel';
import { useTheme } from './hooks/useTheme';
import { getUrlState, useUrlStateSync } from './hooks/useUrlState';
import { useDirectoryHistory } from './hooks/useDirectoryHistory';
import { useRecentFiles } from './hooks/useRecentFiles';
import type { FileNode, VizMode } from './types';
import './App.css';

const API_BASE = '';

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
  const [leftWidth, setLeftWidth] = useState(() => {
    return parseInt(localStorage.getItem('tianyan-left-width') || '280');
  });

  useUrlStateSync({ root: rootDir, viz: vizMode, file: selectedPath });

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

  useEffect(() => {
    if (rootDir) loadDirectory(rootDir);
  }, []);

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
        <TopPanel
          rootDir={rootDir}
          dirHistory={dirHistory}
          vizMode={vizMode}
          theme={theme}
          onRootSubmit={handleRootSubmit}
          onVizChange={setVizMode}
          onThemeToggle={toggleTheme}
        />
        <div className="app-body">
          <div className="left-panel" style={{ width: leftWidth }}>
            <FileTree
              treeData={treeData}
              selectedPath={selectedPath}
              recentFiles={recentFiles}
              onSelect={handleSelect}
              onLoadChildren={loadDirectory}
              apiBase={API_BASE}
            />
          </div>
          <div className="panel-divider" onMouseDown={handleDragStart} />
          <div className="main-panel">
            <MainPanel
              selectedNode={selectedNode}
              vizMode={vizMode}
              treeData={treeData}
              apiBase={API_BASE}
              rootDir={rootDir}
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
