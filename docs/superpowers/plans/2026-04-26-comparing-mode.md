# Comparing Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add side-by-side comparing mode to TianYan — two independent browsing columns (root + tree + breadcrumb + preview), mirror layout, with a thin global header for shared controls.

**Architecture:** Per-side state lifted into a `SideState` shape with `useSideController` hook; `App.tsx` becomes a thin shell that renders `GlobalHeader` + one or two `BrowsingColumn` components. `sideB === null` is the single source of truth for single-vs-compare mode. Mirror layout: Tree A (collapsible) | Preview A | resizable divider | Preview B | Tree B (collapsible). URL gains optional `b=` segment; share payload gains optional `b` field.

**Tech Stack:** React 18 + TypeScript + Vite + Ant Design 5 (frontend); FastAPI + Python 3.10 (backend). No test framework currently in repo — verification is browser-based per task.

**Spec:** `docs/superpowers/specs/2026-04-26-comparing-mode-design.md`

**Verification servers:** Use `bash start.sh` to run frontend (port 15090) + backend (port 8000). For verification, the assumption is that this is already running or the task starts it. After UI tasks, browse to `http://localhost:15090` and exercise the relevant flow.

---

## Phase 1 — Pure refactor: lift per-side state into a `SideState` shape

**Intent:** Restructure App.tsx so the per-side fields live in one bundled object, with no functional change. Single mode behaves identically; we're only renaming/regrouping. This makes Phase 2+ tractable.

### Task 1: Define `SideState` type

**Files:**
- Modify: `frontend/src/types.ts` (append at end)

- [ ] **Step 1: Add `SideState` type to `types.ts`**

Append to `frontend/src/types.ts`:

```ts
export interface SideState {
  rootDir: string;
  vizMode: VizMode;
  selectedPath?: string;
  selectedNode?: FileNode;
  treeData: FileNode | null;
  expandedKeys: string[];
  treeCollapsed: boolean;
}

export const initialSideState = (overrides: Partial<SideState> = {}): SideState => ({
  rootDir: '',
  vizMode: 'single',
  selectedPath: undefined,
  selectedNode: undefined,
  treeData: null,
  expandedKeys: [],
  treeCollapsed: false,
  ...overrides,
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /vePFS/shock/TianYan/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /vePFS/shock/TianYan
git add frontend/src/types.ts
git commit -m "types: add SideState for comparing mode"
```

### Task 2: Migrate `App.tsx` state into one `sideA` bundle

**Files:**
- Modify: `frontend/src/App.tsx` (state declarations + every reader/writer)

This is a mechanical, line-by-line rename. Functionality is unchanged.

- [ ] **Step 1: Replace per-side `useState` calls with one `sideA` state**

In `App.tsx`, replace lines 47-53 (the urlState destructuring + 6 per-side useState calls) with:

```tsx
const urlState = getUrlState();
const [sideA, setSideA] = useState<SideState>(initialSideState({
  rootDir: urlState.root || '',
  vizMode: (urlState.viz as VizMode) || 'single',
  selectedPath: urlState.file,
  expandedKeys: [],
}));
```

Add the `import { initialSideState } from './types';` (and ensure `SideState` is also imported when needed) at the top of the file.

- [ ] **Step 2: Replace all per-field reads with `sideA.<field>`**

In `App.tsx`, replace every reference (whole file) of:
- `rootDir` → `sideA.rootDir`
- `vizMode` → `sideA.vizMode`
- `selectedPath` → `sideA.selectedPath`
- `selectedNode` → `sideA.selectedNode`
- `treeData` → `sideA.treeData`
- `expandedKeys` → `sideA.expandedKeys`

Do NOT touch the global ones (`theme`, `autoplay`, `gridScale`, `fullscreen`, `leftWidth`).

- [ ] **Step 3: Replace all per-field writes with `setSideA(prev => ({ ...prev, <field>: ... }))`**

Find every `setRootDir(x)`, `setVizMode(x)`, `setSelectedPath(x)`, `setSelectedNode(x)`, `setTreeData(x)`, `setExpandedKeys(x)` and convert to the patch form. For functional setters like `setTreeData(prev => ...)`, write:

```tsx
setSideA(prev => ({ ...prev, treeData: typeof x === 'function' ? x(prev.treeData) : x }));
```

A simpler equivalent for functional callers:

```tsx
setSideA(prev => ({ ...prev, treeData: <new value computed from prev.treeData> }));
```

- [ ] **Step 4: Update the `treeDataRef` + effect to read from `sideA.treeData`**

Replace:
```tsx
const treeDataRef = useRef(treeData);
useEffect(() => { treeDataRef.current = treeData; }, [treeData]);
```
with:
```tsx
const treeDataRef = useRef<FileNode | null>(sideA.treeData);
useEffect(() => { treeDataRef.current = sideA.treeData; }, [sideA.treeData]);
```

- [ ] **Step 5: Update `useTreeStream` invocation**

Replace:
```tsx
const { scanning, scanProgress } = useTreeStream(rootDir, treeData, setTreeData);
```
with:
```tsx
const { scanning, scanProgress } = useTreeStream(
  sideA.rootDir,
  sideA.treeData,
  (updater) => setSideA(prev => ({
    ...prev,
    treeData: typeof updater === 'function' ? (updater as any)(prev.treeData) : updater,
  })),
);
```

- [ ] **Step 6: Update `useUrlStateSync` and `useResolveAlias` callbacks**

Replace:
```tsx
useUrlStateSync({ root: rootDir, viz: vizMode, file: selectedPath });
```
with:
```tsx
useUrlStateSync({ root: sideA.rootDir, viz: sideA.vizMode, file: sideA.selectedPath });
```

In the `useResolveAlias` callback, replace the individual setters with one `setSideA` patch:

```tsx
useResolveAlias((resolved) => {
  if (resolved.root) {
    setSideA(prev => ({
      ...prev,
      rootDir: resolved.root!,
      vizMode: (resolved.viz as VizMode) || prev.vizMode,
      selectedPath: resolved.file ?? prev.selectedPath,
    }));
    if (resolved.file) pendingFileNav.current = resolved.file;
    loadDirectory(resolved.root);
  }
});
```

- [ ] **Step 7: Update `handleRootSubmit` and `handleSelect`**

