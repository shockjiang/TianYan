import { useEffect, useRef } from 'react';

interface UrlState {
  root?: string;
  viz?: string;
  file?: string;
}

// --- Share links: full state → short code ---

export async function buildShareUrl(state: UrlState): Promise<string> {
  const origin = window.location.origin;
  if (!state.root) return origin;

  try {
    const res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: state.root,
        file: state.file || null,
        viz: state.viz || null,
      }),
    });
    if (res.ok) {
      const { code } = await res.json();
      return `${origin}?s=${code}`;
    }
  } catch { /* fall through */ }

  // Fallback: plain params
  const params = new URLSearchParams();
  params.set('root', state.root);
  if (state.file) params.set('file', state.file);
  if (state.viz && state.viz !== 'single') params.set('viz', state.viz);
  return `${origin}?${params}`;
}

async function resolveShare(code: string): Promise<UrlState | null> {
  try {
    const res = await fetch(`/api/share/${encodeURIComponent(code)}`);
    if (res.ok) {
      const data = await res.json();
      return { root: data.root, file: data.file || undefined, viz: data.viz || undefined };
    }
  } catch { /* ignore */ }
  return null;
}

// --- Alias (kept for backward compat of address bar URLs) ---

let aliasCache: { root: string; id: string } | null = null;

async function getOrCreateAlias(root: string): Promise<string> {
  const normRoot = root.replace(/\/+$/, '');
  if (aliasCache && aliasCache.root === normRoot) return aliasCache.id;
  try {
    const res = await fetch('/api/alias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: normRoot }),
    });
    if (res.ok) {
      const data = await res.json();
      aliasCache = { root: normRoot, id: data.id };
      return data.id;
    }
  } catch { /* fall through */ }
  return '';
}

async function resolveAlias(id: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/alias/${encodeURIComponent(id)}`);
    if (res.ok) {
      const data = await res.json();
      aliasCache = { root: data.path, id };
      return data.path;
    }
  } catch { /* ignore */ }
  return null;
}

// --- Parse URL on page load ---

export function getUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);

  // Share code: ?s=<code> — resolved async
  if (params.get('s')) return { _share: params.get('s') } as any;

  // Alias format: ?a=<id>... — resolved async
  if (params.get('a')) return { _alias: params.get('a') } as any;

  // Pipe format: ?p=<root>|<relFile>|<viz>
  const p = params.get('p');
  if (p) {
    const parts = decodeURIComponent(p).split('|');
    const root = parts[0] || undefined;
    const relFile = parts[1] || undefined;
    const viz = parts[2] || undefined;
    let file: string | undefined;
    if (relFile && root) file = root.replace(/\/+$/, '') + '/' + relFile;
    return { root, viz, file };
  }

  // Legacy query params
  const root = params.get('root') || undefined;
  let file = params.get('file') || undefined;
  if (file && root && !file.startsWith('/')) file = root.replace(/\/+$/, '') + '/' + file;
  return { root, viz: params.get('viz') || undefined, file };
}

// --- Async resolution on mount (share codes and aliases) ---

export function useResolveAlias(onResolved: (state: UrlState) => void) {
  const resolved = useRef(false);
  useEffect(() => {
    if (resolved.current) return;
    const params = new URLSearchParams(window.location.search);

    // Handle ?s=<code>
    const shareCode = params.get('s');
    if (shareCode) {
      resolved.current = true;
      resolveShare(shareCode).then(state => {
        if (state) onResolved(state);
      });
      return;
    }

    // Handle ?a=<alias>...
    const a = params.get('a');
    if (!a) return;

    resolved.current = true;
    const firstSlash = a.indexOf('/');
    const firstPipe = a.indexOf('|');
    let aliasId: string, relFile: string | undefined, viz: string | undefined;

    if (firstSlash > 0 && (firstPipe < 0 || firstSlash < firstPipe)) {
      aliasId = a.slice(0, firstSlash);
      const rest = a.slice(firstSlash + 1);
      const pipeParts = rest.split('|');
      relFile = pipeParts[0] || undefined;
      viz = pipeParts[1] || undefined;
    } else {
      const parts = a.split('|');
      aliasId = parts[0];
      relFile = parts[1] || undefined;
      viz = parts[2] || undefined;
    }

    resolveAlias(aliasId).then(root => {
      if (root) {
        let file: string | undefined;
        if (relFile) file = root + '/' + relFile;
        onResolved({ root, viz, file });
      }
    });
  }, []);
}

// --- Sync address bar (uses alias for moderate-length URLs) ---

export function useUrlStateSync(state: UrlState) {
  const updating = useRef(false);

  useEffect(() => {
    if (!state.root || updating.current) return;
    updating.current = true;

    const normRoot = state.root.replace(/\/+$/, '');
    let relFile = '';
    if (state.file && state.file.startsWith(normRoot + '/')) {
      relFile = state.file.slice(normRoot.length + 1);
    }
    const viz = (state.viz && state.viz !== 'single') ? state.viz : '';

    getOrCreateAlias(normRoot).then(aliasId => {
      let param: string;
      if (aliasId) {
        let val = aliasId;
        if (relFile || viz) val += '|' + relFile;
        if (viz) val += '|' + viz;
        param = `a=${encodeURIComponent(val)}`;
      } else {
        let val = normRoot;
        if (relFile || viz) val += '|' + relFile;
        if (viz) val += '|' + viz;
        param = `p=${encodeURIComponent(val)}`;
      }
      window.history.replaceState(null, '', `${window.location.pathname}?${param}`);
      updating.current = false;
    });
  }, [state.root, state.viz, state.file]);
}
