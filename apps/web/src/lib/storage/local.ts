import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import type { Storage } from "./index";

/**
 * Object storage backed by a directory on disk, for development.
 *
 * The content type is stored beside the object in a small sidecar file rather
 * than guessed from the extension, so what comes back out is exactly what was
 * put in.
 */
export class LocalDiskStorage implements Storage {
  private readonly root: string;

  constructor(root = process.env.UPLOADS_DIR ?? ".uploads") {
    this.root = resolve(root);
  }

  /**
   * Resolves a key to a path inside the root, and refuses anything that escapes
   * it. Keys are generated server-side today, but a store that can be talked
   * out of its own directory by a `../` is a bug waiting for the first time
   * that stops being true.
   */
  private pathFor(key: string): string {
    const path = resolve(join(this.root, key));
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error(`Refusing to access ${key}: outside the storage root`);
    }
    return path;
  }

  async put(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    await writeFile(`${path}.type`, contentType, "utf8");
  }

  async get(
    key: string,
  ): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const path = this.pathFor(key);

    try {
      const bytes = await readFile(path);
      const contentType = await readFile(`${path}.type`, "utf8").catch(
        () => "application/octet-stream",
      );
      return { bytes: new Uint8Array(bytes), contentType };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    await unlink(path).catch(() => undefined);
    await unlink(`${path}.type`).catch(() => undefined);
  }
}
