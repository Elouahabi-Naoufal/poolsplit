"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { updateGroupPermissionsAction } from "@/server/groups/actions";

export type MemberPerms = {
  canManageOutings: boolean;
  canRecordPayments: boolean;
  canUseTemplates: boolean;
};

const PERM_KEYS = ["canManageOutings", "canRecordPayments", "canUseTemplates"] as const;
type PermKey = (typeof PERM_KEYS)[number];

export default function GroupPermissions({ groupId, members }: {
  groupId: string;
  members: { userId: string; displayName: string; perms: MemberPerms }[];
}) {
  const t = useTranslations("group");

  return (
    <div>
      <div className="text-[12px] font-semibold text-muted uppercase tracking-wide">{t("permissionsTitle")}</div>
      <p className="text-[12px] text-muted mt-1 mb-3">{t("permissionsHint")}</p>
      <div className="ledger">
        {members.length === 0 && (
          <div className="py-3 text-[13px] text-muted text-center">{t("permissionsNoMembers")}</div>
        )}
        {members.map(m => (
          <MemberRow key={`${m.userId}:${JSON.stringify(m.perms)}`} groupId={groupId} userId={m.userId} displayName={m.displayName} perms={m.perms} labels={{
            manageOutings: t("permManageOutings"),
            recordPayments: t("permRecordPayments"),
            useTemplates: t("permUseTemplates"),
          }} />
        ))}
      </div>
    </div>
  );
}

function MemberRow({ groupId, userId, displayName, perms, labels }: {
  groupId: string;
  userId: string;
  displayName: string;
  perms: MemberPerms;
  labels: { manageOutings: string; recordPayments: string; useTemplates: string };
}) {
  const [state, setState] = useState<MemberPerms>(perms);

  const toggle = (key: PermKey, value: boolean) => {
    setState(prev => ({ ...prev, [key]: value }));
    void updateGroupPermissionsAction(groupId, userId, { [key]: value });
  };

  const rows: { key: PermKey; label: string }[] = [
    { key: "canManageOutings", label: labels.manageOutings },
    { key: "canRecordPayments", label: labels.recordPayments },
    { key: "canUseTemplates", label: labels.useTemplates },
  ];

  return (
    <div className="py-2.5">
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="w-7 h-7 rounded-full bg-brand-subtle text-brand flex items-center justify-center text-[12px] font-bold flex-shrink-0">
          {displayName[0]}
        </span>
        <span className="font-medium text-[14px]">{displayName}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 ps-0 sm:ps-9">
        {rows.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-1.5 text-[12px] text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-action"
              checked={state[key]}
              onChange={e => toggle(key, e.target.checked)}
            />
            <span className="leading-tight">{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}