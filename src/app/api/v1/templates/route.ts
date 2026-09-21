import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { createTemplate, listTemplates } from "@/services/templates";
import { readBody, reqString, respond } from "@/services/http";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    return respond(await listTemplates(session.userId));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await readBody(req);
    const rawProducts = body.products;
    const products = Array.isArray(rawProducts)
      ? rawProducts
          .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
          .map(p => ({
            name: typeof p.name === "string" ? p.name : undefined,
            unit: typeof p.unit === "string" ? p.unit : undefined,
            priceCentimes: typeof p.priceCentimes === "number" && Number.isSafeInteger(p.priceCentimes) ? p.priceCentimes : undefined,
          }))
      : undefined;

    return respond(
      await createTemplate(session.userId, {
        name: reqString(body, "name"),
        pricingModel: reqString(body, "pricingModel"),
        products,
      })
    );
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
