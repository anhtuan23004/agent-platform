/**
 * Dependency boundary for file access. Injected by platform at runtime.
 * Tests provide an in-memory implementation.
 */
export interface PmoFileStore {
  getBuffer(fileKey: string): Promise<Buffer>;
}
