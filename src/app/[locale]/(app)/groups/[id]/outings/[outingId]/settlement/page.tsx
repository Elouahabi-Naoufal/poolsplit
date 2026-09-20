import { prisma } from "@/lib/prisma";
import { getSession } from "@/server/auth/session";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { formatDH } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { IconCheck } from "@/components/icons";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";

export default async function SettlementPage({ params }: { params: Promise<{ id: string; outingId: string; locale: string }> }) {
  const { id: groupId, outingId, locale } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const outing = await prisma.outing.findUnique({ where: { id: outingId } });
  if (!outing || outing.groupId !== groupId) notFound();

  const participant = await prisma.outingParticipant.findUnique({
    where: { outingId_userId: { outingId, userId: session.userId } },
  });
  if (!participant) {
    const tErr = await getTranslations({ locale: locale as AppLocale, namespace: "settlement" });
    return <div className="p-10 text-center">{tErr("notParticipant")}</div>;
  }
  const isOwner = participant.role === "OWNER";

  const t = await getTranslations({ locale: locale as AppLocale, namespace: "settlement" });
  const tc = await getTranslations({ locale: locale as AppLocale, namespace: "common" });
  const tn = await getTranslations({ locale: locale as AppLocale, namespace: "nav" });

  const settlement = await prisma.settlement.findFirst({ where: { outingId } });
  if (!settlement) {
    const openCount = await prisma.activity.count({ where: { outingId, status: "OPEN" } });
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        <div>
          <nav aria-label={tc("breadcrumb")} className="text-[13px] text-muted mb-1.5">
            <Link href="/dashboard" className="hover:text-foreground transition-colors">{tn("groups")}</Link>
            <span className="mx-1.5">/</span>
            <Link href={`/groups/${groupId}`} className="hover:text-foreground transition-colors">{t("groupCrumb")}</Link>
            <span className="mx-1.5">/</span>
            <Link href={`/groups/${groupId}/outings/${outingId}`} className="hover:text-foreground transition-colors">{outing.name}</Link>
            <span className="mx-1.5">/</span>
            <span className="text-foreground font-medium">{t("title")}</span>
          </nav>
          <h1 className="font-extrabold text-[26px] tracking-tight">{t("title")}</h1>
        </div>
        <div className="card border-dashed p-10 text-center space-y-3">
          <p className="font-semibold text-[15px]">{t("noSettlement")}</p>
          {!isOwner ? (
            <p className="text-[13px] text-muted">{t("ownerMissing")}</p>
          ) : openCount > 0 ? (
            <p className="text-[13px] text-muted">{t("closeFirst")}</p>
          ) : (
            <form action={async () => {
              "use server";
              const { finalizeSettlementAction } = await import("@/server/settlement/actions");
              await finalizeSettlementAction(outingId);
            }}>
              <button className="btn-navy">{t("generateBtn")}</button>
            </form>
          )}
          <div>
            <Link href={`/groups/${groupId}/outings/${outingId}`} className="text-[13px] text-brand hover:underline">{t("backToOuting")}</Link>
          </div>
        </div>
      </main>
    );
  }

  const transfers = await prisma.settlementTransfer.findMany({ where: { settlementId: settlement.id } });
  const allParticipants = await prisma.outingParticipant.findMany({ where: { outingId }, include: { user: true } });
  const allUsers = allParticipants.map(p => p.user);
  const userMap = new Map(allUsers.map(u => [u.id, u.displayName]));

  const activities = await prisma.activity.findMany({
    where: { outingId },
    include: { products: true, usageRecords: { include: { participants: true } }, lineItems: true, payments: true },
  });

  const memberBalances = allParticipants.map(p => {
    const paid = activities.reduce((s, a) => s + a.payments.filter(pay => pay.userId === p.userId).reduce((s2, pay) => s2 + pay.amountCentimes, 0), 0);
    const resp = activities.reduce((s, a) => {
      if (a.pricingModel === "FIXED") {
        let myResp = 0;
        for (const r of a.usageRecords) {
          if (r.status === "DISPUTED") continue;
          if (r.participants.find((pp: any) => pp.userId === p.userId) && r.participants.length > 0) {
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

  // Per-member, per-activity breakdown explaining where every number comes from.
  const breakdowns = allParticipants.map(p => {
    const rows = activities.map(a => {
      const fixedShares: { productName: string; quantity: number; totalCentimes: number; n: number; share: number }[] = [];
      const items: { description: string; priceCentimes: number }[] = [];
      let memberResp = 0;
      let memberPaidAct = 0;

      if (a.pricingModel === "FIXED") {
        for (const r of a.usageRecords) {
          if (r.status === "DISPUTED") continue;
          const n = r.participants.length;
          if (n === 0) continue;
          const product = a.products.find((pr: any) => pr.id === r.productId);
          if (r.participants.some((pp: any) => pp.userId === p.userId)) {
            const share = Math.floor(r.totalCentimes / n);
            memberResp += share;
            fixedShares.push({
              productName: product?.name ?? "?",
              quantity: r.quantity,
              totalCentimes: r.totalCentimes,
              n,
              share,
            });
          }
        }
      } else {
        for (const l of a.lineItems) {
          if (l.userId === p.userId) {
            items.push({ description: l.description, priceCentimes: l.priceCentimes });
            memberResp += l.priceCentimes;
          }
        }
      }

      for (const pay of a.payments) {
        if (pay.userId === p.userId) memberPaidAct += pay.amountCentimes;
      }

      return { activityName: a.name, pricingModel: a.pricingModel, memberResp, memberPaidAct, fixedShares, items };
    });
    return { userId: p.userId, rows };
  });

  const me = memberBalances.find(b => b.userId === session.userId);
  const myNet = me?.netBalance ?? 0;
  const myTransfersIn = transfers.filter(t => t.toUserId === session.userId);
  const myTransfersOut = transfers.filter(t => t.fromUserId === session.userId);
  const toReceive = myTransfersIn.reduce((s, t) => s + t.amountCentimes, 0);
  const toPay = myTransfersOut.reduce((s, t) => s + t.amountCentimes, 0);

  const doneCount = transfers.filter(t => t.status !== "PENDING").length;
  const allSettled = transfers.length > 0 && doneCount === transfers.length;

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        <div>
          <nav aria-label={tc("breadcrumb")} className="text-[13px] text-muted mb-1.5">
            <Link href="/dashboard" className="hover:text-foreground transition-colors">{tn("groups")}</Link>
            <span className="mx-1.5">/</span>
            <Link href={`/groups/${groupId}`} className="hover:text-foreground transition-colors">{t("groupCrumb")}</Link>
            <span className="mx-1.5">/</span>
            <Link href={`/groups/${groupId}/outings/${outingId}`} className="hover:text-foreground transition-colors">{outing.name}</Link>
            <span className="mx-1.5">/</span>
            <span className="text-foreground font-medium">{t("title")}</span>
          </nav>
          <div className="flex items-end justify-between gap-4">
          <h1 className="font-extrabold text-[26px] tracking-tight">{t("title")}</h1>
          {isOwner && (
            <div className="flex gap-2 flex-shrink-0">
              <form action={async () => {
                "use server";
                const { recalculateSettlementAction } = await import("@/server/settlement/actions");
                await recalculateSettlementAction(outingId);
              }}>
                <button className="btn-secondary btn-sm">{t("recalculate")}</button>
              </form>
              <form action={async () => {
                "use server";
                const { finalizeSettlementAction } = await import("@/server/settlement/actions");
                await finalizeSettlementAction(outingId);
              }}>
                <button className="btn-navy btn-sm">{t("finalize")}</button>
              </form>
            </div>
          )}
          </div>
        </div>
        {/* Personal result — borderless band */}
        <section>
          <div className="text-[13px] text-muted mb-1">{t("yourSettlement")} · {outing.name}</div>
          <div className={`money-hero text-[40px] font-extrabold ${myNet > 0 ? "text-success" : myNet < 0 ? "text-danger" : "text-muted"}`}>
            {myNet > 0 ? "+" : ""}{formatDH(myNet)}
          </div>
          <p className="text-[13px] text-muted mt-1">
            {myNet > 0 ? t("receiveDiff") : myNet < 0 ? t("payDiff") : t("settledUpYou")}
          </p>
          <div className="flex items-center gap-5 mt-3 text-[14px]">
            <span className="text-muted">{t("toReceive")} <span className="money font-bold text-success ms-1">{formatDH(toReceive)}</span></span>
            <span className="w-px h-4 bg-border" aria-hidden="true"></span>
            <span className="text-muted">{t("toPay")} <span className="money font-bold text-danger ms-1">{formatDH(toPay)}</span></span>
          </div>
          {transfers.length > 0 && (
            <div className="mt-4 max-w-xs">
              <div className="progress-track">
                <div className="progress-fill navy" style={{ width: `${Math.round((doneCount / transfers.length) * 100)}%` }} />
              </div>
              <div className="text-[12px] text-muted mt-1.5">{t("confirmedCount", { done: doneCount, total: transfers.length })} {t("transfersCount", { count: transfers.length })}</div>
            </div>
          )}
          <div className="divider mt-6"></div>
        </section>

        {/* Transfers + confirmation flow */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="min-w-0 order-1 space-y-6">
        {/* Flow visualization */}
        {transfers.length > 0 && (
          <section className="surface-20 p-5 animate-in">
            <h3 className="section-label mb-3">{t("whoOwesWhom")}</h3>
            <div className="flex flex-wrap gap-3 items-center">
              {transfers.map((tr, i) => (
                <div key={tr.id} className="flex items-center gap-2 bg-surface rounded-[14px] px-3.5 py-2.5 border border-border">
                  <div className="flex items-center gap-2 text-[14px]">
                    <div className="flex flex-col items-center">
                      <span className="font-semibold">{userMap.get(tr.fromUserId) || "?"}</span>
                      <span className={`text-[11px] ${memberBalances.find(b => b.userId === tr.fromUserId)?.netBalance && (memberBalances.find(b => b.userId === tr.fromUserId)?.netBalance ?? 0) < 0 ? "text-danger" : "text-success"}`}>
                        {formatDH(memberBalances.find(b => b.userId === tr.fromUserId)?.netBalance ?? 0)}
                      </span>
                    </div>
                    <div className="flex flex-col items-center mx-1.5">
                      <span className="text-[11px] text-muted">{t("transferN", { n: i + 1 })}</span>
                      <span className="money text-[15px] font-bold text-navy">{formatDH(tr.amountCentimes)}</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="font-semibold">{userMap.get(tr.toUserId) || "?"}</span>
                      <span className={`text-[11px] ${(memberBalances.find(b => b.userId === tr.toUserId)?.netBalance ?? 0) > 0 ? "text-success" : "text-danger"}`}>
                        {formatDH(memberBalances.find(b => b.userId === tr.toUserId)?.netBalance ?? 0)}
                      </span>
                    </div>
                  </div>
                  {tr.status === "CONFIRMED" ? (
                    <span className="tag bg-success-subtle text-success"><IconCheck size={11} /></span>
                  ) : tr.status === "PAID" ? (
                    <span className="tag bg-success-subtle text-success"><IconCheck size={11} /></span>
                  ) : (
                    <span className="tag bg-warn-subtle text-warn">···</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* How the numbers add up */}
        <section className="space-y-1">
          <h3 className="section-label">{t("breakdown")}</h3>
          <div className="space-y-3">
            {breakdowns.map(bd => {
              const bal = memberBalances.find(mb => mb.userId === bd.userId);
              if (!bal) return null;
              const involved = bd.rows.filter(r => r.memberResp > 0 || r.memberPaidAct > 0);
              if (involved.length === 0 && bal.netBalance === 0) return null;
              const paidRows = involved.filter(r => r.memberPaidAct > 0);
              const respRows = involved.filter(r => r.memberResp > 0);
              return (
                <div key={bd.userId} className="ledger p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[14px] min-w-0">{bal.displayName}</span>
                    <span className={`money text-[14px] font-semibold flex-shrink-0 ${bal.netBalance > 0 ? "text-success" : bal.netBalance < 0 ? "text-danger" : "text-muted"}`}>
                      {t("net")} {formatDH(bal.netBalance)}
                    </span>
                  </div>
                  <div className="text-[13px]">
                    {bal.netBalance > 0 ? t("receiveDiff") : bal.netBalance < 0 ? t("payDiff") : t("settledUpYou")}
                  </div>
                  {paidRows.length > 0 && (
                    <div className="text-[13px] space-y-0.5">
                      <div className="section-label !text-[11px]">{t("paid")} · <span className="money">{formatDH(bal.totalPaid)}</span></div>
                      {paidRows.map(r => (
                        <div key={r.activityName} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate">{r.activityName}</span>
                          <span className="money">{formatDH(r.memberPaidAct)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {respRows.length > 0 && (
                    <div className="text-[13px] space-y-0.5">
                      <div className="section-label !text-[11px]">{t("owes")} · <span className="money">{formatDH(bal.totalResponsibility)}</span></div>
                      {respRows.map(r => (
                        <div key={r.activityName} className="space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate">
                              {r.activityName} <span className="text-muted text-[11px]">({r.pricingModel === "FIXED" ? tc("fixed") : tc("variable")})</span>
                            </span>
                            <span className="money">{formatDH(r.memberResp)}</span>
                          </div>
                          {r.pricingModel === "FIXED"
                            ? r.fixedShares.map((s, i) => (
                                <div key={i} className="flex items-center justify-between gap-2 text-[12px] text-muted pl-3">
                                  <span className="min-w-0">
                                    {s.productName} × {s.quantity} = {formatDH(s.totalCentimes)}
                                  </span>
                                  <span>{t("splitEach", { n: s.n, share: formatDH(s.share) })}</span>
                                </div>
                              ))
                            : r.items.map(it => (
                                <div key={it.description} className="flex items-center justify-between gap-2 text-[12px] text-muted pl-3">
                                  <span className="min-w-0 truncate">{it.description}</span>
                                  <span className="money">{formatDH(it.priceCentimes)}</span>
                                </div>
                              ))}
                        </div>
                      ))}
                    </div>
                  )}
                  {paidRows.length === 0 && involved.length > 0 && (
                    <div className="text-[12px] text-muted">{t("noPaidLine")}</div>
                  )}
                  {respRows.length === 0 && involved.length > 0 && (
                    <div className="text-[12px] text-muted">{t("noRespLine")}</div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Settle up — actions go to the people involved, not just the owner */}
        {transfers.length > 0 && (
          <section className="space-y-1">
            <h3 className="section-label">{t("settleUp")}</h3>
            <div className="ledger">
              {transfers.map(tr => {
                const iAmDebtor = tr.fromUserId === session.userId;
                const iAmCreditor = tr.toUserId === session.userId;
                return (
                  <div key={tr.id} className="flex items-center justify-between py-2.5 gap-3">
                    <span className="text-[14px] min-w-0">
                      {userMap.get(tr.fromUserId)} → {userMap.get(tr.toUserId)}: <span className="money font-semibold">{formatDH(tr.amountCentimes)}</span>
                    </span>
                    {tr.status === "CONFIRMED" ? (
                      <span className="tag bg-success-subtle text-success flex-shrink-0"><IconCheck size={12} />{t("confirmed")}</span>
                    ) : tr.status === "PAID" ? (
                      iAmCreditor ? (
                        <form action={async () => {
                          "use server";
                          const { confirmTransferReceivedAction } = await import("@/server/settlement/actions");
                          await confirmTransferReceivedAction(tr.id);
                        }}>
                          <button type="submit" className="btn-primary text-[12px] px-3 py-1.5 flex-shrink-0">{t("confirmReceipt")}</button>
                        </form>
                      ) : (
                        <span className="tag bg-success-subtle text-success flex-shrink-0"><IconCheck size={12} />{t("paidDone")}</span>
                      )
                    ) : iAmDebtor ? (
                      <form action={async () => {
                        "use server";
                        const { markTransferPaidAction } = await import("@/server/settlement/actions");
                        await markTransferPaidAction(tr.id);
                      }}>
                        <button type="submit" className="btn-primary text-[12px] px-3 py-1.5 flex-shrink-0">{t("markPaid")}</button>
                      </form>
                    ) : (
                      <span className="text-[12px] text-muted flex-shrink-0">{t("awaitingPayment")}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
          </div>
          <aside className="space-y-8 lg:sticky lg:top-6 min-w-0 order-2">
        {/* Group totals */}
        <section>
          <h3 className="section-label mb-2">{t("groupTotals")}</h3>
          <div className="flex items-center gap-5 text-[14px]">
            <span className="text-muted">{t("expenses")} <span className="money font-bold text-foreground ms-1">{formatDH(settlement.totalExpenses)}</span></span>
            <span className="w-px h-4 bg-border" aria-hidden="true"></span>
            <span className="text-muted">{t("paid")} <span className="money font-bold text-foreground ms-1">{formatDH(settlement.totalPaid)}</span></span>
            <span className="w-px h-4 bg-border" aria-hidden="true"></span>
            <span className="text-muted">{t("transfers")} <span className="money font-bold text-foreground ms-1">{transfers.length}</span></span>
          </div>
        </section>

        {/* Member Balances */}
        <section className="space-y-1">
          <h3 className="section-label">{t("memberBalances")}</h3>
          <div className="ledger">
            {memberBalances.map(b => (
              <div key={b.userId} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium">{b.displayName}{b.userId === session.userId ? <span className="text-[12px] text-muted"> {t("youSuffix")}</span> : null}</div>
                  <div className="text-[12px] text-muted">{t("paid")} {formatDH(b.totalPaid)} · {t("owes")} {formatDH(b.totalResponsibility)}</div>
                </div>
                <div className={`money text-[15px] font-bold ms-3 ${b.netBalance > 0 ? "text-success" : b.netBalance < 0 ? "text-danger" : "text-muted"}`}>
                  {b.netBalance > 0 ? "+" : ""}{formatDH(b.netBalance)}
                </div>
              </div>
            ))}
          </div>
        </section>
          </aside>
        </div>

        {/* Completion */}
        {allSettled && (
          <section className="surface-20 p-8 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-success-subtle text-success flex items-center justify-center mb-3"><IconCheck size={22} /></div>
            <div className="text-[22px] font-bold text-success">{t("groupSettled")}</div>
            <div className="money text-[16px] font-semibold mt-1">{t("reconciled", { amount: formatDH(settlement.totalExpenses) })}</div>
            <div className="text-[13px] text-muted mt-1">{t("allConfirmed", { count: transfers.length })}</div>
          </section>
        )}
    </main>
  );
}
