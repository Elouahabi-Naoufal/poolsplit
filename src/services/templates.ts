import { prisma } from "@/lib/prisma";
import { logEvent } from "@/server/audit";
import { fail, ok, type ServiceResult } from "./types";

export type TemplatePayload = {
  id: string;
  name: string;
  pricingModel: string;
  updatedAt: string;
  productsCount: number;
};

export type TemplateProductPayload = {
  id: string;
  templateId: string;
  name: string;
  unit: string;
  priceCentimes: number;
};

function serializeTemplate(template: {
  id: string;
  name: string;
  pricingModel: string;
  updatedAt: Date;
  products: { id: string }[];
}): TemplatePayload {
  return {
    id: template.id,
    name: template.name,
    pricingModel: template.pricingModel,
    updatedAt: template.updatedAt.toISOString(),
    productsCount: template.products.length,
  };
}

export async function listTemplates(userId: string): Promise<ServiceResult<{ templates: TemplatePayload[] }>> {
  const templates = await prisma.activityTemplate.findMany({
    where: { userId },
    include: { products: true },
    orderBy: { updatedAt: "desc" },
  });
  return ok({ templates: templates.map(serializeTemplate) });
}

export async function createTemplate(
  userId: string,
  input: { name?: string; pricingModel?: string; products?: { name?: string; priceCentimes?: number; unit?: string }[] }
): Promise<ServiceResult<{ template: TemplatePayload }>> {
  const name = (input.name ?? "").trim();
  const pricingModel = input.pricingModel ?? "FIXED";

  if (!name) return fail("templateNameRequired", 400);
  if (pricingModel !== "FIXED" && pricingModel !== "VARIABLE") return fail("pricingModel", 400);

  const products = input.products ?? [];
  for (const product of products) {
    if (!product.name || !product.name.trim()) return fail("productNameRequired", 400);
    if (product.priceCentimes === undefined || !Number.isSafeInteger(product.priceCentimes) || product.priceCentimes < 1) {
      return fail("priceInvalid", 400);
    }
  }

  const template = await prisma.activityTemplate.create({
    data: {
      userId,
      name,
      pricingModel,
      products: {
        create: products.map(p => ({
          name: p.name!.trim(),
          unit: (p.unit ?? "unit").trim() || "unit",
          pricePerUnitCt: p.priceCentimes!,
        })),
      },
    },
    include: { products: true },
  });

  return ok({ template: serializeTemplate(template) });
}

export async function updateTemplate(
  userId: string,
  templateId: string,
  input: { name?: string; pricingModel?: string; notes?: string }
): Promise<ServiceResult<{ template: TemplatePayload }>> {
  const template = await prisma.activityTemplate.findUnique({ where: { id: templateId }, include: { products: true } });
  if (!template) return fail("templateMissing", 404);
  if (template.userId !== userId) return fail("templateNotOwner", 403);

  const updateData: { name?: string; pricingModel?: string; notes?: string | null } = {};
  if (input.name !== undefined && input.name.trim()) updateData.name = input.name.trim();
  if (input.pricingModel !== undefined) {
    if (input.pricingModel !== "FIXED" && input.pricingModel !== "VARIABLE") return fail("pricingModel", 400);
    updateData.pricingModel = input.pricingModel;
  }
  if (input.notes !== undefined) updateData.notes = input.notes.trim() || null;

  const updated = await prisma.activityTemplate.update({
    where: { id: templateId },
    data: updateData,
    include: { products: true },
  });

  return ok({ template: serializeTemplate(updated) });
}

export async function deleteTemplate(
  userId: string,
  templateId: string
): Promise<ServiceResult<{ success: true }>> {
  const template = await prisma.activityTemplate.findUnique({ where: { id: templateId } });
  if (!template) return fail("templateMissing", 404);
  if (template.userId !== userId) return fail("templateNotOwner", 403);

  await prisma.activityTemplate.delete({ where: { id: templateId } });
  return ok({ success: true });
}

export async function listTemplateProducts(
  userId: string,
  templateId: string
): Promise<ServiceResult<{ products: TemplateProductPayload[] }>> {
  const template = await prisma.activityTemplate.findUnique({
    where: { id: templateId },
    include: { products: true },
  });
  if (!template) return fail("templateMissing", 404);
  if (template.userId !== userId) return fail("templateNotOwner", 403);

  return ok({
    products: template.products.map(p => ({
      id: p.id,
      templateId: p.templateId,
      name: p.name,
      unit: p.unit,
      priceCentimes: p.pricePerUnitCt,
    })),
  });
}

