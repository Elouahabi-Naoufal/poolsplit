import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { createActivity } from "@/services/activities";
import { readBody, reqString, reqStringArray, respond } from "@/services/http";

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await readBody(req);
    return respond(
      await createActivity(session.userId, {
        outingId: reqString(body, "outingId"),
        name: reqString(body, "name"),
        pricingModel: reqString(body, "pricingModel"),
        notes: reqString(body, "notes"),
        participantIds: reqStringArray(body, "participantIds"),
        templateId: reqString(body, "templateId"),
      })
    );
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
