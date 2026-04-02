import { useState, useEffect } from 'react';

export type Theme = 'dark' | 'light';

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('tianyan-theme') as Theme) || 'dark';
  });

  useEffect(() => {
    localStorage.setItem('tianyan-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  return [theme, toggle];
}
