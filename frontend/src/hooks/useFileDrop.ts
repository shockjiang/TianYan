import { useRef, useState, DragEvent } from 'react';

export interface DroppedFile {
  file: File;
  /** Relative path within the drop. For a plain file: its name.
   *  For a dropped directory: includes the directory prefix, e.g.
   *  "mydir/sub/file.txt". */
  relpath: string;
}

/**
 * Returns every entry under a FileSystemDirectoryReader, looping because
 * readEntries() is only required to return a partial batch per call.
 */
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const acc: FileSystemEntry[] = [];
    const next = () => {
      reader.readEntries(batch => {
        if (batch.length === 0) return resolve(acc);
        acc.push(...batch);
        next();
      }, reject);
    };
    next();
  });
}

async function walk(entry: FileSystemEntry, prefix: string): Promise<DroppedFile[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file: File = await new Promise((resolve, reject) => fileEntry.file(resolve, reject));
    return [{ file, relpath: prefix + entry.name }];
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const children = await readAllEntries(reader);
    const out: DroppedFile[] = [];
    for (const child of children) {
      const more = await walk(child, prefix + entry.name + '/');
      out.push(...more);
    }
    return out;
  }
  return [];
}

async function collect(dt: DataTransfer): Promise<DroppedFile[]> {
  const items = dt.items;
  const out: DroppedFile[] = [];
  if (items && items.length > 0 && typeof (items[0] as any).webkitGetAsEntry === 'function') {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind !== 'file') continue;
      const entry = (it as any).webkitGetAsEntry?.() as FileSystemEntry | null;
      if (entry) entries.push(entry);
    }
    for (const entry of entries) {
      const more = await walk(entry, '');
      out.push(...more);
    }
    return out;
  }
  // Fallback for browsers without the entry API: flat files only.
  for (const file of Array.from(dt.files || [])) {
    out.push({ file, relpath: file.name });
  }
  return out;
}

/**
 * Native HTML5 drop handler that supports both files and directories.
 * Walks the entry tree (webkitGetAsEntry) so dropped folders are
 * delivered as a flat list of {file, relpath}, preserving structure.
 */
export function useFileDrop(onDrop: (entries: DroppedFile[]) => void) {
  const [isOver, setIsOver] = useState(false);
  const counterRef = useRef(0);

  const hasFiles = (e: DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');

  return {
    isOver,
    handlers: {
      onDragEnter: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        counterRef.current++;
        setIsOver(true);
      },
      onDragOver: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        counterRef.current--;
        if (counterRef.current <= 0) {
          counterRef.current = 0;
          setIsOver(false);
        }
      },
      onDrop: async (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        counterRef.current = 0;
        setIsOver(false);
        if (!e.dataTransfer) return;
        const entries = await collect(e.dataTransfer);
        if (entries.length > 0) onDrop(entries);
      },
    },
  };
}
