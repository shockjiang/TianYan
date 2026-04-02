# TianYan File Preview Website — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a file preview web app with recursive directory browsing, single-file viewers, and a scalable tuple visualization plugin system.

**Architecture:** FastAPI backend serves directory trees and raw files. React + TypeScript + Vite frontend with Ant Design renders a three-panel layout. Tuple visualizations use a plugin registry pattern where each type self-registers with a matcher function and viewer component.

**Tech Stack:** Python 3.10 + FastAPI + uvicorn (backend), Node 24 + React 18 + TypeScript + Vite + Ant Design 5 (frontend)

**Spec:** `docs/superpowers/specs/2026-04-02-tianyan-file-preview-design.md`

**Environment:**
- Install pip packages with: `XDG_CACHE_HOME=/vePFS/shock/xdg_cache pip3 install ...`
- Install npm packages with: `npm install ...` (from frontend/ dir)
- Backend runs on port 8000, frontend on port 5173

---

## Task 1: Backend — Project Setup & Directory API

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/main.py`
- Create: `backend/api/__init__.py`
- Create: `backend/api/directory.py`

- [ ] **Step 1: Create backend requirements**

```
# backend/requirements.txt
fastapi==0.115.0
uvicorn[standard]==0.30.0
Pillow==10.4.0
python-multipart==0.0.9
```

- [ ] **Step 2: Install backend dependencies**

Run: `cd /vePFS/shock/TianYan && XDG_CACHE_HOME=/vePFS/shock/xdg_cache pip3 install -r backend/requirements.txt`
Expected: All packages install successfully.

- [ ] **Step 3: Create the directory API module**

```python
# backend/api/__init__.py
# (empty)
```

```python
# backend/api/directory.py
import os
from pathlib import Path
from fastapi import APIRouter, Query, HTTPException

router = APIRouter()


def _safe_resolve(path: str, allowed_root: str | None = None) -> Path:
    """Resolve path and validate it doesn't escape allowed_root."""
    resolved = Path(path).resolve()
    if allowed_root:
        root = Path(allowed_root).resolve()
        if not str(resolved).startswith(str(root)):
            raise HTTPException(status_code=403, detail="Path traversal denied")
    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {resolved}")
    return resolved


