import { prisma } from "@/lib/prisma";
import { logEvent } from "@/server/audit";
import { activityResponsibility, type ActivityStatsInput } from "./stats";
import { fail, ok, type ServiceResult } from "./types";

export type PaymentPayload = {
  id: string;
  activityId: string;
  userId: string;
  displayName: string;
  amountCentimes: number;
};

async function calculateActivityResponsibility(activityId: string): Promise<number> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: {
      usageRecords: { include: { participants: true } },
      lineItems: true,
      payments: true,
    },
  });
  if (!activity) return 0;
  return activityResponsibility(activity as ActivityStatsInput);
}

type ActivityRow = NonNullable<Awaited<ReturnType<typeof prisma.activity.findUnique>>>;
type OutingRow = NonNullable<Awaited<ReturnType<typeof prisma.outing.findUnique>>>;

async function loadPaymentContext(
  activityId: string,
  userId: string
): Promise<{ error: ServiceResult<never> } | { activity: ActivityRow; outing: OutingRow }> {
  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) return { error: fail("activityNotFound", 404) };
  if (!activity.outingId) return { error: fail("outingNotFound", 404) };

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
  if (!outing) return { error: fail("outingNotFound", 404) };

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId, userId } },
  });
  if (!caller) return { error: fail("onlyOwner", 403) };
  if (caller.role !== "OWNER") {
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: outing.groupId, userId } },
    });
    if (!member || !member.canRecordPayments) return { error: fail("onlyOwner", 403) };
  }

  return { activity, outing };
}

export async function recordActivityPayment(
  userId: string,
  input: { activityId?: string; userId?: string; amountCentimes?: number }
): Promise<ServiceResult<{ payment: PaymentPayload }>> {
  const activityId = (input.activityId ?? "").trim();
  const targetUserId = (input.userId ?? "").trim();

  if (!activityId) return fail("activityRequired", 400);
  if (!targetUserId) return fail("userRequired", 400);
  if (input.amountCentimes === undefined) return fail("amountRequired", 400);
  if (!Number.isSafeInteger(input.amountCentimes) || input.amountCentimes < 1) return fail("amountPositive", 400);

  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) return fail("activityNotFound", 404);
  if (activity.status !== "OPEN") return fail("activityNotOpen", 409);
  if (!activity.outingId) return fail("outingNotFound", 404);

  const outing = await prisma.outing.findUnique({ where: { id: activity.outingId } });
  if (!outing) return fail("outingNotFound", 404);

  const caller = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId: activity.outingId, userId } },
  });
  if (!caller) return fail("onlyOwner", 403);
  if (caller.role !== "OWNER") {
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: outing.groupId, userId } },
    });
    if (!member || !member.canRecordPayments) return fail("onlyOwner", 403);
  }

  const totalResponsibility = await calculateActivityResponsibility(activityId);
  const existingPayments = await prisma.activityPayment.findMany({ where: { activityId } });
  const totalPaid = existingPayments.reduce((sum, p) => sum + p.amountCentimes, 0);

  if (totalPaid + input.amountCentimes > totalResponsibility) {
    const maxAllowed = totalResponsibility - totalPaid;
    if (maxAllowed <= 0) return fail("coveredAll", 409);
    return fail(`Payment would exceed responsibility. Maximum additional: ${(maxAllowed / 100).toFixed(2)} DH`, 409);
  }

  const payment = await prisma.activityPayment.create({
    data: { activityId, userId: targetUserId, amountCentimes: input.amountCentimes },
    include: { user: { select: { displayName: true } } },
  });

  await logEvent({
    groupId: outing.groupId,
    outingId: activity.outingId,
    actorId: userId,
    eventType: "ACTIVITY_PAYMENT_RECORDED",
    entityType: "ActivityPayment",
    entityId: activityId,
    metadata: { userId: targetUserId, amountCentimes: input.amountCentimes },
  });

  return ok({
    payment: {
      id: payment.id,
      activityId: payment.activityId,
      userId: payment.userId,
      displayName: payment.user.displayName,
      amountCentimes: payment.amountCentimes,
    },
  });
}

export async function updateActivityPayment(
  userId: string,
  paymentId: string,
  input: { amountCentimes?: number; userId?: string }
): Promise<ServiceResult<{ payment: PaymentPayload }>> {
  const payment = await prisma.activityPayment.findUnique({ where: { id: paymentId } });
  if (!payment) return fail("notFound", 404);

  const ctx = await loadPaymentContext(payment.activityId, userId);
  if ("error" in ctx) return ctx.error;
  if (ctx.outing.status === "SETTLED") return fail("outingSettledLocked", 409);

  if (input.amountCentimes !== undefined && (!Number.isSafeInteger(input.amountCentimes) || input.amountCentimes < 0)) {
    return fail("amountPositive", 400);
  }

  if (input.amountCentimes !== undefined) {
    const totalResponsibility = await calculateActivityResponsibility(payment.activityId);
    const otherPayments = await prisma.activityPayment.findMany({
      where: { activityId: payment.activityId, id: { not: paymentId } },
    });
    const otherTotal = otherPayments.reduce((sum, p) => sum + p.amountCentimes, 0);
    if (otherTotal + input.amountCentimes > totalResponsibility) {
      const maxAllowed = totalResponsibility - otherTotal;
      return fail(`Maximum allowed: ${(maxAllowed / 100).toFixed(2)} DH`, 409);
    }
  }

  const updated = await prisma.activityPayment.update({
    where: { id: paymentId },
    data: {
      amountCentimes: input.amountCentimes ?? payment.amountCentimes,
      userId: input.userId ?? payment.userId,
    },
    include: { user: { select: { displayName: true } } },
  });

  return ok({
    payment: {
      id: updated.id,
      activityId: updated.activityId,
      userId: updated.userId,
      displayName: updated.user.displayName,
      amountCentimes: updated.amountCentimes,
    },
  });
}

export async function deleteActivityPayment(
  userId: string,
  paymentId: string
): Promise<ServiceResult<{ success: true }>> {
  const payment = await prisma.activityPayment.findUnique({ where: { id: paymentId } });
  if (!payment) return fail("notFound", 404);

  const ctx = await loadPaymentContext(payment.activityId, userId);
  if ("error" in ctx) return ctx.error;

  await prisma.activityPayment.delete({ where: { id: paymentId } });
  return ok({ success: true });
}
