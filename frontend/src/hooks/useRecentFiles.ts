import { useState, useCallback } from 'react';

const STORAGE_KEY = 'tianyan-recent-files';
const MAX_RECENT = 10;

export function useRecentFiles() {
  const [recentFiles, setRecentFiles] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  });

  const addRecentFile = useCallback((path: string) => {
    setRecentFiles(prev => {
      const filtered = prev.filter(p => p !== path);
      const next = [path, ...filtered].slice(0, MAX_RECENT);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { recentFiles, addRecentFile };
}
