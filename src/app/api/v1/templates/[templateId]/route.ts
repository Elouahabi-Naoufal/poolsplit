import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { deleteTemplate, updateTemplate } from "@/services/templates";
import { readBody, reqString, respond } from "@/services/http";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ templateId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { templateId } = await ctx.params;
    const body = await readBody(req);
    return respond(
      await updateTemplate(session.userId, templateId, {
        name: reqString(body, "name"),
        pricingModel: reqString(body, "pricingModel"),
        notes: reqString(body, "notes"),
      })
    );
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ templateId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { templateId } = await ctx.params;
    return respond(await deleteTemplate(session.userId, templateId));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
