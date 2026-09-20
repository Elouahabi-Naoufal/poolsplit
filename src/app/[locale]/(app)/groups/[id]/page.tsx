import { prisma } from "@/lib/prisma";
import { getSession } from "@/server/auth/session";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import QrInvite from "@/components/QrInvite";
import GroupImageForm from "@/components/GroupImageForm";
import { IconChevronRight } from "@/components/icons";
import { avatarSrc } from "@/lib/avatar";
import { formatDH } from "@/lib/utils";
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

export default async function GroupPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id, locale } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const group = await prisma.group.findUnique({ where: { id } });
  if (!group) notFound();

  const member = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: id, userId: session.userId } } });
  if (!member) {
    const tErr = await getTranslations({ locale: locale as AppLocale, namespace: "group" });
    return <div className="p-10 text-center">{tErr("notMember")}</div>;
  }

  const t = await getTranslations({ locale: locale as AppLocale, namespace: "group" });
  const tc = await getTranslations({ locale: locale as AppLocale, namespace: "common" });
  const tn = await getTranslations({ locale: locale as AppLocale, namespace: "nav" });

  const isOwner = group.ownerId === session.userId;
  const members = await prisma.groupMember.findMany({ where: { groupId: id }, include: { user: true } });
  const outings = await prisma.outing.findMany({
    where: { groupId: id },
    orderBy: { createdAt: "desc" },
    include: {
      activities: {
        include: {
          payments: true,
          usageRecords: { include: { participants: true } },
          lineItems: true,
        },
      },
      _count: { select: { participants: true } },
    },
  });
  const invitations = await prisma.groupInvitation.findMany({ where: { groupId: id, status: "PENDING" } });

  const outingsWithStats = outings.map(o => {
    const activityCount = o.activities.length;
    const participantCount = o._count.participants;
    const expenseTotal = o.activities.reduce((s, a) => s + activityTotal(a), 0);
    const myPaid = o.activities.reduce(
      (s, a) => s + (a.payments ?? []).filter((p: any) => p.userId === session.userId).reduce((s2: number, p: any) => s2 + p.amountCentimes, 0),
      0
    );
    const myResp = o.activities.reduce((s, a) => s + myResponsibility(a, session.userId), 0);
    return { ...o, activityCount, participantCount, expenseTotal, myNet: myPaid - myResp };
  });

  const groupSpent = outingsWithStats.reduce((s, o) => s + o.expenseTotal, 0);
  const settledOutings = outingsWithStats.filter(o => o.status === "SETTLED").length;
  const myGroupNet = outingsWithStats.reduce((s, o) => s + o.myNet, 0);

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8 space-y-8">
      <div>
        <nav aria-label={tc("breadcrumb")} className="text-[13px] text-muted mb-1.5">
          <Link href="/dashboard" className="hover:text-foreground transition-colors">{tn("groups")}</Link>
          <span className="mx-1.5">/</span>
          <span className="text-foreground font-medium">{group.name}</span>
        </nav>
        <div className="flex items-end justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {group.image && (
              <div className="w-11 h-11 rounded-[16px] overflow-hidden bg-brand-subtle flex items-center justify-center text-brand flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={group.image} alt={group.name} className="w-full h-full object-cover" />
              </div>
            )}
            <h1 className="font-extrabold text-[26px] truncate tracking-tight">{group.name}</h1>
          </div>
          <div className="text-end flex-shrink-0">
            <div className={`money text-[20px] font-extrabold ${myGroupNet > 0 ? "text-success" : myGroupNet < 0 ? "text-danger" : "text-muted"}`}>
              {myGroupNet > 0 ? "+" : ""}{formatDH(myGroupNet)}
            </div>
            <div className="text-[12px] text-muted">{t("yourPosition")}</div>
          </div>
        </div>
        <p className="text-[13px] text-muted mt-1">
          {t("headStats", { m: members.length, o: outings.length, spent: formatDH(groupSpent), s: settledOutings, t: outings.length })}
        </p>
        {outings.length > 0 && (
          <div className="progress-track mt-3 max-w-xs">
            <div className="progress-fill navy" style={{ width: `${Math.round((settledOutings / outings.length) * 100)}%` }} />
          </div>
        )}
        {isOwner && (
          <div className="mt-5 max-w-md">
            <details className="rounded-[20px] border border-border p-4">
              <summary className="flex items-center gap-2 text-[14px] font-medium cursor-pointer text-muted">
                <IconChevronRight size={13} className="chev" />{t("imageLabel")}
              </summary>
              <div className="mt-4">
                <GroupImageForm
                  groupId={id}
                  currentImage={group.image}
                  displayName={group.name}
                  uploadLabel={t("imageUpload")}
                  changeLabel={t("imageChange")}
                  removeLabel={t("imageRemove")}
                  hint={t("imageHint")}
                  saveLabel={tc("save")}
                />
              </div>
            </details>
          </div>
        )}
        <div className="divider mt-6"></div>
      </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        {/* Members */}
        <section className="order-2 min-w-0 lg:sticky lg:top-6">
          <h2 className="section-label mb-1">{t("members")} · {members.length}</h2>
          <div className="ledger">
            {members.map(m => {
              const src = avatarSrc(m.user);
              return (
              <div key={m.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-full overflow-hidden bg-brand-subtle text-brand flex items-center justify-center text-[12px] font-bold flex-shrink-0">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt={m.user.displayName} className="w-full h-full object-cover" />
                    ) : (
                      m.user.displayName[0]
                    )}
                  </div>
                  <span className="font-medium text-[14px]">{m.user.displayName}</span>
                  {m.role === "OWNER" && <span className="tag bg-brand-subtle text-brand">{tc("owner")}</span>}
                </div>
                {isOwner && m.userId !== group.ownerId && (
                  <form action={async () => {
                    "use server";
                    const { removeMemberAction } = await import("@/server/groups/actions");
                    await removeMemberAction(id, m.userId);
                  }}>
                    <button className="text-[12px] text-danger hover:underline">{t("remove")}</button>
                  </form>
                )}
              </div>
              );
            })}
          </div>

          {isOwner && (
            <div className="pt-3 border-t border-border">
              <h3 className="text-[13px] font-medium text-muted mb-2">{t("inviteMember")}</h3>
              <form action={async (formData: FormData) => {
                "use server";
                const { inviteMemberAction } = await import("@/server/groups/actions");
                await inviteMemberAction(formData);
              }} className="flex gap-2">
                <input type="hidden" name="groupId" value={id} />
                <input name="publicId" placeholder={t("invitePh")} required className="input flex-1" />
                <button className="btn-primary text-[13px] px-4">{tc("invite")}</button>
              </form>
              {invitations.length > 0 && (
                <div className="text-[12px] text-muted mt-2">{t("pendingInvites", { count: invitations.length })}</div>
              )}
            </div>
          )}

          {isOwner && group.publicToken && (
            <div className="pt-3 border-t border-border">
              <QrInvite token={group.publicToken} type="group" name={group.name} />
            </div>
          )}
        </section>

        {/* Outings */}
        <section className="order-1 min-w-0 space-y-4">
          <h2 className="section-label">{t("outings")}</h2>
          <div className="ledger">
            {outingsWithStats.length === 0 ? (
              <div className="text-center py-8 text-[13px] text-muted">{t("noOutings")}</div>
            ) : (
              outingsWithStats.map(o => (
                <Link key={o.id} href={`/groups/${id}/outings/${o.id}`} className="ledger-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[14px] truncate">{o.name}</span>
                      {o.status === "SETTLED" ? (
                        <span className="text-[12px] text-success font-medium"><span className="status-dot bg-success"></span>{tc("settledTag")}</span>
                      ) : o.status === "ACTIVE" ? (
                        <span className="text-[12px] text-brand font-medium"><span className="status-dot bg-brand"></span>{tc("activeTag")}</span>
                      ) : (
                        <span className="text-[12px] text-muted font-medium"><span className="status-dot bg-muted"></span>{o.status}</span>
                      )}
                    </div>
                    <div className="text-[12px] text-muted mt-0.5">
                      {t("outingMeta", { p: o.participantCount, a: o.activityCount, spent: formatDH(o.expenseTotal) })}
                    </div>
                  </div>
                  <div className="text-end flex-shrink-0 ms-3">
                    <div className={`money text-[15px] font-bold ${o.myNet > 0 ? "text-success" : o.myNet < 0 ? "text-danger" : "text-muted"}`}>
                      {o.myNet > 0 ? "+" : ""}{formatDH(o.myNet)}
                    </div>
                    <div className="text-muted flex justify-end mt-0.5"><IconChevronRight size={16} /></div>
                  </div>
                </Link>
              ))
            )}
          </div>

          {isOwner && (
            <details className="rounded-[20px] border border-border p-4">
              <summary className="flex items-center gap-1 text-[14px] font-medium cursor-pointer text-muted"><IconChevronRight size={13} className="chev" />{t("createOuting")}</summary>
              <form action={async (formData: FormData) => {
                "use server";
                const { createOutingAction } = await import("@/server/outings/actions");
                await createOutingAction(formData);
              }} className="space-y-3 mt-3">
                <input type="hidden" name="groupId" value={id} />
                <input name="name" placeholder={t("outingNamePh")} required className="input" />
                <input name="description" placeholder={t("outingDescPh")} className="input" />
                <div>
                  <div className="text-[12px] font-medium text-muted mb-2">{t("whoParticipates")}</div>
                  <div className="space-y-1">
                    {members.map(m => (
                      <label key={m.userId} className="flex items-center gap-2.5 text-[14px] py-1.5 px-2 rounded-[12px] hover:bg-elevated transition cursor-pointer">
                        <input type="checkbox" name="participantIds" value={m.userId} defaultChecked disabled={m.userId === group.ownerId} className="accent-action" />
                        <span>{m.user.displayName}</span>
                        {m.userId === group.ownerId && <span className="text-[12px] text-muted">{t("you")}</span>}
                      </label>
                    ))}
                  </div>
                </div>
                <button className="btn-primary w-full py-2.5">{t("createOutingBtn")}</button>
              </form>
            </details>
          )}
        </section>
        </div>
      </main>
  );
}
