import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type DashboardError = { ok: false; error: string };

export interface DashboardUser {
  id: string;
  username: string;
  displayName: string;
  publicId: string;
  isAdmin: boolean;
}

export interface DashboardGroupSummary {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  status: string;
  memberCount: number;
  joinedAt: Date;
  myNetCentimes: number;
  outingCount: number;
  settledCount: number;
  expenseTotalCentimes: number;
}

export interface DashboardInvitation {
  id: string;
  group: { id: string; name: string; image: string | null };
}

export interface RecentActivity {
  id: string;
  name: string;
  outingName: string;
  outingId: string;
  groupId: string;
  totalCentimes: number;
  createdAt: Date;
}

export interface DashboardData {
  user: DashboardUser;
  netBalanceCentimes: number;
  owedToMeCentimes: number;
  iOweCentimes: number;
  myGroups: DashboardGroupSummary[];
  invitations: DashboardInvitation[];
  recentActivities: RecentActivity[];
}

export type DashboardResult = { ok: true; data: DashboardData } | DashboardError;

type ActivityStat = Prisma.ActivityGetPayload<{
  include: {
    payments: { select: { userId: true; amountCentimes: true } };
    usageRecords: { include: { participants: { select: { userId: true } } } };
    lineItems: { select: { userId: true; priceCentimes: true } };
  };
}>;

export function activityTotal(a: ActivityStat): number {
  if (a.pricingModel === "FIXED") {
    return a.usageRecords
      .filter(r => r.status !== "DISPUTED")
      .reduce((s, r) => s + r.totalCentimes, 0);
  }
  return a.lineItems.reduce((s, l) => s + l.priceCentimes, 0);
}

export function myResponsibility(a: ActivityStat, userId: string): number {
  if (a.pricingModel === "FIXED") {
    let mine = 0;
    for (const r of a.usageRecords.filter(r => r.status !== "DISPUTED")) {
      const parts = r.participants;
      if (parts.some(pp => pp.userId === userId) && parts.length > 0) {
        mine += Math.floor(r.totalCentimes / parts.length);
      }
    }
    return mine;
  }
  return a.lineItems.filter(l => l.userId === userId).reduce((s, l) => s + l.priceCentimes, 0);
}

const dashboardActivityInclude = {
  payments: { select: { userId: true, amountCentimes: true } },
  usageRecords: { include: { participants: { select: { userId: true } } } },
  lineItems: { select: { userId: true, priceCentimes: true } },
  outing: { select: { name: true } },
} satisfies Prisma.ActivityInclude;

type DashboardActivity = Prisma.ActivityGetPayload<{ include: typeof dashboardActivityInclude }>;

export async function getDashboardService(userId: string): Promise<DashboardResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true, publicId: true, isAdmin: true },
  });
  if (!user) return { ok: false, error: "User not found" };

  const [memberships, invitations, myParticipations] = await Promise.all([
    prisma.groupMember.findMany({ where: { userId }, include: { group: true }, orderBy: { joinedAt: "desc" } }),
    prisma.groupInvitation.findMany({ where: { inviteeUserId: userId, status: "PENDING" }, include: { group: true } }),
    prisma.outingParticipant.findMany({ where: { userId }, include: { outing: true } }),
  ]);

  const myOutingIds = myParticipations.map(p => p.outingId);
  const outingIdToGroupId = new Map(myParticipations.map(p => [p.outingId, p.outing.groupId]));

  const myActivities: DashboardActivity[] = myOutingIds.length
    ? await prisma.activity.findMany({
        where: { outingId: { in: myOutingIds } },
        include: dashboardActivityInclude,
        orderBy: { createdAt: "desc" },
      })
    : [];

  const perOuting = new Map<string, { paid: number; resp: number }>();
  for (const a of myActivities) {
    if (!a.outingId) continue;
    const key = a.outingId;
    const e = perOuting.get(key) ?? { paid: 0, resp: 0 };
    e.paid += a.payments.filter(p => p.userId === userId).reduce((s, p) => s + p.amountCentimes, 0);
    e.resp += myResponsibility(a, userId);
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

  const recentActivities = myActivities.slice(0, 5).map(a => ({
    id: a.id,
    name: a.name,
    outingName: a.outing?.name ?? "Outing",
    outingId: a.outingId ?? "",
    groupId: (a.outingId && outingIdToGroupId.get(a.outingId)) ?? "",
    totalCentimes: activityTotal(a),
    createdAt: a.createdAt,
  }));

  const myGroupIds = memberships.map(m => m.group.id);
  const memberCounts = myGroupIds.length > 0
    ? await prisma.groupMember.groupBy({ by: ["groupId"], where: { groupId: { in: myGroupIds } }, _count: true })
    : [];
  const memberCountMap = new Map(memberCounts.map(m => [m.groupId, m._count]));

  // Per-group financial + outing stats (mirrors the web dashboard computation).
  const allGroupOutings = myGroupIds.length > 0
    ? await prisma.outing.findMany({
        where: { groupId: { in: myGroupIds } },
        include: { _count: { select: { participants: true } } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const allGroupOutingIds = allGroupOutings.map(o => o.id);
  const groupActivities: DashboardActivity[] = allGroupOutingIds.length > 0
    ? await prisma.activity.findMany({
        where: { outingId: { in: allGroupOutingIds } },
        include: dashboardActivityInclude,
      })
    : [];
  const outingActivityMap = new Map<string, DashboardActivity[]>();
  for (const a of groupActivities) {
    if (!a.outingId) continue;
    const list = outingActivityMap.get(a.outingId) ?? [];
    list.push(a);
    outingActivityMap.set(a.outingId, list);
  }
  const groupOutingCount = new Map<string, number>();
  const groupSettledCount = new Map<string, number>();
  for (const o of allGroupOutings) {
    groupOutingCount.set(o.groupId, (groupOutingCount.get(o.groupId) ?? 0) + 1);
    if (o.status === "SETTLED") groupSettledCount.set(o.groupId, (groupSettledCount.get(o.groupId) ?? 0) + 1);
  }

  const myGroups: DashboardGroupSummary[] = memberships.map(m => {
    let expenseTotal = 0, myPaid = 0, myResp = 0;
    for (const o of allGroupOutings.filter(x => x.groupId === m.group.id)) {
      for (const a of outingActivityMap.get(o.id) ?? []) {
        expenseTotal += activityTotal(a);
        myPaid += a.payments.filter(p => p.userId === userId).reduce((s, p) => s + p.amountCentimes, 0);
        myResp += myResponsibility(a, userId);
      }
    }
    return {
      id: m.group.id,
      name: m.group.name,
      description: m.group.description,
      image: m.group.image,
      status: m.group.status,
      memberCount: memberCountMap.get(m.group.id) ?? 0,
      joinedAt: m.joinedAt,
      myNetCentimes: myPaid - myResp,
      outingCount: groupOutingCount.get(m.group.id) ?? 0,
      settledCount: groupSettledCount.get(m.group.id) ?? 0,
      expenseTotalCentimes: expenseTotal,
    };
  });

  return {
    ok: true,
    data: {
      user,
      netBalanceCentimes: netBalance,
      owedToMeCentimes: owedToMe,
      iOweCentimes: iOwe,
      myGroups,
      invitations: invitations.map(i => ({ id: i.id, group: { id: i.groupId, name: i.group.name, image: i.group.image } })),
      recentActivities,
    },
  };
}