```tsx
const handleRootSubmit = (path: string) => {
  pendingFileNav.current = undefined;
  setSideA(prev => ({
    ...prev,
    rootDir: path,
    selectedPath: undefined,
    selectedNode: undefined,
    expandedKeys: [],
  }));
  loadDirectory(path);
};

const handleSelect = (node: FileNode) => {
  setSideA(prev => ({ ...prev, selectedPath: node.path, selectedNode: node }));
  if (node.type === 'file') addRecentFile(node.path);
};
```

- [ ] **Step 8: Update `loadDirectory`, `loadChildren`, `navigateToFile` setters**

In `loadDirectory`, replace `setTreeData(data)` with:
```tsx
setSideA(prev => ({ ...prev, treeData: data }));
```
And `setTreeData(null)` with `setSideA(prev => ({ ...prev, treeData: null }))`.

In `loadChildren`, replace `setTreeData(prev => ...)` with:
```tsx
setSideA(prev => ({
  ...prev,
  treeData: prev.treeData ? mergeChildren(prev.treeData, dirPath, data.children || []) : prev.treeData,
}));
```
The early-return `setTreeData(prev => prev ? { ...prev } : prev)` becomes:
```tsx
setSideA(prev => ({ ...prev, treeData: prev.treeData ? { ...prev.treeData } : prev.treeData }));
```

In `navigateToFile`, the `setTreeData(prev => ...)` calls follow the same pattern. The local `currentTree = updated;` mutation should read from `prev.treeData`:
```tsx
setSideA(prev => {
  if (!prev.treeData) return prev;
  const updated = mergeChildren(prev.treeData, parentPath, data.children || []);
  currentTree = updated;
  return { ...prev, treeData: updated };
});
```

The `setExpandedKeys(prev => [...new Set([...prev, ...keysToExpand])])` becomes:
```tsx
setSideA(prev => ({ ...prev, expandedKeys: [...new Set([...prev.expandedKeys, ...keysToExpand])] }));
```

- [ ] **Step 9: Update the `MainPanel`'s `onNavigate` block at line 308-328**

Replace `setExpandedKeys(prev => ...)` with:
```tsx
setSideA(prev => ({ ...prev, expandedKeys: [...new Set([...prev.expandedKeys, ...keysToExpand])] }));
```

And the `findNodeByPath(treeData, path)` call should use `findNodeByPath(sideA.treeData, path)`.

- [ ] **Step 10: Update render — pass `sideA.<field>` everywhere**

In the `<TopPanel>` props block, replace the per-field reads:
- `rootDir={rootDir}` → `rootDir={sideA.rootDir}`
- `vizMode={vizMode}` → `vizMode={sideA.vizMode}`
- `selectedFile={selectedPath}` → `selectedFile={sideA.selectedPath}`
- `onVizChange={setVizMode}` → `onVizChange={(m) => setSideA(prev => ({ ...prev, vizMode: m }))}`

In the `<FileTree>` props block:
- `treeData={treeData}` → `treeData={sideA.treeData}`
- `selectedPath={selectedPath}` → `selectedPath={sideA.selectedPath}`
- `expandedKeys={expandedKeys}` → `expandedKeys={sideA.expandedKeys}`
- `onExpandedKeysChange={setExpandedKeys}` → `onExpandedKeysChange={(keys) => setSideA(prev => ({ ...prev, expandedKeys: keys }))}`

In the `<MainPanel>` props block:
- `selectedNode={selectedNode}` → `selectedNode={sideA.selectedNode}`
- `vizMode={vizMode}` → `vizMode={sideA.vizMode}`
- `treeData={treeData}` → `treeData={sideA.treeData}`
- `rootDir={rootDir}` → `rootDir={sideA.rootDir}`

- [ ] **Step 11: Run TypeScript check**

Run: `cd /vePFS/shock/TianYan/frontend && npx tsc --noEmit`
Expected: No errors. Fix any type mismatches inline.

- [ ] **Step 12: Verify single-mode browser regression**

Start the dev server if not running:
```bash
cd /vePFS/shock/TianYan && bash start.sh &
```
Open `http://localhost:15090`. Verify:
- Type a root dir → tree loads
- Click a file → preview shows
- Switch viz mode → tuple matches show (if applicable)
- Refresh page with `?a=...` URL → state restores
- Drag tree/main divider → resizes
- F key → fullscreen toggles

If anything breaks, fix it before committing — this phase MUST be a no-op behaviorally.

- [ ] **Step 13: Commit**

```bash
cd /vePFS/shock/TianYan
git add frontend/src/App.tsx
git commit -m "refactor: lift per-side state into SideState bundle (no behavior change)"
```

---

## Phase 2 — Extract `GlobalHeader` and slim `TopPanel`

**Intent:** Move global controls (theme, fullscreen, autoplay, gridScale, share button) out of `TopPanel` into a new thin `GlobalHeader` strip above `TopPanel`. `TopPanel` keeps only per-side controls (root + viz). No compare-mode UI yet — but the header is in place.

### Task 3: Create `GlobalHeader` component

**Files:**
- Create: `frontend/src/components/GlobalHeader.tsx`

- [ ] **Step 1: Write `GlobalHeader.tsx`**

