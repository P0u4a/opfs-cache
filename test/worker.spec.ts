import { afterAll, beforeAll, describe, expect, it } from "vitest";

type WorkerResult = { id: number; result?: unknown; error?: string };

let nextId = 0;

function sendCommand(
  worker: Worker,
  command: Record<string, unknown>
): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerResult>) => {
      if (e.data.id !== id) return;
      worker.removeEventListener("message", handler);
      if (e.data.error === undefined) {
        resolve(e.data.result);
      } else {
        reject(new Error(e.data.error));
      }
    };
    worker.addEventListener("message", handler);
    worker.postMessage({ id, ...command });
  });
}

describe("OPFS Cache (Web Worker)", () => {
  let worker: Worker;

  beforeAll(() => {
    worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
  });

  afterAll(async () => {
    await sendCommand(worker, {
      action: "delete",
      url: "https://localhost:3000/data",
    });
    await sendCommand(worker, {
      action: "delete",
      url: "https://localhost:3000/foo",
    });
    await sendCommand(worker, {
      action: "delete",
      url: "https://localhost:3000/bar",
    });
    worker.terminate();
  });

  it("puts and matches a response via worker", async () => {
    await sendCommand(worker, {
      action: "put",
      url: "https://localhost:3000/data",
      body: "hello from worker",
    });

    const result = (await sendCommand(worker, {
      action: "match",
      url: "https://localhost:3000/data",
    })) as {
      body: string;
      status: number;
      statusText: string;
      headers: Record<string, string>;
    };

    expect(result.body).toBe("hello from worker");
    expect(result.status).toBe(200);
    expect(result.statusText).toBe("");
  });

  it("deletes a key via worker", async () => {
    await sendCommand(worker, {
      action: "put",
      url: "https://localhost:3000/data",
      body: "to be deleted",
    });

    const deleted = await sendCommand(worker, {
      action: "delete",
      url: "https://localhost:3000/data",
    });
    expect(deleted).toBe(true);

    const matched = await sendCommand(worker, {
      action: "match",
      url: "https://localhost:3000/data",
    });
    expect(matched).toBeUndefined();
  });

  it("lists keys via worker", async () => {
    await sendCommand(worker, {
      action: "put",
      url: "https://localhost:3000/foo",
      body: "a",
    });
    await sendCommand(worker, {
      action: "put",
      url: "https://localhost:3000/bar",
      body: "b",
    });

    const keys = (await sendCommand(worker, { action: "keys" })) as string[];
    const paths = keys.map((u) => new URL(u).pathname);

    expect(paths).toContain("/foo");
    expect(paths).toContain("/bar");
  });

  it("returns false when deleting a non-existent key", async () => {
    const deleted = await sendCommand(worker, {
      action: "delete",
      url: "https://localhost:3000/does-not-exist",
    });
    expect(deleted).toBe(false);
  });
});
