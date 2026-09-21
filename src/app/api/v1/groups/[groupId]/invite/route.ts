import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { inviteMemberService } from "@/services/groups";

export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { groupId } = await params;
    const body = await req.json().catch(() => null);
    const result = await inviteMemberService(session.userId, groupId, String(body?.publicId ?? ""));
    if (!result.ok) {
      const status = result.error === "groupMissing" || result.error === "userMissing" ? 404 : result.error === "onlyOwner" ? 403 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}