# Findings & Decisions

## Requirements

### Core Layout
- Three-panel layout: thin top bar, left sidebar (file tree), main content area
- Top panel: root directory input (with history dropdown) + visualization type selector
- Left panel: recursive directory/file tree with tree-like UI
- Main panel: visualize single files, directory galleries, OR file tuples

### File Types
- Single file types: RGB image, Depth (Uint16), Mask (0/1), JSON, text, others
- File tuple types (scalable/extensible):
  - RGB + JSON (bbox + mask + affordance overlay)
  - RGB + Mask (overlay)
  - RGB + Depth (side-by-side)
  - RGB + Mask + Depth (triple view)
- Plugin system: easy to add new tuple visualization types

### File Tuple Association
- When user selects a visualization type (e.g., "RGB + Depth"), a **matcher function** scans the current directory/selection to auto-pair files into tuples
- Each tuple type defines its own matcher: what file roles it needs (rgb, depth, mask, json) and how to find them (by extension, naming convention, or sibling files)
- Example: for "RGB + Depth", matcher looks for pairs like `scene.png` + `scene_depth.png`, or `rgb/001.png` + `depth/001.png`
- Matcher is configurable per tuple type in the registry

### UX Enhancements
1. **Root directory history** — localStorage dropdown of previously entered paths
2. **Directory click → file gallery** — clicking a folder shows thumbnail grid of all files inside
3. **Keyboard navigation** — arrow keys in tree, Enter to preview
4. **Breadcrumb path bar** — clickable path segments above main panel
5. **File tree search/filter** — type to filter by filename pattern (e.g., `*.png`)
6. **Thumbnail previews in tree** — small image thumbnails next to image files
7. **Resizable panels** — drag divider between left/right panels
8. **Dark/light theme toggle** — in top panel, default dark (better for image viewing)
9. **Auto-detect tuple candidates** — badge on files when matching tuple files exist nearby
10. **Zoom & pan on images** — mouse wheel zoom, drag to pan
11. **File info tooltip** — hover for size, dimensions, modified date
12. **Recent files list** — quick access to last 10 viewed files

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| FastAPI for backend | Simple async Python server, good file I/O, easy to extend |
| React + TS + Vite for frontend | Modern, typed, fast HMR for dev |
| Ant Design for UI components | Tree, Layout, Input, Select components built-in |
| Tuple registry pattern | Map of `{typeName: {component, matcher, roles}}` - add new type = add one file + one registry entry |
| Depth rendered as colormap | Uint16 values mapped to viridis/jet colormap via canvas for visualization |
| Mask rendered as colored overlay | Binary mask shown as semi-transparent color layer on black or paired with RGB |
| Tuple matcher per type | Each tuple type defines how to find its files — keeps association logic extensible |
| localStorage for history | Simple, no backend state needed for UX preferences |
| Dark theme default | Better contrast for image/depth/mask viewing |

## Tuple Registry Design

```typescript
interface TupleType {
  name: string;                    // e.g., "RGB + Depth"
  roles: string[];                 // e.g., ["rgb", "depth"]
  matcher: (files: FileNode[], selectedFile: FileNode) => TupleMatch[];
  component: React.FC<TupleViewerProps>;
}

interface TupleMatch {
  label: string;                   // display name for this match
  files: Record<string, string>;   // role -> file path mapping
}
```

When user selects a viz type:
1. Registry looks up the TupleType
2. Matcher scans files in current directory (or tree) to find valid groupings
3. Results displayed as selectable tuples in main panel or sidebar
4. Clicking a tuple renders via the registered component

## URL State Sharing
- URL encodes app state so links can be shared: `http://host:5173/?root=/path/to/dir&viz=rgb_depth&file=/path/to/file.png`
- Query params: `root` (root directory), `viz` (visualization type), `file` (selected file path)
- On load, app reads URL params and restores state
- On state change, app updates URL (using `replaceState` to avoid polluting browser history)
- This enables bookmarking and link sharing

## Resources
- Project directory: /vePFS/shock/TianYan/
- Cache dirs: XDG_CACHE_HOME=/vePFS/shock/xdg_cache
