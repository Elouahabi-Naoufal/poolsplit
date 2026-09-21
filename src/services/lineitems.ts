import { prisma } from "@/lib/prisma";
import { fail, ok, type ServiceResult } from "./types";

export type LineItemPayload = {
  id: string;
  activityId: string;
  userId: string;
  displayName: string;
  description: string;
  priceCentimes: number;
};

export async function createLineItem(
  userId: string,
  input: { activityId?: string; userId?: string; description?: string; priceCentimes?: number }
): Promise<ServiceResult<{ lineItem: LineItemPayload }>> {
  const activityId = (input.activityId ?? "").trim();
  const targetUserId = (input.userId ?? "").trim() || userId;
  const description = (input.description ?? "").trim();

  if (!activityId) return fail("activityRequired", 400);
  if (!description) return fail("descRequired", 400);
  if (input.priceCentimes === undefined) return fail("priceRequired", 400);
  if (!Number.isSafeInteger(input.priceCentimes) || input.priceCentimes < 0) return fail("priceInvalid", 400);

  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) return fail("activityNotFound", 404);
  if (activity.pricingModel !== "VARIABLE") return fail("variableOnly", 400);
  if (!activity.outingId) return fail("outingNotFound", 404);

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
  if (!outing) return fail("outingNotFound", 404);
  if (outing.status === "SETTLED") return fail("outingSettledLocked", 409);

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId, userId } },
  });
  if (!caller) return fail("notOutingParticipant", 403);
  if (targetUserId !== userId && caller.role !== "OWNER") return fail("onlyOwner", 403);

  const targetParticipant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId, userId: targetUserId } },
  });
  if (!targetParticipant) return fail("targetNotParticipant", 404);

  const lineItem = await prisma.lineItem.create({
    data: { activityId, userId: targetUserId, description, priceCentimes: input.priceCentimes },
    include: { user: { select: { displayName: true } } },
  });

  return ok({
    lineItem: {
      id: lineItem.id,
      activityId: lineItem.activityId,
      userId: lineItem.userId,
      displayName: lineItem.user.displayName,
      description: lineItem.description,
      priceCentimes: lineItem.priceCentimes,
    },
  });
}

export async function updateLineItem(
  userId: string,
  lineItemId: string,
  input: { description?: string; priceCentimes?: number }
): Promise<ServiceResult<{ lineItem: LineItemPayload }>> {
  const item = await prisma.lineItem.findUnique({ where: { id: lineItemId } });
  if (!item) return fail("notFound", 404);

  const activity = await prisma.activity.findUnique({ where: { id: item.activityId } });
  if (!activity) return fail("activityNotFound", 404);
  if (!activity.outingId) return fail("outingNotFound", 404);

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
  if (!outing) return fail("outingNotFound", 404);
  if (outing.status === "SETTLED") return fail("outingSettledLocked", 409);

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId, userId } },
  });
  if (!caller) return fail("notOutingParticipant", 403);
  if (item.userId !== userId && caller.role !== "OWNER") return fail("editOwn", 403);

  if (input.priceCentimes !== undefined && (!Number.isSafeInteger(input.priceCentimes) || input.priceCentimes < 0)) {
    return fail("priceInvalid", 400);
  }

  const updateData: { description?: string; priceCentimes?: number } = {};
  if (input.description !== undefined) updateData.description = input.description;
  if (input.priceCentimes !== undefined) updateData.priceCentimes = input.priceCentimes;

  const updated = await prisma.lineItem.update({
    where: { id: lineItemId },
    data: updateData,
    include: { user: { select: { displayName: true } } },
  });

  return ok({
    lineItem: {
      id: updated.id,
      activityId: updated.activityId,
      userId: updated.userId,
      displayName: updated.user.displayName,
      description: updated.description,
      priceCentimes: updated.priceCentimes,
    },
  });
}

export async function deleteLineItem(
  userId: string,
  lineItemId: string
): Promise<ServiceResult<{ success: true }>> {
  const item = await prisma.lineItem.findUnique({ where: { id: lineItemId } });
  if (!item) return fail("notFound", 404);

  const activity = await prisma.activity.findUnique({ where: { id: item.activityId } });
  if (!activity) return fail("activityNotFound", 404);
  if (!activity.outingId) return fail("outingNotFound", 404);

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
  if (!outing) return fail("outingNotFound", 404);
  if (outing.status === "SETTLED") return fail("outingSettledLocked", 409);

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId, userId } },
  });
  if (!caller) return fail("notOutingParticipant", 403);
  if (item.userId !== userId && caller.role !== "OWNER") return fail("deleteOwn", 403);

  await prisma.lineItem.delete({ where: { id: lineItemId } });
  return ok({ success: true });
}
