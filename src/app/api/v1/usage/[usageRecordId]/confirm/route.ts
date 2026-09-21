import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { confirmUsageRecord } from "@/services/usage";
import { readBody, reqString, respond } from "@/services/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ usageRecordId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { usageRecordId } = await ctx.params;
    const body = await readBody(req);
    return respond(await confirmUsageRecord(session.userId, usageRecordId, reqString(body, "userId")));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
