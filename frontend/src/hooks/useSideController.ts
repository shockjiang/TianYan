import { useCallback, useEffect, useRef } from 'react';
import { message } from 'antd';
import type { FileNode, SideState, VizMode } from '../types';
import { useTreeStream } from './useTreeStream';

const API_BASE = '';

function mergeChildren(tree: FileNode, targetPath: string, children: FileNode[]): FileNode {
  if (tree.path === targetPath) {
    return { ...tree, children, hasChildren: children.length > 0 };
  }
  if (tree.children) {
    return { ...tree, children: tree.children.map(c => mergeChildren(c, targetPath, children)) };
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

export interface SideController {
  state: SideState;
  setState: React.Dispatch<React.SetStateAction<SideState>>;
  scanning: boolean;
  scanProgress: { scanned: number };
  loadDirectory: (path: string) => Promise<void>;
  loadChildren: (dirPath: string) => Promise<void>;
  navigateToFile: (filePath: string) => Promise<void>;
  selectNode: (node: FileNode) => void;
  setRoot: (path: string) => Promise<void>;
  setViz: (mode: VizMode) => void;
  setExpandedKeys: (keys: string[]) => void;
  setTreeCollapsed: (collapsed: boolean) => void;
  treeDataRef: React.MutableRefObject<FileNode | null>;
}

/**
 * Encapsulates everything that operates on one SideState slice.
 * Each BrowsingColumn instantiates its own controller.
 */
export function useSideController(
  state: SideState,
  setState: React.Dispatch<React.SetStateAction<SideState>>,
  onAddRecentFile?: (path: string) => void,
  onAddDirHistory?: (path: string) => void,
): SideController {
  const treeDataRef = useRef<FileNode | null>(state.treeData);
  useEffect(() => { treeDataRef.current = state.treeData; }, [state.treeData]);

  const setTreeData = useCallback((updater: React.SetStateAction<FileNode | null>) => {
    setState(prev => ({
      ...prev,
      treeData: typeof updater === 'function'
        ? (updater as (p: FileNode | null) => FileNode | null)(prev.treeData)
        : updater,
    }));
  }, [setState]);

  const { scanning, scanProgress } = useTreeStream(state.rootDir, state.treeData, setTreeData);

  const loadDirectory = useCallback(async (path: string) => {
    if (!path) return;
    try {
      const res = await fetch(`${API_BASE}/api/directory?path=${encodeURIComponent(path)}&depth=2`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setState(prev => ({ ...prev, treeData: data }));
      onAddDirHistory?.(path);
    } catch (err: any) {
      console.error('Failed to load directory:', err);
      message.error(`Failed to load directory: ${err.message || 'Unknown error'}`);
      setState(prev => ({ ...prev, treeData: null }));
    }
  }, [setState, onAddDirHistory]);

  const loadChildren = useCallback(async (dirPath: string) => {
    const existing = findNodeByPath(treeDataRef.current, dirPath);
    if (existing?.children && existing.children.length > 0) {
      setState(prev => ({ ...prev, treeData: prev.treeData ? { ...prev.treeData } : prev.treeData }));
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/directory?path=${encodeURIComponent(dirPath)}&depth=1`);
      if (!res.ok) return;
      const data: FileNode = await res.json();
      setState(prev => ({
        ...prev,
        treeData: prev.treeData ? mergeChildren(prev.treeData, dirPath, data.children || []) : prev.treeData,
      }));
    } catch (err) {
      console.error('Failed to load children:', err);
    }
  }, [setState]);

  const selectNode = useCallback((node: FileNode) => {
    setState(prev => ({ ...prev, selectedPath: node.path, selectedNode: node }));
    if (node.type === 'file') onAddRecentFile?.(node.path);
  }, [setState, onAddRecentFile]);

  const navigateToFile = useCallback(async (filePath: string) => {
    const root = state.rootDir;
    if (!root || !treeDataRef.current) return;
    const normRoot = root.replace(/\/+$/, '');
    if (!filePath.startsWith(normRoot)) return;
    const relative = filePath.slice(normRoot.length).replace(/^\//, '');
    if (!relative) return;
    const parts = relative.split('/');
    const keysToExpand: string[] = [normRoot];

    for (let i = 0; i < parts.length; i++) {
      const dirPath = normRoot + '/' + parts.slice(0, i + 1).join('/');
      keysToExpand.push(dirPath);
      const node = findNodeByPath(treeDataRef.current, dirPath);
      if (!node || (node.type === 'directory' && (!node.children || node.children.length === 0))) {
        try {
          const parentPath = i === 0 ? normRoot : normRoot + '/' + parts.slice(0, i).join('/');
          const res = await fetch(`${API_BASE}/api/directory?path=${encodeURIComponent(parentPath)}&depth=1`);
          if (res.ok) {
            const data: FileNode = await res.json();
            setState(prev => {
              if (!prev.treeData) return prev;
              return { ...prev, treeData: mergeChildren(prev.treeData, parentPath, data.children || []) };
            });
            await new Promise(r => setTimeout(r, 50));
          }
        } catch { /* ignore */ }
      }
    }

    setState(prev => ({
      ...prev,
      expandedKeys: [...new Set([...prev.expandedKeys, ...keysToExpand])],
    }));

    const found = findNodeByPath(treeDataRef.current, filePath);
    if (found) {
      selectNode(found);
    } else {
      const name = parts[parts.length - 1];
      const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
      const hasExt = name.includes('.');
      selectNode({
        name, path: filePath,
        type: hasExt ? 'file' : 'directory',
        extension: hasExt ? ext : undefined,
      });
    }
  }, [state.rootDir, setState, selectNode]);

  const setRoot = useCallback(async (path: string) => {
    // If the user pasted a file path, redirect to its parent and stash the
    // file in selectedPath; BrowsingColumn's post-tree-load effect picks
    // it up and calls navigateToFile (expand ancestors + select node).
    let actualRoot = path;
    let fileToSelect: string | undefined;
    try {
      const res = await fetch(`${API_BASE}/api/path-info?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const info = await res.json() as { type: 'file' | 'directory'; parent: string; path: string };
        if (info.type === 'file') {
          actualRoot = info.parent;
          fileToSelect = info.path;
        } else {
          actualRoot = info.path;
        }
      }
    } catch { /* network error: fall through; loadDirectory will surface it */ }

    setState(prev => {
      // Reload while keeping the selection: if the user clicked Load with
      // the same (or an ancestor) root and their previous selection still
      // lives under the new root, keep selectedPath + expandedKeys so the
      // post-tree-load nav effect re-selects/re-expands. Selecting a
      // brand-new file via setRoot takes priority and wipes the prior pick.
      const norm = actualRoot.replace(/\/+$/, '');
      const prevPath = prev.selectedPath;
      const preserve =
        !fileToSelect &&
        !!prevPath &&
        (prevPath === norm || prevPath.startsWith(norm + '/'));
      return {
        ...prev,
        rootDir: actualRoot,
        selectedPath: fileToSelect ?? (preserve ? prevPath : undefined),
        selectedNode: undefined,
        expandedKeys: preserve ? prev.expandedKeys : [],
        treeData: null,
      };
    });
    // The BrowsingColumn auto-load effect (deduped by treeData.path) handles
    // the actual fetch. Do NOT call loadDirectory here — that produced two
    // concurrent fetches (one from here, one from the effect).
  }, [setState]);

  const setViz = useCallback((mode: VizMode) => {
    setState(prev => ({ ...prev, vizMode: mode }));
  }, [setState]);

  const setExpandedKeys = useCallback((keys: string[]) => {
    setState(prev => ({ ...prev, expandedKeys: keys }));
  }, [setState]);

  const setTreeCollapsed = useCallback((collapsed: boolean) => {
    setState(prev => ({ ...prev, treeCollapsed: collapsed }));
  }, [setState]);

  return {
    state, setState,
    scanning, scanProgress,
    loadDirectory, loadChildren, navigateToFile, selectNode,
    setRoot, setViz, setExpandedKeys, setTreeCollapsed,
    treeDataRef,
  };
}
