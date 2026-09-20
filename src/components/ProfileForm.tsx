"use client";
import { useState } from "react";
import AvatarPicker from "@/components/AvatarPicker";
import { updateProfileAction, type ProfileState } from "@/server/profile/actions";

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
  const [state, setState] = useState<ProfileState>({});
  const [pending, setPending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const error = state.error ?? null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const formData = new FormData(event.currentTarget);
    if (file) formData.set("avatarFile", file, file.name);
    const result = await updateProfileAction({}, formData);
    setState(result ?? {});
    setPending(false);
    if (result?.success) {
      setFile(null);
      setSavedAt(n => n + 1);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card-elevated p-6 space-y-5">
      <AvatarPicker
        key={savedAt}
        currentAvatar={currentAvatar}
        displayName={displayName}
        uploadLabel={uploadLabel}
        changeLabel={changeLabel}
        removeLabel={removeLabel}
        hint={hint}
        maxMB={maxMB}
        onFile={setFile}
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