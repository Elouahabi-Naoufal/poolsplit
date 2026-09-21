import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { requestUsageCorrection } from "@/services/corrections";
import { readBody, reqInt, reqString, respond } from "@/services/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ usageRecordId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { usageRecordId } = await ctx.params;
    const body = await readBody(req);
    return respond(
      await requestUsageCorrection(session.userId, usageRecordId, {
        reason: reqString(body, "reason"),
        newQuantity: reqInt(body, "newQuantity"),
        entityType: reqString(body, "entityType"),
        entityId: reqString(body, "entityId"),
        field: reqString(body, "field"),
        oldValue: reqString(body, "oldValue"),
        newValue: reqString(body, "newValue"),
      })
    );
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
