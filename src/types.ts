export interface CacheEntryMeta {
  headers: Record<string, string>;
  status: number;
  statusText: string;
}

export interface ResolvedPath {
  dir: string[];
  file: string;
}

export interface NavigationResult {
  dir: FileSystemDirectoryHandle;
  parents: FileSystemDirectoryHandle[];
}

export type CacheEntryPath = string[];
