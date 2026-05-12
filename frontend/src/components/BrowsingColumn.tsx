import { useCallback, useEffect, useRef } from 'react';
import { TopPanel } from './TopPanel';
import { FileTree } from './FileTree';
import { MainPanel } from './MainPanel';
import { ErrorBoundary } from './ErrorBoundary';
import { useSideController } from '../hooks/useSideController';
import type { SideState, FileNode } from '../types';

interface BrowsingColumnProps {
  side: 'A' | 'B';
  state: SideState;
  setState: React.Dispatch<React.SetStateAction<SideState>>;
  treePosition: 'left' | 'right';
  collapsibleTree: boolean;
  dirHistory: string[];
  onAddDirHistory: (path: string) => void;
  onAddRecentFile: (path: string) => void;
  recentFiles: string[];
  autoplay: boolean;
  gridScale: number;
  fullscreen: boolean;
  treeWidth: number;
  onTreeWidthChange?: (w: number) => void;
  apiBase: string;
}

function findNodeByPath(tree: FileNode | null, path: string): FileNode | undefined {
  if (!tree) return undefined;
  if (tree.path === path) return tree;
  if (tree.children) {
    for (const c of tree.children) {
      const f = findNodeByPath(c, path);
      if (f) return f;
    }
  }
  return undefined;
}

