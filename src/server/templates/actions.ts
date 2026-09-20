"use server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/server/auth/session";
import { logEvent } from "@/server/audit";
import { revalidatePath } from "next/cache";
import { userError } from "@/lib/errors";
import { getTranslations } from "next-intl/server";

/**
 * Templates are personal: each user manages their own library.
 * A template can only be USED (applied to a new activity) or captured from an
 * activity (save-as-template) by the group admin or by members granted the
 * canUseTemplates group permission.
 */

const isOwnTemplate = async (templateId: string, userId: string) => {
  const template = await prisma.activityTemplate.findUnique({ where: { id: templateId } });
  return { template, owned: !!template && template.userId === userId };
};

export async function createTemplateAction(formData: FormData) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const name = ((formData.get("name") as string) || "").trim();
  const pricingModel = (formData.get("pricingModel") as string) || "FIXED";

  if (!name) return { error: t("templateNameRequired") };
  if (pricingModel !== "FIXED" && pricingModel !== "VARIABLE") {
    return { error: t("pricingModel") };
  }

  const template = await prisma.activityTemplate.create({
    data: { userId: session.userId, name, pricingModel },
  });
  revalidatePath("/templates");
  return { success: true, id: template.id };
}

export async function updateTemplateAction(
  templateId: string,
  data: { name?: string; pricingModel?: string; notes?: string }
) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const { template, owned } = await isOwnTemplate(templateId, session.userId);
  if (!template) return { error: t("templateMissing") };
  if (!owned) return { error: t("templateNotOwner") };

  const updateData: { name?: string; pricingModel?: string; notes?: string | null } = {};
  if (data.name !== undefined && data.name.trim()) updateData.name = data.name.trim();
  if (data.pricingModel !== undefined) {
    if (data.pricingModel !== "FIXED" && data.pricingModel !== "VARIABLE") {
      return { error: t("pricingModel") };
    }
    updateData.pricingModel = data.pricingModel;
  }
  if (data.notes !== undefined) updateData.notes = data.notes.trim() || null;

  await prisma.activityTemplate.update({ where: { id: templateId }, data: updateData });
  revalidatePath("/templates");
  return { success: true };
}

export async function deleteTemplateAction(templateId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const { template, owned } = await isOwnTemplate(templateId, session.userId);
  if (!template) return { error: t("templateMissing") };
  if (!owned) return { error: t("templateNotOwner") };

  await prisma.activityTemplate.delete({ where: { id: templateId } });
  revalidatePath("/templates");
  return { success: true };
}

/** Copy an existing activity (name, pricing model, products) into the user's template library. */
export async function saveActivityAsTemplateAction(activityId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: { products: true },
  });
  if (!activity) return { error: t("activityNotFound") };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };

  // Only the group admin (owner) or members granted canUseTemplates may save
  // activities as templates.
  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: outing.groupId, userId: session.userId } },
  });
  if (!member || (member.role !== "OWNER" && !member.canUseTemplates)) {
    return { error: t("groupAdminOnlyTemplates") };
  }

  const existing = await prisma.activityTemplate.findFirst({
    where: { userId: session.userId, name: activity.name, pricingModel: activity.pricingModel },
  });
  if (existing) return { error: t("templateAlreadyExists") };

  const template = await prisma.activityTemplate.create({
    data: {
      userId: session.userId,
      name: activity.name,
      pricingModel: activity.pricingModel,
      notes: activity.notes,
      products: {
        create: activity.products.map(p => ({
          name: p.name,
          unit: p.unit,
          pricePerUnitCt: p.pricePerUnitCt,
        })),
      },
    },
  });

  await logEvent({
    groupId: outing.groupId,
    outingId: activity.outingId!,
    actorId: session.userId,
    eventType: "TEMPLATE_CREATED",
    entityType: "ActivityTemplate",
    entityId: template.id,
    metadata: { name: activity.name, products: activity.products.length },
  });

  revalidatePath("/templates");
  return { success: true };
}

export async function createTemplateProductAction(formData: FormData) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const templateId = formData.get("templateId") as string;
  const name = ((formData.get("name") as string) || "").trim();
  const unit = ((formData.get("unit") as string) || "unit").trim();
  const pricePerUnitDH = formData.get("pricePerUnitDH") as string;

  if (!templateId) return { error: t("templateMissing") };
  if (!name) return { error: t("productNameRequired") };
  if (!pricePerUnitDH) return { error: t("priceRequired") };

  const { template, owned } = await isOwnTemplate(templateId, session.userId);
  if (!template) return { error: t("templateMissing") };
  if (!owned) return { error: t("templateNotOwner") };

  const { parseDHToCentimes } = await import("@/domain/money");
  let priceCentimes: number;
  try {
    priceCentimes = parseDHToCentimes(pricePerUnitDH, { minCentimes: 1, field: "Price" });
  } catch (e: unknown) {
    return { error: userError(e, "Could not add this product. Please try again.") };
  }

  const product = await prisma.activityTemplateProduct.create({
    data: { templateId, name, unit, pricePerUnitCt: priceCentimes },
  });

  revalidatePath("/templates");
  return { success: true, id: product.id };
}

export async function updateTemplateProductAction(
  productId: string,
  data: { name?: string; unit?: string; pricePerUnitDH?: string }
) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const product = await prisma.activityTemplateProduct.findUnique({
    where: { id: productId },
    include: { template: true },
  });
  if (!product) return { error: t("templateProductMissing") };
  if (product.template.userId !== session.userId) return { error: t("templateNotOwner") };

  const updateData: { name?: string; unit?: string; pricePerUnitCt?: number } = {};
  if (data.name !== undefined && data.name.trim()) updateData.name = data.name.trim();
  if (data.unit !== undefined && data.unit.trim()) updateData.unit = data.unit.trim();
  if (data.pricePerUnitDH !== undefined) {
    const { parseDHToCentimes } = await import("@/domain/money");
    try {
      updateData.pricePerUnitCt = parseDHToCentimes(data.pricePerUnitDH, { minCentimes: 1, field: "Price" });
    } catch (e: unknown) {
      return { error: userError(e, "Could not update this product. Please try again.") };
    }
  }

  await prisma.activityTemplateProduct.update({ where: { id: productId }, data: updateData });
  revalidatePath("/templates");
  return { success: true };
}

export async function deleteTemplateProductAction(productId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const product = await prisma.activityTemplateProduct.findUnique({
    where: { id: productId },
    include: { template: true },
  });
  if (!product) return { error: t("templateProductMissing") };
  if (product.template.userId !== session.userId) return { error: t("templateNotOwner") };

  await prisma.activityTemplateProduct.delete({ where: { id: productId } });
  revalidatePath("/templates");
  return { success: true };
}