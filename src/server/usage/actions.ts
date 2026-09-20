"use server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/server/auth/session";
import { logEvent } from "@/server/audit";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

/**
 * Create a usage record for a fixed-price activity.
 * Only outing owner can create. Participants are the people who used the product.
 * Total = quantity × product pricePerUnitCt, divided equally among participants.
 */
export async function createUsageRecordAction(formData: FormData) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const activityId = formData.get("activityId") as string;
  const productId = formData.get("productId") as string;
  const quantityRaw = (formData.get("quantity") as string) || "1";
  // Checkboxes submit one `participantIds` field per checked box; accept that
  // natively. A single JSON-array value is also accepted for compatibility.
  const participantIdsRaw = formData.getAll("participantIds").map(v => String(v).trim()).filter(Boolean);

  if (!activityId) return { error: t("activityRequired") };
  if (!productId) return { error: t("productRequired") };

  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) return { error: t("activityNotFound") };
  if (activity.pricingModel !== "FIXED") return { error: t("fixedOnly") };
  if (activity.status !== "OPEN") return { error: t("activityNotOpen") };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: session.userId } },
  });
  if (!participant || participant.role !== "OWNER") return { error: t("onlyOwner") };

  const product = await prisma.activityProduct.findUnique({ where: { id: productId } });
  if (!product || product.activityId !== activityId) return { error: t("productNotInActivity") };

  const quantity = parseInt(quantityRaw, 10);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return { error: t("quantityMin") };

  let participantIds: string[];
  if (participantIdsRaw.length === 1) {
    try {
      const parsed: unknown = JSON.parse(participantIdsRaw[0]);
      participantIds = Array.isArray(parsed) ? parsed.map(String) : [...participantIdsRaw];
    } catch {
      participantIds = [...participantIdsRaw];
    }
  } else {
    participantIds = [...participantIdsRaw];
  }
  participantIds = [...new Set(participantIds.map(id => id.trim()).filter(Boolean))];
  if (participantIds.length === 0) {
    return { error: t("selectParticipants") };
  }

  const totalCentimes = product.pricePerUnitCt * quantity;

  // Merge into an existing PENDING record when the same product is used again
  // by the exact same set of participants: bump quantity and total instead of
  // stacking another row. Confirmed/disputed records are never touched.
  const participantKey = (ids: string[]) => [...new Set(ids)].sort().join("|");
  const existingPending = await prisma.usageRecord.findMany({
    where: { activityId, productId, status: "PENDING" },
    include: { participants: { select: { userId: true } } },
  });
  const mergeTarget = existingPending.find(
    r => participantKey(r.participants.map(p => p.userId)) === participantKey(participantIds)
  );

  if (mergeTarget) {
    await prisma.usageRecord.update({
      where: { id: mergeTarget.id },
      data: {
        quantity: mergeTarget.quantity + quantity,
        totalCentimes: mergeTarget.totalCentimes + totalCentimes,
      },
    });
    await logEvent({
      groupId: outing.groupId,
      outingId: activity.outingId!,
      actorId: session.userId,
      eventType: "USAGE_RECORD_CREATED",
      entityType: "UsageRecord",
      entityId: mergeTarget.id,
      metadata: { product: product.name, quantity, totalCentimes, participants: participantIds.length, merged: true },
    });
    revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
    return {
      success: true,
      id: mergeTarget.id,
      merged: true,
      message: t("usageMerged", { product: product.name, qty: quantity }),
    };
  }

  const usageRecord = await prisma.usageRecord.create({
    data: {
      activityId,
      productId,
      quantity,
      totalCentimes,
      createdById: session.userId,
      status: "PENDING",
    },
  });

  // Create participant records
  for (const uid of participantIds) {
    await prisma.usageParticipant.create({
      data: { usageRecordId: usageRecord.id, userId: uid },
    });
    // Auto-create PENDING confirmation for each participant
    await prisma.usageConfirmation.create({
      data: { usageRecordId: usageRecord.id, userId: uid, status: "PENDING" },
    });
  }

  await logEvent({
    groupId: outing.groupId,
    outingId: activity.outingId!,
    actorId: session.userId,
    eventType: "USAGE_RECORD_CREATED",
    entityType: "UsageRecord",
    entityId: usageRecord.id,
    metadata: { product: product.name, quantity, totalCentimes, participants: participantIds.length },
  });

  revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  return { success: true, id: usageRecord.id };
}

