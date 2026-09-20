"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useZxing, type DetectedBarcode } from "react-zxing";

const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: "environment" },
};
const FALLBACK_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: true,
};

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

interface QrScannerProps {
  onScan: (decodedText: string) => void;
  onError?: (error: string) => void;
}

type Phase = "checking" | "ready" | "active" | "denied" | "no-camera" | "insecure" | "error";

function ScannerView({
  onScan,
  onStreamError,
  fallback,
}: {
  onScan: (v: string) => void;
  onStreamError: (e: unknown) => void;
  fallback: boolean;
}) {
  const t = useTranslations("scanner");
  const [paused, setPaused] = useState(false);
  const scannedRef = useRef(false);

  const onDecode = useCallback(
    (result: DetectedBarcode) => {
      if (scannedRef.current) return;
      scannedRef.current = true;
      setPaused(true);
      onScan(result.rawValue);
    },
    [onScan]
  );

  const { ref } = useZxing({
    paused,
    constraints: fallback ? FALLBACK_CONSTRAINTS : VIDEO_CONSTRAINTS,
    onDecodeResult: onDecode,
    onError(err) {
      if (!scannedRef.current) onStreamError(err);
    },
  });

  const togglePause = () => {
    if (!paused) scannedRef.current = false;
    setPaused(!paused);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-full max-w-sm rounded-[20px] overflow-hidden border border-border bg-black">
        <video ref={ref} muted playsInline className="w-full h-auto" style={{ minHeight: 250 }} />
      </div>
      <button onClick={togglePause} className="btn-secondary px-6">
        {paused ? t("resume") : t("pause")}
      </button>
    </div>
  );
}

export default function QrScanner({ onScan, onError }: QrScannerProps) {
  const t = useTranslations("scanner");
  const [phase, setPhase] = useState<Phase>("checking");
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState(0);
  const [fallback, setFallback] = useState(false);
  const [ios, setIos] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setIos(isIOS());
  }, []);

  const applyCameraError = useCallback(
    (err: unknown) => {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setPhase("denied");
        onError?.(t("deniedToast"));
      } else if (name === "NotFoundError") {
        setPhase("no-camera");
      } else {
        setPhase("error");
        setErrorMsg(err instanceof Error ? err.message : null);
        onError?.(err instanceof Error ? err.message : "Camera error");
      }
    },
    [onError, t]
  );

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("insecure");
      return;
    }
    setBusy(true);
    try {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
      } catch (err) {
        if (err instanceof DOMException && err.name === "OverconstrainedError") {
          stream = await navigator.mediaDevices.getUserMedia(FALLBACK_CONSTRAINTS);
        } else {
          throw err;
        }
      }
      stream.getTracks().forEach(track => track.stop());
      setRunId(id => id + 1);
      setPhase("active");
    } catch (err) {
      applyCameraError(err);
    } finally {
      setBusy(false);
    }
  }, [applyCameraError]);

  const probe = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("insecure");
      return;
    }
    try {
      const status = await navigator.permissions?.query({ name: "camera" as PermissionName });
      if (status?.state === "denied") {
        setPhase("denied");
        return;
      }
      if (status?.state === "granted") {
        void start();
        return;
      }
    } catch {
      // Permissions API unavailable (older Safari) — ask via the button below.
    }
    setPhase("ready");
  }, [start]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("insecure");
      return;
    }
    void probe();
  }, [probe]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && (phase === "denied" || phase === "error")) {
        setPhase("checking");
        void probe();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [phase, probe]);

  const handleStreamError = useCallback(
    (err: unknown) => {
      if (err instanceof DOMException && err.name === "OverconstrainedError" && !fallback) {
        setFallback(true);
        setRunId(id => id + 1);
        return;
      }
      applyCameraError(err);
    },
    [applyCameraError, fallback]
  );

  if (phase === "checking") {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <div className="animate-spin w-8 h-8 border-4 border-border border-t-action rounded-full" />
        <p className="text-muted text-[14px]">{t("checking")}</p>
      </div>
    );
  }

  if (phase === "ready") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-[14px] font-semibold">{t("allowTitle")}</p>
        <p className="text-[13px] text-muted max-w-xs">{t("allowSub")}</p>
        <button onClick={() => void start()} disabled={busy} className="btn-primary px-6">
          {busy ? t("requesting") : t("enable")}
        </button>
      </div>
    );
  }

  if (phase === "denied") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-[14px] font-semibold text-danger">{t("blockedTitle")}</p>
        <p className="text-[13px] text-muted max-w-xs">{ios ? t("blockedSubIos") : t("blockedSub")}</p>
        <button onClick={() => void start()} disabled={busy} className="btn-primary px-6">
          {busy ? t("requesting") : t("tryAgain")}
        </button>
        <p className="text-[12px] text-muted max-w-xs">{t("tryAgainSub")}</p>
      </div>
    );
  }

  if (phase === "no-camera") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-[14px] font-semibold">{t("noCameraTitle")}</p>
        <p className="text-[13px] text-muted max-w-xs">{t("noCameraSub")}</p>
        <button onClick={() => void start()} disabled={busy} className="btn-secondary px-6">
          {t("tryAgain")}
        </button>
      </div>
    );
  }

  if (phase === "insecure") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-[14px] font-semibold">{t("insecureTitle")}</p>
        <p className="text-[13px] text-muted max-w-xs">{t("insecureSub")}</p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-[14px] font-semibold text-danger">{t("errorTitle")}</p>
        <p className="text-[13px] text-muted max-w-xs">{errorMsg ?? t("errorSub")}</p>
        <button onClick={() => void start()} disabled={busy} className="btn-secondary px-6">
          {t("tryAgain")}
        </button>
      </div>
    );
  }

  return (
    <ScannerView
      key={runId}
      fallback={fallback}
      onScan={onScan}
      onStreamError={handleStreamError}
    />
  );
}