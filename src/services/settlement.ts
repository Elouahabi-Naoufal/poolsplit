import { prisma } from "@/lib/prisma";
import { calculateSettlement } from "@/domain/settlement";
import { generatePublicToken } from "@/lib/utils";
import { logEvent } from "@/server/audit";
import { userError } from "@/lib/errors";
import { computeMemberBalances, type ActivityStatsInput } from "./stats";
import { fail, ok, type ServiceResult } from "./types";

export type SettlementPayload = {
  id: string;
  outingId: string | null;
  totalExpenses: number;
  totalPaid: number;
  totalContributions: number;
  createdAt: string;
  updatedAt: string;
};

function serializeSettlement(settlement: {
  id: string;
  outingId: string | null;
  totalExpenses: number;
  totalPaid: number;
  totalContributions: number;
  createdAt: Date;
  updatedAt: Date;
}): SettlementPayload {
  return {
    id: settlement.id,
    outingId: settlement.outingId,
    totalExpenses: settlement.totalExpenses,
    totalPaid: settlement.totalPaid,
    totalContributions: settlement.totalContributions,
    createdAt: settlement.createdAt.toISOString(),
    updatedAt: settlement.updatedAt.toISOString(),
  };
}

export async function generateSettlement(outingId: string): Promise<SettlementPayload> {
  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing) throw new Error("Outing not found");

  const participants = await prisma.outingParticipant.findMany({ where: { outingId } });
  const users = await prisma.user.findMany({
    where: { id: { in: participants.map(p => p.userId) } },
  });
  const userMap = new Map(users.map(u => [u.id, u.displayName]));

  const members = participants.map(p => ({
    userId: p.userId,
    displayName: userMap.get(p.userId),
  }));

  const activities = await prisma.activity.findMany({
    where: { outingId },
    include: {
      usageRecords: { include: { participants: true } },
      lineItems: true,
      payments: true,
    },
  });

  const activityInputs = activities.map(a => ({
    id: a.id,
    name: a.name,
    pricingModel: a.pricingModel as "FIXED" | "VARIABLE",
    status: a.status,
    usageRecords: a.usageRecords.map(r => ({
      id: r.id,
      totalCentimes: r.totalCentimes,
      status: r.status,
      participantIds: r.participants.map(p => p.userId),
    })),
    lineItems: a.lineItems.map(l => ({ userId: l.userId, priceCentimes: l.priceCentimes })),
    payments: a.payments.map(p => ({ userId: p.userId, amountCentimes: p.amountCentimes })),
  }));

  const result = calculateSettlement({ members, activities: activityInputs });

  const existing = await prisma.settlement.findFirst({ where: { outingId } });
  const publicToken = existing?.publicToken || generatePublicToken();

  const settlement = await prisma.settlement.upsert({
    where: { outingId },
    update: {
      totalExpenses: result.totalExpenses,
      totalPaid: result.totalPaid,
      publicToken,
    },
    create: {
      outingId,
      totalExpenses: result.totalExpenses,
      totalPaid: result.totalPaid,
      publicToken,
    },
  });

  await prisma.settlementTransfer.deleteMany({ where: { settlementId: settlement.id } });
  for (const t of result.transfers) {
    await prisma.settlementTransfer.create({
      data: {
        settlementId: settlement.id,
        fromUserId: t.fromUserId,
        toUserId: t.toUserId,
        amountCentimes: t.amountCentimes,
        status: "PENDING",
      },
    });
  }

  await prisma.outing.update({ where: { id: outingId }, data: { status: "SETTLED" } });

  await logEvent({
    groupId: outing.groupId,
    outingId,
    eventType: "SETTLEMENT_GENERATED",
    entityType: "Settlement",
    entityId: settlement.id,
    metadata: JSON.stringify({
      totalExpenses: result.totalExpenses,
      transfers: result.transfers.length,
      isComplete: result.isComplete,
    }),
  });

  return serializeSettlement(settlement);
}

export async function finalizeSettlement(
  userId: string,
  outingId: string
): Promise<ServiceResult<{ settlement: SettlementPayload }>> {
  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing) return fail("outingNotFound", 404);

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId } },
  });
  if (!participant || participant.role !== "OWNER") return fail("onlyOwnerFinalize", 403);
  if (outing.status === "SETTLED") return fail("alreadySettled", 409);

  try {
    const settlement = await generateSettlement(outingId);
    return ok({ settlement });
  } catch (e: unknown) {
    return fail(userError(e, "Could not generate the settlement. Please try again."), 500);
  }
}

export async function recalculateSettlement(
  userId: string,
  outingId: string
): Promise<ServiceResult<{ settlement: SettlementPayload }>> {
  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing) return fail("outingNotFound", 404);

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId } },
  });
  if (!participant || participant.role !== "OWNER") return fail("onlyOwner", 403);

  try {
    const settlement = await generateSettlement(outingId);
    return ok({ settlement });
  } catch (e: unknown) {
    return fail(userError(e, "Could not recalculate the settlement. Please try again."), 500);
  }
}

