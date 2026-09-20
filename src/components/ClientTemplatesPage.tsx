"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { formatDH } from "@/lib/utils";
import {
  createTemplateAction, updateTemplateAction, deleteTemplateAction,
  createTemplateProductAction, updateTemplateProductAction, deleteTemplateProductAction,
} from "@/server/templates/actions";
import WForm from "@/components/WForm";
import { IconChevronRight, IconX } from "@/components/icons";

type Product = { id: string; name: string; unit: string; pricePerUnitCt: number };
type Template = {
  id: string; name: string; pricingModel: string; notes: string | null;
  products: Product[]; createdAt: Date; updatedAt: Date;
};

function EditDropdown({ children, align = "end" }: { children: React.ReactNode; align?: "start" | "end" }) {
  const t = useTranslations("templates");
  return (
    <details className="relative">
      <summary className="cursor-pointer text-brand text-[12px] font-semibold hover:underline">{t("edit")}</summary>
      <div className={`absolute ${align === "end" ? "end-0" : "start-0"} z-40 mt-1.5 p-3 rounded-[16px] bg-surface border border-border shadow-lg max-w-[calc(100vw-3rem)]`}>
        {children}
      </div>
    </details>
  );
}

export default function ClientTemplatesPage({ templates }: { templates: Template[] }) {
  const t = useTranslations("templates");
  const tc = useTranslations("common");

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <div>
        <h1 className="font-extrabold text-[26px] tracking-tight">{t("title")}</h1>
        <p className="text-[13px] text-muted mt-1">{t("subtitle")}</p>
      </div>

      <div className="rounded-[16px] bg-warn-subtle border border-warn/20 text-warn text-[13px] p-3.5">
        {t("note")}
      </div>

      <section className="card-elevated p-5">
        <h3 className="text-[14px] font-semibold mb-3">{t("newTemplate")}</h3>
        <WForm action={async (prevState, formData) => await createTemplateAction(formData)} initialState={{}} className="space-y-3">
          <input name="name" placeholder={t("templateNamePh")} required className="input" />
          <select name="pricingModel" className="input" defaultValue="FIXED">
            <option value="FIXED">{t("fixedOpt")}</option>
            <option value="VARIABLE">{t("variableOpt")}</option>
          </select>
          <button type="submit" className="btn-primary">{t("newTemplate")}</button>
        </WForm>
      </section>

      {templates.length === 0 ? (
        <div className="card border-dashed p-10 text-center">
          <p className="text-[14px] text-muted">{t("empty")}</p>
          <p className="text-[12px] text-muted mt-1">{t("emptySub")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(tpl => (
            <TemplateCard key={tpl.id} tpl={tpl} />
          ))}
        </div>
      )}
    </main>
  );
}

function TemplateCard({ tpl }: { tpl: Template }) {
  const t = useTranslations("templates");
  const tc = useTranslations("common");

  return (
    <div className="card-elevated">
      <details className="group">
        <summary className="flex items-center justify-between gap-3 p-5 cursor-pointer list-none">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[15px] font-semibold tracking-tight">{tpl.name}</span>
              <span className="tag bg-elevated text-muted">{tpl.pricingModel === "FIXED" ? tc("fixed") : tc("variable")}</span>
            </div>
            <div className="text-[12px] text-muted mt-1">
              {t("products")}: {tpl.products.length}
            </div>
          </div>
          <IconChevronRight size={16} className="text-muted chev group-open:rotate-90 transition-transform flex-shrink-0" />
        </summary>

        <div className="px-5 pb-5 space-y-3 border-t border-border pt-4">
          <div className="flex justify-end">
            <EditDropdown align="end">
              <WForm action={async (prevState, formData) => await updateTemplateAction(tpl.id, {
                name: formData.get("name") as string || undefined,
                pricingModel: formData.get("pricingModel") as string || undefined,
              })} initialState={{}} className="space-y-2 w-56">
                <input name="name" defaultValue={tpl.name} className="input text-[13px]" />
                <select name="pricingModel" defaultValue={tpl.pricingModel} className="input text-[13px]">
                  <option value="FIXED">{t("fixedOpt")}</option>
                  <option value="VARIABLE">{t("variableOpt")}</option>
                </select>
                <button type="submit" className="btn-primary text-[13px]">{t("save")}</button>
              </WForm>
            </EditDropdown>
            <WForm action={async (prevState, formData) => await deleteTemplateAction(tpl.id)} initialState={{}} confirmMessage={t("deleteConfirm")} confirmLabel={tc("confirm")} cancelLabel={tc("cancel")} className="ms-1.5">
              <button type="submit" aria-label={t("delete")} className="inline-flex items-center text-danger/60 hover:text-danger transition-colors"><IconX size={15} /></button>
            </WForm>
          </div>

          <div className="text-[12px] font-semibold text-muted uppercase tracking-wide">{t("products")}</div>
          {tpl.products.length > 0 && (
            <div className="space-y-1.5">
              {tpl.products.map(p => (
                <div key={p.id} className="flex items-center justify-between py-2 px-3 rounded-[12px] bg-elevated">
                  <span className="text-[14px] min-w-0">{p.name} <span className="text-muted">· {formatDH(p.pricePerUnitCt)}/{p.unit}</span></span>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ms-2">
                    <EditDropdown align="end">
                      <WForm action={async (prevState, formData) => await updateTemplateProductAction(p.id, {
                        name: formData.get("name") as string || undefined,
                        unit: formData.get("unit") as string || undefined,
                        pricePerUnitDH: formData.get("pricePerUnitDH") as string || undefined,
                      })} initialState={{}} className="space-y-2 w-56">
                        <input name="name" defaultValue={p.name} className="input text-[13px]" />
                        <input name="unit" defaultValue={p.unit} className="input text-[13px]" />
                        <input name="pricePerUnitDH" defaultValue={(p.pricePerUnitCt / 100).toFixed(2)} className="input text-[13px]" />
                        <button type="submit" className="btn-primary text-[13px]">{t("save")}</button>
                      </WForm>
                    </EditDropdown>
                    <WForm action={async (prevState, formData) => await deleteTemplateProductAction(p.id)} initialState={{}} confirmMessage={t("deleteProductConfirm")} confirmLabel={tc("confirm")} cancelLabel={tc("cancel")}>
                      <button type="submit" aria-label={t("delete")} className="inline-flex items-center text-danger/60 hover:text-danger transition-colors"><IconX size={12} /></button>
                    </WForm>
                  </div>
                </div>
              ))}
            </div>
          )}

          <details className="rounded-[16px] border border-border p-3.5">
            <summary className="flex items-center gap-1 text-[13px] cursor-pointer text-muted font-semibold"><IconChevronRight size={13} className="chev" /> {t("addProduct")}</summary>
            <WForm action={async (prevState, formData) => await createTemplateProductAction(formData)} initialState={{}} className="space-y-2.5 mt-3">
              <input type="hidden" name="templateId" value={tpl.id} />
              <input name="name" placeholder={t("productNamePh")} required className="input text-[13px]" />
              <input name="unit" placeholder={t("unitPh")} className="input text-[13px]" />
              <input name="pricePerUnitDH" placeholder={t("pricePh")} required className="input text-[13px]" />
              <button type="submit" className="btn-primary text-[13px]">{t("addProductBtn")}</button>
            </WForm>
          </details>
        </div>
      </details>
    </div>
  );
}