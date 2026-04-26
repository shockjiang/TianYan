# Comparing Mode — Design

**Date:** 2026-04-26
**Status:** Approved, ready for implementation plan
**Scope:** Frontend-heavy (React/TypeScript) with a small backend addition for share-state encoding

## 1. Purpose

Add a side-by-side **comparing mode** to TianYan that lets the user browse and visualize two independent file selections at once — typically the same scene from two checkpoints, two annotation revisions, or two model outputs. Each side is a fully independent browsing column (its own root dir, file tree, selected file, viz mode, breadcrumb, preview).

## 2. Layout

### 2.1 Single mode (today)

```
┌──────────────────────────────────────────────────┐
│ GlobalHeader (new ~36px strip)                   │
├──────────────────────────────────────────────────┤
│ TopPanel A (root + viz)                          │
├─────┬────────────────────────────────────────────┤
│ Tree│ Breadcrumb A                               │
│ A   │ ──────────────                             │
│     │ Preview A                                  │
└─────┴────────────────────────────────────────────┘
```

Tree A always visible (today's behavior preserved). Drag divider between Tree A and Preview A unchanged.

### 2.2 Compare mode (new)

```
┌─────────────────────────────────────────────────────────────────────┐
│ GlobalHeader: [Exit←KeepL][ExitKeepR→] · Share · Theme · Fullscreen │
│               · Autoplay · GridScale                                │
├──────────────────────────────────┬──────────────────────────────────┤
│ TopPanel A: Root · Viz           │ TopPanel B: Root · Viz           │
├──┬───────────────────────────────┼─────────────────────────────────┬┤
│≡ │ Breadcrumb A                  │ Breadcrumb B                    │≡│
│  │ ─────────────                 │ ─────────────                   │ │
│Tr│ Preview A                     │ Preview B                       │T│
│ee│                               │                                 │r│
│A │                               │                                 │e│
│  │                               │                                 │e│
│  │                               │                                 │B│
└──┴───────────────────────────────┴─────────────────────────────────┴─┘
                                   ↑ resizable column divider
```

**Mirror layout:** Tree A flanks the far left edge; Tree B flanks the far right edge; the two previews sit directly adjacent in the middle so the images being compared have no chrome between them.

**Trees default collapsed** in compare mode (icon strip only, ~32px wide, with a single ≡ button on the inner edge). Click ≡ to expand the tree (default ~280px wide); a × button on the inner edge collapses it again. Collapse state is per-side and persisted to localStorage.

**Column divider** between the two preview areas is draggable (200px minimum per column), default 50/50, persisted to localStorage.

## 3. Controls — per-side vs. global

| Control                      | Per-side          | Global (one for whole app) |
| ---------------------------- | ----------------- | -------------------------- |
| Root directory               | ✓ (TopPanel A/B)  |                            |
| Selected file                | ✓                 |                            |
| Viz mode (single / tuple)    | ✓ (TopPanel A/B)  |                            |
| Tree expansion / glob filter | ✓                 |                            |
| Tree collapsed flag          | ✓ (compare only)  |                            |
| Theme (dark/light)           |                   | ✓ (GlobalHeader)           |
| Fullscreen                   |                   | ✓ (GlobalHeader)           |
| Autoplay videos              |                   | ✓ (GlobalHeader)           |
| Grid scale (thumbnails)      |                   | ✓ (GlobalHeader)           |
| Share button                 |                   | ✓ — captures both sides    |
| Directory history dropdown   |                   | ✓ — one shared list, opens from either TopPanel |
| Compare toggle / exit        |                   | ✓ (GlobalHeader)           |

## 4. Mode transitions

### 4.1 Enter compare mode

User clicks **`Compare`** button in `GlobalHeader`.

- `sideB` is initialized as a deep copy of `sideA` (mirror), with `treeCollapsed = true`.
- The right column slides in. URL state updates to include `b=...`.

### 4.2 Exit compare mode

The single `Compare` button is replaced by **two explicit exit buttons** in `GlobalHeader`:

- **`Exit ← Keep Left`** → `setSideB(null)`. Right column unmounts, left column remains.
- **`Exit Keep Right →`** → `setSideA(sideB!); setSideB(null)`. Right column's state migrates to left, then right unmounts.

No modal, no last-focused-side heuristic — explicit, one click, no ambiguity.

### 4.3 Single ↔ compare detection

`compareMode === (sideB !== null)`. There is no separate `compareMode` boolean; `sideB === null` is the single source of truth for which mode the app is in. This avoids invalid states like `compareMode=true && sideB=undefined`.

## 5. State architecture

### 5.1 Per-side state shape

```ts
type SideState = {
  rootDir: string;
  vizMode: VizMode;
  selectedPath?: string;
  selectedNode?: FileNode;
  treeData: FileNode | null;
  expandedKeys: string[];
  treeCollapsed: boolean;        // only meaningful in compare mode
};
```

### 5.2 App-level state

```ts
// helpers parse the URL/share payload; sideB returns null when no `b=` segment exists
const [sideA, setSideA] = useState<SideState>(parseSideFromUrl('a'));
const [sideB, setSideB] = useState<SideState | null>(parseSideFromUrl('b'));
const [columnSplit, setColumnSplit] = useState<number>(/* 0..1 */ 0.5);

// existing global state, unchanged
const [theme, toggleTheme] = useTheme();
const [autoplay, setAutoplay] = useState(...);
const [gridScale, setGridScale] = useState(...);
const [fullscreen, setFullscreen] = useState(false);
const [leftWidth, setLeftWidth] = useState(...); // single-mode tree-vs-main divider
```

### 5.3 Side controller hook

The current per-tree operations (`loadDirectory`, `loadChildren`, `navigateToFile`, `useTreeStream`) are extracted into a `useSideController(state, setState)` hook. Each `BrowsingColumn` instantiates its own controller bound to its own state slice, so the two sides cannot accidentally cross-contaminate. The hook also owns the side's `treeDataRef` and `pendingFileNav` ref.

## 6. Components

### 6.1 New components

- **`GlobalHeader.tsx`** — thin top strip. Renders global controls and the compare toggle/exit buttons. Always present (single and compare modes).
- **`BrowsingColumn.tsx`** — composes `TopPanel` + collapsible `FileTree` + `Breadcrumb` + `MainPanel` for one side. Props: `side: 'A' | 'B'`, `state: SideState`, `onChange: (next: SideState) => void`, `treePosition: 'left' | 'right'`, plus global props (`autoplay`, `gridScale`, `theme`). Internally uses `useSideController`.
- **`ColumnDivider.tsx`** — draggable vertical bar between the two `BrowsingColumn`s in compare mode. Same drag pattern as the existing tree/main divider.

### 6.2 Refactored components

- **`TopPanel.tsx`** — trimmed to per-side controls only: root dir input (with the shared `useDirectoryHistory` dropdown) + viz mode selector. Removes theme, fullscreen, autoplay, gridScale, share — those move to `GlobalHeader`.
- **`FileTree.tsx`** — gains `collapsible: boolean`, `collapsed: boolean`, `onToggleCollapse: () => void`, and `collapsePosition: 'right' | 'left'` props. Collapsed = ~32px icon strip with one ≡ button. Expanded = normal tree with × button on the inner edge. In single mode, `collapsible={false}` so today's UX is preserved.
- **`App.tsx`** — becomes a thin shell: renders `GlobalHeader`, then either one `BrowsingColumn` (single mode) or `[BrowsingColumn A, ColumnDivider, BrowsingColumn B]` (compare mode).

### 6.3 Unchanged components

All viewers (`ImageViewer`, `DepthViewer`, `MaskViewer`, `JsonViewer`, `TextViewer`, `VideoViewer`), all tuple components (`RgbMask`, `RgbDepth`, `RgbMaskDepth`, `RgbJson`), the tuple registry, `MainPanel`, `Breadcrumb`, `DirectoryGallery`, `ErrorBoundary` — none of these touch the new layout. `ErrorBoundary` continues to wrap each `MainPanel` instance, so the two sides have independent error boundaries (a crash in side B's preview does not blank side A). Each `BrowsingColumn` calls `MainPanel` with its own side's `selectedNode`, `vizMode`, `treeData`, `rootDir`. Tuple matchers operate on the side's `treeData`, so cross-side contamination is structurally impossible.

## 7. URL & share state

### 7.1 URL formats

Single mode (unchanged):
```
?a=<aliasA>|<fileA>|<vizA>
```

Compare mode (new):
```
?a=<aliasA>|<fileA>|<vizA>&b=<aliasB>|<fileB>|<vizB>
```

Presence of `b=` is the trigger for the app to load in compare mode.

### 7.2 Share button (`?s=<code>`)

`POST /api/share` payload grows from `{root, file, viz}` to `{a: {root, file, viz}, b?: {root, file, viz}}`. Old records (without `b`) load as single mode — backward compatible.

### 7.3 NOT in URL

Tree expansion state, tree-collapsed flag, column split ratio, and global preferences (theme, fullscreen, autoplay, gridScale) stay in localStorage. The URL only encodes the **comparison axes** (root + file + viz per side), matching today's model.

## 8. Backend changes

Minimal:

- **`backend/api/alias.py`** — `/api/share` lives here; extend the JSON shape stored on disk to optionally include a `b` field. Reads must accept records both with and without `b`.
- **No changes** to `directory.py`, `file.py`, `file_info.py`, `_safe_resolve`, `_allowed_roots` — each side just makes its own independent calls; the security model (allowed roots set, alias auto-registration) handles two roots the same way it handles one.

## 9. Behavior details

### 9.1 Two SSE streams

`useTreeStream` already keys off its `rootDir` argument. Two `BrowsingColumn`s instantiate two independent hook instances → two concurrent SSE connections, one per side. FastAPI's async runtime handles this; no backend changes needed.

### 9.2 Fullscreen in compare mode

Pressing **`F`** in compare mode hides the `GlobalHeader`, both `TopPanel`s, and auto-collapses both trees — leaving just the two preview areas with the column divider between them. Pressing `F` again restores the previous chrome state (including each side's pre-fullscreen tree-collapsed flag).

### 9.3 Cross-side independence

There is no syncing between sides — selecting a file on side A does not select on side B; scrolling Preview A does not scroll Preview B. Sync features (sync scroll, sync selection) are explicitly out of scope and would be a separate spec.

### 9.4 Recents / dir history

`useDirectoryHistory` and `useRecentFiles` remain global (one shared list each), populated by either side. The dropdown in `TopPanel` (per-side) reads from the same shared store. No per-side recent lists.

## 10. Risks & mitigations

| Risk                                                                     | Mitigation                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `App.tsx` refactor blast radius — touching every state field             | Land the per-side refactor first with `sideB` permanently `null`, verify single mode still works, then enable the compare toggle in a second commit. |
| Two concurrent SSE scans on large dirs                                   | Verify on a known-large dataset before landing. If contention is observed, throttle scanner concurrency (out of scope unless it actually breaks).      |
| `selectedNode` staleness when a side's `rootDir` changes                 | `useSideController` resets `selectedNode`, `selectedPath`, `expandedKeys`, `treeData` whenever `rootDir` is set anew — same pattern as today.          |
| Old shared-state codes (`?s=...`) without a `b` field                    | Backend reads tolerate missing `b`. Frontend treats no-`b` as single mode.                  |
| Per-side `treeDataRef` / `pendingFileNav` refs                           | Each `useSideController` instance owns its own refs. No global refs.                        |

## 11. Out of scope

- Sync scroll / sync selection between sides
- Diff overlays (pixel diff, JSON diff)
- N-way comparison (3+ sides)
- Per-side share buttons (only the global Share button)
- Per-side dir history (only the shared list)
- Mobile / narrow-screen responsive collapse of the second column

## 12. Testing approach

Manual verification (no test framework currently in the repo):

1. **Single mode regression** — after the refactor, every existing flow (root load, tree expand, file select, viz switch, alias load, share code, fullscreen, theme, autoplay, grid scale, drag divider) still works exactly as before.
2. **Enter compare mode** — `Compare` button mirrors left → right; trees collapsed; URL gains `b=`.
3. **Independence** — change root on side B, verify side A's tree/preview untouched; switch viz on side A, verify side B unchanged.
4. **Exit Keep Left / Keep Right** — both paths land in single mode with the correct surviving state; URL drops `b=`.
5. **Tree collapse / expand** — per-side, preview area resizes correctly.
6. **Column divider drag** — clamps at 200px per side; persists across reload.
7. **Fullscreen in compare mode** — both columns lose chrome, divider remains, `F` again restores.
8. **Share** — clicking Share in compare mode produces a `?s=...` URL that, when opened in a new tab, restores both sides exactly.
9. **Backward compat** — old `?s=...` codes (single-side only) still load as single mode.
