import { useState, useEffect, useRef, useCallback } from 'react';
import type { FileNode } from '../types';

interface ScanProgress {
  scanned: number;
  elapsed: number;
}

/**
 * Build a Map<path, FileNode> from the tree for O(1) lookups.
 * Since FileNode is a tree of references, mutating a node's children
 * in-place updates the tree — no need to rebuild from root.
 */
function buildPathIndex(node: FileNode, map: Map<string, FileNode>) {
  map.set(node.path, node);
  if (node.children) {
    for (const child of node.children) {
      buildPathIndex(child, map);
    }
  }
}

export function useTreeStream(
  rootDir: string,
  treeData: FileNode | null,
  setTreeData: React.Dispatch<React.SetStateAction<FileNode | null>>,
) {
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress>({ scanned: 0, elapsed: 0 });
  const esRef = useRef<EventSource | null>(null);
  const bufferRef = useRef<Array<{ path: string; children: FileNode[] }>>([]);
  const rafRef = useRef<number>(0);
  const hasTreeRef = useRef(false);
  // Path index for O(1) node lookup during merges
  const indexRef = useRef<Map<string, FileNode>>(new Map());

  useEffect(() => {
    hasTreeRef.current = treeData !== null;
  }, [treeData]);

  const cleanup = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    bufferRef.current = [];
    indexRef.current = new Map();
  }, []);

  useEffect(() => {
    if (!rootDir) return;

    const checkAndStart = () => {
      if (!hasTreeRef.current) {
        const timer = setTimeout(checkAndStart, 200);
        return () => clearTimeout(timer);
      }
      startStream();
    };

    let cleanupTimer: (() => void) | undefined;

    const startStream = () => {
      cleanup();
      setScanning(true);
      setScanProgress({ scanned: 0, elapsed: 0 });

      const es = new EventSource(`/api/directory/stream?path=${encodeURIComponent(rootDir)}`);
      esRef.current = es;

      es.onmessage = (e) => {
        const msg = JSON.parse(e.data) as { path: string; children: FileNode[] };
        bufferRef.current.push(msg);

        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            const batch = bufferRef.current;
            bufferRef.current = [];
            rafRef.current = 0;

            let count = 0;
            for (const item of batch) {
              count += item.children.length;
            }

            setTreeData(prev => {
              if (!prev) return prev;

              // Build index on first use
              const idx = indexRef.current;
              if (idx.size === 0) {
                buildPathIndex(prev, idx);
              }

              // Apply all batched updates via O(1) index lookup
              for (const { path, children } of batch) {
                const target = idx.get(path);
                if (target) {
                  target.children = children;
                  target.hasChildren = children.length > 0;
                  // Index new children for future lookups
                  for (const child of children) {
                    idx.set(child.path, child);
                  }
                }
              }

              // Shallow clone root to trigger React re-render
              return { ...prev };
            });

            setScanProgress(prev => ({ ...prev, scanned: prev.scanned + count }));
          });
        }
      };

      es.addEventListener('done', (e: MessageEvent) => {
        const stats = JSON.parse(e.data);
        setScanProgress({ scanned: stats.total, elapsed: stats.elapsed });
        setScanning(false);
        es.close();
        esRef.current = null;
      });

      es.onerror = () => {
        setScanning(false);
        es.close();
        esRef.current = null;
      };
    };

    cleanupTimer = checkAndStart() as (() => void) | undefined;

    return () => {
      cleanup();
      cleanupTimer?.();
    };
  }, [rootDir, cleanup, setTreeData]);

  return { scanning, scanProgress };
}
