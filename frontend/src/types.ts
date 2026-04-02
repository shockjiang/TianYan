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
