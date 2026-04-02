import { useState, useCallback } from 'react';

const STORAGE_KEY = 'tianyan-dir-history';
const MAX_HISTORY = 20;

export function useDirectoryHistory() {
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  });

  const addToHistory = useCallback((path: string) => {
    setHistory(prev => {
      const filtered = prev.filter(p => p !== path);
      const next = [path, ...filtered].slice(0, MAX_HISTORY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { history, addToHistory };
}
