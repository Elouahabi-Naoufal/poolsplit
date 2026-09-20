"use server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/server/auth/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import fs from "fs";
import path from "path";

const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(50),
});

export type ProfileState = { success?: boolean; error?: string };

const MAX_AVATAR_MB = 3;
const AVATAR_EXTS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

function avatarDir() {
  return path.join(process.cwd(), "data", "avatars");
}

function avatarFile(userId: string, ext: string) {
  return path.join(avatarDir(), `${userId}.${ext}`);
}

async function ensureAvatarDir() {
  await fs.promises.mkdir(avatarDir(), { recursive: true });
}

async function removeAvatarFiles(userId: string) {
  for (const ext of Object.values(AVATAR_EXTS)) {
    try {
      await fs.promises.unlink(avatarFile(userId, ext));
    } catch {}
  }
}

function isUploadedFile(
  value: unknown,
): value is File & { arrayBuffer: () => Promise<ArrayBuffer> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "size" in value &&
    typeof (value as { size: unknown }).size === "number" &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string" &&
    "arrayBuffer" in value &&
    typeof (value as { arrayBuffer: unknown }).arrayBuffer === "function"
  );
}

export async function updateProfileAction(
  _prevState: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  try {
    const session = await requireSession();
    const t = await getTranslations("errors");
    const parsed = updateProfileSchema.safeParse({
      displayName: formData.get("displayName"),
    });
    if (!parsed.success) return { error: t("displayNameLen") };

    const removeAvatar = formData.get("removeAvatar") === "on";
    const rawFile = formData.get("avatarFile");
    const file = isUploadedFile(rawFile) ? rawFile : null;

    if (file && file.size > 0) {
      const extKey = file.type as keyof typeof AVATAR_EXTS;
      if (!(extKey in AVATAR_EXTS)) return { error: t("avatarImageOnly") };
      const mb = file.size / 1024 / 1024;
      if (mb > MAX_AVATAR_MB) {
        return { error: t("avatarTooBig", { maxMB: MAX_AVATAR_MB }) };
      }
      await ensureAvatarDir();
      await removeAvatarFiles(session.userId);
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.promises.writeFile(avatarFile(session.userId, AVATAR_EXTS[extKey]), buffer);
      await prisma.user.update({
        where: { id: session.userId },
        data: {
          displayName: parsed.data.displayName,
          avatar: `/api/avatar/${session.userId}?v=${Date.now()}`,
        },
      });
    } else {
      if (removeAvatar) {
        await removeAvatarFiles(session.userId);
      }
      await prisma.user.update({
        where: { id: session.userId },
        data: {
          displayName: parsed.data.displayName,
          ...(removeAvatar ? { avatar: null } : {}),
        },
      });
    }

    try {
      revalidatePath("/profile");
      revalidatePath("/dashboard");
    } catch {}

    return { success: true };
  } catch (e) {
    console.error("[updateProfileAction] unexpected failure:", e);
    return { error: "Something went wrong. Please try again." };
  }
}

export async function getProfile() {
  const session = await requireSession();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, username: true, displayName: true, publicId: true, avatar: true, isAdmin: true, createdAt: true },
  });
  if (!user) throw new Error("User not found");
  return user;
}