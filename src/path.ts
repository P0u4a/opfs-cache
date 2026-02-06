export interface ResolvedPath {
  dir: string[];
  file: string;
}

/**
 * Resolves a RequestInfo or URL into OPFS directory and file segments.
 */
export function resolvePath(request: RequestInfo | URL): ResolvedPath {
  let pathname: string;
  let search: string;

  if (typeof request === "string") {
    if (URL.canParse(request)) {
      const url = new URL(request);
      pathname = url.pathname;
      search = url.search;
    } else {
      const qIndex = request.indexOf("?");
      if (qIndex === -1) {
        pathname = request;
        search = "";
      } else {
        pathname = request.substring(0, qIndex);
        search = request.substring(qIndex);
      }
    }
  } else if (request instanceof Request) {
    const url = new URL(request.url);
    pathname = url.pathname;
    search = url.search;
  } else if (request instanceof URL) {
    pathname = request.pathname;
    search = request.search;
  } else {
    throw new TypeError("Expected a string, Request, or URL");
  }

  const segments = pathname.split("/").filter((s) => s.length > 0);

  if (segments.length === 0) {
    throw new TypeError("Path resolved to zero segments");
  }

  // Protects against directory traversal
  for (const seg of segments) {
    if (seg === "." || seg === "..") {
      throw new TypeError(`Invalid path segment: "${seg}"`);
    }
  }

  const file = segments.pop()! + search;
  return { dir: segments, file };
}