def _scan_directory(dir_path: Path, depth: int = 1, current_depth: int = 0) -> dict:
    """Recursively scan directory up to given depth."""
    result = {
        "name": dir_path.name or str(dir_path),
        "path": str(dir_path),
        "type": "directory",
    }
    if current_depth >= depth:
        result["children"] = []
        result["hasChildren"] = any(dir_path.iterdir())
        return result

    children = []
    try:
        entries = sorted(dir_path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        for entry in entries:
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                children.append(_scan_directory(entry, depth, current_depth + 1))
            elif entry.is_file():
                children.append({
                    "name": entry.name,
                    "path": str(entry),
                    "type": "file",
                    "extension": entry.suffix.lower(),
                    "size": entry.stat().st_size,
                })
    except PermissionError:
        pass
    result["children"] = children
    return result


@router.get("/api/directory")
async def get_directory(path: str = Query(..., description="Root directory path"),
                        depth: int = Query(1, ge=1, le=10)):
    resolved = _safe_resolve(path)
    if not resolved.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")
    return _scan_directory(resolved, depth=depth)
```

- [ ] **Step 4: Create the FastAPI main entry point**

```python
# backend/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.directory import router as directory_router

app = FastAPI(title="TianYan API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(directory_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 5: Verify backend starts**

Run: `cd /vePFS/shock/TianYan/backend && python3 -c "from main import app; print('OK')"`
Expected: prints `OK`

- [ ] **Step 6: Start backend and test directory API**

Run: `cd /vePFS/shock/TianYan/backend && timeout 5 uvicorn main:app --host 0.0.0.0 --port 8000 &` then `sleep 2 && curl -s 'http://localhost:8000/api/directory?path=/vePFS/shock/TianYan' | python3 -m json.tool | head -20`
Expected: JSON tree with `backend/`, `frontend/`, `docs/` entries.
Clean up: kill the uvicorn process after testing.

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat: add FastAPI backend with directory listing API"
```

---

## Task 2: Backend — File Serving & File Info APIs

**Files:**
- Create: `backend/api/file.py`
- Create: `backend/api/file_info.py`
- Modify: `backend/main.py` (add new routers)

- [ ] **Step 1: Create file serving endpoint**

```python
# backend/api/file.py
import mimetypes
from pathlib import Path
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import FileResponse, Response
from api.directory import _safe_resolve

router = APIRouter()

# Ensure common types are registered
mimetypes.add_type("image/png", ".png")
mimetypes.add_type("image/jpeg", ".jpg")
mimetypes.add_type("image/jpeg", ".jpeg")
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/bmp", ".bmp")
mimetypes.add_type("image/gif", ".gif")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("text/plain", ".txt")
mimetypes.add_type("text/plain", ".log")
mimetypes.add_type("text/plain", ".csv")
mimetypes.add_type("text/yaml", ".yaml")
mimetypes.add_type("text/yaml", ".yml")
mimetypes.add_type("text/xml", ".xml")
mimetypes.add_type("text/markdown", ".md")


@router.get("/api/file")
async def get_file(path: str = Query(..., description="Absolute file path")):
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    mime_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
    return FileResponse(str(resolved), media_type=mime_type)


@router.get("/api/thumbnail")
async def get_thumbnail(path: str = Query(..., description="Absolute image file path"),
                        size: int = Query(48, ge=16, le=256)):
    """Return a small thumbnail of an image file."""
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    mime_type = mimetypes.guess_type(str(resolved))[0] or ""
    if not mime_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Not an image file")

    try:
        from PIL import Image
        import io
        img = Image.open(str(resolved))
        img.thumbnail((size, size))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return Response(content=buf.read(), media_type="image/png")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Thumbnail generation failed: {e}")
```

- [ ] **Step 2: Create file info endpoint**

```python
# backend/api/file_info.py
import os
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Query, HTTPException
from api.directory import _safe_resolve

router = APIRouter()


@router.get("/api/file-info")
async def get_file_info(path: str = Query(..., description="Absolute file path")):
    resolved = _safe_resolve(path)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    stat = resolved.stat()
    info = {
        "path": str(resolved),
        "name": resolved.name,
        "extension": resolved.suffix.lower(),
        "size": stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        "dimensions": None,
    }

    # Try to get image dimensions
    mime_ext = resolved.suffix.lower()
    if mime_ext in (".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp"):
        try:
            from PIL import Image
            with Image.open(str(resolved)) as img:
                info["dimensions"] = list(img.size)
        except Exception:
            pass

    return info
```

- [ ] **Step 3: Register new routers in main.py**

Add to `backend/main.py` after the directory router import:

```python
from api.file import router as file_router
from api.file_info import router as file_info_router
```

And after `app.include_router(directory_router)`:

```python
app.include_router(file_router)
app.include_router(file_info_router)
```

- [ ] **Step 4: Verify all endpoints load**

Run: `cd /vePFS/shock/TianYan/backend && python3 -c "from main import app; print([r.path for r in app.routes])"`
Expected: list containing `/api/directory`, `/api/file`, `/api/file-info`, `/api/thumbnail`, `/api/health`

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "feat: add file serving, thumbnail, and file-info API endpoints"
```

---

## Task 3: Frontend — Project Scaffold

**Files:**
- Create: `frontend/` (entire Vite + React + TS scaffold)
- Create: `frontend/src/types.ts` (shared types)

- [ ] **Step 1: Scaffold Vite React TypeScript project**

Run:
```bash
cd /vePFS/shock/TianYan
npm create vite@latest frontend -- --template react-ts
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
cd /vePFS/shock/TianYan/frontend
npm install
npm install antd @ant-design/icons react-json-view-lite
```

- [ ] **Step 3: Create shared types file**

```typescript
// frontend/src/types.ts

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  extension?: string;
  size?: number;
  children?: FileNode[];
  hasChildren?: boolean;
}

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  modified: string;
  dimensions: [number, number] | null;
}

export interface TupleMatch {
  label: string;
  files: Record<string, string>; // role → absolute file path
  confidence: number;
}

export type TupleMatcher = (
  files: FileNode[],
  selectedFile?: FileNode
) => TupleMatch[];

export interface TupleType {
  name: string;       // Display name: "RGB + Depth"
  key: string;        // URL-safe key: "rgb_depth"
  roles: string[];    // ["rgb", "depth"]
  matcher: TupleMatcher;
  component: React.FC<TupleViewerProps>;
}

export interface TupleViewerProps {
  match: TupleMatch;
  apiBase: string;
}

export type VizMode = "single" | string; // "single" or a tuple key like "rgb_depth"
```

- [ ] **Step 4: Configure Vite proxy to backend**

Replace `frontend/vite.config.ts`:

```typescript
// frontend/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 5: Verify frontend builds**

Run: `cd /vePFS/shock/TianYan/frontend && npx vite build`
Expected: Build succeeds with output in `dist/`.

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold frontend with Vite, React, TypeScript, Ant Design"
```

---

## Task 4: Frontend — App Layout & Theme

**Files:**
- Create: `frontend/src/hooks/useTheme.ts`
- Create: `frontend/src/hooks/useUrlState.ts`
- Create: `frontend/src/hooks/useDirectoryHistory.ts`
- Create: `frontend/src/hooks/useRecentFiles.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.css` (delete default content)
- Modify: `frontend/src/index.css` (global dark theme styles)
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Create useTheme hook**

```typescript
// frontend/src/hooks/useTheme.ts
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
```

- [ ] **Step 2: Create useUrlState hook**

```typescript
// frontend/src/hooks/useUrlState.ts
import { useEffect, useCallback } from 'react';

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
```

- [ ] **Step 3: Create useDirectoryHistory hook**

```typescript
// frontend/src/hooks/useDirectoryHistory.ts
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
```

- [ ] **Step 4: Create useRecentFiles hook**

```typescript
// frontend/src/hooks/useRecentFiles.ts
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
```

- [ ] **Step 5: Create global CSS with dark/light theme**

```css
/* frontend/src/index.css */
:root {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --bg-panel: #0f3460;
  --text-primary: #e8e8e8;
  --text-secondary: #a0a0a0;
  --border-color: #2a2a4a;
  --accent: #4fc3f7;
  --hover-bg: #1e3a5f;
}

[data-theme="light"] {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-panel: #fafafa;
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --border-color: #e0e0e0;
  --accent: #1890ff;
  --hover-bg: #e6f7ff;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
  height: 100vh;
}

#root {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: var(--bg-secondary);
}
::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}
```

- [ ] **Step 6: Create App.tsx with three-panel layout**

```tsx
// frontend/src/App.tsx
import { useState, useEffect, useCallback } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import { TopPanel } from './components/TopPanel';
import { FileTree } from './components/FileTree';
import { MainPanel } from './components/MainPanel';
import { useTheme } from './hooks/useTheme';
import { getUrlState, useUrlStateSync } from './hooks/useUrlState';
import { useDirectoryHistory } from './hooks/useDirectoryHistory';
import { useRecentFiles } from './hooks/useRecentFiles';
import type { FileNode, VizMode } from './types';
import './App.css';

const API_BASE = '';

function App() {
  const [theme, toggleTheme] = useTheme();
  const { history: dirHistory, addToHistory } = useDirectoryHistory();
  const { recentFiles, addRecentFile } = useRecentFiles();

  // App state — initialized from URL
  const urlState = getUrlState();
  const [rootDir, setRootDir] = useState(urlState.root || '');
  const [vizMode, setVizMode] = useState<VizMode>(urlState.viz || 'single');
  const [selectedPath, setSelectedPath] = useState<string | undefined>(urlState.file);
  const [selectedNode, setSelectedNode] = useState<FileNode | undefined>();
  const [treeData, setTreeData] = useState<FileNode | null>(null);
  const [leftWidth, setLeftWidth] = useState(() => {
    return parseInt(localStorage.getItem('tianyan-left-width') || '280');
  });

  // Sync state → URL
  useUrlStateSync({ root: rootDir, viz: vizMode, file: selectedPath });

  // Fetch directory tree
  const loadDirectory = useCallback(async (path: string) => {
    if (!path) return;
    try {
      const res = await fetch(`${API_BASE}/api/directory?path=${encodeURIComponent(path)}&depth=2`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setTreeData(data);
      addToHistory(path);
    } catch (err: any) {
      console.error('Failed to load directory:', err);
      setTreeData(null);
    }
  }, [addToHistory]);

  // Load initial directory from URL
  useEffect(() => {
    if (rootDir) loadDirectory(rootDir);
  }, []);

  const handleRootSubmit = (path: string) => {
    setRootDir(path);
    setSelectedPath(undefined);
    setSelectedNode(undefined);
    loadDirectory(path);
  };

  const handleSelect = (node: FileNode) => {
    setSelectedPath(node.path);
    setSelectedNode(node);
    if (node.type === 'file') {
      addRecentFile(node.path);
    }
  };

  // Resizable panel
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftWidth;
    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.min(500, Math.max(200, startWidth + ev.clientX - startX));
      setLeftWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem('tianyan-left-width', String(leftWidth));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [leftWidth]);

  return (
    <ConfigProvider
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: '#4fc3f7' },
      }}
    >
      <div className="app">
        <TopPanel
          rootDir={rootDir}
          dirHistory={dirHistory}
          vizMode={vizMode}
          theme={theme}
          onRootSubmit={handleRootSubmit}
          onVizChange={setVizMode}
          onThemeToggle={toggleTheme}
        />
        <div className="app-body">
          <div className="left-panel" style={{ width: leftWidth }}>
            <FileTree
              treeData={treeData}
              selectedPath={selectedPath}
              recentFiles={recentFiles}
              onSelect={handleSelect}
              onLoadChildren={loadDirectory}
              apiBase={API_BASE}
            />
          </div>
          <div className="panel-divider" onMouseDown={handleDragStart} />
          <div className="main-panel">
            <MainPanel
              selectedNode={selectedNode}
              vizMode={vizMode}
              treeData={treeData}
              apiBase={API_BASE}
            />
          </div>
        </div>
      </div>
    </ConfigProvider>
  );
}

export default App;
```

- [ ] **Step 7: Create App.css**

```css
/* frontend/src/App.css */
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
}

.app-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.left-panel {
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.panel-divider {
  width: 4px;
  cursor: col-resize;
  background: var(--border-color);
  transition: background 0.2s;
  flex-shrink: 0;
}
.panel-divider:hover {
  background: var(--accent);
}

.main-panel {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 8: Update main.tsx**

```tsx
// frontend/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 9: Create stub components (TopPanel, FileTree, MainPanel)**

These will be fully implemented in subsequent tasks, but we need stubs so the app compiles.

```tsx
// frontend/src/components/TopPanel.tsx
import type { VizMode } from '../types';
import type { Theme } from '../hooks/useTheme';

interface TopPanelProps {
  rootDir: string;
  dirHistory: string[];
  vizMode: VizMode;
  theme: Theme;
  onRootSubmit: (path: string) => void;
  onVizChange: (mode: VizMode) => void;
  onThemeToggle: () => void;
}

export function TopPanel({ rootDir, dirHistory, vizMode, theme, onRootSubmit, onVizChange, onThemeToggle }: TopPanelProps) {
  return (
    <div style={{ height: 48, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12 }}>
      <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 16 }}>TianYan</span>
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Stub — will be replaced</span>
    </div>
  );
}
```

```tsx
// frontend/src/components/FileTree.tsx
import type { FileNode } from '../types';

interface FileTreeProps {
  treeData: FileNode | null;
  selectedPath?: string;
  recentFiles: string[];
  onSelect: (node: FileNode) => void;
  onLoadChildren: (path: string) => void;
  apiBase: string;
}

export function FileTree({ treeData }: FileTreeProps) {
  return (
    <div style={{ padding: 16, color: 'var(--text-secondary)' }}>
      {treeData ? `Tree loaded: ${treeData.name}` : 'No directory loaded'}
    </div>
  );
}
```

```tsx
// frontend/src/components/MainPanel.tsx
import type { FileNode, VizMode } from '../types';

interface MainPanelProps {
  selectedNode?: FileNode;
  vizMode: VizMode;
  treeData: FileNode | null;
  apiBase: string;
}

export function MainPanel({ selectedNode }: MainPanelProps) {
  return (
    <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
      {selectedNode ? `Selected: ${selectedNode.path}` : 'Select a file to preview'}
    </div>
  );
}
```

- [ ] **Step 10: Verify frontend compiles and renders**

Run: `cd /vePFS/shock/TianYan/frontend && npx vite build`
Expected: Build succeeds.

- [ ] **Step 11: Commit**

```bash
git add frontend/
git commit -m "feat: add frontend layout with theme, URL state, resizable panels, and stub components"
```

---

## Task 5: Frontend — TopPanel Component

**Files:**
- Modify: `frontend/src/components/TopPanel.tsx`

- [ ] **Step 1: Implement full TopPanel with root dir input, viz selector, theme toggle**

```tsx
// frontend/src/components/TopPanel.tsx
import { useState } from 'react';
import { AutoComplete, Select, Button, Space } from 'antd';
import { SunOutlined, MoonOutlined } from '@ant-design/icons';
import { getTupleTypes } from '../tuples/registry';
import type { VizMode } from '../types';
import type { Theme } from '../hooks/useTheme';

interface TopPanelProps {
  rootDir: string;
  dirHistory: string[];
  vizMode: VizMode;
  theme: Theme;
  onRootSubmit: (path: string) => void;
  onVizChange: (mode: VizMode) => void;
  onThemeToggle: () => void;
}

export function TopPanel({ rootDir, dirHistory, vizMode, theme, onRootSubmit, onVizChange, onThemeToggle }: TopPanelProps) {
  const [inputValue, setInputValue] = useState(rootDir);
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
      height: 48,
      background: 'var(--bg-panel)',
      borderBottom: '1px solid var(--border-color)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 12,
      flexShrink: 0,
    }}>
      <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap' }}>
        TianYan
      </span>
      <AutoComplete
        style={{ flex: 1, maxWidth: 500 }}
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
      <Button type="primary" size="small" onClick={handleSubmit}>
        Load
      </Button>
      <Select
        style={{ width: 180 }}
        value={vizMode}
        onChange={onVizChange}
        options={vizOptions}
        size="small"
      />
      <Button
        type="text"
        size="small"
        icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        onClick={onThemeToggle}
        style={{ color: 'var(--text-primary)' }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create stub tuple registry (needed by TopPanel)**

```typescript
// frontend/src/tuples/registry.ts
import type { TupleType } from '../types';

const registry: TupleType[] = [];

export function registerTuple(tupleType: TupleType) {
  const existing = registry.findIndex(t => t.key === tupleType.key);
  if (existing >= 0) registry[existing] = tupleType;
  else registry.push(tupleType);
}

export function getTupleTypes(): TupleType[] {
  return [...registry];
}

export function getTupleByKey(key: string): TupleType | undefined {
  return registry.find(t => t.key === key);
}
```

- [ ] **Step 3: Verify build**

Run: `cd /vePFS/shock/TianYan/frontend && npx vite build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/TopPanel.tsx frontend/src/tuples/registry.ts
git commit -m "feat: implement TopPanel with dir history, viz selector, theme toggle"
```

---

## Task 6: Frontend — FileTree Component

**Files:**
- Modify: `frontend/src/components/FileTree.tsx`

- [ ] **Step 1: Implement FileTree with Ant Design Tree, search filter, recent files**

```tsx
// frontend/src/components/FileTree.tsx
import { useState, useMemo } from 'react';
import { Tree, Input } from 'antd';
import { FolderOutlined, FileOutlined, FileImageOutlined, FileTextOutlined } from '@ant-design/icons';
import type { FileNode } from '../types';
import type { DataNode, EventDataNode } from 'antd/es/tree';

interface FileTreeProps {
  treeData: FileNode | null;
  selectedPath?: string;
  recentFiles: string[];
  onSelect: (node: FileNode) => void;
  onLoadChildren: (path: string) => void;
  apiBase: string;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp']);
const TEXT_EXTS = new Set(['.txt', '.log', '.csv', '.yaml', '.yml', '.xml', '.md']);

function getFileIcon(node: FileNode) {
  if (node.type === 'directory') return <FolderOutlined style={{ color: '#f0c040' }} />;
  if (node.extension && IMAGE_EXTS.has(node.extension)) return <FileImageOutlined style={{ color: '#4fc3f7' }} />;
  if (node.extension && (TEXT_EXTS.has(node.extension) || node.extension === '.json')) return <FileTextOutlined style={{ color: '#81c784' }} />;
  return <FileOutlined />;
}

function buildTreeData(node: FileNode, filter: string): DataNode | null {
  if (node.type === 'file') {
    if (filter && !node.name.toLowerCase().includes(filter.toLowerCase())) return null;
    return {
      key: node.path,
      title: node.name,
      icon: getFileIcon(node),
      isLeaf: true,
    };
  }
  // Directory
  const children = (node.children || [])
    .map(child => buildTreeData(child, filter))
    .filter(Boolean) as DataNode[];
  // If filter is active and no children match, skip this dir (unless dir name matches)
  if (filter && children.length === 0 && !node.name.toLowerCase().includes(filter.toLowerCase())) {
    return null;
  }
  return {
    key: node.path,
    title: node.name,
    icon: getFileIcon(node),
    children,
    isLeaf: false,
  };
}

// Build a lookup map from path → FileNode for quick selection
function buildNodeMap(node: FileNode, map: Map<string, FileNode>) {
  map.set(node.path, node);
  if (node.children) {
    for (const child of node.children) buildNodeMap(child, map);
  }
}

export function FileTree({ treeData, selectedPath, recentFiles, onSelect, onLoadChildren, apiBase }: FileTreeProps) {
  const [filter, setFilter] = useState('');

  const nodeMap = useMemo(() => {
    const map = new Map<string, FileNode>();
    if (treeData) buildNodeMap(treeData, map);
    return map;
  }, [treeData]);

  const antTreeData = useMemo(() => {
    if (!treeData) return [];
    const root = buildTreeData(treeData, filter);
    return root ? (root.children || [root]) : [];
  }, [treeData, filter]);

  const handleSelect = (_: any, info: { node: EventDataNode<DataNode> }) => {
    const node = nodeMap.get(info.node.key as string);
    if (node) onSelect(node);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 8px 4px' }}>
        <Input.Search
          placeholder="Filter files..."
          size="small"
          allowClear
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 4px' }}>
        {antTreeData.length > 0 ? (
          <Tree
            treeData={antTreeData}
            selectedKeys={selectedPath ? [selectedPath] : []}
            onSelect={(_, info) => handleSelect(_, info)}
            showIcon
            blockNode
            defaultExpandAll={false}
            autoExpandParent
            style={{ background: 'transparent' }}
          />
        ) : (
          <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 13 }}>
            {treeData ? 'No matching files' : 'Enter a directory path above'}
          </div>
        )}
      </div>
      {recentFiles.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-color)', padding: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>
            Recent Files
          </div>
          {recentFiles.slice(0, 5).map(f => {
            const name = f.split('/').pop() || f;
            return (
              <div
                key={f}
                onClick={() => {
                  const node = nodeMap.get(f);
                  if (node) onSelect(node);
                }}
                style={{
                  fontSize: 12,
                  padding: '2px 4px',
                  cursor: 'pointer',
                  color: 'var(--accent)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={f}
              >
                {name}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /vePFS/shock/TianYan/frontend && npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/FileTree.tsx
git commit -m "feat: implement FileTree with search filter, icons, and recent files"
```

---

## Task 7: Frontend — Breadcrumb & Single File Viewers

**Files:**
- Create: `frontend/src/components/Breadcrumb.tsx`
- Create: `frontend/src/components/viewers/ImageViewer.tsx`
- Create: `frontend/src/components/viewers/DepthViewer.tsx`
- Create: `frontend/src/components/viewers/MaskViewer.tsx`
- Create: `frontend/src/components/viewers/JsonViewer.tsx`
- Create: `frontend/src/components/viewers/TextViewer.tsx`

- [ ] **Step 1: Create Breadcrumb component**

```tsx
// frontend/src/components/Breadcrumb.tsx
import { Breadcrumb as AntBreadcrumb } from 'antd';
import { HomeOutlined } from '@ant-design/icons';

interface BreadcrumbProps {
  path?: string;
  rootDir: string;
  onNavigate: (path: string) => void;
}

export function Breadcrumb({ path, rootDir, onNavigate }: BreadcrumbProps) {
  if (!path || !rootDir) return null;

  const relative = path.startsWith(rootDir) ? path.slice(rootDir.length) : path;
  const segments = relative.split('/').filter(Boolean);

  const items = [
    {
      title: (
        <span onClick={() => onNavigate(rootDir)} style={{ cursor: 'pointer' }}>
          <HomeOutlined /> {rootDir.split('/').pop() || rootDir}
        </span>
      ),
    },
    ...segments.map((seg, i) => {
      const fullPath = rootDir + '/' + segments.slice(0, i + 1).join('/');
      return {
        title: (
          <span onClick={() => onNavigate(fullPath)} style={{ cursor: 'pointer' }}>
            {seg}
          </span>
        ),
      };
    }),
  ];

  return (
    <div style={{ padding: '6px 16px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
      <AntBreadcrumb items={items} style={{ fontSize: 13 }} />
    </div>
  );
}
```

- [ ] **Step 2: Create ImageViewer with zoom and pan**

```tsx
// frontend/src/components/viewers/ImageViewer.tsx
import { useState, useRef, useCallback } from 'react';

interface ImageViewerProps {
  src: string;
  name: string;
}

export function ImageViewer({ src, name }: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(s => Math.max(0.1, Math.min(20, s * delta)));
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    setOffset(o => ({
      x: o.x + e.clientX - lastPos.current.x,
      y: o.y + e.clientY - lastPos.current.y,
    }));
    lastPos.current = { x: e.clientX, y: e.clientY };
  };
  const handleMouseUp = () => { dragging.current = false; };

  const resetView = () => { setScale(1); setOffset({ x: 0, y: 0 }); };

  return (
    <div
      style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: dragging.current ? 'grabbing' : 'grab' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', gap: 4 }}>
        <button onClick={resetView} style={{ padding: '2px 8px', fontSize: 12, cursor: 'pointer', background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4 }}>
          Reset
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '2px 6px', background: 'var(--bg-panel)', borderRadius: 4 }}>
          {Math.round(scale * 100)}%
        </span>
      </div>
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <img
          src={src}
          alt={name}
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            userSelect: 'none',
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create DepthViewer (Uint16 colormap)**

```tsx
// frontend/src/components/viewers/DepthViewer.tsx
import { useRef, useEffect, useState } from 'react';

interface DepthViewerProps {
  src: string;
  name: string;
}

// Viridis-like colormap (simplified 8-stop)
const COLORMAP: [number, number, number][] = [
  [68, 1, 84], [72, 35, 116], [64, 67, 135], [52, 94, 141],
  [33, 145, 140], [53, 183, 121], [143, 215, 68], [253, 231, 37],
];

function viridis(t: number): [number, number, number] {
  const idx = t * (COLORMAP.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, COLORMAP.length - 1);
  const f = idx - lo;
  return [
    Math.round(COLORMAP[lo][0] * (1 - f) + COLORMAP[hi][0] * f),
    Math.round(COLORMAP[lo][1] * (1 - f) + COLORMAP[hi][1] * f),
    Math.round(COLORMAP[lo][2] * (1 - f) + COLORMAP[hi][2] * f),
  ];
}

export function DepthViewer({ src, name }: DepthViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Load as image first (PNG with 16-bit depth)
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const data = imageData.data;

      // Find min/max from grayscale values for normalization
      let min = 255, max = 0;
      for (let i = 0; i < data.length; i += 4) {
        const v = data[i]; // R channel (grayscale)
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const range = max - min || 1;

      // Apply colormap
      for (let i = 0; i < data.length; i += 4) {
        const t = (data[i] - min) / range;
        const [r, g, b] = viridis(t);
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
    };
    img.onerror = () => setError('Failed to load depth image');
    img.src = src;
  }, [src]);

  if (error) return <div style={{ padding: 24, color: '#f44' }}>{error}</div>;

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
    </div>
  );
}
```

- [ ] **Step 4: Create MaskViewer**

```tsx
// frontend/src/components/viewers/MaskViewer.tsx
import { useRef, useEffect, useState } from 'react';

interface MaskViewerProps {
  src: string;
  name: string;
}

export function MaskViewer({ src, name }: MaskViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const data = imageData.data;

      // Binary mask: non-zero pixels → colored, zero → dark
      for (let i = 0; i < data.length; i += 4) {
        const v = data[i] | data[i + 1] | data[i + 2];
        if (v > 0) {
          data[i] = 79;     // R (accent blue-ish)
          data[i + 1] = 195; // G
          data[i + 2] = 247; // B
          data[i + 3] = 200;
        } else {
          data[i] = 26;
          data[i + 1] = 26;
          data[i + 2] = 46;
          data[i + 3] = 255;
        }
      }
      ctx.putImageData(imageData, 0, 0);
    };
    img.onerror = () => setError('Failed to load mask image');
    img.src = src;
  }, [src]);

  if (error) return <div style={{ padding: 24, color: '#f44' }}>{error}</div>;

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
    </div>
  );
}
```

- [ ] **Step 5: Create JsonViewer**

```tsx
// frontend/src/components/viewers/JsonViewer.tsx
import { useState, useEffect } from 'react';
import { JsonView, darkStyles, defaultStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';

interface JsonViewerProps {
  src: string;
  name: string;
  theme?: 'dark' | 'light';
}

export function JsonViewer({ src, name, theme = 'dark' }: JsonViewerProps) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(src)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch(e => setError(e.message));
  }, [src]);

  if (error) return <div style={{ padding: 24, color: '#f44' }}>Error: {error}</div>;
  if (data === null) return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading...</div>;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <JsonView data={data} style={theme === 'dark' ? darkStyles : defaultStyles} />
    </div>
  );
}
```

- [ ] **Step 6: Create TextViewer**

```tsx
// frontend/src/components/viewers/TextViewer.tsx
import { useState, useEffect } from 'react';

interface TextViewerProps {
  src: string;
  name: string;
}

export function TextViewer({ src, name }: TextViewerProps) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(src)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(setText)
      .catch(e => setError(e.message));
  }, [src]);

  if (error) return <div style={{ padding: 24, color: '#f44' }}>Error: {error}</div>;
  if (text === null) return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading...</div>;

  const lines = text.split('\n');

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <pre style={{ margin: 0, fontFamily: "'Fira Code', 'Cascadia Code', monospace", fontSize: 13, lineHeight: 1.5 }}>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex' }}>
            <span style={{ color: 'var(--text-secondary)', minWidth: 50, textAlign: 'right', paddingRight: 16, userSelect: 'none', opacity: 0.5 }}>
              {i + 1}
            </span>
            <span>{line}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
```

- [ ] **Step 7: Verify build**

Run: `cd /vePFS/shock/TianYan/frontend && npx vite build`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/
git commit -m "feat: add Breadcrumb and all single-file viewers (image, depth, mask, JSON, text)"
```

---

## Task 8: Frontend — MainPanel, DirectoryGallery, File Info Tooltip

**Files:**
- Modify: `frontend/src/components/MainPanel.tsx`
- Create: `frontend/src/components/DirectoryGallery.tsx`

- [ ] **Step 1: Create DirectoryGallery component**

```tsx
// frontend/src/components/DirectoryGallery.tsx
import { useState, useEffect } from 'react';
import { Spin } from 'antd';
import type { FileNode } from '../types';

interface DirectoryGalleryProps {
  node: FileNode;
  apiBase: string;
  onFileSelect: (node: FileNode) => void;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp']);

export function DirectoryGallery({ node, apiBase, onFileSelect }: DirectoryGalleryProps) {
  const files = (node.children || []).filter(c => c.type === 'file');
  const imageFiles = files.filter(f => f.extension && IMAGE_EXTS.has(f.extension));
  const otherFiles = files.filter(f => !f.extension || !IMAGE_EXTS.has(f.extension));

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
        {node.name} ({files.length} files)
      </div>
      {imageFiles.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Images ({imageFiles.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginBottom: 16 }}>
            {imageFiles.map(f => (
              <div
                key={f.path}
                onClick={() => onFileSelect(f)}
                style={{
                  cursor: 'pointer',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  overflow: 'hidden',
                  background: 'var(--bg-primary)',
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
              >
                <img
                  src={`${apiBase}/api/thumbnail?path=${encodeURIComponent(f.path)}&size=120`}
                  alt={f.name}
                  style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }}
                  loading="lazy"
                />
                <div style={{ padding: '4px 6px', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                  {f.name}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {otherFiles.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Other Files ({otherFiles.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {otherFiles.map(f => (
              <div
                key={f.path}
                onClick={() => onFileSelect(f)}
                style={{
                  padding: '6px 10px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  background: 'var(--bg-secondary)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--hover-bg)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
              >
                {f.name}
                {f.size != null && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                    ({(f.size / 1024).toFixed(1)} KB)
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {files.length === 0 && (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Empty directory</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement full MainPanel with file type detection and viewer routing**

```tsx
// frontend/src/components/MainPanel.tsx
import { Breadcrumb } from './Breadcrumb';
import { DirectoryGallery } from './DirectoryGallery';
import { ImageViewer } from './viewers/ImageViewer';
import { DepthViewer } from './viewers/DepthViewer';
import { MaskViewer } from './viewers/MaskViewer';
import { JsonViewer } from './viewers/JsonViewer';
import { TextViewer } from './viewers/TextViewer';
import { getTupleByKey } from '../tuples/registry';
import type { FileNode, VizMode } from '../types';
import { useState, useEffect } from 'react';
import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import type { FileInfo } from '../types';

interface MainPanelProps {
  selectedNode?: FileNode;
  vizMode: VizMode;
  treeData: FileNode | null;
  apiBase: string;
  rootDir?: string;
  onNavigate?: (path: string) => void;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp']);
const TEXT_EXTS = new Set(['.txt', '.log', '.csv', '.yaml', '.yml', '.xml', '.md']);

function detectFileType(node: FileNode): 'image' | 'depth' | 'mask' | 'json' | 'text' | 'unknown' {
  const ext = node.extension || '';
  const path = node.path.toLowerCase();
  // Check depth/mask by naming convention
  if (path.includes('depth') && IMAGE_EXTS.has(ext)) return 'depth';
  if (path.includes('mask') && IMAGE_EXTS.has(ext)) return 'mask';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === '.json') return 'json';
  if (TEXT_EXTS.has(ext)) return 'text';
  return 'unknown';
}

function FileInfoTooltip({ path, apiBase }: { path: string; apiBase: string }) {
  const [info, setInfo] = useState<FileInfo | null>(null);
  useEffect(() => {
    fetch(`${apiBase}/api/file-info?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(setInfo)
      .catch(() => {});
  }, [path, apiBase]);

  if (!info) return null;
  const sizeStr = info.size > 1024 * 1024
    ? `${(info.size / 1024 / 1024).toFixed(1)} MB`
    : `${(info.size / 1024).toFixed(1)} KB`;

  return (
    <Tooltip title={
      <div style={{ fontSize: 12 }}>
        <div>Size: {sizeStr}</div>
        {info.dimensions && <div>Dimensions: {info.dimensions[0]} x {info.dimensions[1]}</div>}
        <div>Modified: {new Date(info.modified).toLocaleString()}</div>
      </div>
    }>
      <InfoCircleOutlined style={{ color: 'var(--text-secondary)', cursor: 'help', marginLeft: 8 }} />
    </Tooltip>
  );
}

function collectFiles(node: FileNode): FileNode[] {
  if (node.type === 'file') return [node];
  return (node.children || []).flatMap(collectFiles);
}

export function MainPanel({ selectedNode, vizMode, treeData, apiBase, rootDir, onNavigate }: MainPanelProps) {
  // Tuple mode
  if (vizMode !== 'single' && treeData) {
    const tupleType = getTupleByKey(vizMode);
    if (tupleType) {
      const allFiles = collectFiles(treeData);
      const matches = tupleType.matcher(allFiles, selectedNode);
      // If there's a match containing the selected file, show it
      const activeMatch = selectedNode
        ? matches.find(m => Object.values(m.files).includes(selectedNode.path))
        : matches[0];
      if (activeMatch) {
        const TupleComponent = tupleType.component;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {rootDir && onNavigate && (
              <Breadcrumb path={selectedNode?.path} rootDir={rootDir} onNavigate={onNavigate} />
            )}
            <TupleComponent match={activeMatch} apiBase={apiBase} />
          </div>
        );
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {rootDir && onNavigate && (
            <Breadcrumb path={selectedNode?.path} rootDir={rootDir} onNavigate={onNavigate} />
          )}
          <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
            No matching {tupleType.name} tuple found for the selected file. Select an image file to find matches.
          </div>
        </div>
      );
    }
  }

  // Single file / directory mode
  if (!selectedNode) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>&#128065;</div>
          <div>Select a file or directory to preview</div>
        </div>
      </div>
    );
  }

  // Directory → gallery
  if (selectedNode.type === 'directory') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {rootDir && onNavigate && (
          <Breadcrumb path={selectedNode.path} rootDir={rootDir} onNavigate={onNavigate} />
        )}
        <DirectoryGallery node={selectedNode} apiBase={apiBase} onFileSelect={(f) => onNavigate?.(f.path)} />
      </div>
    );
  }

  // Single file
  const fileType = detectFileType(selectedNode);
  const fileSrc = `${apiBase}/api/file?path=${encodeURIComponent(selectedNode.path)}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {rootDir && onNavigate && (
        <Breadcrumb path={selectedNode.path} rootDir={rootDir} onNavigate={onNavigate} />
      )}
      <div style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
        <span>{selectedNode.name}</span>
        <FileInfoTooltip path={selectedNode.path} apiBase={apiBase} />
        <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}>{fileType}</span>
      </div>
      {fileType === 'image' && <ImageViewer src={fileSrc} name={selectedNode.name} />}
      {fileType === 'depth' && <DepthViewer src={fileSrc} name={selectedNode.name} />}
      {fileType === 'mask' && <MaskViewer src={fileSrc} name={selectedNode.name} />}
      {fileType === 'json' && <JsonViewer src={fileSrc} name={selectedNode.name} />}
      {fileType === 'text' && <TextViewer src={fileSrc} name={selectedNode.name} />}
      {fileType === 'unknown' && (
        <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
          Preview not available for this file type ({selectedNode.extension || 'unknown'})
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update App.tsx to pass rootDir and onNavigate to MainPanel**

In `App.tsx`, update the `<MainPanel>` JSX to include the new props:

```tsx
<MainPanel
  selectedNode={selectedNode}
  vizMode={vizMode}
  treeData={treeData}
  apiBase={API_BASE}
  rootDir={rootDir}
  onNavigate={(path: string) => {
    const node = findNodeByPath(treeData, path);
    if (node) handleSelect(node);
  }}
/>
```

Add this helper function in `App.tsx` before the `return`:

```typescript
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
```

- [ ] **Step 4: Verify build**

Run: `cd /vePFS/shock/TianYan/frontend && npx vite build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "feat: implement MainPanel with file type routing, DirectoryGallery, and file info tooltips"
```

---

## Task 9: Tuple Matchers

**Files:**
- Create: `frontend/src/tuples/matchers.ts`

- [ ] **Step 1: Implement shared matcher utilities**

```typescript
// frontend/src/tuples/matchers.ts
import type { FileNode, TupleMatch, TupleMatcher } from '../types';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.bmp', '.webp'];

/**
 * Name-suffix matcher: pairs files by base name + role suffix.
 * E.g., "scene_001.png" (rgb) + "scene_001_depth.png" (depth)
 *
 * rolePatterns maps role name to { suffixes, extensions }.
 * The "rgb" role is the base — other roles add a suffix.
 */
export function nameSuffixMatcher(
  roles: string[],
  rolePatterns: Record<string, { suffixes: string[]; extensions: string[] }>
): TupleMatcher {
  return (files: FileNode[], selectedFile?: FileNode): TupleMatch[] => {
    const filesByDir = new Map<string, FileNode[]>();
    for (const f of files) {
      if (f.type !== 'file') continue;
      const dir = f.path.substring(0, f.path.lastIndexOf('/'));
      const list = filesByDir.get(dir) || [];
      list.push(f);
      filesByDir.set(dir, list);
    }

    const matches: TupleMatch[] = [];

    for (const [dir, dirFiles] of filesByDir) {
      // Find candidate base files (rgb role)
      const rgbPattern = rolePatterns['rgb'] || rolePatterns[roles[0]];
      if (!rgbPattern) continue;

      const rgbFiles = dirFiles.filter(f =>
        f.extension && rgbPattern.extensions.includes(f.extension) &&
        !roles.slice(1).some(role => {
          const p = rolePatterns[role];
          return p && p.suffixes.some(s => f.name.includes(s));
        })
      );

      for (const rgb of rgbFiles) {
        const baseName = rgb.name.substring(0, rgb.name.lastIndexOf('.'));
        const matchFiles: Record<string, string> = { [roles[0]]: rgb.path };
        let allFound = true;

        for (const role of roles.slice(1)) {
          const pattern = rolePatterns[role];
          if (!pattern) { allFound = false; break; }

          let found = false;
          for (const suffix of pattern.suffixes) {
            for (const ext of pattern.extensions) {
              const candidateName = `${baseName}${suffix}${ext}`;
              const candidate = dirFiles.find(f => f.name === candidateName);
              if (candidate) {
                matchFiles[role] = candidate.path;
                found = true;
                break;
              }
            }
            if (found) break;
          }
          if (!found) { allFound = false; break; }
        }

        if (allFound) {
          matches.push({
            label: baseName,
            files: matchFiles,
            confidence: selectedFile && rgb.path === selectedFile.path ? 1.0 : 0.5,
          });
        }
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  };
}

/**
 * Sibling directory matcher: pairs files across parallel directories.
 * E.g., "rgb/001.png" + "depth/001.png" + "mask/001.png"
 */
export function siblingDirMatcher(
  roles: string[],
  roleDirNames: Record<string, string[]>,  // role → possible directory names
  extensions?: Record<string, string[]>     // role → allowed extensions (optional)
): TupleMatcher {
  return (files: FileNode[], selectedFile?: FileNode): TupleMatch[] => {
    // Group files by their parent's parent directory + filename
    const grouped = new Map<string, Map<string, FileNode>>(); // grandparentDir+filename → dirName → node

    for (const f of files) {
      if (f.type !== 'file') continue;
      const parts = f.path.split('/');
      if (parts.length < 3) continue;
      const dirName = parts[parts.length - 2];
      const grandparent = parts.slice(0, -2).join('/');
      const key = `${grandparent}/${f.name}`;

      if (!grouped.has(key)) grouped.set(key, new Map());
      grouped.get(key)!.set(dirName.toLowerCase(), f);
    }

    const matches: TupleMatch[] = [];

    for (const [key, dirMap] of grouped) {
      const matchFiles: Record<string, string> = {};
      let allFound = true;

      for (const role of roles) {
        const dirNames = roleDirNames[role] || [role];
        let found = false;
        for (const dn of dirNames) {
          const node = dirMap.get(dn.toLowerCase());
          if (node) {
            if (extensions && extensions[role]) {
              if (!node.extension || !extensions[role].includes(node.extension)) continue;
            }
            matchFiles[role] = node.path;
            found = true;
            break;
          }
        }
        if (!found) { allFound = false; break; }
      }

      if (allFound) {
        const fileName = key.split('/').pop() || key;
        const baseName = fileName.substring(0, fileName.lastIndexOf('.'));
        matches.push({
          label: baseName,
          files: matchFiles,
          confidence: selectedFile && Object.values(matchFiles).includes(selectedFile.path) ? 1.0 : 0.5,
        });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  };
}

/**
 * Same-name matcher: pairs files with same basename but different extensions.
 * E.g., "scene.png" + "scene.json"
 */
export function sameNameMatcher(
  roles: string[],
  roleExtensions: Record<string, string[]>
): TupleMatcher {
  return (files: FileNode[], selectedFile?: FileNode): TupleMatch[] => {
    const filesByDir = new Map<string, FileNode[]>();
    for (const f of files) {
      if (f.type !== 'file') continue;
      const dir = f.path.substring(0, f.path.lastIndexOf('/'));
      const list = filesByDir.get(dir) || [];
      list.push(f);
      filesByDir.set(dir, list);
    }

    const matches: TupleMatch[] = [];

    for (const [dir, dirFiles] of filesByDir) {
      const byBaseName = new Map<string, FileNode[]>();
      for (const f of dirFiles) {
        const base = f.name.substring(0, f.name.lastIndexOf('.'));
        const list = byBaseName.get(base) || [];
        list.push(f);
        byBaseName.set(base, list);
      }

      for (const [base, group] of byBaseName) {
        const matchFiles: Record<string, string> = {};
        let allFound = true;

        for (const role of roles) {
          const exts = roleExtensions[role];
          const found = group.find(f => f.extension && exts.includes(f.extension));
          if (found) {
            matchFiles[role] = found.path;
          } else {
            allFound = false;
            break;
          }
        }

        if (allFound) {
          matches.push({
            label: base,
            files: matchFiles,
            confidence: selectedFile && Object.values(matchFiles).includes(selectedFile.path) ? 1.0 : 0.5,
          });
        }
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  };
}

/**
 * Combine multiple matchers — returns union of all matches, deduplicated by label.
 */
export function combinedMatcher(...matchers: TupleMatcher[]): TupleMatcher {
  return (files, selectedFile) => {
    const seen = new Set<string>();
    const results: TupleMatch[] = [];
    for (const m of matchers) {
      for (const match of m(files, selectedFile)) {
        const key = Object.values(match.files).sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          results.push(match);
        }
      }
    }
    return results.sort((a, b) => b.confidence - a.confidence);
  };
}
```

- [ ] **Step 2: Verify build**

Run: `cd /vePFS/shock/TianYan/frontend && npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/tuples/matchers.ts
git commit -m "feat: add tuple matcher utilities (name-suffix, sibling-dir, same-name, combined)"
```

---

## Task 10: Tuple Viewers — RGB+Mask, RGB+Depth, RGB+Mask+Depth

**Files:**
- Create: `frontend/src/tuples/RgbMask.tsx`
- Create: `frontend/src/tuples/RgbDepth.tsx`
- Create: `frontend/src/tuples/RgbMaskDepth.tsx`

- [ ] **Step 1: Create RGB + Mask tuple viewer**

```tsx
// frontend/src/tuples/RgbMask.tsx
import { useRef, useEffect, useState } from 'react';
import type { TupleViewerProps } from '../types';

export function RgbMaskViewer({ match, apiBase }: TupleViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [opacity, setOpacity] = useState(0.4);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const rgbImg = new Image();
    const maskImg = new Image();
    rgbImg.crossOrigin = 'anonymous';
    maskImg.crossOrigin = 'anonymous';

    let loaded = 0;
    const onLoad = () => {
      loaded++;
      if (loaded < 2) return;

      canvas.width = rgbImg.width;
      canvas.height = rgbImg.height;

      // Draw RGB
      ctx.drawImage(rgbImg, 0, 0);

      // Draw mask overlay
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = maskImg.width;
      tmpCanvas.height = maskImg.height;
      const tmpCtx = tmpCanvas.getContext('2d')!;
      tmpCtx.drawImage(maskImg, 0, 0);
      const maskData = tmpCtx.getImageData(0, 0, maskImg.width, maskImg.height);

      // Color the mask
      for (let i = 0; i < maskData.data.length; i += 4) {
        const v = maskData.data[i] | maskData.data[i + 1] | maskData.data[i + 2];
        if (v > 0) {
          maskData.data[i] = 79;
          maskData.data[i + 1] = 195;
          maskData.data[i + 2] = 247;
          maskData.data[i + 3] = Math.round(opacity * 255);
        } else {
          maskData.data[i + 3] = 0;
        }
      }
      tmpCtx.putImageData(maskData, 0, 0);

      // Composite
      ctx.drawImage(tmpCanvas, 0, 0, canvas.width, canvas.height);
    };

    rgbImg.onload = onLoad;
    maskImg.onload = onLoad;
    rgbImg.src = `${apiBase}/api/file?path=${encodeURIComponent(match.files.rgb)}`;
    maskImg.src = `${apiBase}/api/file?path=${encodeURIComponent(match.files.mask)}`;
  }, [match, apiBase, opacity]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border-color)', fontSize: 12 }}>
        <span style={{ color: 'var(--text-secondary)' }}>RGB + Mask: {match.label}</span>
        <label style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
          Opacity:
          <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={e => setOpacity(parseFloat(e.target.value))} style={{ width: 80 }} />
          {Math.round(opacity * 100)}%
        </label>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
        <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create RGB + Depth tuple viewer (side-by-side)**

```tsx
// frontend/src/tuples/RgbDepth.tsx
import { ImageViewer } from '../components/viewers/ImageViewer';
import { DepthViewer } from '../components/viewers/DepthViewer';
import type { TupleViewerProps } from '../types';

export function RgbDepthViewer({ match, apiBase }: TupleViewerProps) {
  const rgbSrc = `${apiBase}/api/file?path=${encodeURIComponent(match.files.rgb)}`;
  const depthSrc = `${apiBase}/api/file?path=${encodeURIComponent(match.files.depth)}`;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 16px', borderBottom: '1px solid var(--border-color)', fontSize: 12, color: 'var(--text-secondary)' }}>
        RGB + Depth: {match.label}
      </div>
      <div style={{ flex: 1, display: 'flex', gap: 2, overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-color)' }}>
          <div style={{ padding: '2px 8px', fontSize: 11, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>RGB</div>
          <ImageViewer src={rgbSrc} name="rgb" />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '2px 8px', fontSize: 11, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>Depth</div>
          <DepthViewer src={depthSrc} name="depth" />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create RGB + Mask + Depth tuple viewer (triple view)**

```tsx
// frontend/src/tuples/RgbMaskDepth.tsx
import { useRef, useEffect, useState } from 'react';
import { DepthViewer } from '../components/viewers/DepthViewer';
import type { TupleViewerProps } from '../types';

function MaskOverlayCanvas({ rgbSrc, maskSrc, opacity }: { rgbSrc: string; maskSrc: string; opacity: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const rgbImg = new Image();
    const maskImg = new Image();
    rgbImg.crossOrigin = 'anonymous';
    maskImg.crossOrigin = 'anonymous';
    let loaded = 0;
    const onLoad = () => {
      loaded++;
      if (loaded < 2) return;
      canvas.width = rgbImg.width;
      canvas.height = rgbImg.height;
      ctx.drawImage(rgbImg, 0, 0);
      const tmp = document.createElement('canvas');
      tmp.width = maskImg.width;
      tmp.height = maskImg.height;
      const tmpCtx = tmp.getContext('2d')!;
      tmpCtx.drawImage(maskImg, 0, 0);
      const d = tmpCtx.getImageData(0, 0, tmp.width, tmp.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const v = d.data[i] | d.data[i + 1] | d.data[i + 2];
        if (v > 0) { d.data[i] = 79; d.data[i + 1] = 195; d.data[i + 2] = 247; d.data[i + 3] = Math.round(opacity * 255); }
        else { d.data[i + 3] = 0; }
      }
      tmpCtx.putImageData(d, 0, 0);
      ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    };
    rgbImg.onload = onLoad;
    maskImg.onload = onLoad;
    rgbImg.src = rgbSrc;
    maskImg.src = maskSrc;
  }, [rgbSrc, maskSrc, opacity]);

  return <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />;
}

export function RgbMaskDepthViewer({ match, apiBase }: TupleViewerProps) {
  const [opacity, setOpacity] = useState(0.4);
  const rgbSrc = `${apiBase}/api/file?path=${encodeURIComponent(match.files.rgb)}`;
  const maskSrc = `${apiBase}/api/file?path=${encodeURIComponent(match.files.mask)}`;
  const depthSrc = `${apiBase}/api/file?path=${encodeURIComponent(match.files.depth)}`;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border-color)', fontSize: 12 }}>
        <span style={{ color: 'var(--text-secondary)' }}>RGB + Mask + Depth: {match.label}</span>
        <label style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
          Mask Opacity:
          <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={e => setOpacity(parseFloat(e.target.value))} style={{ width: 80 }} />
        </label>
      </div>
      <div style={{ flex: 1, display: 'flex', gap: 2, overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-color)' }}>
          <div style={{ padding: '2px 8px', fontSize: 11, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>RGB + Mask</div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
            <MaskOverlayCanvas rgbSrc={rgbSrc} maskSrc={maskSrc} opacity={opacity} />
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '2px 8px', fontSize: 11, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>Depth</div>
          <DepthViewer src={depthSrc} name="depth" />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `cd /vePFS/shock/TianYan/frontend && npx vite build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tuples/
git commit -m "feat: add RGB+Mask, RGB+Depth, RGB+Mask+Depth tuple viewers"
```

---

## Task 11: Tuple Viewer — RGB+JSON (bbox + mask + affordance)

**Files:**
- Create: `frontend/src/tuples/RgbJson.tsx`

- [ ] **Step 1: Create RGB + JSON tuple viewer**

```tsx
// frontend/src/tuples/RgbJson.tsx
import { useRef, useEffect, useState } from 'react';
import type { TupleViewerProps } from '../types';

interface Annotation {
  bbox?: number[][];      // [[x, y, w, h], ...]
  mask?: number[][][];    // polygon or RLE masks
  affordance?: any[];
  [key: string]: any;
}

const COLORS = [
  '#4fc3f7', '#f06292', '#aed581', '#ffb74d', '#ba68c8',
  '#4dd0e1', '#ff8a65', '#a1887f', '#90a4ae', '#e6ee9c',
];

export function RgbJsonViewer({ match, apiBase }: TupleViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [annotation, setAnnotation] = useState<Annotation | null>(null);
  const [showBbox, setShowBbox] = useState(true);
  const [showMask, setShowMask] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load JSON
  useEffect(() => {
    fetch(`${apiBase}/api/file?path=${encodeURIComponent(match.files.json)}`)
      .then(r => r.json())
      .then(setAnnotation)
      .catch(e => setError(e.message));
  }, [match.files.json, apiBase]);

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !annotation) return;
    const ctx = canvas.getContext('2d')!;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      // Draw bounding boxes
      if (showBbox && annotation.bbox) {
        annotation.bbox.forEach((box, i) => {
          const [x, y, w, h] = box;
          const color = COLORS[i % COLORS.length];
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, w, h);
          // Label
          ctx.fillStyle = color;
          ctx.font = '12px sans-serif';
          ctx.fillText(`#${i}`, x + 2, y - 4);
        });
      }

      // Draw masks (as polygon outlines if array of points)
      if (showMask && annotation.mask) {
        annotation.mask.forEach((maskItem: any, i: number) => {
          const color = COLORS[i % COLORS.length];
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.fillStyle = color.replace(')', ', 0.2)').replace('rgb', 'rgba').replace('#', '');

          // Handle polygon format: [[x1,y1], [x2,y2], ...]
          if (Array.isArray(maskItem) && Array.isArray(maskItem[0])) {
            ctx.beginPath();
            const points = maskItem as number[][];
            if (points.length > 0) {
              ctx.moveTo(points[0][0], points[0][1]);
              for (let j = 1; j < points.length; j++) {
                ctx.lineTo(points[j][0], points[j][1]);
              }
              ctx.closePath();
              ctx.globalAlpha = 0.3;
              // Use the hex color for fill
              ctx.fillStyle = color;
              ctx.fill();
              ctx.globalAlpha = 1;
              ctx.stroke();
            }
          }
        });
      }

      // Draw affordance labels
      if (annotation.affordance) {
        annotation.affordance.forEach((aff: any, i: number) => {
          if (aff && typeof aff === 'object') {
            const { x, y, label } = aff;
            if (x != null && y != null && label) {
              const color = COLORS[i % COLORS.length];
              ctx.fillStyle = 'rgba(0,0,0,0.6)';
              ctx.fillRect(x - 2, y - 14, ctx.measureText(label).width + 8, 18);
              ctx.fillStyle = color;
              ctx.font = 'bold 12px sans-serif';
              ctx.fillText(label, x + 2, y);
            }
          }
        });
      }
    };
    img.onerror = () => setError('Failed to load image');
    img.src = `${apiBase}/api/file?path=${encodeURIComponent(match.files.rgb)}`;
  }, [match, apiBase, annotation, showBbox, showMask]);

  if (error) return <div style={{ padding: 24, color: '#f44' }}>Error: {error}</div>;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 16, borderBottom: '1px solid var(--border-color)', fontSize: 12 }}>
        <span style={{ color: 'var(--text-secondary)' }}>RGB + JSON: {match.label}</span>
        <label style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showBbox} onChange={e => setShowBbox(e.target.checked)} />
          BBox
        </label>
        <label style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showMask} onChange={e => setShowMask(e.target.checked)} />
          Mask
        </label>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
        <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /vePFS/shock/TianYan/frontend && npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/tuples/RgbJson.tsx
git commit -m "feat: add RGB+JSON tuple viewer with bbox, mask, and affordance overlays"
```

---

## Task 12: Register All Tuple Types & Final Integration

**Files:**
- Modify: `frontend/src/tuples/registry.ts`
- Create: `frontend/src/tuples/index.ts`
- Modify: `frontend/src/main.tsx` (import tuple registrations)

- [ ] **Step 1: Create tuple index that registers all types**

```typescript
// frontend/src/tuples/index.ts
import { registerTuple } from './registry';
import { nameSuffixMatcher, siblingDirMatcher, sameNameMatcher, combinedMatcher } from './matchers';
import { RgbMaskViewer } from './RgbMask';
import { RgbDepthViewer } from './RgbDepth';
import { RgbMaskDepthViewer } from './RgbMaskDepth';
import { RgbJsonViewer } from './RgbJson';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.bmp', '.webp'];

// RGB + Mask
registerTuple({
  name: 'RGB + Mask',
  key: 'rgb_mask',
  roles: ['rgb', 'mask'],
  matcher: combinedMatcher(
    nameSuffixMatcher(['rgb', 'mask'], {
      rgb: { suffixes: [''], extensions: IMAGE_EXTS },
      mask: { suffixes: ['_mask'], extensions: IMAGE_EXTS },
    }),
    siblingDirMatcher(['rgb', 'mask'], {
      rgb: ['rgb', 'color', 'image', 'images'],
      mask: ['mask', 'masks', 'seg', 'segmentation'],
    })
  ),
  component: RgbMaskViewer,
});

// RGB + Depth
registerTuple({
  name: 'RGB + Depth',
  key: 'rgb_depth',
  roles: ['rgb', 'depth'],
  matcher: combinedMatcher(
    nameSuffixMatcher(['rgb', 'depth'], {
      rgb: { suffixes: [''], extensions: IMAGE_EXTS },
      depth: { suffixes: ['_depth'], extensions: IMAGE_EXTS },
    }),
    siblingDirMatcher(['rgb', 'depth'], {
      rgb: ['rgb', 'color', 'image', 'images'],
      depth: ['depth', 'depths', 'depth_map'],
    })
  ),
  component: RgbDepthViewer,
});

// RGB + Mask + Depth
registerTuple({
  name: 'RGB + Mask + Depth',
  key: 'rgb_mask_depth',
  roles: ['rgb', 'mask', 'depth'],
  matcher: combinedMatcher(
    nameSuffixMatcher(['rgb', 'mask', 'depth'], {
      rgb: { suffixes: [''], extensions: IMAGE_EXTS },
      mask: { suffixes: ['_mask'], extensions: IMAGE_EXTS },
      depth: { suffixes: ['_depth'], extensions: IMAGE_EXTS },
    }),
    siblingDirMatcher(['rgb', 'mask', 'depth'], {
      rgb: ['rgb', 'color', 'image', 'images'],
      mask: ['mask', 'masks', 'seg', 'segmentation'],
      depth: ['depth', 'depths', 'depth_map'],
    })
  ),
  component: RgbMaskDepthViewer,
});

// RGB + JSON
registerTuple({
  name: 'RGB + JSON',
  key: 'rgb_json',
  roles: ['rgb', 'json'],
  matcher: combinedMatcher(
    sameNameMatcher(['rgb', 'json'], {
      rgb: IMAGE_EXTS,
      json: ['.json'],
    }),
    nameSuffixMatcher(['rgb', 'json'], {
      rgb: { suffixes: [''], extensions: IMAGE_EXTS },
      json: { suffixes: ['', '_anno', '_annotation'], extensions: ['.json'] },
    })
  ),
  component: RgbJsonViewer,
});
```

- [ ] **Step 2: Import tuple registrations in main.tsx**

Add this import at the top of `frontend/src/main.tsx`, before `import App`:

```typescript
import './tuples/index';
```

- [ ] **Step 3: Fix nameSuffixMatcher rolePatterns type**

The `nameSuffixMatcher` in `matchers.ts` expects `{ suffixes: string[]; extensions: string[] }` but the call sites in `index.ts` pass the same shape. Verify they match. The `nameSuffixMatcher` function signature uses:

```typescript
rolePatterns: Record<string, { suffixes: string[]; extensions: string[] }>
```

This should be consistent. No changes needed if the types match.

- [ ] **Step 4: Verify full build**

Run: `cd /vePFS/shock/TianYan/frontend && npx vite build`
Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tuples/ frontend/src/main.tsx
git commit -m "feat: register all tuple types (RGB+Mask, RGB+Depth, RGB+Mask+Depth, RGB+JSON)"
```

---

## Task 13: End-to-End Integration & Testing

**Files:**
- Create: `start.sh` (convenience script to run both servers)

- [ ] **Step 1: Create startup script**

```bash
#!/bin/bash
# start.sh — Run both backend and frontend dev servers
set -e

echo "Starting TianYan..."

# Start backend
cd /vePFS/shock/TianYan/backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
echo "Backend started (PID: $BACKEND_PID) on http://0.0.0.0:8000"

# Start frontend
cd /vePFS/shock/TianYan/frontend
npx vite --host 0.0.0.0 &
FRONTEND_PID=$!
echo "Frontend started (PID: $FRONTEND_PID) on http://0.0.0.0:5173"

echo ""
echo "TianYan is running!"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
```

- [ ] **Step 2: Make script executable**

Run: `chmod +x /vePFS/shock/TianYan/start.sh`

- [ ] **Step 3: Test backend API manually**

Run:
```bash
cd /vePFS/shock/TianYan/backend
uvicorn main:app --host 0.0.0.0 --port 8000 &
sleep 2
# Test health
curl -s http://localhost:8000/api/health
# Test directory listing
curl -s 'http://localhost:8000/api/directory?path=/vePFS/shock/TianYan&depth=2' | python3 -m json.tool | head -30
# Test file serving
curl -s -o /dev/null -w "%{http_code}" 'http://localhost:8000/api/file?path=/vePFS/shock/TianYan/CLAUDE.md'
# Test file info
curl -s 'http://localhost:8000/api/file-info?path=/vePFS/shock/TianYan/CLAUDE.md' | python3 -m json.tool
# Cleanup
kill %1
```

Expected: health returns `{"status":"ok"}`, directory returns JSON tree, file returns 200, file-info returns metadata JSON.

- [ ] **Step 4: Test frontend build**

Run: `cd /vePFS/shock/TianYan/frontend && npx vite build`
Expected: Build succeeds with output in `dist/`.

- [ ] **Step 5: Commit**

```bash
git add start.sh
git commit -m "feat: add startup script and complete end-to-end integration"
```

---

## Task Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Backend setup + directory API | `backend/main.py`, `backend/api/directory.py` |
| 2 | File serving + file info APIs | `backend/api/file.py`, `backend/api/file_info.py` |
| 3 | Frontend scaffold | `frontend/` (Vite + React + TS + Ant Design) |
| 4 | App layout + theme + hooks | `App.tsx`, `App.css`, hooks, stubs |
| 5 | TopPanel component | `TopPanel.tsx`, `registry.ts` |
| 6 | FileTree component | `FileTree.tsx` |
| 7 | Breadcrumb + single file viewers | `Breadcrumb.tsx`, 5 viewer components |
| 8 | MainPanel + DirectoryGallery | `MainPanel.tsx`, `DirectoryGallery.tsx` |
| 9 | Tuple matchers | `matchers.ts` |
| 10 | Tuple viewers (Mask, Depth, MaskDepth) | 3 tuple viewer components |
| 11 | RGB+JSON tuple viewer | `RgbJson.tsx` |
| 12 | Register tuples + final wiring | `tuples/index.ts`, update `main.tsx` |
| 13 | Integration test + startup script | `start.sh` |
