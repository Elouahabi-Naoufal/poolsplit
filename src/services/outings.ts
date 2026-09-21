import { prisma } from "@/lib/prisma";
import { logEvent } from "@/server/audit";
import { getGroupMemberPerms } from "@/server/groups/permissions";
import { generateGroupPublicToken } from "@/lib/utils";
import { activityResponsibility, activityPaid, computeMemberBalances, type ActivityStatsInput } from "./stats";
import { fail, ok, type ServiceResult } from "./types";

export type OutingSummary = {
  id: string;
  name: string;
  status: string;
  date: string;
  participantCount: number;
  participants: { userId: string; displayName: string; publicId: string }[];
};

const ACTIVITY_INCLUDE = {
  products: true,
  usageRecords: { include: { participants: true } },
  lineItems: true,
  payments: true,
  members: true,
} as const;

export async function listGroupOutings(
  userId: string,
  groupId: string
): Promise<ServiceResult<{ outings: OutingSummary[] }>> {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return fail("groupMissing", 404);

  const perms = await getGroupMemberPerms(groupId, userId);
  if (!perms) return fail("notGroupMember", 403);

  const outings = await prisma.outing.findMany({
    where: { groupId },
    orderBy: { createdAt: "desc" },
    include: { participants: { include: { user: { select: { displayName: true, publicId: true } } } } },
  });

  return ok({
    outings: outings.map(o => ({
      id: o.id,
      name: o.name,
      status: o.status,
      date: o.createdAt.toISOString(),
      participantCount: o.participants.length,
      participants: o.participants.map(p => ({
        userId: p.userId,
        displayName: p.user.displayName,
        publicId: p.user.publicId,
      })),
    })),
  });
}

export async function createOuting(
  userId: string,
  input: { groupId?: string; name?: string; description?: string; participantIds?: string[] }
): Promise<ServiceResult<{ outing: OutingSummary }>> {
  const groupId = (input.groupId ?? "").trim();
  const name = (input.name ?? "").trim();
  const description = (input.description ?? "").trim() || undefined;

  if (!groupId) return fail("groupRequired", 400);
  if (!name) return fail("outingNameRequired", 400);

  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return fail("groupMissing", 404);

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!member) return fail("notGroupMember", 403);
  if (member.role !== "OWNER" && !member.canManageOutings) return fail("onlyOwner", 403);

  const outing = await prisma.outing.create({
    data: {
      groupId,
      name,
      description,
      status: "PLANNING",
      createdBy: userId,
      publicToken: generateGroupPublicToken(),
    },
  });

  await prisma.outingParticipant.create({
    data: { outingId: outing.id, userId, role: "OWNER" },
  });

  const participantIds = [...new Set((input.participantIds ?? []).filter(id => id && id !== userId))];
  if (participantIds.length > 0) {
    await prisma.outingParticipant.createMany({
      data: participantIds.map(uid => ({ outingId: outing.id, userId: uid, role: "MEMBER" as const })),
    });
  }

  await logEvent({
    groupId,
    outingId: outing.id,
    actorId: userId,
    eventType: "OUTING_CREATED",
    entityType: "Outing",
    entityId: outing.id,
    metadata: { name },
  });

  const created = await prisma.outing.findUnique({
    where: { id: outing.id },
    include: { participants: { include: { user: { select: { displayName: true, publicId: true } } } } },
  });

  return ok({
    outing: {
      id: outing.id,
      name: outing.name,
      status: outing.status,
      date: outing.createdAt.toISOString(),
      participantCount: created?.participants.length ?? 1,
      participants: (created?.participants ?? []).map(p => ({
        userId: p.userId,
        displayName: p.user.displayName,
        publicId: p.user.publicId,
      })),
    },
  });
}

export type OutingDetail = {
  outing: { id: string; name: string; status: string; date: string; createdAt: string; groupId: string; group: { id: string; name: string } };
  myRole: string;
  canManageOutings: boolean;
  myBalanceCentimes: number;
  totalSpentCentimes: number;
  totalPaidCentimes: number;
  participants: { userId: string; displayName: string; publicId: string; isPayer: boolean; outset: number }[];
  activities: {
    id: string;
    name: string;
    pricingModel: string;
    status: string;
    productsCount: number;
    totalCentimes: number;
    paidCentimes: number;
    myNetCentimes: number;
    paidBy: string | null;
    participantCount: number;
  }[];
};

