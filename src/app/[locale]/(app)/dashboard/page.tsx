import { prisma } from "@/lib/prisma";
import { getSession } from "@/server/auth/session";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { acceptInvitationAction, declineInvitationAction } from "@/server/groups/actions";
import SubmitButton from "@/app/components/SubmitButton";
import { formatDH } from "@/lib/utils";
import { IconUsers } from "@/components/icons";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";

function activityTotal(a: any): number {
  if (a.pricingModel === "FIXED") {
    return (a.usageRecords ?? [])
      .filter((r: any) => r.status !== "DISPUTED")
      .reduce((s: number, r: any) => s + (r.totalCentimes ?? 0), 0);
  }
  return (a.lineItems ?? []).reduce((s: number, l: any) => s + (l.priceCentimes ?? 0), 0);
}

function myResponsibility(a: any, userId: string): number {
  if (a.pricingModel === "FIXED") {
    let mine = 0;
    for (const r of (a.usageRecords ?? []).filter((r: any) => r.status !== "DISPUTED")) {
      const parts = r.participants ?? [];
      if (parts.some((pp: any) => pp.userId === userId) && parts.length > 0) {
        mine += Math.floor((r.totalCentimes ?? 0) / parts.length);
      }
    }
    return mine;
  }
  return (a.lineItems ?? []).filter((l: any) => l.userId === userId).reduce((s: number, l: any) => s + (l.priceCentimes ?? 0), 0);
}

