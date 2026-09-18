import { NextResponse } from "next/server";

import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Serves a stored object.
 *
 * A stopgap for local-disk storage. Once Slice 5 puts objects in R2 this
 * becomes a redirect to a signed URL, so that bytes are served by the bucket
 * rather than streamed through the app — but the URL shape stays the same, and
 * no stored document has to change.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;

  // Keys are stored as `uploads/<id>.<ext>` but arrive URL-encoded as a single
  // path segment.
  const objectKey = decodeURIComponent(key);

  let object: Awaited<ReturnType<ReturnType<typeof getStorage>["get"]>>;
  try {
    object = await getStorage().get(objectKey);
  } catch {
    // The storage layer rejects keys that escape its root.
    return new NextResponse("Not found", { status: 404 });
  }

  if (!object) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(Buffer.from(object.bytes), {
    headers: {
      "Content-Type": object.contentType,
      // Keys are content-addressed by a nanoid and never reused, so an object
      // can be cached hard.
      "Cache-Control": "public, max-age=31536000, immutable",
      // Uploaded SVG is script-capable; never let it run in our origin.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
