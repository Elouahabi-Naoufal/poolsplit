import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const token = body?.token;
    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    const group = await prisma.group.findUnique({ where: { publicToken: String(token) } });
    if (!group) {
      return NextResponse.json({ error: "Invalid invitation token" }, { status: 404 });
    }

    const existingMember = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId: session.userId } },
    });
    if (existingMember) {
      return NextResponse.json({ success: true, message: "Already a member of this group", groupId: group.id });
    }

    const invitation = await prisma.groupInvitation.findFirst({
      where: { groupId: group.id, inviteeUserId: session.userId, status: "PENDING" },
    });

    await prisma.groupMember.create({
      data: { groupId: group.id, userId: session.userId, role: "MEMBER" },
    });
    if (invitation) {
      await prisma.groupInvitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED" } });
    }

    return NextResponse.json({ success: true, message: `Joined group "${group.name}"`, groupId: group.id });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}