```tsx
import { Button, message } from 'antd';
import { SunOutlined, MoonOutlined, FullscreenOutlined, ShareAltOutlined } from '@ant-design/icons';
import type { Theme } from '../hooks/useTheme';
import type { SideState } from '../types';

interface GlobalHeaderProps {
  theme: Theme;
  autoplay: boolean;
  gridScale: number;
  sideA: SideState;
  sideB: SideState | null;
  onThemeToggle: () => void;
  onFullscreenToggle: () => void;
  onAutoplayChange: (val: boolean) => void;
  onGridScaleChange: (val: number) => void;
  onCompareToggle: () => void;            // single mode → enter compare
  onExitKeepLeft: () => void;             // compare → single, keep A
  onExitKeepRight: () => void;            // compare → single, keep B
}

export function GlobalHeader({
  theme, autoplay, gridScale, sideA, sideB,
  onThemeToggle, onFullscreenToggle, onAutoplayChange, onGridScaleChange,
  onCompareToggle, onExitKeepLeft, onExitKeepRight,
}: GlobalHeaderProps) {
  const compareMode = sideB !== null;

  const buildSharePayload = () => {
    const a = { root: sideA.rootDir, file: sideA.selectedPath || null, viz: sideA.vizMode || null };
    return sideB
      ? { a, b: { root: sideB.rootDir, file: sideB.selectedPath || null, viz: sideB.vizMode || null } }
      : { a };
  };

  const handleShare = () => {
    if (!sideA.rootDir) {
      message.warning('No state to share yet');
      return;
    }
    const blobPromise = fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSharePayload()),
    })
      .then(r => r.json())
      .then(data => {
        const url = `${window.location.origin}?s=${data.code}`;
        (window as any).__lastShareUrl = url;
        return new Blob([url], { type: 'text/plain' });
      });
    try {
      navigator.clipboard.write([new ClipboardItem({ 'text/plain': blobPromise })])
        .then(() => message.success(`Copied: ${(window as any).__lastShareUrl}`))
        .catch(() => blobPromise.then(b => b.text()).then(url => window.prompt('Copy this link:', url)));
    } catch {
      blobPromise.then(b => b.text()).then(url => window.prompt('Copy this link:', url));
    }
  };

  return (
    <div style={{
      height: 36,
      background: 'var(--bg-panel)',
      borderBottom: '1px solid var(--border-color)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 8,
      flexShrink: 0,
      fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <img src="/favicon.svg" alt="鹰眼" style={{ width: 20, height: 20 }} />
        <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 14 }}>鹰眼</span>
      </div>

      <div style={{ flex: 1 }} />

      {!compareMode && (
        <Button size="small" onClick={onCompareToggle} disabled={!sideA.rootDir}>
          Compare
        </Button>
      )}
      {compareMode && (
        <>
          <Button size="small" onClick={onExitKeepLeft}>Exit ← Keep Left</Button>
          <Button size="small" onClick={onExitKeepRight}>Exit Keep Right →</Button>
        </>
      )}

      <label style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input type="checkbox" checked={autoplay} onChange={e => onAutoplayChange(e.target.checked)} />
        Autoplay
      </label>

      <label style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
        Scale:
        <input type="range" min="0.05" max="1" step="0.05" value={gridScale}
          onChange={e => onGridScaleChange(parseFloat(e.target.value))}
          style={{ width: 70 }} />
        {Math.round(gridScale * 100)}%
      </label>

      <Button type="text" size="small" icon={<ShareAltOutlined />} title="Copy share link"
        style={{ color: 'var(--text-primary)' }} onClick={handleShare} />
      <Button type="text" size="small" icon={<FullscreenOutlined />} title="Fullscreen (F)"
        style={{ color: 'var(--text-primary)' }} onClick={onFullscreenToggle} />
      <Button type="text" size="small" icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        style={{ color: 'var(--text-primary)' }} onClick={onThemeToggle} />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /vePFS/shock/TianYan/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /vePFS/shock/TianYan
git add frontend/src/components/GlobalHeader.tsx
git commit -m "feat: add GlobalHeader component (compare toggle + global controls)"
```

### Task 4: Slim down `TopPanel.tsx` (remove globals)

**Files:**
- Modify: `frontend/src/components/TopPanel.tsx`

- [ ] **Step 1: Rewrite `TopPanel.tsx` to keep only root + viz**

Replace the entire file with:

```tsx
import { useState, useEffect } from 'react';
import { AutoComplete, Select, Button } from 'antd';
import { getTupleTypes } from '../tuples/registry';
import type { VizMode } from '../types';

interface TopPanelProps {
  rootDir: string;
  dirHistory: string[];
  vizMode: VizMode;
  onRootSubmit: (path: string) => void;
  onVizChange: (mode: VizMode) => void;
}

export function TopPanel({ rootDir, dirHistory, vizMode, onRootSubmit, onVizChange }: TopPanelProps) {
  const [inputValue, setInputValue] = useState(rootDir);
  useEffect(() => { setInputValue(rootDir); }, [rootDir]);
  const tupleTypes = getTupleTypes();

  const vizOptions = [
    { value: 'single', label: 'Single File' },
    ...tupleTypes.map(t => ({ value: t.key, label: t.name })),
  ];
  const historyOptions = dirHistory.map(h => ({ value: h, label: h }));

  const handleSubmit = () => {
    const trimmed = inputValue.trim();
    if (trimmed) onRootSubmit(trimmed);
  };

  return (
    <div style={{
      height: 44,
      background: 'var(--bg-panel)',
      borderBottom: '1px solid var(--border-color)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 8,
      flexShrink: 0,
    }}>
      <AutoComplete
        style={{ flex: 1, minWidth: 200 }}
        value={inputValue}
        options={historyOptions}
        onChange={setInputValue}
        onSelect={(val: string) => { setInputValue(val); onRootSubmit(val); }}
        placeholder="Enter root directory path..."
        onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
        filterOption={(input, option) =>
          (option?.value as string)?.toLowerCase().includes(input.toLowerCase())
        }
      />
      <Button type="primary" size="small" onClick={handleSubmit}>Load</Button>
      <Select
        style={{ width: 160 }}
        value={vizMode}
        onChange={onVizChange}
        options={vizOptions}
        size="small"
      />
    </div>
  );
}
```

- [ ] **Step 2: Update `App.tsx` to render `<GlobalHeader>` above `<TopPanel>` and pass new props**

In `App.tsx`, add the import:
```tsx
import { GlobalHeader } from './components/GlobalHeader';
```

Replace the existing `{!fullscreen && (<TopPanel ... />)}` block (approx lines 259-276) with:

