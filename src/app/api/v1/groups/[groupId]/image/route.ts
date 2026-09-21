import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { isGroupImageUploadFile, updateGroupImageService } from "@/services/groups";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { groupId } = await params;
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "invalidInput" }, { status: 400 });
    }

    const rawFile = form.get("file");
    const file = isGroupImageUploadFile(rawFile) ? rawFile : null;
    const result = await updateGroupImageService(session.userId, groupId, { file, removeImage: false });
    if (!result.ok) {
      const status = result.error === "groupMissing" ? 404 : result.error === "onlyOwner" ? 403 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}