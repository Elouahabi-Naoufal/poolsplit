"use server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/server/auth/session";
import { logEvent } from "@/server/audit";
import { revalidatePath } from "next/cache";
import { userError } from "@/lib/errors";
import { getTranslations } from "next-intl/server";

/**
 * Create a product for an activity (fixed or variable pricing).
 * Only outing owner can create products.
 */
export async function createActivityProductAction(formData: FormData) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const activityId = formData.get("activityId") as string;
  const name = ((formData.get("name") as string) || "").trim();
  const unit = ((formData.get("unit") as string) || "unit").trim();
  const pricePerUnitDH = formData.get("pricePerUnitDH") as string;

  if (!activityId) return { error: t("activityRequired") };
  if (!name) return { error: t("productNameRequired") };
  if (!pricePerUnitDH) return { error: t("priceRequired") };

  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) return { error: t("activityNotFound") };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: session.userId } },
  });
  if (!participant || participant.role !== "OWNER") return { error: t("onlyOwner") };

  // Parse price
  const { parseDHToCentimes } = await import("@/domain/money");
  let priceCentimes: number;
  try {
    priceCentimes = parseDHToCentimes(pricePerUnitDH, { minCentimes: 1, field: "Price" });
  } catch (e: unknown) {
    return { error: userError(e, "Could not add this product. Please try again.") };
  }

  const product = await prisma.activityProduct.create({
    data: {
      activityId,
      name,
      unit,
      pricePerUnitCt: priceCentimes,
    },
  });

  await logEvent({
    groupId: outing.groupId,
    outingId: activity.outingId!,
    actorId: session.userId,
    eventType: "PRODUCT_CREATED",
    entityType: "ActivityProduct",
    entityId: product.id,
    metadata: { name, pricePerUnitCt: priceCentimes },
  });

  revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  return { success: true, id: product.id };
}

/**
 * Update a product. Owner only, while activity is open.
 * Invalidates confirmations if price changes.
 */
export async function updateActivityProductAction(
  productId: string,
  data: { name?: string; unit?: string; pricePerUnitDH?: string }
) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const product = await prisma.activityProduct.findUnique({ where: { id: productId } });
  if (!product) return { error: t("productMissing") };

  const activity = await prisma.activity.findUnique({ where: { id: product.activityId } });
  if (!activity) return { error: t("activityNotFound") };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };
  if (outing.status === "SETTLED") return { error: t("outingSettledLocked") };
  if (activity.status === "CLOSED" && outing.status !== "SETTLED") {
    // Admin can edit closed activities before outing settlement (spec §23)
  }

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: session.userId } },
  });
  if (!participant || participant.role !== "OWNER") return { error: t("onlyOwner") };

  const updateData: { name?: string; unit?: string; pricePerUnitCt?: number } = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.unit !== undefined) updateData.unit = data.unit;

  if (data.pricePerUnitDH !== undefined) {
    const { parseDHToCentimes } = await import("@/domain/money");
    try {
      updateData.pricePerUnitCt = parseDHToCentimes(data.pricePerUnitDH, { minCentimes: 1, field: "Price" });
    } catch (e: unknown) {
      return { error: userError(e, "Could not update this product. Please try again.") };
    }
  }

  // Check if price changed — invalidate confirmations
  const priceChanged = updateData.pricePerUnitCt !== undefined && updateData.pricePerUnitCt !== product.pricePerUnitCt;

  await prisma.$transaction(async (tx) => {
    await tx.activityProduct.update({ where: { id: productId }, data: updateData });

    if (priceChanged) {
      // Invalidate all confirmations for usage records of this product
      const usageRecords = await tx.usageRecord.findMany({
        where: { productId },
        select: { id: true, quantity: true },
      });
      for (const record of usageRecords) {
        await tx.usageConfirmation.updateMany({
          where: { usageRecordId: record.id },
          data: { status: "PENDING" },
        });
        // Recalculate total
        const participants = await tx.usageParticipant.findMany({
          where: { usageRecordId: record.id },
        });
        if (participants.length > 0) {
          await tx.usageRecord.update({
            where: { id: record.id },
            data: { totalCentimes: updateData.pricePerUnitCt! * record.quantity },
          });
        }
      }
    }
  });

  revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  return { success: true };
}

/**
 * Delete a product. Only if no usage records reference it.
 */
export async function deleteActivityProductAction(productId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const product = await prisma.activityProduct.findUnique({ where: { id: productId } });
  if (!product) return { error: t("productMissing") };

  const activity = await prisma.activity.findUnique({ where: { id: product.activityId } });
  if (!activity) return { error: t("activityNotFound") };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };
  if (outing.status === "SETTLED") return { error: t("outingSettledLocked") };

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: session.userId } },
  });
  if (!participant || participant.role !== "OWNER") return { error: t("onlyOwner") };

  const usageCount = await prisma.usageRecord.count({ where: { productId } });
  if (usageCount > 0) {
    return { error: `Cannot delete: ${usageCount} usage record(s) reference this product.` };
  }

  await prisma.activityProduct.delete({ where: { id: productId } });
  revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  return { success: true };
}
