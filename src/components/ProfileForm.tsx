"use client";
import { useActionState } from "react";
import AvatarPicker from "@/components/AvatarPicker";
import { updateProfileAction } from "@/server/profile/actions";

type ProfileState = { success?: boolean; error?: string };

export default function ProfileForm({
  currentAvatar,
  displayName,
  uploadLabel,
  changeLabel,
  removeLabel,
  hint,
  maxMB,
  displayNameLabel,
  saveLabel,
}: {
  currentAvatar: string | null;
  displayName: string;
  uploadLabel: string;
  changeLabel: string;
  removeLabel: string;
  hint: string;
  maxMB: number;
  displayNameLabel: string;
  saveLabel: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateProfileAction as unknown as (prevState: ProfileState, formData: FormData) => Promise<ProfileState>,
    {} as ProfileState,
  );
  const error = "error" in state && state.error ? state.error : null;

  return (
    <form action={formAction} className="card-elevated p-6 space-y-5">
      <AvatarPicker
        currentAvatar={currentAvatar}
        displayName={displayName}
        uploadLabel={uploadLabel}
        changeLabel={changeLabel}
        removeLabel={removeLabel}
        hint={hint}
        maxMB={maxMB}
      />
      <div className="space-y-1.5">
        <label className="text-[13px] font-medium text-muted">{displayNameLabel}</label>
        <input name="displayName" defaultValue={displayName} required minLength={2} maxLength={50} className="input" />
      </div>
      {error && (
        <div className="p-3 rounded-[12px] bg-warn-subtle border border-warn/20 text-warn text-[13px] leading-relaxed">
          {error}
        </div>
      )}
      <button className="btn-primary" disabled={pending}>
        {pending ? "…" : saveLabel}
      </button>
    </form>
  );
}