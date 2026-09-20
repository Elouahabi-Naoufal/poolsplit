"use server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/server/auth/session";
import { logEvent } from "@/server/audit";
import { revalidatePath } from "next/cache";
import { formatDH } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

/**
 * Create an activity within an outing. Only outing OWNER can create.
 * pricingModel: "FIXED" or "VARIABLE"
 */
export async function createActivityAction(formData: FormData) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const outingId = formData.get("outingId") as string;
  const name = ((formData.get("name") as string) || "").trim();
  const pricingModel = (formData.get("pricingModel") as string) || "FIXED";
  const notes = ((formData.get("notes") as string) || "").trim() || undefined;
  const participantIds = formData.get("participantIds") as string || "[]";
  const templateId = (formData.get("templateId") as string) || "";

  if (!outingId) return { error: t("outingRequired") };
  if (!name) return { error: t("activityNameRequired") };
  if (pricingModel !== "FIXED" && pricingModel !== "VARIABLE") {
    return { error: t("pricingModel") };
  }

  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing) return { error: t("outingNotFound") };
  if (outing.status === "SETTLED") return { error: t("outingSettledShort") };

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId: session.userId } },
  });
  if (!participant || participant.role !== "OWNER") {
    return { error: t("onlyOwner") };
  }

  // If a template was chosen, it may only be used by the group admin (owner),
  // and it must belong to the current user.
  let templateProducts: { name: string; unit: string; pricePerUnitCt: number }[] = [];
  if (templateId) {
    const template = await prisma.activityTemplate.findUnique({
      where: { id: templateId },
      include: { products: true },
    });
    if (!template) return { error: t("templateMissing") };
    if (template.userId !== session.userId) return { error: t("templateNotOwner") };
    const group = await prisma.group.findUnique({ where: { id: outing.groupId } });
    if (!group || group.ownerId !== session.userId) return { error: t("groupAdminOnlyTemplates") };
    templateProducts = template.products.map(p => ({
      name: p.name,
      unit: p.unit,
      pricePerUnitCt: p.pricePerUnitCt,
    }));
  }

  // Explicitly add creator as activity participant
  const activity = await prisma.activity.create({
    data: {
      outingId,
      name,
      pricingModel,
      notes,
      createdBy: session.userId,
    },
  });
  const activityId = activity.id;

  await prisma.activityParticipant.create({
    data: { activityId, userId: session.userId, role: "OWNER" },
  });

  // Create activity invitations for selected participants
  let invitedIds: string[] = [];
  try { invitedIds = JSON.parse(participantIds); } catch { invitedIds = []; }
  // Filter out the creator (self-joining prevention) and deduplicate
  invitedIds = invitedIds.filter((uid: string) => uid !== session.userId);
  for (const uid of invitedIds) {
    if (uid === session.userId) continue;
    // Check if already an activity participant
    const existing = await prisma.activityParticipant.findUnique({
      where: { activityId_userId: { activityId, userId: uid } },
    });
    if (existing) continue;
    // Check if already invited
    const existingInvite = await prisma.activityInvitation.findUnique({
      where: { activityId_inviteeUserId: { activityId, inviteeUserId: uid } },
    });
    if (existingInvite) continue;
    await prisma.activityInvitation.create({
      data: { activityId, inviterId: session.userId, inviteeUserId: uid, status: "PENDING" },
    });
  }

  // Clone products from the chosen template
  if (templateProducts.length > 0) {
    await prisma.activityProduct.createMany({
      data: templateProducts.map(p => ({ activityId, ...p })),
    });
  }

  await logEvent({
    groupId: outing.groupId,
    outingId,
    actorId: session.userId,
    eventType: "ACTIVITY_CREATED",
    entityType: "Activity",
    entityId: activity.id,
    metadata: { name, pricingModel, fromTemplate: templateProducts.length > 0 },
  });

  revalidatePath(`/groups/${outing.groupId}/outings/${outingId}`);
  return { success: true, id: activity.id };
}

/**
 * Delete an activity. Owner only, before outing is settled.
 */
export async function deleteActivityAction(activityId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) return { error: t("notFound") };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };
  if (outing.status === "SETTLED") return { error: t("outingSettledShort") };

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: session.userId } },
  });
  if (!participant || participant.role !== "OWNER") return { error: t("onlyOwner") };

  await prisma.activity.delete({ where: { id: activityId } });

  revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  return { success: true };
}

