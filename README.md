# Origin Private File System (OPFS) Cache

Web Cache API compliant implementation using the [Origin Private File System (OPFS)](https://developer.mozilla.org/en-US/docs/Web/API/OPFS) to store responses. Useful for caching large responses such as Hugging Face models or any other large file that exceeds the typical caching quota's of the browser.

## Installation

```
npm install @p0u4a/opfs-cache
```

## Quick Start

### Put a response into the cache

```ts
const blob = await response.blob();
await cache.put(new Request("https://example.com/path/to/file"), new Response(blob));
```

### Try to match a cached response

```ts
const response = await cache.match(new Request("https://example.com/path/to/file"));
```

### List all cached entries

```ts
const entries = await cache.keys();
```

### Delete a cached entry

```ts
await cache.delete(new Request("https://example.com/path/to/file"));
```

## Use as a Custom Cache For Hugging Face Transformers.js

```ts
import { OPFSCache } from "@p0u4a/opfs-cache";
import { env } from "@huggingface/transformers";

const opfsModelCache = new OPFSCache("transformers-cache");

env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = opfsModelCache;
```