```tsx
{!fullscreen && (
  <GlobalHeader
    theme={theme}
    autoplay={autoplay}
    gridScale={gridScale}
    sideA={sideA}
    sideB={null /* will become real in Phase 6 */}
    onThemeToggle={toggleTheme}
    onAutoplayChange={handleAutoplayChange}
    onGridScaleChange={handleGridScaleChange}
    onFullscreenToggle={() => setFullscreen(f => !f)}
    onCompareToggle={() => { /* TODO Phase 6 */ }}
    onExitKeepLeft={() => { /* TODO Phase 6 */ }}
    onExitKeepRight={() => { /* TODO Phase 6 */ }}
  />
)}
{!fullscreen && (
  <TopPanel
    rootDir={sideA.rootDir}
    dirHistory={dirHistory}
    vizMode={sideA.vizMode}
    onRootSubmit={handleRootSubmit}
    onVizChange={(m) => setSideA(prev => ({ ...prev, vizMode: m }))}
  />
)}
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd /vePFS/shock/TianYan/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Verify in browser**

Reload `http://localhost:15090`. Verify:
- Thin global header strip appears at top (~36px) with title, autoplay, scale, share, fullscreen, theme buttons
- Below it the trimmed top panel (~44px) with root input + Load + viz selector
- All controls work (theme toggle, share copies link, fullscreen, autoplay, grid scale)
- "Compare" button is visible (disabled when no root, enabled after loading a dir) — clicking does nothing yet

- [ ] **Step 5: Commit**

```bash
cd /vePFS/shock/TianYan
git add frontend/src/components/TopPanel.tsx frontend/src/App.tsx
git commit -m "feat: slim TopPanel, route global controls through GlobalHeader"
```

---

## Phase 3 — Build `BrowsingColumn` and `useSideController`

**Intent:** Encapsulate one side's TopPanel + Tree + MainPanel into a reusable `BrowsingColumn` component, with all per-side logic in a `useSideController` hook. App.tsx renders one `BrowsingColumn` for `sideA` (still no compare mode). After this phase, adding side B will mean adding one more `<BrowsingColumn>`.

### Task 5: Extract `useSideController` hook

**Files:**
- Create: `frontend/src/hooks/useSideController.ts`
- Modify: `frontend/src/App.tsx` (will use the hook)

- [ ] **Step 1: Write `useSideController.ts`**

```ts
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
  setRoot: (path: string) => void;
  setViz: (mode: VizMode) => void;
  setExpandedKeys: (keys: string[]) => void;
  setTreeCollapsed: (collapsed: boolean) => void;
  treeDataRef: React.MutableRefObject<FileNode | null>;
  pendingFileNav: React.MutableRefObject<string | undefined>;
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

  const pendingFileNav = useRef<string | undefined>(state.selectedPath);

  const setTreeData = useCallback((updater: React.SetStateAction<FileNode | null>) => {
    setState(prev => ({
      ...prev,
      treeData: typeof updater === 'function' ? (updater as any)(prev.treeData) : updater,
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

  const setRoot = useCallback((path: string) => {
    pendingFileNav.current = undefined;
    setState(prev => ({
      ...prev,
      rootDir: path,
      selectedPath: undefined,
      selectedNode: undefined,
      expandedKeys: [],
      treeData: null,
    }));
    loadDirectory(path);
  }, [setState, loadDirectory]);

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
    treeDataRef, pendingFileNav,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /vePFS/shock/TianYan/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /vePFS/shock/TianYan
git add frontend/src/hooks/useSideController.ts
git commit -m "feat: add useSideController hook (per-side logic)"
```

### Task 6: Create `BrowsingColumn` component

**Files:**
- Create: `frontend/src/components/BrowsingColumn.tsx`

- [ ] **Step 1: Write `BrowsingColumn.tsx`**

```tsx
import { useCallback, useEffect, useRef } from 'react';
import { TopPanel } from './TopPanel';
import { FileTree } from './FileTree';
import { MainPanel } from './MainPanel';
import { ErrorBoundary } from './ErrorBoundary';
import { useSideController } from '../hooks/useSideController';
import type { SideState, FileNode } from '../types';
import type { Theme } from '../hooks/useTheme';

interface BrowsingColumnProps {
  side: 'A' | 'B';
  state: SideState;
  setState: React.Dispatch<React.SetStateAction<SideState>>;
  treePosition: 'left' | 'right';   // which edge the tree flanks
  collapsibleTree: boolean;          // true in compare mode
  dirHistory: string[];
  onAddDirHistory: (path: string) => void;
  onAddRecentFile: (path: string) => void;
  recentFiles: string[];
  autoplay: boolean;
  gridScale: number;
  theme: Theme;
  fullscreen: boolean;
  treeWidth: number;                 // tree expanded width (single mode); compare mode uses fixed
  onTreeWidthChange?: (w: number) => void;  // single mode only
  apiBase: string;
}

export function BrowsingColumn({
  side, state, setState, treePosition, collapsibleTree,
  dirHistory, onAddDirHistory, onAddRecentFile, recentFiles,
  autoplay, gridScale, fullscreen,
  treeWidth, onTreeWidthChange,
  apiBase,
}: BrowsingColumnProps) {
  const ctrl = useSideController(state, setState, onAddRecentFile, onAddDirHistory);

  // Auto-load root on mount / when rootDir changes externally (alias resolve)
  const lastLoadedRoot = useRef<string>('');
  useEffect(() => {
    if (state.rootDir && state.rootDir !== lastLoadedRoot.current && !state.treeData) {
      lastLoadedRoot.current = state.rootDir;
      ctrl.loadDirectory(state.rootDir);
    }
  }, [state.rootDir]);

  // Restore file from URL after tree loads (per-side pendingFileNav)
  useEffect(() => {
    if (state.treeData && ctrl.pendingFileNav.current) {
      const filePath = ctrl.pendingFileNav.current;
      ctrl.pendingFileNav.current = undefined;
      ctrl.navigateToFile(filePath);
    }
  }, [state.treeData]);

  const handleNavigate = useCallback((path: string) => {
    const findNodeByPath = (tree: FileNode | null, p: string): FileNode | undefined => {
      if (!tree) return undefined;
      if (tree.path === p) return tree;
      if (tree.children) for (const c of tree.children) {
        const f = findNodeByPath(c, p); if (f) return f;
      }
      return undefined;
    };
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

  const treeBlock = showTree ? (
    <>
      <div
        className="left-panel"
        style={{
          width: treeWidth,
          borderRight: treePosition === 'left' ? '1px solid var(--border-color)' : 'none',
          borderLeft: treePosition === 'right' ? '1px solid var(--border-color)' : 'none',
          order: treePosition === 'left' ? 0 : 2,
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
          style={{ order: treePosition === 'left' ? 1 : 1 }}
          onMouseDown={handleTreeDragStart}
        />
      )}
    </>
  ) : null;

  const collapseStripBlock = showCollapseStrip ? (
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
        order: treePosition === 'left' ? 0 : 2,
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
  ) : null;

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
        {treeBlock}
        {collapseStripBlock}
        <div className="main-panel" style={{ order: 1, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
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
```

