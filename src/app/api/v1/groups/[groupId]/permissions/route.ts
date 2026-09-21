import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { updateGroupPermissionsService } from "@/services/groups";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { groupId } = await params;
    const body = await req.json().catch(() => null);
    const rawPermissions = body?.permissions;
    const result = await updateGroupPermissionsService(session.userId, groupId, String(body?.userId ?? ""), {
      canManageOutings: typeof rawPermissions?.canManageOutings === "boolean" ? rawPermissions.canManageOutings : undefined,
      canRecordPayments: typeof rawPermissions?.canRecordPayments === "boolean" ? rawPermissions.canRecordPayments : undefined,
      canUseTemplates: typeof rawPermissions?.canUseTemplates === "boolean" ? rawPermissions.canUseTemplates : undefined,
    });
    if (!result.ok) {
      const status = result.error === "groupMissing" || result.error === "notGroupMember" ? 404 : result.error === "onlyOwner" ? 403 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}