/**
 * Update a usage record. Owner only, while activity is open.
 * Changing quantity or product invalidates confirmations.
 */
export async function updateUsageRecordAction(
  usageRecordId: string,
  data: { quantity?: number; productId?: string }
) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const record = await prisma.usageRecord.findUnique({ where: { id: usageRecordId } });
  if (!record) return { error: t("recordNotFound") };

  const activity = await prisma.activity.findUnique({ where: { id: record.activityId } });
  if (!activity) return { error: t("activityNotFound") };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };
  if (outing.status === "SETTLED") return { error: t("outingSettledLocked") };

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: session.userId } },
  });
  if (!participant || participant.role !== "OWNER") return { error: t("onlyOwner") };

  const updateData: { quantity?: number; productId?: string; totalCentimes?: number } = {};
  let product = await prisma.activityProduct.findUnique({ where: { id: record.productId } });

  if (data.productId && data.productId !== record.productId) {
    const newProduct = await prisma.activityProduct.findUnique({ where: { id: data.productId } });
    if (!newProduct || newProduct.activityId !== record.activityId) return { error: t("productMissing") };
    updateData.productId = data.productId;
    product = newProduct;
  }

  if (data.quantity !== undefined) {
    if (data.quantity < 1) return { error: t("quantityMin") };
    updateData.quantity = data.quantity;
  }

  if (updateData.quantity !== undefined || updateData.productId !== undefined) {
    const qty = updateData.quantity ?? record.quantity;
    const price = product!.pricePerUnitCt;
    updateData.totalCentimes = price * qty;
  }

  await prisma.$transaction(async (tx) => {
    await tx.usageRecord.update({ where: { id: usageRecordId }, data: updateData });
    // Invalidate all confirmations
    await tx.usageConfirmation.updateMany({
      where: { usageRecordId },
      data: { status: "PENDING" },
    });
  });

  revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  return { success: true };
}

/**
 * Delete a usage record. Owner only.
 */
export async function deleteUsageRecordAction(usageRecordId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const record = await prisma.usageRecord.findUnique({ where: { id: usageRecordId } });
  if (!record) return { error: t("notFound") };

  const activity = await prisma.activity.findUnique({ where: { id: record.activityId } });
  if (!activity) return { error: t("activityNotFound") };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };
  if (outing.status === "SETTLED") return { error: t("outingSettledLocked") };

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: session.userId } },
  });
  if (!participant || participant.role !== "OWNER") return { error: t("onlyOwner") };

  await prisma.usageRecord.delete({ where: { id: usageRecordId } });
  revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  return { success: true };
}

/**
 * Confirm a usage record. Only participants of the record can confirm.
 */
export async function confirmUsageRecordAction(usageRecordId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const record = await prisma.usageRecord.findUnique({ where: { id: usageRecordId } });
  if (!record) return { error: t("notFound") };

  const confirmation = await prisma.usageConfirmation.findUnique({
    where: { usageRecordId_userId: { usageRecordId, userId: session.userId } },
  });
  if (!confirmation) return { error: t("notUsageParticipant") };
  if (confirmation.status !== "PENDING") return { error: t("alreadyDecided") };

  await prisma.usageConfirmation.update({
    where: { id: confirmation.id },
    data: { status: "CONFIRMED" },
  });

  // Check if all confirmations are done
  const allConfirmations = await prisma.usageConfirmation.findMany({
    where: { usageRecordId },
  });
  const allConfirmed = allConfirmations.every(c => c.status === "CONFIRMED" || c.status === "ADMIN_CONFIRMED");
  if (allConfirmed) {
    await prisma.usageRecord.update({
      where: { id: usageRecordId },
      data: { status: "CONFIRMED" },
    });
  }

  const activity = await prisma.activity.findUnique({ where: { id: record.activityId } });
  if (activity?.outingId) {
    const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
    if (outing) revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  }
  return { success: true };
}

/**
 * Dispute a usage record. Only participants can dispute.
 * A disputed record is excluded from calculation until admin resolves.
 */
