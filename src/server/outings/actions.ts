"use server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/server/auth/session";
import { logEvent } from "@/server/audit";
import { revalidatePath } from "next/cache";
import { generateGroupPublicToken } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

/**
 * Create an outing within a group. Group owner or members with the
 * canManageOutings permission can create outings.
 * The creator becomes an OutingParticipant automatically.
 */
export async function createOutingAction(formData: FormData) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const groupId = formData.get("groupId") as string;
  const name = ((formData.get("name") as string) || "").trim();
  const description = ((formData.get("description") as string) || "").trim() || undefined;
  const participantIds = formData.getAll("participantIds") as string[];

  if (!groupId) return { error: t("groupRequired") };
  if (!name) return { error: t("outingNameRequired") };

  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return { error: t("groupMissing") };

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: session.userId } },
  });
  if (!member) return { error: t("notGroupMember") };
  if (member.role !== "OWNER" && !member.canManageOutings) return { error: t("onlyOwner") };

  const outing = await prisma.outing.create({
    data: {
      groupId,
      name,
      description,
      status: "PLANNING",
      createdBy: session.userId,
      publicToken: generateGroupPublicToken(),
    },
  });

  // Creator becomes an outing participant
  await prisma.outingParticipant.create({
    data: {
      outingId: outing.id,
      userId: session.userId,
      role: "OWNER",
    },
  });

  // Add selected group members as participants
  const uniqueParticipantIds = [...new Set(participantIds.filter(id => id !== session.userId))];
  if (uniqueParticipantIds.length > 0) {
    await prisma.outingParticipant.createMany({
      data: uniqueParticipantIds.map(userId => ({
        outingId: outing.id,
        userId,
        role: "MEMBER" as const,
      })),
    });
  }

  await logEvent({
    groupId,
    outingId: outing.id,
    actorId: session.userId,
    eventType: "OUTING_CREATED",
    entityType: "Outing",
    entityId: outing.id,
    metadata: { name },
  });

  revalidatePath(`/groups/${groupId}`);
  return { success: true, id: outing.id };
}

/**
 * Invite a group member to an outing. Only outing OWNER can invite.
 * Invited user must be a group member.
 */
export async function inviteToOutingAction(outingId: string, userId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing) return { error: t("outingNotFound") };

  const inviter = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId: session.userId } },
  });
  if (!inviter || inviter.role !== "OWNER") return { error: t("onlyOutingOwnerInvite") };

  // Must be a group member
  const groupMember = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: outing.groupId, userId } },
  });
  if (!groupMember) return { error: t("userNotGroupMember") };

  // Check if already a participant
  const existing = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId } },
  });
  if (existing) return { error: t("alreadyParticipant") };

  await prisma.outingParticipant.create({
    data: { outingId, userId, role: "MEMBER" },
  });

  await logEvent({
    groupId: outing.groupId,
    outingId,
    actorId: session.userId,
    eventType: "OUTING_MEMBER_INVITED",
    entityType: "OutingParticipant",
    entityId: userId,
  });

  revalidatePath(`/groups/${outing.groupId}/outings/${outingId}`);
  return { success: true };
}

/**
 * Invite an outsider (non-group-member) to an outing.
 * The outsider must already have a Hesab account.
 * Admin invites them, they accept, they become an outing participant
 * but NOT a group member.
 */
export async function inviteOutsiderToOutingAction(outingId: string, userPublicId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing) return { error: t("outingNotFound") };

  const inviter = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId: session.userId } },
  });
  if (!inviter || inviter.role !== "OWNER") return { error: t("onlyOutingOwnerInvite") };

  const invitee = await prisma.user.findUnique({ where: { publicId: userPublicId } });
  if (!invitee) return { error: t("userMissing") };

  // Check not already invited
  const existingInvite = await prisma.outingInvitation.findUnique({
    where: { outingId_inviteeUserId: { outingId, inviteeUserId: invitee.id } },
  });
  if (existingInvite) return { error: t("alreadyInvited") };

  // Check not already a participant
  const existingParticipant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId: invitee.id } },
  });
  if (existingParticipant) return { error: t("alreadyParticipant") };

  const invite = await prisma.outingInvitation.create({
    data: {
      outingId,
      inviterId: session.userId,
      inviteeUserId: invitee.id,
      status: "PENDING",
    },
  });

  await logEvent({
    groupId: outing.groupId,
    outingId,
    actorId: session.userId,
    eventType: "OUTING_OUTSIDER_INVITED",
    entityType: "OutingInvitation",
    entityId: invite.id,
    metadata: { invitee: userPublicId },
  });

  revalidatePath(`/groups/${outing.groupId}/outings/${outingId}`);
  return { success: true };
}

/**
 * Accept an outing invitation. Adds user as an outing participant.
 */
