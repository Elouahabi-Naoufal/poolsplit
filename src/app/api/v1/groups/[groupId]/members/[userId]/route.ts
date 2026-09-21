import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { removeMemberService } from "@/services/groups";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ groupId: string; userId: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { groupId, userId } = await params;
    const result = await removeMemberService(session.userId, groupId, userId);
    if (!result.ok) {
      const status = result.error === "groupMissing" || result.error === "notGroupMember" ? 404 : result.error === "onlyOwner" ? 403 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}