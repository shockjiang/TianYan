import { useState, useEffect } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import { TopPanel } from './components/TopPanel';
import { GlobalHeader } from './components/GlobalHeader';
import { BrowsingColumn } from './components/BrowsingColumn';
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
  const [sideB, _setSideB] = useState<SideState | null>(null); // wired in Phase 5

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
  const handleAutoplayChange = (val: boolean) => {
    setAutoplay(val);
    localStorage.setItem('tianyan-video-autoplay', String(val));
  };
  const handleLeftWidthChange = (w: number) => {
    setLeftWidth(w);
    localStorage.setItem('tianyan-left-width', String(w));
  };

  useUrlStateSync({ root: sideA.rootDir, viz: sideA.vizMode, file: sideA.selectedPath });

  useResolveAlias((resolved) => {
    if (resolved.root) {
      setSideA(prev => ({
        ...prev,
        rootDir: resolved.root!,
        vizMode: (resolved.viz as VizMode) || prev.vizMode,
        selectedPath: resolved.file ?? prev.selectedPath,
      }));
    }
  });

  // 'f' key toggles fullscreen
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
            onCompareToggle={() => { /* Phase 5 */ }}
            onExitKeepLeft={() => { /* Phase 5 */ }}
            onExitKeepRight={() => { /* Phase 5 */ }}
          />
        )}
        <div className="app-body">
          <BrowsingColumn
            side="A"
            state={sideA}
            setState={setSideA}
            treePosition="left"
            collapsibleTree={false}
            dirHistory={dirHistory}
            onAddDirHistory={addToHistory}
            onAddRecentFile={addRecentFile}
            recentFiles={recentFiles}
            autoplay={autoplay}
            gridScale={gridScale}
            fullscreen={fullscreen}
            treeWidth={leftWidth}
            onTreeWidthChange={handleLeftWidthChange}
            apiBase=""
          />
        </div>
      </div>
    </ConfigProvider>
  );
}

export default App;
