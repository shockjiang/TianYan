import { useEffect, useRef } from 'react';

export interface UrlSide {
  root?: string;
  viz?: string;
  file?: string;
}

export interface UrlState extends UrlSide {
  b?: UrlSide;
  _share?: string;
  _alias?: string;
  _aliasB?: string;
}

// --- Share links: full state → short code ---

export async function buildShareUrl(state: { a: UrlSide; b?: UrlSide | null }): Promise<string> {
  const origin = window.location.origin;
  if (!state.a.root) return origin;

  try {
    const payload = state.b && state.b.root
      ? {
          a: { root: state.a.root, file: state.a.file || null, viz: state.a.viz || null },
          b: { root: state.b.root, file: state.b.file || null, viz: state.b.viz || null },
        }
      : { a: { root: state.a.root, file: state.a.file || null, viz: state.a.viz || null } };
    const res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const { code } = await res.json();
      return `${origin}?s=${code}`;
    }
  } catch { /* fall through */ }

  // Fallback: plain params (sideA only)
  const params = new URLSearchParams();
  params.set('root', state.a.root);
  if (state.a.file) params.set('file', state.a.file);
  if (state.a.viz && state.a.viz !== 'single') params.set('viz', state.a.viz);
  return `${origin}?${params}`;
}

async function resolveShare(code: string): Promise<{ a: UrlSide; b?: UrlSide } | null> {
  try {
    const res = await fetch(`/api/share/${encodeURIComponent(code)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.a && data.a.root) {
        return {
          a: { root: data.a.root, file: data.a.file || undefined, viz: data.a.viz || undefined },
          b: data.b && data.b.root
            ? { root: data.b.root, file: data.b.file || undefined, viz: data.b.viz || undefined }
            : undefined,
        };
      }
      if (data.root) {
        return { a: { root: data.root, file: data.file || undefined, viz: data.viz || undefined } };
      }
    }
  } catch { /* ignore */ }
  return null;
}

// --- Alias (kept for backward compat of address bar URLs) ---

const aliasCache: Map<string, string> = new Map(); // path → id

async function getOrCreateAlias(root: string): Promise<string> {
  const normRoot = root.replace(/\/+$/, '');
  const cached = aliasCache.get(normRoot);
  if (cached) return cached;
  try {
    const res = await fetch('/api/alias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: normRoot }),
    });
    if (res.ok) {
      const data = await res.json();
      aliasCache.set(normRoot, data.id);
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
      aliasCache.set(data.path, id);
      return data.path;
    }
  } catch { /* ignore */ }
  return null;
}

// --- Parse URL on page load ---

export function getUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);

  if (params.get('s')) return { _share: params.get('s')! };
  if (params.get('a')) {
    return {
      _alias: params.get('a')!,
      _aliasB: params.get('b') || undefined,
    };
  }

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

function parseAliasSegment(seg: string): { aliasId: string; relFile?: string; viz?: string } {
  const firstSlash = seg.indexOf('/');
  const firstPipe = seg.indexOf('|');
  if (firstSlash > 0 && (firstPipe < 0 || firstSlash < firstPipe)) {
    const aliasId = seg.slice(0, firstSlash);
    const rest = seg.slice(firstSlash + 1);
    const pipeParts = rest.split('|');
    return { aliasId, relFile: pipeParts[0] || undefined, viz: pipeParts[1] || undefined };
  }
  const parts = seg.split('|');
  return { aliasId: parts[0], relFile: parts[1] || undefined, viz: parts[2] || undefined };
}

async function resolveSideFromAlias(seg: string): Promise<UrlSide | null> {
  const { aliasId, relFile, viz } = parseAliasSegment(seg);
  const root = await resolveAlias(aliasId);
  if (!root) return null;
  let file: string | undefined;
  if (relFile) file = root + '/' + relFile;
  return { root, viz, file };
}

export function useResolveAlias(onResolved: (state: { a: UrlSide; b?: UrlSide }) => void) {
  const resolved = useRef(false);
  useEffect(() => {
    if (resolved.current) return;
    const params = new URLSearchParams(window.location.search);

    const shareCode = params.get('s');
    if (shareCode) {
      resolved.current = true;
      resolveShare(shareCode).then(state => { if (state) onResolved(state); });
      return;
    }

    const a = params.get('a');
    if (!a) return;
    resolved.current = true;
    const b = params.get('b');

    Promise.all([
      resolveSideFromAlias(a),
      b ? resolveSideFromAlias(b) : Promise.resolve(undefined as UrlSide | undefined),
    ]).then(([sideA, sideB]) => {
      if (sideA) onResolved({ a: sideA, b: sideB || undefined });
    });
  }, []);
}

// --- Sync address bar (uses alias for moderate-length URLs) ---

export function useUrlStateSync(state: { a: UrlSide; b?: UrlSide | null }) {
  const updating = useRef(false);

  useEffect(() => {
    if (!state.a.root || updating.current) return;
    updating.current = true;

    const buildSeg = (s: UrlSide, aliasId: string): string => {
      const normRoot = s.root!.replace(/\/+$/, '');
      let relFile = '';
      if (s.file && s.file.startsWith(normRoot + '/')) relFile = s.file.slice(normRoot.length + 1);
      const viz = (s.viz && s.viz !== 'single') ? s.viz : '';
      let val = aliasId || normRoot;
      if (relFile || viz) val += '|' + relFile;
      if (viz) val += '|' + viz;
      return val;
    };

    Promise.all([
      getOrCreateAlias(state.a.root),
      state.b && state.b.root ? getOrCreateAlias(state.b.root) : Promise.resolve(''),
    ]).then(([idA, idB]) => {
      const params = new URLSearchParams();
      const segA = buildSeg(state.a, idA);
      params.set(idA ? 'a' : 'p', segA);
      if (state.b && state.b.root) {
        const segB = buildSeg(state.b, idB);
        params.set(idB ? 'b' : 'pb', segB);
      }
      window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
      updating.current = false;
    });
  }, [state.a.root, state.a.viz, state.a.file, state.b?.root, state.b?.viz, state.b?.file]);
}