Note: the `order` CSS property mirrors the layout — when `treePosition='right'`, the tree gets `order: 2` (after main-panel which is `order: 1`), so it visually appears on the right edge. When `treePosition='left'`, tree is `order: 0` so it sits on the left.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /vePFS/shock/TianYan/frontend && npx tsc --noEmit`
Expected: No errors. The unused imports / `dirHistory` fix as needed.

- [ ] **Step 3: Commit**

```bash
cd /vePFS/shock/TianYan
git add frontend/src/components/BrowsingColumn.tsx
git commit -m "feat: add BrowsingColumn component (one full browsing slice)"
```

### Task 7: Wire `BrowsingColumn` into `App.tsx` (single-mode only)

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Replace App.tsx body with `<GlobalHeader>` + `<BrowsingColumn>` for sideA**

Rewrite `App.tsx` so it becomes a thin shell. Replace the body of the `function App()` with this (preserving imports and the helper functions removed below):

```tsx
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
  const [sideB, _setSideB] = useState<SideState | null>(null);  // Phase 6 will wire this

  const [leftWidth, setLeftWidth] = useState(() => parseInt(localStorage.getItem('tianyan-left-width') || '280'));
  const [autoplay, setAutoplay] = useState(() => localStorage.getItem('tianyan-video-autoplay') === 'true');
  const [fullscreen, setFullscreen] = useState(false);
  const [gridScale, setGridScale] = useState(() => parseFloat(localStorage.getItem('tianyan-grid-scale') || '0.3'));

  const handleGridScaleChange = (val: number) => {
    setGridScale(val); localStorage.setItem('tianyan-grid-scale', String(val));
  };
  const handleAutoplayChange = (val: boolean) => {
    setAutoplay(val); localStorage.setItem('tianyan-video-autoplay', String(val));
  };
  const handleLeftWidthChange = (w: number) => {
    setLeftWidth(w); localStorage.setItem('tianyan-left-width', String(w));
  };

  // URL state sync — sideA only for now
  useUrlStateSync({ root: sideA.rootDir, viz: sideA.vizMode, file: sideA.selectedPath });

  // Resolve alias from URL on first load
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

  // 'F' key toggles fullscreen
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
            onCompareToggle={() => { /* Phase 6 */ }}
            onExitKeepLeft={() => { /* Phase 6 */ }}
            onExitKeepRight={() => { /* Phase 6 */ }}
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
            theme={theme}
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
```

Add the import:
```tsx
import { BrowsingColumn } from './components/BrowsingColumn';
import type { SideState, VizMode } from './types';
import { initialSideState } from './types';
```

Remove now-unused imports (`MainPanel`, `FileTree`, `ErrorBoundary`, `findNodeByPath`, `mergeChildren`, `useTreeStream`, `message`) and helper functions (`mergeChildren`, `findNodeByPath`) — they live in `useSideController` now.

- [ ] **Step 2: Run TypeScript check and dev build**

Run:
```bash
cd /vePFS/shock/TianYan/frontend && npx tsc --noEmit
```
Expected: No errors. Fix any unused-import warnings.

- [ ] **Step 3: Verify single-mode browser regression**

Reload `http://localhost:15090`. Verify:
- Type a root dir → tree loads, files appear
- Click a file → preview shows
- Switch viz → tuple matches show
- Refresh with `?a=...` URL → state restores
- Drag tree/main divider → resizes (and persists across reload)
- F → fullscreen hides global header + top panel + tree
- Theme, autoplay, grid scale, share button all work
- Recent files / dir history dropdowns work

- [ ] **Step 4: Commit**

```bash
cd /vePFS/shock/TianYan
git add frontend/src/App.tsx
git commit -m "refactor: render single-mode via BrowsingColumn"
```

---

## Phase 4 — Backend & frontend URL state for two sides

**Intent:** Extend the `/api/share` payload and the `?a=...&b=...` URL parsing so that compare-mode state can round-trip through a share link or URL refresh. No UI changes yet.

### Task 8: Extend `/api/share` to accept and return optional `b` field

**Files:**
- Modify: `backend/api/alias.py` (`ShareRequest`, `create_share`, `resolve_share`, storage encoding)

The current storage encodes state as a pipe string `root|relFile|viz`. To support an optional second side, switch to JSON storage (object) but read both formats so old codes still resolve.

- [ ] **Step 1: Update `ShareRequest` model and helper**

Replace the `class ShareRequest` and the `create_share`/`resolve_share` functions in `alias.py` with:

