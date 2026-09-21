import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { approveCorrection } from "@/services/corrections";
import { readBody, reqString, respond } from "@/services/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ correctionId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { correctionId } = await ctx.params;
    const body = await readBody(req);
    return respond(await approveCorrection(session.userId, correctionId, reqString(body, "note")));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