export async function createActivityInvitationAction(activityId: string, inviteeUserId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) return { error: t("activityNotFound") };
  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };
  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: session.userId } },
  });
  if (!caller || caller.role !== "OWNER") return { error: t("onlyOwner") };
  const outingParticipant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: inviteeUserId } },
  });
  if (!outingParticipant) return { error: t("inviteeNotParticipant") };
  const existing = await prisma.activityParticipant.findUnique({
    where: { activityId_userId: { activityId, userId: inviteeUserId } },
  });
  if (existing) return { error: t("alreadyParticipant") };
  const invite = await prisma.activityInvitation.create({
    data: { activityId, inviterId: session.userId, inviteeUserId, status: "PENDING" },
  });
  await logEvent({ groupId: outing.groupId, outingId: activity.outingId!, actorId: session.userId, eventType: "ACTIVITY_INVITATION_SENT", entityType: "ActivityInvitation", entityId: invite.id });
  return { success: true, id: invite.id };
}

export async function acceptActivityInvitationAction(invitationId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const invite = await prisma.activityInvitation.findUnique({ where: { id: invitationId } });
  if (!invite) return { error: t("inviteNotFound") };
  if (invite.inviteeUserId !== session.userId) return { error: t("notYourInvite") };
  if (invite.status !== "PENDING") return { error: t("alreadyResponded") };
  await prisma.$transaction(async (tx) => {
    await tx.activityInvitation.update({ where: { id: invitationId }, data: { status: "ACCEPTED" } });
    await tx.activityParticipant.create({ data: { activityId: invite.activityId, userId: session.userId, role: "MEMBER" } });
  });
  return { success: true };
}

export async function declineActivityInvitationAction(invitationId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const invite = await prisma.activityInvitation.findUnique({ where: { id: invitationId } });
  if (!invite) return { error: t("inviteNotFound") };
  if (invite.inviteeUserId !== session.userId) return { error: t("notYourInvite") };
  if (invite.status !== "PENDING") return { error: t("alreadyResponded") };
  await prisma.activityInvitation.update({ where: { id: invitationId }, data: { status: "DECLINED" } });
  return { success: true };
}

export async function closeActivityAction(activityId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) return { error: t("activityNotFound") };
  if (activity.status !== "OPEN") return { error: t("activityNotOpen") };
  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };
  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: session.userId } },
  });
  if (!participant || participant.role !== "OWNER") return { error: t("onlyOwner") };

  const errors: string[] = [];

  if (activity.pricingModel === "FIXED") {
    const usageRecords = await prisma.usageRecord.findMany({ where: { activityId }, include: { confirmations: true, product: true } });
    for (const record of usageRecords) {
      const label = `"${record.quantity} × ${record.product?.name ?? "item"}"`;
      if (record.status === "DISPUTED") errors.push(`${label} is disputed — resolve it before closing.`);
      const pending = record.confirmations.filter(c => c.status === "PENDING");
      if (pending.length > 0) errors.push(`${label} still needs confirmation from ${pending.length} ${pending.length === 1 ? "person" : "people"}.`);
    }
  } else {
    const lineItems = await prisma.lineItem.findMany({ where: { activityId } });
    if (lineItems.length === 0) errors.push("No variable data recorded.");
  }

  const payments = await prisma.activityPayment.findMany({ where: { activityId } });
  const totalPaid = payments.reduce((sum, p) => sum + p.amountCentimes, 0);
  let totalResponsibility = 0;

  if (activity.pricingModel === "FIXED") {
    const usageRecords = await prisma.usageRecord.findMany({ where: { activityId, status: { not: "DISPUTED" } } });
    for (const record of usageRecords) {
      const participants = await prisma.usageParticipant.findMany({ where: { usageRecordId: record.id } });
      if (participants.length > 0) totalResponsibility += Math.floor(record.totalCentimes / participants.length) * participants.length;
    }
  } else {
    const lineItems = await prisma.lineItem.findMany({ where: { activityId } });
    totalResponsibility = lineItems.reduce((sum, item) => sum + item.priceCentimes, 0);
  }

  const pendingInvites = await prisma.activityInvitation.findMany({ where: { activityId, status: "PENDING" } });
  if (pendingInvites.length > 0) {
    await prisma.activityInvitation.updateMany({ where: { activityId, status: "PENDING" }, data: { status: "DECLINED" } });
    errors.push(`${pendingInvites.length} pending ${pendingInvites.length === 1 ? "invitation" : "invitations"} auto-declined at closure.`);
  }

  if (totalPaid !== totalResponsibility && totalResponsibility > 0) {
    errors.push(`${formatDH(Math.abs(totalResponsibility - totalPaid))} of payments missing.`);
  }

  if (errors.length > 0) return { error: `Cannot close activity:\n${errors.join("\n")}` };

  await prisma.$transaction(async (tx) => {
    await tx.activity.update({ where: { id: activityId }, data: { status: "CLOSED", endTime: new Date() } });
    await tx.activityInvitation.updateMany({ where: { activityId, status: "PENDING" }, data: { status: "DECLINED" } });
  });

  await logEvent({ groupId: outing.groupId, outingId: activity.outingId!, actorId: session.userId, eventType: "ACTIVITY_CLOSED", entityType: "Activity", entityId: activityId });
  revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  return { success: true };
}