export async function createTemplateProduct(
  userId: string,
  templateId: string,
  input: { name?: string; priceCentimes?: number; unit?: string }
): Promise<ServiceResult<{ product: TemplateProductPayload }>> {
  const name = (input.name ?? "").trim();
  const unit = (input.unit ?? "unit").trim() || "unit";

  if (!name) return fail("productNameRequired", 400);
  if (input.priceCentimes === undefined) return fail("priceRequired", 400);
  if (!Number.isSafeInteger(input.priceCentimes) || input.priceCentimes < 1) return fail("priceInvalid", 400);

  const template = await prisma.activityTemplate.findUnique({ where: { id: templateId } });
  if (!template) return fail("templateMissing", 404);
  if (template.userId !== userId) return fail("templateNotOwner", 403);

  const product = await prisma.activityTemplateProduct.create({
    data: { templateId, name, unit, pricePerUnitCt: input.priceCentimes },
  });

  return ok({
    product: {
      id: product.id,
      templateId: product.templateId,
      name: product.name,
      unit: product.unit,
      priceCentimes: product.pricePerUnitCt,
    },
  });
}

export async function updateTemplateProduct(
  userId: string,
  productId: string,
  input: { name?: string; priceCentimes?: number; unit?: string }
): Promise<ServiceResult<{ product: TemplateProductPayload }>> {
  const product = await prisma.activityTemplateProduct.findUnique({
    where: { id: productId },
    include: { template: true },
  });
  if (!product) return fail("templateProductMissing", 404);
  if (product.template.userId !== userId) return fail("templateNotOwner", 403);

  if (input.priceCentimes !== undefined && (!Number.isSafeInteger(input.priceCentimes) || input.priceCentimes < 1)) {
    return fail("priceInvalid", 400);
  }

  const updateData: { name?: string; unit?: string; pricePerUnitCt?: number } = {};
  if (input.name !== undefined && input.name.trim()) updateData.name = input.name.trim();
  if (input.unit !== undefined && input.unit.trim()) updateData.unit = input.unit.trim();
  if (input.priceCentimes !== undefined) updateData.pricePerUnitCt = input.priceCentimes;

  const updated = await prisma.activityTemplateProduct.update({
    where: { id: productId },
    data: updateData,
  });

  return ok({
    product: {
      id: updated.id,
      templateId: updated.templateId,
      name: updated.name,
      unit: updated.unit,
      priceCentimes: updated.pricePerUnitCt,
    },
  });
}

export async function deleteTemplateProduct(
  userId: string,
  productId: string
): Promise<ServiceResult<{ success: true }>> {
  const product = await prisma.activityTemplateProduct.findUnique({
    where: { id: productId },
    include: { template: true },
  });
  if (!product) return fail("templateProductMissing", 404);
  if (product.template.userId !== userId) return fail("templateNotOwner", 403);

  await prisma.activityTemplateProduct.delete({ where: { id: productId } });
  return ok({ success: true });
}

export async function saveActivityAsTemplate(
  userId: string,
  activityId: string
): Promise<ServiceResult<{ template: TemplatePayload }>> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: { products: true },
  });
  if (!activity) return fail("activityNotFound", 404);
  if (!activity.outingId) return fail("outingNotFound", 404);

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
  if (!outing) return fail("outingNotFound", 404);

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: outing.groupId, userId } },
  });
  if (!member || (member.role !== "OWNER" && !member.canUseTemplates)) {
    return fail("groupAdminOnlyTemplates", 403);
  }

  const existing = await prisma.activityTemplate.findFirst({
    where: { userId, name: activity.name, pricingModel: activity.pricingModel },
  });
  if (existing) return fail("templateAlreadyExists", 409);

  const template = await prisma.activityTemplate.create({
    data: {
      userId,
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
    include: { products: true },
  });

  await logEvent({
    groupId: outing.groupId,
    outingId: activity.outingId,
    actorId: userId,
    eventType: "TEMPLATE_CREATED",
    entityType: "ActivityTemplate",
    entityId: template.id,
    metadata: { name: activity.name, products: activity.products.length },
  });

  return ok({ template: serializeTemplate(template) });
}
