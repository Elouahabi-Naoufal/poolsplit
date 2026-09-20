"use server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/server/auth/session";
import { logEvent } from "@/server/audit";
import { revalidatePath } from "next/cache";
import { parseDHToCentimes } from "@/lib/utils";
import { userError } from "@/lib/errors";
import { getTranslations } from "next-intl/server";

/**
 * Record a payment for an activity. Outing owner or any outing participant
 * granted the canRecordPayments group permission can record payments.
 * Overflow guard: total payments cannot exceed total responsibility.
 */
export async function recordActivityPaymentAction(formData: FormData) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const activityId = formData.get("activityId") as string;
  const userId = formData.get("userId") as string;
  const amountDH = formData.get("amountDH") as string;

  if (!activityId) return { error: t("activityRequired") };
  if (!userId) return { error: t("userRequired") };
  if (!amountDH) return { error: t("amountRequired") };

  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) return { error: t("activityNotFound") };
  if (activity.status !== "OPEN") return { error: t("activityNotOpen") };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: session.userId } },
  });
  if (!caller) return { error: t("onlyOwner") };
  if (caller.role !== "OWNER") {
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: outing.groupId, userId: session.userId } },
    });
    if (!member || !member.canRecordPayments) return { error: t("onlyOwner") };
  }

  let amountCentimes: number;
  try {
    amountCentimes = parseDHToCentimes(amountDH, { minCentimes: 1, field: "Amount" });
  } catch (e: unknown) {
    return { error: userError(e, "Could not record this payment. Please try again.") };
  }

  // Overflow guard: check total payments don't exceed responsibility
  const totalResponsibility = await calculateActivityResponsibility(activityId);
  const existingPayments = await prisma.activityPayment.findMany({ where: { activityId } });
  const totalPaid = existingPayments.reduce((sum, p) => sum + p.amountCentimes, 0);

  if (totalPaid + amountCentimes > totalResponsibility) {
    const maxAllowed = totalResponsibility - totalPaid;
    if (maxAllowed <= 0) {
      return { error: t("coveredAll") };
    }
    return { error: `Payment would exceed responsibility. Maximum additional: ${(maxAllowed / 100).toFixed(2)} DH` };
  }

  // Multiple payment records per participant are allowed
  await prisma.activityPayment.create({
    data: {
      activityId,
      userId,
      amountCentimes,
    },
  });

  await logEvent({
    groupId: outing.groupId,
    outingId: activity.outingId!,
    actorId: session.userId,
    eventType: "ACTIVITY_PAYMENT_RECORDED",
    entityType: "ActivityPayment",
    entityId: activityId,
    metadata: { userId, amountCentimes },
  });

  revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  return { success: true };
}

/**
 * Update a payment. Owner or canRecordPayments grantee, while activity is open.
 */
export async function updateActivityPaymentAction(paymentId: string, amountDH: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const payment = await prisma.activityPayment.findUnique({ where: { id: paymentId } });
  if (!payment) return { error: t("notFound") };

  const activity = await prisma.activity.findUnique({ where: { id: payment.activityId } });
  if (!activity) return { error: t("activityNotFound") };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };
  if (outing.status === "SETTLED") return { error: t("outingSettledLocked") };

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: session.userId } },
  });
  if (!caller) return { error: t("onlyOwner") };
  if (caller.role !== "OWNER") {
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: outing.groupId, userId: session.userId } },
    });
    if (!member || !member.canRecordPayments) return { error: t("onlyOwner") };
  }
  void 0;

  let newAmount: number;
  try {
    newAmount = parseDHToCentimes(amountDH, { minCentimes: 0, field: "Amount" });
  } catch (e: unknown) {
    return { error: userError(e, "Could not update this payment. Please try again.") };
  }

  // Overflow guard
  const totalResponsibility = await calculateActivityResponsibility(payment.activityId);
  const otherPayments = await prisma.activityPayment.findMany({
    where: { activityId: payment.activityId, id: { not: paymentId } },
  });
  const otherTotal = otherPayments.reduce((sum, p) => sum + p.amountCentimes, 0);

  if (otherTotal + newAmount > totalResponsibility) {
    const maxAllowed = totalResponsibility - otherTotal;
    return { error: `Maximum allowed: ${(maxAllowed / 100).toFixed(2)} DH` };
  }

  await prisma.activityPayment.update({
    where: { id: paymentId },
    data: { amountCentimes: newAmount },
  });

  revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  return { success: true };
}

/**
 * Delete a payment. Owner or canRecordPayments grantee.
 */
export async function deleteActivityPaymentAction(paymentId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const payment = await prisma.activityPayment.findUnique({ where: { id: paymentId } });
  if (!payment) return { error: t("notFound") };

  const activity = await prisma.activity.findUnique({ where: { id: payment.activityId } });
  if (!activity) return { error: t("activityNotFound") };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId! } });
  if (!outing) return { error: t("outingNotFound") };

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId!, userId: session.userId } },
  });
  if (!caller) return { error: t("onlyOwner") };
  if (caller.role !== "OWNER") {
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: outing.groupId, userId: session.userId } },
    });
    if (!member || !member.canRecordPayments) return { error: t("onlyOwner") };
  }
  void 0;

  await prisma.activityPayment.delete({ where: { id: paymentId } });
  revalidatePath(`/groups/${outing.groupId}/outings/${activity.outingId}`);
  return { success: true };
}

/**
 * Calculate total responsibility for an activity.
 * For FIXED: sum of (usage records / participants) for non-disputed records.
 * For VARIABLE: sum of all line items.
 */
async function calculateActivityResponsibility(activityId: string): Promise<number> {
  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) return 0;

  if (activity.pricingModel === "FIXED") {
    const records = await prisma.usageRecord.findMany({
      where: { activityId, status: { not: "DISPUTED" } },
    });
    let total = 0;
    for (const record of records) {
      const participants = await prisma.usageParticipant.findMany({
        where: { usageRecordId: record.id },
      });
      if (participants.length > 0) {
        // Each participant is responsible for their share
        const sharePerPerson = Math.floor(record.totalCentimes / participants.length);
        total += sharePerPerson * participants.length;
      }
    }
    return total;
  } else {
    const lineItems = await prisma.lineItem.findMany({ where: { activityId } });
    return lineItems.reduce((sum, item) => sum + item.priceCentimes, 0);
  }
}
