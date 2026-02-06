import { isNotFound } from "./error.ts";
import type { CacheEntryMeta } from "./types.ts";

const META_SUFFIX = ".meta";

export class OPFSFileSystem {
  private rootPromise: Promise<FileSystemDirectoryHandle> | null = null;

  constructor(private readonly rootName: string) {}

  private getRoot(): Promise<FileSystemDirectoryHandle> {
    this.rootPromise ??= navigator.storage
      .getDirectory()
      .then((opfs) => opfs.getDirectoryHandle(this.rootName, { create: true }));
    return this.rootPromise;
  }

  /**
   * Walk a chain of nested directories.
   * When `create` is false, a missing directory means a cache miss.
   */
  private async navigate(
    segments: string[],
    create: boolean
  ): Promise<FileSystemDirectoryHandle | undefined> {
    let dir = await this.getRoot();
    for (const seg of segments) {
      try {
        dir = await dir.getDirectoryHandle(seg, { create });
      } catch (err) {
        if (!create && isNotFound(err)) return undefined;
        throw err;
      }
    }
    return dir;
  }

  /** Check whether a data file exists without reading its contents. */
  async exists(dirSegments: string[], fileName: string): Promise<boolean> {
    const dir = await this.navigate(dirSegments, false);
    if (dir === undefined) return false;
    try {
      await dir.getFileHandle(fileName);
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  /**
   * Read both the data file and its `.meta` sidecar. Returns `undefined` on cache miss.
   */
  async readEntry(
    dirSegments: string[],
    fileName: string
  ): Promise<{ file: File; meta: CacheEntryMeta | undefined } | undefined> {
    const dir = await this.navigate(dirSegments, false);
    if (dir === undefined) return undefined;

    try {
      const handle = await dir.getFileHandle(fileName);
      const file = await handle.getFile();

      let meta: CacheEntryMeta | undefined;
      try {
        const metaHandle = await dir.getFileHandle(`${fileName}${META_SUFFIX}`);
        const metaFile = await metaHandle.getFile();
        meta = JSON.parse(await metaFile.text()) as CacheEntryMeta;
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }

      return { file, meta };
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  /**
   * Write a cache entry.
   */
  async write(
    dirSegments: string[],
    fileName: string,
    body: ReadableStream<Uint8Array> | null,
    meta: CacheEntryMeta
  ): Promise<void> {
    const dir = await this.navigate(dirSegments, true);
    if (dir === undefined) {
      throw new Error("Failed to create directory structure");
    }

    // Write meta sidecar first so a crash before data write is a clean miss
    const metaHandle = await dir.getFileHandle(`${fileName}${META_SUFFIX}`, {
      create: true,
    });
    const metaWritable = await metaHandle.createWritable();
    await metaWritable.write(JSON.stringify(meta));
    await metaWritable.close();

    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    if (body === null) {
      await writable.close();
    } else {
      await body.pipeTo(writable);
    }
  }

  /** Delete a cache entry and clean up empty parent directories. */
  async delete(dirSegments: string[], fileName: string): Promise<boolean> {
    const dir = await this.navigate(dirSegments, false);
    if (dir === undefined) return false;

    let existed = false;
    try {
      await dir.removeEntry(fileName);
      existed = true;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    try {
      await dir.removeEntry(`${fileName}${META_SUFFIX}`);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }

    if (existed) {
      await this.cleanEmptyDirs(dirSegments);
    }

    return existed;
  }

  /**
   * Recursively list all cached entry paths excluding `.meta` sidecars.
   */
  async list(): Promise<string[][]> {
    const root = await this.getRoot();
    const results: string[][] = [];
    await this.walk(root, [], results);
    return results;
  }

  private async walk(
    dir: FileSystemDirectoryHandle,
    prefix: string[],
    results: string[][]
  ): Promise<void> {
    const subdirs: Promise<void>[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory") {
        subdirs.push(this.walk(handle, [...prefix, name], results));
      } else if (!name.endsWith(META_SUFFIX)) {
        results.push([...prefix, name]);
      }
    }
    if (subdirs.length > 0) {
      await Promise.all(subdirs);
    }
  }

  /**
   * Best-effort removal of empty ancestor directories after a delete.
   * Traverses once then walks back up, stopping at the first non-empty dir.
   */
  private async cleanEmptyDirs(segments: string[]): Promise<void> {
    if (segments.length === 0) return;

    // Collect parent handles in a single descent
    const parents: FileSystemDirectoryHandle[] = [];
    let dir = await this.getRoot();
    parents.push(dir);
    for (let i = 0; i < segments.length - 1; i++) {
      try {
        dir = await dir.getDirectoryHandle(segments[i]!);
        parents.push(dir);
      } catch {
        return;
      }
    }

    // Try removing empty directories from deepest to shallowest.
    // removeEntry on a non-empty directory throws, which stops the climb.
    for (let i = parents.length - 1; i >= 0; i--) {
      try {
        await parents[i]!.removeEntry(segments[i]!);
      } catch {
        break;
      }
    }
  }
}
