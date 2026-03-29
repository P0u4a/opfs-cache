import { OPFSCache } from "../src";

type WorkerCommand =
  | { id: number; action: "put"; url: string; body: string }
  | { id: number; action: "match"; url: string }
  | { id: number; action: "delete"; url: string }
  | { id: number; action: "keys" }
  | { id: number; action: "keys"; url: string };

let cache: OPFSCache;

const ready = OPFSCache.open("test-worker").then((c) => {
  cache = c;
});

globalThis.onmessage = async (e: MessageEvent<WorkerCommand>) => {
  await ready;
  const { id, action } = e.data;
  try {
    let result: unknown;

    switch (action) {
      case "put": {
        const response = new Response(new Blob([e.data.body]));
        await cache.put(e.data.url, response);
        result = null;
        break;
      }
      case "match": {
        const response = await cache.match(e.data.url);
        if (response === undefined) {
          result = undefined;
        } else {
          result = {
            body: await response.text(),
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers),
          };
        }
        break;
      }
      case "delete": {
        result = await cache.delete(e.data.url);
        break;
      }
      case "keys": {
        const url = "url" in e.data ? e.data.url : undefined;
        const keys = await cache.keys(url);
        result = keys.map((r) => r.url);
        break;
      }
    }

    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
