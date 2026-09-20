"use client";
import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { logoutAction } from "@/server/auth/logout-action";
import { IconUsers, IconQr, IconPlus, IconTemplate } from "@/components/icons";
import ThemeToggle from "@/components/ThemeToggle";
import FriendshipModeToggle from "@/components/FriendshipModeToggle";

export type ShellUser = {
  displayName: string;
  publicId: string;
  avatarUrl: string | null;
  isAdmin: boolean;
};

export type ShellGroup = { id: string; name: string };

const TINTS = [
  "bg-brand-subtle text-brand",
  "bg-action-subtle text-action",
  "bg-happy-subtle text-warn",
  "bg-success-subtle text-success",
];

function tintFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

function isGroupsActive(pathname: string): boolean {
  return pathname === "/dashboard" || pathname.startsWith("/groups");
}

export default function AppShell({
  user,
  groups,
  children,
}: {
  user: ShellUser;
  groups: ShellGroup[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const groupsActive = isGroupsActive(pathname);
  const scanActive = pathname.startsWith("/scan");
  const templatesActive = pathname.startsWith("/templates");
  const profileActive = pathname.startsWith("/profile");

  const navRow = (active: boolean) =>
    `flex items-center gap-2.5 h-9 px-2.5 rounded-[12px] text-[14px] font-medium transition-colors ${
      active ? "bg-elevated text-foreground" : "text-muted hover:text-foreground hover:bg-elevated"
    }`;

  return (
    <div className="min-h-screen lg:flex lg:items-stretch">
      {/* Desktop rail */}
      <aside className="hidden lg:flex w-60 flex-shrink-0 flex-col bg-surface border-e border-border sticky top-0 h-screen">
        <div className="px-4 pt-4 pb-3">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="brand-mark"><img src="/logo.png" alt="PoolSplit" /></div>
            <span className="font-extrabold text-[15px] tracking-tight">PoolSplit</span>
          </Link>
        </div>
        <div className="px-4 pb-3 flex gap-2">
          <Link href="/dashboard#new-group" className="btn-primary btn-sm w-full">
            <IconPlus size={14} />{t("new")}
          </Link>
        </div>
        <nav aria-label={t("mainNav")} className="flex-1 overflow-y-auto px-3 pb-3 space-y-0.5">
          <Link href="/dashboard" className={navRow(groupsActive)}>
            <IconUsers size={16} />{t("groups")}
          </Link>
          <Link href="/scan" className={navRow(scanActive)}>
            <IconQr size={16} />{t("scan")}
          </Link>
          <Link href="/templates" className={navRow(templatesActive)}>
            <IconTemplate size={16} />{t("templates")}
          </Link>
          <Link href="/profile" className={navRow(profileActive)}>
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover" />
            ) : (
              <span className="w-4 h-4 rounded-full bg-brand-subtle text-brand flex items-center justify-center text-[10px] font-bold">
                {user.displayName[0]?.toUpperCase()}
              </span>
            )}
            {t("profile")}
          </Link>
          {groups.length > 0 && (
            <div className="pt-4">
              <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{t("groups")}</div>
              <div className="space-y-0.5">
                {groups.map(g => {
                  const active = pathname.includes(`/groups/${g.id}`);
                  return (
                    <Link key={g.id} href={`/groups/${g.id}`} className={navRow(active)}>
                      <span className={`w-5 h-5 rounded-[7px] flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${tintFor(g.id)}`}>
                        {g.name[0]?.toUpperCase()}
                      </span>
                      <span className="truncate">{g.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </nav>
        <div className="p-3 border-t border-border space-y-2">
          {user.isAdmin && (
            <Link href="/admin" className="tag bg-warn-subtle text-warn mb-2 w-full text-center block">{t("admin")}</Link>
          )}
          <div className="flex items-center gap-1">
            <FriendshipModeToggle />
            <ThemeToggle />
            <div className="flex items-center gap-2.5 min-w-0 flex-1 ms-1">
              <Link href="/profile" className="w-8 h-8 rounded-full overflow-hidden bg-brand-subtle text-brand flex items-center justify-center text-[13px] font-bold flex-shrink-0">
                {user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatarUrl} alt={user.displayName} className="w-full h-full object-cover" />
                ) : (
                  user.displayName[0]?.toUpperCase()
                )}
              </Link>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate">{user.displayName}</div>
                <div className="text-[11px] text-muted font-mono truncate">{user.publicId}</div>
              </div>
              <form action={logoutAction}>
                <button className="btn-ghost text-[12px] px-2" title={t("logout")}>{t("logout")}</button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-40 bg-surface border-b border-border">
        <div className="px-4 h-14 flex items-center gap-2.5">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="brand-mark"><img src="/logo.png" alt="PoolSplit" /></div>
            <span className="font-extrabold text-[15px] tracking-tight">PoolSplit</span>
          </Link>
          <div className="flex-1" />
          <FriendshipModeToggle />
          <ThemeToggle />
          <Link href="/profile" aria-label="Profile" className="w-8 h-8 rounded-full overflow-hidden bg-brand-subtle text-brand flex items-center justify-center text-[13px] font-bold">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt={user.displayName} className="w-full h-full object-cover" />
            ) : (
              user.displayName[0]?.toUpperCase()
            )}
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-24 lg:pb-0">{children}</div>

      {/* Mobile tab bar */}
      <nav aria-label={t("mainNav")} className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-border safe-bottom">
        <div className="grid grid-cols-4 h-[60px] px-2">
          <Link href="/dashboard" className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${groupsActive ? "text-action" : "text-muted"}`}>
            <IconUsers size={20} />{t("groups")}
          </Link>
          <Link href="/scan" className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${groupsActive ? "text-action" : "text-muted"}`}>
            <IconQr size={20} />{t("scan")}
          </Link>
          <Link href="/dashboard#new-group" className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-muted relative -top-2">
            <span className="w-11 h-8 rounded-full bg-action text-white flex items-center justify-center shadow-md"><IconPlus size={18} /></span>
          </Link>
          <Link href="/profile" className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${profileActive ? "text-action" : "text-muted"}`}>
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
            ) : (
              <span className="w-5 h-5 rounded-full bg-brand-subtle text-brand flex items-center justify-center text-[10px] font-bold">
                {user.displayName[0]?.toUpperCase()}
              </span>
            )}
            {t("profile")}
          </Link>
        </div>
      </nav>
    </div>
  );
}
