import { prisma } from "@/lib/prisma";
import { logEvent } from "@/server/audit";
import { fail, ok, type ServiceResult } from "./types";

export type UsageRecordPayload = {
  id: string;
  activityId: string;
  productId: string;
  quantity: number;
  totalCentimes: number;
  status: string;
  participantIds: string[];
};

const USAGE_STATUSES = ["PENDING", "CONFIRMED", "DISPUTED"];

function serializeUsageRecord(record: {
  id: string;
  activityId: string;
  productId: string;
  quantity: number;
  totalCentimes: number;
  status: string;
  participants: { userId: string }[];
}): UsageRecordPayload {
  return {
    id: record.id,
    activityId: record.activityId,
    productId: record.productId,
    quantity: record.quantity,
    totalCentimes: record.totalCentimes,
    status: record.status,
    participantIds: record.participants.map(p => p.userId),
  };
}

export async function createUsageRecord(
  userId: string,
  input: { activityId?: string; productId?: string; quantity?: number; participantIds?: string[] }
): Promise<ServiceResult<{ usageRecord: UsageRecordPayload; merged: boolean }>> {
  const activityId = (input.activityId ?? "").trim();
  const productId = (input.productId ?? "").trim();

  if (!activityId) return fail("activityRequired", 400);
  if (!productId) return fail("productRequired", 400);

  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) return fail("activityNotFound", 404);
  if (activity.pricingModel !== "FIXED") return fail("fixedOnly", 400);
  if (activity.status !== "OPEN") return fail("activityNotOpen", 409);
  if (!activity.outingId) return fail("outingNotFound", 404);

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
  if (!outing) return fail("outingNotFound", 404);

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId, userId } },
  });
  if (!participant || participant.role !== "OWNER") return fail("onlyOwner", 403);

  const product = await prisma.activityProduct.findUnique({ where: { id: productId } });
  if (!product || product.activityId !== activityId) return fail("productNotInActivity", 400);

  const quantity = input.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1) return fail("quantityMin", 400);

  const participantIds = [...new Set((input.participantIds ?? []).map(id => id.trim()).filter(Boolean))];
  if (participantIds.length === 0) return fail("selectParticipants", 400);

  const totalCentimes = product.pricePerUnitCt * quantity;

  const participantKey = (ids: string[]) => [...new Set(ids)].sort().join("|");
  const existingPending = await prisma.usageRecord.findMany({
    where: { activityId, productId, status: "PENDING" },
    include: { participants: { select: { userId: true } } },
  });
  const mergeTarget = existingPending.find(
    r => participantKey(r.participants.map(p => p.userId)) === participantKey(participantIds)
  );

  if (mergeTarget) {
    const updated = await prisma.usageRecord.update({
      where: { id: mergeTarget.id },
      data: {
        quantity: mergeTarget.quantity + quantity,
        totalCentimes: mergeTarget.totalCentimes + totalCentimes,
      },
      include: { participants: true },
    });

    await logEvent({
      groupId: outing.groupId,
      outingId: activity.outingId,
      actorId: userId,
      eventType: "USAGE_RECORD_CREATED",
      entityType: "UsageRecord",
      entityId: mergeTarget.id,
      metadata: { product: product.name, quantity, totalCentimes, participants: participantIds.length, merged: true },
    });

    return ok({ usageRecord: serializeUsageRecord(updated), merged: true });
  }

  const usageRecord = await prisma.usageRecord.create({
    data: {
      activityId,
      productId,
      quantity,
      totalCentimes,
      createdById: userId,
      status: "PENDING",
    },
  });

  for (const uid of participantIds) {
    await prisma.usageParticipant.create({
      data: { usageRecordId: usageRecord.id, userId: uid },
    });
    await prisma.usageConfirmation.create({
      data: { usageRecordId: usageRecord.id, userId: uid, status: "PENDING" },
    });
  }

  await logEvent({
    groupId: outing.groupId,
    outingId: activity.outingId,
    actorId: userId,
    eventType: "USAGE_RECORD_CREATED",
    entityType: "UsageRecord",
    entityId: usageRecord.id,
    metadata: { product: product.name, quantity, totalCentimes, participants: participantIds.length },
  });

  const created = await prisma.usageRecord.findUnique({
    where: { id: usageRecord.id },
    include: { participants: true },
  });

  return ok({ usageRecord: serializeUsageRecord(created ?? { ...usageRecord, participants: [] }), merged: false });
}

