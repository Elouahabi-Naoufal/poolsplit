import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { createActivityProduct } from "@/services/products";
import { readBody, reqInt, reqString, respond } from "@/services/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ activityId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { activityId } = await ctx.params;
    const body = await readBody(req);
    return respond(
      await createActivityProduct(session.userId, activityId, {
        name: reqString(body, "name"),
        unit: reqString(body, "unit"),
        priceCentimes: reqInt(body, "priceCentimes"),
      })
    );
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
