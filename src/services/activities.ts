import { prisma } from "@/lib/prisma";
import { logEvent } from "@/server/audit";
import { getGroupMemberPerms } from "@/server/groups/permissions";
import { formatDH } from "@/lib/utils";
import { activityResponsibility, type ActivityStatsInput } from "./stats";
import { fail, ok, type ServiceResult } from "./types";

export type ActivityPayload = {
  id: string;
  name: string;
  pricingModel: string;
  status: string;
  outingId: string | null;
};

export async function createActivity(
  userId: string,
  input: {
    outingId?: string;
    name?: string;
    pricingModel?: string;
    notes?: string;
    participantIds?: string[];
    templateId?: string;
  }
): Promise<ServiceResult<{ activity: ActivityPayload }>> {
  const outingId = (input.outingId ?? "").trim();
  const name = (input.name ?? "").trim();
  const pricingModel = input.pricingModel ?? "FIXED";
  const notes = (input.notes ?? "").trim() || undefined;
  const templateId = (input.templateId ?? "").trim();

  if (!outingId) return fail("outingRequired", 400);
  if (!name) return fail("activityNameRequired", 400);
  if (pricingModel !== "FIXED" && pricingModel !== "VARIABLE") return fail("pricingModel", 400);

  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing) return fail("outingNotFound", 404);
  if (outing.status === "SETTLED") return fail("outingSettledShort", 409);

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId } },
  });
  if (!participant || participant.role !== "OWNER") return fail("onlyOwner", 403);

  let templateProducts: { name: string; unit: string; pricePerUnitCt: number }[] = [];
  if (templateId) {
    const template = await prisma.activityTemplate.findUnique({
      where: { id: templateId },
      include: { products: true },
    });
    if (!template) return fail("templateMissing", 404);
    if (template.userId !== userId) return fail("templateNotOwner", 403);
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: outing.groupId, userId } },
    });
    if (!member || (member.role !== "OWNER" && !member.canUseTemplates)) {
      return fail("groupAdminOnlyTemplates", 403);
    }
    templateProducts = template.products.map(p => ({
      name: p.name,
      unit: p.unit,
      pricePerUnitCt: p.pricePerUnitCt,
    }));
  }

  const activity = await prisma.activity.create({
    data: { outingId, name, pricingModel, notes, createdBy: userId },
  });
  const activityId = activity.id;

  await prisma.activityParticipant.create({
    data: { activityId, userId, role: "OWNER" },
  });

  const invitedIds = [...new Set((input.participantIds ?? []).filter(uid => uid && uid !== userId))];
  for (const uid of invitedIds) {
    const existing = await prisma.activityParticipant.findUnique({
      where: { activityId_userId: { activityId, userId: uid } },
    });
    if (existing) continue;
    const existingInvite = await prisma.activityInvitation.findUnique({
      where: { activityId_inviteeUserId: { activityId, inviteeUserId: uid } },
    });
    if (existingInvite) continue;
    await prisma.activityInvitation.create({
      data: { activityId, inviterId: userId, inviteeUserId: uid, status: "PENDING" },
    });
  }

  if (templateProducts.length > 0) {
    await prisma.activityProduct.createMany({
      data: templateProducts.map(p => ({ activityId, ...p })),
    });
  }

  await logEvent({
    groupId: outing.groupId,
    outingId,
    actorId: userId,
    eventType: "ACTIVITY_CREATED",
    entityType: "Activity",
    entityId: activity.id,
    metadata: { name, pricingModel, fromTemplate: templateProducts.length > 0 },
  });

  return ok({
    activity: {
      id: activity.id,
      name: activity.name,
      pricingModel: activity.pricingModel,
      status: activity.status,
      outingId: activity.outingId,
    },
  });
}

export type ActivityDetail = {
  activity: { id: string; name: string; pricingModel: string; status: string };
  canEdit: boolean;
  canRecordPayments: boolean;
  canUseTemplates: boolean;
  participants: { userId: string; displayName: string; publicId: string }[];
  products: { id: string; name: string; priceCentimes: number; quantity: number; usageCount: number }[];
  usageRecords: { id: string; productId: string; status: string; quantity: number; totalCentimes: number; participantIds: string[] }[];
  payments: { id: string; userId: string; displayName: string; amountCentimes: number }[];
  lineItems: { id: string; userId: string; displayName: string; description: string; priceCentimes: number }[];
};

