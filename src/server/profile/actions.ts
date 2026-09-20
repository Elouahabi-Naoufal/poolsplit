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

const MAX_AVATAR_MB = 3;

function avatarPath(userId: string): string {
  return path.join(process.cwd(), "data", "avatars", `${userId}.png`);
}

async function ensureAvatarDir() {
  const dir = path.join(process.cwd(), "data", "avatars");
  await fs.promises.mkdir(dir, { recursive: true });
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

export async function updateProfileAction(formData: FormData) {
  try {
    const session = await requireSession();
    const t = await getTranslations("errors");
    const raw = { displayName: formData.get("displayName") as string };
    const parsed = updateProfileSchema.safeParse(raw);
    if (!parsed.success) return { error: t("displayNameLen") };

    const removeAvatar = formData.get("removeAvatar") === "on";
    const rawFile = formData.get("avatarFile");
    const file = isUploadedFile(rawFile) ? rawFile : null;

    if (removeAvatar) {
      const p = avatarPath(session.userId);
      try {
        await fs.promises.unlink(p);
      } catch {}
    } else if (file && file.size > 0) {
      try {
        if (!file.type.startsWith("image/")) return { error: t("avatarImageOnly") };
        const mb = file.size / 1024 / 1024;
        if (mb > MAX_AVATAR_MB) {
          return {
            error: `Image is ${mb.toFixed(1)} MB — must be under ${MAX_AVATAR_MB} MB. Take a screenshot and upload that instead.`,
          };
        }
        await ensureAvatarDir();
        const buffer = Buffer.from(await file.arrayBuffer());
        await fs.promises.writeFile(avatarPath(session.userId), buffer);
      } catch {
        return { error: "Could not save the image. Try taking a screenshot and uploading that instead (it will be smaller)." };
      }
    }

    await prisma.user.update({
      where: { id: session.userId },
      data: {
        displayName: parsed.data.displayName,
        ...(removeAvatar ? { avatar: null } : {}),
        ...(file && file.size > 0 ? { avatar: `/api/avatar/${session.userId}` } : {}),
      },
    });

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