export type TransferPayload = {
  id: string;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amountCentimes: number;
  status: string;
};

export type SettlementBreakdown = {
  transfers: TransferPayload[];
  balances: { userId: string; displayName: string; totalPaid: number; totalResponsibility: number; netBalance: number }[];
};

export async function getSettlement(
  userId: string,
  outingId: string
): Promise<ServiceResult<{ settlement: SettlementBreakdown }>> {
  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing) return fail("outingNotFound", 404);

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId } },
  });
  if (!participant) return fail("notOutingParticipant", 403);

  const allParticipants = await prisma.outingParticipant.findMany({
    where: { outingId },
    include: { user: { select: { displayName: true } } },
  });
  const userMap = new Map(allParticipants.map(p => [p.userId, p.user.displayName]));

  const activities = await prisma.activity.findMany({
    where: { outingId },
    include: {
      usageRecords: { include: { participants: true } },
      lineItems: true,
      payments: true,
    },
  });

  const balances = computeMemberBalances(
    allParticipants.map(p => ({ userId: p.userId, user: p.user })),
    activities as ActivityStatsInput[]
  );

  const persisted = await prisma.settlement.findFirst({
    where: { outingId },
    include: { transfers: true },
  });

  let transfers: TransferPayload[];
  if (persisted) {
    transfers = persisted.transfers.map(t => ({
      id: t.id,
      fromUserId: t.fromUserId,
      fromName: userMap.get(t.fromUserId) ?? t.fromUserId,
      toUserId: t.toUserId,
      toName: userMap.get(t.toUserId) ?? t.toUserId,
      amountCentimes: t.amountCentimes,
      status: t.status,
    }));
  } else {
    const result = calculateSettlement({
      members: allParticipants.map(p => ({ userId: p.userId, displayName: p.user.displayName })),
      activities: activities.map(a => ({
        id: a.id,
        name: a.name,
        pricingModel: a.pricingModel as "FIXED" | "VARIABLE",
        status: a.status,
        usageRecords: a.usageRecords.map(r => ({
          id: r.id,
          totalCentimes: r.totalCentimes,
          status: r.status,
          participantIds: r.participants.map(p => p.userId),
        })),
        lineItems: a.lineItems.map(l => ({ userId: l.userId, priceCentimes: l.priceCentimes })),
        payments: a.payments.map(p => ({ userId: p.userId, amountCentimes: p.amountCentimes })),
      })),
    });
    transfers = result.transfers.map((t, index) => ({
      id: `computed-${index}`,
      fromUserId: t.fromUserId,
      fromName: userMap.get(t.fromUserId) ?? t.fromUserId,
      toUserId: t.toUserId,
      toName: userMap.get(t.toUserId) ?? t.toUserId,
      amountCentimes: t.amountCentimes,
      status: "PENDING",
    }));
  }

  return ok({ settlement: { transfers, balances } });
}

export async function markTransferPaid(
  userId: string,
  transferId: string
): Promise<ServiceResult<{ success: true }>> {
  const transfer = await prisma.settlementTransfer.findUnique({ where: { id: transferId } });
  if (!transfer) return fail("notFound", 404);
  if (transfer.fromUserId !== userId) return fail("payerMismatch", 403);

  await prisma.settlementTransfer.update({
    where: { id: transferId },
    data: { status: "PAID", paidAt: new Date() },
  });

  const settlement = await prisma.settlement.findUnique({ where: { id: transfer.settlementId } });
  if (settlement?.outingId) {
    const outing = await prisma.outing.findUnique({ where: { id: settlement.outingId } });
    if (outing) {
      await logEvent({
        groupId: outing.groupId,
        outingId: settlement.outingId,
        actorId: userId,
        eventType: "TRANSFER_PAID",
        entityId: transferId,
      });
    }
  }

  return ok({ success: true });
}

export async function confirmTransferReceived(
  userId: string,
  transferId: string
): Promise<ServiceResult<{ success: true }>> {
  const transfer = await prisma.settlementTransfer.findUnique({ where: { id: transferId } });
  if (!transfer) return fail("notFound", 404);
  if (transfer.toUserId !== userId) return fail("receiverMismatch", 403);

  await prisma.settlementTransfer.update({
    where: { id: transferId },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });

  const settlement = await prisma.settlement.findUnique({ where: { id: transfer.settlementId } });
  if (settlement?.outingId) {
    const outing = await prisma.outing.findUnique({ where: { id: settlement.outingId } });
    if (outing) {
      await logEvent({
        groupId: outing.groupId,
        outingId: settlement.outingId,
        actorId: userId,
        eventType: "TRANSFER_CONFIRMED",
        entityId: transferId,
      });
    }
  }

  return ok({ success: true });
}
