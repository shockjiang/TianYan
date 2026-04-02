# TianYan — File Preview Website Design Spec

## Overview

TianYan is a web application for recursively browsing and visualizing files from a given root directory. It supports single file viewing (images, depth maps, masks, JSON, text) and a **scalable tuple visualization plugin system** that auto-associates related files for combined rendering.

## Architecture

**Backend:** Python FastAPI (port 8000)
**Frontend:** React + TypeScript + Vite + Ant Design (port 5173)

```
TianYan/
  backend/
    main.py                     # FastAPI app, CORS, route mounting
    api/
      directory.py              # GET /api/directory?path=
      file.py                   # GET /api/file?path=
      file_info.py              # GET /api/file-info?path=
  frontend/
    src/
      components/
        TopPanel.tsx            # Root dir input + viz selector + theme toggle
        FileTree.tsx            # Recursive tree with search & thumbnails
        MainPanel.tsx           # Viewer container
        Breadcrumb.tsx          # Clickable path segments
        DirectoryGallery.tsx    # Thumbnail grid for directories
        viewers/
          ImageViewer.tsx       # RGB with zoom/pan
          DepthViewer.tsx       # Uint16 → colormap
          MaskViewer.tsx        # Binary mask display
          JsonViewer.tsx        # Pretty-print
          TextViewer.tsx        # Monospace
      tuples/
        registry.ts             # Plugin registry
        matchers.ts             # Shared matcher utilities
        RgbJson.tsx
        RgbMask.tsx
        RgbDepth.tsx
        RgbMaskDepth.tsx
      hooks/
        useDirectoryHistory.ts  # localStorage root dir history
        useRecentFiles.ts       # Last 10 viewed files
        useTheme.ts             # Dark/light theme
        useUrlState.ts          # Sync app state ↔ URL query params
      App.tsx
      main.tsx
```

## Backend API

### `GET /api/directory?path=<root_path>`
Returns recursive tree structure:
```json
{
  "name": "root",
  "path": "/absolute/path",
  "type": "directory",
  "children": [
    { "name": "scene_001.png", "path": "/absolute/path/scene_001.png", "type": "file", "extension": ".png", "size": 1024 },
    { "name": "subdir", "path": "/absolute/path/subdir", "type": "directory", "children": [...] }
  ]
}
```
- Lazy loading: `depth` query param controls recursion depth (default: 1). Frontend requests deeper levels on expand.
- Returns file extension and size for each file entry.

### `GET /api/file?path=<file_path>`
- Serves raw file content with correct `Content-Type` header.
- Supports: images (png/jpg/bmp), raw binary (depth/mask), JSON, text.
- For images: returns raw image bytes. For depth (`.png` Uint16 or `.raw`): returns raw bytes, frontend decodes.

### `GET /api/file-info?path=<file_path>`
Returns metadata:
```json
{
  "path": "/absolute/path/file.png",
  "name": "file.png",
  "size": 102400,
  "modified": "2026-04-01T12:00:00",
  "dimensions": [1920, 1080]  // only for images, null otherwise
}
```

### Security
- All path parameters are validated: resolved to absolute path and checked against an allowed root.
- No path traversal (`../`) allowed outside the specified root directory.

## Frontend Layout

```
┌─────────────────────────────────────────────────────────┐
│  [Root Dir Input ▾ history]  [Viz Type ▾]  [🌙/☀️]     │ ← Top Panel (48px)
├──────────────┬──────────────────────────────────────────┤
│  [🔍 filter] │  Home / subdir / scene_001.png           │ ← Breadcrumb
│              │                                          │
│  ▸ subdir/   │  ┌──────────────────────────────────┐    │
│  ▾ scenes/   │  │                                  │    │
│    img1.png  │  │     [File Viewer / Gallery /     │    │
│    img2.png  │  │      Tuple Visualization]        │    │
│    depth/    │  │                                  │    │
│    mask/     │  │                                  │    │
│              │  └──────────────────────────────────┘    │
│              │                                          │
│  Recent:     │  [file info: 1920x1080, 102KB, ...]     │
│   file1.png  │                                          │
│   file2.json │                                          │
├──────────────┴──────────────────────────────────────────┤
│  ◄─── drag to resize ───►                               │
└─────────────────────────────────────────────────────────┘
```

### Top Panel
- **Root directory input** with autocomplete dropdown showing history (stored in localStorage).
- **Visualization type selector**: "Single File" (default), "RGB + JSON", "RGB + Mask", "RGB + Depth", "RGB + Mask + Depth". Populated from tuple registry.
- **Theme toggle**: dark (default) / light.

### Left Panel — File Tree
- Ant Design `<Tree>` component with lazy-loaded children.
- **Search/filter input** at the top — filters visible tree nodes by glob pattern.
- **Thumbnail previews** next to image files (small 24x24 thumbnails via backend).
- **Keyboard navigation**: Up/Down arrows to move selection, Enter to preview, Left/Right to collapse/expand.
- **Recent files** section at bottom (last 10 files, stored in localStorage).

### Main Panel
- **Breadcrumb** path bar at the top — each segment is clickable to navigate.
- **Content area** renders based on what is selected:
  - **File selected** → appropriate single-file viewer
  - **Directory selected** → `DirectoryGallery` showing thumbnail grid
  - **Tuple viz type active** → tuple viewer with auto-matched results