export async function getActivityDetail(
  userId: string,
  activityId: string
): Promise<ServiceResult<ActivityDetail>> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: {
      products: true,
      usageRecords: { include: { participants: true } },
      lineItems: { include: { user: { select: { displayName: true, publicId: true } } } },
      payments: { include: { user: { select: { displayName: true, publicId: true } } } },
      members: { include: { user: { select: { displayName: true, publicId: true } } } },
    },
  });
  if (!activity || !activity.outingId) return fail("activityNotFound", 404);

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId, userId } },
  });
  if (!participant) return fail("notOutingParticipant", 403);

  const groupPerms = await getGroupMemberPerms(
    (await prisma.outing.findUnique({ where: { id: activity.outingId }, select: { groupId: true } }))?.groupId ?? "",
    userId
  );

  const isOwner = participant.role === "OWNER";
  const isOpen = activity.status === "OPEN";
  const canEdit = isOwner && isOpen;
  const canRecordPayments = canEdit || (!!groupPerms?.canRecordPayments && isOpen);

  const usageByProduct = new Map<string, { quantity: number; count: number }>();
  for (const r of activity.usageRecords) {
    const entry = usageByProduct.get(r.productId) ?? { quantity: 0, count: 0 };
    entry.quantity += r.quantity;
    entry.count += 1;
    usageByProduct.set(r.productId, entry);
  }

  return ok({
    activity: {
      id: activity.id,
      name: activity.name,
      pricingModel: activity.pricingModel,
      status: activity.status,
    },
    canEdit,
    canRecordPayments,
    canUseTemplates: !!groupPerms?.canUseTemplates,
    participants: activity.members.map(m => ({
      userId: m.userId,
      displayName: m.user.displayName,
      publicId: m.user.publicId,
    })),
    products: activity.products.map(p => ({
      id: p.id,
      name: p.name,
      priceCentimes: p.pricePerUnitCt,
      quantity: usageByProduct.get(p.id)?.quantity ?? 0,
      usageCount: usageByProduct.get(p.id)?.count ?? 0,
    })),
    usageRecords: activity.usageRecords.map(r => ({
      id: r.id,
      productId: r.productId,
      status: r.status,
      quantity: r.quantity,
      totalCentimes: r.totalCentimes,
      participantIds: r.participants.map(p => p.userId),
    })),
    payments: activity.payments.map(p => ({
      id: p.id,
      userId: p.userId,
      displayName: p.user.displayName,
      amountCentimes: p.amountCentimes,
    })),
    lineItems: activity.lineItems.map(l => ({
      id: l.id,
      userId: l.userId,
      displayName: l.user.displayName,
      description: l.description,
      priceCentimes: l.priceCentimes,
    })),
  });
}

export async function closeActivity(
  userId: string,
  activityId: string
): Promise<ServiceResult<{ success: true }>> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: {
      products: true,
      usageRecords: { include: { participants: true, confirmations: true, product: true } },
      lineItems: true,
      payments: true,
    },
  });
  if (!activity) return fail("activityNotFound", 404);
  if (activity.status !== "OPEN") return fail("activityNotOpen", 409);
  if (!activity.outingId) return fail("outingNotFound", 404);

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
  if (!outing) return fail("outingNotFound", 404);

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId, userId } },
  });
  if (!participant || participant.role !== "OWNER") return fail("onlyOwner", 403);

  const errors: string[] = [];

  if (activity.pricingModel === "FIXED") {
    for (const record of activity.usageRecords) {
      const label = `"${record.quantity} × ${record.product?.name ?? "item"}"`;
      if (record.status === "DISPUTED") errors.push(`${label} is disputed — resolve it before closing.`);
      const pending = record.confirmations.filter(c => c.status === "PENDING");
      if (pending.length > 0) {
        errors.push(`${label} still needs confirmation from ${pending.length} ${pending.length === 1 ? "person" : "people"}.`);
      }
    }
  } else {
    if (activity.lineItems.length === 0) errors.push("No variable data recorded.");
  }

  const totalPaid = activity.payments.reduce((sum, p) => sum + p.amountCentimes, 0);
  const totalResponsibility = activityResponsibility(activity as ActivityStatsInput);

  const pendingInvites = await prisma.activityInvitation.findMany({
    where: { activityId, status: "PENDING" },
  });
  if (pendingInvites.length > 0) {
    await prisma.activityInvitation.updateMany({
      where: { activityId, status: "PENDING" },
      data: { status: "DECLINED" },
    });
    errors.push(`${pendingInvites.length} pending ${pendingInvites.length === 1 ? "invitation" : "invitations"} auto-declined at closure.`);
  }

  if (totalPaid !== totalResponsibility && totalResponsibility > 0) {
    errors.push(`${formatDH(Math.abs(totalResponsibility - totalPaid))} of payments missing.`);
  }

  if (errors.length > 0) return fail(`Cannot close activity:\n${errors.join("\n")}`, 400);

  await prisma.$transaction(async tx => {
    await tx.activity.update({ where: { id: activityId }, data: { status: "CLOSED", endTime: new Date() } });
    await tx.activityInvitation.updateMany({ where: { activityId, status: "PENDING" }, data: { status: "DECLINED" } });
  });

  await logEvent({
    groupId: outing.groupId,
    outingId: activity.outingId,
    actorId: userId,
    eventType: "ACTIVITY_CLOSED",
    entityType: "Activity",
    entityId: activityId,
  });

  return ok({ success: true });
}

export async function batchConfirmActivity(
  userId: string,
  activityId: string
): Promise<ServiceResult<{ success: true }>> {
  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) return fail("activityNotFound", 404);
  if (!activity.outingId) return fail("outingNotFound", 404);

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
  if (!outing) return fail("outingNotFound", 404);

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId, userId } },
  });
  if (!caller || caller.role !== "OWNER") return fail("onlyOwner", 403);

  await prisma.$transaction(async tx => {
    const records = await tx.usageRecord.findMany({
      where: { activityId, status: "PENDING" },
      include: { confirmations: { where: { status: "PENDING" } } },
    });

    for (const record of records) {
      if (record.confirmations.length === 0) {
        await tx.usageRecord.update({ where: { id: record.id }, data: { status: "CONFIRMED" } });
        continue;
      }
      await tx.usageConfirmation.updateMany({
        where: { usageRecordId: record.id, status: "PENDING" },
        data: { status: "ADMIN_CONFIRMED" },
      });
      const remaining = await tx.usageConfirmation.count({
        where: { usageRecordId: record.id, status: "PENDING" },
      });
      if (remaining === 0) {
        await tx.usageRecord.update({ where: { id: record.id }, data: { status: "CONFIRMED" } });
      }
    }
  });

  return ok({ success: true });
}
