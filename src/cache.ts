import { OPFSFileSystem } from "./fs.js";
import { resolvePath } from "./path.js";
import type { CacheEntryMeta } from "./types.js";

export class OPFSCache implements Pick<
  Cache,
  "match" | "put" | "delete" | "keys"
> {
  private readonly fs: OPFSFileSystem;

  constructor(root: string) {
    this.fs = new OPFSFileSystem(root);
  }

  async match(
    request: RequestInfo | URL,
    _options?: CacheQueryOptions
  ): Promise<Response | undefined> {
    const { dir, file } = resolvePath(request);

    const entry = await this.fs.readEntry(dir, file);

    return entry
      ? new Response(entry.file.stream(), {
          status: entry.meta?.status ?? 200,
          statusText: entry.meta?.statusText ?? "",
          headers: entry.meta?.headers ?? {},
        })
      : undefined;
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
      return this.tryGetKeyOrDefault(request);
    }

    const entries = await this.fs.list();
    return entries.map((segs) => new Request(`/${segs.join("/")}`));
  }

  private async tryGetKeyOrDefault(
    request: RequestInfo | URL
  ): Promise<Request[]> {
    const { dir, file } = resolvePath(request);
    const found = await this.fs.exists(dir, file);
    return found ? [new Request(`/${[...dir, file].join("/")}`)] : [];
  }
}
