export type ActivityStatsInput = {
  pricingModel: string;
  usageRecords: { status: string; totalCentimes: number; participants: { userId: string }[] }[];
  lineItems: { userId: string; priceCentimes: number }[];
  payments: { userId: string; amountCentimes: number }[];
};

export type ParticipantWithUser = {
  userId: string;
  user: { displayName: string };
};

export type MemberBalance = {
  userId: string;
  displayName: string;
  totalPaid: number;
  totalResponsibility: number;
  netBalance: number;
};

export function activityResponsibility(a: ActivityStatsInput): number {
  if (a.pricingModel === "FIXED") {
    let total = 0;
    for (const r of a.usageRecords) {
      if (r.status === "DISPUTED") continue;
      const n = r.participants.length;
      if (n > 0) total += Math.floor(r.totalCentimes / n) * n;
    }
    return total;
  }
  return a.lineItems.reduce((s, l) => s + l.priceCentimes, 0);
}

export function activityPaid(a: ActivityStatsInput): number {
  return a.payments.reduce((s, p) => s + p.amountCentimes, 0);
}

export function computeMemberBalances(
  participants: ParticipantWithUser[],
  activities: ActivityStatsInput[]
): MemberBalance[] {
  return participants.map(p => {
    let paid = 0;
    let responsibility = 0;
    for (const a of activities) {
      for (const pay of a.payments) {
        if (pay.userId === p.userId) paid += pay.amountCentimes;
      }
      if (a.pricingModel === "FIXED") {
        for (const r of a.usageRecords) {
          if (r.status === "DISPUTED") continue;
          const n = r.participants.length;
          if (n > 0 && r.participants.some(pp => pp.userId === p.userId)) {
            responsibility += Math.floor(r.totalCentimes / n);
          }
        }
      } else {
        for (const l of a.lineItems) {
          if (l.userId === p.userId) responsibility += l.priceCentimes;
        }
      }
    }
    return {
      userId: p.userId,
      displayName: p.user.displayName,
      totalPaid: paid,
      totalResponsibility: responsibility,
      netBalance: paid - responsibility,
    };
  });
}
