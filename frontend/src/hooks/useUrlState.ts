import { useEffect } from 'react';

interface UrlState {
  root?: string;
  viz?: string;
  file?: string;
}

export function getUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  return {
    root: params.get('root') || undefined,
    viz: params.get('viz') || undefined,
    file: params.get('file') || undefined,
  };
}

export function useUrlStateSync(state: UrlState) {
  useEffect(() => {
    const params = new URLSearchParams();
    if (state.root) params.set('root', state.root);
    if (state.viz && state.viz !== 'single') params.set('viz', state.viz);
    if (state.file) params.set('file', state.file);
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [state.root, state.viz, state.file]);
}