type UsageRecordRow = NonNullable<Awaited<ReturnType<typeof prisma.usageRecord.findUnique>>>;
type ActivityRow = NonNullable<Awaited<ReturnType<typeof prisma.activity.findUnique>>>;
type OutingRow = NonNullable<Awaited<ReturnType<typeof prisma.outing.findUnique>>>;

async function loadUsageContext(
  usageRecordId: string
): Promise<{ error: ServiceResult<never> } | { record: UsageRecordRow; activity: ActivityRow; outing: OutingRow }> {
  const record = await prisma.usageRecord.findUnique({ where: { id: usageRecordId } });
  if (!record) return { error: fail("notFound", 404) };

  const activity = await prisma.activity.findUnique({ where: { id: record.activityId } });
  if (!activity) return { error: fail("activityNotFound", 404) };
  if (!activity.outingId) return { error: fail("outingNotFound", 404) };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
  if (!outing) return { error: fail("outingNotFound", 404) };

  return { record, activity, outing };
}

export async function updateUsageRecord(
  userId: string,
  usageRecordId: string,
  input: { quantity?: number; productId?: string; participantIds?: string[]; status?: string }
): Promise<ServiceResult<{ success: true }>> {
  const ctx = await loadUsageContext(usageRecordId);
  if ("error" in ctx) return ctx.error;
  if (ctx.outing.status === "SETTLED") return fail("outingSettledLocked", 409);

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: ctx.activity.outingId!, userId } },
  });
  if (!participant || participant.role !== "OWNER") return fail("onlyOwner", 403);

  const updateData: { quantity?: number; productId?: string; totalCentimes?: number; status?: string } = {};
  let product = await prisma.activityProduct.findUnique({ where: { id: ctx.record.productId } });

  if (input.productId && input.productId !== ctx.record.productId) {
    const newProduct = await prisma.activityProduct.findUnique({ where: { id: input.productId } });
    if (!newProduct || newProduct.activityId !== ctx.record.activityId) return fail("productMissing", 404);
    updateData.productId = input.productId;
    product = newProduct;
  }

  if (input.quantity !== undefined) {
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) return fail("quantityMin", 400);
    updateData.quantity = input.quantity;
  }

  if (input.status !== undefined) {
    if (!USAGE_STATUSES.includes(input.status)) return fail("invalidInput", 400);
    updateData.status = input.status;
  }

  let replaceParticipants = false;
  let participantIds: string[] = [];
  if (input.participantIds !== undefined) {
    participantIds = [...new Set(input.participantIds.map(id => id.trim()).filter(Boolean))];
    if (participantIds.length === 0) return fail("selectParticipants", 400);
    replaceParticipants = true;
  }

  if (updateData.quantity !== undefined || updateData.productId !== undefined) {
    const qty = updateData.quantity ?? ctx.record.quantity;
    const price = product!.pricePerUnitCt;
    updateData.totalCentimes = price * qty;
  }

  await prisma.$transaction(async tx => {
    if (replaceParticipants) {
      await tx.usageParticipant.deleteMany({ where: { usageRecordId } });
      await tx.usageConfirmation.deleteMany({ where: { usageRecordId } });
      for (const uid of participantIds) {
        await tx.usageParticipant.create({ data: { usageRecordId, userId: uid } });
        await tx.usageConfirmation.create({ data: { usageRecordId, userId: uid, status: "PENDING" } });
      }
      updateData.status = "PENDING";
    }

    await tx.usageRecord.update({ where: { id: usageRecordId }, data: updateData });

    if (!replaceParticipants) {
      await tx.usageConfirmation.updateMany({
        where: { usageRecordId },
        data: { status: "PENDING" },
      });
    }
  });

  return ok({ success: true });
}

export async function deleteUsageRecord(
  userId: string,
  usageRecordId: string
): Promise<ServiceResult<{ success: true }>> {
  const ctx = await loadUsageContext(usageRecordId);
  if ("error" in ctx) return ctx.error;
  if (ctx.outing.status === "SETTLED") return fail("outingSettledLocked", 409);

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: ctx.activity.outingId!, userId } },
  });
  if (!participant || participant.role !== "OWNER") return fail("onlyOwner", 403);

  await prisma.usageRecord.delete({ where: { id: usageRecordId } });
  return ok({ success: true });
}

