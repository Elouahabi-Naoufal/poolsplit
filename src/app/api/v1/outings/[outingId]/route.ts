import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { getOutingDetail } from "@/services/outings";
import { respond } from "@/services/http";

export async function GET(req: NextRequest, ctx: { params: Promise<{ outingId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { outingId } = await ctx.params;
    return respond(await getOutingDetail(session.userId, outingId));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
