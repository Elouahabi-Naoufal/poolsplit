"use client";
import { useRef, useState } from "react";

const MAX_DIM = 512;
const QUALITY = 0.8;

async function compressAvatarImage(file: File): Promise<File> {
  if (file.size <= 200 * 1024) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    for (const type of ["image/webp", "image/jpeg"]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));
      if (blob && blob.size > 0 && blob.size < file.size) {
        const ext = type === "image/webp" ? "webp" : "jpg";
        return new File([blob], `avatar.${ext}`, { type });
      }
    }
    return file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function AvatarPicker({
  currentAvatar,
  displayName,
  uploadLabel,
  changeLabel,
  removeLabel,
  hint,
  maxMB = 10,
  onFile,
}: {
  currentAvatar: string | null;
  displayName: string;
  uploadLabel: string;
  changeLabel: string;
  removeLabel: string;
  hint: string;
  maxMB?: number;
  onFile?: (file: File | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const shown = removed ? null : preview ?? currentAvatar;
  const maxBytes = maxMB * 1024 * 1024;

  const handleFile = (file: File | null) => {
    setError(null);
    if (!file) {
      setPreview(null);
      setRemoved(false);
      onFile?.(null);
      return;
    }
    setRemoved(false);
    if (file.size > maxBytes) {
      setError(`Photo is ${(file.size / 1024 / 1024).toFixed(1)} MB — must be under ${maxMB} MB.`);
      if (inputRef.current) inputRef.current.value = "";
      setPreview(null);
      onFile?.(null);
      return;
    }
    void (async () => {
      const out = await compressAvatarImage(file);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(out);
      previewUrlRef.current = url;
      setPreview(url);
      onFile?.(out);
    })();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div className="w-[72px] h-[72px] rounded-[20px] overflow-hidden bg-brand-subtle text-brand flex items-center justify-center flex-shrink-0">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt={displayName} className="w-full h-full object-cover" />
          ) : (
            <span className="text-[26px] font-bold">{displayName[0]?.toUpperCase()}</span>
          )}
        </div>
        <div className="space-y-2 min-w-0">
          <input
            ref={inputRef}
            type="file"
            name="avatarFile"
            accept="image/*"
            className="hidden"
            onChange={e => handleFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => inputRef.current?.click()} className="btn-secondary text-[13px] px-4 py-2">
              {currentAvatar || preview ? changeLabel : uploadLabel}
            </button>
            {(currentAvatar || preview) && !removed && (
              <button
                type="button"
                onClick={() => {
                  setRemoved(true);
                  setPreview(null);
                  setError(null);
                  if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
                  previewUrlRef.current = null;
                  if (inputRef.current) inputRef.current.value = "";
                  onFile?.(null);
                }}
                className="btn-ghost text-danger"
              >
                {removeLabel}
              </button>
            )}
          </div>
          <input type="hidden" name="removeAvatar" value={removed ? "on" : ""} />
          <p className="text-[12px] text-muted">{hint}</p>
        </div>
      </div>
      {error && (
        <div className="p-3 rounded-[12px] bg-warn-subtle border border-warn/20 text-warn text-[13px] leading-relaxed">
          {error}
        </div>
      )}
    </div>
  );
}