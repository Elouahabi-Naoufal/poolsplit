"use client";
import { useActionState, useEffect, useRef, useState } from "react";

type AR = { error?: string; success?: boolean };

const CONFIRM_MS = 5000;
const TICK = 80;

export default function WForm({
  action,
  initialState,
  children,
  className,
  confirmMessage,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
}: {
  action: (prevState: AR, formData: FormData) => Promise<AR>;
  initialState: AR;
  children: React.ReactNode;
  className?: string;
  confirmMessage?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [confirming, setConfirming] = useState(false);
  const [leftMs, setLeftMs] = useState(CONFIRM_MS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const submittedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setLeftMs(CONFIRM_MS);
  };

  const startTimer = () => {
    stopTimer();
    startedAtRef.current = Date.now();
    setLeftMs(CONFIRM_MS);
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, CONFIRM_MS - (Date.now() - startedAtRef.current));
      setLeftMs(remaining);
      if (remaining <= 0) {
        stopTimer();
        setConfirming(false);
      }
    }, TICK);
  };

  const cancelConfirm = () => {
    stopTimer();
    setConfirming(false);
  };

  const wrappedAction = confirmMessage
    ? (formData: FormData) => {
        if (!confirming) {
          // First click after a submit: only arm the toast confirmation.
          submittedRef.current = false;
          setConfirming(true);
          startTimer();
          return state;
        }
        // Confirmed (button inside the toast is type=submit).
        submittedRef.current = true;
        stopTimer();
        setConfirming(false);
        return formAction(formData);
      }
    : formAction;

  const pct = (leftMs / CONFIRM_MS) * 100;

  return (
    <form action={wrappedAction} className={className}>
      {children}
      {pending && !submittedRef.current && (
        <span className="inline-block w-4 h-4 border-2 border-border border-t-brand rounded-full animate-spin ms-1 align-middle" />
      )}
      {state && state.error && <div className="mt-1.5 text-[12px] text-danger">{state.error}</div>}
      {confirming && confirmMessage && (
        <div className="fixed bottom-6 inset-x-0 z-[100] px-4 pointer-events-none">
          <div className="mx-auto max-w-[360px] pointer-events-auto rounded-[16px] bg-surface border border-border shadow-xl p-3.5 space-y-3 animate-in">
            <div className="text-[13px] leading-snug">{confirmMessage}</div>
            <div className="flex items-center gap-2">
              <button type="submit" className="btn-danger-solid btn-sm flex-1 py-2">{confirmLabel}</button>
              <button type="button" onClick={cancelConfirm} className="btn-ghost btn-sm px-4 py-2">{cancelLabel}</button>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%`, background: "var(--danger)", transition: "width 80ms linear" }} />
            </div>
          </div>
        </div>
      )}
    </form>
  );
}