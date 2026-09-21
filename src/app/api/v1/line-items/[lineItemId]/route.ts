import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { deleteLineItem, updateLineItem } from "@/services/lineitems";
import { readBody, reqInt, reqString, respond } from "@/services/http";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ lineItemId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { lineItemId } = await ctx.params;
    const body = await readBody(req);
    return respond(
      await updateLineItem(session.userId, lineItemId, {
        description: reqString(body, "description"),
        priceCentimes: reqInt(body, "priceCentimes"),
      })
    );
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ lineItemId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { lineItemId } = await ctx.params;
    return respond(await deleteLineItem(session.userId, lineItemId));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
