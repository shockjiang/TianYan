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
  files: Record<string, string>; // role -> absolute file path
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

export interface SideState {
  rootDir: string;
  vizMode: VizMode;
  selectedPath?: string;
  selectedNode?: FileNode;
  /** Currently-chosen dataset/key inside the active viewer (H5Viewer's
   *  selectedKey, NpyViewer's npzKey). Surfaced here so cross-cutting
   *  actions like "Export as MP4" from the file-tree right-click can
   *  target the user's choice instead of an auto-pick. */
  currentDatasetKey?: string;
  treeData: FileNode | null;
  expandedKeys: string[];
  treeCollapsed: boolean;
}

export const initialSideState = (overrides: Partial<SideState> = {}): SideState => ({
  rootDir: '',
  vizMode: 'single',
  selectedPath: undefined,
  selectedNode: undefined,
  currentDatasetKey: undefined,
  treeData: null,
  expandedKeys: [],
  treeCollapsed: false,
  ...overrides,
});
