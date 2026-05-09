import { useState, useEffect } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import { GlobalHeader } from './components/GlobalHeader';
import { BrowsingColumn } from './components/BrowsingColumn';
import { ColumnDivider } from './components/ColumnDivider';
import { useTheme } from './hooks/useTheme';
import { getUrlState, useUrlStateSync, useResolveAlias } from './hooks/useUrlState';
import { useDirectoryHistory } from './hooks/useDirectoryHistory';
import { useRecentFiles } from './hooks/useRecentFiles';
import type { VizMode, SideState } from './types';
import { initialSideState } from './types';
import './App.css';

function App() {
  const [theme, toggleTheme] = useTheme();
  const { history: dirHistory, addToHistory } = useDirectoryHistory();
  const { recentFiles, addRecentFile } = useRecentFiles();

  const urlState = getUrlState();
  const [sideA, setSideA] = useState<SideState>(initialSideState({
    rootDir: urlState.root || '',
    vizMode: (urlState.viz as VizMode) || 'single',
    selectedPath: urlState.file,
  }));
  const [sideB, setSideB] = useState<SideState | null>(null);

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
  const [columnSplit, setColumnSplit] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem('tianyan-column-split') || '0.5');
    return isFinite(v) && v > 0.1 && v < 0.9 ? v : 0.5;
  });

  const handleGridScaleChange = (val: number) => {
    setGridScale(val);
    localStorage.setItem('tianyan-grid-scale', String(val));
  };
  const handleAutoplayChange = (val: boolean) => {
    setAutoplay(val);
    localStorage.setItem('tianyan-video-autoplay', String(val));
  };
  const handleLeftWidthChange = (w: number) => {
    setLeftWidth(w);
    localStorage.setItem('tianyan-left-width', String(w));
  };
  const handleColumnSplitChange = (next: number) => {
    setColumnSplit(next);
    localStorage.setItem('tianyan-column-split', String(next));
  };

  useUrlStateSync({
    a: { root: sideA.rootDir, viz: sideA.vizMode, file: sideA.selectedPath },
    b: sideB ? { root: sideB.rootDir, viz: sideB.vizMode, file: sideB.selectedPath } : null,
  });

  useResolveAlias((resolved) => {
    if (resolved.a?.root) {
      setSideA(prev => ({
        ...prev,
        rootDir: resolved.a.root!,
        vizMode: (resolved.a.viz as VizMode) || prev.vizMode,
        selectedPath: resolved.a.file ?? prev.selectedPath,
      }));
    }
    if (resolved.b?.root) {
      setSideB(initialSideState({
        rootDir: resolved.b.root,
        vizMode: (resolved.b.viz as VizMode) || 'single',
        selectedPath: resolved.b.file,
        treeCollapsed: true,
      }));
    }
  });

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

  const handleCompareToggle = () => {
    if (!sideA.rootDir) return;
    setSideB({
      ...sideA,
      treeCollapsed: false,
      treeData: null, // force re-fetch so each side has its own tree object
      expandedKeys: [],
    });
  };
  const handleExitKeepLeft = () => setSideB(null);
  const handleExitKeepRight = () => {
    if (!sideB) return;
    setSideA({ ...sideB, treeCollapsed: false });
    setSideB(null);
  };

  const onColumnDividerDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startSplit = columnSplit;
    const containerWidth = (e.currentTarget as HTMLElement).parentElement!.clientWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = (ev.clientX - startX) / containerWidth;
      const next = Math.max(0.15, Math.min(0.85, startSplit + delta));
      handleColumnSplitChange(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: '#4fc3f7' },
      }}
    >
      <div className="app">
        {!fullscreen && (
          <GlobalHeader
            theme={theme}
            autoplay={autoplay}
            gridScale={gridScale}
            sideA={sideA}
            sideB={sideB}
            onThemeToggle={toggleTheme}
            onAutoplayChange={handleAutoplayChange}
            onGridScaleChange={handleGridScaleChange}
            onFullscreenToggle={() => setFullscreen(f => !f)}
            onCompareToggle={handleCompareToggle}
            onExitKeepLeft={handleExitKeepLeft}
            onExitKeepRight={handleExitKeepRight}
          />
        )}
        <div className="app-body">
          <div style={{
            flex: sideB ? columnSplit : 1,
            display: 'flex',
            minWidth: 0,
            overflow: 'hidden',
          }}>
            <BrowsingColumn
              side="A"
              state={sideA}
              setState={setSideA}
              treePosition="left"
              collapsibleTree={sideB !== null}
              dirHistory={dirHistory}
              onAddDirHistory={addToHistory}
              onAddRecentFile={addRecentFile}
              recentFiles={recentFiles}
              autoplay={autoplay}
              gridScale={gridScale}
              fullscreen={fullscreen}
              treeWidth={leftWidth}
              onTreeWidthChange={sideB ? undefined : handleLeftWidthChange}
              apiBase=""
            />
          </div>
          {sideB && (
            <>
              <ColumnDivider onDragStart={onColumnDividerDragStart} />
              <div style={{
                flex: 1 - columnSplit,
                display: 'flex',
                minWidth: 0,
                overflow: 'hidden',
              }}>
                <BrowsingColumn
                  side="B"
                  state={sideB}
                  setState={setSideB as React.Dispatch<React.SetStateAction<SideState>>}
                  treePosition="right"
                  collapsibleTree={true}
                  dirHistory={dirHistory}
                  onAddDirHistory={addToHistory}
                  onAddRecentFile={addRecentFile}
                  recentFiles={recentFiles}
                  autoplay={autoplay}
                  gridScale={gridScale}
                  fullscreen={fullscreen}
                  treeWidth={leftWidth}
                  apiBase=""
                />
              </div>
            </>
          )}
        </div>
      </div>
    </ConfigProvider>
  );
}

export default App;
