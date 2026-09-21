import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { inviteOutingParticipant } from "@/services/outings";
import { readBody, reqString, respond } from "@/services/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ outingId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { outingId } = await ctx.params;
    const body = await readBody(req);
    const publicId = reqString(body, "publicId");
    if (!publicId) return NextResponse.json({ error: "userRequired" }, { status: 400 });
    return respond(await inviteOutingParticipant(session.userId, outingId, publicId));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
