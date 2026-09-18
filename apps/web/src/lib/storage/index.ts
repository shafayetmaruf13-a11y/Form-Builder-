import { LocalDiskStorage } from "./local";

/**
 * Where uploaded bytes live.
 *
 * An interface with one implementation today, on purpose. The stack says
 * Cloudflare R2, and Slice 5 needs object storage anyway for rendered PDFs —
 * but writing an R2 client now, against credentials nobody has yet and which
 * nothing here can exercise, would mean shipping untested code and calling it
 * done. Local disk is real, testable and enough for the builder.
 *
 * What matters is that the seam exists: `uploads.object_key` is already the
 * only thing the document stores, so swapping the implementation at Slice 5
 * changes this file and nothing else. No schema change, no document migration.
 */
export interface Storage {
  /** Stores bytes under a key. Overwrites if the key already exists. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Reads bytes back, or null when the key is unknown. */
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export { objectUrl } from "./url";

let storage: Storage | undefined;

export function getStorage(): Storage {
  storage ??= new LocalDiskStorage();
  return storage;
}
