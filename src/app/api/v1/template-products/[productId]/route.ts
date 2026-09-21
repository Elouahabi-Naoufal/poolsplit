import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { deleteTemplateProduct, updateTemplateProduct } from "@/services/templates";
import { readBody, reqInt, reqString, respond } from "@/services/http";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ productId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { productId } = await ctx.params;
    const body = await readBody(req);
    return respond(
      await updateTemplateProduct(session.userId, productId, {
        name: reqString(body, "name"),
        unit: reqString(body, "unit"),
        priceCentimes: reqInt(body, "priceCentimes"),
      })
    );
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ productId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { productId } = await ctx.params;
    return respond(await deleteTemplateProduct(session.userId, productId));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
