export function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotFoundError";
}