export async function confirmUsageRecord(
  userId: string,
  usageRecordId: string,
  targetUserId?: string
): Promise<ServiceResult<{ success: true }>> {
  const record = await prisma.usageRecord.findUnique({ where: { id: usageRecordId } });
  if (!record) return fail("notFound", 404);

  if (targetUserId) {
    const activity = await prisma.activity.findUnique({ where: { id: record.activityId } });
    if (!activity || !activity.outingId) return fail("activityNotFound", 404);

    const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
    if (!outing) return fail("outingNotFound", 404);

    const caller = await prisma.outingParticipant.findUnique({
      where: { outingId_userId: { outingId: activity.outingId, userId } },
    });
    if (!caller || caller.role !== "OWNER") return fail("onlyOwner", 403);

    const confirmation = await prisma.usageConfirmation.findUnique({
      where: { usageRecordId_userId: { usageRecordId, userId: targetUserId } },
    });
    if (!confirmation) return fail("targetNotParticipant", 404);
    if (confirmation.status !== "PENDING") return fail("alreadyDecided", 409);

    await prisma.usageConfirmation.update({
      where: { id: confirmation.id },
      data: { status: "ADMIN_CONFIRMED" },
    });

    const allConfirmations = await prisma.usageConfirmation.findMany({ where: { usageRecordId } });
    const allResolved = allConfirmations.every(c => c.status === "CONFIRMED" || c.status === "ADMIN_CONFIRMED");
    if (allResolved) {
      await prisma.usageRecord.update({ where: { id: usageRecordId }, data: { status: "CONFIRMED" } });
    }

    return ok({ success: true });
  }

  const confirmation = await prisma.usageConfirmation.findUnique({
    where: { usageRecordId_userId: { usageRecordId, userId } },
  });
  if (!confirmation) return fail("notUsageParticipant", 403);
  if (confirmation.status !== "PENDING") return fail("alreadyDecided", 409);

  await prisma.usageConfirmation.update({
    where: { id: confirmation.id },
    data: { status: "CONFIRMED" },
  });

  const allConfirmations = await prisma.usageConfirmation.findMany({ where: { usageRecordId } });
  const allConfirmed = allConfirmations.every(c => c.status === "CONFIRMED" || c.status === "ADMIN_CONFIRMED");
  if (allConfirmed) {
    await prisma.usageRecord.update({ where: { id: usageRecordId }, data: { status: "CONFIRMED" } });
  }

  return ok({ success: true });
}

export async function disputeUsageRecord(
  userId: string,
  usageRecordId: string,
  notes: string
): Promise<ServiceResult<{ success: true }>> {
  const record = await prisma.usageRecord.findUnique({ where: { id: usageRecordId } });
  if (!record) return fail("notFound", 404);

  const confirmation = await prisma.usageConfirmation.findUnique({
    where: { usageRecordId_userId: { usageRecordId, userId } },
  });
  if (!confirmation) return fail("notUsageParticipant", 403);

  await prisma.$transaction(async tx => {
    await tx.usageConfirmation.update({
      where: { id: confirmation.id },
      data: { status: "DISPUTED", notes },
    });
    await tx.usageRecord.update({
      where: { id: usageRecordId },
      data: { status: "DISPUTED" },
    });
  });

  return ok({ success: true });
}

export async function resolveUsageDispute(
  userId: string,
  usageRecordId: string,
  newQuantity: number
): Promise<ServiceResult<{ success: true }>> {
  const ctx = await loadUsageContext(usageRecordId);
  if ("error" in ctx) return ctx.error;
  if (ctx.record.status !== "DISPUTED") return fail("notDisputed", 409);

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: ctx.activity.outingId!, userId } },
  });
  if (!caller || caller.role !== "OWNER") return fail("onlyOwner", 403);

  if (!Number.isSafeInteger(newQuantity) || newQuantity < 1) return fail("quantityMin", 400);

  const product = await prisma.activityProduct.findUnique({ where: { id: ctx.record.productId } });
  if (!product) return fail("productMissing", 404);

  const newTotal = product.pricePerUnitCt * newQuantity;

  await prisma.$transaction(async tx => {
    await tx.usageRecord.update({
      where: { id: usageRecordId },
      data: { quantity: newQuantity, totalCentimes: newTotal, status: "PENDING" },
    });
    await tx.usageConfirmation.updateMany({
      where: { usageRecordId },
      data: { status: "PENDING", notes: null },
    });
  });

  return ok({ success: true });
}
