import { prisma } from "@/lib/prisma";
import { getSession } from "@/server/auth/session";
import { redirect } from "next/navigation";
import ProfileForm from "@/components/ProfileForm";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { avatarSrc } from "@/lib/avatar";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";

const MAX_AVATAR_MB = 10;

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, username: true, displayName: true, publicId: true, avatar: true, isAdmin: true, createdAt: true },
  });
  if (!user) redirect("/login");

  const t = await getTranslations({ locale: locale as AppLocale, namespace: "profile" });

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-8 space-y-8">
      <h1 className="font-extrabold text-[26px] tracking-tight">{t("title")}</h1>
        <div className="card-elevated p-6 space-y-4">
          <div className="grid gap-3 text-[14px]">
            <div className="flex items-center gap-3">
              <span className="text-muted w-20">{t("publicId")}</span>
              <span className="font-mono bg-elevated px-2.5 py-1 rounded-[8px] text-[13px]">{user.publicId}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-muted w-20">{t("username")}</span>
              <span>{user.username}</span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-[15px] font-semibold">{t("editProfile")}</h2>
          <ProfileForm
            currentAvatar={avatarSrc(user)}
            displayName={user.displayName}
            uploadLabel={t("uploadPic")}
            changeLabel={t("changePic")}
            removeLabel={t("removePic")}
            hint={t("picHint")}
            maxMB={MAX_AVATAR_MB}
            displayNameLabel={t("displayName")}
            saveLabel={t("save")}
          />
        </div>

        <LanguageSwitcher />

        <div className="card border-dashed p-6 text-center text-[13px] text-muted">
          ID <span className="font-mono text-foreground">{user.publicId}</span> {t("shareHint")}
        </div>
    </main>
  );
}
