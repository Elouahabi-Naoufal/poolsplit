"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { formatDH } from "@/lib/utils";
import {
  createActivityAction, closeActivityAction, deleteActivityAction,
} from "@/server/activities/actions";
import {
  createActivityProductAction, updateActivityProductAction, deleteActivityProductAction,
} from "@/server/products/actions";
import {
  createUsageRecordAction, updateUsageRecordAction, deleteUsageRecordAction,
  confirmUsageRecordAction, disputeUsageRecordAction, adminConfirmUsageRecordAction,
  batchConfirmAllAction,
} from "@/server/usage/actions";
import {
  createLineItemAction, updateLineItemAction, deleteLineItemAction,
} from "@/server/lineitems/actions";
import {
  recordActivityPaymentAction, updateActivityPaymentAction, deleteActivityPaymentAction,
} from "@/server/payments/actions";
import {
  removeOutingParticipantAction, requestLeaveOutingAction, activateOutingAction,
} from "@/server/outings/actions";
import QrInvite from "@/components/QrInvite";
import WForm from "@/components/WForm";
import { saveActivityAsTemplateAction } from "@/server/templates/actions";
import { Link } from "@/i18n/navigation";
import { redirect } from "next/navigation";
import { IconCheck, IconX, IconPencil, IconChevronRight, IconReceipt, IconChevronDown } from "@/components/icons";

type AR = { error?: string };

function SubmitBtn({ label, pending, variant = "primary" }: { label: string; pending?: boolean; variant?: "primary" | "danger" | "ghost" | "warn" }) {
  const cls = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger-solid" : variant === "warn" ? "btn-warn" : "btn-ghost";
  return (
    <button type="submit" disabled={pending} className={cls}>
      {pending ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> : null}
      {label}
    </button>
  );
}

function EditDropdown({ children, align = "end" }: { children: React.ReactNode; align?: "start" | "end" }) {
  const tc = useTranslations("common");
  return (
    <details className="relative">
      <summary className="cursor-pointer text-brand text-[12px] font-semibold hover:underline">{tc("edit")}</summary>
      <div className={`absolute ${align === "end" ? "end-0" : "start-0"} z-40 mt-1.5 p-3 rounded-[16px] bg-surface border border-border shadow-lg max-w-[calc(100vw-3rem)]`}>
        {children}
      </div>
    </details>
  );
}

