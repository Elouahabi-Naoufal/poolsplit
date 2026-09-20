import { prisma } from "@/lib/prisma";
import { getSession } from "@/server/auth/session";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import ClientOutingPage from "@/components/ClientOutingPage";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";

export default async function OutingPage({ params }: { params: Promise<{ id: string; outingId: string; locale: string }> }) {
  const { id: groupId, outingId, locale } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) notFound();

  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing || outing.groupId !== groupId) notFound();

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId: session.userId } },
  });
  if (!participant) {
    const tErr = await getTranslations({ locale: locale as AppLocale, namespace: "errors" });
    return <div className="p-10 text-center">{tErr("notOutingParticipant")}</div>;
  }

  const isOwner = participant.role === "OWNER";
  const isGroupAdmin = group.ownerId === session.userId;
  const templates = isGroupAdmin
    ? await prisma.activityTemplate.findMany({
        where: { userId: session.userId },
        include: { products: true },
        orderBy: { updatedAt: "desc" },
      })
    : [];

  const participants = await prisma.outingParticipant.findMany({ where: { outingId }, include: { user: true } });
  const usersMap = new Map(participants.map(p => [p.userId, p.user.displayName]));

  const activities = await prisma.activity.findMany({
    where: { outingId },
    include: {
      products: true,
      usageRecords: { include: { participants: true, confirmations: true } },
      lineItems: true,
      payments: true,
      members: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const allActivitiesClosed = activities.length > 0 && activities.every(a => a.status === "CLOSED");
  const hasSettlement = await prisma.settlement.findFirst({ where: { outingId } });

  const activityStats = activities.map(a => {
    let responsibility = 0;
    const paid = a.payments.reduce((s, p) => s + p.amountCentimes, 0);
    if (a.pricingModel === "FIXED") {
      for (const r of a.usageRecords.filter(r => r.status !== "DISPUTED")) {
        if (r.participants.length > 0) {
          const share = Math.floor(r.totalCentimes / r.participants.length);
          responsibility += share * r.participants.length;
        }
      }
    } else {
      responsibility = a.lineItems.reduce((s, l) => s + l.priceCentimes, 0);
    }
    return { ...a, responsibility, paid, balance: paid - responsibility };
  });

  const totalResponsibility = activityStats.reduce((s, a) => s + a.responsibility, 0);
  const totalPaid = activityStats.reduce((s, a) => s + a.paid, 0);

  const memberBalances = participants.map(p => {
    const paid = activityStats.reduce((s, a) => s + a.payments.filter(pay => pay.userId === p.userId).reduce((s2, pay) => s2 + pay.amountCentimes, 0), 0);
    const resp = activityStats.reduce((s, a) => {
      if (a.pricingModel === "FIXED") {
        let myResp = 0;
        for (const r of a.usageRecords.filter(r => r.status !== "DISPUTED")) {
          const myPart = r.participants.find(pp => pp.userId === p.userId);
          if (myPart && r.participants.length > 0) {
            myResp += Math.floor(r.totalCentimes / r.participants.length);
          }
        }
        return s + myResp;
      } else {
        return s + a.lineItems.filter(l => l.userId === p.userId).reduce((s2, l) => s2 + l.priceCentimes, 0);
      }
    }, 0);
    return { userId: p.userId, displayName: p.user.displayName, totalPaid: paid, totalResponsibility: resp, netBalance: paid - resp };
  });

  return (
    <ClientOutingPage
      groupId={groupId}
      outingId={outingId}
      isOwner={isOwner}
      sessionUserId={session.userId}
      participants={participants}
      usersMap={usersMap}
      activities={activities}
      activityStats={activityStats}
      memberBalances={memberBalances}
      totalResponsibility={totalResponsibility}
      totalPaid={totalPaid}
      allActivitiesClosed={allActivitiesClosed}
      hasSettlement={!!hasSettlement}
      outing={outing}
      groupName={group.name}
      templates={templates}
      isGroupAdmin={isGroupAdmin}
    />
  );
}
