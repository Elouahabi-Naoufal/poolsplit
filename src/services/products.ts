import { prisma } from "@/lib/prisma";
import { logEvent } from "@/server/audit";
import { fail, ok, type ServiceResult } from "./types";

export type ProductPayload = {
  id: string;
  activityId: string;
  name: string;
  unit: string;
  priceCentimes: number;
};

type ActivityRow = NonNullable<Awaited<ReturnType<typeof prisma.activity.findUnique>>>;
type OutingRow = NonNullable<Awaited<ReturnType<typeof prisma.outing.findUnique>>>;

async function loadActivityOwnerContext(
  activityId: string,
  userId: string
): Promise<{ error: ServiceResult<never> } | { activity: ActivityRow; outing: OutingRow }> {
  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) return { error: fail("activityNotFound", 404) };
  if (!activity.outingId) return { error: fail("outingNotFound", 404) };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
  if (!outing) return { error: fail("outingNotFound", 404) };

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId, userId } },
  });
  if (!participant || participant.role !== "OWNER") return { error: fail("onlyOwner", 403) };

  return { activity, outing };
}

export async function createActivityProduct(
  userId: string,
  activityId: string,
  input: { name?: string; priceCentimes?: number; unit?: string }
): Promise<ServiceResult<{ product: ProductPayload }>> {
  const name = (input.name ?? "").trim();
  const unit = (input.unit ?? "unit").trim() || "unit";

  if (!name) return fail("productNameRequired", 400);
  if (input.priceCentimes === undefined) return fail("priceRequired", 400);
  if (!Number.isSafeInteger(input.priceCentimes) || input.priceCentimes < 1) return fail("priceInvalid", 400);

  const ctx = await loadActivityOwnerContext(activityId, userId);
  if ("error" in ctx) return ctx.error;

  const product = await prisma.activityProduct.create({
    data: { activityId, name, unit, pricePerUnitCt: input.priceCentimes },
  });

  await logEvent({
    groupId: ctx.outing.groupId,
    outingId: ctx.activity.outingId!,
    actorId: userId,
    eventType: "PRODUCT_CREATED",
    entityType: "ActivityProduct",
    entityId: product.id,
    metadata: { name, pricePerUnitCt: product.pricePerUnitCt },
  });

  return ok({
    product: {
      id: product.id,
      activityId: product.activityId,
      name: product.name,
      unit: product.unit,
      priceCentimes: product.pricePerUnitCt,
    },
  });
}

export async function updateActivityProduct(
  userId: string,
  activityId: string,
  productId: string,
  input: { name?: string; priceCentimes?: number; unit?: string }
): Promise<ServiceResult<{ product: ProductPayload }>> {
  const product = await prisma.activityProduct.findUnique({ where: { id: productId } });
  if (!product || product.activityId !== activityId) return fail("productMissing", 404);

  const ctx = await loadActivityOwnerContext(activityId, userId);
  if ("error" in ctx) return ctx.error;
  if (ctx.outing.status === "SETTLED") return fail("outingSettledLocked", 409);

  if (input.priceCentimes !== undefined && (!Number.isSafeInteger(input.priceCentimes) || input.priceCentimes < 1)) {
    return fail("priceInvalid", 400);
  }

  const updateData: { name?: string; unit?: string; pricePerUnitCt?: number } = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.unit !== undefined) updateData.unit = input.unit;
  if (input.priceCentimes !== undefined) updateData.pricePerUnitCt = input.priceCentimes;

  const priceChanged = updateData.pricePerUnitCt !== undefined && updateData.pricePerUnitCt !== product.pricePerUnitCt;

  await prisma.$transaction(async tx => {
    await tx.activityProduct.update({ where: { id: productId }, data: updateData });

    if (priceChanged) {
      const usageRecords = await tx.usageRecord.findMany({
        where: { productId },
        select: { id: true, quantity: true },
      });
      for (const record of usageRecords) {
        await tx.usageConfirmation.updateMany({
          where: { usageRecordId: record.id },
          data: { status: "PENDING" },
        });
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

  const updated = await prisma.activityProduct.findUnique({ where: { id: productId } });
  if (!updated) return fail("productMissing", 404);

  return ok({
    product: {
      id: updated.id,
      activityId: updated.activityId,
      name: updated.name,
      unit: updated.unit,
      priceCentimes: updated.pricePerUnitCt,
    },
  });
}

export async function deleteActivityProduct(
  userId: string,
  activityId: string,
  productId: string
): Promise<ServiceResult<{ success: true }>> {
  const product = await prisma.activityProduct.findUnique({ where: { id: productId } });
  if (!product || product.activityId !== activityId) return fail("productMissing", 404);

  const ctx = await loadActivityOwnerContext(activityId, userId);
  if ("error" in ctx) return ctx.error;
  if (ctx.outing.status === "SETTLED") return fail("outingSettledLocked", 409);

  const usageCount = await prisma.usageRecord.count({ where: { productId } });
  if (usageCount > 0) {
    return fail(`Cannot delete: ${usageCount} usage record(s) reference this product.`, 409);
  }

  await prisma.activityProduct.delete({ where: { id: productId } });
  return ok({ success: true });
}
