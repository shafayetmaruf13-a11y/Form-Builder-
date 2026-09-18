"use client";

import { useCallback, useRef, useState } from "react";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";

/**
 * Picks a file and uploads it, resolving to the stored object key.
 *
 * The hook owns its own hidden `<input type="file">` and hands it back as an
 * element to render, rather than handing out a ref for the caller to attach.
 * That keeps the imperative bit — clicking an input that is not visible —
 * entirely inside here, and leaves the panel with a plain async function.
 *
 * Errors are returned as text rather than thrown: the likeliest failure is
 * "the database isn't running", which is something to tell the user, not a
 * reason to take the builder down.
 */
export function useLogoUpload() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resolveRef = useRef<((key: string | null) => void) | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = useCallback((): Promise<string | null> => {
    setError(null);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      inputRef.current?.click();
    });
  }, []);

  const onChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Let the same file be chosen twice in a row.
      event.target.value = "";

      const resolve = resolveRef.current;
      resolveRef.current = null;

      if (!file) {
        resolve?.(null);
        return;
      }

      setUploading(true);
      try {
        const body = new FormData();
        body.append("file", file);

        const response = await fetch("/api/uploads", { method: "POST", body });
        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          setError(errorFrom(payload) ?? `Upload failed (${response.status})`);
          resolve?.(null);
          return;
        }

        resolve?.(objectKeyFrom(payload));
      } catch {
        setError("Upload failed. Is the dev server still running?");
        resolve?.(null);
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      className="hidden"
      onChange={onChange}
    />
  );

  return { pick, uploading, error, fileInput };
}

function errorFrom(payload: unknown): string | null {
  return payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : null;
}

function objectKeyFrom(payload: unknown): string | null {
  return payload &&
    typeof payload === "object" &&
    "objectKey" in payload &&
    typeof payload.objectKey === "string"
    ? payload.objectKey
    : null;
}
