import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { deleteActivityPayment, updateActivityPayment } from "@/services/payments";
import { readBody, reqInt, reqString, respond } from "@/services/http";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ paymentId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { paymentId } = await ctx.params;
    const body = await readBody(req);
    return respond(
      await updateActivityPayment(session.userId, paymentId, {
        amountCentimes: reqInt(body, "amountCentimes"),
        userId: reqString(body, "userId"),
      })
    );
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ paymentId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { paymentId } = await ctx.params;
    return respond(await deleteActivityPayment(session.userId, paymentId));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
