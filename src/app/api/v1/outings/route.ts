import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { createOuting } from "@/services/outings";
import { readBody, reqString, reqStringArray, respond } from "@/services/http";

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await readBody(req);
    return respond(
      await createOuting(session.userId, {
        groupId: reqString(body, "groupId"),
        name: reqString(body, "name"),
        description: reqString(body, "description"),
        participantIds: reqStringArray(body, "participantIds"),
      })
    );
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
