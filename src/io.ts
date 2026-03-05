import type { FileIO } from "./types.js";

export class AsyncIO implements FileIO {
  readFile(fileHandle: FileSystemFileHandle) {
    return fileHandle.getFile();
  }

  async writeFile(
    fileHandle: FileSystemFileHandle,
    body: ReadableStream<Uint8Array> | null
  ) {
    const writable = await fileHandle.createWritable();
    if (body === null) {
      await writable.close();
    } else {
      await body.pipeTo(writable);
    }
  }
}

export class SyncIO implements FileIO {
  async readFile(fileHandle: FileSystemFileHandle) {
    const handle = await fileHandle.createSyncAccessHandle();
    try {
      const size = handle.getSize();
      const buffer = new Uint8Array(size);
      handle.read(buffer);
      return new File([buffer], fileHandle.name);
    } finally {
      handle.close();
    }
  }

  async writeFile(
    fileHandle: FileSystemFileHandle,
    body: ReadableStream<Uint8Array> | null
  ) {
    const handle = await fileHandle.createSyncAccessHandle();
    try {
      handle.truncate(0);
      if (body !== null) {
        let offset = 0;
        for await (const chunk of body) {
          handle.write(chunk, { at: offset });
          offset += chunk.byteLength;
        }
      }
      handle.flush();
    } finally {
      handle.close();
    }
  }
}
