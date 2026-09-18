import { nanoid } from "nanoid";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { uploads } from "@/db/schema";
import { env } from "@/env";
import { getStorage, objectUrl } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * What a logo may be.
 *
 * Architecture rule 5: the client's `accept` attribute is a convenience, not a
 * control. Everything here is re-checked server-side, because an upload
 * endpoint is reachable by anyone who can reach the app and will be reachable
 * from public fill pages once `fileUpload` answers arrive at Slice 4.
 */
const MAX_BYTES = 5_000_000;
const ALLOWED = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
]);

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart form data" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const extension = ALLOWED.get(file.type);
  if (!extension) {
    return NextResponse.json(
      { error: `Unsupported type ${file.type || "unknown"}` },
      { status: 415 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File is larger than ${MAX_BYTES / 1_000_000} MB` },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Trust the measured length, not the reported one.
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "File is too large" }, { status: 413 });
  }

  // The key is generated here and never taken from the filename: a
  // user-supplied name is a path traversal and an overwrite waiting to happen.
  const id = nanoid();
  const objectKey = `uploads/${id}.${extension}`;

  try {
    await getStorage().put(objectKey, bytes, file.type);

    await db.insert(uploads).values({
      id,
      ownerId: env.DEV_USER_ID,
      objectKey,
      filename: file.name.slice(0, 255),
      contentType: file.type,
      byteSize: bytes.byteLength,
    });
  } catch (error) {
    console.error("upload failed", error);
    return NextResponse.json(
      {
        error:
          "Could not store the upload. Is the database running? Try `pnpm db:up && pnpm db:migrate`.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ objectKey, url: objectUrl(objectKey) });
}