```python
from typing import Optional

class SharedSide(BaseModel):
    root: str
    file: str | None = None
    viz: str | None = None


class ShareRequest(BaseModel):
    # Backward-compatible: clients can still POST {root, file, viz} for single side.
    root: str | None = None
    file: str | None = None
    viz: str | None = None
    # New shape: {a: SharedSide, b?: SharedSide}
    a: SharedSide | None = None
    b: SharedSide | None = None


def _normalize_request(req: ShareRequest) -> tuple[SharedSide, SharedSide | None]:
    if req.a is not None:
        return req.a, req.b
    if req.root is not None:
        return SharedSide(root=req.root, file=req.file, viz=req.viz), None
    raise HTTPException(status_code=400, detail="Share request requires either {a,b?} or {root,file?,viz?}")


def _side_to_state_str(side: SharedSide) -> str:
    root = side.root.rstrip("/")
    state = root
    if side.file:
        rel = side.file
        if rel.startswith(root + "/"):
            rel = rel[len(root) + 1:]
        state += "|" + rel
    if side.viz and side.viz != "single":
        state += "|" + side.viz
    return state


def _state_str_to_side(state: str) -> dict:
    parts = state.split("|")
    root = parts[0]
    rel_file = parts[1] if len(parts) > 1 else None
    viz = parts[2] if len(parts) > 2 else None
    file_path = (root + "/" + rel_file) if rel_file else None
    return {"root": root, "file": file_path, "viz": viz}


@router.post("/api/share")
async def create_share(req: ShareRequest):
    """Create a short share code for full state (one or two sides)."""
    a, b = _normalize_request(req)
    a_str = _side_to_state_str(a)
    canonical = a_str if b is None else f"{a_str}||{_side_to_state_str(b)}"

    with _locked_json(SHARE_FILE) as (shares, save):
        for code, stored in shares.items():
            stored_canonical = stored if isinstance(stored, str) else stored.get("__canonical__")
            if stored_canonical == canonical:
                return {"code": code}

        code = _make_short_id(canonical, length=5)
        while code in shares and (
            (isinstance(shares[code], str) and shares[code] != canonical) or
            (isinstance(shares[code], dict) and shares[code].get("__canonical__") != canonical)
        ):
            code = code + "x"

        # Store as object so future fields are easier; keep canonical for dedup
        shares[code] = {"__canonical__": canonical, "a": a_str, "b": _side_to_state_str(b) if b else None}
        save(shares)
        return {"code": code}


@router.get("/api/share/{code}")
async def resolve_share(code: str):
    """Resolve a share code to full state. Backward-compat for old string entries."""
    shares = _load_json(SHARE_FILE)
    stored = shares.get(code)
    if stored is None:
        raise HTTPException(status_code=404, detail="Share link not found")

    if isinstance(stored, str):
        # Legacy single-side entry
        a = _state_str_to_side(stored)
        _allowed_roots.add(a["root"])
        return {"a": a, "b": None, **a}  # also include flat keys for legacy callers

    a = _state_str_to_side(stored["a"])
    _allowed_roots.add(a["root"])
    b = None
    if stored.get("b"):
        b = _state_str_to_side(stored["b"])
        _allowed_roots.add(b["root"])
    return {"a": a, "b": b, **a}  # flat keys preserved for old frontends
```

- [ ] **Step 2: Verify backend imports and starts cleanly**

```bash
cd /vePFS/shock/TianYan/backend && python -c "from main import app; print('OK')"
```
Expected: prints `OK` with no traceback.

- [ ] **Step 3: Smoke-test old single-side payload still works**

Restart backend (or `--reload` will pick it up), then:
```bash
curl -s -X POST http://localhost:8000/api/share \
  -H 'Content-Type: application/json' \
  -d '{"root":"/tmp","file":null,"viz":null}'
```
Expected: `{"code":"<5-char-code>"}`.

```bash
curl -s http://localhost:8000/api/share/<code>
```
Expected: JSON containing `"a": {...}, "b": null`, plus the legacy flat `root`/`file`/`viz` keys.

- [ ] **Step 4: Smoke-test new two-side payload**

```bash
curl -s -X POST http://localhost:8000/api/share \
  -H 'Content-Type: application/json' \
  -d '{"a":{"root":"/tmp","file":null,"viz":"single"},"b":{"root":"/tmp","file":null,"viz":"single"}}'
```
Expected: `{"code":"<code>"}`. Resolve and verify both `a` and `b` are present.

- [ ] **Step 5: Commit**

```bash
cd /vePFS/shock/TianYan
git add backend/api/alias.py
git commit -m "feat(api): /api/share supports two-sided state (backward compat preserved)"
```

### Task 9: Frontend `useUrlState` — parse and emit `b=` segment

**Files:**
- Modify: `frontend/src/hooks/useUrlState.ts`

- [ ] **Step 1: Extend `UrlState` and `getUrlState` to expose two sides**

Replace the contents of `useUrlState.ts` with:

```ts
import { useEffect, useRef } from 'react';

export interface UrlSide {
  root?: string;
  viz?: string;
  file?: string;
}

export interface UrlState extends UrlSide {
  // legacy flat keys (sideA) preserved
  // sideB optional
  b?: UrlSide;
  // internal markers used by useResolveAlias
  _share?: string;
  _alias?: string;       // sideA alias raw string
  _aliasB?: string;      // sideB alias raw string
}

// --- Share links: full state → short code ---

export async function buildShareUrl(state: { a: UrlSide; b?: UrlSide | null }): Promise<string> {
  const origin = window.location.origin;
  if (!state.a.root) return origin;

  try {
    const payload = state.b && state.b.root
      ? { a: { root: state.a.root, file: state.a.file || null, viz: state.a.viz || null },
          b: { root: state.b.root, file: state.b.file || null, viz: state.b.viz || null } }
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
      // Prefer new shape; fall back to flat root/file/viz
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

const aliasCache: Map<string, string> = new Map();  // path → id

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

  const root = params.get('root') || undefined;
  let file = params.get('file') || undefined;
  if (file && root && !file.startsWith('/')) file = root.replace(/\/+$/, '') + '/' + file;
  return { root, viz: params.get('viz') || undefined, file };
}

// --- Async resolution on mount ---

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
      b ? resolveSideFromAlias(b) : Promise.resolve(undefined),
    ]).then(([sideA, sideB]) => {
      if (sideA) onResolved({ a: sideA, b: sideB || undefined });
    });
  }, []);
}

// --- Sync address bar (alias for moderate URLs) ---

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
```

- [ ] **Step 2: Update `App.tsx` to use the new `useUrlState` shape**

In `App.tsx`, replace the current `useUrlStateSync({ root: ..., viz: ..., file: ... })` call with:

```tsx
useUrlStateSync({
  a: { root: sideA.rootDir, viz: sideA.vizMode, file: sideA.selectedPath },
  b: sideB ? { root: sideB.rootDir, viz: sideB.vizMode, file: sideB.selectedPath } : null,
});
```

And update the `useResolveAlias` callback to read the new `{ a, b? }` shape:

```tsx
useResolveAlias((resolved) => {
  if (resolved.a?.root) {
    setSideA(prev => ({
      ...prev,
      rootDir: resolved.a.root!,
      vizMode: (resolved.a.viz as VizMode) || prev.vizMode,
      selectedPath: resolved.a.file ?? prev.selectedPath,
    }));
  }
  if (resolved.b?.root) {
    _setSideB(initialSideState({
      rootDir: resolved.b.root,
      vizMode: (resolved.b.viz as VizMode) || 'single',
      selectedPath: resolved.b.file,
      treeCollapsed: true,
    }));
  }
});
```