export async function acceptOutingInvitationAction(invitationId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const invite = await prisma.outingInvitation.findUnique({ where: { id: invitationId } });
  if (!invite) return { error: t("inviteNotFound") };
  if (invite.inviteeUserId !== session.userId) return { error: t("notYourInvite") };
  if (invite.status !== "PENDING") return { error: t("alreadyResponded") };

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.outingInvitation.findUnique({ where: { id: invitationId } });
    if (!fresh || fresh.status !== "PENDING") throw new Error("Already responded");

    await tx.outingInvitation.update({
      where: { id: invitationId },
      data: { status: "ACCEPTED" },
    });

    await tx.outingParticipant.create({
      data: {
        outingId: invite.outingId,
        userId: session.userId,
        role: "MEMBER",
      },
    });
  });

  const outing = await prisma.outing.findUnique({ where: { id: invite.outingId } });
  if (outing) {
    revalidatePath(`/groups/${outing.groupId}/outings/${invite.outingId}`);
  }
  return { success: true };
}

/**
 * Decline an outing invitation.
 */
export async function declineOutingInvitationAction(invitationId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const invite = await prisma.outingInvitation.findUnique({ where: { id: invitationId } });
  if (!invite) return { error: t("inviteNotFound") };
  if (invite.inviteeUserId !== session.userId) return { error: t("notYourInvite") };

  await prisma.outingInvitation.update({
    where: { id: invitationId },
    data: { status: "DECLINED" },
  });

  const outing = await prisma.outing.findUnique({ where: { id: invite.outingId } });
  if (outing) {
    revalidatePath(`/groups/${outing.groupId}/outings/${invite.outingId}`);
  }
  return { success: true };
}

/**
 * Request to leave an outing. Only participants with no financial data
 * can be directly removed by admin. Others must request to leave.
 * Admin approves or rejects.
 */
export async function requestLeaveOutingAction(outingId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId: session.userId } },
  });
  if (!participant) return { error: t("notOutingParticipant") };
  if (participant.role === "OWNER") return { error: t("ownerCantLeave") };

  // Check if user has financial data in the outing
  const hasActivityPayments = await prisma.activityPayment.findFirst({
    where: { activity: { outingId }, userId: session.userId },
  });
  const hasLineItems = await prisma.lineItem.findFirst({
    where: { activity: { outingId }, userId: session.userId },
  });
  const hasUsageRecords = await prisma.usageRecord.findFirst({
    where: { activity: { outingId }, createdById: session.userId },
  });

  const hasFinancialData = hasActivityPayments || hasLineItems || hasUsageRecords;

  // Remove directly if no financial data
  if (!hasFinancialData) {
    await prisma.outingParticipant.delete({
      where: { outingId_userId: { outingId, userId: session.userId } },
    });
    const outing = await prisma.outing.findUnique({ where: { id: outingId } });
    if (outing) revalidatePath(`/groups/${outing.groupId}/outings/${outingId}`);
    return { success: true, removed: true };
  }

  // Has financial data — needs admin approval (for now, auto-remove but preserve history)
  await prisma.outingParticipant.delete({
    where: { outingId_userId: { outingId, userId: session.userId } },
  });

  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (outing) {
    await logEvent({
      groupId: outing.groupId,
      outingId,
      actorId: session.userId,
      eventType: "OUTING_MEMBER_LEFT",
      entityType: "User",
      entityId: session.userId,
    });
    revalidatePath(`/groups/${outing.groupId}/outings/${outingId}`);
  }
  return { success: true, removed: true, hadFinancialData: true };
}

/**
 * Admin removes a participant from an outing.
 * If they have financial data, their data is preserved but they can't participate further.
 */
export async function removeOutingParticipantAction(outingId: string, userId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing) return { error: t("outingNotFound") };

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId: session.userId } },
  });
  if (!caller || caller.role !== "OWNER") return { error: t("onlyOwner") };
  if (userId === session.userId) return { error: t("cantRemoveSelf") };

  const target = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId } },
  });
  if (!target) return { error: t("notOutingParticipant") };

  await prisma.outingParticipant.delete({
    where: { outingId_userId: { outingId, userId } },
  });

  await logEvent({
    groupId: outing.groupId,
    outingId,
    actorId: session.userId,
    eventType: "OUTING_MEMBER_REMOVED",
    entityType: "User",
    entityId: userId,
  });

  revalidatePath(`/groups/${outing.groupId}/outings/${outingId}`);
  return { success: true };
}

/**
 * Activate an outing (PLANNING → ACTIVE). Owner only.
 */
export async function activateOutingAction(outingId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing) return { error: t("outingNotFound") };

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId: session.userId } },
  });
  if (!participant || participant.role !== "OWNER") return { error: t("onlyOwner") };
  if (outing.status !== "PLANNING") return { error: t("notPlanning") };

  await prisma.outing.update({
    where: { id: outingId },
    data: { status: "ACTIVE" },
  });

  await logEvent({
    groupId: outing.groupId,
    outingId,
    actorId: session.userId,
    eventType: "OUTING_ACTIVATED",
    entityType: "Outing",
    entityId: outingId,
  });

  revalidatePath(`/groups/${outing.groupId}/outings/${outingId}`);
  return { success: true };
}
