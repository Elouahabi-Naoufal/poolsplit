import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { createUsageRecord } from "@/services/usage";
import { readBody, reqInt, reqString, reqStringArray, respond } from "@/services/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ activityId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { activityId } = await ctx.params;
    const body = await readBody(req);
    return respond(
      await createUsageRecord(session.userId, {
        activityId,
        productId: reqString(body, "productId"),
        quantity: reqInt(body, "quantity"),
        participantIds: reqStringArray(body, "participantIds"),
      })
    );
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