### Resizable Panels
- Left panel width adjustable via draggable divider. Min 200px, max 500px, default 280px.

## Single File Viewers

| Type | Detection | Rendering |
|------|-----------|-----------|
| RGB Image | `.png`, `.jpg`, `.jpeg`, `.bmp`, `.gif`, `.webp` | `<img>` with mouse-wheel zoom + drag-to-pan |
| Depth | `_depth.png`, `.depth`, `depth/` in path | Decode Uint16, map to viridis colormap, render on `<canvas>` |
| Mask | `_mask.png`, `.mask`, `mask/` in path | Binary values → colored overlay on `<canvas>` |
| JSON | `.json` | Pretty-printed with syntax highlighting (react-json-view or similar) |
| Text | `.txt`, `.log`, `.csv`, `.yaml`, `.yml`, `.xml`, `.md` | Monospace `<pre>` with line numbers |
| Unknown | fallback | Show file info + "Preview not available" message |

## File Tuple Plugin System

### Registry Interface

```typescript
interface TupleType {
  name: string;                    // Display name, e.g., "RGB + Depth"
  key: string;                     // URL-safe key, e.g., "rgb_depth"
  roles: string[];                 // Required file roles, e.g., ["rgb", "depth"]
  matcher: TupleMatcher;           // Function that finds matching file groups
  component: React.FC<TupleViewerProps>;
}

type TupleMatcher = (
  files: FileNode[],               // All files in scope (current dir or tree)
  selectedFile?: FileNode          // Currently selected file, if any
) => TupleMatch[];

interface TupleMatch {
  label: string;                   // Display name, e.g., "scene_001"
  files: Record<string, string>;   // role → absolute file path
  confidence: number;              // 0-1, for ranking matches
}

interface TupleViewerProps {
  match: TupleMatch;               // The resolved tuple
  apiBase: string;                 // Backend URL for fetching files
}
```

### Matcher Strategies (in `matchers.ts`)

1. **Name-suffix matching**: `scene_001.png` pairs with `scene_001_depth.png`, `scene_001_mask.png`
2. **Sibling directory matching**: `rgb/001.png` pairs with `depth/001.png`, `mask/001.png`
3. **Same-name-different-extension**: `scene.png` pairs with `scene.json`

Each tuple type chooses which strategy (or combination) to use.

### Adding a New Tuple Type

1. Create `frontend/src/tuples/NewType.tsx` with the viewer component
2. Add entry to registry in `registry.ts`:
```typescript
registerTuple({
  name: "RGB + NewType",
  key: "rgb_newtype",
  roles: ["rgb", "newtype"],
  matcher: nameSuffixMatcher(["rgb", "newtype"], { rgb: [".png", ".jpg"], newtype: ["_newtype.png"] }),
  component: RgbNewTypeViewer
});
```

### Existing Tuple Types

#### RGB + JSON (bbox + mask + affordance)
- Renders RGB image as base layer
- Overlays bounding boxes from JSON `bbox` field
- Overlays segmentation masks from JSON `mask` field  
- Shows affordance annotations from JSON `affordance` field
- JSON format expected: `{ "bbox": [[x,y,w,h], ...], "mask": [...], "affordance": [...] }`

#### RGB + Mask
- RGB image as base layer
- Semi-transparent colored mask overlay (configurable color/opacity)

#### RGB + Depth
- Side-by-side layout: RGB on left, depth colormap on right
- Synchronized zoom/pan between the two views

#### RGB + Mask + Depth
- Three-panel layout: RGB | Mask overlay | Depth colormap
- Synchronized zoom/pan across all three

## URL State Sharing

App state is encoded in URL query parameters for link sharing:

```
http://host:5173/?root=/data/scenes&viz=rgb_depth&file=/data/scenes/001.png
```

| Param | Description | Example |
|-------|-------------|---------|
| `root` | Root directory path | `/data/scenes` |
| `viz` | Visualization type key (from registry) | `rgb_depth`, `single` |
| `file` | Currently selected file path | `/data/scenes/001.png` |

**Behavior:**
- On page load: read URL params → set initial app state
- On state change: update URL via `history.replaceState()` (no history pollution)
- Missing params use defaults (no root, single-file viz, no selection)
- `useUrlState` hook manages bidirectional sync

## UX Features Summary

| Feature | Implementation | Storage |
|---------|---------------|---------|
| Root dir history | Dropdown in TopPanel | localStorage |
| Directory gallery | DirectoryGallery component | — |
| Keyboard navigation | Event listeners on FileTree | — |
| Breadcrumb navigation | Breadcrumb component | — |
| File tree filter | Search input filtering tree nodes | — |
| Tree thumbnails | 24x24 image previews via backend | — |
| Resizable panels | Draggable divider | localStorage (width) |
| Dark/light theme | CSS variables + Ant Design theme | localStorage |
| Tuple candidate badges | Check matcher against siblings | — |
| Zoom & pan | Canvas/transform-based | — |
| File info tooltip | file-info API on hover | — |
| Recent files | List in left panel footer | localStorage |
| URL state sharing | Query params + replaceState | URL |

## Error Handling

- **Invalid root path**: Show error message in main panel, keep previous tree
- **File not found**: Show "File not found" in viewer area
- **Permission denied**: Show permission error with path
- **Large directories**: Lazy-load tree children (depth=1 per expand)
- **Unsupported file**: Show file info + "Preview not available"
- **Network errors**: Toast notification with retry option
