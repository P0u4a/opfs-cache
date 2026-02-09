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

export interface FileIO {
  readFile(fileHandle: FileSystemFileHandle): Promise<File>;
  writeFile(
    fileHandle: FileSystemFileHandle,
    body: ReadableStream<Uint8Array> | null
  ): Promise<void>;
}

export type CacheEntryPath = string[];
