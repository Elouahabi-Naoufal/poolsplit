import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function GET(_request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  if (!groupId) return NextResponse.json({ error: "Missing group ID" }, { status: 400 });
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(groupId)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const dir = path.join(process.cwd(), "data", "group-images");
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    try {
      const data = fs.readFileSync(path.join(dir, `${groupId}.${ext}`));
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