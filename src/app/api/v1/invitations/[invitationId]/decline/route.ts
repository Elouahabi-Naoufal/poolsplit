import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { declineInvitationService } from "@/services/groups";

export async function POST(req: NextRequest, { params }: { params: Promise<{ invitationId: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { invitationId } = await params;
    const result = await declineInvitationService(session.userId, invitationId);
    if (!result.ok) {
      const status = result.error === "inviteNotFound" ? 404 : 403;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}