function ProductsSection({ activity, canEdit }: { activity: any; canEdit: boolean }) {
  const t = useTranslations("outing");
  const tc = useTranslations("common");
  return (
    <div className="space-y-3">
      {activity.products.length > 0 && (
        <div>
          <div className="text-[12px] font-semibold text-muted mb-2 uppercase tracking-wide">{t("products")}</div>
          <details className="group rounded-[16px] border border-border overflow-hidden">
            <summary className="flex items-center justify-between gap-2 px-3.5 py-2.5 cursor-pointer text-[14px] font-medium">
              <span className="min-w-0">{t("products")} · {activity.products.length}</span>
              <IconChevronDown size={16} className="text-muted flex-shrink-0 transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <div className="border-t border-border px-2 py-1.5 space-y-1">
              {activity.products.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between py-1.5 px-2.5 rounded-[10px] hover:bg-elevated/70">
                  <span className="text-[13px] min-w-0">{p.name} <span className="text-muted">· {formatDH(p.pricePerUnitCt)}/{p.unit}</span></span>
                  {canEdit && (
                    <div className="flex items-center gap-1.5 flex-shrink-0 ms-2">
                      <EditDropdown align="end">
                        <WForm action={async (prevState, formData) => {
                          return await updateActivityProductAction(p.id, {
                            name: formData.get("name") as string || undefined,
                            unit: formData.get("unit") as string || undefined,
                            pricePerUnitDH: formData.get("pricePerUnitDH") as string || undefined,
                          });
                        }} initialState={{}} className="space-y-2 w-56">
                          <input name="name" defaultValue={p.name} placeholder={t("namePh")} className="input text-[13px]" />
                          <input name="unit" defaultValue={p.unit} placeholder={t("unitLabel")} className="input text-[13px]" />
                          <input name="pricePerUnitDH" defaultValue={(p.pricePerUnitCt / 100).toFixed(2)} placeholder={t("pricePh")} className="input text-[13px]" />
                          <SubmitBtn label={tc("save")} />
                        </WForm>
                      </EditDropdown>
                      <WForm action={async () => await deleteActivityProductAction(p.id)} initialState={{}} confirmMessage={t("delProduct")} confirmLabel={tc("confirm")} cancelLabel={tc("cancel")}>
                        <button type="submit" aria-label={t("deleteItem", { name: p.name })} className="inline-flex items-center text-danger/60 hover:text-danger transition-colors"><IconX size={13} /></button>
                      </WForm>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
      {canEdit && (
        <details className="rounded-[20px] border border-border p-3.5">
          <summary className="flex items-center gap-1 text-[13px] cursor-pointer text-muted font-semibold"><IconChevronRight size={13} className="chev" /> {t("addProduct")}</summary>
          <WForm action={async (prevState, formData) => await createActivityProductAction(formData)} initialState={{}} className="space-y-2.5 mt-3">
            <input type="hidden" name="activityId" value={activity.id} />
            <input name="name" placeholder={t("productNamePh")} required className="input text-[13px]" />
            <input name="unit" placeholder={t("unitPh")} className="input text-[13px]" />
            <input name="pricePerUnitDH" placeholder={t("pricePh")} required className="input text-[13px]" />
            <SubmitBtn label={t("addProductBtn")} />
          </WForm>
        </details>
      )}
    </div>
  );
}

function AddItemForm({ activity, userId, summary, descriptionPh }: {
  activity: any; userId: string; summary: string; descriptionPh: string;
}) {
  const t = useTranslations("outing");
  const [productId, setProductId] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const onPick = (value: string) => {
    setProductId(value);
    const p = activity.products.find((pp: any) => pp.id === value);
    if (p) {
      setDescription(p.name);
      setPrice((p.pricePerUnitCt / 100).toFixed(2));
    }
  };
  return (
    <details className="rounded-[20px] border border-border p-3.5">
      <summary className="flex items-center gap-1 text-[13px] cursor-pointer text-muted font-semibold"><IconChevronRight size={13} className="chev" /> {summary}</summary>
      <WForm action={async (prevState, formData) => await createLineItemAction(formData)} initialState={{}} className="space-y-2.5 mt-3">
        <input type="hidden" name="activityId" value={activity.id} />
        <input type="hidden" name="userId" value={userId} />
        {activity.products.length > 0 && (
          <select value={productId} onChange={(e) => onPick(e.target.value)} className="input text-[13px]">
            <option value="">{t("selectProduct")}</option>
            {activity.products.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name} ({formatDH(p.pricePerUnitCt)}/{p.unit})</option>
            ))}
          </select>
        )}
        <input name="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={descriptionPh} required className="input text-[13px]" />
        <input name="priceDH" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={t("priceItemPh")} required className="input text-[13px]" />
        <SubmitBtn label={t("addItemBtn")} />
      </WForm>
    </details>
  );
}

function NewActivityForm({ outingId, templates }: { outingId: string; templates: any[] }) {
  const t = useTranslations("outing");
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [pricingModel, setPricingModel] = useState("FIXED");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const matched = templates.filter(tp => tp.name.toLowerCase().includes(query.trim().toLowerCase()));

  const onTypeSearch = (value: string) => {
    setQuery(value);
    setOpen(true);
    if (templateId) {
      const sel = templates.find(tt => tt.id === templateId);
      if (!sel || sel.name !== value) setTemplateId("");
    }
  };

  const onPickTemplate = (tpl: any) => {
    setTemplateId(tpl.id);
    setQuery(tpl.name);
    setName(tpl.name);
    setPricingModel(tpl.pricingModel);
    setOpen(false);
  };

  return (
    <div className="card-elevated p-5">
      <h3 className="text-[14px] font-semibold mb-3">{t("newActivity")}</h3>
      <WForm action={async (prevState, formData) => await createActivityAction(formData)} initialState={{}} className="space-y-3">
        <input type="hidden" name="outingId" value={outingId} />
        <input name="templateId" type="hidden" value={templateId} />
        {templates.length > 0 && (
          <div className="relative">
            <input
              value={query}
              onChange={e => onTypeSearch(e.target.value)}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder={t("searchTemplates")}
              autoComplete="off"
              className="input pr-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(""); setTemplateId(""); setOpen(true); }}
                aria-label={t("clearSearch")}
                className="absolute end-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors p-1"
              >
                <IconX size={14} />
              </button>
            )}
            {open && (
              <div className="absolute z-30 mt-1.5 w-full rounded-[14px] bg-surface border border-border shadow-lg max-h-52 overflow-y-auto">
                {matched.length === 0 ? (
                  <div className="p-3 text-[13px] text-muted">{t("noTemplateMatches")}</div>
                ) : (
                  matched.map(tp => (
                    <button
                      key={tp.id}
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => onPickTemplate(tp)}
                      className="w-full text-start px-3 py-2.5 hover:bg-elevated transition flex items-center justify-between gap-2"
                    >
                      <span className="min-w-0 truncate text-[13px] font-medium">{tp.name}</span>
                      <span className="tag bg-elevated text-[11px] flex-shrink-0">{tp.products.length} {t("products")}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
        {templateId && <div className="text-[12px] text-muted">{t("useTemplate")}</div>}
        <input name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("activityNamePh")} required className="input" />
        <select name="pricingModel" value={pricingModel} onChange={(e) => setPricingModel(e.target.value)} className="input">
          <option value="FIXED">{t("fixedOpt")}</option>
          <option value="VARIABLE">{t("variableOpt")}</option>
        </select>
        <input name="notes" placeholder={t("notesPh")} className="input" />
        <SubmitBtn label={t("createActivity")} />
      </WForm>
    </div>
  );
}

function SplitBar({ paid, responsibility }: { paid: number; responsibility: number }) {
  const t = useTranslations("outing");
  const max = Math.max(paid, responsibility, 1);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-muted w-20">{t("paid")}</span>
        <div className="progress-track flex-1">
          <div className="progress-fill" style={{ width: `${Math.round((paid / max) * 100)}%` }} />
        </div>
        <span className="money text-[12px] font-semibold w-20 text-end">{formatDH(paid)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-muted w-20">{t("owed")}</span>
        <div className="progress-track flex-1">
          <div className="progress-fill" style={{ width: `${Math.round((responsibility / max) * 100)}%`, background: "var(--muted)", opacity: 0.7 }} />
        </div>
        <span className="money text-[12px] font-semibold w-20 text-end">{formatDH(responsibility)}</span>
      </div>
    </div>
  );
}

export default function ClientOutingPage({
  groupId, outingId, isOwner, sessionUserId,
  participants, usersMap, activities, activityStats,
  memberBalances, totalResponsibility, totalPaid, allActivitiesClosed, hasSettlement, outing,
  groupName, templates, canUseTemplates, canRecordPayments,
}: {
  groupId: string; outingId: string; isOwner: boolean; sessionUserId: string;
  participants: any[]; usersMap: Map<string, string>; activities: any[]; activityStats: any[]; memberBalances: any[];
  totalResponsibility: number; totalPaid: number; allActivitiesClosed: boolean;
  hasSettlement: boolean; outing: any;
  groupName?: string;
  templates?: any[]; canUseTemplates?: boolean; canRecordPayments?: boolean;
}) {
  const netDiff = totalResponsibility - totalPaid;
  const t = useTranslations("outing");
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  const [expandedActivities, setExpandedActivities] = useState<Set<string>>(new Set());

  const toggleActivity = (id: string) => {
    setExpandedActivities(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8 space-y-8">
      <div>
        <nav aria-label={tc("breadcrumb")} className="text-[13px] text-muted mb-1.5">
          <Link href="/dashboard" className="hover:text-foreground transition-colors">{tn("groups")}</Link>
          <span className="mx-1.5">/</span>
          <Link href={`/groups/${groupId}`} className="hover:text-foreground transition-colors">{groupName ?? tn("groups")}</Link>
          <span className="mx-1.5">/</span>
          <span className="text-foreground font-medium">{outing.name}</span>
        </nav>
        <div className="flex items-end justify-between gap-4">
          <h1 className="font-extrabold text-[26px] truncate tracking-tight">{outing.name}</h1>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isOwner && outing.status === "PLANNING" && (
              <WForm action={async () => await activateOutingAction(outingId)} initialState={{}}>
                <SubmitBtn label={t("activate")} />
              </WForm>
            )}
          {isOwner && allActivitiesClosed && outing.status !== "SETTLED" && !hasSettlement && (
            <WForm
              action={async () => {
                const { finalizeSettlementAction } = await import("@/server/settlement/actions");
                const res = await finalizeSettlementAction(outingId);
                if (res?.error) return res;
                redirect(`/groups/${groupId}/outings/${outingId}/settlement`);
              }}
              initialState={{}}
            >
              <SubmitBtn label={t("settleOuting")} variant="primary" />
            </WForm>
          )}
            {isOwner && outing.status === "SETTLED" && (
              <span className="tag bg-success-subtle text-success"><IconCheck size={12} />{t("settled")}</span>
            )}
          </div>
        </div>
        <p className="text-[13px] text-muted mt-1">{outing.status === "PLANNING" ? tc("planning") : outing.status === "ACTIVE" ? tc("activeTag") : outing.status === "SETTLED" ? tc("settledTag") : outing.status} · {t("headMeta", { p: participants.length, a: activities.length })}</p>
      </div>
        {/* Live balances */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
            <div>
              <div className="text-[13px] text-muted mb-1">{t("liveBalances")}</div>
              <div className="money-hero text-[40px] font-extrabold">{formatDH(totalPaid)}</div>
              <div className="text-[13px] text-muted mt-1">{t("paidOf", { total: formatDH(totalResponsibility) })}</div>
            </div>
            <div className="sm:text-end">
              <div className="text-[13px] text-muted">{t("netDiff")}</div>
              <div className={`money text-[20px] font-bold ${netDiff > 0 ? "text-success" : netDiff < 0 ? "text-danger" : "text-muted"}`}>
                {netDiff > 0 ? "+" : ""}{formatDH(netDiff)}
              </div>
            </div>
          </div>
          <SplitBar paid={totalPaid} responsibility={totalResponsibility} />
          <div className="divider mt-6"></div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="min-w-0 order-1">
        {/* Activities */}
        <section className="space-y-4">
          <h2 className="text-[18px] font-semibold tracking-tight">{t("activities")}</h2>
          {activityStats.length === 0 ? (
            <div className="card border-dashed p-10 text-center">
              <div className="w-12 h-12 mx-auto rounded-[20px] bg-elevated text-muted flex items-center justify-center mb-3"><IconReceipt size={22} /></div>
              <p className="text-[14px] text-muted">{t("noActivities")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activityStats.map((a: any) => (
                <ActivityCard
                  key={a.id}
                  activity={a}
                  outingId={outingId}
                  groupId={groupId}
                  isOwner={isOwner}
                  canUseTemplates={!!canUseTemplates}
                  canRecordPayments={!!canRecordPayments}
                  participants={participants}
                  usersMap={usersMap}
                  userId={sessionUserId}
                  expanded={expandedActivities.has(a.id)}
                  onToggle={() => toggleActivity(a.id)}
                />
              ))}
            </div>
          )}

          {isOwner && outing.status !== "SETTLED" && (
            <NewActivityForm outingId={outingId} templates={canUseTemplates ? templates ?? [] : []} />
          )}
        </section>
          </div>
          <aside className="space-y-8 lg:sticky lg:top-6 min-w-0 order-2">
            <section>
              <h2 className="section-label mb-1">{t("balances")}</h2>
              <div className="ledger">
                {memberBalances.filter((b: any) => b.netBalance !== 0).map((b: any) => (
                  <div key={b.userId} className="flex items-center justify-between py-1.5">
                    <span className="text-[14px]">{b.displayName}</span>
                    <span className={`money text-[15px] font-semibold ${b.netBalance > 0 ? "text-success" : "text-danger"}`}>
                      {b.netBalance > 0 ? "+" : ""}{formatDH(b.netBalance)}
                    </span>
                  </div>
                ))}
                {memberBalances.filter((b: any) => b.netBalance !== 0).length === 0 ? (
                  <div className="text-center py-3 text-[14px] text-muted">{t("settledUp")}</div>
                ) : (
                  memberBalances.filter((b: any) => b.netBalance === 0).length > 0 && (
                    <div className="text-[12px] text-muted pt-1">
                      {t("balancedN", { count: memberBalances.filter((b: any) => b.netBalance === 0).length })}
                    </div>
                  )
                )}
              </div>
            </section>
            <section>
              <h2 className="section-label mb-2">{t("participants")}</h2>
              <div className="flex flex-wrap items-center gap-2">
                {participants.map((p: any) => (
                  <span key={p.id} className="tag bg-elevated text-foreground relative">
                    {p.user.displayName}
                    {p.role === "OWNER" && <span className="tag bg-brand-subtle text-brand ms-1">{tc("owner")}</span>}
                    {isOwner && p.userId !== sessionUserId && (
                      <WForm action={async () => await removeOutingParticipantAction(outingId, p.userId)} initialState={{}} className="inline ms-1">
                        <button type="submit" aria-label={t("removeParticipant", { name: p.user.displayName })} className="inline-flex items-center text-danger/60 hover:text-danger transition-colors ms-1"><IconX size={12} /></button>
                      </WForm>
                    )}
                  </span>
                ))}
              </div>
              {!isOwner && (
                <WForm action={async () => await requestLeaveOutingAction(outingId)} initialState={{}} className="mt-2">
                  <button type="submit" className="text-[12px] text-danger hover:underline">{t("leaveOuting")}</button>
                </WForm>
              )}
              {isOwner && outing.publicToken && (
                <div className="pt-3 mt-3 border-t border-border">
                  <QrInvite token={outing.publicToken} type="outing" name={outing.name} />
                </div>
              )}
            </section>
            {hasSettlement && (
              <a href={`/groups/${groupId}/outings/${outingId}/settlement`} className="btn-navy w-full py-3 text-[15px] text-center rounded-[20px]">{t("viewSettlement")}</a>
            )}
          </aside>
        </div>
      </main>
  );
}

function StatusTag({ status }: { status: string }) {
  const tc = useTranslations("common");
  if (status === "CONFIRMED") return (
    <span className="tag bg-success-subtle text-success"><span className="status-dot bg-success"></span>{tc("confirmedTag")}</span>
  );
  if (status === "DISPUTED") return (
    <span className="tag bg-danger-subtle text-danger"><span className="status-dot bg-danger"></span>{tc("disputedTag")}</span>
  );
  return (
    <span className="tag bg-warn-subtle text-warn"><span className="status-dot bg-warn"></span>{tc("pendingTag")}</span>
  );
}

function ActivityCard({ activity, outingId, groupId, isOwner, canUseTemplates, canRecordPayments, participants, usersMap, userId, expanded, onToggle }: {
  activity: any; outingId: string; groupId: string; isOwner: boolean; canUseTemplates: boolean; canRecordPayments: boolean;
  participants: any[]; usersMap: Map<string, string>; userId: string;
  expanded: boolean; onToggle: () => void;
}) {
  const t = useTranslations("outing");
  const tc = useTranslations("common");
  const isFixed = activity.pricingModel === "FIXED";
  const isVariable = activity.pricingModel === "VARIABLE";
  const canEdit = isOwner && activity.status === "OPEN";
  const canEditPayments = canEdit || (canRecordPayments && activity.status === "OPEN");

  return (
    <div className="card-elevated">
      {/* Clickable header — always visible */}
      <button onClick={onToggle} className={`w-full text-start p-5 hover:bg-elevated/50 overflow-hidden transition-colors cursor-pointer ${expanded ? "rounded-t-[20px]" : "rounded-[20px]"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[15px] font-semibold tracking-tight">{activity.name}</span>
              <span className="tag bg-elevated text-muted">{isFixed ? tc("fixed") : tc("variable")}</span>
              {activity.status === "OPEN" ? (
                <span className="tag bg-success-subtle text-success"><span className="status-dot bg-success"></span>{tc("open")}</span>
              ) : (
                <span className="tag bg-elevated text-muted"><span className="status-dot bg-muted"></span>{activity.status === "CLOSED" ? tc("closed") : activity.status}</span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2">
              <span className="money text-[22px] font-bold">{formatDH(activity.responsibility)}</span>
              <span className="text-[13px] text-muted">{t("paid")} <span className="money font-semibold text-foreground">{formatDH(activity.paid)}</span></span>
              <span className={`text-[13px] ${activity.balance !== 0 ? (activity.balance > 0 ? "text-success" : "text-danger") : "text-muted"}`}>
                {t("balance")} <span className="money font-semibold">{activity.balance > 0 ? "+" : ""}{formatDH(activity.balance)}</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {canEdit && (
              <>
                <WForm action={async () => await closeActivityAction(activity.id)} initialState={{}}>
                  <SubmitBtn label={tc("close")} variant="warn" />
                </WForm>
                <WForm action={async () => await deleteActivityAction(activity.id)} initialState={{}} confirmMessage={t("delActivity")} confirmLabel={tc("confirm")} cancelLabel={tc("cancel")}>
                  <SubmitBtn label={tc("delete")} variant="danger" />
                </WForm>
              </>
            )}
            <span className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>
              <IconChevronDown size={18} className="text-muted" />
            </span>
          </div>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-5 pb-5 space-y-4 animate-in border-t border-border pt-4">
          <SplitBar paid={activity.paid} responsibility={activity.responsibility} />
          {canUseTemplates && (
            <div className="flex justify-end">
              <WForm action={async (prevState, formData) => await saveActivityAsTemplateAction(activity.id)} initialState={{}}>
                <SubmitBtn label={t("saveTemplate")} variant="ghost" />
              </WForm>
            </div>
          )}
          {activity.usageRecords.filter((r: any) => r.status !== "CONFIRMED" && r.status !== "DISPUTED").length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {isOwner && (
                <WForm action={async () => await batchConfirmAllAction(activity.id)} initialState={{}}>
                  <SubmitBtn label="Confirm all pending" variant="primary" />
                </WForm>
              )}
            </div>
          )}
          {isFixed && (
            <div className="space-y-4">
              <ProductsSection activity={activity} canEdit={canEdit} />
              {activity.usageRecords.length > 0 && (
                <div>
                  <div className="text-[12px] font-semibold text-muted mb-2 uppercase tracking-wide">{t("usage")}</div>
                  <div className="space-y-2">
                    {activity.usageRecords.map((r: any) => {
                      const product = activity.products.find((p: any) => p.id === r.productId);
                      const n = r.participants.length || 1;
                      const each = Math.floor((r.totalCentimes ?? 0) / n);
                      const imIn = r.participants.some((pp: any) => pp.userId === userId);
                      const myShare = imIn ? each : 0;
                      return (
                        <div key={r.id} className="rounded-[12px] bg-elevated p-3.5 space-y-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[14px] font-medium">{r.quantity} × {product?.name || "?"}</div>
                              <div className="money text-[18px] font-bold mt-0.5">{formatDH(r.totalCentimes)}</div>
                            </div>
                            <StatusTag status={r.status} />
                          </div>
                          <div className="split-bar" aria-hidden="true">
                            {r.participants.map((pp: any) => (
                              <span key={pp.userId} style={{ width: `${100 / n}%`, background: pp.userId === userId ? "var(--brand)" : "var(--muted)", opacity: pp.userId === userId ? 1 : 0.45 }} />
                            ))}
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-[12px] bg-surface p-2">
                              <div className="text-[11px] text-muted">{t("each")}</div>
                              <div className="money text-[13px] font-bold">{formatDH(each)}</div>
                            </div>
                            <div className="rounded-[12px] bg-surface p-2">
                              <div className="text-[11px] text-muted">{t("yourShare")}</div>
                              <div className="money text-[13px] font-bold">{formatDH(myShare)}</div>
                            </div>
                            <div className="rounded-[12px] bg-surface p-2">
                              <div className="text-[11px] text-muted">{t("split")}</div>
                              <div className="text-[13px] font-bold">{t("splitN", { count: n })}</div>
                            </div>
                          </div>
                          <div className="text-[12px] text-muted">
                            {r.participants.map((pp: any) => usersMap.get(pp.userId) || pp.userId).join(" · ")}
                          </div>
                          {r.status !== "CONFIRMED" && (
                            <div className="flex gap-2 flex-wrap">
                              <WForm action={async () => await confirmUsageRecordAction(r.id)} initialState={{}}>
                                <SubmitBtn label={tc("confirm")} variant="primary" />
                              </WForm>
                              <WForm action={async (prevState, formData) => {
                                const notes = formData.get("notes") as string;
                                return await disputeUsageRecordAction(r.id, notes);
                              }} initialState={{}}>
                                <SubmitBtn label={t("dispute")} variant="danger" />
                              </WForm>
                            </div>
                          )}
                          {canEdit && (
                            <div className="flex gap-2 items-center pt-1">
                              <EditDropdown align="start">
                                <WForm action={async (prevState, formData) => {
                                  const qty = parseInt(formData.get("quantity") as string, 10);
                                  return await updateUsageRecordAction(r.id, { quantity: qty });
                                }} initialState={{}} className="flex gap-2 items-center">
                                  <input name="quantity" type="number" min="1" defaultValue={r.quantity} className="input text-[13px] w-20" />
                                  <SubmitBtn label={tc("save")} />
                                </WForm>
                              </EditDropdown>
                              <WForm action={async () => await deleteUsageRecordAction(r.id)} initialState={{}} confirmMessage={t("delUsage")} confirmLabel={tc("confirm")} cancelLabel={tc("cancel")}>
                                <button type="submit" className="text-[12px] text-danger hover:underline">{tc("delete")}</button>
                              </WForm>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {canEdit && (
                <details className="rounded-[20px] border border-border p-3.5">
                  <summary className="flex items-center gap-1 text-[13px] cursor-pointer text-muted font-semibold"><IconChevronRight size={13} className="chev" /> {t("recordUsage")}</summary>
                  <WForm action={async (prevState, formData) => await createUsageRecordAction(formData)} initialState={{}} className="space-y-2.5 mt-3">
                    <input type="hidden" name="activityId" value={activity.id} />
                    <select name="productId" required className="input text-[13px]">
                      <option value="">{t("selectProduct")}</option>
                      {activity.products.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({formatDH(p.pricePerUnitCt)}/{p.unit})</option>)}
                    </select>
                    <input name="quantity" type="number" min="1" placeholder={t("quantity")} required className="input text-[13px]" />
                    <div className="text-[12px] font-medium text-muted">{t("selectParticipants")}</div>
                    <div className="space-y-1">
                      {participants.map((p: any) => (
                        <label key={p.userId} className="flex items-center gap-2 text-[13px] py-1 cursor-pointer">
                          <input type="checkbox" name="participantIds" value={p.userId} className="accent-action" />
                          {p.user.displayName}
                        </label>
                      ))}
                    </div>
                    <SubmitBtn label={t("recordUsageBtn")} />
                  </WForm>
                </details>
              )}
            </div>
          )}

          {isVariable && (
            <div className="space-y-3">
              <ProductsSection activity={activity} canEdit={canEdit} />
              {activity.lineItems.length > 0 && (
                <div>
                  <div className="text-[12px] font-semibold text-muted mb-2 uppercase tracking-wide">{t("items")}</div>
                  <div className="space-y-2">
                    {activity.lineItems.map((l: any) => {
                      const canEditItem = l.userId === userId || isOwner;
                      const isMine = l.userId === userId;
                      return (
                        <div key={l.id} className="rounded-[12px] bg-elevated p-3.5 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[14px] font-medium">{l.description}</div>
                              <div className="text-[12px] text-muted">{t("paidBy")} {usersMap.get(l.userId) || "?"}{isMine ? ` ${t("youSuffix")}` : ""}</div>
                            </div>
                            <div className="money text-[18px] font-bold flex-shrink-0">{formatDH(l.priceCentimes)}</div>
                          </div>
                          {canEditItem && canEdit && (
                            <div className="flex items-center gap-1.5">
                              <EditDropdown align="end">
                                <WForm action={async (prevState, formData) => {
                                  return await updateLineItemAction(l.id, {
                                    description: formData.get("description") as string || undefined,
                                    priceDH: formData.get("priceDH") as string || undefined,
                                  });
                                }} initialState={{}} className="space-y-2 w-56">
                                  <input name="description" defaultValue={l.description} placeholder={t("descPh")} className="input text-[13px]" />
                                  <input name="priceDH" defaultValue={(l.priceCentimes / 100).toFixed(2)} placeholder={t("priceItemPh")} className="input text-[13px]" />
                                  <SubmitBtn label={tc("save")} />
                                </WForm>
                              </EditDropdown>
                              <WForm action={async () => await deleteLineItemAction(l.id)} initialState={{}} confirmMessage={t("delItem")} confirmLabel={tc("confirm")} cancelLabel={tc("cancel")}>
                                <button type="submit" aria-label={t("deleteItem", { name: l.description })} className="inline-flex items-center text-danger/60 hover:text-danger transition-colors"><IconX size={12} /></button>
                              </WForm>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {activity.lineItems.length === 0 && <div className="text-[13px] text-muted italic">{t("noItems")}</div>}
              {canEdit && (
                <AddItemForm activity={activity} userId={userId} summary={t("addItem")} descriptionPh={t("descPh")} />
              )}
              {!isOwner && activity.status === "OPEN" && (
                <AddItemForm activity={activity} userId={userId} summary={t("addMyItem")} descriptionPh={t("descMinePh")} />
              )}
            </div>
          )}

          {/* Payments */}
          <div className="space-y-2">
            <div className="text-[12px] font-semibold text-muted uppercase tracking-wide">{t("payments")}</div>
            {activity.payments.length > 0 && (
              <div className="space-y-1.5">
                {activity.payments.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between py-2 px-3 rounded-[12px] bg-elevated">
                    <span className="text-[14px]">{usersMap.get(p.userId) || "?"}{p.userId === userId ? ` ${t("youSuffix")}` : ""}</span>
                    <span className="flex items-center gap-2">
                      <span className="money text-[15px] font-semibold">{formatDH(p.amountCentimes)}</span>
                      {canEditPayments && (
                        <span className="flex items-center gap-1">
                          <EditDropdown align="end">
                            <WForm action={async (prevState, formData) => {
                              return await updateActivityPaymentAction(p.id, formData.get("amountDH") as string);
                            }} initialState={{}} className="flex gap-2 items-center">
                              <input name="amountDH" defaultValue={(p.amountCentimes / 100).toFixed(2)} placeholder={t("amountPh")} className="input text-[13px] w-24" />
                              <SubmitBtn label={tc("save")} />
                            </WForm>
                          </EditDropdown>
                          <WForm action={async () => await deleteActivityPaymentAction(p.id)} initialState={{}} confirmMessage={t("delPayment")} confirmLabel={tc("confirm")} cancelLabel={tc("cancel")}>
                            <button type="submit" aria-label={t("deletePayment")} className="inline-flex items-center text-danger/60 hover:text-danger transition-colors"><IconX size={12} /></button>
                          </WForm>
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {canEditPayments && (
              <details className="rounded-[20px] border border-border p-3.5">
                <summary className="flex items-center gap-1 text-[13px] cursor-pointer text-muted font-semibold"><IconChevronRight size={13} className="chev" /> {t("recordPayment")}</summary>
                <WForm action={async (prevState, formData) => await recordActivityPaymentAction(formData)} initialState={{}} className="space-y-2.5 mt-3">
                  <input type="hidden" name="activityId" value={activity.id} />
                  <select name="userId" required className="input text-[13px]">
                    <option value="">{t("whoPaid")}</option>
                    {participants.map((p: any) => <option key={p.userId} value={p.userId}>{p.user.displayName}</option>)}
                  </select>
                  <input name="amountDH" placeholder={t("amountPh")} required className="input text-[13px]" />
                  <SubmitBtn label={t("recordPaymentBtn")} />
                </WForm>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}