export function BrowsingColumn({
  side, state, setState, treePosition, collapsibleTree,
  dirHistory, onAddDirHistory, onAddRecentFile, recentFiles,
  autoplay, gridScale, fullscreen,
  treeWidth, onTreeWidthChange,
  apiBase,
}: BrowsingColumnProps) {
  const ctrl = useSideController(state, setState, onAddRecentFile, onAddDirHistory);
  const ctrlRef = useRef(ctrl);
  ctrlRef.current = ctrl;

  // Single source of truth for triggering loadDirectory: this effect.
  // - Initial mount with a URL-supplied root → load.
  // - Alias / share-code resolution mutates state.rootDir → load.
  // - Compare mirror creates sideB with treeData=null → load.
  // - User submits via TopPanel → setRoot nulls treeData → load.
  // - Same-path Load click also nulls treeData → load (refresh).
  // Deduped by an in-flight ref so re-renders mid-fetch don't refire.
  // Important: any treeData (even with a server-resolved path that differs
  // from the user-typed rootDir, e.g. across a symlink) means the fetch
  // for this rootDir is no longer in flight — clear the gate so the next
  // setRoot(treeData=null) can re-fetch.
  const loadingRootRef = useRef<string>('');
  useEffect(() => {
    if (!state.rootDir) return;
    if (state.treeData) {
      loadingRootRef.current = '';
      return;
    }
    if (loadingRootRef.current === state.rootDir) return;
    loadingRootRef.current = state.rootDir;
    ctrlRef.current.loadDirectory(state.rootDir);
  }, [state.rootDir, state.treeData]);

  // After the tree loads, expand to and select the URL-supplied file
  // (or the file queued by setRoot when the user pasted a file path).
  // Driven by state instead of a ref so async alias resolution that sets
  // selectedPath after mount also gets picked up. Selecting a node sets
  // selectedNode, which gates this effect against re-firing.
  useEffect(() => {
    if (!state.treeData) return;
    if (!state.selectedPath) return;
    if (state.selectedNode) return;
    ctrlRef.current.navigateToFile(state.selectedPath);
  }, [state.treeData, state.selectedPath, state.selectedNode]);

  const handleNavigate = useCallback((path: string) => {
    const node = findNodeByPath(state.treeData, path);
    if (node) {
      ctrl.selectNode(node);
      if (state.rootDir) {
        const normRoot = state.rootDir.replace(/\/+$/, '');
        const keysToExpand: string[] = [normRoot];
        const relative = path.slice(normRoot.length).replace(/^\//, '');
        if (relative) {
          const parts = relative.split('/');
          for (let i = 0; i < parts.length; i++) {
            keysToExpand.push(normRoot + '/' + parts.slice(0, i + 1).join('/'));
          }
        }
        ctrl.setExpandedKeys([...new Set([...state.expandedKeys, ...keysToExpand])]);
      }
    } else {
      ctrl.navigateToFile(path);
    }
  }, [state.treeData, state.rootDir, state.expandedKeys, ctrl]);

  const handleTreeDragStart = useCallback((e: React.MouseEvent) => {
    if (!onTreeWidthChange) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = treeWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = treePosition === 'left' ? (ev.clientX - startX) : (startX - ev.clientX);
      const next = Math.min(500, Math.max(200, startWidth + delta));
      onTreeWidthChange(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [treeWidth, treePosition, onTreeWidthChange]);

  const showTree = !fullscreen && (!collapsibleTree || !state.treeCollapsed);
  const showCollapseStrip = !fullscreen && collapsibleTree && state.treeCollapsed;

  const treeOrder = treePosition === 'left' ? 0 : 2;
  const dividerOrder = treePosition === 'left' ? 1 : 1;
  const mainOrder = 1;

  return (
    <div className="browsing-column" data-side={side} style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
      {!fullscreen && (
        <TopPanel
          rootDir={state.rootDir}
          dirHistory={dirHistory}
          vizMode={state.vizMode}
          onRootSubmit={ctrl.setRoot}
          onVizChange={ctrl.setViz}
        />
      )}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {showTree && (
          <>
            <div
              className="left-panel"
              style={{
                width: treeWidth,
                borderRight: treePosition === 'left' ? '1px solid var(--border-color)' : 'none',
                borderLeft: treePosition === 'right' ? '1px solid var(--border-color)' : 'none',
                order: treeOrder,
              }}
            >
              {collapsibleTree && (
                <div style={{
                  display: 'flex',
                  justifyContent: treePosition === 'left' ? 'flex-end' : 'flex-start',
                  padding: '4px 6px',
                  borderBottom: '1px solid var(--border-color)',
                }}>
                  <button
                    onClick={() => ctrl.setTreeCollapsed(true)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: 14,
                    }}
                    title="Collapse tree"
                  >×</button>
                </div>
              )}
              <FileTree
                treeData={state.treeData}
                selectedPath={state.selectedPath}
                recentFiles={recentFiles}
                expandedKeys={state.expandedKeys}
                onExpandedKeysChange={ctrl.setExpandedKeys}
                onSelect={ctrl.selectNode}
                onLoadChildren={ctrl.loadChildren}
                onNavigateToFile={ctrl.navigateToFile}
                apiBase={apiBase}
                scanning={ctrl.scanning}
                scanProgress={ctrl.scanProgress}
              />
            </div>
            {!collapsibleTree && (
              <div
                className="panel-divider"
                style={{ order: dividerOrder }}
                onMouseDown={handleTreeDragStart}
              />
            )}
          </>
        )}
        {showCollapseStrip && (
          <div
            style={{
              width: 28,
              background: 'var(--bg-secondary)',
              borderRight: treePosition === 'left' ? '1px solid var(--border-color)' : 'none',
              borderLeft: treePosition === 'right' ? '1px solid var(--border-color)' : 'none',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-start',
              paddingTop: 8,
              flexShrink: 0,
              order: treeOrder,
            }}
          >
            <button
              onClick={() => ctrl.setTreeCollapsed(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 18,
                padding: 0,
              }}
              title="Expand tree"
            >≡</button>
          </div>
        )}
        <div className="main-panel" style={{ order: mainOrder, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <ErrorBoundary resetKey={state.selectedPath}>
            <MainPanel
              selectedNode={state.selectedNode}
              vizMode={state.vizMode}
              treeData={state.treeData}
              apiBase={apiBase}
              rootDir={state.rootDir}
              autoplay={autoplay}
              gridScale={gridScale}
              onNavigate={handleNavigate}
            />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
