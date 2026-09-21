import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { listGroupOutings } from "@/services/outings";
import { respond } from "@/services/http";

export async function GET(req: NextRequest, ctx: { params: Promise<{ groupId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { groupId } = await ctx.params;
    return respond(await listGroupOutings(session.userId, groupId));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
