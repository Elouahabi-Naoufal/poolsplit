"use client";
import { useState } from "react";
import AvatarPicker from "@/components/AvatarPicker";
import { updateGroupImageAction } from "@/server/groups/actions";

type GroupImageState = { success?: boolean; error?: string };

export default function GroupImageForm({
  groupId,
  currentImage,
  displayName,
  uploadLabel,
  changeLabel,
  removeLabel,
  hint,
  saveLabel,
}: {
  groupId: string;
  currentImage: string | null;
  displayName: string;
  uploadLabel: string;
  changeLabel: string;
  removeLabel: string;
  hint: string;
  saveLabel: string;
}) {
  const [state, setState] = useState<GroupImageState>({});
  const [pending, setPending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const error = state.error ?? null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const formData = new FormData(event.currentTarget);
    if (file) formData.set("groupImageFile", file, file.name);
    const result = await updateGroupImageAction({}, formData);
    setState(result ?? {});
    setPending(false);
    if (result?.success) {
      setFile(null);
      setSavedAt(n => n + 1);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="groupId" value={groupId} />
      <AvatarPicker
        key={savedAt}
        currentAvatar={currentImage}
        displayName={displayName}
        uploadLabel={uploadLabel}
        changeLabel={changeLabel}
        removeLabel={removeLabel}
        hint={hint}
        maxMB={5}
        onFile={setFile}
        fileFieldName="groupImageFile"
        removeFieldName="removeGroupImage"
      />
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