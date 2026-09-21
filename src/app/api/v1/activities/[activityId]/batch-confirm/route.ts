import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { batchConfirmActivity } from "@/services/activities";
import { respond } from "@/services/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ activityId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { activityId } = await ctx.params;
    return respond(await batchConfirmActivity(session.userId, activityId));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
