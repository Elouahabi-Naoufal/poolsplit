import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { markTransferPaid } from "@/services/settlement";
import { respond } from "@/services/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ transferId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { transferId } = await ctx.params;
    return respond(await markTransferPaid(session.userId, transferId));
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