export default async function Dashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) redirect("/login");

  const t = await getTranslations({ locale: locale as AppLocale, namespace: "dashboard" });
  const tc = await getTranslations({ locale: locale as AppLocale, namespace: "common" });

  const memberships = await prisma.groupMember.findMany({
    where: { userId: session.userId },
    include: { group: true },
    orderBy: { joinedAt: "desc" },
  });

  const invitations = await prisma.groupInvitation.findMany({
    where: { inviteeUserId: session.userId, status: "PENDING" },
    include: { group: true },
  });

  // ---- Financial position: all outings the user participates in ----
  const myParticipations = await prisma.outingParticipant.findMany({
    where: { userId: session.userId },
    include: { outing: true },
  });
  const myOutingIds = myParticipations.map(p => p.outingId);
  const outingIdToGroupId = new Map(myParticipations.map(p => [p.outingId, p.outing.groupId]));

  const myActivities = myOutingIds.length
    ? await prisma.activity.findMany({
        where: { outingId: { in: myOutingIds } },
        include: {
          payments: true,
          usageRecords: { include: { participants: true } },
          lineItems: true,
          outing: true,
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const perOuting = new Map<string, { paid: number; resp: number }>();
  for (const a of myActivities) {
    if (!a.outingId) continue;
    const key: string = a.outingId;
    const e = perOuting.get(key) ?? { paid: 0, resp: 0 };
    e.paid += (a.payments ?? []).filter((p: any) => p.userId === session.userId).reduce((s: number, p: any) => s + p.amountCentimes, 0);
    e.resp += myResponsibility(a, session.userId);
    perOuting.set(key, e);
  }
  let owedToMe = 0;
  let iOwe = 0;
  for (const { paid, resp } of perOuting.values()) {
    const net = paid - resp;
    if (net > 0) owedToMe += net;
    else iOwe += -net;
  }
  const netBalance = owedToMe - iOwe;

  const recent = myActivities.slice(0, 5).map(a => ({
    id: a.id,
    name: a.name,
    outingName: (a as any).outing?.name ?? "Outing",
    outingId: a.outingId ?? "",
    groupId: (a.outingId && outingIdToGroupId.get(a.outingId)) ?? "",
    total: activityTotal(a),
    createdAt: a.createdAt,
  }));

  const spark = myActivities.slice(0, 12).reverse().map(activityTotal);
  const sparkMax = Math.max(1, ...spark);
  const sparkPoints = spark.map((v, i) => {
    const x = spark.length === 1 ? 50 : (i / (spark.length - 1)) * 100;
    const y = 28 - (v / sparkMax) * 24;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  // ---- Batched group stats ----
  const myGroupIds = memberships.map(m => m.group.id);
  const [memberCounts, allOutings, recentEvents] = await Promise.all([
    myGroupIds.length > 0
      ? prisma.groupMember.groupBy({ by: ["groupId"], where: { groupId: { in: myGroupIds } }, _count: true })
      : [],
    myGroupIds.length > 0
      ? prisma.outing.findMany({
          where: { groupId: { in: myGroupIds } },
          include: { _count: { select: { participants: true } } },
          orderBy: { createdAt: "desc" },
        })
      : [],
    myGroupIds.length > 0
      ? prisma.activityEvent.findMany({
          where: { groupId: { in: myGroupIds } },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { actor: { select: { displayName: true } } },
        })
      : [],
  ]);

  const memberCountMap = new Map(memberCounts.map(m => [m.groupId, m._count]));
  const outingIds = allOutings.map(o => o.id);
  const allActivities = outingIds.length > 0
    ? await prisma.activity.findMany({
        where: { outingId: { in: outingIds } },
        select: {
          id: true, outingId: true, pricingModel: true,
          payments: { select: { userId: true, amountCentimes: true } },
          usageRecords: { select: { totalCentimes: true, status: true, participants: { select: { userId: true } } } },
          lineItems: { select: { userId: true, priceCentimes: true } },
        },
      })
    : [];

  const outingActivityMap = new Map<string, typeof allActivities>();
  for (const a of allActivities) {
    const list = outingActivityMap.get(a.outingId!) ?? [];
    list.push(a);
    outingActivityMap.set(a.outingId!, list);
  }

  const groupsWithStats = memberships.map(m => {
    const outings = allOutings.filter(o => o.groupId === m.group.id);
    const activities = outings.flatMap(o => outingActivityMap.get(o.id) ?? []);
    const outingCount = outings.length;
    const settledCount = outings.filter(o => o.status === "SETTLED").length;
    let expenseTotal = 0, myPaid = 0, myResp = 0;
    for (const a of activities) {
      expenseTotal += activityTotal(a);
      myPaid += (a.payments ?? []).filter((p: any) => p.userId === session.userId).reduce((s: number, p: any) => s + p.amountCentimes, 0);
      myResp += myResponsibility(a, session.userId);
    }
    return { membership: m, memberCount: memberCountMap.get(m.group.id) ?? 0, outingCount, settledCount, expenseTotal, myNet: myPaid - myResp };
  });

  const eventLabels: Record<string, string> = {
    GROUP_CREATED: "created group",
    MEMBER_INVITED: "invited a member",
    MEMBER_JOINED: "joined",
    MEMBER_REMOVED: "removed a member",
    OUTING_CREATED: "created outing",
    OUTING_ACTIVATED: "activated outing",
    ACTIVITY_CREATED: "created activity",
    ACTIVITY_CLOSED: "closed activity",
    SETTLEMENT_GENERATED: "generated settlement",
    SETTLEMENT_FINALIZED: "finalized settlement",
    TRANSFER_MARKED_PAID: "marked transfer paid",
    TRANSFER_CONFIRMED: "confirmed transfer",
  };

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8 space-y-8">
      {/* Balance band */}
      <section>
        <div>
          <div className="text-[13px] text-muted">{t("netBalance")}</div>
            <div className={`money-hero text-[40px] font-extrabold ${netBalance > 0 ? "text-success" : netBalance < 0 ? "text-danger" : ""}`}>
              {netBalance > 0 ? "+" : ""}{formatDH(netBalance)}
            </div>
            <div className="flex items-center gap-5 mt-3 text-[14px]">
              <span className="text-muted">{t("owedToYou")} <span className="money font-bold text-success ms-1">{formatDH(owedToMe)}</span></span>
              <span className="w-px h-4 bg-border" aria-hidden="true"></span>
              <span className="text-muted">{t("youOwe")} <span className="money font-bold text-danger ms-1">{formatDH(iOwe)}</span></span>
            </div>
            {spark.length > 1 && (
              <svg viewBox="0 0 100 32" className="w-full h-9 mt-4 max-w-xs" preserveAspectRatio="none" aria-hidden="true">
                <polyline points={sparkPoints} fill="none" stroke="var(--action)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
              </svg>
            )}
          </div>
          <div className="divider mt-6"></div>
      </section>

        {/* Invitations */}
        {invitations.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-[15px] font-semibold flex items-center gap-2">
              <span className="status-dot bg-warn"></span>{t("pendingInvitations")}
              <span className="tag bg-warn-subtle text-warn">{invitations.length}</span>
            </h2>
            <div className="space-y-2">
              {invitations.map(inv => (
                <div key={inv.id} className="card-elevated p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-[15px]">{inv.group.name}</div>
                    <div className="text-[13px] text-muted">{t("invitePending")}</div>
                  </div>
                  <div className="flex gap-2">
                    <form action={async () => { "use server"; await acceptInvitationAction(inv.id); }}>
                      <SubmitButton className="btn-primary text-[13px] px-4 py-2" pendingText={tc("working")}>{t("accept")}</SubmitButton>
                    </form>
                    <form action={async () => { "use server"; await declineInvitationAction(inv.id); }}>
                      <button className="btn-secondary text-[13px] px-4 py-2">{t("decline")}</button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="min-w-0">
        {/* Groups */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold">{t("myGroups")}</h2>
            <span className="text-[12px] text-muted">{t("publicId")}: <span className="font-mono text-brand font-semibold">{user.publicId}</span></span>
          </div>
          {groupsWithStats.length === 0 ? (
            <div className="card border-dashed p-12 text-center">
              <div className="w-12 h-12 mx-auto rounded-[20px] bg-elevated text-muted flex items-center justify-center mb-3"><IconUsers size={22} /></div>
              <p className="font-medium text-[15px]">{t("noGroups")}</p>
              <p className="text-[13px] text-muted mt-1">{t("noGroupsSub")}</p>
            </div>
          ) : (
            <div className="ledger">
              {groupsWithStats.map(({ membership, memberCount, outingCount, settledCount, expenseTotal, myNet }) => (
                <Link key={membership.group.id} href={`/groups/${membership.group.id}`} className="ledger-row">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-[12px] bg-brand-subtle text-brand flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {membership.group.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={membership.group.image} alt={membership.group.name} className="w-full h-full object-cover" />
                      ) : (
                        <IconUsers size={16} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[14px] truncate">{membership.group.name}</div>
                      <div className="text-[12px] text-muted truncate">{t("groupMeta", { m: memberCount, o: outingCount, spent: formatDH(expenseTotal) })}</div>
                      {outingCount > 0 && (
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="progress-track flex-1 max-w-[160px]">
                            <div className="progress-fill navy" style={{ width: `${Math.round((settledCount / outingCount) * 100)}%` }} />
                          </div>
                          <div className="text-[11px] text-muted">{settledCount}/{outingCount} settled</div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-end flex-shrink-0 ms-3">
                    <div className={`money text-[15px] font-bold ${myNet > 0 ? "text-success" : myNet < 0 ? "text-danger" : "text-muted"}`}>
                      {myNet > 0 ? "+" : ""}{formatDH(myNet)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
          </div>
          <aside className="space-y-6 lg:sticky lg:top-6 min-w-0">
            <section id="new-group" className="card-elevated p-5">
              <h2 className="text-[15px] font-semibold mb-1">{t("newGroup")}</h2>
              <p className="text-[13px] text-muted mb-3">{t("newGroupSub")}</p>
              <form action={async (formData: FormData) => {
                "use server";
                const { createGroupAction } = await import("@/server/groups/actions");
                await createGroupAction(formData);
              }} className="flex flex-col gap-2.5">
                <input name="name" placeholder={t("groupNamePh")} required className="input flex-1" />
                <button className="btn-primary whitespace-nowrap">{t("createGroup")}</button>
              </form>
            </section>
            {recent.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-[15px] font-semibold">{t("recentMovement")}</h2>
                <div className="ledger">
                  {recent.map(r => (
                    <Link
                      key={r.id}
                      href={r.groupId && r.outingId ? `/groups/${r.groupId}/outings/${r.outingId}` : "/dashboard"}
                      className="ledger-row"
                    >
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium truncate">{r.name}</div>
                        <div className="text-[12px] text-muted truncate">{r.outingName}</div>
                      </div>
                      <span className="money text-[14px] font-semibold ms-3">{formatDH(r.total)}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
            {/* Activity feed */}
            {recentEvents.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-[15px] font-semibold">{t("activityFeed")}</h2>
                <div className="ledger">
                  {recentEvents.map(e => (
                    <div key={e.id} className="flex items-center gap-2.5 py-2 text-[13px]">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        e.eventType.includes("CREATED") || e.eventType.includes("JOINED") ? "bg-success" :
                        e.eventType.includes("FINALIZED") || e.eventType.includes("CONFIRMED") ? "bg-brand" :
                        e.eventType.includes("REMOVED") || e.eventType.includes("CLOSED") ? "bg-muted" : "bg-action"
                      }`} />
                      <span className="min-w-0 truncate flex-1">
                        {e.actor && <span className="font-medium">{e.actor.displayName}</span>} {eventLabels[e.eventType] || e.eventType.toLowerCase()}
                      </span>
                      <span className="text-[11px] text-muted flex-shrink-0">
                        {new Date(e.createdAt).toLocaleDateString(locale === "ar" ? "ar-MA" : locale, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
    </main>
  );
}
