import { isNotFound } from "./error.js";
import { AsyncIO, SyncIO } from "./io.js";
import type {
  CacheEntryMeta,
  NavigationResult,
  CacheEntryPath,
  FileIO,
} from "./types.js";

const META_PREFIX = "__meta__";

const isWebWorker =
  typeof WorkerGlobalScope !== "undefined" &&
  globalThis instanceof WorkerGlobalScope;

export class OPFSFileSystem {
  private readonly root: FileSystemDirectoryHandle;
  private readonly io: FileIO;

  private constructor(root: FileSystemDirectoryHandle, io: FileIO) {
    this.root = root;
    this.io = io;
  }

  static async create(rootName: string): Promise<OPFSFileSystem> {
    const io = isWebWorker ? new SyncIO() : new AsyncIO();
    const opfs = await navigator.storage.getDirectory();
    const root = await opfs.getDirectoryHandle(rootName, { create: true });
    return new OPFSFileSystem(root, io);
  }

  /**
   * Walk a chain of nested directories.
   * When `create` is false, a missing directory means a cache miss.
   */
  private async navigate(
    segments: string[],
    create: boolean
  ): Promise<FileSystemDirectoryHandle | undefined> {
    let dir = this.root;
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

    const metaFileName = `${META_PREFIX}${fileName}`;

    try {
      const [file, meta] = await Promise.all([
        dir.getFileHandle(fileName).then((h) => this.io.readFile(h)),
        dir
          .getFileHandle(metaFileName)
          .then((h) => this.io.readFile(h))
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
    const metaFileName = `${META_PREFIX}${fileName}`;

    const writeBody = async () => {
      const handle = await dir.getFileHandle(fileName, { create: true });
      await this.io.writeFile(handle, body);
    };

    const writeMeta = async () => {
      const handle = await dir.getFileHandle(metaFileName, { create: true });
      await this.io.writeFile(
        handle,
        new Blob([JSON.stringify(meta)]).stream()
      );
    };

    const results = await Promise.allSettled([writeBody(), writeMeta()]);

    const failed = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );

    if (failed.length === 0) return;

    // Cleanup failed write attempts
    await Promise.all([
      dir.removeEntry(fileName).catch((e) => console.error(e)),
      dir.removeEntry(metaFileName).catch((e) => console.error(e)),
    ]);

    throw new Error(`${failed[0]!.reason}\n${failed?.[1]?.reason ?? ""}`);
  }

  /** Delete a cache entry and clean up empty parent directories. */
  async delete(dirSegments: string[], fileName: string): Promise<boolean> {
    const result = await this.navigateWithParents(dirSegments);
    if (result === undefined) return false;

    const { dir, parents } = result;

    let existed = false;
    const metaFileName = `${META_PREFIX}${fileName}`;
    try {
      await dir.removeEntry(fileName);
      existed = true;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    try {
      await dir.removeEntry(metaFileName);
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
    const root = this.root;
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
        subdirs.push(
          this.walk(handle as FileSystemDirectoryHandle, [...prefix, name])
        );
      } else if (!name.startsWith(META_PREFIX)) {
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
   * Note: parents always has one more element (the root) than segments.
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
    let dir = this.root;
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