export async function disputeUsageRecordAction(usageRecordId: string, notes: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const record = await prisma.usageRecord.findUnique({ where: { id: usageRecordId } });
  if (!record) return { error: t("notFound") };

  const confirmation = await prisma.usageConfirmation.findUnique({
    where: { usageRecordId_userId: { usageRecordId, userId: session.userId } },
  });
  if (!confirmation) return { error: t("notUsageParticipant") };

  await prisma.$transaction(async (tx) => {
    await tx.usageConfirmation.update({
      where: { id: confirmation.id },
      data: { status: "DISPUTED", notes },
    });
    await tx.usageRecord.update({
      where: { id: usageRecordId },
      data: { status: "DISPUTED" },
    });
  });

  const activity = await prisma.activity.findUnique({ where: { id: record.activityId } });
  if (activity?.outingId) {
    const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
    if (outing) revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  }
  return { success: true };
}

/**
 * Admin confirms a usage record on behalf of a participant.
 * Only outing owner can do this.
 */
export async function adminConfirmUsageRecordAction(usageRecordId: string, targetUserId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const record = await prisma.usageRecord.findUnique({ where: { id: usageRecordId } });
  if (!record) return { error: t("notFound") };

  const activity = await prisma.activity.findUnique({ where: { id: record.activityId } });
  if (!activity) return { error: t("activityNotFound") };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: session.userId } },
  });
  if (!caller || caller.role !== "OWNER") return { error: t("onlyOwner") };

  const confirmation = await prisma.usageConfirmation.findUnique({
    where: { usageRecordId_userId: { usageRecordId, userId: targetUserId } },
  });
  if (!confirmation) return { error: t("targetNotParticipant") };
  if (confirmation.status !== "PENDING") return { error: t("alreadyDecided") };

  await prisma.usageConfirmation.update({
    where: { id: confirmation.id },
    data: { status: "ADMIN_CONFIRMED" },
  });

  // Check if all confirmations are done
  const allConfirmations = await prisma.usageConfirmation.findMany({
    where: { usageRecordId },
  });
  const allResolved = allConfirmations.every(c => c.status === "CONFIRMED" || c.status === "ADMIN_CONFIRMED");
  if (allResolved) {
    await prisma.usageRecord.update({
      where: { id: usageRecordId },
      data: { status: "CONFIRMED" },
    });
  }

  revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  return { success: true };
}

/**
 * Admin resolves a dispute by correcting the quantity.
 * Invalidates confirmations, affected participants must re-confirm.
 */
export async function resolveDisputeAction(usageRecordId: string, newQuantity: number) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const record = await prisma.usageRecord.findUnique({ where: { id: usageRecordId } });
  if (!record) return { error: t("notFound") };
  if (record.status !== "DISPUTED") return { error: t("notDisputed") };

  const activity = await prisma.activity.findUnique({ where: { id: record.activityId } });
  if (!activity) return { error: t("activityNotFound") };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: session.userId } },
  });
  if (!caller || caller.role !== "OWNER") return { error: t("onlyOwner") };

  if (newQuantity < 1) return { error: t("quantityMin") };

  const product = await prisma.activityProduct.findUnique({ where: { id: record.productId } });
    if (!product) return { error: t("productMissing") };

  const newTotal = product.pricePerUnitCt * newQuantity;

  await prisma.$transaction(async (tx) => {
    await tx.usageRecord.update({
      where: { id: usageRecordId },
      data: { quantity: newQuantity, totalCentimes: newTotal, status: "PENDING" },
    });
    // Reset all confirmations
    await tx.usageConfirmation.updateMany({
      where: { usageRecordId },
      data: { status: "PENDING", notes: null },
    });
  });

  revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  return { success: true };
}

export async function batchConfirmAllAction(activityId: string) {
  const session = await requireSession();
  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) return { error: "Activity not found" };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: "Outing not found" };

  await prisma.$transaction(async (tx) => {
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
      const remaining = await tx.usageConfirmation.count({ where: { usageRecordId: record.id, status: "PENDING" } });
      if (remaining === 0) {
        await tx.usageRecord.update({ where: { id: record.id }, data: { status: "CONFIRMED" } });
      }
    }
  });

  revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  return { success: true };
}