The initial `getUrlState()` call also needs adapting. Replace:
```tsx
const urlState = getUrlState();
const [sideA, setSideA] = useState<SideState>(initialSideState({
  rootDir: urlState.root || '',
  vizMode: (urlState.viz as VizMode) || 'single',
  selectedPath: urlState.file,
}));
```
with:
```tsx
const urlState = getUrlState();
const [sideA, setSideA] = useState<SideState>(initialSideState({
  rootDir: urlState.root || '',
  vizMode: (urlState.viz as VizMode) || 'single',
  selectedPath: urlState.file,
}));
const [sideB, _setSideB] = useState<SideState | null>(null);
```
(getUrlState's flat `root`/`viz`/`file` for the legacy `?p=` and `?root=` URL formats still feeds sideA. The `?a=...&b=...` and `?s=...` formats are async and handled in `useResolveAlias`.)

- [ ] **Step 3: Update `TopPanel.tsx` import — `buildShareUrl` is no longer imported there** (it was already removed in Phase 2, just verify no broken imports remain)

Run: `cd /vePFS/shock/TianYan/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Verify single-mode browser behavior unchanged**

Reload `http://localhost:15090`. Verify:
- Old `?a=...` URLs still resolve and load
- Old `?s=...` codes still resolve
- New share clicks still produce a working `?s=...` link
- URL bar updates as you change root / select file / change viz

- [ ] **Step 5: Commit**

```bash
cd /vePFS/shock/TianYan
git add frontend/src/hooks/useUrlState.ts frontend/src/App.tsx
git commit -m "feat: useUrlState supports optional sideB (a=...&b=...)"
```

---

## Phase 5 — Wire compare toggle and two-column layout

**Intent:** Add the actual compare-mode UI: enter/exit, render two `BrowsingColumn`s with mirrored tree positions, draggable column divider.

### Task 10: Add `ColumnDivider` component

**Files:**
- Create: `frontend/src/components/ColumnDivider.tsx`
- Modify: `frontend/src/App.css` (style)

- [ ] **Step 1: Write `ColumnDivider.tsx`**

```tsx
interface ColumnDividerProps {
  onDragStart: (e: React.MouseEvent) => void;
}

export function ColumnDivider({ onDragStart }: ColumnDividerProps) {
  return <div className="column-divider" onMouseDown={onDragStart} />;
}
```

- [ ] **Step 2: Add CSS for `.column-divider`**

Append to `frontend/src/App.css`:

```css
.column-divider {
  width: 6px;
  cursor: col-resize;
  background: var(--border-color);
  flex-shrink: 0;
  transition: background 0.2s;
}
.column-divider:hover {
  background: var(--accent);
}
.browsing-column {
  min-width: 200px;
}
```

- [ ] **Step 3: Commit**

```bash
cd /vePFS/shock/TianYan
git add frontend/src/components/ColumnDivider.tsx frontend/src/App.css
git commit -m "feat: add ColumnDivider component and CSS"
```

### Task 11: Wire compare toggle and render two `BrowsingColumn`s

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Replace `_setSideB` with `setSideB` and add column-split state**

In `App.tsx`:

```tsx
const [sideB, setSideB] = useState<SideState | null>(null);
const [columnSplit, setColumnSplit] = useState<number>(() => {
  const v = parseFloat(localStorage.getItem('tianyan-column-split') || '0.5');
  return isFinite(v) && v > 0 && v < 1 ? v : 0.5;
});

const handleColumnSplitChange = (next: number) => {
  setColumnSplit(next);
  localStorage.setItem('tianyan-column-split', String(next));
};
```

(Rename every prior `_setSideB` reference to `setSideB`.)

- [ ] **Step 2: Implement compare toggle handlers**

In `App.tsx`, replace the three placeholder handlers in the `<GlobalHeader>` props:

```tsx
onCompareToggle={() => {
  if (!sideA.rootDir) return;
  setSideB({
    ...sideA,
    treeCollapsed: true,
    treeData: null,           // force re-fetch so each side has its own tree object
  });
}}
onExitKeepLeft={() => setSideB(null)}
onExitKeepRight={() => {
  if (!sideB) return;
  setSideA({ ...sideB, treeCollapsed: false });
  setSideB(null);
}}
```

Note: cloning `sideA` with `treeData: null` forces side B's `BrowsingColumn` to reload its own tree (clean separation). The `treeCollapsed: true` makes side B's tree start collapsed for max preview real estate.

- [ ] **Step 3: Render two columns with `ColumnDivider` when `sideB !== null`**

Replace the existing single `<BrowsingColumn>` with:

```tsx
<div className="app-body">
  <div style={{
    flex: sideB ? columnSplit : 1,
    display: 'flex',
    minWidth: 0,
    overflow: 'hidden',
  }}>
    <BrowsingColumn
      side="A"
      state={sideA}
      setState={setSideA}
      treePosition="left"
      collapsibleTree={sideB !== null}
      dirHistory={dirHistory}
      onAddDirHistory={addToHistory}
      onAddRecentFile={addRecentFile}
      recentFiles={recentFiles}
      autoplay={autoplay}
      gridScale={gridScale}
      theme={theme}
      fullscreen={fullscreen}
      treeWidth={leftWidth}
      onTreeWidthChange={sideB ? undefined : handleLeftWidthChange}
      apiBase=""
    />
  </div>
  {sideB && (
    <>
      <ColumnDivider onDragStart={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startSplit = columnSplit;
        const containerWidth = (e.currentTarget as HTMLElement).parentElement!.clientWidth;
        const onMove = (ev: MouseEvent) => {
          const delta = (ev.clientX - startX) / containerWidth;
          const next = Math.max(0.15, Math.min(0.85, startSplit + delta));
          handleColumnSplitChange(next);
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }} />
      <div style={{
        flex: 1 - columnSplit,
        display: 'flex',
        minWidth: 0,
        overflow: 'hidden',
      }}>
        <BrowsingColumn
          side="B"
          state={sideB}
          setState={setSideB as React.Dispatch<React.SetStateAction<SideState>>}
          treePosition="right"
          collapsibleTree={true}
          dirHistory={dirHistory}
          onAddDirHistory={addToHistory}
          onAddRecentFile={addRecentFile}
          recentFiles={recentFiles}
          autoplay={autoplay}
          gridScale={gridScale}
          theme={theme}
          fullscreen={fullscreen}
          treeWidth={leftWidth}
          apiBase=""
        />
      </div>
    </>
  )}
</div>
```

Add the import:
```tsx
import { ColumnDivider } from './components/ColumnDivider';
```

Note on the `setState as React.Dispatch<...>` cast for sideB: `setSideB` has type `Dispatch<SetStateAction<SideState | null>>` but `BrowsingColumn` wants `Dispatch<SetStateAction<SideState>>`. This is safe because once we render side B, it's never `null` from B's perspective — exiting compare mode unmounts B. The cast preserves type-safety for child components.

- [ ] **Step 4: Run TypeScript check**

```bash
cd /vePFS/shock/TianYan/frontend && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 5: Verify in browser — full compare flow**

Reload `http://localhost:15090`. Test:

1. **Single mode** — load a root, pick a file. Confirm everything still works (regression baseline).
2. **Enter compare** — click "Compare" in global header. Right column appears with the same root, tree collapsed (icon strip on left edge of column B), preview matches.
3. **Independence** — click ≡ on side B's icon strip → tree expands. Pick a different file on side B → preview updates, side A unchanged.
4. **Tree mirror** — verify side A's tree is on the far left, side B's tree (when expanded) is on the far right (its `≡`/`×` toggle on its inner edge facing left).
5. **Column drag** — drag the divider between the two previews → both columns resize, persists across reload.
6. **Per-side viz** — change viz on side A → only side A re-renders; side B stays the same.
7. **Per-side root** — paste a different root in side B's top panel → side B reloads tree.
8. **Exit ← Keep Left** — right column unmounts, left column state preserved.
9. **Re-enter and Exit Keep Right →** — confirm side A inherits side B's state, side B unmounts.
10. **URL state** — in compare mode, observe URL has `?a=...&b=...`. Refresh → both sides restore.
11. **Share** — click share, open in new tab, both sides restore.
12. **Old `?s=...` codes** — open a previously-saved single-side share code → loads as single mode.

- [ ] **Step 6: Commit**

```bash
cd /vePFS/shock/TianYan
git add frontend/src/App.tsx
git commit -m "feat: enable comparing mode with two BrowsingColumns + ColumnDivider"
```

---

## Phase 6 — Fullscreen and polish

### Task 12: Fullscreen behavior in compare mode

**Files:**
- Modify: `frontend/src/App.tsx` and/or `frontend/src/components/BrowsingColumn.tsx`

The current behavior already does the right thing in compare mode: pressing `F` hides `GlobalHeader` (we wrap it in `!fullscreen &&`) and `TopPanel` inside each `BrowsingColumn` (also wrapped in `!fullscreen &&`). Trees auto-hide because `showTree = !fullscreen && ...` and `showCollapseStrip = !fullscreen && ...`. So in fullscreen + compare, both previews fill their columns with just the column divider between them. **Verify this works** and add a fix if needed.

- [ ] **Step 1: Browser-verify fullscreen in both modes**

Reload `http://localhost:15090`.

Single mode + F: header + topbar + tree all hide; preview fills viewport. F again restores.

Compare mode + F: global header + both topbars + both trees + both icon strips all hide. Just two previews + column divider. Column divider is still draggable. F again restores.

If anything is wrong (e.g., topbar still showing in fullscreen for one column), fix the corresponding `!fullscreen &&` condition inline.

- [ ] **Step 2: Commit if any fix was made**

```bash
cd /vePFS/shock/TianYan
git add -u
git commit -m "fix: tighten fullscreen behavior in compare mode" || echo "no changes"
```

### Task 13: Preserve & document tree-collapsed state across mode toggles

**Intent:** When the user expands a tree in compare mode, then exits, then re-enters compare mode, the previously-expanded state is reasonable (defaulting back to collapsed is fine — it's a fresh compare session). But persisted localStorage for column split should already work via Task 11.

- [ ] **Step 1: Verify column split persists across browser reloads**

Open compare mode, drag divider to ~70/30, reload page (open a `?s=...` share that includes both sides). Expected: column split is restored from localStorage.

- [ ] **Step 2: Commit (if changes were needed)**

Likely no commit. If you find a regression, fix and commit.

---

## Phase 7 — Final regression sweep & cleanup

### Task 14: Full manual regression suite

- [ ] **Step 1: Run through all spec section 12 verification items**

For each item in `docs/superpowers/specs/2026-04-26-comparing-mode-design.md` Section 12, click through the flow and confirm. Note any failures and fix them.

- [ ] **Step 2: Confirm no console errors in browser DevTools**

Open DevTools console while exercising single + compare flows. Expected: no red errors. Yellow warnings about `findDOMNode` or React strict-mode patterns are pre-existing and OK.

- [ ] **Step 3: Final commit / push**

If any final cleanup edits, commit them:
```bash
cd /vePFS/shock/TianYan
git add -u
git commit -m "polish: comparing-mode regression fixes" || echo "no final cleanup needed"
```

Do NOT push to remote unless the user explicitly asks. The work lands as a series of local commits on `master`.

---

## Self-Review Notes (for the executor)

- **Spec coverage:** every section of the spec maps to at least one task — Section 2 (layout) → Tasks 6, 11; Section 3 (controls split) → Tasks 3, 4; Section 4 (transitions) → Task 11; Section 5 (state shape) → Tasks 1, 2, 5, 7; Section 6 (components) → Tasks 3-7, 10-11; Section 7 (URL/share) → Tasks 8, 9; Section 8 (backend) → Task 8; Section 9 (behavior details) → Tasks 11, 12; Section 12 (testing) → Task 14.
- **No placeholders** — every code block contains the actual code; verification commands are concrete.
- **Type consistency** — `SideState` shape is defined once in Task 1 and referenced unchanged everywhere. `useSideController` interface defined in Task 5 is consumed verbatim in Task 6.
- **Per-side findNodeByPath helper duplication** — `useSideController.ts` and `BrowsingColumn.tsx` both contain a small `findNodeByPath`. This is intentional (DRY trade-off: avoid creating a `frontend/src/utils/tree.ts` for a 7-line function used in two places). If it grows to a third use site, extract.
- **Tree-render order CSS trick** — `BrowsingColumn` uses `flex order` to flip the tree from left edge to right edge depending on `treePosition` rather than two duplicate JSX trees. Reviewed: works because the parent `display: flex` row.
