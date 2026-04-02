import type { FileNode, TupleMatch, TupleMatcher } from '../types';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.bmp', '.webp'];

/**
 * Name-suffix matcher: pairs files by base name + role suffix.
 * E.g., "scene_001.png" (rgb) + "scene_001_depth.png" (depth)
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
  roleDirNames: Record<string, string[]>,
  extensions?: Record<string, string[]>
): TupleMatcher {
  return (files: FileNode[], selectedFile?: FileNode): TupleMatch[] => {
    const grouped = new Map<string, Map<string, FileNode>>();

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
 * Combine multiple matchers — returns union of all matches, deduplicated.
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
