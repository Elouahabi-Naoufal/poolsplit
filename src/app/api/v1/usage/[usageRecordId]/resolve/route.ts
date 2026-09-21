import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { resolveUsageDispute } from "@/services/usage";
import { readBody, reqInt, respond } from "@/services/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ usageRecordId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { usageRecordId } = await ctx.params;
    const body = await readBody(req);
    const quantity = reqInt(body, "quantity");
    if (quantity === undefined) return NextResponse.json({ error: "quantityMin" }, { status: 400 });
    return respond(await resolveUsageDispute(session.userId, usageRecordId, quantity));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
