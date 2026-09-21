import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { deleteUsageRecord, updateUsageRecord } from "@/services/usage";
import { readBody, reqInt, reqString, reqStringArray, respond } from "@/services/http";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ usageRecordId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { usageRecordId } = await ctx.params;
    const body = await readBody(req);
    return respond(
      await updateUsageRecord(session.userId, usageRecordId, {
        quantity: reqInt(body, "quantity"),
        productId: reqString(body, "productId"),
        participantIds: reqStringArray(body, "participantIds"),
        status: reqString(body, "status"),
      })
    );
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ usageRecordId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { usageRecordId } = await ctx.params;
    return respond(await deleteUsageRecord(session.userId, usageRecordId));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