export async function getOutingDetail(
  userId: string,
  outingId: string
): Promise<ServiceResult<OutingDetail>> {
  const outing = await prisma.outing.findUnique({ where: { id: outingId }, include: { group: true } });
  if (!outing) return fail("outingNotFound", 404);

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId } },
  });
  if (!participant) return fail("notOutingParticipant", 403);

  const groupPerms = await getGroupMemberPerms(outing.groupId, userId);

  const participants = await prisma.outingParticipant.findMany({
    where: { outingId },
    include: { user: { select: { displayName: true, publicId: true } } },
  });

  const activities = await prisma.activity.findMany({
    where: { outingId },
    include: ACTIVITY_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  const balances = computeMemberBalances(
    participants.map(p => ({ userId: p.userId, user: p.user })),
    activities
  );
  const balanceMap = new Map(balances.map(b => [b.userId, b]));

  const payerIds = new Set<string>();
  for (const a of activities) {
    for (const p of a.payments) payerIds.add(p.userId);
  }

  return ok({
    outing: {
      id: outing.id,
      name: outing.name,
      status: outing.status,
      date: outing.createdAt.toISOString(),
      createdAt: outing.createdAt.toISOString(),
      groupId: outing.groupId,
      group: { id: outing.group.id, name: outing.group.name },
    },
    myRole: participant.role,
    canManageOutings: !!groupPerms?.canManageOutings,
    myBalanceCentimes: balanceMap.get(userId)?.netBalance ?? 0,
    totalSpentCentimes: activities.reduce((s, a) => s + activityResponsibility(a as ActivityStatsInput), 0),
    totalPaidCentimes: activities.reduce((s, a) => s + activityPaid(a as ActivityStatsInput), 0),
    participants: participants.map(p => ({
      userId: p.userId,
      displayName: p.user.displayName,
      publicId: p.user.publicId,
      isPayer: payerIds.has(p.userId),
      outset: balanceMap.get(p.userId)?.netBalance ?? 0,
    })),
    activities: activities.map(a => {
      const actBalances = computeMemberBalances(
        participants.map(p => ({ userId: p.userId, user: p.user })),
        [a as ActivityStatsInput]
      );
      const topPayer = [...actBalances].sort((x, y) => y.totalPaid - x.totalPaid)[0];
      return {
        id: a.id,
        name: a.name,
        pricingModel: a.pricingModel,
        status: a.status,
        productsCount: a.products.length,
        totalCentimes: activityResponsibility(a as ActivityStatsInput),
        paidCentimes: activityPaid(a as ActivityStatsInput),
        myNetCentimes: actBalances.find(b => b.userId === userId)?.netBalance ?? 0,
        paidBy: topPayer && topPayer.totalPaid > 0 ? topPayer.displayName : null,
        participantCount: a.members.length,
      };
    }),
  });
}

export async function activateOuting(
  userId: string,
  outingId: string
): Promise<ServiceResult<{ success: true; outing: { id: string; name: string; status: string; date: string } }>> {
  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing) return fail("outingNotFound", 404);

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId } },
  });
  if (!participant || participant.role !== "OWNER") return fail("onlyOwner", 403);
  if (outing.status !== "PLANNING") return fail("notPlanning", 409);

  const updated = await prisma.outing.update({
    where: { id: outingId },
    data: { status: "ACTIVE" },
  });

  await logEvent({
    groupId: outing.groupId,
    outingId,
    actorId: userId,
    eventType: "OUTING_ACTIVATED",
    entityType: "Outing",
    entityId: outingId,
  });

  return ok({
    success: true,
    outing: {
      id: updated.id,
      name: updated.name,
      status: updated.status,
      date: updated.createdAt.toISOString(),
    },
  });
}

export async function leaveOuting(
  userId: string,
  outingId: string
): Promise<ServiceResult<{ success: true; removed: boolean; hadFinancialData?: boolean }>> {
  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId } },
  });
  if (!participant) return fail("notOutingParticipant", 403);
  if (participant.role === "OWNER") return fail("ownerCantLeave", 403);

  const hasActivityPayments = await prisma.activityPayment.findFirst({
    where: { activity: { outingId }, userId },
  });
  const hasLineItems = await prisma.lineItem.findFirst({
    where: { activity: { outingId }, userId },
  });
  const hasUsageRecords = await prisma.usageRecord.findFirst({
    where: { activity: { outingId }, createdById: userId },
  });

  const hasFinancialData = !!(hasActivityPayments || hasLineItems || hasUsageRecords);

  await prisma.outingParticipant.delete({
    where: { outingId_userId: { outingId, userId } },
  });

  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (outing && hasFinancialData) {
    await logEvent({
      groupId: outing.groupId,
      outingId,
      actorId: userId,
      eventType: "OUTING_MEMBER_LEFT",
      entityType: "User",
      entityId: userId,
    });
  }

  return ok({ success: true, removed: true, hadFinancialData: hasFinancialData || undefined });
}

export async function checkoutOuting(
  userId: string,
  outingId: string
): Promise<ServiceResult<{ success: true }>> {
  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing) return fail("outingNotFound", 404);

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId } },
  });
  if (!participant) return fail("notOutingParticipant", 403);

  return ok({ success: true });
}

export async function inviteOutingParticipant(
  userId: string,
  outingId: string,
  publicId: string
): Promise<ServiceResult<{ success: true; invited: "participant" | "outsider" }>> {
  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing) return fail("outingNotFound", 404);

  const inviter = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId } },
  });
  if (!inviter || inviter.role !== "OWNER") return fail("onlyOutingOwnerInvite", 403);

  const invitee = await prisma.user.findUnique({ where: { publicId } });
  if (!invitee) return fail("userMissing", 404);

  const existingParticipant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId: invitee.id } },
  });
  if (existingParticipant) return fail("alreadyParticipant", 409);

  const groupMember = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: outing.groupId, userId: invitee.id } },
  });

  if (groupMember) {
    await prisma.outingParticipant.create({
      data: { outingId, userId: invitee.id, role: "MEMBER" },
    });

    await logEvent({
      groupId: outing.groupId,
      outingId,
      actorId: userId,
      eventType: "OUTING_MEMBER_INVITED",
      entityType: "OutingParticipant",
      entityId: invitee.id,
    });

    return ok({ success: true, invited: "participant" });
  }

  const existingInvite = await prisma.outingInvitation.findUnique({
    where: { outingId_inviteeUserId: { outingId, inviteeUserId: invitee.id } },
  });
  if (existingInvite) return fail("alreadyInvited", 409);

  const invite = await prisma.outingInvitation.create({
    data: {
      outingId,
      inviterId: userId,
      inviteeUserId: invitee.id,
      status: "PENDING",
    },
  });

  await logEvent({
    groupId: outing.groupId,
    outingId,
    actorId: userId,
    eventType: "OUTING_OUTSIDER_INVITED",
    entityType: "OutingInvitation",
    entityId: invite.id,
    metadata: { invitee: publicId },
  });

  return ok({ success: true, invited: "outsider" });
}
