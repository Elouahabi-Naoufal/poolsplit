import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { createTemplateProduct, listTemplateProducts } from "@/services/templates";
import { readBody, reqInt, reqString, respond } from "@/services/http";

export async function GET(req: NextRequest, ctx: { params: Promise<{ templateId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { templateId } = await ctx.params;
    return respond(await listTemplateProducts(session.userId, templateId));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ templateId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { templateId } = await ctx.params;
    const body = await readBody(req);
    return respond(
      await createTemplateProduct(session.userId, templateId, {
        name: reqString(body, "name"),
        unit: reqString(body, "unit"),
        priceCentimes: reqInt(body, "priceCentimes"),
      })
    );
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
