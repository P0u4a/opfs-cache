import { OPFSFileSystem } from "./fs";
import { resolvePath } from "./path";
import type { CacheEntryMeta } from "./types";

export type { CacheEntryMeta } from "./types";
export type { ResolvedPath } from "./path";
export { resolvePath } from "./path";
export { OPFSFileSystem } from "./fs";

export class OPFSCache
  implements Pick<Cache, "match" | "put" | "delete" | "keys">
{
  private readonly fs: OPFSFileSystem;

  constructor(rootName: string) {
    this.fs = new OPFSFileSystem(rootName);
  }

  async match(
    request: RequestInfo | URL,
    _options?: CacheQueryOptions
  ): Promise<Response | undefined> {
    const { dir, file } = resolvePath(request);

    const entry = await this.fs.readEntry(dir, file);
    if (entry === undefined) return undefined;

    return new Response(entry.file.stream(), {
      status: entry.meta?.status ?? 200,
      statusText: entry.meta?.statusText ?? "",
      headers: entry.meta?.headers ?? {},
    });
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    if (response.bodyUsed) {
      throw new TypeError("Response body has already been consumed");
    }

    const { dir, file } = resolvePath(request);

    const meta: CacheEntryMeta = {
      headers: Object.fromEntries(response.headers),
      status: response.status,
      statusText: response.statusText,
    };

    await this.fs.write(dir, file, response.body, meta);
  }

  async delete(
    request: RequestInfo | URL,
    _options?: CacheQueryOptions
  ): Promise<boolean> {
    const { dir, file } = resolvePath(request);
    return this.fs.delete(dir, file);
  }

  async keys(
    request?: RequestInfo | URL,
    _options?: CacheQueryOptions
  ): Promise<ReadonlyArray<Request>> {
    if (request !== undefined) {
      const { dir, file } = resolvePath(request);
      const found = await this.fs.exists(dir, file);
      if (!found) return [];
      return [new Request(`/${[...dir, file].join("/")}`)];
    }

    const entries = await this.fs.list();
    return entries.map((segs) => new Request(`/${segs.join("/")}`));
  }
}
