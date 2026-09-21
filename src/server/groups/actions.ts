"use server";
import { requireSession } from "@/server/auth/session";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createGroupService,
  inviteMemberService,
  acceptInvitationService,
  declineInvitationService,
  removeMemberService,
  updateGroupPermissionsService,
  updateGroupImageService,
  isGroupImageUploadFile,
  groupPermissionKeys,
} from "@/services/groups";

export async function createGroupAction(formData: FormData) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const raw = {
    name: formData.get("name") as string,
    description: (formData.get("description") as string) || undefined,
  };
  const result = await createGroupService(session.userId, raw);
  if (!result.ok) {
    return { error: result.params ? t(result.error, result.params) : t(result.error) };
  }

  revalidatePath("/dashboard");
  redirect(`/groups/${result.group.id}`);
}

export async function inviteMemberAction(formData: FormData) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const groupId = formData.get("groupId") as string;
  const publicId = formData.get("publicId") as string;

  const result = await inviteMemberService(session.userId, groupId, publicId);
  if (!result.ok) {
    return { error: result.params ? t(result.error, result.params) : t(result.error) };
  }
  revalidatePath(`/groups/${groupId}`);
  return { success: true };
}

export async function acceptInvitationAction(invitationId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const result = await acceptInvitationService(session.userId, invitationId);
  if (!result.ok) {
    return { error: result.params ? t(result.error, result.params) : t(result.error) };
  }

  revalidatePath(`/groups/${result.groupId}`);
  revalidatePath("/dashboard");
  return { success: true };
}

export async function declineInvitationAction(invitationId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const result = await declineInvitationService(session.userId, invitationId);
  if (!result.ok) {
    return { error: result.params ? t(result.error, result.params) : t(result.error) };
  }
  revalidatePath("/dashboard");
  return { success: true };
}

export async function removeMemberAction(groupId: string, userId: string) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const result = await removeMemberService(session.userId, groupId, userId);
  if (!result.ok) {
    return { error: result.params ? t(result.error, result.params) : t(result.error) };
  }
  revalidatePath(`/groups/${groupId}`);
  return { success: true };
}

// ── Group permissions ─────────────────────────────────────────

/**
 * Update a member's group permissions. Group owner only.
 * The owner themselves cannot be edited here — they are always allowed.
 */
export async function updateGroupPermissionsAction(
  groupId: string,
  userId: string,
  permissions: Partial<Record<(typeof groupPermissionKeys)[number], boolean>>
) {
  const session = await requireSession();
  const t = await getTranslations("errors");
  const result = await updateGroupPermissionsService(session.userId, groupId, userId, permissions);
  if (!result.ok) {
    return { error: result.params ? t(result.error, result.params) : t(result.error) };
  }
  revalidatePath(`/groups/${groupId}`);
  return { success: true };
}

// ── Group image ──────────────────────────────────────────────

export async function updateGroupImageAction(
  _prevState: { success?: boolean; error?: string },
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const session = await requireSession();
    const t = await getTranslations("errors");
    const groupId = formData.get("groupId") as string;
    const removeImage = formData.get("removeGroupImage") === "on";
    const rawFile = formData.get("groupImageFile");
    const file = isGroupImageUploadFile(rawFile) ? rawFile : null;

    const result = await updateGroupImageService(session.userId, groupId, { file, removeImage });
    if (!result.ok) {
      return { error: result.params ? t(result.error, result.params) : t(result.error) };
    }

    try {
      revalidatePath(`/groups/${groupId}`);
      revalidatePath("/dashboard");
    } catch {}

    return { success: true };
  } catch (e) {
    console.error("[updateGroupImageAction] unexpected failure:", e);
    return { error: "Something went wrong. Please try again." };
  }
}