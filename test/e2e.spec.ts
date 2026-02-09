import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OPFSCache } from "../src";

describe("OPFS Cache", () => {
  let cache: OPFSCache | null;

  beforeEach(() => {
    cache = new OPFSCache("test");
  });

  afterEach(async () => {
    await cache?.delete("https://localhost:3000/data");
    await cache?.delete("https://localhost:3000/foo");
    await cache?.delete("https://localhost:3000/bar");

    cache = null;
  });

  it("caches response to file system with URL key", async () => {
    const cacheUrl = new URL("https://localhost:3000/data");
    const cacheResponse = new Response(new Blob(["0", "1", "1", "0"]));

    await cache?.put(cacheUrl, cacheResponse);
    const response = await cache?.match(cacheUrl);

    expect(cacheResponse).toEqual(response);
  });

  it("caches response to file system with with Request key", async () => {
    const cacheRequest = new Request("https://localhost:3000/data");
    const cacheResponse = new Response(new Blob(["0", "1", "1", "0"]));

    await cache?.put(cacheRequest, cacheResponse);
    const response = await cache?.match(cacheRequest);
    expect(cacheResponse).toEqual(response);
  });

  it("caches response to file system with string key", async () => {
    const cacheString = "https://localhost:3000/data";
    const cacheResponse = new Response(new Blob(["0", "1", "1", "0"]));

    await cache?.put(cacheString, cacheResponse);
    const response = await cache?.match(cacheString);
    expect(cacheResponse).toEqual(response);
  });

  it("lists currently active keys", async () => {
    const keyA = "https://localhost:3000/foo";
    const keyB = "https://localhost:3000/bar";
    await cache?.put(keyA, new Response());
    await cache?.put(keyB, new Response());

    const keys = await cache?.keys();

    expect(keys).toEqual([new Request(keyA), new Request(keyB)]);
  });

  it("lists currently active keys with request", async () => {
    const keyA = new Request("https://localhost:3000/foo");
    const keyB = new Request("https://localhost:3000/bar");
    await cache?.put(keyA, new Response());
    await cache?.put(keyB, new Response());

    const keys = await cache?.keys(keyA);

    expect(keys).toEqual([new Request(keyA)]);
  });

  it("deletes a given key", async () => {
    const key = "https://localhost:3000/data";
    const cacheResponse = new Response();
    await cache?.put(key, new Response());

    const response = await cache?.match(key);
    expect(cacheResponse).toEqual(response);

    const isDeleted = await cache?.delete(key);
    expect(isDeleted).toBe(true);

    const maybeResponse = await cache?.match(key);
    expect(maybeResponse).toEqual(undefined);
  });

  it("returns undefined when deleting a non-existent key", async () => {
    const key = "https://localhost:3000/data";
    const maybeResponse = await cache?.match(key);
    expect(maybeResponse).toEqual(undefined);

    const isDeleted = await cache?.delete(key);
    expect(isDeleted).toBe(false);
  });
});
