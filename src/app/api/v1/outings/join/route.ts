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

    const outing = await prisma.outing.findUnique({
      where: { publicToken: String(token) },
      include: { group: true },
    });
    if (!outing) {
      return NextResponse.json({ error: "Invalid invitation token" }, { status: 404 });
    }

    const isGroupMember = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: outing.groupId, userId: session.userId } },
    });
    if (!isGroupMember) {
      return NextResponse.json(
        { error: "You must be a member of this group to join the outing. Join the group first." },
        { status: 403 }
      );
    }

    const existing = await prisma.outingParticipant.findUnique({
      where: { outingId_userId: { outingId: outing.id, userId: session.userId } },
    });
    if (existing) {
      return NextResponse.json({ success: true, message: "Already a participant", groupId: outing.groupId, outingId: outing.id });
    }

    const invitation = await prisma.outingInvitation.findUnique({
      where: { outingId_inviteeUserId: { outingId: outing.id, inviteeUserId: session.userId } },
    });

    await prisma.outingParticipant.create({ data: { outingId: outing.id, userId: session.userId } });
    if (invitation) {
      await prisma.outingInvitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED" } });
    }

    return NextResponse.json({ success: true, message: `Joined outing "${outing.name}"`, groupId: outing.groupId, outingId: outing.id });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}