import { isNotFound } from "./error";
import type { CacheEntryMeta, NavigationResult, CacheEntryPath } from "./types";

const META_SUFFIX = ".meta";

export class OPFSFileSystem {
  private rootPromise: Promise<FileSystemDirectoryHandle> | null = null;
  private readonly rootName: string;

  constructor(rootName: string) {
    this.rootName = rootName;
  }

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
      const [file, meta] = await Promise.all([
        dir.getFileHandle(fileName).then((h) => h.getFile()),
        dir
          .getFileHandle(`${fileName}${META_SUFFIX}`)
          .then((h) => h.getFile())
          .then((f) => f.text())
          .then((text) => JSON.parse(text) as CacheEntryMeta)
          .catch((err: unknown) => {
            if (isNotFound(err)) return undefined;
            throw err;
          }),
      ]);

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
    const dir = (await this.navigate(dirSegments, true))!;

    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    if (body === null) {
      await writable.close();
    } else {
      await body.pipeTo(writable);
    }

    const metaHandle = await dir.getFileHandle(`${fileName}${META_SUFFIX}`, {
      create: true,
    });
    const metaWritable = await metaHandle.createWritable();
    await metaWritable.write(JSON.stringify(meta));
    await metaWritable.close();
  }

  /** Delete a cache entry and clean up empty parent directories. */
  async delete(dirSegments: string[], fileName: string): Promise<boolean> {
    const result = await this.navigateWithParents(dirSegments);
    if (result === undefined) return false;

    const { dir, parents } = result;

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
      await this.cleanEmptyDirs(dirSegments, parents);
    }

    return existed;
  }

  /**
   * Recursively list all cached entry paths excluding `.meta` sidecars.
   */
  async list(): Promise<CacheEntryPath[]> {
    const root = await this.getRoot();
    return this.walk(root, []);
  }

  private async walk(
    dir: FileSystemDirectoryHandle,
    prefix: string[]
  ): Promise<CacheEntryPath[]> {
    const results: CacheEntryPath[] = [];
    const subdirs: Array<Promise<CacheEntryPath[]>> = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory") {
        subdirs.push(this.walk(handle, [...prefix, name]));
      } else if (!name.endsWith(META_SUFFIX)) {
        results.push([...prefix, name]);
      }
    }
    if (subdirs.length > 0) {
      const nested = await Promise.all(subdirs);
      for (const entries of nested) {
        results.push(...entries);
      }
    }
    return results;
  }

  /**
   * Best-effort removal of empty ancestor directories after a delete.
   * Walks the parent handles back up, stopping at the first
   * non-empty directory.
   */
  private async cleanEmptyDirs(
    segments: string[],
    parents: FileSystemDirectoryHandle[]
  ): Promise<void> {
    if (segments.length === 0) return;

    // Try removing empty directories from deepest to shallowest
    // removeEntry on a non-empty directory throws, which stops the climb
    for (let i = segments.length - 1; i >= 0; i--) {
      try {
        await parents[i]!.removeEntry(segments[i]!);
      } catch {
        break;
      }
    }
  }

  /**
   * Like `navigate`, but also returns every intermediate directory handle.
   */
  private async navigateWithParents(
    segments: string[]
  ): Promise<NavigationResult | undefined> {
    const parents: FileSystemDirectoryHandle[] = [];
    let dir = await this.getRoot();
    parents.push(dir);
    for (const seg of segments) {
      try {
        dir = await dir.getDirectoryHandle(seg);
      } catch (err) {
        if (isNotFound(err)) return undefined;
        throw err;
      }
      parents.push(dir);
    }
    return { dir, parents };
  }
}
