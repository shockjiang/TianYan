# Task Plan: TianYan - File Preview Website

## Goal
Build a beautiful web application that recursively previews files and file tuples from a given root directory, with a scalable visualization plugin system and polished UX.

## Current Phase
Phase 1

## Architecture Overview

```
TianYan/
  backend/                    # Python FastAPI server
    main.py                   # Entry point, CORS, mount routes
    api/
      directory.py            # GET /api/directory?path= (recursive tree)
      file.py                 # GET /api/file?path= (serve raw file)
      file_info.py            # GET /api/file-info?path= (metadata: size, dims, mtime)
  frontend/                   # React + TypeScript + Vite
    src/
      components/
        TopPanel.tsx          # Root dir input (with history) + viz type selector + theme toggle
        FileTree.tsx          # Left panel - recursive tree with search, thumbnails
        MainPanel.tsx         # Right panel - visualization container
        Breadcrumb.tsx        # Clickable path breadcrumbs
        DirectoryGallery.tsx  # Thumbnail grid when clicking a directory
        viewers/
          ImageViewer.tsx     # RGB images (with zoom/pan)
          DepthViewer.tsx     # Uint16 depth maps (colormap)
          MaskViewer.tsx      # Binary masks
          JsonViewer.tsx      # JSON pretty-print
          TextViewer.tsx      # Plain text
      tuples/
        registry.ts           # Plugin registry: name -> {component, matcher, roles}
        matchers.ts           # Shared matcher utilities (by name, by sibling dir, etc.)
        RgbJson.tsx           # RGB + JSON (bbox + mask + affordance)
        RgbMask.tsx           # RGB + Mask overlay
        RgbDepth.tsx          # RGB + Depth side-by-side
        RgbMaskDepth.tsx      # RGB + Mask + Depth
      hooks/
        useDirectoryHistory.ts  # localStorage history for root dirs
        useRecentFiles.ts       # Recent files list
        useTheme.ts             # Dark/light theme
      App.tsx
      main.tsx
```

## Phases

### Phase 1: Project Setup
- [ ] Initialize FastAPI backend with dependencies
- [ ] Scaffold React + TypeScript + Vite frontend
- [ ] Install Ant Design + dependencies
- [ ] Verify both dev servers run
- **Status:** pending

### Phase 2: Backend API
- [ ] Directory listing endpoint (recursive tree structure with file metadata)
- [ ] File serving endpoint (raw content with correct MIME types)
- [ ] File info endpoint (size, dimensions for images, modified date)
- [ ] Handle all file types: images, Uint16 depth, mask, JSON, text
- **Status:** pending

### Phase 3: Frontend Layout & File Tree
- [ ] Three-panel layout with resizable left/right panels
- [ ] Top panel: root directory input with history dropdown
- [ ] Top panel: visualization type selector
- [ ] Top panel: dark/light theme toggle
- [ ] Left panel: recursive file tree with expand/collapse
- [ ] Left panel: search/filter input
- [ ] Left panel: thumbnail previews for image files
- [ ] Breadcrumb path bar above main panel
- [ ] Wire up directory API to populate tree
- [ ] Keyboard navigation (arrow keys + Enter)
- [ ] URL state sync (useUrlState hook: root, viz, file → query params)
- **Status:** pending

### Phase 4: Single File Viewers & Directory Gallery
- [ ] Image viewer with zoom & pan (RGB - png/jpg)
- [ ] Depth viewer (Uint16 - colormap rendering)
- [ ] Mask viewer (binary 0/1 - colored display)
- [ ] JSON viewer (pretty-print with syntax highlighting)
- [ ] Text viewer (monospace)
- [ ] Auto-detect file type and select viewer
- [ ] File info tooltip on hover
- [ ] Directory click → thumbnail gallery view
- [ ] Recent files list (last 10)
- **Status:** pending

### Phase 5: File Tuple Plugin System
- [ ] Tuple registry: {name, roles, matcher, component}
- [ ] Matcher utilities (by filename convention, by sibling directory, etc.)
- [ ] Auto-association: when viz type selected, matcher scans and pairs files
- [ ] Tuple candidate badges on files in tree
- [ ] Tuple selection UI in main panel
- [ ] RGB + JSON tuple (overlay bboxes, masks, affordance on image)
- [ ] RGB + Mask tuple (overlay mask on image)
- [ ] RGB + Depth tuple (side-by-side with colormap)
- [ ] RGB + Mask + Depth tuple (triple view)
- **Status:** pending

### Phase 6: Testing & Polish
- [ ] Test with real directory structures
- [ ] Error handling (missing files, permission errors, large files)
- [ ] Loading states and empty states
- [ ] Responsive layout adjustments
- [ ] Performance: lazy loading for large trees
- **Status:** pending

## Key Questions
1. What port should backend/frontend run on? → Backend: 8000, Frontend: 5173
2. How to handle large directories? → Lazy loading in tree (expand on click)
3. How to detect file types? → Extension-based + MIME type from backend
4. How do file tuples work? → Auto-association via matcher functions per tuple type
5. How are files paired? → Each tuple type defines a matcher that scans directory for matching files by naming convention or sibling directory structure

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| FastAPI backend | Lightweight, async, great for file serving |
| React + TypeScript + Vite | Fast dev, strong typing, modern tooling |
| Ant Design UI library | Has Tree, Layout, Select, etc. out of the box |
| Plugin registry with matchers | Each tuple type self-describes its roles and how to find files |
| Extension-based file detection | Simple, reliable for known file types |
| localStorage for UX state | History, recent files, theme preference — no backend state needed |
| Dark theme default | Better for image/depth/mask viewing |
| Resizable panels | Users need different tree/viewer ratios depending on task |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
|       | 1       |            |

## Notes
- Store all code at /vePFS/shock/TianYan/
- Use XDG_CACHE_HOME=/vePFS/shock/xdg_cache for pip/npm caches
- File tuple auto-association is the key UX innovation — make matcher system clean and extensible
