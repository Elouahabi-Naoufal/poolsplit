import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!userId) return NextResponse.json({ error: "Missing user ID" }, { status: 400 });
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const dir = path.join(process.cwd(), "data", "avatars");
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    try {
      const data = fs.readFileSync(path.join(dir, `${userId}.${ext}`));
      return new NextResponse(data, {
        headers: {
          "Content-Type": CONTENT_TYPES[ext],
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {}
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}