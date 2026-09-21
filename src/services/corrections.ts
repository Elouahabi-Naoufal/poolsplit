import { prisma } from "@/lib/prisma";
import { logEvent } from "@/server/audit";
import { fail, ok, type ServiceResult } from "./types";

export async function requestUsageCorrection(
  userId: string,
  usageRecordId: string,
  input: {
    reason?: string;
    newQuantity?: number;
    entityType?: string;
    entityId?: string;
    field?: string;
    oldValue?: string;
    newValue?: string;
  }
): Promise<ServiceResult<{ success: true; id: string }>> {
  const record = await prisma.usageRecord.findUnique({ where: { id: usageRecordId } });
  if (!record) return fail("notFound", 404);

  const activity = await prisma.activity.findUnique({ where: { id: record.activityId } });
  if (!activity) return fail("activityNotFound", 404);
  if (!activity.outingId) return fail("outingNotFound", 404);

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
  if (!outing) return fail("outingNotFound", 404);
  if (outing.status !== "SETTLED") return fail("settledRequired", 409);

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId, userId } },
  });
  if (!participant) return fail("notOutingParticipant", 403);

  const entityType = input.entityType ?? "UsageRecord";
  const entityId = input.entityId ?? usageRecordId;
  const field = input.field ?? "quantity";
  const oldValue = input.oldValue ?? String(record.quantity);
  const newValue =
    input.newValue ?? String(input.newQuantity !== undefined ? input.newQuantity : record.quantity);

  if (entityType === "LineItem") {
    const item = await prisma.lineItem.findUnique({ where: { id: entityId } });
    if (!item || item.userId !== userId) return fail("ownDataOnly", 403);
  } else if (entityType === "ActivityPayment") {
    const payment = await prisma.activityPayment.findUnique({ where: { id: entityId } });
    if (!payment || payment.userId !== userId) return fail("ownDataOnly", 403);
  }

  const request = await prisma.correctionRequest.create({
    data: {
      outingId: outing.id,
      requesterId: userId,
      entityType,
      entityId,
      field,
      oldValue,
      newValue,
      status: "PENDING",
    },
  });

  await logEvent({
    groupId: outing.groupId,
    outingId: outing.id,
    actorId: userId,
    eventType: "CORRECTION_REQUESTED",
    entityType: "CorrectionRequest",
    entityId: request.id,
    metadata: { entityType, entityId, field, oldValue, newValue, reason: input.reason },
  });

  return ok({ success: true, id: request.id });
}

export async function approveCorrection(
  userId: string,
  requestId: string,
  decisionNote?: string
): Promise<ServiceResult<{ success: true }>> {
  const request = await prisma.correctionRequest.findUnique({ where: { id: requestId } });
  if (!request) return fail("notFound", 404);
  if (request.status !== "PENDING") return fail("alreadyDecided", 409);

  const outing = await prisma.outing.findUnique({ where: { id: request.outingId } });
  if (!outing) return fail("outingNotFound", 404);

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: request.outingId, userId } },
  });
  if (!caller || caller.role !== "OWNER") return fail("onlyOwnerApprove", 403);

  await prisma.$transaction(async tx => {
    if (request.entityType === "LineItem") {
      const field = request.field as "description" | "priceCentimes";
      const value = field === "priceCentimes" ? parseInt(request.newValue, 10) : request.newValue;
      await tx.lineItem.update({ where: { id: request.entityId }, data: { [field]: value } });
    } else if (request.entityType === "ActivityPayment") {
      await tx.activityPayment.update({
        where: { id: request.entityId },
        data: { amountCentimes: parseInt(request.newValue, 10) },
      });
    }

    await tx.correctionRequest.update({
      where: { id: requestId },
      data: {
        status: "APPROVED",
        deciderId: userId,
        decisionNote,
        decidedAt: new Date(),
      },
    });
  });

  await logEvent({
    groupId: outing.groupId,
    outingId: request.outingId,
    actorId: userId,
    eventType: "CORRECTION_APPROVED",
    entityType: "CorrectionRequest",
    entityId: requestId,
  });

  return ok({ success: true });
}

export async function rejectCorrection(
  userId: string,
  requestId: string,
  decisionNote?: string
): Promise<ServiceResult<{ success: true }>> {
  const request = await prisma.correctionRequest.findUnique({ where: { id: requestId } });
  if (!request) return fail("notFound", 404);
  if (request.status !== "PENDING") return fail("alreadyDecided", 409);

  const outing = await prisma.outing.findUnique({ where: { id: request.outingId } });
  if (!outing) return fail("outingNotFound", 404);

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: request.outingId, userId } },
  });
  if (!caller || caller.role !== "OWNER") return fail("onlyOwnerReject", 403);

  await prisma.correctionRequest.update({
    where: { id: requestId },
    data: {
      status: "REJECTED",
      deciderId: userId,
      decisionNote,
      decidedAt: new Date(),
    },
  });

  await logEvent({
    groupId: outing.groupId,
    outingId: request.outingId,
    actorId: userId,
    eventType: "CORRECTION_REJECTED",
    entityType: "CorrectionRequest",
    entityId: requestId,
  });

  return ok({ success: true });
}
